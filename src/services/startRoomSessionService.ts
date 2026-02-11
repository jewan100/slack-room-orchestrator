import { ROOM_COMMAND_NAMES, ROOM_LOG_EVENT_NAMES, ROOM_START_SERVICE_MESSAGES } from "../shared/messages";
import { ROOM_ERROR_CODES } from "../shared/errorCodes";
import type { Logger } from "../shared/logger";
import { RoomCommandError } from "../shared/roomCommandError";
import type { BriefingRepository, RoomSession, RoomSessionRepository, SlackThreadPort } from "../shared/types";
import { ensureNoActiveSession, validateStartTopic } from "../validators/roomCommandValidator";

// start 유스케이스 입력 모델
export interface StartRoomSessionInput {
  topic: string;
  requestedByUserId: string;
  workspaceId: string;
  startChannelId: string;
}

// start 유스케이스 반환 모델
export interface StartRoomSessionResult {
  session: RoomSession;
}

// unknown 에러를 로그용 문자열로 정규화한다.
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return ROOM_START_SERVICE_MESSAGES.followupNoticeUnknownError;
}

// start 동시 요청으로 발생하는 활성 세션 unique 충돌 여부를 판별한다.
function isActiveSessionConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("idx_room_sessions_active_per_channel") ||
    error.message.includes("UNIQUE constraint failed: room_sessions.start_channel_id")
  );
}

// `/room start` 유스케이스 오케스트레이션 서비스
// 세션 생성, 브리핑 저장, 안내 메시지 전송을 한 트랜잭션 흐름으로 묶는다.
export class StartRoomSessionService {
  public constructor(
    private readonly roomSessionRepository: RoomSessionRepository,
    private readonly briefingRepository: BriefingRepository,
    private readonly logger: Logger
  ) {}

  // PREPARED 세션을 먼저 선점해 동시 start 요청과 스레드 orphan 가능성을 줄인다.
  private async createReservedPreparedSession(input: StartRoomSessionInput, topic: string): Promise<RoomSession> {
    try {
      return await this.roomSessionRepository.createPreparedSession({
        topic,
        requestedByUserId: input.requestedByUserId,
        workspaceId: input.workspaceId,
        startChannelId: input.startChannelId,
        startThreadTs: ROOM_START_SERVICE_MESSAGES.pendingStartThreadTs
      });
    } catch (error) {
      // 저장소 unique 충돌은 도메인 에러코드(ROOM_ALREADY_RUNNING)로 정규화한다.
      if (isActiveSessionConstraintError(error)) {
        throw new RoomCommandError(ROOM_ERROR_CODES.ROOM_ALREADY_RUNNING);
      }
      throw error;
    }
  }

  // 보상 처리로 예약된 세션을 정리한다.
  // 정리 실패는 원인 추적용 오류 로그로만 남기고 원래 예외를 유지한다.
  private async rollbackReservedSession(sessionId: string, channelId: string, error: unknown): Promise<void> {
    try {
      await this.roomSessionRepository.deleteById(sessionId);
    } catch (rollbackError) {
      this.logger.error(ROOM_LOG_EVENT_NAMES.roomStartReservationRollbackFailed, {
        sessionId,
        channelId,
        command: ROOM_COMMAND_NAMES.start,
        errorMessage: extractErrorMessage(rollbackError),
        causeErrorMessage: extractErrorMessage(error)
      });
    }
  }

  // 후속 안내 메시지 실패는 start 성공 여부와 분리해 처리한다.
  private async postFollowupNotice(
    slackThreadPort: SlackThreadPort,
    input: StartRoomSessionInput,
    sessionId: string,
    threadTs: string
  ): Promise<void> {
    try {
      await slackThreadPort.postMessageInThread({
        channelId: input.startChannelId,
        threadTs,
        text: ROOM_START_SERVICE_MESSAGES.briefingSavedNotice
      });
    } catch (error) {
      this.logger.warn(ROOM_LOG_EVENT_NAMES.roomStartFollowupNoticeFailed, {
        sessionId,
        channelId: input.startChannelId,
        command: ROOM_COMMAND_NAMES.start,
        errorMessage: extractErrorMessage(error)
      });
    }
  }

  // start 명령 전체 흐름:
  // 1) 입력 검증 2) 활성 세션 중복 검사 3) PREPARED 세션 선점
  // 4) 준비 스레드 생성 5) 브리핑 저장 6) 후속 액션 안내
  public async execute(input: StartRoomSessionInput, slackThreadPort: SlackThreadPort): Promise<StartRoomSessionResult> {
    // 사용자가 입력한 주제를 정규화(trim)하고 빈 값이면 예외를 발생시킨다.
    const topic = validateStartTopic(input.topic);

    // 같은 시작 채널에 이미 활성 세션이 있는지 조회한다.
    // DB 조회 결과를 기다려야 이후 중복 생성 여부를 정확히 판단할 수 있다.
    const activeSession = await this.roomSessionRepository.findActiveSessionByStartChannel(input.startChannelId);

    // 활성 세션이 있으면 start를 중단한다(ROOM_ALREADY_RUNNING).
    ensureNoActiveSession(activeSession);

    // DB에서 PREPARED 세션을 먼저 선점해 동시 start 경쟁 구간을 축소한다.
    const reservedSession = await this.createReservedPreparedSession(input, topic);

    try {
      // start 채널에 준비 스레드(루트 메시지)를 만든다.
      const thread = await slackThreadPort.createThread({
        channelId: input.startChannelId,
        text: ROOM_START_SERVICE_MESSAGES.preparedThreadText(topic)
      });

      // 예약 세션에 실제 start 스레드 식별자를 반영한다.
      const session = await this.roomSessionRepository.updatePreparedSessionStartThread({
        sessionId: reservedSession.id,
        startThreadTs: thread.threadTs
      });

      // 브리핑 템플릿을 별도 테이블에 저장한다.
      await this.briefingRepository.createBriefing({
        sessionId: session.id,
        goal: ROOM_START_SERVICE_MESSAGES.briefingGoal(topic),
        constraints: ROOM_START_SERVICE_MESSAGES.briefingConstraints,
        successCriteria: ROOM_START_SERVICE_MESSAGES.briefingSuccessCriteria
      });

      await this.postFollowupNotice(slackThreadPort, input, session.id, thread.threadTs);

      // 완료 로그를 남겨 운영자가 request/session 단위로 추적할 수 있게 한다.
      this.logger.info(ROOM_LOG_EVENT_NAMES.roomStartCompleted, {
        sessionId: session.id,
        channelId: input.startChannelId,
        command: ROOM_COMMAND_NAMES.start
      });

      // 호출자(핸들러)에서 응답 메시지를 조립할 수 있도록 세션 정보를 반환한다.
      return { session };
    } catch (error) {
      // start 후반 실패 시 선점된 세션을 정리해 재시도 가능 상태를 복구한다.
      await this.rollbackReservedSession(reservedSession.id, input.startChannelId, error);
      throw error;
    }
  }
}

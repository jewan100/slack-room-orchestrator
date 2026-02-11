import { ROOM_COMMAND_NAMES, ROOM_LOG_EVENT_NAMES, ROOM_START_SERVICE_MESSAGES } from "../shared/messages";
import { ROOM_ERROR_CODES } from "../shared/errorCodes";
import type { Logger } from "../shared/logger";
import { RoomCommandError } from "../shared/roomCommandError";
import type {
  BriefingRepository,
  RoomModeLifecycleService,
  RoomSession,
  RoomSessionRepository,
  SlackThreadPort
} from "../shared/types";
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

// start 유스케이스의 OpenClaw 연동 옵션
export interface StartRoomSessionOpenClawOptions {
  roomModeLifecycleService: RoomModeLifecycleService;
  roomModeTtlMinutes: number;
}

// sqlite 예외 객체에서 사용할 수 있는 구조화 필드 타입
interface SqliteConstraintErrorLike {
  code?: unknown;
  errno?: unknown;
  message?: unknown;
}

// unknown 에러를 로그용 문자열로 정규화한다.
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return ROOM_START_SERVICE_MESSAGES.followupNoticeUnknownError;
}

// unknown 예외에서 sqlite 구조화 필드를 안전하게 추출한다.
function extractSqliteConstraintErrorMetadata(error: unknown): {
  code: string | null;
  errno: number | null;
  message: string | null;
} {
  if (typeof error !== "object" || error === null) {
    return {
      code: null,
      errno: null,
      message: null
    };
  }

  const typedError = error as SqliteConstraintErrorLike;
  return {
    code: typeof typedError.code === "string" ? typedError.code : null,
    errno: typeof typedError.errno === "number" ? typedError.errno : null,
    message: typeof typedError.message === "string" ? typedError.message : null
  };
}

// start 동시 요청으로 발생하는 활성 세션 unique 충돌 여부를 판별한다.
function isAlreadyRunningConstraintError(error: unknown): boolean {
  const metadata = extractSqliteConstraintErrorMetadata(error);

  // sqlite 에러 코드/errno를 먼저 확인해 unique 제약 충돌 후보를 좁힌다.
  const isConstraintError =
    metadata.code === ROOM_START_SERVICE_MESSAGES.sqliteConstraintErrorCode ||
    metadata.code === ROOM_START_SERVICE_MESSAGES.sqliteConstraintUniqueErrorCode ||
    metadata.errno === ROOM_START_SERVICE_MESSAGES.sqliteConstraintErrno;

  if (!isConstraintError || !metadata.message) {
    return false;
  }

  return (
    metadata.message.includes(ROOM_START_SERVICE_MESSAGES.activeSessionConstraintIndexName) ||
    metadata.message.includes(ROOM_START_SERVICE_MESSAGES.activeSessionConstraintColumnName) ||
    metadata.message.includes(ROOM_START_SERVICE_MESSAGES.activeWatchTargetConstraintIndexName) ||
    metadata.message.includes(ROOM_START_SERVICE_MESSAGES.activeWatchTargetConstraintColumnName)
  );
}

// start 흐름에서 발생한 sqlite unique 충돌을 도메인 예외로 정규화한다.
function normalizeStartFlowError(error: unknown): unknown {
  if (error instanceof RoomCommandError) {
    return error;
  }

  if (isAlreadyRunningConstraintError(error)) {
    return new RoomCommandError(ROOM_ERROR_CODES.ROOM_ALREADY_RUNNING);
  }

  return error;
}

// `/room start` 유스케이스 오케스트레이션 서비스
// 세션 생성, 브리핑 저장, 안내 메시지 전송을 한 트랜잭션 흐름으로 묶는다.
export class StartRoomSessionService {
  public constructor(
    private readonly roomSessionRepository: RoomSessionRepository,
    private readonly briefingRepository: BriefingRepository,
    private readonly logger: Logger,
    private readonly openClawOptions?: StartRoomSessionOpenClawOptions
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
      if (isAlreadyRunningConstraintError(error)) {
        throw new RoomCommandError(ROOM_ERROR_CODES.ROOM_ALREADY_RUNNING);
      }
      throw error;
    }
  }

  // 보상 처리로 예약된 세션을 정리한다.
  // 정리 실패는 원인 추적용 오류 로그로만 남기고 원래 예외를 유지한다.
  private async rollbackReservedSession(
    sessionId: string,
    channelId: string,
    error: unknown,
    currentStartThreadTs: string
  ): Promise<void> {
    const rollbackCandidates = [
      currentStartThreadTs,
      ROOM_START_SERVICE_MESSAGES.pendingStartThreadTs
    ];

    try {
      let deleted = false;
      for (const expectedStartThreadTs of rollbackCandidates) {
        deleted = await this.roomSessionRepository.deleteReservedPreparedSession({
          sessionId,
          expectedStartThreadTs
        });

        if (deleted) {
          break;
        }
      }

      // 예약 상태가 이미 변경된 경우는 삭제를 건너뛰고 경고 로그로만 남긴다.
      if (!deleted) {
        this.logger.warn(ROOM_LOG_EVENT_NAMES.roomStartReservationRollbackSkipped, {
          sessionId,
          channelId,
          command: ROOM_COMMAND_NAMES.start,
          causeErrorMessage: extractErrorMessage(error)
        });
      }
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

  // start 성공 직후 OpenClaw planning mode를 ON으로 전환한다.
  // 옵션이 비활성인 환경에서는 아무 동작도 하지 않는다.
  private async turnOnPlanningRoomMode(session: RoomSession): Promise<void> {
    if (!this.openClawOptions) {
      return;
    }

    await this.openClawOptions.roomModeLifecycleService.turnOnPlanningRoomMode({
      session,
      ttlMinutes: this.openClawOptions.roomModeTtlMinutes
    });
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
  // 4) 준비 스레드 생성 5) 브리핑 저장 6) OpenClaw mode ON enqueue 7) 후속 액션 안내
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
    let currentStartThreadTs: string = ROOM_START_SERVICE_MESSAGES.pendingStartThreadTs;

    try {
      // start 채널에 준비 스레드(루트 메시지)를 만든다.
      const thread = await slackThreadPort.createThread({
        channelId: input.startChannelId,
        text: ROOM_START_SERVICE_MESSAGES.preparedThreadText(topic)
      });
      currentStartThreadTs = thread.threadTs;

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

      // OpenClaw가 해당 스레드를 감시할 수 있도록 mode ON 이벤트를 적재한다.
      await this.turnOnPlanningRoomMode(session);

      // 사용자 편의를 위한 후속 안내는 best-effort로 전송한다.
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
      const normalizedError = normalizeStartFlowError(error);
      // start 후반 실패 시 선점된 세션을 정리해 재시도 가능 상태를 복구한다.
      await this.rollbackReservedSession(reservedSession.id, input.startChannelId, normalizedError, currentStartThreadTs);
      throw normalizedError;
    }
  }
}

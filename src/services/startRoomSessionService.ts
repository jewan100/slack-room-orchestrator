import { ROOM_COMMAND_NAMES, ROOM_LOG_EVENT_NAMES, ROOM_START_SERVICE_MESSAGES } from "../shared/messages";
import type { Logger } from "../shared/logger";
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

// `/room start` 유스케이스 오케스트레이션 서비스
// 세션 생성, 브리핑 저장, 안내 메시지 전송을 한 트랜잭션 흐름으로 묶는다.
export class StartRoomSessionService {
  public constructor(
    private readonly roomSessionRepository: RoomSessionRepository,
    private readonly briefingRepository: BriefingRepository,
    private readonly logger: Logger
  ) {}

  // start 명령 전체 흐름:
  // 1) 입력 검증 2) 활성 세션 중복 검사 3) 준비 스레드 생성
  // 4) PREPARED 세션 생성 5) 브리핑 저장 6) 후속 액션 안내
  public async execute(input: StartRoomSessionInput, slackThreadPort: SlackThreadPort): Promise<StartRoomSessionResult> {
    // 사용자가 입력한 주제를 정규화(trim)하고 빈 값이면 예외를 발생시킨다.
    const topic = validateStartTopic(input.topic);

    // 같은 시작 채널에 이미 활성 세션이 있는지 조회한다.
    // DB 조회 결과를 기다려야 이후 중복 생성 여부를 정확히 판단할 수 있다.
    const activeSession = await this.roomSessionRepository.findActiveSessionByStartChannel(input.startChannelId);

    // 활성 세션이 있으면 start를 중단한다(ROOM_ALREADY_RUNNING).
    ensureNoActiveSession(activeSession);

    // start 채널에 준비 스레드(루트 메시지)를 먼저 만든다.
    // 이후 DB 세션에는 이 스레드 식별자(threadTs)를 연결해 추적한다.
    const thread = await slackThreadPort.createThread({
      channelId: input.startChannelId,
      text: ROOM_START_SERVICE_MESSAGES.preparedThreadText(topic)
    });

    // PREPARED 상태 세션을 DB에 영속화한다.
    // 요청자/워크스페이스/채널/스레드 정보를 함께 저장해 재시작 후에도 복구 가능하게 만든다.
    const session = await this.roomSessionRepository.createPreparedSession({
      topic,
      requestedByUserId: input.requestedByUserId,
      workspaceId: input.workspaceId,
      startChannelId: input.startChannelId,
      startThreadTs: thread.threadTs
    });

    // 브리핑 템플릿을 별도 테이블에 저장한다.
    // launch 전에 팀이 확인할 기준(goal/constraints/successCriteria)을 강제하기 위한 단계다.
    await this.briefingRepository.createBriefing({
      sessionId: session.id,
      goal: ROOM_START_SERVICE_MESSAGES.briefingGoal(topic),
      constraints: ROOM_START_SERVICE_MESSAGES.briefingConstraints,
      successCriteria: ROOM_START_SERVICE_MESSAGES.briefingSuccessCriteria
    });

    // 방금 만든 준비 스레드에 다음 행동 가이드를 남긴다.
    // 사용자가 `/room summary` 또는 `/room launch`로 자연스럽게 이어지도록 유도한다.
    await slackThreadPort.postMessageInThread({
      channelId: input.startChannelId,
      threadTs: thread.threadTs,
      text: ROOM_START_SERVICE_MESSAGES.briefingSavedNotice
    });

    // 완료 로그를 남겨 운영자가 request/session 단위로 추적할 수 있게 한다.
    this.logger.info(ROOM_LOG_EVENT_NAMES.roomStartCompleted, {
      sessionId: session.id,
      channelId: input.startChannelId,
      command: ROOM_COMMAND_NAMES.start
    });

    // 호출자(핸들러)에서 응답 메시지를 조립할 수 있도록 세션 정보를 반환한다.
    return { session };
  }
}

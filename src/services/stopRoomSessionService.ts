import { ROOM_COMMAND_NAMES, ROOM_LOG_EVENT_NAMES } from "../shared/messages";
import { ensureActiveSession } from "../validators/roomCommandValidator";
import type { Logger } from "../shared/logger";
import type { RoomModeLifecycleService, RoomSession, RoomSessionRepository } from "../shared/types";

// stop 유스케이스 입력 모델
export interface StopRoomSessionInput {
  startChannelId: string;
}

// stop 유스케이스 반환 모델
export interface StopRoomSessionResult {
  session: RoomSession;
}

// `/room stop` 유스케이스 오케스트레이션 서비스
// 활성 세션을 강제 종료(DECIDED)하고 planning 감시 모드를 OFF로 닫는다.
export class StopRoomSessionService {
  public constructor(
    private readonly roomSessionRepository: RoomSessionRepository,
    private readonly roomModeLifecycleService: RoomModeLifecycleService,
    private readonly logger: Logger
  ) {}

  // stop 흐름:
  // 1) 활성 세션 조회 2) DECIDED 전이 3) planning mode OFF(MANUAL) 4) 완료 로그 기록
  public async execute(input: StopRoomSessionInput): Promise<StopRoomSessionResult> {
    const activeSession = ensureActiveSession(
      await this.roomSessionRepository.findActiveSessionByStartChannel(input.startChannelId)
    );

    const decidedSession = await this.roomSessionRepository.updateSessionToDecided({
      sessionId: activeSession.id,
      decidedOption: null
    });

    await this.roomModeLifecycleService.turnOffPlanningRoomMode({
      session: decidedSession,
      offReason: "MANUAL"
    });

    this.logger.info(ROOM_LOG_EVENT_NAMES.roomStopCompleted, {
      sessionId: decidedSession.id,
      channelId: decidedSession.startChannelId,
      command: ROOM_COMMAND_NAMES.stop
    });

    return {
      session: decidedSession
    };
  }
}

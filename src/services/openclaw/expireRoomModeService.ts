import { ROOM_LOG_EVENT_NAMES } from "../../shared/messages";
import type { Logger } from "../../shared/logger";
import type {
  OpenClawEventOutboxRepository,
  RoomSessionRepository,
  RoomWatchTargetRepository
} from "../../shared/types";
import { createRoomModeOffEvent } from "./openclawRoomEventFactory";

// TTL OFF 서비스 의존성 모델
export interface ExpireRoomModeServiceDependencies {
  roomWatchTargetRepository: RoomWatchTargetRepository;
  roomSessionRepository: RoomSessionRepository;
  openClawEventOutboxRepository: OpenClawEventOutboxRepository;
  batchSize: number;
  logger: Logger;
}

// TTL이 지난 planning watch target을 OFF로 전환하고 ROOM_MODE_OFF(TTL)를 발행하는 서비스
export class ExpireRoomModeService {
  private readonly roomWatchTargetRepository: RoomWatchTargetRepository;
  private readonly roomSessionRepository: RoomSessionRepository;
  private readonly openClawEventOutboxRepository: OpenClawEventOutboxRepository;
  private readonly batchSize: number;
  private readonly logger: Logger;

  public constructor(dependencies: ExpireRoomModeServiceDependencies) {
    this.roomWatchTargetRepository = dependencies.roomWatchTargetRepository;
    this.roomSessionRepository = dependencies.roomSessionRepository;
    this.openClawEventOutboxRepository = dependencies.openClawEventOutboxRepository;
    this.batchSize = dependencies.batchSize;
    this.logger = dependencies.logger;
  }

  // 만료 대상을 순회하며 OFF 전환/이벤트 enqueue를 수행한다.
  public async execute(): Promise<void> {
    const nowIso = new Date().toISOString();
    const expiredTargets = await this.roomWatchTargetRepository.findExpiredOnWatchTargets(nowIso, this.batchSize);

    for (const target of expiredTargets) {
      const turnedOff = await this.roomWatchTargetRepository.turnOffWatchTarget({
        watchTargetId: target.id,
        offReason: "TTL",
        turnedOffAt: nowIso
      });

      if (!turnedOff) {
        this.logger.info(ROOM_LOG_EVENT_NAMES.openclawRoomModeOffSkipped, {
          sessionId: target.sessionId,
          channelId: target.channelId,
          threadTs: target.threadTs,
          offReason: "TTL"
        });
        continue;
      }

      const session = await this.roomSessionRepository.findById(turnedOff.sessionId);
      if (!session) {
        this.logger.warn(ROOM_LOG_EVENT_NAMES.openclawRoomModeOffSkipped, {
          sessionId: turnedOff.sessionId,
          channelId: turnedOff.channelId,
          threadTs: turnedOff.threadTs,
          offReason: "TTL",
          reason: "session_not_found"
        });
        continue;
      }

      await this.openClawEventOutboxRepository.enqueueEvent(
        createRoomModeOffEvent({
          session,
          watchTarget: turnedOff,
          offReason: "TTL",
          occurredAt: nowIso
        })
      );

      this.logger.info(ROOM_LOG_EVENT_NAMES.openclawTtlOffQueued, {
        sessionId: session.id,
        channelId: turnedOff.channelId,
        threadTs: turnedOff.threadTs,
        offReason: "TTL"
      });
    }
  }
}

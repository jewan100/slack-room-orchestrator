import { ROOM_LOG_EVENT_NAMES, ROOM_OPENCLAW_MESSAGES } from "../../shared/messages";
import type { Logger } from "../../shared/logger";
import type {
  OpenClawEventOutboxRepository,
  RoomModeLifecycleService,
  RoomWatchTargetRepository,
  TurnOffPlanningRoomModeInput,
  TurnOnPlanningRoomModeInput
} from "../../shared/types";
import { createRoomModeOffEvent, createRoomModeOnEvent } from "./openclawRoomEventFactory";

// room start/launch 시점의 OpenClaw 모드 ON/OFF를 오케스트레이션하는 서비스
export class ManageRoomModeService implements RoomModeLifecycleService {
  public constructor(
    private readonly roomWatchTargetRepository: RoomWatchTargetRepository,
    private readonly openClawEventOutboxRepository: OpenClawEventOutboxRepository,
    private readonly logger: Logger
  ) {}

  // start 성공 직후 planning watch target을 ON으로 만들고 ROOM_MODE_ON 이벤트를 enqueue한다.
  public async turnOnPlanningRoomMode(input: TurnOnPlanningRoomModeInput): Promise<void> {
    const now = new Date();
    const nowIso = now.toISOString();
    const ttlExpiresAt = new Date(now.getTime() + input.ttlMinutes * 60_000).toISOString();

    const watchTarget = await this.roomWatchTargetRepository.createWatchTargetOn({
      sessionId: input.session.id,
      channelId: input.session.startChannelId,
      threadTs: input.session.startThreadTs,
      mode: "PLANNING",
      ttlExpiresAt
    });

    await this.openClawEventOutboxRepository.enqueueEvent(
      createRoomModeOnEvent({
        session: input.session,
        watchTarget,
        occurredAt: nowIso
      })
    );

    this.logger.info(ROOM_LOG_EVENT_NAMES.openclawRoomModeOnCompleted, {
      sessionId: input.session.id,
      channelId: watchTarget.channelId,
      threadTs: watchTarget.threadTs,
      ttlExpiresAt
    });
  }

  // launch 성공 직후 planning watch target을 OFF로 전환하고 ROOM_MODE_OFF 이벤트를 enqueue한다.
  public async turnOffPlanningRoomMode(input: TurnOffPlanningRoomModeInput): Promise<void> {
    const watchTarget = await this.roomWatchTargetRepository.findOnWatchTargetBySessionId(input.session.id);
    if (!watchTarget) {
      this.logger.warn(ROOM_LOG_EVENT_NAMES.openclawRoomModeOffSkipped, {
        sessionId: input.session.id,
        channelId: input.session.startChannelId,
        threadTs: input.session.startThreadTs,
        offReason: "LAUNCH",
        reason: "watch_target_not_found"
      });
      throw new Error(ROOM_OPENCLAW_MESSAGES.missingPlanningWatchTargetForLaunchOff);
    }

    const nowIso = new Date().toISOString();
    const turnedOff = await this.roomWatchTargetRepository.turnOffWatchTarget({
      watchTargetId: watchTarget.id,
      offReason: "LAUNCH",
      turnedOffAt: nowIso
    });

    if (!turnedOff) {
      this.logger.warn(ROOM_LOG_EVENT_NAMES.openclawRoomModeOffSkipped, {
        sessionId: input.session.id,
        channelId: watchTarget.channelId,
        threadTs: watchTarget.threadTs,
        offReason: "LAUNCH",
        reason: "already_off"
      });
      throw new Error(ROOM_OPENCLAW_MESSAGES.missingPlanningWatchTargetForLaunchOff);
    }

    await this.openClawEventOutboxRepository.enqueueEvent(
      createRoomModeOffEvent({
        session: input.session,
        watchTarget: turnedOff,
        offReason: "LAUNCH",
        occurredAt: nowIso
      })
    );

    this.logger.info(ROOM_LOG_EVENT_NAMES.openclawRoomModeOffCompleted, {
      sessionId: input.session.id,
      channelId: turnedOff.channelId,
      threadTs: turnedOff.threadTs,
      offReason: "LAUNCH"
    });
  }
}

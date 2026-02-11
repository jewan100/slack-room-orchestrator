import type { RoomWatchTarget } from "../../shared/openclawSyncTypes";
import { ROOM_LOG_EVENT_NAMES } from "../../shared/messages";
import type { Logger } from "../../shared/logger";
import type {
  OpenClawEventOutboxRepository,
  RoomSessionRepository,
  RoomWatchTargetRepository
} from "../../shared/types";
import { createRoomQuestionTriggerEvent } from "./openclawRoomEventFactory";

// question 트리거 서비스 의존성 모델
export interface EmitQuestionTriggerServiceDependencies {
  roomWatchTargetRepository: RoomWatchTargetRepository;
  roomSessionRepository: RoomSessionRepository;
  openClawEventOutboxRepository: OpenClawEventOutboxRepository;
  questionIntervalMinutes: number;
  batchSize: number;
  logger: Logger;
}

// 일정 주기마다 question trigger를 생성하는 서비스
export class EmitQuestionTriggerService {
  private readonly roomWatchTargetRepository: RoomWatchTargetRepository;
  private readonly roomSessionRepository: RoomSessionRepository;
  private readonly openClawEventOutboxRepository: OpenClawEventOutboxRepository;
  private readonly questionIntervalMinutes: number;
  private readonly batchSize: number;
  private readonly logger: Logger;

  public constructor(dependencies: EmitQuestionTriggerServiceDependencies) {
    this.roomWatchTargetRepository = dependencies.roomWatchTargetRepository;
    this.roomSessionRepository = dependencies.roomSessionRepository;
    this.openClawEventOutboxRepository = dependencies.openClawEventOutboxRepository;
    this.questionIntervalMinutes = dependencies.questionIntervalMinutes;
    this.batchSize = dependencies.batchSize;
    this.logger = dependencies.logger;
  }

  // question 트리거 due 조건을 만족하는 watch target을 선점한다.
  private async claimDueTargets(nowIso: string): Promise<RoomWatchTarget[]> {
    const cutoffIso = new Date(Date.now() - this.questionIntervalMinutes * 60_000).toISOString();
    const dueTargets = await this.roomWatchTargetRepository.findQuestionTriggerDueWatchTargets(cutoffIso, this.batchSize);
    const claimedTargets: RoomWatchTarget[] = [];

    for (const target of dueTargets) {
      const claimed = await this.roomWatchTargetRepository.claimQuestionTriggerIfDue({
        watchTargetId: target.id,
        dueBefore: cutoffIso,
        triggeredAt: nowIso
      });

      if (claimed) {
        claimedTargets.push(claimed);
      }
    }

    return claimedTargets;
  }

  // 선점된 대상에 대해 ROOM_QUESTION_TRIGGER 이벤트를 enqueue한다.
  private async enqueueQuestionTriggers(claimedTargets: RoomWatchTarget[], nowIso: string): Promise<void> {
    for (const claimed of claimedTargets) {
      const session = await this.roomSessionRepository.findById(claimed.sessionId);
      if (!session) {
        this.logger.warn(ROOM_LOG_EVENT_NAMES.openclawRoomModeOffSkipped, {
          sessionId: claimed.sessionId,
          channelId: claimed.channelId,
          threadTs: claimed.threadTs,
          reason: "session_not_found"
        });
        continue;
      }

      await this.openClawEventOutboxRepository.enqueueEvent(
        createRoomQuestionTriggerEvent({
          session,
          watchTarget: claimed,
          occurredAt: nowIso
        })
      );

      this.logger.info(ROOM_LOG_EVENT_NAMES.openclawQuestionTriggerQueued, {
        sessionId: session.id,
        channelId: claimed.channelId,
        threadTs: claimed.threadTs,
        messageCount: claimed.messageCount,
        questionIntervalMinutes: this.questionIntervalMinutes
      });
    }
  }

  // due 대상만 선점해 ROOM_QUESTION_TRIGGER 이벤트를 enqueue한다.
  public async execute(): Promise<void> {
    const nowIso = new Date().toISOString();
    const claimedTargets = await this.claimDueTargets(nowIso);
    await this.enqueueQuestionTriggers(claimedTargets, nowIso);
  }
}

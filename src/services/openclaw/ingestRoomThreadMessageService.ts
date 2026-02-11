import type { RoomWatchTarget } from "../../shared/openclawSyncTypes";
import { ROOM_LOG_EVENT_NAMES } from "../../shared/messages";
import type { Logger } from "../../shared/logger";
import type {
  IngestRoomThreadMessageInput,
  OpenClawEventOutboxRepository,
  RoomSessionRepository,
  RoomThreadMessageIngestService,
  RoomThreadMessageRepository,
  RoomWatchTargetRepository
} from "../../shared/types";
import { createRoomSummaryTriggerEvent } from "./openclawRoomEventFactory";

// thread 메시지 수집 서비스 의존성 모델
export interface IngestRoomThreadMessageServiceDependencies {
  roomWatchTargetRepository: RoomWatchTargetRepository;
  roomThreadMessageRepository: RoomThreadMessageRepository;
  roomSessionRepository: RoomSessionRepository;
  openClawEventOutboxRepository: OpenClawEventOutboxRepository;
  summaryMessageThreshold: number;
  logger: Logger;
}

// 감시 대상 thread 메시지를 수집하고 summary 트리거를 outbox로 발행하는 서비스
export class IngestRoomThreadMessageService implements RoomThreadMessageIngestService {
  private readonly roomWatchTargetRepository: RoomWatchTargetRepository;
  private readonly roomThreadMessageRepository: RoomThreadMessageRepository;
  private readonly roomSessionRepository: RoomSessionRepository;
  private readonly openClawEventOutboxRepository: OpenClawEventOutboxRepository;
  private readonly summaryMessageThreshold: number;
  private readonly logger: Logger;

  public constructor(dependencies: IngestRoomThreadMessageServiceDependencies) {
    this.roomWatchTargetRepository = dependencies.roomWatchTargetRepository;
    this.roomThreadMessageRepository = dependencies.roomThreadMessageRepository;
    this.roomSessionRepository = dependencies.roomSessionRepository;
    this.openClawEventOutboxRepository = dependencies.openClawEventOutboxRepository;
    this.summaryMessageThreshold = dependencies.summaryMessageThreshold;
    this.logger = dependencies.logger;
  }

  // 감시 대상 thread인지 확인한다.
  private async findWatchTargetOrLog(input: IngestRoomThreadMessageInput): Promise<RoomWatchTarget | null> {
    const watchTarget = await this.roomWatchTargetRepository.findOnWatchTargetByChannelAndThread(
      input.channelId,
      input.threadTs
    );

    if (!watchTarget) {
      this.logger.debug(ROOM_LOG_EVENT_NAMES.openclawThreadMessageIgnored, {
        channelId: input.channelId,
        threadTs: input.threadTs,
        reason: "watch_target_not_found"
      });
    }

    return watchTarget;
  }

  // 신규 메시지면 메타데이터를 저장하고 message_count를 증가시킨다.
  private async persistMessageIfNew(
    input: IngestRoomThreadMessageInput,
    watchTarget: RoomWatchTarget
  ): Promise<RoomWatchTarget | null> {
    const inserted = await this.roomThreadMessageRepository.createMessageMetadataIfAbsent({
      watchTargetId: watchTarget.id,
      sessionId: watchTarget.sessionId,
      channelId: input.channelId,
      threadTs: input.threadTs,
      messageTs: input.messageTs,
      userId: input.userId,
      subtype: input.subtype,
      isBot: input.isBot,
      eventTs: input.eventTs
    });

    if (!inserted) {
      this.logger.debug(ROOM_LOG_EVENT_NAMES.openclawThreadMessageIgnored, {
        sessionId: watchTarget.sessionId,
        channelId: input.channelId,
        threadTs: input.threadTs,
        messageTs: input.messageTs,
        reason: "duplicate_message"
      });
      return null;
    }

    return this.roomWatchTargetRepository.incrementMessageCount(watchTarget.id);
  }

  // summary 임계치를 충족하면 ROOM_SUMMARY_TRIGGER 이벤트를 outbox에 적재한다.
  private async enqueueSummaryTriggerIfNeeded(updatedWatchTarget: RoomWatchTarget): Promise<void> {
    const claimedSummaryTrigger = await this.roomWatchTargetRepository.claimSummaryTriggerIfReached(
      updatedWatchTarget.id,
      this.summaryMessageThreshold,
      new Date().toISOString()
    );

    if (!claimedSummaryTrigger) {
      return;
    }

    const session = await this.roomSessionRepository.findById(claimedSummaryTrigger.sessionId);
    if (!session) {
      this.logger.warn(ROOM_LOG_EVENT_NAMES.openclawThreadMessageIgnored, {
        sessionId: claimedSummaryTrigger.sessionId,
        channelId: claimedSummaryTrigger.channelId,
        threadTs: claimedSummaryTrigger.threadTs,
        reason: "session_not_found"
      });
      return;
    }

    await this.openClawEventOutboxRepository.enqueueEvent(
      createRoomSummaryTriggerEvent({
        session,
        watchTarget: claimedSummaryTrigger,
        occurredAt: new Date().toISOString()
      })
    );

    this.logger.info(ROOM_LOG_EVENT_NAMES.openclawSummaryTriggerQueued, {
      sessionId: session.id,
      channelId: claimedSummaryTrigger.channelId,
      threadTs: claimedSummaryTrigger.threadTs,
      messageCount: claimedSummaryTrigger.messageCount,
      threshold: this.summaryMessageThreshold
    });
  }

  // 메시지 1건을 멱등 저장하고, 임계치가 충족되면 summary trigger 이벤트를 enqueue한다.
  public async execute(input: IngestRoomThreadMessageInput): Promise<void> {
    const watchTarget = await this.findWatchTargetOrLog(input);
    if (!watchTarget) {
      return;
    }

    const updatedWatchTarget = await this.persistMessageIfNew(input, watchTarget);
    if (!updatedWatchTarget) {
      return;
    }

    this.logger.info(ROOM_LOG_EVENT_NAMES.openclawThreadMessageIngested, {
      sessionId: updatedWatchTarget.sessionId,
      channelId: updatedWatchTarget.channelId,
      threadTs: updatedWatchTarget.threadTs,
      messageCount: updatedWatchTarget.messageCount,
      messageTs: input.messageTs
    });

    await this.enqueueSummaryTriggerIfNeeded(updatedWatchTarget);
  }
}

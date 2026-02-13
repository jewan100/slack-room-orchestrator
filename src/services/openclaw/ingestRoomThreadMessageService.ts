import type { RoomWatchTarget } from "../../shared/openclawSyncTypes";
import { ROOM_LOG_EVENT_NAMES } from "../../shared/messages";
import type { Logger } from "../../shared/logger";
import type {
  IngestRoomThreadMessageInput,
  RoomThreadMessageIngestResult,
  RoomThreadMessageIngestService,
  RoomThreadMessageRepository,
  RoomWatchTargetRepository
} from "../../shared/types";

// thread 메시지 수집 서비스 의존성 모델
export interface IngestRoomThreadMessageServiceDependencies {
  roomWatchTargetRepository: RoomWatchTargetRepository;
  roomThreadMessageRepository: RoomThreadMessageRepository;
  roomModeTtlMinutes: number;
  logger: Logger;
}

// 감시 대상 thread 메시지를 수집하고 message_count를 누적하는 서비스
export class IngestRoomThreadMessageService implements RoomThreadMessageIngestService {
  private readonly roomWatchTargetRepository: RoomWatchTargetRepository;
  private readonly roomThreadMessageRepository: RoomThreadMessageRepository;
  private readonly roomModeTtlMinutes: number;
  private readonly logger: Logger;

  public constructor(dependencies: IngestRoomThreadMessageServiceDependencies) {
    this.roomWatchTargetRepository = dependencies.roomWatchTargetRepository;
    this.roomThreadMessageRepository = dependencies.roomThreadMessageRepository;
    this.roomModeTtlMinutes = dependencies.roomModeTtlMinutes;
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

    const ttlExpiresAt = new Date(Date.now() + this.roomModeTtlMinutes * 60_000).toISOString();
    return this.roomWatchTargetRepository.incrementMessageCount(watchTarget.id, ttlExpiresAt);
  }

  // 메시지 1건을 멱등 저장하고 message_count를 누적한다.
  public async execute(input: IngestRoomThreadMessageInput): Promise<RoomThreadMessageIngestResult> {
    const watchTarget = await this.findWatchTargetOrLog(input);
    if (!watchTarget) {
      return { kind: "IGNORED_NOT_WATCH" };
    }

    const updatedWatchTarget = await this.persistMessageIfNew(input, watchTarget);
    if (!updatedWatchTarget) {
      return {
        kind: "IGNORED_DUPLICATE",
        sessionId: watchTarget.sessionId
      };
    }

    this.logger.info(ROOM_LOG_EVENT_NAMES.openclawThreadMessageIngested, {
      sessionId: updatedWatchTarget.sessionId,
      channelId: updatedWatchTarget.channelId,
      threadTs: updatedWatchTarget.threadTs,
      messageCount: updatedWatchTarget.messageCount,
      messageTs: input.messageTs
    });

    return {
      kind: "INGESTED",
      sessionId: updatedWatchTarget.sessionId,
      channelId: updatedWatchTarget.channelId,
      threadTs: updatedWatchTarget.threadTs,
      messageTs: input.messageTs,
      messageCount: updatedWatchTarget.messageCount
    };
  }
}

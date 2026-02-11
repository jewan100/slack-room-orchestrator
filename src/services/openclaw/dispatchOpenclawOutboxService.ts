import { ROOM_LOG_EVENT_NAMES, ROOM_OPENCLAW_MESSAGES } from "../../shared/messages";
import type { Logger } from "../../shared/logger";
import type {
  OpenClawEventOutboxRepository,
  OpenClawEventSink,
  OpenClawPendingOutboxEvent
} from "../../shared/types";

// outbox 디스패치 서비스 의존성 모델
export interface DispatchOpenclawOutboxServiceDependencies {
  openClawEventOutboxRepository: OpenClawEventOutboxRepository;
  openClawEventSink: OpenClawEventSink;
  retryDelayMs: number;
  batchSize: number;
  logger: Logger;
}

// unknown 예외를 로그용 문자열로 변환한다.
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return ROOM_OPENCLAW_MESSAGES.unknownDispatchError;
}

// pending outbox를 NDJSON sink로 디스패치하는 서비스
export class DispatchOpenclawOutboxService {
  private readonly openClawEventOutboxRepository: OpenClawEventOutboxRepository;
  private readonly openClawEventSink: OpenClawEventSink;
  private readonly retryDelayMs: number;
  private readonly batchSize: number;
  private readonly logger: Logger;

  public constructor(dependencies: DispatchOpenclawOutboxServiceDependencies) {
    this.openClawEventOutboxRepository = dependencies.openClawEventOutboxRepository;
    this.openClawEventSink = dependencies.openClawEventSink;
    this.retryDelayMs = dependencies.retryDelayMs;
    this.batchSize = dependencies.batchSize;
    this.logger = dependencies.logger;
  }

  // outbox 이벤트 1건을 디스패치/재시도 처리한다.
  private async dispatchSingleEvent(item: OpenClawPendingOutboxEvent, nowIso: string): Promise<void> {
    try {
      await this.openClawEventSink.appendEvent(item.payload);
      await this.openClawEventOutboxRepository.markDispatched(item.id, nowIso);

      this.logger.info(ROOM_LOG_EVENT_NAMES.openclawOutboxDispatched, {
        eventId: item.eventId,
        eventType: item.eventType,
        retryCount: item.retryCount
      });
    } catch (error) {
      const errorMessage = extractErrorMessage(error);
      const retryAt = new Date(Date.now() + this.retryDelayMs).toISOString();

      await this.openClawEventOutboxRepository.markRetry({
        outboxId: item.id,
        errorMessage,
        retryAt
      });

      this.logger.warn(ROOM_LOG_EVENT_NAMES.openclawOutboxRetryScheduled, {
        eventId: item.eventId,
        eventType: item.eventType,
        retryCount: item.retryCount + 1,
        retryAt,
        errorMessage
      });
    }
  }

  // 현재 시각 기준으로 dispatch 가능한 pending 이벤트를 batch 단위로 처리한다.
  public async execute(): Promise<void> {
    const nowIso = new Date().toISOString();
    const items = await this.openClawEventOutboxRepository.claimPendingEvents(nowIso, this.batchSize);

    for (const item of items) {
      await this.dispatchSingleEvent(item, nowIso);
    }
  }
}

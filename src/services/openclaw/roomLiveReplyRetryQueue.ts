import { ROOM_LOG_EVENT_NAMES, ROOM_OPENCLAW_MESSAGES } from "../../shared/messages";
import type { Logger } from "../../shared/logger";
import type { SlackThreadPort } from "../../shared/types";

// 실시간 답변 재시도 큐에서 관리하는 단일 작업 모델
export interface RoomLiveReplyRetryTask {
  requestId: string;
  sessionId: string;
  channelId: string;
  threadTs: string;
  messageTs: string;
  userId: string | null;
  userText: string;
  slackThreadPort: SlackThreadPort;
}

// 재시도 큐 의존성 모델
export interface RoomLiveReplyRetryQueueDependencies {
  maxRetries: number;
  retryDelayMs: number;
  logger: Logger;
  processTask: (task: RoomLiveReplyRetryTask) => Promise<void>;
  onFirstFailure: (task: RoomLiveReplyRetryTask, error: unknown) => Promise<void>;
}

// 큐 내부에서 추적하는 작업 상태 모델
interface RoomLiveReplyTaskState {
  task: RoomLiveReplyRetryTask;
  retryCount: number;
  noticeSent: boolean;
  timeoutHandle: NodeJS.Timeout | null;
}

// unknown 오류를 운영 로그용 문자열로 정규화한다.
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return ROOM_OPENCLAW_MESSAGES.unknownLiveReplyError;
}

// 메시지 단위 dedupe에 사용하는 고유 키를 생성한다.
function buildMessageKey(task: RoomLiveReplyRetryTask): string {
  return `${task.channelId}:${task.threadTs}:${task.messageTs}`;
}

// session 단위 single-flight + 메시지 단위 dedupe를 수행하는 메모리 재시도 큐
export class RoomLiveReplyRetryQueue {
  private readonly tasksByKey = new Map<string, RoomLiveReplyTaskState>();
  private readonly sessionFlights = new Map<string, Promise<void>>();

  public constructor(private readonly dependencies: RoomLiveReplyRetryQueueDependencies) {}

  // 신규 메시지 작업을 큐에 등록하고 즉시 1차 실행을 시도한다.
  public async enqueue(task: RoomLiveReplyRetryTask): Promise<void> {
    const messageKey = buildMessageKey(task);
    if (this.tasksByKey.has(messageKey)) {
      return;
    }

    this.tasksByKey.set(messageKey, {
      task,
      retryCount: 0,
      noticeSent: false,
      timeoutHandle: null
    });

    await this.runWithSessionSingleFlight(messageKey);
  }

  // 앱 종료 시 남은 타이머를 정리하고 진행 중인 flight 완료를 기다린다.
  public async stop(): Promise<void> {
    for (const state of this.tasksByKey.values()) {
      if (state.timeoutHandle) {
        clearTimeout(state.timeoutHandle);
      }
    }

    this.tasksByKey.clear();
    const pendingFlights = Array.from(this.sessionFlights.values());
    await Promise.allSettled(pendingFlights);
    this.sessionFlights.clear();
  }

  // 같은 세션의 작업이 직렬 처리되도록 session 단위 single-flight를 적용한다.
  private async runWithSessionSingleFlight(messageKey: string): Promise<void> {
    const state = this.tasksByKey.get(messageKey);
    if (!state) {
      return;
    }

    const previousFlight = this.sessionFlights.get(state.task.sessionId) ?? Promise.resolve();
    const currentFlight = previousFlight
      .catch(() => {
        return;
      })
      .then(async () => {
        await this.processTask(messageKey);
      })
      .finally(() => {
        const registered = this.sessionFlights.get(state.task.sessionId);
        if (registered === currentFlight) {
          this.sessionFlights.delete(state.task.sessionId);
        }
      });

    this.sessionFlights.set(state.task.sessionId, currentFlight);
    await currentFlight;
  }

  // 작업 실행 실패 시 안내 1회 + 지연 재시도를 수행한다.
  private async processTask(messageKey: string): Promise<void> {
    const state = this.tasksByKey.get(messageKey);
    if (!state) {
      return;
    }

    try {
      await this.dependencies.processTask(state.task);
      this.cleanupTask(messageKey);
    } catch (error) {
      await this.handleFailure(messageKey, error);
    }
  }

  // 실패 처리와 재시도 스케줄링을 수행한다.
  private async handleFailure(messageKey: string, error: unknown): Promise<void> {
    const state = this.tasksByKey.get(messageKey);
    if (!state) {
      return;
    }

    if (!state.noticeSent) {
      await this.dependencies.onFirstFailure(state.task, error);
      state.noticeSent = true;
    }

    if (state.retryCount >= this.dependencies.maxRetries) {
      this.dependencies.logger.error(ROOM_LOG_EVENT_NAMES.openclawLiveReplyFailed, {
        requestId: state.task.requestId,
        sessionId: state.task.sessionId,
        channelId: state.task.channelId,
        threadTs: state.task.threadTs,
        messageTs: state.task.messageTs,
        errorMessage: extractErrorMessage(error),
        retryCount: state.retryCount
      });
      this.cleanupTask(messageKey);
      return;
    }

    state.retryCount += 1;
    this.dependencies.logger.warn(ROOM_LOG_EVENT_NAMES.openclawLiveReplyRetryScheduled, {
      requestId: state.task.requestId,
      sessionId: state.task.sessionId,
      channelId: state.task.channelId,
      threadTs: state.task.threadTs,
      messageTs: state.task.messageTs,
      retryCount: state.retryCount,
      retryDelayMs: this.dependencies.retryDelayMs,
      errorMessage: extractErrorMessage(error)
    });

    state.timeoutHandle = setTimeout(() => {
      void this.runWithSessionSingleFlight(messageKey);
    }, this.dependencies.retryDelayMs);
  }

  // 작업 완료/중단 시 메모리 상태와 타이머를 정리한다.
  private cleanupTask(messageKey: string): void {
    const state = this.tasksByKey.get(messageKey);
    if (!state) {
      return;
    }

    if (state.timeoutHandle) {
      clearTimeout(state.timeoutHandle);
    }

    this.tasksByKey.delete(messageKey);
  }
}

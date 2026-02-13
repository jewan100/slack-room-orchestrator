import { ROOM_LOG_EVENT_NAMES, ROOM_OPENCLAW_MESSAGES, ROOM_OPENCLAW_SLACK_MESSAGES } from "../../shared/messages";
import type { Logger } from "../../shared/logger";
import type {
  OpenClawChatClient,
  RoomLiveReplyInput,
  RoomLiveReplyService,
  RoomWatchTargetRepository
} from "../../shared/types";
import { RoomLiveReplyRetryQueue, type RoomLiveReplyRetryTask } from "./roomLiveReplyRetryQueue";

// 실시간 답변 서비스 의존성 모델
export interface LiveReplyToRoomThreadServiceDependencies {
  roomWatchTargetRepository: RoomWatchTargetRepository;
  openClawChatClient: OpenClawChatClient;
  logger: Logger;
  maxRetries: number;
  retryDelayMs: number;
  systemMessage: string;
}

// unknown 오류를 운영 로그용 문자열로 정규화한다.
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return ROOM_OPENCLAW_MESSAGES.unknownLiveReplyError;
}

// sessionKey를 room 세션 기준으로 고정한다.
function buildOpenClawSessionKey(sessionId: string): string {
  return `room:${sessionId}`;
}

// 실시간 수집된 스레드 메시지에 OpenClaw 답변을 생성/전송하는 서비스
export class LiveReplyToRoomThreadService implements RoomLiveReplyService {
  private readonly retryQueue: RoomLiveReplyRetryQueue;

  public constructor(private readonly dependencies: LiveReplyToRoomThreadServiceDependencies) {
    this.retryQueue = new RoomLiveReplyRetryQueue({
      maxRetries: dependencies.maxRetries,
      retryDelayMs: dependencies.retryDelayMs,
      logger: dependencies.logger,
      processTask: async (task) => {
        await this.processTask(task);
      },
      onFirstFailure: async (task, error) => {
        await this.postFailureNotice(task, error);
      }
    });
  }

  // 신규 스레드 메시지를 재시도 큐에 등록한다.
  public async execute(input: RoomLiveReplyInput): Promise<void> {
    await this.retryQueue.enqueue({
      requestId: input.requestId,
      sessionId: input.sessionId,
      channelId: input.channelId,
      threadTs: input.threadTs,
      messageTs: input.messageTs,
      userId: input.userId,
      userText: input.userText,
      slackThreadPort: input.slackThreadPort
    });
  }

  // 앱 종료 시 남은 타이머와 실행 중 작업을 정리한다.
  public async stop(): Promise<void> {
    await this.retryQueue.stop();
  }

  // 단일 메시지에 대해 OpenClaw 응답을 생성하고 Slack thread에 게시한다.
  private async processTask(task: RoomLiveReplyRetryTask): Promise<void> {
    const startedAt = Date.now();
    const isActiveBeforeReply = await this.isPlanningModeOn(task);
    if (!isActiveBeforeReply) {
      this.dependencies.logger.info(ROOM_LOG_EVENT_NAMES.openclawLiveReplySkipped, {
        requestId: task.requestId,
        sessionId: task.sessionId,
        channelId: task.channelId,
        threadTs: task.threadTs,
        messageTs: task.messageTs,
        reason: "watch_target_off_before_reply"
      });
      return;
    }

    const assistantText = await this.dependencies.openClawChatClient.complete({
      sessionKey: buildOpenClawSessionKey(task.sessionId),
      systemMessage: this.dependencies.systemMessage,
      userMessage: task.userText,
      userId: task.userId
    });

    const isActiveBeforePost = await this.isPlanningModeOn(task);
    if (!isActiveBeforePost) {
      this.dependencies.logger.info(ROOM_LOG_EVENT_NAMES.openclawLiveReplySkipped, {
        requestId: task.requestId,
        sessionId: task.sessionId,
        channelId: task.channelId,
        threadTs: task.threadTs,
        messageTs: task.messageTs,
        reason: "watch_target_off_before_post"
      });
      return;
    }

    await task.slackThreadPort.postMessageInThread({
      channelId: task.channelId,
      threadTs: task.threadTs,
      text: assistantText
    });

    this.dependencies.logger.info(ROOM_LOG_EVENT_NAMES.openclawLiveReplyCompleted, {
      requestId: task.requestId,
      sessionId: task.sessionId,
      channelId: task.channelId,
      threadTs: task.threadTs,
      messageTs: task.messageTs,
      elapsedMs: Date.now() - startedAt
    });
  }

  // 1차 실패 시 사용자 안내를 thread에 1회만 게시한다.
  private async postFailureNotice(task: RoomLiveReplyRetryTask, error: unknown): Promise<void> {
    try {
      await task.slackThreadPort.postMessageInThread({
        channelId: task.channelId,
        threadTs: task.threadTs,
        text: ROOM_OPENCLAW_SLACK_MESSAGES.liveReplyFailureNotice
      });
    } catch (noticeError) {
      this.dependencies.logger.warn(ROOM_LOG_EVENT_NAMES.openclawLiveReplyFailed, {
        requestId: task.requestId,
        sessionId: task.sessionId,
        channelId: task.channelId,
        threadTs: task.threadTs,
        messageTs: task.messageTs,
        errorMessage: extractErrorMessage(noticeError),
        reason: "failure_notice_post_failed"
      });
    }

    this.dependencies.logger.warn(ROOM_LOG_EVENT_NAMES.openclawLiveReplyFailed, {
      requestId: task.requestId,
      sessionId: task.sessionId,
      channelId: task.channelId,
      threadTs: task.threadTs,
      messageTs: task.messageTs,
      errorMessage: extractErrorMessage(error),
      reason: "live_reply_first_failure"
    });
  }

  // 현재 thread가 여전히 planning 감시 대상으로 ON 상태인지 확인한다.
  private async isPlanningModeOn(task: RoomLiveReplyRetryTask): Promise<boolean> {
    const watchTarget = await this.dependencies.roomWatchTargetRepository.findOnWatchTargetByChannelAndThread(
      task.channelId,
      task.threadTs
    );

    if (!watchTarget) {
      return false;
    }

    return watchTarget.sessionId === task.sessionId;
  }
}

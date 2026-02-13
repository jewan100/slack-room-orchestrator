import { ROOM_LOG_EVENT_NAMES, ROOM_OPENCLAW_MESSAGES } from "../../../shared/messages";
import type { Logger } from "../../../shared/logger";
import type {
  RoomLiveReplyService,
  RoomThreadMessageIngestResult,
  RoomThreadMessageIngestService,
  SlackThreadPort
} from "../../../shared/types";

// Slack message 이벤트에서 이 프로젝트가 사용하는 필드 집합
interface SlackMessageEventPayload {
  channel?: string;
  thread_ts?: string;
  ts?: string;
  user?: string;
  text?: string;
  subtype?: string;
  bot_id?: string;
  event_ts?: string;
}

// 필수 스레드 식별자가 보장된 payload 모델
interface SlackThreadMessageEventPayload extends SlackMessageEventPayload {
  channel: string;
  thread_ts: string;
  ts: string;
}

// room thread 이벤트 핸들러 의존성 모델
export interface RoomThreadEventHandlerDependencies {
  roomThreadMessageIngestService: RoomThreadMessageIngestService;
  roomLiveReplyService: RoomLiveReplyService;
  logger: Logger;
}

// room thread 핸들러 입력 모델
export interface RoomThreadEventHandlerInput {
  requestId: string;
  event: SlackMessageEventPayload;
  slackThreadPort: SlackThreadPort;
}

// 메시지 이벤트가 봇 발화인지 판별한다.
function isBotMessage(event: SlackMessageEventPayload): boolean {
  if (typeof event.bot_id === "string" && event.bot_id.length > 0) {
    return true;
  }

  return event.subtype === "bot_message";
}

// 필수 스레드 식별자(channel/thread/message ts)가 있는지 검증한다.
function hasRequiredThreadIdentifiers(event: SlackMessageEventPayload): event is SlackThreadMessageEventPayload {
  return (
    typeof event.channel === "string" &&
    event.channel.length > 0 &&
    typeof event.thread_ts === "string" &&
    event.thread_ts.length > 0 &&
    typeof event.ts === "string" &&
    event.ts.length > 0
  );
}

// 사용자 텍스트가 실시간 답변 생성에 사용할 수 있는지 확인한다.
function resolveUserText(event: SlackMessageEventPayload): string | null {
  if (typeof event.text !== "string") {
    return null;
  }

  const trimmed = event.text.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed;
}

// 무시된 이벤트 로그를 공통 포맷으로 기록한다.
function logIgnoredMessage(input: {
  logger: Logger;
  requestId: string;
  reason: string;
  channelId?: string;
  threadTs?: string;
  messageTs?: string;
  subtype?: string;
  message?: string;
}): void {
  input.logger.debug(ROOM_LOG_EVENT_NAMES.openclawThreadMessageIgnored, {
    requestId: input.requestId,
    reason: input.reason,
    channelId: input.channelId,
    threadTs: input.threadTs,
    messageTs: input.messageTs,
    subtype: input.subtype,
    message: input.message
  });
}

// subtype/bot 메시지 필터를 적용한다.
function shouldIgnoreThreadMessage(input: {
  event: SlackThreadMessageEventPayload;
  requestId: string;
  logger: Logger;
}): boolean {
  if (typeof input.event.subtype === "string" && input.event.subtype.length > 0) {
    logIgnoredMessage({
      logger: input.logger,
      requestId: input.requestId,
      reason: "subtype_message",
      channelId: input.event.channel,
      threadTs: input.event.thread_ts,
      messageTs: input.event.ts,
      subtype: input.event.subtype
    });
    return true;
  }

  if (!isBotMessage(input.event)) {
    return false;
  }

  logIgnoredMessage({
    logger: input.logger,
    requestId: input.requestId,
    reason: "bot_message",
    channelId: input.event.channel,
    threadTs: input.event.thread_ts,
    messageTs: input.event.ts
  });
  return true;
}

// 수집 결과가 실시간 답변 대상인지 확인한다.
function isIngestedResult(
  result: RoomThreadMessageIngestResult
): result is Extract<RoomThreadMessageIngestResult, { kind: "INGESTED" }> {
  return result.kind === "INGESTED";
}

// 스레드 이벤트 처리 완료 로그를 공통 포맷으로 기록한다.
function logThreadEventCompletion(input: {
  dependencies: RoomThreadEventHandlerDependencies;
  requestId: string;
  elapsedMs: number;
  result: string;
  event?: SlackThreadMessageEventPayload;
  sessionId?: string;
}): void {
  input.dependencies.logger.info(ROOM_LOG_EVENT_NAMES.openclawThreadEventCompleted, {
    requestId: input.requestId,
    channelId: input.event?.channel,
    threadTs: input.event?.thread_ts,
    messageTs: input.event?.ts,
    sessionId: input.sessionId,
    result: input.result,
    elapsedMs: input.elapsedMs
  });
}

// thread 식별자 누락 이벤트를 처리하고 종료 여부를 반환한다.
function handleMissingThreadIdentifiers(input: {
  dependencies: RoomThreadEventHandlerDependencies;
  requestId: string;
  event: SlackMessageEventPayload;
  startedAt: number;
}): boolean {
  if (hasRequiredThreadIdentifiers(input.event)) {
    return false;
  }

  logIgnoredMessage({
    logger: input.dependencies.logger,
    requestId: input.requestId,
    reason: "missing_thread_identifiers",
    message: ROOM_OPENCLAW_MESSAGES.missingThreadIdentifiers
  });
  logThreadEventCompletion({
    dependencies: input.dependencies,
    requestId: input.requestId,
    result: "ignored_missing_thread_identifiers",
    elapsedMs: Date.now() - input.startedAt
  });
  return true;
}

// subtype/bot 필터로 무시되는 이벤트를 처리하고 종료 여부를 반환한다.
function handleIgnoredThreadMessage(input: {
  dependencies: RoomThreadEventHandlerDependencies;
  requestId: string;
  event: SlackThreadMessageEventPayload;
  startedAt: number;
}): boolean {
  if (!shouldIgnoreThreadMessage({ event: input.event, requestId: input.requestId, logger: input.dependencies.logger })) {
    return false;
  }

  logThreadEventCompletion({
    dependencies: input.dependencies,
    requestId: input.requestId,
    event: input.event,
    result: "ignored_subtype_or_bot",
    elapsedMs: Date.now() - input.startedAt
  });
  return true;
}

// INGESTED 결과를 live reply 서비스 호출로 연결한다.
async function executeLiveReply(input: {
  dependencies: RoomThreadEventHandlerDependencies;
  requestId: string;
  event: SlackThreadMessageEventPayload;
  ingestResult: Extract<RoomThreadMessageIngestResult, { kind: "INGESTED" }>;
  slackThreadPort: SlackThreadPort;
}): Promise<void> {
  const userText = resolveUserText(input.event);
  if (!userText) {
    input.dependencies.logger.info(ROOM_LOG_EVENT_NAMES.openclawLiveReplySkipped, {
      requestId: input.requestId,
      sessionId: input.ingestResult.sessionId,
      channelId: input.event.channel,
      threadTs: input.event.thread_ts,
      messageTs: input.event.ts,
      reason: "missing_message_text",
      message: ROOM_OPENCLAW_MESSAGES.missingMessageText
    });
    return;
  }

  await input.dependencies.roomLiveReplyService.execute({
    requestId: input.requestId,
    sessionId: input.ingestResult.sessionId,
    channelId: input.ingestResult.channelId,
    threadTs: input.ingestResult.threadTs,
    messageTs: input.ingestResult.messageTs,
    userId: typeof input.event.user === "string" ? input.event.user : null,
    userText,
    slackThreadPort: input.slackThreadPort
  });
}

// Slack message 이벤트를 감시 대상 저장소 흐름으로 연결하는 inbound 핸들러를 생성한다.
export function createRoomThreadEventHandler(
  dependencies: RoomThreadEventHandlerDependencies
): (input: RoomThreadEventHandlerInput) => Promise<void> {
  return async (input: RoomThreadEventHandlerInput): Promise<void> => {
    const startedAt = Date.now();
    if (handleMissingThreadIdentifiers({ dependencies, requestId: input.requestId, event: input.event, startedAt })) {
      return;
    }
    const threadEvent = input.event as SlackThreadMessageEventPayload;

    if (handleIgnoredThreadMessage({ dependencies, requestId: input.requestId, event: threadEvent, startedAt })) {
      return;
    }

    const ingestResult = await dependencies.roomThreadMessageIngestService.execute({
      channelId: threadEvent.channel,
      threadTs: threadEvent.thread_ts,
      messageTs: threadEvent.ts,
      userId: typeof threadEvent.user === "string" ? threadEvent.user : null,
      subtype: typeof threadEvent.subtype === "string" ? threadEvent.subtype : null,
      isBot: false,
      eventTs: typeof threadEvent.event_ts === "string" ? threadEvent.event_ts : threadEvent.ts
    });

    if (!isIngestedResult(ingestResult)) {
      logThreadEventCompletion({
        dependencies,
        requestId: input.requestId,
        event: threadEvent,
        result: ingestResult.kind,
        elapsedMs: Date.now() - startedAt
      });
      return;
    }

    await executeLiveReply({
      dependencies,
      requestId: input.requestId,
      event: threadEvent,
      ingestResult,
      slackThreadPort: input.slackThreadPort
    });

    logThreadEventCompletion({
      dependencies,
      requestId: input.requestId,
      event: threadEvent,
      sessionId: ingestResult.sessionId,
      result: "live_reply_executed",
      elapsedMs: Date.now() - startedAt
    });
  };
}

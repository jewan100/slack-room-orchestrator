import { ROOM_LOG_EVENT_NAMES, ROOM_OPENCLAW_MESSAGES } from "../../../shared/messages";
import type { Logger } from "../../../shared/logger";
import type { RoomThreadMessageIngestService } from "../../../shared/types";

// Slack message 이벤트에서 이 프로젝트가 사용하는 필드 집합
interface SlackMessageEventPayload {
  channel?: string;
  thread_ts?: string;
  ts?: string;
  user?: string;
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
  logger: Logger;
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

// Slack message 이벤트를 감시 대상 저장소 흐름으로 연결하는 inbound 핸들러를 생성한다.
export function createRoomThreadEventHandler(
  dependencies: RoomThreadEventHandlerDependencies
): (event: SlackMessageEventPayload) => Promise<void> {
  return async (event: SlackMessageEventPayload): Promise<void> => {
    if (!hasRequiredThreadIdentifiers(event)) {
      dependencies.logger.debug(ROOM_LOG_EVENT_NAMES.openclawThreadMessageIgnored, {
        reason: "missing_thread_identifiers",
        message: ROOM_OPENCLAW_MESSAGES.missingThreadIdentifiers
      });
      return;
    }

    // thread 내부 메시지만 대상으로 삼고, subtype 이벤트는 수집하지 않는다.
    if (typeof event.subtype === "string" && event.subtype.length > 0) {
      dependencies.logger.debug(ROOM_LOG_EVENT_NAMES.openclawThreadMessageIgnored, {
        channelId: event.channel,
        threadTs: event.thread_ts,
        messageTs: event.ts,
        subtype: event.subtype,
        reason: "subtype_message"
      });
      return;
    }

    // bot 발화는 자동 트리거 루프를 피하기 위해 수집 대상에서 제외한다.
    if (isBotMessage(event)) {
      dependencies.logger.debug(ROOM_LOG_EVENT_NAMES.openclawThreadMessageIgnored, {
        channelId: event.channel,
        threadTs: event.thread_ts,
        messageTs: event.ts,
        reason: "bot_message"
      });
      return;
    }

    await dependencies.roomThreadMessageIngestService.execute({
      channelId: event.channel,
      threadTs: event.thread_ts,
      messageTs: event.ts,
      userId: typeof event.user === "string" ? event.user : null,
      subtype: typeof event.subtype === "string" ? event.subtype : null,
      isBot: false,
      eventTs: typeof event.event_ts === "string" ? event.event_ts : event.ts
    });
  };
}

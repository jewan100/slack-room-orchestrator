import type { App } from "@slack/bolt";
import { ROOM_LOG_EVENT_NAMES } from "../../../shared/messages";
import type { Logger } from "../../../shared/logger";
import type { BoltAppFactoryOptions, SlackMessageEventPayload } from "./boltAppTypes";
import { extractErrorMessage, resolveSlackEventRequestId } from "./slackAdapterUtils";

// message 이벤트 처리 실패 로그를 공통 포맷으로 남긴다.
function logUnhandledMessageFailure(input: { logger: Logger; requestId: string; error: unknown }): void {
  input.logger.error(ROOM_LOG_EVENT_NAMES.slackMessageUnhandledFailure, {
    requestId: input.requestId,
    eventType: "message",
    errorMessage: extractErrorMessage(input.error)
  });
}

// room thread message 이벤트를 백그라운드로 연결한다.
export function bindRoomThreadMessageEvent(app: App, options: BoltAppFactoryOptions): void {
  const roomThreadMessageHandler = options.roomThreadMessageHandler;
  if (!roomThreadMessageHandler) {
    return;
  }

  app.event("message", ({ event, body, client }) => {
    const requestId = resolveSlackEventRequestId(body);

    void roomThreadMessageHandler({
      requestId,
      event: event as SlackMessageEventPayload,
      client
    }).catch((error: unknown) => {
      logUnhandledMessageFailure({
        logger: options.logger,
        requestId,
        error
      });
    });

    return Promise.resolve();
  });

  options.logger.info(ROOM_LOG_EVENT_NAMES.slackMessageEventBound, {
    eventType: "message"
  });
}


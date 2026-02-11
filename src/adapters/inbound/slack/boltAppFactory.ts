import { App, LogLevel as BoltLogLevel } from "@slack/bolt";
import { ROOM_LOG_EVENT_NAMES, ROOM_SLASH_COMMAND } from "../../../shared/messages";
import type { Logger, LogLevel } from "../../../shared/logger";
import type { RoomCommandRequest, SlackChatClient } from "../../../shared/types";

// Bolt message 이벤트에서 이 프로젝트가 사용하는 필드 집합
export interface SlackMessageEventPayload {
  channel?: string;
  thread_ts?: string;
  ts?: string;
  user?: string;
  subtype?: string;
  bot_id?: string;
  event_ts?: string;
}

// Bolt 앱 생성에 필요한 의존성을 묶은 옵션
// 핸들러를 외부 주입받아 어댑터가 유스케이스 구현을 직접 알지 않도록 한다.
export interface BoltAppFactoryOptions {
  botToken: string;
  appToken: string;
  logLevel: LogLevel;
  logger: Logger;
  roomCommandHandler: (request: RoomCommandRequest) => Promise<void>;
  roomThreadMessageHandler?: (event: SlackMessageEventPayload) => Promise<void>;
}

// 프로젝트 로그 레벨을 Bolt 내부 레벨 enum으로 매핑한다.
function mapLogLevel(logLevel: LogLevel): BoltLogLevel {
  if (logLevel === "debug") {
    return BoltLogLevel.DEBUG;
  }
  if (logLevel === "warn") {
    return BoltLogLevel.WARN;
  }
  if (logLevel === "error") {
    return BoltLogLevel.ERROR;
  }
  return BoltLogLevel.INFO;
}

// Slack Bolt 앱을 생성하고 `/room` 커맨드를 내부 핸들러에 바인딩한다.
// Slack 원본 payload 필드명을 앱 내부 표준 타입으로 정규화해서 전달한다.
export function createBoltApp(options: BoltAppFactoryOptions): App {
  const app = new App({
    token: options.botToken,
    appToken: options.appToken,
    socketMode: true,
    logLevel: mapLogLevel(options.logLevel)
  });

  app.command(ROOM_SLASH_COMMAND, async ({ ack, command, respond, client }) => {
    await options.roomCommandHandler({
      ack: async () => {
        await ack();
      },
      respond: async (payload) => {
        await respond(payload);
      },
      command: {
        text: command.text,
        userId: command.user_id,
        teamId: command.team_id,
        channelId: command.channel_id
      },
      client: client as unknown as SlackChatClient
    });
  });

  const roomThreadMessageHandler = options.roomThreadMessageHandler;
  if (roomThreadMessageHandler) {
    app.event("message", async ({ event }) => {
      await roomThreadMessageHandler(event as SlackMessageEventPayload);
    });

    options.logger.info(ROOM_LOG_EVENT_NAMES.slackMessageEventBound, {
      eventType: "message"
    });
  }

  options.logger.info(ROOM_LOG_EVENT_NAMES.slackCommandBound, { command: ROOM_SLASH_COMMAND });

  return app;
}

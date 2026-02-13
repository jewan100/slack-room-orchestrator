import { App, LogLevel as BoltLogLevel } from "@slack/bolt";
import { ROOM_LOG_EVENT_NAMES, ROOM_SLASH_COMMAND } from "../../../shared/messages";
import type { LogLevel } from "../../../shared/logger";
import type { BoltAppFactoryOptions } from "./boltAppTypes";
import { bindRoomCommand, bindRoomHelpAction } from "./roomSlashCommandBinding";
import { bindRoomThreadMessageEvent } from "./roomThreadMessageEventBinding";

export type { SlackMessageEventPayload, RoomThreadMessageHandlerInput, BoltAppFactoryOptions } from "./boltAppTypes";

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

  bindRoomCommand(app, options);
  bindRoomHelpAction(app);
  bindRoomThreadMessageEvent(app, options);

  options.logger.info(ROOM_LOG_EVENT_NAMES.slackCommandBound, { command: ROOM_SLASH_COMMAND });

  return app;
}


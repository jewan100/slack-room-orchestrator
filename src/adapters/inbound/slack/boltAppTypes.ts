import type { Logger, LogLevel } from "../../../shared/logger";
import type { RoomCommandRequest, SlackChatClient } from "../../../shared/types";

// Bolt message 이벤트에서 이 프로젝트가 사용하는 필드 집합
export interface SlackMessageEventPayload {
  channel?: string;
  thread_ts?: string;
  ts?: string;
  user?: string;
  text?: string;
  subtype?: string;
  bot_id?: string;
  event_ts?: string;
}

// thread message 핸들러 전달 입력 모델
export interface RoomThreadMessageHandlerInput {
  requestId: string;
  event: SlackMessageEventPayload;
  client: SlackChatClient;
}

// Bolt 앱 생성에 필요한 의존성을 묶은 옵션
// 핸들러를 외부 주입받아 어댑터가 유스케이스 구현을 직접 알지 않도록 한다.
export interface BoltAppFactoryOptions {
  botToken: string;
  appToken: string;
  logLevel: LogLevel;
  logger: Logger;
  roomCommandHandler: (request: RoomCommandRequest) => Promise<void>;
  roomThreadMessageHandler?: (input: RoomThreadMessageHandlerInput) => Promise<void>;
}


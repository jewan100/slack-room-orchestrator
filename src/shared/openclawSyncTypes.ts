import type { PersistedRoomSessionState } from "./types";

// OpenClaw 이벤트 프로토콜 버전
export const OPENCLAW_EVENT_PROTOCOL_VERSION = "v1";
export type OpenClawEventProtocolVersion = typeof OPENCLAW_EVENT_PROTOCOL_VERSION;

// OpenClaw로 전달하는 room 이벤트 타입 집합
export type OpenClawRoomEventType =
  | "ROOM_MODE_ON"
  | "ROOM_MODE_OFF"
  | "ROOM_QUESTION_TRIGGER";

// room 모드 OFF 사유
export type RoomModeOffReason = "LAUNCH" | "TTL" | "MANUAL";

// watch target 상태
export type RoomWatchTargetStatus = "ON" | "OFF";

// v1 watch mode는 planning만 지원한다.
export type RoomWatchMode = "PLANNING";

// OpenClaw로 전달하는 공통 이벤트 스키마
export interface OpenClawRoomEventBase {
  eventId: string;
  eventType: OpenClawRoomEventType;
  sessionId: string;
  channelId: string;
  threadTs: string;
  topic: string;
  state: PersistedRoomSessionState;
  occurredAt: string;
  version: OpenClawEventProtocolVersion;
}

// room 모드 ON 이벤트
export interface RoomModeOnEvent extends OpenClawRoomEventBase {
  eventType: "ROOM_MODE_ON";
  ttlExpiresAt: string;
}

// room 모드 OFF 이벤트
export interface RoomModeOffEvent extends OpenClawRoomEventBase {
  eventType: "ROOM_MODE_OFF";
  offReason: RoomModeOffReason;
}

// 자동 question 트리거 이벤트
export interface RoomQuestionTriggerEvent extends OpenClawRoomEventBase {
  eventType: "ROOM_QUESTION_TRIGGER";
  messageCount: number;
}

// OpenClaw 이벤트 유니온
export type OpenClawRoomEvent =
  | RoomModeOnEvent
  | RoomModeOffEvent
  | RoomQuestionTriggerEvent;

// room_watch_targets 도메인 모델
export interface RoomWatchTarget {
  id: string;
  sessionId: string;
  channelId: string;
  threadTs: string;
  status: RoomWatchTargetStatus;
  mode: RoomWatchMode;
  ttlExpiresAt: string;
  messageCount: number;
  lastQuestionTriggeredAt: string | null;
  turnedOnAt: string;
  turnedOffAt: string | null;
  offReason: RoomModeOffReason | null;
  createdAt: string;
  updatedAt: string;
}

// room_thread_messages 도메인 모델
export interface RoomThreadMessageMetadata {
  id: string;
  watchTargetId: string;
  sessionId: string;
  channelId: string;
  threadTs: string;
  messageTs: string;
  userId: string | null;
  subtype: string | null;
  isBot: boolean;
  eventTs: string;
  createdAt: string;
}

// outbox row 모델
export interface OpenClawEventOutboxItem {
  id: string;
  eventId: string;
  eventType: OpenClawRoomEventType;
  sessionId: string;
  channelId: string;
  threadTs: string;
  payload: OpenClawRoomEvent;
  status: "PENDING" | "DISPATCHED";
  retryCount: number;
  availableAt: string;
  createdAt: string;
  dispatchedAt: string | null;
  lastError: string | null;
}

import { randomUUID } from "node:crypto";
import {
  OPENCLAW_EVENT_PROTOCOL_VERSION,
  type RoomModeOffEvent,
  type RoomModeOnEvent,
  type RoomQuestionTriggerEvent,
  type RoomSummaryTriggerEvent,
  type RoomWatchTarget
} from "../../shared/openclawSyncTypes";
import type { RoomSession } from "../../shared/types";

// OpenClaw 이벤트 공통 필드를 생성한다.
function createBaseEventFields(input: {
  session: RoomSession;
  watchTarget: RoomWatchTarget;
  occurredAt: string;
}): {
  eventId: string;
  sessionId: string;
  channelId: string;
  threadTs: string;
  topic: string;
  state: RoomSession["state"];
  occurredAt: string;
  version: typeof OPENCLAW_EVENT_PROTOCOL_VERSION;
} {
  return {
    eventId: randomUUID(),
    sessionId: input.session.id,
    channelId: input.watchTarget.channelId,
    threadTs: input.watchTarget.threadTs,
    topic: input.session.topic,
    state: input.session.state,
    occurredAt: input.occurredAt,
    version: OPENCLAW_EVENT_PROTOCOL_VERSION
  };
}

// ROOM_MODE_ON 이벤트를 생성한다.
export function createRoomModeOnEvent(input: {
  session: RoomSession;
  watchTarget: RoomWatchTarget;
  occurredAt: string;
}): RoomModeOnEvent {
  return {
    eventType: "ROOM_MODE_ON",
    ...createBaseEventFields(input),
    ttlExpiresAt: input.watchTarget.ttlExpiresAt
  };
}

// ROOM_MODE_OFF 이벤트를 생성한다.
export function createRoomModeOffEvent(input: {
  session: RoomSession;
  watchTarget: RoomWatchTarget;
  offReason: "LAUNCH" | "TTL";
  occurredAt: string;
}): RoomModeOffEvent {
  return {
    eventType: "ROOM_MODE_OFF",
    ...createBaseEventFields(input),
    offReason: input.offReason
  };
}

// ROOM_SUMMARY_TRIGGER 이벤트를 생성한다.
export function createRoomSummaryTriggerEvent(input: {
  session: RoomSession;
  watchTarget: RoomWatchTarget;
  occurredAt: string;
}): RoomSummaryTriggerEvent {
  return {
    eventType: "ROOM_SUMMARY_TRIGGER",
    ...createBaseEventFields(input),
    messageCount: input.watchTarget.messageCount
  };
}

// ROOM_QUESTION_TRIGGER 이벤트를 생성한다.
export function createRoomQuestionTriggerEvent(input: {
  session: RoomSession;
  watchTarget: RoomWatchTarget;
  occurredAt: string;
}): RoomQuestionTriggerEvent {
  return {
    eventType: "ROOM_QUESTION_TRIGGER",
    ...createBaseEventFields(input),
    messageCount: input.watchTarget.messageCount
  };
}

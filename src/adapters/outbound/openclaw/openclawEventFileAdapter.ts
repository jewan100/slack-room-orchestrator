import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawRoomEvent } from "../../../shared/openclawSyncTypes";
import { ROOM_OPENCLAW_MESSAGES } from "../../../shared/messages";
import type { OpenClawEventSink } from "../../../shared/types";

const FORBIDDEN_PAYLOAD_FIELDS = new Set(["text", "body", "content", "rawText", "messageText"]);

// payload에 민감 본문 필드가 섞이지 않았는지 재귀 검증한다.
function assertNoForbiddenPayloadField(payload: unknown): void {
  if (Array.isArray(payload)) {
    for (const item of payload) {
      assertNoForbiddenPayloadField(item);
    }
    return;
  }

  if (typeof payload !== "object" || payload === null) {
    return;
  }

  const typedPayload = payload as Record<string, unknown>;
  for (const [key, value] of Object.entries(typedPayload)) {
    if (FORBIDDEN_PAYLOAD_FIELDS.has(key)) {
      throw new Error(ROOM_OPENCLAW_MESSAGES.forbiddenPayloadField(key));
    }

    assertNoForbiddenPayloadField(value);
  }
}

// OpenClaw 이벤트를 NDJSON 파일로 append하는 outbound 어댑터
export class OpenclawEventFileAdapter implements OpenClawEventSink {
  public constructor(private readonly eventsFilePath: string) {}

  // 이벤트 1건을 JSON 한 줄로 append한다.
  // at-least-once 보장을 위해 eventId는 payload 내부 값 그대로 유지한다.
  public async appendEvent(event: OpenClawRoomEvent): Promise<void> {
    assertNoForbiddenPayloadField(event);

    const absolutePath = path.resolve(this.eventsFilePath);
    const directory = path.dirname(absolutePath);
    await fs.mkdir(directory, { recursive: true });

    const serializedLine = `${JSON.stringify(event)}\n`;
    await fs.appendFile(absolutePath, serializedLine, "utf8");
  }
}

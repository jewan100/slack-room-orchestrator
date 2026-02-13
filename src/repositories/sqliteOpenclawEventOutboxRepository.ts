import { randomUUID } from "node:crypto";
import type { SqliteDatabase } from "../adapters/outbound/persistence/sqliteClient";
import type { OpenClawRoomEvent } from "../shared/openclawSyncTypes";
import { ROOM_SQLITE_MESSAGES } from "../shared/messages";
import type {
  MarkOpenClawEventRetryInput,
  OpenClawEventOutboxRepository,
  OpenClawPendingOutboxEvent
} from "../shared/types";

// openclaw_event_outbox 테이블 row 타입
interface OpenClawEventOutboxRow {
  id: string;
  event_id: string;
  event_type: OpenClawPendingOutboxEvent["eventType"];
  payload_json: string;
  retry_count: number;
  available_at: string;
}

// payload_json 문자열을 OpenClaw 이벤트 타입으로 역직렬화한다.
function parseOutboxPayload(rawPayload: string): OpenClawRoomEvent {
  try {
    return JSON.parse(rawPayload) as OpenClawRoomEvent;
  } catch {
    throw new Error(ROOM_SQLITE_MESSAGES.parseOutboxPayloadFailed);
  }
}

// OpenClaw 이벤트 outbox 저장/디스패치 상태 관리를 담당하는 SQLite 구현체
export class SqliteOpenclawEventOutboxRepository implements OpenClawEventOutboxRepository {
  public constructor(private readonly db: SqliteDatabase) {}

  // OpenClaw 이벤트를 pending 상태로 outbox에 적재한다.
  public async enqueueEvent(event: OpenClawRoomEvent): Promise<void> {
    const id = randomUUID();
    const now = new Date().toISOString();

    await this.db.run(
      `
      INSERT INTO openclaw_event_outbox (
        id, event_id, event_type, session_id, channel_id, thread_ts,
        payload_json, status, retry_count, available_at, created_at, dispatched_at, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?, NULL, NULL)
    `,
      id,
      event.eventId,
      event.eventType,
      event.sessionId,
      event.channelId,
      event.threadTs,
      JSON.stringify(event),
      now,
      now
    );
  }

  // 디스패치 가능한 pending 이벤트를 조회한다.
  // at-least-once 보장을 위해 이 단계에서는 상태를 변경하지 않는다.
  public async claimPendingEvents(nowIso: string, limit: number): Promise<OpenClawPendingOutboxEvent[]> {
    const rows = await this.db.all<OpenClawEventOutboxRow[]>(
      `
      SELECT id, event_id, event_type, payload_json, retry_count, available_at
      FROM openclaw_event_outbox
      WHERE status = 'PENDING'
        AND available_at <= ?
      ORDER BY available_at ASC, created_at ASC
      LIMIT ?
    `,
      nowIso,
      limit
    );

    return rows.map((row) => {
      return {
        id: row.id,
        eventId: row.event_id,
        eventType: row.event_type,
        payload: parseOutboxPayload(row.payload_json),
        retryCount: row.retry_count,
        availableAt: row.available_at
      };
    });
  }

  // 파일 append가 완료된 outbox 이벤트를 DISPATCHED로 마킹한다.
  public async markDispatched(outboxId: string, dispatchedAt: string): Promise<void> {
    const result = await this.db.run(
      `
      UPDATE openclaw_event_outbox
      SET status = 'DISPATCHED',
          dispatched_at = ?,
          last_error = NULL
      WHERE id = ?
        AND status = 'PENDING'
    `,
      dispatchedAt,
      outboxId
    );

    if (result.changes !== 1) {
      throw new Error(ROOM_SQLITE_MESSAGES.markOutboxDispatchedFailed);
    }
  }

  // 디스패치 실패 이벤트의 재시도 시각/오류 메시지를 갱신한다.
  public async markRetry(input: MarkOpenClawEventRetryInput): Promise<void> {
    const result = await this.db.run(
      `
      UPDATE openclaw_event_outbox
      SET retry_count = retry_count + 1,
          available_at = ?,
          last_error = ?
      WHERE id = ?
        AND status = 'PENDING'
    `,
      input.retryAt,
      input.errorMessage,
      input.outboxId
    );

    if (result.changes !== 1) {
      throw new Error(ROOM_SQLITE_MESSAGES.markOutboxRetryFailed);
    }
  }
}

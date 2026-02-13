import { randomUUID } from "node:crypto";
import type { SqliteDatabase } from "../adapters/outbound/persistence/sqliteClient";
import { ROOM_SQLITE_MESSAGES } from "../shared/messages";
import type {
  CreateRoomThreadMessageMetadataInput,
  RoomThreadMessageRepository
} from "../shared/types";
import type { RoomThreadMessageMetadata } from "../shared/openclawSyncTypes";

// room_thread_messages 테이블 row 타입
interface RoomThreadMessageRow {
  id: string;
  watch_target_id: string;
  session_id: string;
  channel_id: string;
  thread_ts: string;
  message_ts: string;
  user_id: string | null;
  subtype: string | null;
  is_bot: number;
  event_ts: string;
  created_at: string;
}

// 감시 대상 스레드 메시지 메타데이터를 저장하는 SQLite 구현체
// 보안 정책에 따라 본문 원문은 저장하지 않고 메타데이터만 저장한다.
export class SqliteRoomThreadMessageRepository implements RoomThreadMessageRepository {
  public constructor(private readonly db: SqliteDatabase) {}

  // channel/thread/messageTs 유니크 키 기준으로 신규 메시지만 저장한다.
  // Slack 재전송 이벤트는 INSERT OR IGNORE로 멱등하게 흡수한다.
  public async createMessageMetadataIfAbsent(input: CreateRoomThreadMessageMetadataInput): Promise<boolean> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    const result = await this.db.run(
      `
      INSERT OR IGNORE INTO room_thread_messages (
        id, watch_target_id, session_id, channel_id, thread_ts,
        message_ts, user_id, subtype, is_bot, event_ts, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      id,
      input.watchTargetId,
      input.sessionId,
      input.channelId,
      input.threadTs,
      input.messageTs,
      input.userId,
      input.subtype,
      input.isBot ? 1 : 0,
      input.eventTs,
      createdAt
    );

    if (typeof result.changes !== "number") {
      throw new Error(ROOM_SQLITE_MESSAGES.createThreadMessageMetadataFailed);
    }

    return result.changes === 1;
  }

  // 저장된 메시지 메타데이터를 복합 키로 조회한다.
  public async findByCompositeKey(
    channelId: string,
    threadTs: string,
    messageTs: string
  ): Promise<RoomThreadMessageMetadata | null> {
    const row = await this.db.get<RoomThreadMessageRow>(
      `
      SELECT *
      FROM room_thread_messages
      WHERE channel_id = ?
        AND thread_ts = ?
        AND message_ts = ?
      LIMIT 1
    `,
      channelId,
      threadTs,
      messageTs
    );

    if (!row) {
      return null;
    }

    return this.mapRow(row);
  }

  // DB row를 앱 도메인 모델로 변환한다.
  private mapRow(row: RoomThreadMessageRow): RoomThreadMessageMetadata {
    return {
      id: row.id,
      watchTargetId: row.watch_target_id,
      sessionId: row.session_id,
      channelId: row.channel_id,
      threadTs: row.thread_ts,
      messageTs: row.message_ts,
      userId: row.user_id,
      subtype: row.subtype,
      isBot: row.is_bot === 1,
      eventTs: row.event_ts,
      createdAt: row.created_at
    };
  }
}

import { randomUUID } from "node:crypto";
import type { SqliteDatabase } from "../adapters/outbound/persistence/sqliteClient";
import { ROOM_SQLITE_MESSAGES } from "../shared/messages";
import type {
  ClaimQuestionTriggerInput,
  CreateRoomWatchTargetInput,
  RoomWatchTargetRepository,
  TurnOffRoomWatchTargetInput
} from "../shared/types";
import type { RoomModeOffReason, RoomWatchTarget } from "../shared/openclawSyncTypes";

// room_watch_targets 테이블 row 타입
interface RoomWatchTargetRow {
  id: string;
  session_id: string;
  channel_id: string;
  thread_ts: string;
  status: "ON" | "OFF";
  mode: "PLANNING";
  ttl_expires_at: string;
  message_count: number;
  last_question_triggered_at: string | null;
  turned_on_at: string;
  turned_off_at: string | null;
  off_reason: RoomModeOffReason | null;
  created_at: string;
  updated_at: string;
}

// OpenClaw 감시 대상 저장/조회/상태전이를 담당하는 SQLite 구현체
export class SqliteRoomWatchTargetRepository implements RoomWatchTargetRepository {
  public constructor(private readonly db: SqliteDatabase) {}

  // watch target을 ON 상태로 생성한다.
  public async createWatchTargetOn(input: CreateRoomWatchTargetInput): Promise<RoomWatchTarget> {
    const id = randomUUID();
    const now = new Date().toISOString();

    await this.db.run(
      `
      INSERT INTO room_watch_targets (
        id, session_id, channel_id, thread_ts, status, mode, ttl_expires_at,
        message_count, last_question_triggered_at,
        turned_on_at, turned_off_at, off_reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'ON', ?, ?, 0, NULL, ?, NULL, NULL, ?, ?)
    `,
      id,
      input.sessionId,
      input.channelId,
      input.threadTs,
      input.mode,
      input.ttlExpiresAt,
      now,
      now,
      now
    );

    const created = await this.findById(id);
    if (!created) {
      throw new Error(ROOM_SQLITE_MESSAGES.createWatchTargetFailed);
    }

    return created;
  }

  // 시작 채널 기준으로 현재 활성 planning 대상을 1건 조회한다.
  // OpenClaw 실시간 라우팅에서 "지금 회의 모드인지"를 빠르게 판별할 때 사용한다.
  public async findActivePlanningByChannel(channelId: string): Promise<RoomWatchTarget | null> {
    const row = await this.db.get<RoomWatchTargetRow>(
      `
      SELECT *
      FROM room_watch_targets
      WHERE status = 'ON'
        AND mode = 'PLANNING'
        AND channel_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `,
      channelId
    );

    if (!row) {
      return null;
    }

    return this.mapRow(row);
  }

  // channel/thread 기준 ON 대상을 조회한다.
  public async findOnWatchTargetByChannelAndThread(channelId: string, threadTs: string): Promise<RoomWatchTarget | null> {
    const row = await this.db.get<RoomWatchTargetRow>(
      `
      SELECT *
      FROM room_watch_targets
      WHERE status = 'ON'
        AND channel_id = ?
        AND thread_ts = ?
      LIMIT 1
    `,
      channelId,
      threadTs
    );

    if (!row) {
      return null;
    }

    return this.mapRow(row);
  }

  // session 기준 ON 대상을 조회한다.
  public async findOnWatchTargetBySessionId(sessionId: string): Promise<RoomWatchTarget | null> {
    const row = await this.db.get<RoomWatchTargetRow>(
      `
      SELECT *
      FROM room_watch_targets
      WHERE session_id = ?
        AND status = 'ON'
      ORDER BY created_at DESC
      LIMIT 1
    `,
      sessionId
    );

    if (!row) {
      return null;
    }

    return this.mapRow(row);
  }

  // TTL 만료된 ON 대상을 배치 조회한다.
  public async findExpiredOnWatchTargets(nowIso: string, limit: number): Promise<RoomWatchTarget[]> {
    const rows = await this.db.all<RoomWatchTargetRow[]>(
      `
      SELECT *
      FROM room_watch_targets
      WHERE status = 'ON'
        AND ttl_expires_at <= ?
      ORDER BY ttl_expires_at ASC
      LIMIT ?
    `,
      nowIso,
      limit
    );

    return rows.map((row) => this.mapRow(row));
  }

  // question 트리거 주기가 지난 ON 대상을 배치 조회한다.
  public async findQuestionTriggerDueWatchTargets(cutoffIso: string, limit: number): Promise<RoomWatchTarget[]> {
    const rows = await this.db.all<RoomWatchTargetRow[]>(
      `
      SELECT *
      FROM room_watch_targets
      WHERE status = 'ON'
        AND (
          last_question_triggered_at IS NULL
          OR last_question_triggered_at <= ?
        )
      ORDER BY COALESCE(last_question_triggered_at, '1970-01-01T00:00:00.000Z') ASC
      LIMIT ?
    `,
      cutoffIso,
      limit
    );

    return rows.map((row) => this.mapRow(row));
  }

  // ON 대상을 OFF로 전환한다.
  // 이미 OFF인 경우는 null을 반환해 호출자가 멱등 처리할 수 있게 한다.
  public async turnOffWatchTarget(input: TurnOffRoomWatchTargetInput): Promise<RoomWatchTarget | null> {
    const now = new Date().toISOString();

    const result = await this.db.run(
      `
      UPDATE room_watch_targets
      SET status = 'OFF',
          turned_off_at = ?,
          off_reason = ?,
          updated_at = ?
      WHERE id = ?
        AND status = 'ON'
    `,
      input.turnedOffAt,
      input.offReason,
      now,
      input.watchTargetId
    );

    if (result.changes === 0) {
      return null;
    }

    const updated = await this.findById(input.watchTargetId);
    if (!updated) {
      throw new Error(ROOM_SQLITE_MESSAGES.turnOffWatchTargetFailed);
    }

    return updated;
  }

  // 신규 메시지가 들어올 때 ON 대상의 message_count를 1 증가시킨다.
  // ttlExpiresAt이 전달되면 비활성 만료 기준을 "마지막 메시지 기준"으로 갱신한다.
  public async incrementMessageCount(watchTargetId: string, ttlExpiresAt?: string): Promise<RoomWatchTarget> {
    const now = new Date().toISOString();

    const result = ttlExpiresAt
      ? await this.db.run(
          `
          UPDATE room_watch_targets
          SET message_count = message_count + 1,
              ttl_expires_at = ?,
              updated_at = ?
          WHERE id = ?
            AND status = 'ON'
        `,
          ttlExpiresAt,
          now,
          watchTargetId
        )
      : await this.db.run(
          `
          UPDATE room_watch_targets
          SET message_count = message_count + 1,
              updated_at = ?
          WHERE id = ?
            AND status = 'ON'
        `,
          now,
          watchTargetId
        );

    if (result.changes !== 1) {
      throw new Error(ROOM_SQLITE_MESSAGES.incrementWatchTargetMessageCountFailed);
    }

    const updated = await this.findById(watchTargetId);
    if (!updated) {
      throw new Error(ROOM_SQLITE_MESSAGES.incrementWatchTargetMessageCountFailed);
    }

    return updated;
  }

  // question 트리거 주기가 지난 대상만 선점한다.
  // 선점 성공한 대상만 question trigger 이벤트를 enqueue해야 중복 발행을 막을 수 있다.
  public async claimQuestionTriggerIfDue(input: ClaimQuestionTriggerInput): Promise<RoomWatchTarget | null> {
    const result = await this.db.run(
      `
      UPDATE room_watch_targets
      SET last_question_triggered_at = ?,
          updated_at = ?
      WHERE id = ?
        AND status = 'ON'
        AND (
          last_question_triggered_at IS NULL
          OR last_question_triggered_at <= ?
        )
    `,
      input.triggeredAt,
      input.triggeredAt,
      input.watchTargetId,
      input.dueBefore
    );

    if (result.changes === 0) {
      return null;
    }

    const updated = await this.findById(input.watchTargetId);
    if (!updated) {
      throw new Error(ROOM_SQLITE_MESSAGES.claimQuestionTriggerFailed);
    }

    return updated;
  }

  // PK로 watch target 단건을 조회한다.
  private async findById(watchTargetId: string): Promise<RoomWatchTarget | null> {
    const row = await this.db.get<RoomWatchTargetRow>(
      `
      SELECT *
      FROM room_watch_targets
      WHERE id = ?
    `,
      watchTargetId
    );

    if (!row) {
      return null;
    }

    return this.mapRow(row);
  }

  // DB row를 앱 도메인 모델로 변환한다.
  private mapRow(row: RoomWatchTargetRow): RoomWatchTarget {
    return {
      id: row.id,
      sessionId: row.session_id,
      channelId: row.channel_id,
      threadTs: row.thread_ts,
      status: row.status,
      mode: row.mode,
      ttlExpiresAt: row.ttl_expires_at,
      messageCount: row.message_count,
      lastQuestionTriggeredAt: row.last_question_triggered_at,
      turnedOnAt: row.turned_on_at,
      turnedOffAt: row.turned_off_at,
      offReason: row.off_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

import { randomUUID } from "node:crypto";
import type { SqliteDatabase } from "../adapters/outbound/persistence/sqliteClient";
import { ROOM_SQLITE_MESSAGES } from "../shared/messages";
import type {
  CandidateOption,
  CreatePreparedSessionInput,
  DeleteReservedPreparedSessionInput,
  RoomSession,
  RoomSessionRepository,
  UpdatePreparedSessionStartThreadInput,
  UpdateSessionToRunningInput
} from "../shared/types";

// DB row 스키마(스네이크 케이스)와 앱 모델(카멜 케이스) 변환을 위해 분리한 타입
interface RoomSessionRow {
  id: string;
  topic: string;
  state: "PREPARED" | "RUNNING" | "DECIDED";
  requested_by_user_id: string;
  workspace_id: string;
  start_channel_id: string;
  start_thread_ts: string;
  launch_channel_id: string | null;
  launch_thread_ts: string | null;
  decided_option: CandidateOption | null;
  created_at: string;
  updated_at: string;
}

// room_sessions 테이블 접근 구현체
// 서비스는 인터페이스(RoomSessionRepository)만 알고, SQL 세부 구현은 이 파일에 캡슐화한다.
export class SqliteRoomSessionRepository implements RoomSessionRepository {
  public constructor(private readonly db: SqliteDatabase) {}

  // 시작 채널 기준으로 현재 활성 세션(PREPARED/RUNNING) 1건을 조회한다.
  public async findActiveSessionByStartChannel(startChannelId: string): Promise<RoomSession | null> {
    // 생성시각 최신순으로 1건만 조회해 "현재 세션"을 결정한다.
    const row = await this.db.get<RoomSessionRow>(
      `
      SELECT *
      FROM room_sessions
      WHERE start_channel_id = ?
        AND state IN ('PREPARED', 'RUNNING')
      ORDER BY created_at DESC
      LIMIT 1
    `,
      startChannelId
    );

    if (!row) {
      return null;
    }

    // DB row를 도메인 모델로 변환해 상위 레이어에 반환한다.
    return this.mapRow(row);
  }

  // PREPARED 세션을 생성하고, 생성 직후 재조회해 정규 모델로 반환한다.
  public async createPreparedSession(input: CreatePreparedSessionInput): Promise<RoomSession> {
    // 애플리케이션 레벨에서 UUID/시각을 미리 생성해 INSERT 인자로 사용한다.
    const now = new Date().toISOString();
    const id = randomUUID();

    // launch 정보는 start 시점에 아직 없으므로 NULL로 저장한다.
    await this.db.run(
      `
      INSERT INTO room_sessions (
        id, topic, state, requested_by_user_id, workspace_id,
        start_channel_id, start_thread_ts, launch_channel_id,
        launch_thread_ts, decided_option, created_at, updated_at
      ) VALUES (?, ?, 'PREPARED', ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
    `,
      id,
      input.topic,
      input.requestedByUserId,
      input.workspaceId,
      input.startChannelId,
      input.startThreadTs,
      now,
      now
    );

    // 직전에 생성한 id를 기준으로 다시 읽어 검증된 모델을 반환한다.
    const created = await this.findById(id);
    if (!created) {
      throw new Error(ROOM_SQLITE_MESSAGES.createPreparedSessionFailed);
    }

    return created;
  }

  // PREPARED 세션의 start 스레드 식별자를 갱신한다.
  public async updatePreparedSessionStartThread(input: UpdatePreparedSessionStartThreadInput): Promise<RoomSession> {
    // start 스레드 연결 시점의 갱신 시각을 함께 기록한다.
    const now = new Date().toISOString();

    // PREPARED 세션에만 start_thread_ts를 반영해 상태 정합성을 유지한다.
    const result = await this.db.run(
      `
      UPDATE room_sessions
      SET start_thread_ts = ?,
          updated_at = ?
      WHERE id = ?
        AND state = 'PREPARED'
    `,
      input.startThreadTs,
      now,
      input.sessionId
    );

    if (result.changes !== 1) {
      throw new Error(ROOM_SQLITE_MESSAGES.updatePreparedSessionStartThreadFailed);
    }

    // 갱신된 세션을 다시 읽어 일관된 모델로 반환한다.
    const updated = await this.findById(input.sessionId);
    if (!updated) {
      throw new Error(ROOM_SQLITE_MESSAGES.updatePreparedSessionStartThreadFailed);
    }

    return updated;
  }

  // launch 시작 전에 PREPARED 세션을 원자적으로 선점한다.
  public async claimPreparedSessionForLaunch(sessionId: string): Promise<boolean> {
    // 선점 시점의 갱신 시각을 기록한다.
    const now = new Date().toISOString();

    // PREPARED 상태인 경우에만 RUNNING으로 전이해 동시 launch를 차단한다.
    const result = await this.db.run(
      `
      UPDATE room_sessions
      SET state = 'RUNNING',
          updated_at = ?
      WHERE id = ?
        AND state = 'PREPARED'
    `,
      now,
      sessionId
    );

    if (typeof result.changes !== "number") {
      throw new Error(ROOM_SQLITE_MESSAGES.claimPreparedSessionForLaunchFailed);
    }

    return result.changes === 1;
  }

  // launch 선점 이후 실패가 발생하면 PREPARED 상태로 롤백한다.
  public async rollbackLaunchClaim(sessionId: string): Promise<void> {
    // 롤백 시점의 갱신 시각을 기록한다.
    const now = new Date().toISOString();

    // RUNNING 상태를 PREPARED로 되돌리고 launch 메타데이터를 초기화한다.
    const result = await this.db.run(
      `
      UPDATE room_sessions
      SET state = 'PREPARED',
          launch_channel_id = NULL,
          launch_thread_ts = NULL,
          updated_at = ?
      WHERE id = ?
        AND state = 'RUNNING'
    `,
      now,
      sessionId
    );

    if (result.changes !== 1) {
      throw new Error(ROOM_SQLITE_MESSAGES.rollbackLaunchClaimFailed);
    }
  }

  // 세션을 RUNNING으로 전이하면서 launch 스레드 정보를 함께 업데이트한다.
  public async updateSessionToRunning(input: UpdateSessionToRunningInput): Promise<RoomSession> {
    // 상태 전이 시점의 갱신 시각을 함께 기록한다.
    const now = new Date().toISOString();

    // 상태/launch 채널/launch 스레드/updated_at을 한 번에 갱신한다.
    const result = await this.db.run(
      `
      UPDATE room_sessions
      SET state = 'RUNNING',
          launch_channel_id = ?,
          launch_thread_ts = ?,
          updated_at = ?
      WHERE id = ?
        AND state = 'RUNNING'
    `,
      input.launchChannelId,
      input.launchThreadTs,
      now,
      input.sessionId
    );

    if (result.changes !== 1) {
      throw new Error(ROOM_SQLITE_MESSAGES.updateSessionToRunningFailed);
    }

    // 갱신 결과를 즉시 재조회해 상위 레이어에서 일관된 모델을 사용하게 한다.
    const updated = await this.findById(input.sessionId);
    if (!updated) {
      throw new Error(ROOM_SQLITE_MESSAGES.updateSessionToRunningFailed);
    }

    return updated;
  }

  // start 예약 단계에서 만든 PREPARED 세션만 조건부로 삭제한다.
  // 상태가 이미 바뀐 세션(RUNNING 등)은 삭제하지 않고 false를 반환한다.
  public async deleteReservedPreparedSession(input: DeleteReservedPreparedSessionInput): Promise<boolean> {
    const result = await this.db.run(
      `
      DELETE FROM room_sessions
      WHERE id = ?
        AND state = 'PREPARED'
        AND start_thread_ts = ?
    `,
      input.sessionId,
      input.expectedStartThreadTs
    );

    if (typeof result.changes !== "number") {
      throw new Error(ROOM_SQLITE_MESSAGES.deleteSessionFailed);
    }

    return result.changes === 1;
  }

  // 세션 ID 기준으로 단건 삭제한다.
  public async deleteById(sessionId: string): Promise<void> {
    // 보상 처리 시점에는 정확히 1건이 삭제되어야 한다.
    const result = await this.db.run(
      `
      DELETE FROM room_sessions
      WHERE id = ?
    `,
      sessionId
    );

    if (result.changes !== 1) {
      throw new Error(ROOM_SQLITE_MESSAGES.deleteSessionFailed);
    }
  }

  // 세션 ID 기반 단건 조회다.
  public async findById(sessionId: string): Promise<RoomSession | null> {
    // PK(id) 조건으로 단일 row를 조회한다.
    const row = await this.db.get<RoomSessionRow>(
      `
      SELECT *
      FROM room_sessions
      WHERE id = ?
    `,
      sessionId
    );

    if (!row) {
      return null;
    }

    // DB row를 도메인 모델로 변환한다.
    return this.mapRow(row);
  }

  // DB row를 도메인 모델(RoomSession)로 변환한다.
  private mapRow(row: RoomSessionRow): RoomSession {
    return {
      id: row.id,
      topic: row.topic,
      state: row.state,
      requestedByUserId: row.requested_by_user_id,
      workspaceId: row.workspace_id,
      startChannelId: row.start_channel_id,
      startThreadTs: row.start_thread_ts,
      launchChannelId: row.launch_channel_id,
      launchThreadTs: row.launch_thread_ts,
      decidedOption: row.decided_option,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

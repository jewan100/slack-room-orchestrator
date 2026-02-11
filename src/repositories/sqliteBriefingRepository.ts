import { randomUUID } from "node:crypto";
import type { SqliteDatabase } from "../adapters/outbound/persistence/sqliteClient";
import { ROOM_SQLITE_MESSAGES } from "../shared/messages";
import type { BriefingRepository, CreateBriefingInput, RoomBriefing } from "../shared/types";

// room_briefings 테이블 row 타입
interface RoomBriefingRow {
  id: string;
  session_id: string;
  goal: string;
  constraints: string;
  success_criteria: string;
  created_at: string;
}

// 브리핑 저장/조회 구현체
export class SqliteBriefingRepository implements BriefingRepository {
  public constructor(private readonly db: SqliteDatabase) {}

  // 브리핑 1건을 생성한 뒤, 최신 브리핑을 재조회해 반환한다.
  public async createBriefing(input: CreateBriefingInput): Promise<RoomBriefing> {
    // 브리핑 식별자와 생성시각을 저장 전 준비한다.
    const now = new Date().toISOString();
    const id = randomUUID();

    // 세션 기준 브리핑 데이터를 INSERT한다.
    await this.db.run(
      `
      INSERT INTO room_briefings (
        id, session_id, goal, constraints, success_criteria, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
      id,
      input.sessionId,
      input.goal,
      input.constraints,
      input.successCriteria,
      now
    );

    // 방금 저장한 세션의 최신 브리핑을 읽어 반환한다.
    const created = await this.findBySessionId(input.sessionId);
    if (!created) {
      throw new Error(ROOM_SQLITE_MESSAGES.createBriefingFailed);
    }

    return created;
  }

  // 세션 기준 최신 브리핑 1건을 조회한다.
  public async findBySessionId(sessionId: string): Promise<RoomBriefing | null> {
    // created_at 내림차순으로 최신 브리핑 1건을 조회한다.
    const row = await this.db.get<RoomBriefingRow>(
      `
      SELECT *
      FROM room_briefings
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `,
      sessionId
    );

    if (!row) {
      return null;
    }

    // DB row(스네이크 케이스)를 앱 모델(카멜 케이스)로 변환한다.
    return {
      id: row.id,
      sessionId: row.session_id,
      goal: row.goal,
      constraints: row.constraints,
      successCriteria: row.success_criteria,
      createdAt: row.created_at
    };
  }
}

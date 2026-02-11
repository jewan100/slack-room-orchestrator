import { randomUUID } from "node:crypto";
import type { SqliteDatabase } from "../adapters/outbound/persistence/sqliteClient";
import { ROOM_SQLITE_MESSAGES } from "../shared/messages";
import type { CreateWorkerRoundInput, RoomWorkerRound, WorkerCandidate, WorkerRoundRepository } from "../shared/types";

// room_worker_rounds 테이블 row 타입
interface RoomWorkerRoundRow {
  id: string;
  session_id: string;
  round_no: number;
  candidates_json: string;
  created_at: string;
}

// DB의 JSON 문자열 후보안을 안전하게 역직렬화한다.
function parseWorkerCandidates(rawCandidates: string): WorkerCandidate[] {
  try {
    return JSON.parse(rawCandidates) as WorkerCandidate[];
  } catch {
    throw new Error(ROOM_SQLITE_MESSAGES.parseWorkerRoundCandidatesFailed);
  }
}

// 워커 라운드 저장/조회 구현체
export class SqliteWorkerRoundRepository implements WorkerRoundRepository {
  public constructor(private readonly db: SqliteDatabase) {}

  // 라운드 1건을 저장하고 최신 라운드를 재조회해 반환한다.
  public async createRound(input: CreateWorkerRoundInput): Promise<RoomWorkerRound> {
    // 애플리케이션에서 UUID를 생성해 PK 충돌 가능성을 낮춘다.
    const id = randomUUID();
    // 생성 시각을 ISO 문자열로 고정해 정렬/비교를 단순화한다.
    const now = new Date().toISOString();

    // 후보안 배열은 DB에 JSON 문자열로 저장한다.
    // SQLite 스키마를 단순하게 유지하기 위한 선택
    await this.db.run(
      `
      INSERT INTO room_worker_rounds (
        id, session_id, round_no, candidates_json, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `,
      id,
      input.sessionId,
      input.roundNo,
      JSON.stringify(input.candidates),
      now
    );

    // 방금 저장한 세션의 최신 라운드를 다시 읽어 반환한다.
    // write 후 read 패턴으로 반환 모델 일관성을 보장한다.
    const created = await this.findLatestBySessionId(input.sessionId);
    if (!created) {
      throw new Error(ROOM_SQLITE_MESSAGES.createWorkerRoundFailed);
    }

    return created;
  }

  // 세션 기준 최신 라운드 1건을 조회한다.
  // 후보안 배열은 JSON 문자열을 파싱해 복원한다.
  public async findLatestBySessionId(sessionId: string): Promise<RoomWorkerRound | null> {
    // round_no 내림차순 + LIMIT 1로 최신 라운드만 읽는다.
    const row = await this.db.get<RoomWorkerRoundRow>(
      `
      SELECT *
      FROM room_worker_rounds
      WHERE session_id = ?
      ORDER BY round_no DESC
      LIMIT 1
    `,
      sessionId
    );

    if (!row) {
      return null;
    }

    // DB 문자열(JSON)을 도메인 배열 타입으로 역직렬화한다.
    const parsedCandidates = parseWorkerCandidates(row.candidates_json);

    // 스네이크 케이스 row를 앱 표준 카멜 케이스 모델로 변환한다.
    return {
      id: row.id,
      sessionId: row.session_id,
      roundNo: row.round_no,
      candidates: parsedCandidates,
      createdAt: row.created_at
    };
  }
}

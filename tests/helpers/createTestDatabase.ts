import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteClient } from "../../src/adapters/outbound/persistence/sqliteClient";
import { SqliteBriefingRepository } from "../../src/repositories/sqliteBriefingRepository";
import { SqliteRoomSessionRepository } from "../../src/repositories/sqliteRoomSessionRepository";
import { SqliteWorkerRoundRepository } from "../../src/repositories/sqliteWorkerRoundRepository";

// 테스트에서 공통으로 사용하는 임시 SQLite 컨텍스트 모델
export interface TestDatabaseContext {
  sqliteClient: SqliteClient;
  roomSessionRepository: SqliteRoomSessionRepository;
  briefingRepository: SqliteBriefingRepository;
  workerRoundRepository: SqliteWorkerRoundRepository;
  cleanup: () => Promise<void>;
}

// 테스트 실행마다 격리된 파일 DB를 생성한다.
// 사용 후 cleanup을 호출하면 파일/디렉터리를 모두 정리한다.
export async function createTestDatabase(): Promise<TestDatabaseContext> {
  // OS 임시 디렉터리 아래 테스트 전용 폴더를 만든다.
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "room-orchestrator-"));
  // 임시 폴더 내부에 SQLite 파일 경로를 고정한다.
  const dbPath = path.join(tempDirectory, "test.sqlite");
  // 실제 애플리케이션과 동일한 마이그레이션 파일을 사용한다.
  const migrationPath = path.resolve(process.cwd(), "migrations", "001_init.sql");

  // SQLite 연결을 열고 마이그레이션을 적용해 테스트 스키마를 준비한다.
  const sqliteClient = new SqliteClient(dbPath);
  await sqliteClient.connect();
  await sqliteClient.runMigrations(migrationPath);

  return {
    sqliteClient,
    // 각 저장소 구현체를 테스트에서 바로 사용할 수 있게 노출한다.
    roomSessionRepository: new SqliteRoomSessionRepository(sqliteClient.getDatabase()),
    briefingRepository: new SqliteBriefingRepository(sqliteClient.getDatabase()),
    workerRoundRepository: new SqliteWorkerRoundRepository(sqliteClient.getDatabase()),
    cleanup: async () => {
      // DB 연결을 닫은 뒤 임시 디렉터리 전체를 삭제한다.
      await sqliteClient.close();
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  };
}

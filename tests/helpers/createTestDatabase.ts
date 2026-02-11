import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteClient } from "../../src/adapters/outbound/persistence/sqliteClient";
import { SqliteBriefingRepository } from "../../src/repositories/sqliteBriefingRepository";
import { SqliteOpenclawEventOutboxRepository } from "../../src/repositories/sqliteOpenclawEventOutboxRepository";
import { SqliteRoomSessionRepository } from "../../src/repositories/sqliteRoomSessionRepository";
import { SqliteRoomThreadMessageRepository } from "../../src/repositories/sqliteRoomThreadMessageRepository";
import { SqliteRoomWatchTargetRepository } from "../../src/repositories/sqliteRoomWatchTargetRepository";
import { SqliteWorkerRoundRepository } from "../../src/repositories/sqliteWorkerRoundRepository";

// 테스트에서 공통으로 사용하는 임시 SQLite 컨텍스트 모델
export interface TestDatabaseContext {
  sqliteClient: SqliteClient;
  roomSessionRepository: SqliteRoomSessionRepository;
  briefingRepository: SqliteBriefingRepository;
  workerRoundRepository: SqliteWorkerRoundRepository;
  roomWatchTargetRepository: SqliteRoomWatchTargetRepository;
  roomThreadMessageRepository: SqliteRoomThreadMessageRepository;
  openClawEventOutboxRepository: SqliteOpenclawEventOutboxRepository;
  cleanup: () => Promise<void>;
}

// migrations 디렉터리의 SQL 파일을 이름순으로 적용한다.
async function runAllMigrations(sqliteClient: SqliteClient): Promise<void> {
  const migrationDirectoryPath = path.resolve(process.cwd(), "migrations");
  const migrationFileNames = fs
    .readdirSync(migrationDirectoryPath)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();

  for (const migrationFileName of migrationFileNames) {
    const migrationPath = path.join(migrationDirectoryPath, migrationFileName);
    await sqliteClient.runMigrations(migrationPath);
  }
}

// 테스트 실행마다 격리된 파일 DB를 생성한다.
// 사용 후 cleanup을 호출하면 파일/디렉터리를 모두 정리한다.
export async function createTestDatabase(): Promise<TestDatabaseContext> {
  // OS 임시 디렉터리 아래 테스트 전용 폴더를 만든다.
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "room-orchestrator-"));
  // 임시 폴더 내부에 SQLite 파일 경로를 고정한다.
  const dbPath = path.join(tempDirectory, "test.sqlite");

  // SQLite 연결을 열고 마이그레이션을 적용해 테스트 스키마를 준비한다.
  const sqliteClient = new SqliteClient(dbPath);
  await sqliteClient.connect();
  await runAllMigrations(sqliteClient);

  return {
    sqliteClient,
    // 각 저장소 구현체를 테스트에서 바로 사용할 수 있게 노출한다.
    roomSessionRepository: new SqliteRoomSessionRepository(sqliteClient.getDatabase()),
    briefingRepository: new SqliteBriefingRepository(sqliteClient.getDatabase()),
    workerRoundRepository: new SqliteWorkerRoundRepository(sqliteClient.getDatabase()),
    roomWatchTargetRepository: new SqliteRoomWatchTargetRepository(sqliteClient.getDatabase()),
    roomThreadMessageRepository: new SqliteRoomThreadMessageRepository(sqliteClient.getDatabase()),
    openClawEventOutboxRepository: new SqliteOpenclawEventOutboxRepository(sqliteClient.getDatabase()),
    cleanup: async () => {
      // DB 연결을 닫은 뒤 임시 디렉터리 전체를 삭제한다.
      await sqliteClient.close();
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  };
}

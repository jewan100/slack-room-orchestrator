import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteClient } from "../../src/adapters/outbound/persistence/sqliteClient";
import { SqliteBriefingRepository } from "../../src/repositories/sqliteBriefingRepository";
import { SqliteRoomSessionRepository } from "../../src/repositories/sqliteRoomSessionRepository";
import { SqliteWorkerRoundRepository } from "../../src/repositories/sqliteWorkerRoundRepository";

export interface TestDatabaseContext {
  sqliteClient: SqliteClient;
  roomSessionRepository: SqliteRoomSessionRepository;
  briefingRepository: SqliteBriefingRepository;
  workerRoundRepository: SqliteWorkerRoundRepository;
  cleanup: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabaseContext> {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "room-orchestrator-"));
  const dbPath = path.join(tempDirectory, "test.sqlite");
  const migrationPath = path.resolve(process.cwd(), "migrations", "001_init.sql");

  const sqliteClient = new SqliteClient(dbPath);
  await sqliteClient.connect();
  await sqliteClient.runMigrations(migrationPath);

  return {
    sqliteClient,
    roomSessionRepository: new SqliteRoomSessionRepository(sqliteClient.getDatabase()),
    briefingRepository: new SqliteBriefingRepository(sqliteClient.getDatabase()),
    workerRoundRepository: new SqliteWorkerRoundRepository(sqliteClient.getDatabase()),
    cleanup: async () => {
      await sqliteClient.close();
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  };
}

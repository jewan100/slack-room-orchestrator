import fs from "node:fs";
import path from "node:path";
import type { SqliteClient } from "./sqliteClient";

// migrations 디렉터리의 SQL 파일을 이름순으로 모두 적용한다.
// 런타임과 테스트가 동일한 적용 규칙을 공유하도록 공용 유틸로 분리했다.
export async function runAllMigrations(
  sqliteClient: SqliteClient,
  migrationDirectoryPath: string = path.resolve(process.cwd(), "migrations")
): Promise<void> {
  const migrationFileNames = fs
    .readdirSync(migrationDirectoryPath)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();

  for (const migrationFileName of migrationFileNames) {
    const migrationPath = path.join(migrationDirectoryPath, migrationFileName);
    await sqliteClient.runMigrations(migrationPath);
  }
}

import fs from "node:fs";
import path from "node:path";
import { open, type Database } from "sqlite";
import sqlite3 from "sqlite3";
import { ROOM_SQLITE_MESSAGES } from "../../../shared/messages";

// sqlite 라이브러리 제네릭 타입을 프로젝트 표준 alias로 고정한다.
export type SqliteDatabase = Database<sqlite3.Database, sqlite3.Statement>;

// SQLite 연결/마이그레이션/종료를 담당하는 인프라 어댑터
export class SqliteClient {
  private db: SqliteDatabase | null = null;

  public constructor(private readonly databasePath: string) {}

  // DB 연결을 초기화한다.
  // 디렉터리가 없으면 생성하고, 필수 PRAGMA를 설정한다.
  public async connect(): Promise<void> {
    if (this.db) {
      return;
    }

    const absoluteDatabasePath = path.resolve(this.databasePath);
    const directoryPath = path.dirname(absoluteDatabasePath);
    if (!fs.existsSync(directoryPath)) {
      fs.mkdirSync(directoryPath, { recursive: true });
    }

    this.db = await open({
      filename: absoluteDatabasePath,
      driver: sqlite3.Database
    });

    await this.db.exec("PRAGMA foreign_keys = ON;");
    await this.db.exec("PRAGMA journal_mode = WAL;");
  }

  // 단일 SQL 마이그레이션 파일을 읽어 실행한다.
  public async runMigrations(migrationFilePath: string): Promise<void> {
    const database = this.getDatabase();
    const absoluteMigrationPath = path.resolve(migrationFilePath);
    const sql = fs.readFileSync(absoluteMigrationPath, "utf8");
    await database.exec(sql);
  }

  // 현재 연결 객체를 반환한다.
  // connect() 이전 접근은 명시적으로 예외 처리한다.
  public getDatabase(): SqliteDatabase {
    if (!this.db) {
      throw new Error(ROOM_SQLITE_MESSAGES.notConnected);
    }

    return this.db;
  }

  // 연결이 열려 있으면 안전하게 닫고 내부 참조를 초기화한다.
  public async close(): Promise<void> {
    if (!this.db) {
      return;
    }

    await this.db.close();
    this.db = null;
  }
}

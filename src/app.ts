import path from "node:path";
import { config as loadEnvironment } from "dotenv";
import type { App } from "@slack/bolt";
import { createBoltApp } from "./adapters/inbound/slack/boltAppFactory";
import { createRoomCommandHandler } from "./adapters/inbound/slack/roomCommandHandler";
import { SqliteClient } from "./adapters/outbound/persistence/sqliteClient";
import { SlackThreadAdapter } from "./adapters/outbound/slack/slackThreadAdapter";
import { SqliteBriefingRepository } from "./repositories/sqliteBriefingRepository";
import { SqliteRoomSessionRepository } from "./repositories/sqliteRoomSessionRepository";
import { SqliteWorkerRoundRepository } from "./repositories/sqliteWorkerRoundRepository";
import { ROOM_APP_MESSAGES, ROOM_LOG_EVENT_NAMES } from "./shared/messages";
import { createLogger, type LogLevel } from "./shared/logger";
import { LaunchRoomSessionService } from "./services/launchRoomSessionService";
import { RunWorkerRoundStubService } from "./services/runWorkerRoundStubService";
import { StartRoomSessionService } from "./services/startRoomSessionService";
import { SummarizeRoomSessionService } from "./services/summarizeRoomSessionService";

// 런타임 필수 환경설정 모델
interface AppEnvironment {
  slackBotToken: string;
  slackAppToken: string;
  roomStartChannelId: string;
  roomLaunchChannelId: string;
  sqlitePath: string;
  logLevel: LogLevel;
  port: number;
}

// 부트스트랩 완료 후 앱이 유지해야 하는 실행 자원 묶음
interface AppRuntime {
  app: App;
  sqliteClient: SqliteClient;
  logger: ReturnType<typeof createLogger>;
  environment: AppEnvironment;
}

// 필수 환경변수를 읽고 공백/누락을 검사한다.
function readRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(ROOM_APP_MESSAGES.missingRequiredEnvironmentVariable(name));
  }

  return value.trim();
}

// 문자열 로그 레벨을 안전한 도메인 타입으로 변환한다.
function parseLogLevel(rawLogLevel: string | undefined): LogLevel {
  if (rawLogLevel === "debug" || rawLogLevel === "info" || rawLogLevel === "warn" || rawLogLevel === "error") {
    return rawLogLevel;
  }

  return "info";
}

// PORT 환경변수를 숫자로 파싱하고 유효성을 검증한다.
function parsePort(rawPort: string | undefined): number {
  if (!rawPort) {
    return 3000;
  }

  const parsed = Number(rawPort);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(ROOM_APP_MESSAGES.invalidPort);
  }

  return parsed;
}

// 앱 구동에 필요한 환경값을 모두 로드한다.
function loadAppEnvironment(): AppEnvironment {
  return {
    slackBotToken: readRequiredEnvironmentVariable("SLACK_BOT_TOKEN"),
    slackAppToken: readRequiredEnvironmentVariable("SLACK_APP_TOKEN"),
    roomStartChannelId: readRequiredEnvironmentVariable("ROOM_START_CHANNEL_ID"),
    roomLaunchChannelId: readRequiredEnvironmentVariable("ROOM_LAUNCH_CHANNEL_ID"),
    sqlitePath: readRequiredEnvironmentVariable("SQLITE_PATH"),
    logLevel: parseLogLevel(process.env.LOG_LEVEL),
    port: parsePort(process.env.PORT)
  };
}

// SQLite 연결 및 마이그레이션을 초기화한다.
async function initializePersistence(sqlitePath: string): Promise<SqliteClient> {
  // 지정된 파일 경로로 SQLite 클라이언트를 생성한다.
  const sqliteClient = new SqliteClient(sqlitePath);

  // DB 연결을 열고 필수 PRAGMA를 적용한다.
  await sqliteClient.connect();

  // 프로젝트의 초기 스키마 마이그레이션을 적용한다.
  const migrationPath = path.resolve(process.cwd(), "migrations", "001_init.sql");
  await sqliteClient.runMigrations(migrationPath);
  return sqliteClient;
}

// 앱 실행에 필요한 어댑터/리포지토리/서비스를 조립한다.
// 의존성 주입을 여기서 끝내고 이후 레이어는 인터페이스만 사용한다.
async function createAppRuntime(): Promise<AppRuntime> {
  // .env 파일을 메모리로 로드한다.
  loadEnvironment();

  // 필수 환경값을 검증/파싱해 런타임 설정 모델로 만든다.
  const environment = loadAppEnvironment();

  // 설정된 로그 레벨로 logger 인스턴스를 생성한다.
  const logger = createLogger(environment.logLevel);

  // DB 연결/마이그레이션을 완료한 클라이언트를 준비한다.
  const sqliteClient = await initializePersistence(environment.sqlitePath);

  // 영속 계층 구현체를 조립한다.
  const roomSessionRepository = new SqliteRoomSessionRepository(sqliteClient.getDatabase());
  const briefingRepository = new SqliteBriefingRepository(sqliteClient.getDatabase());
  const workerRoundRepository = new SqliteWorkerRoundRepository(sqliteClient.getDatabase());

  // inbound 핸들러에 필요한 서비스 의존성을 모두 주입한다.
  const roomCommandHandler = createRoomCommandHandler({
    startChannelId: environment.roomStartChannelId,
    launchChannelId: environment.roomLaunchChannelId,
    startRoomSessionService: new StartRoomSessionService(roomSessionRepository, briefingRepository, logger),
    summarizeRoomSessionService: new SummarizeRoomSessionService(
      roomSessionRepository,
      briefingRepository,
      workerRoundRepository,
      logger
    ),
    launchRoomSessionService: new LaunchRoomSessionService(
      roomSessionRepository,
      workerRoundRepository,
      new RunWorkerRoundStubService(),
      logger
    ),
    createSlackThreadPort: (client) => new SlackThreadAdapter(client),
    logger
  });

  // Slack Bolt 앱 인스턴스를 생성하고 `/room`을 바인딩한다.
  const app = createBoltApp({
    botToken: environment.slackBotToken,
    appToken: environment.slackAppToken,
    roomCommandHandler,
    logLevel: environment.logLevel,
    logger
  });

  return { app, sqliteClient, logger, environment };
}

// 프로세스 종료 시 리소스를 안전하게 정리하기 위한 시그널 핸들러를 등록한다.
function registerShutdownHandlers(runtime: AppRuntime): void {
  const shutdown = async (): Promise<void> => {
    // 종료 시작 로그를 먼저 남긴다.
    runtime.logger.info(ROOM_LOG_EVENT_NAMES.appStopping);

    // Slack 앱 수신 루프를 중단한다.
    await runtime.app.stop();

    // DB 연결을 닫아 파일 핸들 누수를 방지한다.
    await runtime.sqliteClient.close();

    // 종료 핸들러 완료 후 프로세스를 정상 종료한다.
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

// 서버 부트스트랩 엔트리포인트
// runtime 생성 -> Slack app 시작 -> 시작 로그 -> 종료 훅 등록 순서로 동작한다.
async function bootstrap(): Promise<void> {
  // 런타임 의존성 조립을 먼저 완료한다.
  const runtime = await createAppRuntime();

  // Slack 앱을 지정 포트로 시작한다.
  await runtime.app.start(runtime.environment.port);

  runtime.logger.info(ROOM_LOG_EVENT_NAMES.appStarted, {
    port: runtime.environment.port,
    startChannelId: runtime.environment.roomStartChannelId,
    launchChannelId: runtime.environment.roomLaunchChannelId
  });

  registerShutdownHandlers(runtime);
}

// 최상위 예외를 처리해 원인 메시지를 출력하고 비정상 종료 코드로 종료한다.
void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : ROOM_APP_MESSAGES.unknownBootstrapError;
  console.error(message);
  process.exit(1);
});

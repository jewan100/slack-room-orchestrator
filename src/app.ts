import fs from "node:fs";
import path from "node:path";
import { config as loadEnvironment } from "dotenv";
import type { App } from "@slack/bolt";
import { createBoltApp } from "./adapters/inbound/slack/boltAppFactory";
import { createRoomCommandHandler } from "./adapters/inbound/slack/roomCommandHandler";
import { SqliteClient } from "./adapters/outbound/persistence/sqliteClient";
import { SlackThreadAdapter } from "./adapters/outbound/slack/slackThreadAdapter";
import { createOpenClawRuntime } from "./bootstrap/openclawRuntimeFactory";
import { SqliteBriefingRepository } from "./repositories/sqliteBriefingRepository";
import { SqliteOpenclawEventOutboxRepository } from "./repositories/sqliteOpenclawEventOutboxRepository";
import { SqliteRoomSessionRepository } from "./repositories/sqliteRoomSessionRepository";
import { SqliteRoomThreadMessageRepository } from "./repositories/sqliteRoomThreadMessageRepository";
import { SqliteRoomWatchTargetRepository } from "./repositories/sqliteRoomWatchTargetRepository";
import { SqliteWorkerRoundRepository } from "./repositories/sqliteWorkerRoundRepository";
import {
  ROOM_APP_MESSAGES,
  ROOM_LOG_EVENT_NAMES,
  ROOM_OPENCLAW_DEFAULTS,
  ROOM_OPENCLAW_MESSAGES
} from "./shared/messages";
import { createLogger, normalizeLogLevel, type LogLevel } from "./shared/logger";
import type { RoomModeLifecycleService } from "./shared/types";
import { LaunchRoomSessionService } from "./services/launchRoomSessionService";
import { RunWorkerRoundStubService } from "./services/runWorkerRoundStubService";
import { StartRoomSessionService } from "./services/startRoomSessionService";
import { SummarizeRoomSessionService } from "./services/summarizeRoomSessionService";
import type { OpenClawIntervalRunner } from "./services/openclaw/openClawIntervalRunner";

// 런타임 필수 환경설정 모델
interface AppEnvironment {
  slackBotToken: string;
  slackAppToken: string;
  roomStartChannelId: string;
  roomLaunchChannelId: string;
  sqlitePath: string;
  openClawEventsFilePath: string;
  roomModeTtlMinutes: number;
  roomAutoSummaryMessageThreshold: number;
  roomAutoQuestionIntervalMinutes: number;
  openClawOutboxDispatchIntervalMs: number;
  logLevel: LogLevel;
  port: number;
}

// 앱 내부 조립 단계에서 재사용하는 저장소 묶음
interface AppRepositories {
  roomSessionRepository: SqliteRoomSessionRepository;
  briefingRepository: SqliteBriefingRepository;
  workerRoundRepository: SqliteWorkerRoundRepository;
  roomWatchTargetRepository: SqliteRoomWatchTargetRepository;
  roomThreadMessageRepository: SqliteRoomThreadMessageRepository;
  openClawEventOutboxRepository: SqliteOpenclawEventOutboxRepository;
}

// 부트스트랩 완료 후 앱이 유지해야 하는 실행 자원 묶음
interface AppRuntime {
  app: App;
  sqliteClient: SqliteClient;
  logger: ReturnType<typeof createLogger>;
  environment: AppEnvironment;
  openClawSchedulers: OpenClawIntervalRunner[];
}

// 필수 환경변수를 읽고 공백/누락을 검사한다.
function readRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(ROOM_APP_MESSAGES.missingRequiredEnvironmentVariable(name));
  }

  return value.trim();
}

// 양수 정수 환경변수를 파싱한다.
function parsePositiveIntegerEnvironmentVariable(
  name: string,
  rawValue: string | undefined,
  defaultValue: number
): number {
  if (!rawValue || rawValue.trim().length === 0) {
    return defaultValue;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(ROOM_OPENCLAW_MESSAGES.invalidPositiveInteger(name));
  }

  return parsed;
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
    openClawEventsFilePath: process.env.OPENCLAW_EVENTS_FILE_PATH?.trim() || ROOM_OPENCLAW_DEFAULTS.eventsFilePath,
    roomModeTtlMinutes: parsePositiveIntegerEnvironmentVariable(
      "ROOM_MODE_TTL_MINUTES",
      process.env.ROOM_MODE_TTL_MINUTES,
      ROOM_OPENCLAW_DEFAULTS.modeTtlMinutes
    ),
    roomAutoSummaryMessageThreshold: parsePositiveIntegerEnvironmentVariable(
      "ROOM_AUTO_SUMMARY_MESSAGE_THRESHOLD",
      process.env.ROOM_AUTO_SUMMARY_MESSAGE_THRESHOLD,
      ROOM_OPENCLAW_DEFAULTS.autoSummaryMessageThreshold
    ),
    roomAutoQuestionIntervalMinutes: parsePositiveIntegerEnvironmentVariable(
      "ROOM_AUTO_QUESTION_INTERVAL_MINUTES",
      process.env.ROOM_AUTO_QUESTION_INTERVAL_MINUTES,
      ROOM_OPENCLAW_DEFAULTS.autoQuestionIntervalMinutes
    ),
    openClawOutboxDispatchIntervalMs: parsePositiveIntegerEnvironmentVariable(
      "OPENCLAW_OUTBOX_DISPATCH_INTERVAL_MS",
      process.env.OPENCLAW_OUTBOX_DISPATCH_INTERVAL_MS,
      ROOM_OPENCLAW_DEFAULTS.outboxDispatchIntervalMs
    ),
    logLevel: normalizeLogLevel(process.env.LOG_LEVEL),
    port: parsePort(process.env.PORT)
  };
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

// SQLite 연결 및 마이그레이션을 초기화한다.
async function initializePersistence(sqlitePath: string): Promise<SqliteClient> {
  const sqliteClient = new SqliteClient(sqlitePath);
  await sqliteClient.connect();
  await runAllMigrations(sqliteClient);
  return sqliteClient;
}

// 저장소 구현체를 한 번에 조립한다.
function createRepositories(sqliteClient: SqliteClient): AppRepositories {
  const database = sqliteClient.getDatabase();

  return {
    roomSessionRepository: new SqliteRoomSessionRepository(database),
    briefingRepository: new SqliteBriefingRepository(database),
    workerRoundRepository: new SqliteWorkerRoundRepository(database),
    roomWatchTargetRepository: new SqliteRoomWatchTargetRepository(database),
    roomThreadMessageRepository: new SqliteRoomThreadMessageRepository(database),
    openClawEventOutboxRepository: new SqliteOpenclawEventOutboxRepository(database)
  };
}

// room 커맨드 핸들러를 조립한다.
function createRoomCommandRuntime(input: {
  repositories: AppRepositories;
  environment: AppEnvironment;
  roomModeLifecycleService: RoomModeLifecycleService;
  logger: ReturnType<typeof createLogger>;
}): ReturnType<typeof createRoomCommandHandler> {
  return createRoomCommandHandler({
    startChannelId: input.environment.roomStartChannelId,
    launchChannelId: input.environment.roomLaunchChannelId,
    startRoomSessionService: new StartRoomSessionService(
      input.repositories.roomSessionRepository,
      input.repositories.briefingRepository,
      input.logger,
      {
        roomModeLifecycleService: input.roomModeLifecycleService,
        roomModeTtlMinutes: input.environment.roomModeTtlMinutes
      }
    ),
    summarizeRoomSessionService: new SummarizeRoomSessionService(
      input.repositories.roomSessionRepository,
      input.repositories.briefingRepository,
      input.repositories.workerRoundRepository,
      input.logger
    ),
    launchRoomSessionService: new LaunchRoomSessionService({
      roomSessionRepository: input.repositories.roomSessionRepository,
      briefingRepository: input.repositories.briefingRepository,
      workerRoundRepository: input.repositories.workerRoundRepository,
      runWorkerRoundStubService: new RunWorkerRoundStubService(),
      roomModeLifecycleService: input.roomModeLifecycleService,
      logger: input.logger
    }),
    createSlackThreadPort: (client) => new SlackThreadAdapter(client),
    logger: input.logger
  });
}

// 앱 실행에 필요한 어댑터/리포지토리/서비스를 조립한다.
async function createAppRuntime(): Promise<AppRuntime> {
  loadEnvironment();
  const environment = loadAppEnvironment();
  const logger = createLogger(environment.logLevel);
  const sqliteClient = await initializePersistence(environment.sqlitePath);

  const repositories = createRepositories(sqliteClient);
  const openClawRuntime = createOpenClawRuntime({
    repositories,
    environment,
    logger
  });

  const roomCommandHandler = createRoomCommandRuntime({
    repositories,
    environment,
    roomModeLifecycleService: openClawRuntime.roomModeLifecycleService,
    logger
  });

  const app = createBoltApp({
    botToken: environment.slackBotToken,
    appToken: environment.slackAppToken,
    roomCommandHandler,
    roomThreadMessageHandler: openClawRuntime.roomThreadEventHandler,
    logLevel: environment.logLevel,
    logger
  });

  return {
    app,
    sqliteClient,
    logger,
    environment,
    openClawSchedulers: openClawRuntime.openClawSchedulers
  };
}

// OpenClaw 스케줄러를 모두 시작한다.
function startOpenClawSchedulers(runtime: AppRuntime): void {
  for (const scheduler of runtime.openClawSchedulers) {
    scheduler.start();
  }

  runtime.logger.info(ROOM_LOG_EVENT_NAMES.openclawSchedulerStarted, {
    schedulerCount: runtime.openClawSchedulers.length,
    roomModeTtlMinutes: runtime.environment.roomModeTtlMinutes,
    summaryThreshold: runtime.environment.roomAutoSummaryMessageThreshold,
    questionIntervalMinutes: runtime.environment.roomAutoQuestionIntervalMinutes,
    dispatchIntervalMs: runtime.environment.openClawOutboxDispatchIntervalMs,
    eventsFilePath: runtime.environment.openClawEventsFilePath
  });
}

// OpenClaw 스케줄러를 모두 멈추고, 실행 중인 작업 완료를 기다린다.
async function stopOpenClawSchedulers(runtime: AppRuntime): Promise<void> {
  for (const scheduler of runtime.openClawSchedulers) {
    await scheduler.stop();
  }

  runtime.logger.info(ROOM_LOG_EVENT_NAMES.openclawSchedulerStopped, {
    schedulerCount: runtime.openClawSchedulers.length
  });
}

// 프로세스 종료 시 리소스를 안전하게 정리하기 위한 시그널 핸들러를 등록한다.
function registerShutdownHandlers(runtime: AppRuntime): void {
  let shutdownInProgress = false;

  const resolveShutdownErrorMessage = (error: unknown): string => {
    if (error instanceof Error) {
      return error.message;
    }

    return ROOM_APP_MESSAGES.unknownShutdownError;
  };

  const shutdown = async (signal: "SIGINT" | "SIGTERM"): Promise<void> => {
    runtime.logger.info(ROOM_LOG_EVENT_NAMES.appStopping, { signal });
    await stopOpenClawSchedulers(runtime);
    await runtime.app.stop();
    await runtime.sqliteClient.close();
    process.exit(0);
  };

  const runShutdown = (signal: "SIGINT" | "SIGTERM"): void => {
    if (shutdownInProgress) {
      return;
    }
    shutdownInProgress = true;

    void shutdown(signal).catch((error: unknown) => {
      runtime.logger.error(ROOM_LOG_EVENT_NAMES.appStopFailed, {
        signal,
        errorMessage: resolveShutdownErrorMessage(error)
      });
      process.exit(1);
    });
  };

  process.on("SIGINT", () => {
    runShutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    runShutdown("SIGTERM");
  });
}

// 서버 부트스트랩 엔트리포인트
// runtime 생성 -> Slack app 시작 -> 스케줄러 시작 -> 시작 로그 -> 종료 훅 등록 순서로 동작한다.
async function bootstrap(): Promise<void> {
  const runtime = await createAppRuntime();
  await runtime.app.start(runtime.environment.port);
  startOpenClawSchedulers(runtime);

  runtime.logger.info(ROOM_LOG_EVENT_NAMES.appStarted, {
    port: runtime.environment.port,
    startChannelId: runtime.environment.roomStartChannelId,
    launchChannelId: runtime.environment.roomLaunchChannelId,
    eventsFilePath: runtime.environment.openClawEventsFilePath
  });

  registerShutdownHandlers(runtime);
}

// 최상위 예외를 처리해 원인 메시지를 출력하고 비정상 종료 코드로 종료한다.
void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : ROOM_APP_MESSAGES.unknownBootstrapError;
  console.error(message);
  process.exit(1);
});

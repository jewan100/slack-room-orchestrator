import { createRoomThreadEventHandler } from "../adapters/inbound/slack/roomThreadEventHandler";
import { OpenclawEventFileAdapter } from "../adapters/outbound/openclaw/openclawEventFileAdapter";
import { ROOM_LOG_EVENT_NAMES, ROOM_OPENCLAW_DEFAULTS, ROOM_OPENCLAW_MESSAGES } from "../shared/messages";
import type { Logger } from "../shared/logger";
import type {
  OpenClawEventOutboxRepository,
  RoomModeLifecycleService,
  RoomSessionRepository,
  RoomThreadMessageRepository,
  RoomWatchTargetRepository
} from "../shared/types";
import { DispatchOpenclawOutboxService } from "../services/openclaw/dispatchOpenclawOutboxService";
import { EmitQuestionTriggerService } from "../services/openclaw/emitQuestionTriggerService";
import { ExpireRoomModeService } from "../services/openclaw/expireRoomModeService";
import { IngestRoomThreadMessageService } from "../services/openclaw/ingestRoomThreadMessageService";
import { ManageRoomModeService } from "../services/openclaw/manageRoomModeService";
import { OpenClawIntervalRunner } from "../services/openclaw/openClawIntervalRunner";

// OpenClaw 런타임 조립에 필요한 환경값 모델
export interface OpenClawRuntimeEnvironment {
  openClawEventsFilePath: string;
  roomAutoSummaryMessageThreshold: number;
  roomAutoQuestionIntervalMinutes: number;
  openClawOutboxDispatchIntervalMs: number;
}

// OpenClaw 런타임 조립에 필요한 저장소 포트 모델
export interface OpenClawRuntimeRepositories {
  roomSessionRepository: RoomSessionRepository;
  roomWatchTargetRepository: RoomWatchTargetRepository;
  roomThreadMessageRepository: RoomThreadMessageRepository;
  openClawEventOutboxRepository: OpenClawEventOutboxRepository;
}

// OpenClaw 런타임 조립 결과 모델
export interface OpenClawRuntimeComponents {
  roomModeLifecycleService: RoomModeLifecycleService;
  roomThreadEventHandler: ReturnType<typeof createRoomThreadEventHandler>;
  openClawSchedulers: OpenClawIntervalRunner[];
}

// OpenClaw 백그라운드 서비스 묶음 모델
interface OpenClawBackgroundServices {
  expireRoomModeService: ExpireRoomModeService;
  emitQuestionTriggerService: EmitQuestionTriggerService;
  dispatchOpenClawOutboxService: DispatchOpenclawOutboxService;
}

// OpenClaw 스케줄러 오류를 표준 포맷으로 기록한다.
function logSchedulerFailure(input: {
  logger: Logger;
  task: string;
  logEventName: string;
  fallbackErrorMessage: string;
  error: unknown;
}): void {
  input.logger.error(input.logEventName, {
    task: input.task,
    errorMessage: input.error instanceof Error ? input.error.message : input.fallbackErrorMessage
  });
}

// OpenClaw 스케줄러를 조립한다.
function createOpenClawSchedulers(input: {
  environment: OpenClawRuntimeEnvironment;
  logger: Logger;
  backgroundServices: OpenClawBackgroundServices;
}): OpenClawIntervalRunner[] {
  return [
    new OpenClawIntervalRunner(ROOM_OPENCLAW_DEFAULTS.lifecycleScanIntervalMs, async () => {
      await input.backgroundServices.expireRoomModeService.execute();
    }, (error: unknown) => {
      logSchedulerFailure({
        logger: input.logger,
        task: "expire_room_mode",
        logEventName: ROOM_LOG_EVENT_NAMES.openclawLifecycleFailed,
        fallbackErrorMessage: ROOM_OPENCLAW_MESSAGES.unknownLifecycleError,
        error
      });
    }),
    new OpenClawIntervalRunner(ROOM_OPENCLAW_DEFAULTS.lifecycleScanIntervalMs, async () => {
      await input.backgroundServices.emitQuestionTriggerService.execute();
    }, (error: unknown) => {
      logSchedulerFailure({
        logger: input.logger,
        task: "emit_question_trigger",
        logEventName: ROOM_LOG_EVENT_NAMES.openclawLifecycleFailed,
        fallbackErrorMessage: ROOM_OPENCLAW_MESSAGES.unknownLifecycleError,
        error
      });
    }),
    new OpenClawIntervalRunner(input.environment.openClawOutboxDispatchIntervalMs, async () => {
      await input.backgroundServices.dispatchOpenClawOutboxService.execute();
    }, (error: unknown) => {
      logSchedulerFailure({
        logger: input.logger,
        task: "dispatch_openclaw_outbox",
        logEventName: ROOM_LOG_EVENT_NAMES.openclawOutboxDispatchFailed,
        fallbackErrorMessage: ROOM_OPENCLAW_MESSAGES.unknownDispatchError,
        error
      });
    })
  ];
}

// OpenClaw 백그라운드 서비스(만료/질문/디스패치)를 조립한다.
function createOpenClawBackgroundServices(input: {
  repositories: OpenClawRuntimeRepositories;
  environment: OpenClawRuntimeEnvironment;
  logger: Logger;
}): OpenClawBackgroundServices {
  const openClawEventSink = new OpenclawEventFileAdapter(input.environment.openClawEventsFilePath);

  return {
    expireRoomModeService: new ExpireRoomModeService({
      roomWatchTargetRepository: input.repositories.roomWatchTargetRepository,
      roomSessionRepository: input.repositories.roomSessionRepository,
      openClawEventOutboxRepository: input.repositories.openClawEventOutboxRepository,
      batchSize: ROOM_OPENCLAW_DEFAULTS.lifecycleBatchSize,
      logger: input.logger
    }),
    emitQuestionTriggerService: new EmitQuestionTriggerService({
      roomWatchTargetRepository: input.repositories.roomWatchTargetRepository,
      roomSessionRepository: input.repositories.roomSessionRepository,
      openClawEventOutboxRepository: input.repositories.openClawEventOutboxRepository,
      questionIntervalMinutes: input.environment.roomAutoQuestionIntervalMinutes,
      batchSize: ROOM_OPENCLAW_DEFAULTS.lifecycleBatchSize,
      logger: input.logger
    }),
    dispatchOpenClawOutboxService: new DispatchOpenclawOutboxService({
      openClawEventOutboxRepository: input.repositories.openClawEventOutboxRepository,
      openClawEventSink,
      retryDelayMs: input.environment.openClawOutboxDispatchIntervalMs,
      batchSize: ROOM_OPENCLAW_DEFAULTS.outboxBatchSize,
      logger: input.logger
    })
  };
}

// OpenClaw 연동 서비스/핸들러/스케줄러를 조립한다.
export function createOpenClawRuntime(input: {
  repositories: OpenClawRuntimeRepositories;
  environment: OpenClawRuntimeEnvironment;
  logger: Logger;
}): OpenClawRuntimeComponents {
  const roomModeLifecycleService = new ManageRoomModeService(
    input.repositories.roomWatchTargetRepository,
    input.repositories.openClawEventOutboxRepository,
    input.logger
  );

  const roomThreadMessageIngestService = new IngestRoomThreadMessageService({
    roomWatchTargetRepository: input.repositories.roomWatchTargetRepository,
    roomThreadMessageRepository: input.repositories.roomThreadMessageRepository,
    roomSessionRepository: input.repositories.roomSessionRepository,
    openClawEventOutboxRepository: input.repositories.openClawEventOutboxRepository,
    summaryMessageThreshold: input.environment.roomAutoSummaryMessageThreshold,
    logger: input.logger
  });

  const backgroundServices = createOpenClawBackgroundServices({
    repositories: input.repositories,
    environment: input.environment,
    logger: input.logger
  });

  return {
    roomModeLifecycleService,
    roomThreadEventHandler: createRoomThreadEventHandler({
      roomThreadMessageIngestService,
      logger: input.logger
    }),
    openClawSchedulers: createOpenClawSchedulers({
      environment: input.environment,
      logger: input.logger,
      backgroundServices
    })
  };
}

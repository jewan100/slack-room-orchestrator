import { parseRoomCommand } from "../../../commands/roomCommandRouter";
import { ROOM_COMMAND_MESSAGES, ROOM_LOG_EVENT_NAMES } from "../../../shared/messages";
import { ROOM_ERROR_CODES } from "../../../shared/errorCodes";
import type { Logger } from "../../../shared/logger";
import { RoomCommandError, normalizeRoomCommandError } from "../../../shared/roomCommandError";
import type { ParsedRoomCommand, RoomCommandRequest, SlackChatClient, SlackThreadPort } from "../../../shared/types";
export interface StartRoomSessionServicePort {
  execute(
    input: {
      requestedByUserId: string;
      workspaceId: string;
      startChannelId: string;
    },
    slackThreadPort: SlackThreadPort
  ): Promise<{ session: { id: string; state: string; startThreadTs: string } }>;
}
export interface LaunchRoomSessionServicePort {
  execute(
    input: {
      startChannelId: string;
      launchChannelId: string;
    },
    slackThreadPort: SlackThreadPort
  ): Promise<{ session: { id: string; state: string; launchThreadTs: string | null }; round: { roundNo: number } }>;
}
export interface StopRoomSessionServicePort {
  execute(input: { startChannelId: string }): Promise<{ session: { id: string; state: string; startThreadTs: string } }>;
}
export interface RoomCommandHandlerDependencies {
  startChannelId: string;
  launchChannelId: string;
  startRoomSessionService: StartRoomSessionServicePort;
  launchRoomSessionService: LaunchRoomSessionServicePort;
  stopRoomSessionService: StopRoomSessionServicePort;
  createSlackThreadPort: (client: SlackChatClient) => SlackThreadPort;
  logger: Logger;
}
interface RoomCommandRuntimeContext {
  requestId: string;
  startedAt: number;
  parsedCommand: ParsedRoomCommand | null;
}
function resolveTargetChannelId(
  dependencies: RoomCommandHandlerDependencies,
  parsedCommand: ParsedRoomCommand | null
): string | null {
  if (!parsedCommand || parsedCommand.kind === "invalid") {
    return null;
  }
  if (parsedCommand.kind === "launch") {
    return dependencies.launchChannelId;
  }
  return dependencies.startChannelId;
}
async function handleStartCommand(input: {
  dependencies: RoomCommandHandlerDependencies;
  request: RoomCommandRequest;
  slackThreadPort: SlackThreadPort;
}): Promise<void> {
  await input.dependencies.startRoomSessionService.execute(
    {
      requestedByUserId: input.request.command.userId,
      workspaceId: input.request.command.teamId,
      startChannelId: input.dependencies.startChannelId
    },
    input.slackThreadPort
  );
}
async function handleLaunchCommand(input: {
  dependencies: RoomCommandHandlerDependencies;
  request: RoomCommandRequest;
  slackThreadPort: SlackThreadPort;
}): Promise<void> {
  await input.dependencies.launchRoomSessionService.execute(
    {
      startChannelId: input.dependencies.startChannelId,
      launchChannelId: input.dependencies.launchChannelId
    },
    input.slackThreadPort
  );
}
async function handleStopCommand(input: {
  dependencies: RoomCommandHandlerDependencies;
  request: RoomCommandRequest;
  slackThreadPort: SlackThreadPort;
}): Promise<void> {
  const result = await input.dependencies.stopRoomSessionService.execute({
    startChannelId: input.dependencies.startChannelId
  });

  // stop 성공은 스레드에 "종료" 안내를 남기는 것이 핵심 UX다.
  // 이 전송이 실패하면 사용자는 성공 여부를 확인할 수 없으므로 예외를 올린다.
  await input.slackThreadPort.postMessageInThread({
    channelId: input.dependencies.startChannelId,
    threadTs: result.session.startThreadTs,
    text: ROOM_COMMAND_MESSAGES.stopSuccessText
  });
}
function logCommandPhaseCompletion(input: {
  dependencies: RoomCommandHandlerDependencies;
  runtimeContext: RoomCommandRuntimeContext;
  request: RoomCommandRequest;
  phase: ParsedRoomCommand["kind"];
  elapsedMs: number;
}): void {
  input.dependencies.logger.info(ROOM_LOG_EVENT_NAMES.roomCommandPhaseCompleted, {
    requestId: input.runtimeContext.requestId,
    command: input.request.command.text,
    phase: input.phase,
    invokedChannelId: input.request.command.channelId,
    targetChannelId: resolveTargetChannelId(input.dependencies, input.runtimeContext.parsedCommand),
    elapsedMs: input.elapsedMs
  });
}
async function executeAndLogCommandPhase(input: {
  dependencies: RoomCommandHandlerDependencies;
  runtimeContext: RoomCommandRuntimeContext;
  request: RoomCommandRequest;
  phase: "start" | "launch" | "stop";
  action: () => Promise<void>;
}): Promise<void> {
  const phaseStartedAt = Date.now();
  await input.action();
  logCommandPhaseCompletion({
    dependencies: input.dependencies,
    runtimeContext: input.runtimeContext,
    request: input.request,
    phase: input.phase,
    elapsedMs: Date.now() - phaseStartedAt
  });
}
async function executeStartCommandPhase(input: {
  dependencies: RoomCommandHandlerDependencies;
  request: RoomCommandRequest;
  runtimeContext: RoomCommandRuntimeContext;
  slackThreadPort: SlackThreadPort;
}): Promise<void> {
  await executeAndLogCommandPhase({
    dependencies: input.dependencies,
    runtimeContext: input.runtimeContext,
    request: input.request,
    phase: "start",
    action: async () => {
      await handleStartCommand({
        dependencies: input.dependencies,
        request: input.request,
        slackThreadPort: input.slackThreadPort
      });
    }
  });
}
async function executeStopCommandPhase(input: {
  dependencies: RoomCommandHandlerDependencies;
  request: RoomCommandRequest;
  runtimeContext: RoomCommandRuntimeContext;
  slackThreadPort: SlackThreadPort;
}): Promise<void> {
  await executeAndLogCommandPhase({
    dependencies: input.dependencies,
    runtimeContext: input.runtimeContext,
    request: input.request,
    phase: "stop",
    action: async () => {
      await handleStopCommand({
        dependencies: input.dependencies,
        request: input.request,
        slackThreadPort: input.slackThreadPort,
      });
    }
  });
}
async function executeLaunchCommandPhase(input: {
  dependencies: RoomCommandHandlerDependencies;
  request: RoomCommandRequest;
  runtimeContext: RoomCommandRuntimeContext;
  slackThreadPort: SlackThreadPort;
}): Promise<void> {
  await executeAndLogCommandPhase({
    dependencies: input.dependencies,
    runtimeContext: input.runtimeContext,
    request: input.request,
    phase: "launch",
    action: async () => {
      await handleLaunchCommand({
        dependencies: input.dependencies,
        request: input.request,
        slackThreadPort: input.slackThreadPort,
      });
    }
  });
}
async function handleParsedCommand(
  dependencies: RoomCommandHandlerDependencies,
  request: RoomCommandRequest,
  parsedCommand: ParsedRoomCommand,
  runtimeContext: RoomCommandRuntimeContext
): Promise<void> {
  // invalid/help는 inbound adapter fast-path에서만 처리한다.
  // 이 경로로 들어오는 것은 내부 라우팅 실수이므로 명시적으로 실패시킨다.
  if (parsedCommand.kind === "invalid" || parsedCommand.kind === "help") {
    throw new RoomCommandError(ROOM_ERROR_CODES.ROOM_INVALID_COMMAND);
  }
  const slackThreadPort = dependencies.createSlackThreadPort(request.client);
  if (parsedCommand.kind === "start") {
    await executeStartCommandPhase({
      dependencies,
      request,
      runtimeContext,
      slackThreadPort
    });
    return;
  }

  if (parsedCommand.kind === "stop") {
    await executeStopCommandPhase({
      dependencies,
      request,
      runtimeContext,
      slackThreadPort
    });
    return;
  }

  await executeLaunchCommandPhase({
    dependencies,
    request,
    runtimeContext,
    slackThreadPort
  });
}
function logCommandCompletion(
  dependencies: RoomCommandHandlerDependencies,
  request: RoomCommandRequest,
  runtimeContext: RoomCommandRuntimeContext
): void {
  dependencies.logger.info(ROOM_LOG_EVENT_NAMES.roomCommandCompleted, {
    requestId: runtimeContext.requestId,
    invokedChannelId: request.command.channelId,
    targetChannelId: resolveTargetChannelId(dependencies, runtimeContext.parsedCommand),
    startChannelId: dependencies.startChannelId,
    launchChannelId: dependencies.launchChannelId,
    command: request.command.text,
    elapsedMs: Date.now() - runtimeContext.startedAt
  });
}
function logAndNormalizeFailure(
  dependencies: RoomCommandHandlerDependencies,
  request: RoomCommandRequest,
  error: unknown,
  runtimeContext: RoomCommandRuntimeContext
): RoomCommandError {
  const normalizedError = normalizeRoomCommandError(error);
  dependencies.logger.error(ROOM_LOG_EVENT_NAMES.roomCommandFailed, {
    requestId: runtimeContext.requestId,
    invokedChannelId: request.command.channelId,
    targetChannelId: resolveTargetChannelId(dependencies, runtimeContext.parsedCommand),
    startChannelId: dependencies.startChannelId,
    launchChannelId: dependencies.launchChannelId,
    command: request.command.text,
    errorCode: normalizedError.code,
    errorMessage: normalizedError.message,
    internalErrorMessage: normalizedError.details?.internalErrorMessage,
    elapsedMs: Date.now() - runtimeContext.startedAt
  });
  return normalizedError;
}
export function createRoomCommandHandler(
  dependencies: RoomCommandHandlerDependencies
): (request: RoomCommandRequest) => Promise<void> {
  return async (request: RoomCommandRequest): Promise<void> => {
    const runtimeContext: RoomCommandRuntimeContext = {
      requestId: request.requestId,
      startedAt: request.startedAt,
      parsedCommand: null
    };
    try {
      runtimeContext.parsedCommand = parseRoomCommand(request.command.text);
      await handleParsedCommand(dependencies, request, runtimeContext.parsedCommand, runtimeContext);
      logCommandCompletion(dependencies, request, runtimeContext);
    } catch (error) {
      throw logAndNormalizeFailure(dependencies, request, error, runtimeContext);
    }
  };
}

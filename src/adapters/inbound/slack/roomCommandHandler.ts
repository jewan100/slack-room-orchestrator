import { randomUUID } from "node:crypto";
import { parseRoomCommand } from "../../../commands/roomCommandRouter";
import { formatCommandErrorMessage } from "../../../commands/roomCommandUsage";
import { ROOM_COMMAND_MESSAGES, ROOM_LOG_EVENT_NAMES } from "../../../shared/messages";
import { ROOM_ERROR_CODES } from "../../../shared/errorCodes";
import type { Logger } from "../../../shared/logger";
import { normalizeRoomCommandError } from "../../../shared/roomCommandError";
import type { ParsedRoomCommand, RoomCommandRequest, SlackChatClient, SlackThreadPort } from "../../../shared/types";

// inbound 핸들러가 의존하는 start 서비스 포트
// 실제 구현은 서비스 레이어에서 제공하고 핸들러는 인터페이스만 사용한다.
export interface StartRoomSessionServicePort {
  execute(
    input: {
      topic: string;
      requestedByUserId: string;
      workspaceId: string;
      startChannelId: string;
    },
    slackThreadPort: SlackThreadPort
  ): Promise<{ session: { id: string; state: string } }>;
}

// summary 서비스 포트
export interface SummarizeRoomSessionServicePort {
  execute(input: { startChannelId: string; mode: "brief" | "full" }): Promise<{ summaryText: string }>;
}

// launch 서비스 포트
export interface LaunchRoomSessionServicePort {
  execute(
    input: {
      startChannelId: string;
      launchChannelId: string;
    },
    slackThreadPort: SlackThreadPort
  ): Promise<{ session: { id: string; state: string }; round: { roundNo: number } }>;
}

// 핸들러 조립에 필요한 외부 의존성 묶음
export interface RoomCommandHandlerDependencies {
  startChannelId: string;
  launchChannelId: string;
  startRoomSessionService: StartRoomSessionServicePort;
  summarizeRoomSessionService: SummarizeRoomSessionServicePort;
  launchRoomSessionService: LaunchRoomSessionServicePort;
  createSlackThreadPort: (client: SlackChatClient) => SlackThreadPort;
  logger: Logger;
}

// 한 요청 처리 동안 유지되는 실행 컨텍스트
// requestId/시작시각을 재사용해 로그 상관관계를 유지한다.
interface RoomCommandRuntimeContext {
  requestId: string;
  startedAt: number;
  parsedCommand: ParsedRoomCommand | null;
}

// 파싱 결과를 기준으로 실제 명령이 실행되는 대상 채널을 계산한다.
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

// 파싱 단계에서 invalid로 분류된 요청을 사용자에게 응답하고 경고 로그를 남긴다.
async function handleInvalidCommand(
  dependencies: RoomCommandHandlerDependencies,
  request: RoomCommandRequest,
  parsedCommand: Extract<ParsedRoomCommand, { kind: "invalid" }>,
  runtimeContext: RoomCommandRuntimeContext
): Promise<void> {
  // 파싱 실패 사유를 사용자에게 즉시(ephemeral) 전달한다.
  await request.respond({
    response_type: "ephemeral",
    text: formatCommandErrorMessage(parsedCommand.code, parsedCommand.message)
  });

  // 잘못된 입력 패턴을 분석할 수 있도록 경고 로그를 남긴다.
  dependencies.logger.warn(ROOM_LOG_EVENT_NAMES.roomCommandInvalid, {
    requestId: runtimeContext.requestId,
    command: request.command.text,
    invokedChannelId: request.command.channelId,
    targetChannelId: resolveTargetChannelId(dependencies, parsedCommand),
    startChannelId: dependencies.startChannelId,
    launchChannelId: dependencies.launchChannelId,
    errorCode: parsedCommand.code,
    elapsedMs: Date.now() - runtimeContext.startedAt
  });
}

// `/room start` 성공 응답을 생성한다.
// 실질적인 세션 생성/브리핑 저장은 서비스 레이어가 수행한다.
async function handleStartCommand(
  dependencies: RoomCommandHandlerDependencies,
  request: RoomCommandRequest,
  parsedCommand: Extract<ParsedRoomCommand, { kind: "start" }>,
  slackThreadPort: SlackThreadPort
): Promise<void> {
  // start 유스케이스를 실행해 세션 생성 결과를 받는다.
  const result = await dependencies.startRoomSessionService.execute(
    {
      topic: parsedCommand.topic,
      requestedByUserId: request.command.userId,
      workspaceId: request.command.teamId,
      startChannelId: dependencies.startChannelId
    },
    slackThreadPort
  );

  // 성공 시 사용자에게 세션 id/상태/다음 액션을 안내한다.
  await request.respond({
    response_type: "ephemeral",
    text: ROOM_COMMAND_MESSAGES.startSuccessLines(result.session.id, result.session.state).join("\n")
  });
}

// `/room summary` 결과를 그대로 사용자에게 전달한다.
async function handleSummaryCommand(
  dependencies: RoomCommandHandlerDependencies,
  request: RoomCommandRequest,
  parsedCommand: Extract<ParsedRoomCommand, { kind: "summary" }>
): Promise<void> {
  // summary 유스케이스 결과(완성 텍스트)를 받아온다.
  const result = await dependencies.summarizeRoomSessionService.execute({
    startChannelId: dependencies.startChannelId,
    mode: parsedCommand.mode
  });

  // summary 텍스트를 그대로 사용자에게 응답한다.
  await request.respond({
    response_type: "ephemeral",
    text: result.summaryText
  });
}

// `/room launch` 성공 응답을 생성한다.
async function handleLaunchCommand(
  dependencies: RoomCommandHandlerDependencies,
  request: RoomCommandRequest,
  slackThreadPort: SlackThreadPort
): Promise<void> {
  // launch 유스케이스를 실행해 상태 전이/라운드 결과를 받는다.
  const result = await dependencies.launchRoomSessionService.execute(
    {
      startChannelId: dependencies.startChannelId,
      launchChannelId: dependencies.launchChannelId
    },
    slackThreadPort
  );

  // 성공 시 실행 상태와 다음 액션을 사용자에게 안내한다.
  await request.respond({
    response_type: "ephemeral",
    text: ROOM_COMMAND_MESSAGES.launchSuccessLines(
      result.session.id,
      result.session.state,
      result.round.roundNo
    ).join("\n")
  });
}

// 파싱 결과(kind)에 따라 적절한 유스케이스 핸들러로 분기한다.
async function handleParsedCommand(
  dependencies: RoomCommandHandlerDependencies,
  request: RoomCommandRequest,
  parsedCommand: ParsedRoomCommand,
  runtimeContext: RoomCommandRuntimeContext
): Promise<void> {
  // 파싱 실패 분기는 서비스 호출 없이 즉시 응답/로그 처리한다.
  if (parsedCommand.kind === "invalid") {
    await handleInvalidCommand(dependencies, request, parsedCommand, runtimeContext);
    return;
  }

  // Slack client를 thread 포트로 감싸 서비스 레이어에 전달한다.
  const slackThreadPort = dependencies.createSlackThreadPort(request.client);

  // kind별로 정확한 유스케이스 핸들러를 호출한다.
  if (parsedCommand.kind === "start") {
    await handleStartCommand(dependencies, request, parsedCommand, slackThreadPort);
    return;
  }
  if (parsedCommand.kind === "summary") {
    await handleSummaryCommand(dependencies, request, parsedCommand);
    return;
  }
  await handleLaunchCommand(dependencies, request, slackThreadPort);
}

// 명령 처리 완료 로그를 표준 필드와 함께 기록한다.
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

// 예외를 공통 도메인 오류로 정규화해 응답/로그 포맷을 일치시킨다.
async function respondAndLogFailure(
  dependencies: RoomCommandHandlerDependencies,
  request: RoomCommandRequest,
  error: unknown,
  runtimeContext: RoomCommandRuntimeContext
): Promise<void> {
  // 원시 예외를 공통 도메인 오류로 정규화해 응답 포맷을 맞춘다.
  const normalizedError = normalizeRoomCommandError(error);

  // 장애 분석에 필요한 컨텍스트를 포함해 오류 로그를 남긴다.
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

  // 사용자에게도 동일한 에러코드 체계로 안내한다.
  await request.respond({
    response_type: "ephemeral",
    text: formatCommandErrorMessage(normalizedError.code, normalizedError.message)
  });
}

// Slack slash command 요청의 진입점 핸들러를 생성한다.
// 1) ack 우선 2) 파싱/서비스 실행 3) 공통 오류 처리 흐름을 강제한다.
export function createRoomCommandHandler(
  dependencies: RoomCommandHandlerDependencies
): (request: RoomCommandRequest) => Promise<void> {
  return async (request: RoomCommandRequest): Promise<void> => {
    // 요청 단위 상관관계를 위해 requestId와 시작시각을 즉시 생성한다.
    const runtimeContext: RoomCommandRuntimeContext = {
      requestId: randomUUID(),
      startedAt: Date.now(),
      parsedCommand: null
    };

    // Slack 3초 제한을 맞추기 위해 ack를 가장 먼저 호출한다.
    await request.ack();

    try {
      // 명령 텍스트를 파싱해 kind 기반 처리로 넘긴다.
      runtimeContext.parsedCommand = parseRoomCommand(request.command.text);
      await handleParsedCommand(dependencies, request, runtimeContext.parsedCommand, runtimeContext);

      // 정상 완료 로그를 마지막에 기록한다.
      logCommandCompletion(dependencies, request, runtimeContext);
    } catch (error) {
      // 어떤 단계에서 실패해도 공통 실패 처리 경로를 사용한다.
      await respondAndLogFailure(dependencies, request, error, runtimeContext);
    }
  };
}

// 핸들러 외부에서 사용할 수 있는 기본 내부오류 문구 생성 함수
export function createFallbackCommandErrorText(): string {
  return formatCommandErrorMessage(ROOM_ERROR_CODES.ROOM_INTERNAL_ERROR);
}

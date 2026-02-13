import type { App } from "@slack/bolt";
import type { ActionsBlock } from "@slack/types";
import { parseRoomCommand } from "../../../commands/roomCommandRouter";
import { buildRoomHelpMessage, resolveRoomCommandErrorText } from "../../../commands/roomCommandUsage";
import { ROOM_ACTION_IDS, ROOM_COMMAND_MESSAGES, ROOM_LOG_EVENT_NAMES, ROOM_SLASH_COMMAND } from "../../../shared/messages";
import { normalizeRoomCommandError } from "../../../shared/roomCommandError";
import type { ParsedRoomCommand, RoomCommandRequest, SlackChatClient } from "../../../shared/types";
import {
  createRoomSlashResponseController,
  type RoomSlashAckPayload,
  type RoomSlashReplaceOriginalIntent
} from "./roomSlashResponseController";
import type { BoltAppFactoryOptions } from "./boltAppTypes";
import { extractErrorMessage, resolveSlackEnvelopeRequestId } from "./slackAdapterUtils";

// Slack slash command에서 로깅/UX 제어에 필요한 식별자를 정리한 모델
interface SlashCommandMetadata {
  text: string;
  channelId: string;
  teamId: string;
  userId: string;
  triggerId: string;
}

// Slack 원본 payload 필드명을 앱 내부 표준 모델로 정리한다.
function extractSlashCommandMetadata(command: {
  text: string;
  channel_id: string;
  team_id: string;
  user_id: string;
  trigger_id: string;
}): SlashCommandMetadata {
  return {
    text: command.text,
    channelId: command.channel_id,
    teamId: command.team_id,
    userId: command.user_id,
    triggerId: command.trigger_id
  };
}

// Slack command payload를 내부 RoomCommandRequest로 정규화한다.
function createRoomCommandRequest(input: {
  requestId: string;
  startedAt: number;
  command: SlashCommandMetadata;
  client: SlackChatClient;
}): RoomCommandRequest {
  return {
    requestId: input.requestId,
    startedAt: input.startedAt,
    command: {
      text: input.command.text,
      userId: input.command.userId,
      teamId: input.command.teamId,
      channelId: input.command.channelId
    },
    client: input.client
  };
}

// invalid 명령 응답 버튼(=/room help) block을 생성한다.
function createHelpButtonActionsBlock(): ActionsBlock {
  return {
    type: "actions",
    elements: [
      {
        type: "button",
        action_id: ROOM_ACTION_IDS.openHelp,
        value: "open_room_help",
        text: {
          type: "plain_text",
          text: ROOM_COMMAND_MESSAGES.helpButtonLabel,
          emoji: true
        }
      }
    ]
  };
}

// invalid 입력을 "고정 문구 + help 버튼"으로 유도하는 ack payload를 만든다.
function buildInvalidAckPayload(): RoomSlashAckPayload {
  return {
    text: ROOM_COMMAND_MESSAGES.invalidCommandNotice,
    blocks: [createHelpButtonActionsBlock()]
  };
}

// `/room help` 응답을 ack payload로 만든다.
function buildHelpAckPayload(): RoomSlashAckPayload {
  return {
    text: buildRoomHelpMessage()
  };
}

// `/room start|launch|stop`의 즉시 UX를 "처리 중 1개"로 고정하는 ack payload를 만든다.
function buildProcessingAckPayload(): RoomSlashAckPayload {
  return {
    text: ROOM_COMMAND_MESSAGES.processingNotice
  };
}

function resolveRoomSlashAckPayload(parsedCommand: ParsedRoomCommand): RoomSlashAckPayload {
  if (parsedCommand.kind === "invalid") {
    return buildInvalidAckPayload();
  }
  if (parsedCommand.kind === "help") {
    return buildHelpAckPayload();
  }
  return buildProcessingAckPayload();
}

// ack 후 follow-up 교체에 사용할 에러 문구 intent를 만든다.
function buildErrorReplaceOriginalIntent(input: {
  parsedCommand: ParsedRoomCommand;
  error: unknown;
}): RoomSlashReplaceOriginalIntent {
  const normalizedError = normalizeRoomCommandError(input.error);

  if (input.parsedCommand.kind === "stop" && normalizedError.code === "ROOM_NO_ACTIVE_SESSION") {
    return {
      text: ROOM_COMMAND_MESSAGES.stopNoActiveSessionNotice,
      blocks: [createHelpButtonActionsBlock()]
    };
  }

  return {
    text: resolveRoomCommandErrorText(normalizedError.code, normalizedError.message),
    blocks: [createHelpButtonActionsBlock()]
  };
}

// ack 이후 처리 완료 시간을 공통 포맷으로 기록한다.
function logPostAckCompletion(input: {
  options: BoltAppFactoryOptions;
  requestId: string;
  startedAt: number;
  postAckStartedAt: number;
  route: string;
  command: SlashCommandMetadata;
}): void {
  input.options.logger.info(ROOM_LOG_EVENT_NAMES.slackCommandPostAckCompleted, {
    requestId: input.requestId,
    command: input.command.text,
    channelId: input.command.channelId,
    teamId: input.command.teamId,
    userId: input.command.userId,
    triggerId: input.command.triggerId,
    route: input.route,
    postAckElapsedMs: Date.now() - input.postAckStartedAt,
    totalElapsedMs: Date.now() - input.startedAt
  });
}

// slash 커맨드 ack를 즉시 처리하고, fast-path(=invalid/help)는 여기서 종료한다.
async function ackRoomCommandAndHandleFastPath(input: {
  options: BoltAppFactoryOptions;
  requestId: string;
  startedAt: number;
  command: SlashCommandMetadata;
  parsedCommand: ParsedRoomCommand;
  controller: ReturnType<typeof createRoomSlashResponseController>;
}): Promise<"continue" | "returned"> {
  const ackPayload = resolveRoomSlashAckPayload(input.parsedCommand);

  try {
    await input.controller.ackOnce(ackPayload);
  } catch (error) {
    input.options.logger.error(ROOM_LOG_EVENT_NAMES.slackCommandAckFailed, {
      requestId: input.requestId,
      command: input.command.text,
      channelId: input.command.channelId,
      teamId: input.command.teamId,
      userId: input.command.userId,
      triggerId: input.command.triggerId,
      errorMessage: extractErrorMessage(error),
      elapsedMs: Date.now() - input.startedAt
    });
    return "returned";
  }

  input.options.logger.info(ROOM_LOG_EVENT_NAMES.slackCommandAckCompleted, {
    requestId: input.requestId,
    command: input.command.text,
    channelId: input.command.channelId,
    teamId: input.command.teamId,
    userId: input.command.userId,
    triggerId: input.command.triggerId,
    elapsedMs: Date.now() - input.startedAt
  });

  if (input.parsedCommand.kind === "invalid") {
    input.options.logger.warn(ROOM_LOG_EVENT_NAMES.roomCommandInvalid, {
      requestId: input.requestId,
      command: input.command.text,
      invokedChannelId: input.command.channelId,
      errorCode: input.parsedCommand.code,
      elapsedMs: Date.now() - input.startedAt,
      route: "ack_fast_path"
    });
    return "returned";
  }

  return input.parsedCommand.kind === "help" ? "returned" : "continue";
}

// ack 이후 room command 핸들러를 백그라운드로 실행한다.
function runRoomCommandAfterAck(input: {
  options: BoltAppFactoryOptions;
  requestId: string;
  startedAt: number;
  command: SlashCommandMetadata;
  parsedCommand: ParsedRoomCommand;
  controller: ReturnType<typeof createRoomSlashResponseController>;
  client: SlackChatClient;
}): void {
  const postAckStartedAt = Date.now();

  void runRoomCommandAfterAckInternal({ ...input, postAckStartedAt }).catch((error: unknown) => {
    input.options.logger.error(ROOM_LOG_EVENT_NAMES.slackCommandUnhandledFailure, {
      requestId: input.requestId,
      command: input.command.text,
      channelId: input.command.channelId,
      teamId: input.command.teamId,
      userId: input.command.userId,
      triggerId: input.command.triggerId,
      errorMessage: extractErrorMessage(error),
      route: "post_ack_unhandled"
    });
  });
}

async function runRoomCommandAfterAckInternal(input: {
  options: BoltAppFactoryOptions;
  requestId: string;
  startedAt: number;
  postAckStartedAt: number;
  command: SlashCommandMetadata;
  parsedCommand: ParsedRoomCommand;
  controller: ReturnType<typeof createRoomSlashResponseController>;
  client: SlackChatClient;
}): Promise<void> {
  try {
    const request = createRoomCommandRequest({
      requestId: input.requestId,
      startedAt: input.startedAt,
      command: input.command,
      client: input.client
    });

    // 서비스/도메인 실행은 handler에 위임한다.
    await input.options.roomCommandHandler(request);

    // 성공 시에는 처리 중 메시지 삭제를 best-effort로 시도한다.
    await input.controller.deleteOriginalBestEffort();
  } catch (error) {
    await replaceProcessingNoticeWithErrorBestEffort({
      options: input.options,
      requestId: input.requestId,
      command: input.command,
      parsedCommand: input.parsedCommand,
      controller: input.controller,
      error
    });
  } finally {
    logPostAckCompletion({
      options: input.options,
      requestId: input.requestId,
      startedAt: input.startedAt,
      postAckStartedAt: input.postAckStartedAt,
      route: "room_command_handler",
      command: input.command
    });
  }
}

async function replaceProcessingNoticeWithErrorBestEffort(input: {
  options: BoltAppFactoryOptions;
  requestId: string;
  command: SlashCommandMetadata;
  parsedCommand: ParsedRoomCommand;
  controller: ReturnType<typeof createRoomSlashResponseController>;
  error: unknown;
}): Promise<void> {
  const intent = buildErrorReplaceOriginalIntent({
    parsedCommand: input.parsedCommand,
    error: input.error
  });

  try {
    await input.controller.replaceOriginalOnce(intent);
  } catch (replaceError) {
    input.options.logger.error(ROOM_LOG_EVENT_NAMES.slashCommandFollowupReplaceFailed, {
      requestId: input.requestId,
      command: input.command.text,
      channelId: input.command.channelId,
      teamId: input.command.teamId,
      userId: input.command.userId,
      triggerId: input.command.triggerId,
      errorMessage: extractErrorMessage(replaceError),
      reason: "replace_original_failed"
    });
  }
}

// invalid 응답 버튼 클릭 시 `/room help` 본문을 즉시 반환한다.
export function bindRoomHelpAction(app: App): void {
  app.action(ROOM_ACTION_IDS.openHelp, async ({ ack, respond }) => {
    await ack();

    // action respond는 "버튼이 달린 메시지(=invalid ack 메시지)"를 대상으로 교체한다.
    await respond({
      replace_original: true,
      response_type: "ephemeral",
      text: buildRoomHelpMessage()
    });
  });
}

// room command 핸들러를 ack 이후 백그라운드로 실행한다.
export function bindRoomCommand(app: App, options: BoltAppFactoryOptions): void {
  app.command(ROOM_SLASH_COMMAND, async ({ ack, command, respond, client, body }) => {
    const requestId = resolveSlackEnvelopeRequestId(body);
    const startedAt = Date.now();
    const commandMetadata = extractSlashCommandMetadata(command);
    const parsedCommand = parseRoomCommand(command.text);

    const controller = createRoomSlashResponseController({
      logger: options.logger,
      requestId,
      ack,
      respond,
      command: commandMetadata
    });

    const ackOutcome = await ackRoomCommandAndHandleFastPath({
      options,
      requestId,
      startedAt,
      command: commandMetadata,
      parsedCommand,
      controller
    });
    if (ackOutcome === "returned") {
      return;
    }

    // ack 이후에는 바로 반환하고, 실제 처리 흐름은 백그라운드로 넘긴다.
    runRoomCommandAfterAck({
      options,
      requestId,
      startedAt,
      command: commandMetadata,
      parsedCommand,
      controller,
      client
    });
  });
}

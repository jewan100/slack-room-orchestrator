import { ROOM_COMMAND_MESSAGES, ROOM_COMMAND_NAMES } from "../shared/messages";
import { ROOM_ERROR_CODES } from "../shared/errorCodes";
import type { ParsedRoomCommand } from "../shared/types";
import { parseSummaryMode, validateStartTopic } from "../validators/roomCommandValidator";

// 파싱 실패를 공통 구조(`kind: "invalid"`)로 감싸서 반환한다.
// 핸들러는 이 구조만 보고 오류 응답을 일관되게 처리한다.
function buildInvalidCommand(message: string): ParsedRoomCommand {
  return {
    kind: "invalid",
    code: ROOM_ERROR_CODES.ROOM_INVALID_COMMAND,
    message
  };
}

// `start <topic>` 구문을 파싱한다.
// 토픽 검증 실패는 ROOM_MISSING_TOPIC으로 내려보내 사용자 입력 보정이 가능하도록 한다.
function parseStartCommand(normalizedText: string): ParsedRoomCommand {
  const topic = normalizedText.slice(ROOM_COMMAND_NAMES.start.length).trim();
  try {
    return {
      kind: "start",
      topic: validateStartTopic(topic)
    };
  } catch (error) {
    return {
      kind: "invalid",
      code: ROOM_ERROR_CODES.ROOM_MISSING_TOPIC,
      message: error instanceof Error ? error.message : ROOM_COMMAND_MESSAGES.missingTopicFallback
    };
  }
}

// `summary [--brief|--full]` 구문을 파싱한다.
// 옵션이 하나를 초과하면 사용법 위반으로 즉시 invalid를 반환한다.
function parseSummaryCommand(tokens: string[]): ParsedRoomCommand {
  if (tokens.length > 2) {
    return buildInvalidCommand(ROOM_COMMAND_MESSAGES.summaryTooManyArguments);
  }

  try {
    return {
      kind: "summary",
      mode: parseSummaryMode(tokens[1])
    };
  } catch (error) {
    return buildInvalidCommand(
      error instanceof Error ? error.message : ROOM_COMMAND_MESSAGES.invalidSummaryOption
    );
  }
}

// `launch`는 인자를 받지 않는 명령이므로 토큰 수를 엄격히 검사한다.
function parseLaunchCommand(tokens: string[]): ParsedRoomCommand {
  if (tokens.length > 1) {
    return buildInvalidCommand(ROOM_COMMAND_MESSAGES.launchDoesNotTakeArguments);
  }

  return { kind: "launch" };
}

// `/room` 텍스트를 서브커맨드 단위로 파싱해 유니온 타입으로 반환한다.
// 예외를 throw하지 않고 invalid 결과를 반환해 핸들러 레이어를 단순화한다.
export function parseRoomCommand(commandText: string): ParsedRoomCommand {
  const normalizedText = commandText.trim();
  if (!normalizedText) {
    return buildInvalidCommand(ROOM_COMMAND_MESSAGES.missingSubcommand);
  }

  const tokens = normalizedText.split(/\s+/);
  const subcommand = tokens[0]?.toLowerCase() ?? "";

  switch (subcommand) {
    case ROOM_COMMAND_NAMES.start:
      return parseStartCommand(normalizedText);
    case ROOM_COMMAND_NAMES.summary:
      return parseSummaryCommand(tokens);
    case ROOM_COMMAND_NAMES.launch:
      return parseLaunchCommand(tokens);
    default:
      return buildInvalidCommand(ROOM_COMMAND_MESSAGES.unsupportedSubcommand(subcommand));
  }
}

import { ROOM_COMMAND_MESSAGES, ROOM_COMMAND_NAMES } from "../shared/messages";
import { ROOM_ERROR_CODES } from "../shared/errorCodes";
import type { ParsedRoomCommand } from "../shared/types";

// 파싱 실패를 공통 구조(`kind: "invalid"`)로 감싸서 반환한다.
// 핸들러는 이 구조만 보고 오류 응답을 일관되게 처리한다.
function buildInvalidCommand(message: string): ParsedRoomCommand {
  return {
    kind: "invalid",
    code: ROOM_ERROR_CODES.ROOM_INVALID_COMMAND,
    message
  };
}

// `start`는 인자를 받지 않는 명령이므로 토큰 수를 엄격히 검사한다.
function parseStartCommand(tokens: string[]): ParsedRoomCommand {
  if (tokens.length > 1) {
    return buildInvalidCommand(ROOM_COMMAND_MESSAGES.invalidCommandNotice);
  }

  return { kind: "start" };
}

// `launch`는 인자를 받지 않는 명령이므로 토큰 수를 엄격히 검사한다.
function parseLaunchCommand(tokens: string[]): ParsedRoomCommand {
  if (tokens.length > 1) {
    return buildInvalidCommand(ROOM_COMMAND_MESSAGES.invalidCommandNotice);
  }

  return { kind: "launch" };
}

// `stop`도 인자를 받지 않는 명령이므로 토큰 수를 엄격히 검사한다.
function parseStopCommand(tokens: string[]): ParsedRoomCommand {
  if (tokens.length > 1) {
    return buildInvalidCommand(ROOM_COMMAND_MESSAGES.invalidCommandNotice);
  }

  return { kind: "stop" };
}

// `help`도 인자를 받지 않으며 명령 목록 안내만 수행한다.
function parseHelpCommand(tokens: string[]): ParsedRoomCommand {
  if (tokens.length > 1) {
    return buildInvalidCommand(ROOM_COMMAND_MESSAGES.invalidCommandNotice);
  }

  return { kind: "help" };
}

// `/room` 텍스트를 서브커맨드 단위로 파싱해 유니온 타입으로 반환한다.
// 예외를 throw하지 않고 invalid 결과를 반환해 핸들러 레이어를 단순화한다.
export function parseRoomCommand(commandText: string): ParsedRoomCommand {
  const normalizedText = commandText.trim();
  if (!normalizedText) {
    return buildInvalidCommand(ROOM_COMMAND_MESSAGES.invalidCommandNotice);
  }

  const tokens = normalizedText.split(/\s+/);
  const subcommand = tokens[0]?.toLowerCase() ?? "";

  switch (subcommand) {
    case ROOM_COMMAND_NAMES.start:
      return parseStartCommand(tokens);
    case ROOM_COMMAND_NAMES.launch:
      return parseLaunchCommand(tokens);
    case ROOM_COMMAND_NAMES.stop:
      return parseStopCommand(tokens);
    case ROOM_COMMAND_NAMES.help:
      return parseHelpCommand(tokens);
    default:
      return buildInvalidCommand(ROOM_COMMAND_MESSAGES.invalidCommandNotice);
  }
}

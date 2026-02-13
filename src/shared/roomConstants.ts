// `/room` 도메인에서 고정으로 쓰는 식별자 상수 모음

export const ROOM_SLASH_COMMAND = "/room";

// 파서가 인식하는 서브커맨드 이름 상수
export const ROOM_COMMAND_NAMES = {
  start: "start",
  launch: "launch",
  stop: "stop",
  help: "help"
} as const;

// Slack block action 식별자 상수
export const ROOM_ACTION_IDS = {
  openHelp: "room_help_action"
} as const;

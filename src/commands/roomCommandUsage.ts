import { ROOM_COMMAND_MESSAGES, ROOM_ERROR_TEXTS_BY_CODE, ROOM_USAGE_LINES } from "../shared/messages";
import type { RoomErrorCode } from "../shared/errorCodes";

// `/room` 명령의 사용법/오류 응답 문자열을 조합하는 모듈
// 실제 문구는 중앙 카탈로그(messages.ts)에서 관리하고 이 파일은 조립만 담당한다.
export function buildRoomCommandUsage(): string {
  return ROOM_USAGE_LINES.join("\n");
}

// `/room help` 명령이 반환하는 도움말 본문을 생성한다.
export function buildRoomHelpMessage(): string {
  return [ROOM_COMMAND_MESSAGES.helpIntro, "", buildRoomCommandUsage()].join("\n");
}

// 공통 오류 포맷을 만든다.
export function formatCommandErrorMessage(code: RoomErrorCode, message?: string): string {
  return message ?? ROOM_ERROR_TEXTS_BY_CODE[code];
}

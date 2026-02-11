import { ROOM_COMMAND_MESSAGES, ROOM_USAGE_LINES } from "../shared/messages";
import { ROOM_ERROR_MESSAGES, type RoomErrorCode } from "../shared/errorCodes";

// `/room` 명령의 사용법/오류 응답 문자열을 조합하는 모듈
// 실제 문구는 중앙 카탈로그(messages.ts)에서 관리하고 이 파일은 조립만 담당한다.
export function buildRoomCommandUsage(): string {
  return ROOM_USAGE_LINES.join("\n");
}

// 공통 오류 포맷을 만든다.
// code는 항상 노출해 사용자가 원인 분류와 재시도를 쉽게 하도록 한다.
export function formatCommandErrorMessage(code: RoomErrorCode, message?: string): string {
  const resolvedMessage = message ?? ROOM_ERROR_MESSAGES[code];
  return [ROOM_COMMAND_MESSAGES.errorHeader(code), resolvedMessage, "", buildRoomCommandUsage()].join("\n");
}

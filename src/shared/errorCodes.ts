import { ROOM_ERROR_TEXTS_BY_CODE } from "./messages";

// room 명령 전역 에러코드 목록
// 파서/서비스/핸들러/테스트가 동일 계약을 사용하도록 코드값은 고정한다.
export const ROOM_ERROR_CODES = {
  ROOM_MISSING_TOPIC: "ROOM_MISSING_TOPIC",
  ROOM_NO_ACTIVE_SESSION: "ROOM_NO_ACTIVE_SESSION",
  ROOM_ALREADY_RUNNING: "ROOM_ALREADY_RUNNING",
  ROOM_INVALID_STATE_TRANSITION: "ROOM_INVALID_STATE_TRANSITION",
  ROOM_INVALID_COMMAND: "ROOM_INVALID_COMMAND",
  ROOM_INTERNAL_ERROR: "ROOM_INTERNAL_ERROR"
} as const;

export type RoomErrorCode = (typeof ROOM_ERROR_CODES)[keyof typeof ROOM_ERROR_CODES];

// 사용자 노출 에러 문구는 중앙 카탈로그에서만 관리한다.
export const ROOM_ERROR_MESSAGES: Record<RoomErrorCode, string> = ROOM_ERROR_TEXTS_BY_CODE;

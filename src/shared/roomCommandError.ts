import { ROOM_ERROR_CODES, type RoomErrorCode } from "./errorCodes";
import { ROOM_ERROR_TEXTS_BY_CODE } from "./roomSlackUserMessages";

// room 명령 파싱/검증/서비스 전 구간에서 사용하는 도메인 에러 타입
// `code`는 Slack 응답 계약의 핵심 필드이므로 일관되게 유지한다.
export class RoomCommandError extends Error {
  public readonly code: RoomErrorCode;
  public readonly details: Record<string, string> | undefined;

  public constructor(
    code: RoomErrorCode,
    message: string = ROOM_ERROR_TEXTS_BY_CODE[code],
    details?: Record<string, string>
  ) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "RoomCommandError";
  }
}

// 알 수 없는 런타임 에러를 RoomCommandError로 정규화한다.
// 원시 예외 노출을 막고 응답 포맷을 일관되게 유지하기 위한 계층
export function normalizeRoomCommandError(error: unknown): RoomCommandError {
  if (error instanceof RoomCommandError) {
    return error;
  }

  if (error instanceof Error) {
    // 내부 오류는 사용자에게 고정 문구만 노출하고 원문은 로그 컨텍스트로 전달한다.
    return new RoomCommandError(ROOM_ERROR_CODES.ROOM_INTERNAL_ERROR, ROOM_ERROR_TEXTS_BY_CODE.ROOM_INTERNAL_ERROR, {
      internalErrorMessage: error.message
    });
  }

  return new RoomCommandError(ROOM_ERROR_CODES.ROOM_INTERNAL_ERROR);
}

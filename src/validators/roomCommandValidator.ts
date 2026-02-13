import { ROOM_ERROR_CODES } from "../shared/errorCodes";
import { RoomCommandError } from "../shared/roomCommandError";
import type { RoomSession } from "../shared/types";

// 같은 시작 채널에 이미 활성 세션이 있으면 start를 차단한다.
export function ensureNoActiveSession(activeSession: RoomSession | null): void {
  if (activeSession) {
    throw new RoomCommandError(ROOM_ERROR_CODES.ROOM_ALREADY_RUNNING);
  }
}

// launch/stop 등 활성 세션 기반 명령은 null을 허용하지 않는다.
export function ensureActiveSession(activeSession: RoomSession | null): RoomSession {
  if (!activeSession) {
    throw new RoomCommandError(ROOM_ERROR_CODES.ROOM_NO_ACTIVE_SESSION);
  }

  return activeSession;
}

// launch는 PREPARED 상태에서만 허용한다.
// 다른 상태에서 강제 실행하면 상태 전이 규칙을 깨므로 예외 처리한다.
export function ensureLaunchableState(session: RoomSession): void {
  if (session.state !== "PREPARED") {
    throw new RoomCommandError(ROOM_ERROR_CODES.ROOM_INVALID_STATE_TRANSITION);
  }
}

import { ROOM_COMMAND_MESSAGES, ROOM_SUMMARY_OPTION_FLAGS } from "../shared/messages";
import { ROOM_ERROR_CODES } from "../shared/errorCodes";
import { RoomCommandError } from "../shared/roomCommandError";
import type { RoomSession, SummaryMode } from "../shared/types";

// `/room start` 토픽 입력을 검증한다.
// 공백만 들어온 경우는 누락 입력으로 간주한다.
export function validateStartTopic(rawTopic: string): string {
  const topic = rawTopic.trim();
  if (topic.length === 0) {
    throw new RoomCommandError(ROOM_ERROR_CODES.ROOM_MISSING_TOPIC);
  }

  return topic;
}

// 같은 시작 채널에 이미 활성 세션이 있으면 start를 차단한다.
export function ensureNoActiveSession(activeSession: RoomSession | null): void {
  if (activeSession) {
    throw new RoomCommandError(ROOM_ERROR_CODES.ROOM_ALREADY_RUNNING);
  }
}

// summary/launch는 활성 세션이 필수이므로 null을 허용하지 않는다.
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

// summary 옵션 플래그를 도메인 타입으로 변환한다.
// 옵션 누락은 기본값 brief로 처리한다.
export function parseSummaryMode(rawFlag: string | undefined): SummaryMode {
  if (!rawFlag) {
    return "brief";
  }

  if (rawFlag === ROOM_SUMMARY_OPTION_FLAGS.brief) {
    return "brief";
  }

  if (rawFlag === ROOM_SUMMARY_OPTION_FLAGS.full) {
    return "full";
  }

  throw new RoomCommandError(ROOM_ERROR_CODES.ROOM_INVALID_COMMAND, ROOM_COMMAND_MESSAGES.invalidSummaryOption);
}

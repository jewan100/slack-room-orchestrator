import { afterEach, describe, expect, it } from "vitest";
import { ROOM_ERROR_CODES } from "../src/shared/errorCodes";
import { createLogger } from "../src/shared/logger";
import { ManageRoomModeService } from "../src/services/openclaw/manageRoomModeService";
import { StartRoomSessionService } from "../src/services/startRoomSessionService";
import { StopRoomSessionService } from "../src/services/stopRoomSessionService";
import type { SlackThreadPort } from "../src/shared/types";
import { createTestDatabase, type TestDatabaseContext } from "./helpers/createTestDatabase";

// stop 서비스 테스트에서 사용하는 기본 Slack 스레드 포트 대역 구현체
class FakeSlackThreadPort implements SlackThreadPort {
  public async createThread(input: { channelId: string; text: string }): Promise<{ channelId: string; threadTs: string }> {
    return {
      channelId: input.channelId,
      threadTs: "12345.0001"
    };
  }

  public async postMessageInThread(): Promise<void> {
    return;
  }
}

// `StopRoomSessionService` 핵심 시나리오를 검증한다.
describe("StopRoomSessionService", () => {
  let context: TestDatabaseContext | null = null;

  // 테스트 간 파일 DB 격리를 위해 매 케이스 후 임시 DB를 정리한다.
  afterEach(async () => {
    if (context) {
      await context.cleanup();
    }
    context = null;
  });

  // 활성 세션이 없으면 stop이 ROOM_NO_ACTIVE_SESSION으로 실패하는지 검증한다.
  it("throws ROOM_NO_ACTIVE_SESSION when there is no active session", async () => {
    context = await createTestDatabase();
    const stopService = new StopRoomSessionService(
      context.roomSessionRepository,
      new ManageRoomModeService(context.roomWatchTargetRepository, context.openClawEventOutboxRepository, createLogger("error")),
      createLogger("error")
    );

    await expect(
      stopService.execute({
        startChannelId: "C_START"
      })
    ).rejects.toMatchObject({
      code: ROOM_ERROR_CODES.ROOM_NO_ACTIVE_SESSION
    });
  });

  // 활성 세션을 강제 종료하면 DECIDED 전이와 ROOM_MODE_OFF(MANUAL) 발행이 수행되는지 검증한다.
  it("transitions active session to DECIDED and turns off planning mode with MANUAL reason", async () => {
    context = await createTestDatabase();
    const roomModeLifecycleService = new ManageRoomModeService(
      context.roomWatchTargetRepository,
      context.openClawEventOutboxRepository,
      createLogger("error")
    );

    const startService = new StartRoomSessionService(
      context.roomSessionRepository,
      context.briefingRepository,
      createLogger("error"),
      {
        roomModeLifecycleService,
        roomModeTtlMinutes: 60
      }
    );

    const started = await startService.execute(
      {
        requestedByUserId: "U01",
        workspaceId: "T01",
        startChannelId: "C_START"
      },
      new FakeSlackThreadPort()
    );

    const stopService = new StopRoomSessionService(
      context.roomSessionRepository,
      roomModeLifecycleService,
      createLogger("error")
    );

    const stopped = await stopService.execute({
      startChannelId: "C_START"
    });

    const activeSession = await context.roomSessionRepository.findActiveSessionByStartChannel("C_START");
    const watchTarget = await context.roomWatchTargetRepository.findOnWatchTargetBySessionId(started.session.id);
    const outboxEvents = await context.openClawEventOutboxRepository.claimPendingEvents(new Date().toISOString(), 10);
    const manualOffEvent = outboxEvents.find((event) => {
      return event.eventType === "ROOM_MODE_OFF" && event.payload.sessionId === started.session.id;
    });

    expect(stopped.session.state).toBe("DECIDED");
    expect(activeSession).toBeNull();
    expect(watchTarget).toBeNull();
    expect(manualOffEvent).toBeDefined();
    expect(manualOffEvent?.payload.eventType).toBe("ROOM_MODE_OFF");
    expect((manualOffEvent?.payload as { offReason?: string }).offReason).toBe("MANUAL");
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { ROOM_ERROR_CODES } from "../src/shared/errorCodes";
import { createLogger } from "../src/shared/logger";
import type { SlackThreadPort } from "../src/shared/types";
import { LaunchRoomSessionService } from "../src/services/launchRoomSessionService";
import { RunWorkerRoundStubService } from "../src/services/runWorkerRoundStubService";
import { createTestDatabase, type TestDatabaseContext } from "./helpers/createTestDatabase";

class FakeSlackThreadPort implements SlackThreadPort {
  public async createThread(input: { channelId: string; text: string }): Promise<{ channelId: string; threadTs: string }> {
    return {
      channelId: input.channelId,
      threadTs: "2000.0001"
    };
  }

  public async postMessageInThread(input: { channelId: string; threadTs: string; text: string }): Promise<void> {
    void input;
    return;
  }
}

describe("LaunchRoomSessionService", () => {
  let context: TestDatabaseContext | null = null;

  afterEach(async () => {
    if (context) {
      await context.cleanup();
    }
    context = null;
  });

  it("throws ROOM_NO_ACTIVE_SESSION when no session exists", async () => {
    context = await createTestDatabase();
    const service = new LaunchRoomSessionService(
      context.roomSessionRepository,
      context.workerRoundRepository,
      new RunWorkerRoundStubService(),
      createLogger("error")
    );

    await expect(
      service.execute(
        {
          startChannelId: "C_START",
          launchChannelId: "C_LAUNCH"
        },
        new FakeSlackThreadPort()
      )
    ).rejects.toMatchObject({
      code: ROOM_ERROR_CODES.ROOM_NO_ACTIVE_SESSION
    });
  });

  it("throws ROOM_INVALID_STATE_TRANSITION when session is not PREPARED", async () => {
    context = await createTestDatabase();
    const session = await context.roomSessionRepository.createPreparedSession({
      topic: "State transition",
      requestedByUserId: "U01",
      workspaceId: "T01",
      startChannelId: "C_START",
      startThreadTs: "1000.0001"
    });
    await context.roomSessionRepository.updateSessionToRunning({
      sessionId: session.id,
      launchChannelId: "C_LAUNCH",
      launchThreadTs: "1000.0002"
    });

    const service = new LaunchRoomSessionService(
      context.roomSessionRepository,
      context.workerRoundRepository,
      new RunWorkerRoundStubService(),
      createLogger("error")
    );

    await expect(
      service.execute(
        {
          startChannelId: "C_START",
          launchChannelId: "C_LAUNCH"
        },
        new FakeSlackThreadPort()
      )
    ).rejects.toMatchObject({
      code: ROOM_ERROR_CODES.ROOM_INVALID_STATE_TRANSITION
    });
  });

  it("moves session to RUNNING and stores first worker round", async () => {
    context = await createTestDatabase();
    await context.roomSessionRepository.createPreparedSession({
      topic: "Run worker round",
      requestedByUserId: "U01",
      workspaceId: "T01",
      startChannelId: "C_START",
      startThreadTs: "1000.0001"
    });

    const service = new LaunchRoomSessionService(
      context.roomSessionRepository,
      context.workerRoundRepository,
      new RunWorkerRoundStubService(),
      createLogger("error")
    );

    const result = await service.execute(
      {
        startChannelId: "C_START",
        launchChannelId: "C_LAUNCH"
      },
      new FakeSlackThreadPort()
    );

    const latestRound = await context.workerRoundRepository.findLatestBySessionId(result.session.id);

    expect(result.session.state).toBe("RUNNING");
    expect(latestRound?.roundNo).toBe(1);
    expect(latestRound?.candidates.length).toBe(3);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { ROOM_ERROR_CODES } from "../src/shared/errorCodes";
import { createLogger } from "../src/shared/logger";
import type { SlackThreadPort } from "../src/shared/types";
import { StartRoomSessionService } from "../src/services/startRoomSessionService";
import { createTestDatabase, type TestDatabaseContext } from "./helpers/createTestDatabase";

class FakeSlackThreadPort implements SlackThreadPort {
  public readonly createdThreads: Array<{ channelId: string; text: string }> = [];
  public readonly postedMessages: Array<{ channelId: string; threadTs: string; text: string }> = [];

  public async createThread(input: { channelId: string; text: string }): Promise<{ channelId: string; threadTs: string }> {
    this.createdThreads.push(input);
    return {
      channelId: input.channelId,
      threadTs: "12345.0001"
    };
  }

  public async postMessageInThread(input: { channelId: string; threadTs: string; text: string }): Promise<void> {
    this.postedMessages.push(input);
  }
}

describe("StartRoomSessionService", () => {
  let context: TestDatabaseContext | null = null;

  afterEach(async () => {
    if (context) {
      await context.cleanup();
    }
    context = null;
  });

  it("creates prepared session and briefing", async () => {
    context = await createTestDatabase();
    const service = new StartRoomSessionService(
      context.roomSessionRepository,
      context.briefingRepository,
      createLogger("error")
    );
    const slackThreadPort = new FakeSlackThreadPort();

    const result = await service.execute(
      {
        topic: "Implement start command",
        requestedByUserId: "U01",
        workspaceId: "T01",
        startChannelId: "C_START"
      },
      slackThreadPort
    );

    const briefing = await context.briefingRepository.findBySessionId(result.session.id);

    expect(result.session.state).toBe("PREPARED");
    expect(briefing).not.toBeNull();
    expect(slackThreadPort.createdThreads.length).toBe(1);
    expect(slackThreadPort.postedMessages.length).toBe(1);
  });

  it("throws ROOM_ALREADY_RUNNING when active session exists", async () => {
    context = await createTestDatabase();
    const service = new StartRoomSessionService(
      context.roomSessionRepository,
      context.briefingRepository,
      createLogger("error")
    );
    const slackThreadPort = new FakeSlackThreadPort();

    await service.execute(
      {
        topic: "First session",
        requestedByUserId: "U01",
        workspaceId: "T01",
        startChannelId: "C_START"
      },
      slackThreadPort
    );

    await expect(
      service.execute(
        {
          topic: "Second session",
          requestedByUserId: "U02",
          workspaceId: "T01",
          startChannelId: "C_START"
        },
        slackThreadPort
      )
    ).rejects.toMatchObject({
      code: ROOM_ERROR_CODES.ROOM_ALREADY_RUNNING
    });
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { ROOM_ERROR_CODES } from "../src/shared/errorCodes";
import { createLogger } from "../src/shared/logger";
import { SummarizeRoomSessionService } from "../src/services/summarizeRoomSessionService";
import { createTestDatabase, type TestDatabaseContext } from "./helpers/createTestDatabase";

describe("SummarizeRoomSessionService", () => {
  let context: TestDatabaseContext | null = null;

  afterEach(async () => {
    if (context) {
      await context.cleanup();
    }
    context = null;
  });

  it("throws ROOM_NO_ACTIVE_SESSION when no session exists", async () => {
    context = await createTestDatabase();
    const service = new SummarizeRoomSessionService(
      context.roomSessionRepository,
      context.briefingRepository,
      context.workerRoundRepository,
      createLogger("error")
    );

    await expect(
      service.execute({
        startChannelId: "C_START",
        mode: "brief"
      })
    ).rejects.toMatchObject({
      code: ROOM_ERROR_CODES.ROOM_NO_ACTIVE_SESSION
    });
  });

  it("returns brief summary with next action", async () => {
    context = await createTestDatabase();
    const session = await context.roomSessionRepository.createPreparedSession({
      topic: "Brief summary",
      requestedByUserId: "U01",
      workspaceId: "T01",
      startChannelId: "C_START",
      startThreadTs: "1000.0001"
    });
    await context.briefingRepository.createBriefing({
      sessionId: session.id,
      goal: "Keep summary short",
      constraints: "No long output",
      successCriteria: "Actionable output"
    });

    const service = new SummarizeRoomSessionService(
      context.roomSessionRepository,
      context.briefingRepository,
      context.workerRoundRepository,
      createLogger("error")
    );

    const result = await service.execute({
      startChannelId: "C_START",
      mode: "brief"
    });

    expect(result.summaryText).toContain("상태: PREPARED");
    expect(result.summaryText).toContain("다음 액션: /room launch");
  });

  it("returns full summary with worker candidates when round exists", async () => {
    context = await createTestDatabase();
    const session = await context.roomSessionRepository.createPreparedSession({
      topic: "Full summary",
      requestedByUserId: "U01",
      workspaceId: "T01",
      startChannelId: "C_START",
      startThreadTs: "1000.0001"
    });
    await context.briefingRepository.createBriefing({
      sessionId: session.id,
      goal: "Summarize details",
      constraints: "Capture risk",
      successCriteria: "Ready to decide"
    });
    await context.workerRoundRepository.createRound({
      sessionId: session.id,
      roundNo: 1,
      candidates: [
        {
          option: "A",
          summary: "A summary",
          pros: ["Simple"],
          risk: "Narrow",
          estimatedCost: "1 day"
        }
      ]
    });

    const service = new SummarizeRoomSessionService(
      context.roomSessionRepository,
      context.briefingRepository,
      context.workerRoundRepository,
      createLogger("error")
    );

    const result = await service.execute({
      startChannelId: "C_START",
      mode: "full"
    });

    expect(result.summaryText).toContain("라운드 1 후보안:");
    expect(result.summaryText).toContain("A summary");
  });
});

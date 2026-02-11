import { afterEach, describe, expect, it } from "vitest";
import type { WorkerCandidate } from "../src/shared/types";
import { createTestDatabase, type TestDatabaseContext } from "./helpers/createTestDatabase";

describe("sqlite repositories", () => {
  let context: TestDatabaseContext | null = null;

  afterEach(async () => {
    if (context) {
      await context.cleanup();
    }
    context = null;
  });

  it("creates and loads active room session", async () => {
    context = await createTestDatabase();

    const session = await context.roomSessionRepository.createPreparedSession({
      topic: "Build slash command server",
      requestedByUserId: "U01",
      workspaceId: "T01",
      startChannelId: "C_START",
      startThreadTs: "1000.0001"
    });

    const loaded = await context.roomSessionRepository.findActiveSessionByStartChannel("C_START");

    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(session.id);
    expect(loaded?.state).toBe("PREPARED");
  });

  it("blocks second active session on same start channel", async () => {
    context = await createTestDatabase();

    await context.roomSessionRepository.createPreparedSession({
      topic: "First",
      requestedByUserId: "U01",
      workspaceId: "T01",
      startChannelId: "C_START",
      startThreadTs: "1000.0001"
    });

    await expect(
      context.roomSessionRepository.createPreparedSession({
        topic: "Second",
        requestedByUserId: "U02",
        workspaceId: "T01",
        startChannelId: "C_START",
        startThreadTs: "1000.0002"
      })
    ).rejects.toThrow();
  });

  it("persists briefing and latest worker round", async () => {
    context = await createTestDatabase();
    const session = await context.roomSessionRepository.createPreparedSession({
      topic: "Round persistence",
      requestedByUserId: "U01",
      workspaceId: "T01",
      startChannelId: "C_START",
      startThreadTs: "1000.0001"
    });

    await context.briefingRepository.createBriefing({
      sessionId: session.id,
      goal: "Validate persistence",
      constraints: "No data loss",
      successCriteria: "Round is loaded after restart"
    });

    const candidates: WorkerCandidate[] = [
      {
        option: "A",
        summary: "Option A summary",
        pros: ["Fast"],
        risk: "Scope creep",
        estimatedCost: "1 day"
      }
    ];

    await context.workerRoundRepository.createRound({
      sessionId: session.id,
      roundNo: 1,
      candidates
    });

    const briefing = await context.briefingRepository.findBySessionId(session.id);
    const latestRound = await context.workerRoundRepository.findLatestBySessionId(session.id);

    expect(briefing?.goal).toBe("Validate persistence");
    expect(latestRound?.roundNo).toBe(1);
    expect(latestRound?.candidates[0]?.option).toBe("A");
  });
});

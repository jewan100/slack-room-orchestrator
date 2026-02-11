import { afterEach, describe, expect, it } from "vitest";
import { ROOM_ERROR_CODES } from "../src/shared/errorCodes";
import { createLogger } from "../src/shared/logger";
import { SummarizeRoomSessionService } from "../src/services/summarizeRoomSessionService";
import { createTestDatabase, type TestDatabaseContext } from "./helpers/createTestDatabase";

// `SummarizeRoomSessionService` 요약 결과 조합 규칙을 검증한다.
describe("SummarizeRoomSessionService", () => {
  let context: TestDatabaseContext | null = null;

  // 테스트 간 파일 DB 격리를 위해 매 케이스 후 임시 DB를 정리한다.
  afterEach(async () => {
    if (context) {
      await context.cleanup();
    }
    context = null;
  });

  // 활성 세션이 없으면 summary가 즉시 차단되는지 검증한다.
  it("throws ROOM_NO_ACTIVE_SESSION when no session exists", async () => {
    // 준비: 빈 테스트 DB와 summary 서비스 인스턴스를 만든다.
    context = await createTestDatabase();
    const service = new SummarizeRoomSessionService(
      context.roomSessionRepository,
      context.briefingRepository,
      context.workerRoundRepository,
      createLogger("error")
    );

    // 실행/검증: 활성 세션 없이 summary를 호출하면 도메인 에러코드를 반환해야 한다.
    await expect(
      service.execute({
        startChannelId: "C_START",
        mode: "brief"
      })
    ).rejects.toMatchObject({
      code: ROOM_ERROR_CODES.ROOM_NO_ACTIVE_SESSION
    });
  });

  // brief 모드가 핵심 상태/다음 액션 중심 요약을 반환하는지 검증한다.
  it("returns brief summary with next action", async () => {
    // 준비: PREPARED 세션과 브리핑 데이터를 만든다.
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

    // 준비: summary 서비스 인스턴스를 만든다.
    const service = new SummarizeRoomSessionService(
      context.roomSessionRepository,
      context.briefingRepository,
      context.workerRoundRepository,
      createLogger("error")
    );

    // 실행: brief 모드 요약을 생성한다.
    const result = await service.execute({
      startChannelId: "C_START",
      mode: "brief"
    });

    // 검증: 상태 정보와 다음 액션 안내가 포함되는지 확인한다.
    expect(result.summaryText).toContain("상태: PREPARED");
    expect(result.summaryText).toContain("다음 액션: /room launch");
  });

  // full 모드가 라운드 후보안까지 포함한 상세 요약을 반환하는지 검증한다.
  it("returns full summary with worker candidates when round exists", async () => {
    // 준비: PREPARED 세션, 브리핑, 1차 라운드 후보안을 저장한다.
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

    // 준비: summary 서비스 인스턴스를 만든다.
    const service = new SummarizeRoomSessionService(
      context.roomSessionRepository,
      context.briefingRepository,
      context.workerRoundRepository,
      createLogger("error")
    );

    // 실행: full 모드 요약을 생성한다.
    const result = await service.execute({
      startChannelId: "C_START",
      mode: "full"
    });

    // 검증: 라운드 제목/후보안 핵심 텍스트가 포함되는지 확인한다.
    expect(result.summaryText).toContain("라운드 1 후보안:");
    expect(result.summaryText).toContain("A summary");
  });
});

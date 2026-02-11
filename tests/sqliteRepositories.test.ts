import { afterEach, describe, expect, it } from "vitest";
import { ROOM_SQLITE_MESSAGES, ROOM_START_SERVICE_MESSAGES } from "../src/shared/messages";
import type { WorkerCandidate } from "../src/shared/types";
import { createTestDatabase, type TestDatabaseContext } from "./helpers/createTestDatabase";

// SQLite 저장소 구현체의 영속화/조회/예외 경로를 검증한다.
describe("sqlite repositories", () => {
  let context: TestDatabaseContext | null = null;

  // 테스트 간 파일 DB 격리를 위해 매 케이스 후 임시 DB를 정리한다.
  afterEach(async () => {
    if (context) {
      await context.cleanup();
    }
    context = null;
  });

  // 세션 생성 후 활성 세션 조회가 동일 엔티티를 반환하는지 검증한다.
  it("creates and loads active room session", async () => {
    // 준비: 테스트 DB를 생성한다.
    context = await createTestDatabase();

    // 실행: PREPARED 세션을 생성한다.
    const session = await context.roomSessionRepository.createPreparedSession({
      topic: "Build slash command server",
      requestedByUserId: "U01",
      workspaceId: "T01",
      startChannelId: "C_START",
      startThreadTs: "1000.0001"
    });

    // 실행: 시작 채널 기준 활성 세션을 조회한다.
    const loaded = await context.roomSessionRepository.findActiveSessionByStartChannel("C_START");

    // 검증: 조회 결과가 생성한 세션과 일치해야 한다.
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(session.id);
    expect(loaded?.state).toBe("PREPARED");
  });

  // 같은 채널에서 활성 세션 2개 생성을 유니크 인덱스가 차단하는지 검증한다.
  it("blocks second active session on same start channel", async () => {
    // 준비: 첫 번째 활성 세션을 생성한다.
    context = await createTestDatabase();

    await context.roomSessionRepository.createPreparedSession({
      topic: "First",
      requestedByUserId: "U01",
      workspaceId: "T01",
      startChannelId: "C_START",
      startThreadTs: "1000.0001"
    });

    // 실행/검증: 두 번째 활성 세션 생성 시 예외가 발생해야 한다.
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

  // 브리핑/라운드 저장 후 최신 라운드 조회가 정상 동작하는지 검증한다.
  it("persists briefing and latest worker round", async () => {
    // 준비: 세션을 생성한다.
    context = await createTestDatabase();
    const session = await context.roomSessionRepository.createPreparedSession({
      topic: "Round persistence",
      requestedByUserId: "U01",
      workspaceId: "T01",
      startChannelId: "C_START",
      startThreadTs: "1000.0001"
    });

    // 준비: 브리핑을 저장한다.
    await context.briefingRepository.createBriefing({
      sessionId: session.id,
      goal: "Validate persistence",
      constraints: "No data loss",
      successCriteria: "Round is loaded after restart"
    });

    // 준비: 라운드 후보안을 구성한다.
    const candidates: WorkerCandidate[] = [
      {
        option: "A",
        summary: "Option A summary",
        pros: ["Fast"],
        risk: "Scope creep",
        estimatedCost: "1 day"
      }
    ];

    // 실행: 라운드를 저장하고 브리핑/최신 라운드를 조회한다.
    await context.workerRoundRepository.createRound({
      sessionId: session.id,
      roundNo: 1,
      candidates
    });

    const briefing = await context.briefingRepository.findBySessionId(session.id);
    const latestRound = await context.workerRoundRepository.findLatestBySessionId(session.id);

    // 검증: 저장된 브리핑/라운드 데이터가 그대로 조회되어야 한다.
    expect(briefing?.goal).toBe("Validate persistence");
    expect(latestRound?.roundNo).toBe(1);
    expect(latestRound?.candidates[0]?.option).toBe("A");
  });

  // 예약된 PREPARED 세션 조건 삭제가 성공하는지 검증한다.
  it("deletes only reserved prepared session when marker matches", async () => {
    context = await createTestDatabase();
    const session = await context.roomSessionRepository.createPreparedSession({
      topic: "Reserved session delete",
      requestedByUserId: "U01",
      workspaceId: "T01",
      startChannelId: "C_START",
      startThreadTs: ROOM_START_SERVICE_MESSAGES.pendingStartThreadTs
    });

    const deleted = await context.roomSessionRepository.deleteReservedPreparedSession({
      sessionId: session.id,
      expectedStartThreadTs: ROOM_START_SERVICE_MESSAGES.pendingStartThreadTs
    });

    const loaded = await context.roomSessionRepository.findById(session.id);
    expect(deleted).toBe(true);
    expect(loaded).toBeNull();
  });

  // 예약 삭제는 이미 RUNNING으로 선점된 세션을 지우지 않는지 검증한다.
  it("does not delete session when reservation state already changed", async () => {
    context = await createTestDatabase();
    const session = await context.roomSessionRepository.createPreparedSession({
      topic: "Do not delete running session",
      requestedByUserId: "U01",
      workspaceId: "T01",
      startChannelId: "C_START",
      startThreadTs: ROOM_START_SERVICE_MESSAGES.pendingStartThreadTs
    });

    await context.roomSessionRepository.claimPreparedSessionForLaunch(session.id);

    const deleted = await context.roomSessionRepository.deleteReservedPreparedSession({
      sessionId: session.id,
      expectedStartThreadTs: ROOM_START_SERVICE_MESSAGES.pendingStartThreadTs
    });

    const loaded = await context.roomSessionRepository.findById(session.id);
    expect(deleted).toBe(false);
    expect(loaded?.state).toBe("RUNNING");
  });

  // RUNNING 메타데이터 갱신은 선점(claim) 이후에만 허용되는지 검증한다.
  it("updates running metadata only when session is already claimed", async () => {
    context = await createTestDatabase();
    const session = await context.roomSessionRepository.createPreparedSession({
      topic: "Running update guard",
      requestedByUserId: "U01",
      workspaceId: "T01",
      startChannelId: "C_START",
      startThreadTs: "1000.0001"
    });

    await expect(
      context.roomSessionRepository.updateSessionToRunning({
        sessionId: session.id,
        launchChannelId: "C_LAUNCH",
        launchThreadTs: "2000.0001"
      })
    ).rejects.toThrow(ROOM_SQLITE_MESSAGES.updateSessionToRunningFailed);

    await context.roomSessionRepository.claimPreparedSessionForLaunch(session.id);

    const updated = await context.roomSessionRepository.updateSessionToRunning({
      sessionId: session.id,
      launchChannelId: "C_LAUNCH",
      launchThreadTs: "2000.0001"
    });

    expect(updated.state).toBe("RUNNING");
    expect(updated.launchChannelId).toBe("C_LAUNCH");
    expect(updated.launchThreadTs).toBe("2000.0001");
  });

  // 같은 세션에 동일 round_no를 중복 저장하지 못하는지 검증한다.
  it("blocks duplicate round number within same session", async () => {
    context = await createTestDatabase();
    const session = await context.roomSessionRepository.createPreparedSession({
      topic: "Round uniqueness",
      requestedByUserId: "U01",
      workspaceId: "T01",
      startChannelId: "C_START",
      startThreadTs: "1000.0001"
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

    await expect(
      context.workerRoundRepository.createRound({
        sessionId: session.id,
        roundNo: 1,
        candidates
      })
    ).rejects.toThrow();
  });

  // 손상된 candidates_json을 읽을 때 명시적 파싱 오류가 발생하는지 검증한다.
  it("throws explicit parse error when stored candidates_json is malformed", async () => {
    // 준비: 세션을 만든다.
    context = await createTestDatabase();
    const session = await context.roomSessionRepository.createPreparedSession({
      topic: "Malformed round payload",
      requestedByUserId: "U01",
      workspaceId: "T01",
      startChannelId: "C_START",
      startThreadTs: "1000.0001"
    });

    // 준비: 라운드 테이블에 잘못된 JSON 문자열을 직접 주입한다.
    await context.sqliteClient.getDatabase().run(
      `
      INSERT INTO room_worker_rounds (id, session_id, round_no, candidates_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `,
      "round-malformed",
      session.id,
      99,
      "{invalid-json",
      new Date().toISOString()
    );

    // 검증: 최신 라운드 조회 시 명시적 파싱 오류로 실패해야 한다.
    await expect(context.workerRoundRepository.findLatestBySessionId(session.id)).rejects.toThrow(
      ROOM_SQLITE_MESSAGES.parseWorkerRoundCandidatesFailed
    );
  });
});

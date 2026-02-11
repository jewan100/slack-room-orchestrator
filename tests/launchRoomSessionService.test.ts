import { afterEach, describe, expect, it } from "vitest";
import { ROOM_ERROR_CODES } from "../src/shared/errorCodes";
import { createLogger } from "../src/shared/logger";
import type { SlackThreadPort } from "../src/shared/types";
import { LaunchRoomSessionService } from "../src/services/launchRoomSessionService";
import { RunWorkerRoundStubService } from "../src/services/runWorkerRoundStubService";
import { createTestDatabase, type TestDatabaseContext } from "./helpers/createTestDatabase";

// launch 테스트에서 사용하는 기본 Slack 스레드 포트 대역 구현체
class FakeSlackThreadPort implements SlackThreadPort {
  public readonly createdThreads: Array<{ channelId: string; text: string }> = [];
  public readonly postedMessages: Array<{ channelId: string; threadTs: string; text: string }> = [];

  public async createThread(input: { channelId: string; text: string }): Promise<{ channelId: string; threadTs: string }> {
    this.createdThreads.push(input);
    return {
      channelId: input.channelId,
      threadTs: "2000.0001"
    };
  }

  // 기본 구현은 후속 메시지를 성공으로 처리한다.
  public async postMessageInThread(input: { channelId: string; threadTs: string; text: string }): Promise<void> {
    this.postedMessages.push(input);
    return;
  }
}

// launch 후속 안내 메시지 전송 실패 시나리오를 만드는 대역 구현체
class FailingLaunchFollowupSlackThreadPort extends FakeSlackThreadPort {
  public async postMessageInThread(input: { channelId: string; threadTs: string; text: string }): Promise<void> {
    this.postedMessages.push(input);
    throw new Error("launch followup failed");
  }
}

// launch 스레드 생성 실패 시나리오를 만드는 대역 구현체
class FailingLaunchThreadSlackThreadPort extends FakeSlackThreadPort {
  public async createThread(input: { channelId: string; text: string }): Promise<{ channelId: string; threadTs: string }> {
    this.createdThreads.push(input);
    throw new Error("launch thread failed");
  }
}

// Promise.allSettled 결과에서 rejected 에러코드를 안전하게 추출한다.
function extractRejectedCode<T>(result: PromiseSettledResult<T>): string | undefined {
  if (result.status !== "rejected") {
    return undefined;
  }

  if (typeof result.reason !== "object" || result.reason === null || !("code" in result.reason)) {
    return undefined;
  }

  const errorWithCode = result.reason as { code?: unknown };
  if (typeof errorWithCode.code !== "string") {
    return undefined;
  }

  return errorWithCode.code;
}

// `LaunchRoomSessionService` 핵심 시나리오를 검증한다.
describe("LaunchRoomSessionService", () => {
  let context: TestDatabaseContext | null = null;

  // 테스트 간 파일 DB 격리를 위해 매 케이스 후 임시 DB를 정리한다.
  afterEach(async () => {
    if (context) {
      await context.cleanup();
    }
    context = null;
  });

  // 활성 세션이 없으면 launch가 즉시 차단되는지 검증한다.
  it("throws ROOM_NO_ACTIVE_SESSION when no session exists", async () => {
    // 준비: 빈 테스트 DB와 서비스 인스턴스를 만든다.
    context = await createTestDatabase();
    const service = new LaunchRoomSessionService(
      context.roomSessionRepository,
      context.workerRoundRepository,
      new RunWorkerRoundStubService(),
      createLogger("error")
    );

    // 실행/검증: 세션 없이 launch를 호출하면 도메인 에러코드를 반환해야 한다.
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

  // PREPARED가 아닌 상태에서는 launch가 차단되는지 검증한다.
  it("throws ROOM_INVALID_STATE_TRANSITION when session is not PREPARED", async () => {
    // 준비: PREPARED 세션을 만든 뒤 RUNNING으로 전이해 비정상 상태를 만든다.
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

    // 준비: launch 서비스 인스턴스를 만든다.
    const service = new LaunchRoomSessionService(
      context.roomSessionRepository,
      context.workerRoundRepository,
      new RunWorkerRoundStubService(),
      createLogger("error")
    );

    // 실행/검증: PREPARED가 아니면 상태 전이 오류가 발생해야 한다.
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

  // 정상 launch에서 세션 상태 전이와 라운드 저장이 모두 수행되는지 검증한다.
  it("moves session to RUNNING and stores first worker round", async () => {
    // 준비: launch 가능한 PREPARED 세션을 만든다.
    context = await createTestDatabase();
    await context.roomSessionRepository.createPreparedSession({
      topic: "Run worker round",
      requestedByUserId: "U01",
      workspaceId: "T01",
      startChannelId: "C_START",
      startThreadTs: "1000.0001"
    });

    // 준비: launch 서비스 인스턴스를 만든다.
    const service = new LaunchRoomSessionService(
      context.roomSessionRepository,
      context.workerRoundRepository,
      new RunWorkerRoundStubService(),
      createLogger("error")
    );

    // 실행: launch를 수행한다.
    const result = await service.execute(
      {
        startChannelId: "C_START",
        launchChannelId: "C_LAUNCH"
      },
      new FakeSlackThreadPort()
    );

    // 검증: 최신 라운드를 조회해 저장 결과를 확인한다.
    const latestRound = await context.workerRoundRepository.findLatestBySessionId(result.session.id);

    expect(result.session.state).toBe("RUNNING");
    expect(latestRound?.roundNo).toBe(1);
    expect(latestRound?.candidates.length).toBe(3);
  });

  // launch 후속 공지 실패가 launch 자체 실패로 전파되지 않는지 검증한다.
  it("keeps launch successful even when followup thread notice fails", async () => {
    // 준비: launch 가능한 PREPARED 세션을 만든다.
    context = await createTestDatabase();
    await context.roomSessionRepository.createPreparedSession({
      topic: "Launch with followup failure",
      requestedByUserId: "U01",
      workspaceId: "T01",
      startChannelId: "C_START",
      startThreadTs: "1000.0001"
    });

    // 준비: 후속 공지 실패 대역 포트를 사용하는 서비스 인스턴스를 만든다.
    const service = new LaunchRoomSessionService(
      context.roomSessionRepository,
      context.workerRoundRepository,
      new RunWorkerRoundStubService(),
      createLogger("error")
    );

    // 실행: 후속 공지 실패가 발생하는 launch를 수행한다.
    const result = await service.execute(
      {
        startChannelId: "C_START",
        launchChannelId: "C_LAUNCH"
      },
      new FailingLaunchFollowupSlackThreadPort()
    );

    // 검증: launch 핵심 결과(상태 전이/라운드 저장)는 유지되어야 한다.
    const latestRound = await context.workerRoundRepository.findLatestBySessionId(result.session.id);

    expect(result.session.state).toBe("RUNNING");
    expect(latestRound?.roundNo).toBe(1);
  });

  // launch 핵심 단계 실패 시 선점 상태가 PREPARED로 롤백되는지 검증한다.
  it("rolls back launch claim when thread creation fails", async () => {
    // 준비: PREPARED 세션을 만든다.
    context = await createTestDatabase();
    const session = await context.roomSessionRepository.createPreparedSession({
      topic: "Launch rollback",
      requestedByUserId: "U01",
      workspaceId: "T01",
      startChannelId: "C_START",
      startThreadTs: "1000.0001"
    });

    // 준비: launch 서비스 인스턴스를 만든다.
    const service = new LaunchRoomSessionService(
      context.roomSessionRepository,
      context.workerRoundRepository,
      new RunWorkerRoundStubService(),
      createLogger("error")
    );

    // 실행/검증: launch 스레드 생성 실패를 유도한다.
    await expect(
      service.execute(
        {
          startChannelId: "C_START",
          launchChannelId: "C_LAUNCH"
        },
        new FailingLaunchThreadSlackThreadPort()
      )
    ).rejects.toThrow("launch thread failed");

    // 검증: 선점된 세션이 PREPARED로 되돌아와야 재시도가 가능하다.
    const restored = await context.roomSessionRepository.findById(session.id);
    expect(restored?.state).toBe("PREPARED");
  });

  // 동시 launch 요청에서 1건만 성공하고 나머지는 상태 전이 오류로 차단되는지 검증한다.
  it("allows only one launch when requests race on the same session", async () => {
    // 준비: 동시에 접근할 단일 PREPARED 세션을 만든다.
    context = await createTestDatabase();
    await context.roomSessionRepository.createPreparedSession({
      topic: "Concurrent launch",
      requestedByUserId: "U01",
      workspaceId: "T01",
      startChannelId: "C_START",
      startThreadTs: "1000.0001"
    });

    // 준비: 같은 서비스 인스턴스로 동시 호출을 만든다.
    const service = new LaunchRoomSessionService(
      context.roomSessionRepository,
      context.workerRoundRepository,
      new RunWorkerRoundStubService(),
      createLogger("error")
    );

    // 실행: 같은 세션을 대상으로 launch를 동시에 요청한다.
    const first = service.execute(
      {
        startChannelId: "C_START",
        launchChannelId: "C_LAUNCH"
      },
      new FakeSlackThreadPort()
    );
    const second = service.execute(
      {
        startChannelId: "C_START",
        launchChannelId: "C_LAUNCH"
      },
      new FakeSlackThreadPort()
    );

    // 검증: 1건 성공, 1건 실패(상태 전이 오류)여야 한다.
    const results = await Promise.allSettled([first, second]);
    const fulfilledCount = results.filter((result) => result.status === "fulfilled").length;
    const rejectedCount = results.filter((result) => result.status === "rejected").length;

    expect(fulfilledCount).toBe(1);
    expect(rejectedCount).toBe(1);

    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected ? extractRejectedCode(rejected) : undefined).toBe(ROOM_ERROR_CODES.ROOM_INVALID_STATE_TRANSITION);
  });
});

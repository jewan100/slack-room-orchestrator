import { afterEach, describe, expect, it } from "vitest";
import { ROOM_ERROR_CODES } from "../src/shared/errorCodes";
import { ROOM_START_SERVICE_MESSAGES } from "../src/shared/messages";
import { createLogger } from "../src/shared/logger";
import type { SlackThreadPort } from "../src/shared/types";
import { StartRoomSessionService } from "../src/services/startRoomSessionService";
import { createTestDatabase, type TestDatabaseContext } from "./helpers/createTestDatabase";

// start 테스트에서 사용하는 기본 Slack 스레드 포트 대역 구현체
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

// start 후속 안내 메시지 실패 시나리오를 만드는 대역 구현체
class FailingFollowupSlackThreadPort extends FakeSlackThreadPort {
  public async postMessageInThread(input: { channelId: string; threadTs: string; text: string }): Promise<void> {
    this.postedMessages.push(input);
    throw new Error("followup failed");
  }
}

// start 스레드 생성 실패 시나리오를 만드는 대역 구현체
class FailingThreadCreationSlackThreadPort extends FakeSlackThreadPort {
  public async createThread(input: { channelId: string; text: string }): Promise<{ channelId: string; threadTs: string }> {
    this.createdThreads.push(input);
    throw new Error("thread creation failed");
  }
}

// `StartRoomSessionService` 핵심 시나리오를 검증한다.
describe("StartRoomSessionService", () => {
  let context: TestDatabaseContext | null = null;

  // 테스트 간 파일 DB 격리를 위해 매 케이스 후 임시 DB를 정리한다.
  afterEach(async () => {
    if (context) {
      await context.cleanup();
    }
    context = null;
  });

  // 정상 start에서 세션/브리핑/Slack 스레드 메시지가 생성되는지 검증한다.
  it("creates prepared session and briefing", async () => {
    // 준비: 테스트 DB와 서비스/Slack 대역 포트를 만든다.
    context = await createTestDatabase();
    const service = new StartRoomSessionService(
      context.roomSessionRepository,
      context.briefingRepository,
      createLogger("error")
    );
    const slackThreadPort = new FakeSlackThreadPort();

    // 실행: start 명령 유스케이스를 수행한다.
    const result = await service.execute(
      {
        topic: "Implement start command",
        requestedByUserId: "U01",
        workspaceId: "T01",
        startChannelId: "C_START"
      },
      slackThreadPort
    );

    // 검증: 브리핑 저장과 Slack 호출 횟수를 확인한다.
    const briefing = await context.briefingRepository.findBySessionId(result.session.id);

    expect(result.session.state).toBe("PREPARED");
    expect(briefing).not.toBeNull();
    expect(slackThreadPort.createdThreads.length).toBe(1);
    expect(slackThreadPort.postedMessages.length).toBe(1);
  });

  // 같은 채널에 활성 세션이 이미 있으면 start가 차단되는지 검증한다.
  it("throws ROOM_ALREADY_RUNNING when active session exists", async () => {
    // 준비: 첫 번째 start를 성공시켜 활성 세션을 만든다.
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

    // 검증: 차단된 두 번째 요청은 추가 스레드를 생성하지 않아야 한다.
    expect(slackThreadPort.createdThreads.length).toBe(1);
  });

  // sqlite unique 제약 충돌(code/errno)을 ROOM_ALREADY_RUNNING으로 매핑하는지 검증한다.
  it("maps sqlite unique metadata to ROOM_ALREADY_RUNNING", async () => {
    context = await createTestDatabase();
    const repository = context.roomSessionRepository;

    // createPreparedSession 단계에서 sqlite unique 충돌을 강제로 발생시킨다.
    repository.createPreparedSession = async () => {
      const constraintError = new Error(ROOM_START_SERVICE_MESSAGES.activeSessionConstraintIndexName) as Error & {
        code: string;
        errno: number;
      };
      constraintError.code = ROOM_START_SERVICE_MESSAGES.sqliteConstraintErrorCode;
      constraintError.errno = ROOM_START_SERVICE_MESSAGES.sqliteConstraintErrno;
      throw constraintError;
    };

    const service = new StartRoomSessionService(
      repository,
      context.briefingRepository,
      createLogger("error")
    );

    await expect(
      service.execute(
        {
          topic: "Race condition",
          requestedByUserId: "U01",
          workspaceId: "T01",
          startChannelId: "C_START"
        },
        new FakeSlackThreadPort()
      )
    ).rejects.toMatchObject({
      code: ROOM_ERROR_CODES.ROOM_ALREADY_RUNNING
    });
  });

  // 후속 안내 전송 실패가 start 성공 결과를 뒤집지 않는지 검증한다.
  it("keeps start successful even when followup thread notice fails", async () => {
    // 준비: 후속 안내 실패 대역 포트를 사용하는 서비스 인스턴스를 만든다.
    context = await createTestDatabase();
    const service = new StartRoomSessionService(
      context.roomSessionRepository,
      context.briefingRepository,
      createLogger("error")
    );
    const slackThreadPort = new FailingFollowupSlackThreadPort();

    // 실행: 후속 안내 실패가 발생하는 start를 수행한다.
    const result = await service.execute(
      {
        topic: "Start succeeds despite followup failure",
        requestedByUserId: "U01",
        workspaceId: "T01",
        startChannelId: "C_START"
      },
      slackThreadPort
    );

    // 검증: 핵심 결과(세션/브리핑)는 성공 상태를 유지해야 한다.
    const briefing = await context.briefingRepository.findBySessionId(result.session.id);

    expect(result.session.state).toBe("PREPARED");
    expect(briefing).not.toBeNull();
    expect(slackThreadPort.createdThreads.length).toBe(1);
    expect(slackThreadPort.postedMessages.length).toBe(1);
  });

  // start 핵심 단계 실패 시 예약 세션이 롤백되는지 검증한다.
  it("rolls back reserved session when thread creation fails", async () => {
    // 준비: 스레드 생성 실패 대역 포트를 사용하는 서비스 인스턴스를 만든다.
    context = await createTestDatabase();
    const service = new StartRoomSessionService(
      context.roomSessionRepository,
      context.briefingRepository,
      createLogger("error")
    );
    const slackThreadPort = new FailingThreadCreationSlackThreadPort();

    // 실행/검증: 스레드 생성 실패가 예외로 전파되는지 확인한다.
    await expect(
      service.execute(
        {
          topic: "Start with thread failure",
          requestedByUserId: "U01",
          workspaceId: "T01",
          startChannelId: "C_START"
        },
        slackThreadPort
      )
    ).rejects.toThrow("thread creation failed");

    // 검증: 실패 후 활성 세션이 남지 않아야 재시도가 가능하다.
    const activeSession = await context.roomSessionRepository.findActiveSessionByStartChannel("C_START");
    expect(activeSession).toBeNull();
  });
});

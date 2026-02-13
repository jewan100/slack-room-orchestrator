import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomWatchTarget } from "../src/shared/openclawSyncTypes";
import { ROOM_OPENCLAW_MESSAGES, ROOM_OPENCLAW_SLACK_MESSAGES } from "../src/shared/messages";
import { createLogger } from "../src/shared/logger";
import type { OpenClawChatClient, RoomWatchTargetRepository, SlackThreadPort } from "../src/shared/types";
import { LiveReplyToRoomThreadService } from "../src/services/openclaw/liveReplyToRoomThreadService";

// 테스트용 Slack thread 포트 구현체
class FakeSlackThreadPort implements SlackThreadPort {
  public readonly posts: Array<{ channelId: string; threadTs: string; text: string }> = [];

  public async createThread(input: { channelId: string; text: string }): Promise<{ channelId: string; threadTs: string }> {
    return {
      channelId: input.channelId,
      threadTs: "1000.0001"
    };
  }

  public async postMessageInThread(input: { channelId: string; threadTs: string; text: string }): Promise<void> {
    this.posts.push(input);
  }
}

// 테스트용 watch target 모델을 생성한다.
function createWatchTarget(sessionId: string): RoomWatchTarget {
  const now = new Date().toISOString();
  return {
    id: "watch-1",
    sessionId,
    channelId: "C_START",
    threadTs: "1000.0001",
    status: "ON",
    mode: "PLANNING",
    ttlExpiresAt: now,
    messageCount: 0,
    lastQuestionTriggeredAt: null,
    turnedOnAt: now,
    turnedOffAt: null,
    offReason: null,
    createdAt: now,
    updatedAt: now
  };
}

// 테스트에서 필요한 최소 watch target 저장소 구현체를 생성한다.
function createRoomWatchTargetRepository(
  findByChannelAndThread: (channelId: string, threadTs: string) => Promise<RoomWatchTarget | null>
): RoomWatchTargetRepository {
  return {
    async createWatchTargetOn() {
      throw new Error("not used");
    },
    async findActivePlanningByChannel() {
      return null;
    },
    async findOnWatchTargetByChannelAndThread(channelId: string, threadTs: string) {
      return findByChannelAndThread(channelId, threadTs);
    },
    async findOnWatchTargetBySessionId() {
      return null;
    },
    async findExpiredOnWatchTargets() {
      return [];
    },
    async findQuestionTriggerDueWatchTargets() {
      return [];
    },
    async turnOffWatchTarget() {
      return null;
    },
    async incrementMessageCount() {
      throw new Error("not used");
    },
    async claimQuestionTriggerIfDue() {
      return null;
    }
  };
}

// 실시간 답변 서비스의 핵심 동작을 검증한다.
describe("LiveReplyToRoomThreadService", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // 감시 대상 ON 상태에서 OpenClaw 답변이 thread에 게시되는지 검증한다.
  it("posts OpenClaw reply when watch target is active", async () => {
    const slackThreadPort = new FakeSlackThreadPort();
    const watchTargetRepository = createRoomWatchTargetRepository(async () => createWatchTarget("session-1"));
    const complete = vi.fn<OpenClawChatClient["complete"]>();
    complete.mockResolvedValue("냐옹, 바로 정리해줄게!");

    const service = new LiveReplyToRoomThreadService({
      roomWatchTargetRepository: watchTargetRepository,
      openClawChatClient: {
        complete
      },
      logger: createLogger("error"),
      maxRetries: 2,
      retryDelayMs: 100,
      systemMessage: ROOM_OPENCLAW_MESSAGES.liveReplySystemPrompt
    });

    await service.execute({
      requestId: "evt-1",
      sessionId: "session-1",
      channelId: "C_START",
      threadTs: "1000.0001",
      messageTs: "1000.0002",
      userId: "U01",
      userText: "이번 회의 목표 정리해줘",
      slackThreadPort
    });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(slackThreadPort.posts.length).toBe(1);
    expect(slackThreadPort.posts[0]?.text).toBe("냐옹, 바로 정리해줄게!");

    await service.stop();
  });

  // 첫 실패에서는 안내를 1회 보내고, 지연 재시도에서 성공 응답을 보내는지 검증한다.
  it("posts failure notice once and retries asynchronously", async () => {
    vi.useFakeTimers();
    const slackThreadPort = new FakeSlackThreadPort();
    const watchTargetRepository = createRoomWatchTargetRepository(async () => createWatchTarget("session-1"));
    const complete = vi.fn<OpenClawChatClient["complete"]>();
    complete.mockRejectedValueOnce(new Error("temporary failure"));
    complete.mockResolvedValueOnce("재시도 성공 응답");

    const service = new LiveReplyToRoomThreadService({
      roomWatchTargetRepository: watchTargetRepository,
      openClawChatClient: {
        complete
      },
      logger: createLogger("error"),
      maxRetries: 2,
      retryDelayMs: 100,
      systemMessage: ROOM_OPENCLAW_MESSAGES.liveReplySystemPrompt
    });

    await service.execute({
      requestId: "evt-2",
      sessionId: "session-1",
      channelId: "C_START",
      threadTs: "1000.0001",
      messageTs: "1000.0003",
      userId: "U01",
      userText: "중간 요약 부탁해",
      slackThreadPort
    });

    expect(slackThreadPort.posts.length).toBe(1);
    expect(slackThreadPort.posts[0]?.text).toBe(ROOM_OPENCLAW_SLACK_MESSAGES.liveReplyFailureNotice);

    await vi.advanceTimersByTimeAsync(100);

    expect(complete).toHaveBeenCalledTimes(2);
    expect(slackThreadPort.posts.length).toBe(2);
    expect(slackThreadPort.posts[1]?.text).toBe("재시도 성공 응답");

    await service.stop();
  });

  // 동일 메시지가 중복 전달돼도 message key 기준으로 1회만 처리되는지 검증한다.
  it("deduplicates duplicated message key in retry queue", async () => {
    const slackThreadPort = new FakeSlackThreadPort();
    const watchTargetRepository = createRoomWatchTargetRepository(async () => createWatchTarget("session-1"));

    let resolveReply: ((value: string) => void) | undefined;
    const pendingReply = new Promise<string>((resolve) => {
      resolveReply = resolve;
    });
    const complete = vi.fn<OpenClawChatClient["complete"]>();
    complete.mockImplementation(async () => {
      return await pendingReply;
    });

    const service = new LiveReplyToRoomThreadService({
      roomWatchTargetRepository: watchTargetRepository,
      openClawChatClient: {
        complete
      },
      logger: createLogger("error"),
      maxRetries: 2,
      retryDelayMs: 100,
      systemMessage: ROOM_OPENCLAW_MESSAGES.liveReplySystemPrompt
    });

    const first = service.execute({
      requestId: "evt-3a",
      sessionId: "session-1",
      channelId: "C_START",
      threadTs: "1000.0001",
      messageTs: "1000.0004",
      userId: "U01",
      userText: "중복 처리 방지 확인",
      slackThreadPort
    });
    const second = service.execute({
      requestId: "evt-3b",
      sessionId: "session-1",
      channelId: "C_START",
      threadTs: "1000.0001",
      messageTs: "1000.0004",
      userId: "U01",
      userText: "중복 처리 방지 확인",
      slackThreadPort
    });

    if (!resolveReply) {
      throw new Error("resolveReply 미초기화");
    }
    resolveReply("중복 없는 단일 응답");

    await Promise.all([first, second]);

    expect(complete).toHaveBeenCalledTimes(1);
    expect(slackThreadPort.posts.length).toBe(1);
    expect(slackThreadPort.posts[0]?.text).toBe("중복 없는 단일 응답");

    await service.stop();
  });

  // launch/TTL 레이스로 OFF 전환된 경우에는 최종 게시를 생략하는지 검증한다.
  it("skips posting when watch target turns off before post", async () => {
    const slackThreadPort = new FakeSlackThreadPort();
    let lookupCount = 0;
    const watchTargetRepository = createRoomWatchTargetRepository(async () => {
      lookupCount += 1;
      if (lookupCount === 1) {
        return createWatchTarget("session-1");
      }
      return null;
    });
    const complete = vi.fn<OpenClawChatClient["complete"]>();
    complete.mockResolvedValue("이 응답은 게시되면 안 됨");

    const service = new LiveReplyToRoomThreadService({
      roomWatchTargetRepository: watchTargetRepository,
      openClawChatClient: {
        complete
      },
      logger: createLogger("error"),
      maxRetries: 2,
      retryDelayMs: 100,
      systemMessage: ROOM_OPENCLAW_MESSAGES.liveReplySystemPrompt
    });

    await service.execute({
      requestId: "evt-4",
      sessionId: "session-1",
      channelId: "C_START",
      threadTs: "1000.0001",
      messageTs: "1000.0005",
      userId: "U01",
      userText: "launch 직후 레이스 테스트",
      slackThreadPort
    });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(slackThreadPort.posts.length).toBe(0);

    await service.stop();
  });
});

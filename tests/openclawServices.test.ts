import { afterEach, describe, expect, it } from "vitest";
import { OPENCLAW_EVENT_PROTOCOL_VERSION } from "../src/shared/openclawSyncTypes";
import { ROOM_OPENCLAW_SLACK_MESSAGES } from "../src/shared/messages";
import { createLogger } from "../src/shared/logger";
import type { OpenClawEventSink, SlackThreadPort } from "../src/shared/types";
import { createRoomThreadEventHandler } from "../src/adapters/inbound/slack/roomThreadEventHandler";
import { DispatchOpenclawOutboxService } from "../src/services/openclaw/dispatchOpenclawOutboxService";
import { EmitQuestionTriggerService } from "../src/services/openclaw/emitQuestionTriggerService";
import { ExpireRoomModeService } from "../src/services/openclaw/expireRoomModeService";
import { IngestRoomThreadMessageService } from "../src/services/openclaw/ingestRoomThreadMessageService";
import { createTestDatabase, type TestDatabaseContext } from "./helpers/createTestDatabase";

// 디스패치 테스트에서 쓰는 in-memory sink 구현체
class FakeOpenClawEventSink implements OpenClawEventSink {
  public readonly events: unknown[] = [];
  private shouldFail = false;

  public setFailure(shouldFail: boolean): void {
    this.shouldFail = shouldFail;
  }

  public async appendEvent(event: unknown): Promise<void> {
    if (this.shouldFail) {
      throw new Error("append failed");
    }

    this.events.push(event);
  }
}

// OpenClaw 연동 서비스의 핵심 흐름을 검증한다.
describe("openclaw services", () => {
  let context: TestDatabaseContext | null = null;

  afterEach(async () => {
    if (context) {
      await context.cleanup();
    }
    context = null;
  });

  // 감시 대상 스레드 메시지가 누적되면 message_count가 증가하고 수집 결과가 반환되는지 검증한다.
  it("ingests watch thread message and increments message_count", async () => {
    context = await createTestDatabase();
    const startedAt = Date.now();
    const session = await context.roomSessionRepository.createPreparedSession({
      topic: "Message ingest",
      requestedByUserId: "U01",
      workspaceId: "T01",
      startChannelId: "C_START",
      startThreadTs: "1000.0001"
    });
    await context.roomWatchTargetRepository.createWatchTargetOn({
      sessionId: session.id,
      channelId: "C_START",
      threadTs: "1000.0001",
      mode: "PLANNING",
      ttlExpiresAt: new Date(Date.now() + 60_000).toISOString()
    });

    const service = new IngestRoomThreadMessageService({
      roomWatchTargetRepository: context.roomWatchTargetRepository,
      roomThreadMessageRepository: context.roomThreadMessageRepository,
      roomModeTtlMinutes: 10,
      logger: createLogger("error")
    });

    const result = await service.execute({
      channelId: "C_START",
      threadTs: "1000.0001",
      messageTs: "1000.0002",
      userId: "U01",
      subtype: null,
      isBot: false,
      eventTs: "1000.0002"
    });

    expect(result.kind).toBe("INGESTED");
    if (result.kind === "INGESTED") {
      expect(result.messageCount).toBe(1);
    }

    const onWatchTarget = await context.roomWatchTargetRepository.findOnWatchTargetBySessionId(session.id);
    expect(onWatchTarget?.messageCount).toBe(1);
    expect(Date.parse(onWatchTarget?.ttlExpiresAt ?? "1970-01-01T00:00:00.000Z")).toBeGreaterThanOrEqual(
      startedAt + 9 * 60_000
    );

    const pendingEvents = await context.openClawEventOutboxRepository.claimPendingEvents(new Date().toISOString(), 10);
    expect(pendingEvents.length).toBe(0);
  });

  // TTL 만료 대상(PREPARED)은 watch OFF와 함께 세션이 DECIDED로 종료되고 안내 메시지가 남는지 검증한다.
  it("expires prepared watch target and finalizes session with ttl notice", async () => {
    context = await createTestDatabase();
    const session = await context.roomSessionRepository.createPreparedSession({
      topic: "TTL off",
      requestedByUserId: "U01",
      workspaceId: "T01",
      startChannelId: "C_START",
      startThreadTs: "1000.0001"
    });
    await context.roomWatchTargetRepository.createWatchTargetOn({
      sessionId: session.id,
      channelId: "C_START",
      threadTs: "1000.0001",
      mode: "PLANNING",
      ttlExpiresAt: new Date(Date.now() - 60_000).toISOString()
    });

    const noticeMessages: Array<{ channelId: string; threadTs: string; text: string }> = [];
    const slackThreadPort: SlackThreadPort = {
      async createThread() {
        return { channelId: "C_START", threadTs: "unused" };
      },
      async postMessageInThread(input) {
        noticeMessages.push(input);
      }
    };

    const service = new ExpireRoomModeService({
      roomWatchTargetRepository: context.roomWatchTargetRepository,
      roomSessionRepository: context.roomSessionRepository,
      openClawEventOutboxRepository: context.openClawEventOutboxRepository,
      createSlackThreadPort: () => slackThreadPort,
      batchSize: 10,
      logger: createLogger("error")
    });

    await service.execute();

    const onWatchTarget = await context.roomWatchTargetRepository.findOnWatchTargetBySessionId(session.id);
    const loadedSession = await context.roomSessionRepository.findById(session.id);
    expect(onWatchTarget).toBeNull();
    expect(loadedSession?.id).toBe(session.id);
    expect(loadedSession?.state).toBe("DECIDED");

    const pendingEvents = await context.openClawEventOutboxRepository.claimPendingEvents(new Date().toISOString(), 10);
    const offEvent = pendingEvents.find((event) => event.eventType === "ROOM_MODE_OFF");
    expect(offEvent).toBeDefined();
    expect((offEvent?.payload as { offReason?: string }).offReason).toBe("TTL");
    expect((offEvent?.payload as { state?: string }).state).toBe("DECIDED");
    expect(noticeMessages).toEqual([
      {
        channelId: "C_START",
        threadTs: "1000.0001",
        text: ROOM_OPENCLAW_SLACK_MESSAGES.ttlModeOffNotice
      }
    ]);
  });

  // 질문 트리거 주기가 지난 대상에서 ROOM_QUESTION_TRIGGER가 enqueue되는지 검증한다.
  it("enqueues ROOM_QUESTION_TRIGGER for due watch target", async () => {
    context = await createTestDatabase();
    const session = await context.roomSessionRepository.createPreparedSession({
      topic: "Question trigger",
      requestedByUserId: "U01",
      workspaceId: "T01",
      startChannelId: "C_START",
      startThreadTs: "1000.0001"
    });
    const watchTarget = await context.roomWatchTargetRepository.createWatchTargetOn({
      sessionId: session.id,
      channelId: "C_START",
      threadTs: "1000.0001",
      mode: "PLANNING",
      ttlExpiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    await context.roomWatchTargetRepository.incrementMessageCount(watchTarget.id);

    const service = new EmitQuestionTriggerService({
      roomWatchTargetRepository: context.roomWatchTargetRepository,
      roomSessionRepository: context.roomSessionRepository,
      openClawEventOutboxRepository: context.openClawEventOutboxRepository,
      questionIntervalMinutes: 30,
      batchSize: 10,
      logger: createLogger("error")
    });

    await service.execute();

    const pendingEvents = await context.openClawEventOutboxRepository.claimPendingEvents(new Date().toISOString(), 10);
    const questionTrigger = pendingEvents.find((event) => event.eventType === "ROOM_QUESTION_TRIGGER");
    expect(questionTrigger).toBeDefined();
    expect(questionTrigger?.payload.eventType).toBe("ROOM_QUESTION_TRIGGER");
  });

  // outbox 디스패치 성공 시 pending이 비워지고, 실패 시 retry_count가 증가하는지 검증한다.
  it("dispatches outbox events and schedules retry on failure", async () => {
    context = await createTestDatabase();
    const session = await context.roomSessionRepository.createPreparedSession({
      topic: "Outbox dispatch",
      requestedByUserId: "U01",
      workspaceId: "T01",
      startChannelId: "C_START",
      startThreadTs: "1000.0001"
    });

    await context.openClawEventOutboxRepository.enqueueEvent({
      eventId: "dispatch-event-1",
      eventType: "ROOM_MODE_ON",
      sessionId: session.id,
      channelId: "C_START",
      threadTs: "1000.0001",
      topic: session.topic,
      state: "PREPARED",
      occurredAt: new Date().toISOString(),
      version: OPENCLAW_EVENT_PROTOCOL_VERSION,
      ttlExpiresAt: new Date(Date.now() + 60_000).toISOString()
    });

    const sink = new FakeOpenClawEventSink();
    sink.setFailure(true);

    const service = new DispatchOpenclawOutboxService({
      openClawEventOutboxRepository: context.openClawEventOutboxRepository,
      openClawEventSink: sink,
      retryDelayMs: 100,
      batchSize: 10,
      logger: createLogger("error")
    });

    await service.execute();

    const afterFailure = await context.openClawEventOutboxRepository.claimPendingEvents(
      new Date(Date.now() + 200).toISOString(),
      10
    );
    expect(afterFailure.length).toBe(1);
    expect(afterFailure[0]?.retryCount).toBe(1);

    sink.setFailure(false);
    await new Promise((resolve) => setTimeout(resolve, 120));
    await service.execute();

    const afterSuccess = await context.openClawEventOutboxRepository.claimPendingEvents(
      new Date(Date.now() + 200).toISOString(),
      10
    );
    expect(afterSuccess.length).toBe(0);
    expect(sink.events.length).toBe(1);
  });

  // roomThreadEventHandler가 non-thread 이벤트를 무시하고, 유효 thread 메시지만 수집 서비스로 전달하는지 검증한다.
  it("filters invalid message events in room thread event handler", async () => {
    const calls: Array<{ channelId: string; threadTs: string; messageTs: string }> = [];
    const slackThreadPort: SlackThreadPort = {
      async createThread() {
        return { channelId: "C_START", threadTs: "1000.0001" };
      },
      async postMessageInThread() {
        return;
      }
    };

    const handler = createRoomThreadEventHandler({
      roomThreadMessageIngestService: {
        async execute(input) {
          calls.push({
            channelId: input.channelId,
            threadTs: input.threadTs,
            messageTs: input.messageTs
          });
          return {
            kind: "INGESTED",
            sessionId: "session-1",
            channelId: input.channelId,
            threadTs: input.threadTs,
            messageTs: input.messageTs,
            messageCount: 1
          };
        }
      },
      roomLiveReplyService: {
        async execute() {
          return;
        }
      },
      logger: createLogger("error")
    });

    await handler({
      requestId: "evt-1",
      event: { channel: "C_START", ts: "1000.0001" },
      slackThreadPort
    });
    await handler({
      requestId: "evt-2",
      event: { channel: "C_START", thread_ts: "1000.0001", ts: "1000.0002", subtype: "message_changed" },
      slackThreadPort
    });
    await handler({
      requestId: "evt-3",
      event: { channel: "C_START", thread_ts: "1000.0001", ts: "1000.0003", bot_id: "B01" },
      slackThreadPort
    });
    await handler({
      requestId: "evt-4",
      event: { channel: "C_START", thread_ts: "1000.0001", ts: "1000.0004", user: "U01", text: "hello" },
      slackThreadPort
    });

    expect(calls.length).toBe(1);
    expect(calls[0]?.threadTs).toBe("1000.0001");
    expect(calls[0]?.messageTs).toBe("1000.0004");
  });
});

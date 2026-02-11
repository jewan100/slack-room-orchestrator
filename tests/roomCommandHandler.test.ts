import { describe, expect, it, vi } from "vitest";
import {
  createRoomCommandHandler,
  type LaunchRoomSessionServicePort,
  type StartRoomSessionServicePort,
  type SummarizeRoomSessionServicePort
} from "../src/adapters/inbound/slack/roomCommandHandler";
import { ROOM_ERROR_CODES } from "../src/shared/errorCodes";
import { createLogger } from "../src/shared/logger";
import { RoomCommandError } from "../src/shared/roomCommandError";
import type { CommandResponsePayload, RoomCommandRequest, SlackChatClient, SlackThreadPort } from "../src/shared/types";

// Slack Web API 최소 표면을 테스트 전용으로 모킹한다.
function createSlackClientMock(): SlackChatClient {
  return {
    chat: {
      postMessage: vi.fn(async () => {
        return { ts: "1000.0001" };
      })
    }
  };
}

// 핸들러가 의존하는 SlackThreadPort를 성공 응답 대역으로 제공한다.
function createNoopSlackThreadPort(): SlackThreadPort {
  return {
    async createThread(input) {
      return {
        channelId: input.channelId,
        threadTs: "1000.0001"
      };
    },
    async postMessageInThread() {
      return;
    }
  };
}

// start 경로 테스트에서 summary 서비스 호출을 막기 위한 더미 구현체
function createUnusedSummaryService(): SummarizeRoomSessionServicePort {
  return {
    async execute() {
      throw new Error("not used");
    }
  };
}

// start 경로 테스트에서 launch 서비스 호출을 막기 위한 더미 구현체
function createUnusedLaunchService(): LaunchRoomSessionServicePort {
  return {
    async execute() {
      throw new Error("not used");
    }
  };
}

// `createRoomCommandHandler`의 ack/응답/오류 정규화 계약을 검증한다.
describe("createRoomCommandHandler", () => {
  // Slack 3초 제한 대비를 위해 ack가 서비스 실행보다 먼저 호출되는지 검증한다.
  it("acks before running slow service", async () => {
    // 준비: ack 시각/서비스 시각/응답 페이로드 수집 변수를 선언한다.
    let ackCalledAt = 0;
    let serviceCalledAt = 0;
    const responses: CommandResponsePayload[] = [];

    // 준비: 의도적으로 지연되는 start 서비스 대역을 만든다.
    const startService: StartRoomSessionServicePort = {
      async execute() {
        serviceCalledAt = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 25));
        return {
          session: {
            id: "session-1",
            state: "PREPARED"
          }
        };
      }
    };

    // 준비: 핸들러 인스턴스를 조립한다.
    const handler = createRoomCommandHandler({
      startChannelId: "C_START",
      launchChannelId: "C_LAUNCH",
      startRoomSessionService: startService,
      summarizeRoomSessionService: createUnusedSummaryService(),
      launchRoomSessionService: createUnusedLaunchService(),
      createSlackThreadPort: () => createNoopSlackThreadPort(),
      logger: createLogger("error")
    });

    // 준비: Slack 요청 모형을 구성한다.
    const request: RoomCommandRequest = {
      ack: async () => {
        ackCalledAt = Date.now();
      },
      respond: async (payload) => {
        responses.push(payload);
      },
      command: {
        text: "start hello",
        userId: "U01",
        teamId: "T01",
        channelId: "C01"
      },
      client: createSlackClientMock()
    };

    // 실행: 핸들러를 호출한다.
    await handler(request);

    // 검증: ack 선호출과 정상 응답 텍스트를 확인한다.
    expect(ackCalledAt).toBeGreaterThan(0);
    expect(serviceCalledAt).toBeGreaterThan(0);
    expect(ackCalledAt).toBeLessThanOrEqual(serviceCalledAt);
    expect(responses.length).toBe(1);
    expect(responses[0]?.text).toContain("상태: PREPARED");
  });

  // 잘못된 커맨드 입력에 사용법/에러코드가 포함된 응답이 반환되는지 검증한다.
  it("returns usage and error code for invalid command", async () => {
    // 준비: 응답 수집 배열과 미사용 start 서비스 대역을 만든다.
    const responses: CommandResponsePayload[] = [];
    const startService: StartRoomSessionServicePort = {
      async execute() {
        throw new Error("not used");
      }
    };

    // 준비: 핸들러 인스턴스를 조립한다.
    const handler = createRoomCommandHandler({
      startChannelId: "C_START",
      launchChannelId: "C_LAUNCH",
      startRoomSessionService: startService,
      summarizeRoomSessionService: createUnusedSummaryService(),
      launchRoomSessionService: createUnusedLaunchService(),
      createSlackThreadPort: () => createNoopSlackThreadPort(),
      logger: createLogger("error")
    });

    // 실행: invalid 커맨드를 핸들러에 전달한다.
    await handler({
      ack: async () => {
        return;
      },
      respond: async (payload) => {
        responses.push(payload);
      },
      command: {
        text: "unknown command",
        userId: "U01",
        teamId: "T01",
        channelId: "C01"
      },
      client: createSlackClientMock()
    });

    // 검증: 에러코드/사용법 안내가 응답에 포함되는지 확인한다.
    expect(responses.length).toBe(1);
    expect(responses[0]?.text).toContain(ROOM_ERROR_CODES.ROOM_INVALID_COMMAND);
    expect(responses[0]?.text).toContain("/room start <주제>");
  });

  // 서비스 도메인 에러가 공통 응답 포맷으로 정규화되는지 검증한다.
  it("maps service errors to common error format", async () => {
    // 준비: 항상 ROOM_ALREADY_RUNNING을 던지는 start 서비스 대역을 만든다.
    const responses: CommandResponsePayload[] = [];
    const startService: StartRoomSessionServicePort = {
      async execute() {
        throw new RoomCommandError(ROOM_ERROR_CODES.ROOM_ALREADY_RUNNING);
      }
    };

    // 준비: 핸들러 인스턴스를 조립한다.
    const handler = createRoomCommandHandler({
      startChannelId: "C_START",
      launchChannelId: "C_LAUNCH",
      startRoomSessionService: startService,
      summarizeRoomSessionService: createUnusedSummaryService(),
      launchRoomSessionService: createUnusedLaunchService(),
      createSlackThreadPort: () => createNoopSlackThreadPort(),
      logger: createLogger("error")
    });

    // 실행: start 요청을 전달한다.
    await handler({
      ack: async () => {
        return;
      },
      respond: async (payload) => {
        responses.push(payload);
      },
      command: {
        text: "start duplicate",
        userId: "U01",
        teamId: "T01",
        channelId: "C01"
      },
      client: createSlackClientMock()
    });

    // 검증: 도메인 에러코드가 응답 텍스트에 유지되는지 확인한다.
    expect(responses.length).toBe(1);
    expect(responses[0]?.text).toContain(ROOM_ERROR_CODES.ROOM_ALREADY_RUNNING);
  });

  // 내부 예외 원문이 사용자 응답으로 노출되지 않는지 검증한다.
  it("does not expose raw internal error message to user response", async () => {
    // 준비: 내부 예외를 던지는 start 서비스 대역을 만든다.
    const responses: CommandResponsePayload[] = [];
    const startService: StartRoomSessionServicePort = {
      async execute() {
        throw new Error("sqlite internal path leaked");
      }
    };

    // 준비: 핸들러 인스턴스를 조립한다.
    const handler = createRoomCommandHandler({
      startChannelId: "C_START",
      launchChannelId: "C_LAUNCH",
      startRoomSessionService: startService,
      summarizeRoomSessionService: createUnusedSummaryService(),
      launchRoomSessionService: createUnusedLaunchService(),
      createSlackThreadPort: () => createNoopSlackThreadPort(),
      logger: createLogger("error")
    });

    // 실행: 내부 예외를 유도하는 요청을 전달한다.
    await handler({
      ack: async () => {
        return;
      },
      respond: async (payload) => {
        responses.push(payload);
      },
      command: {
        text: "start internal",
        userId: "U01",
        teamId: "T01",
        channelId: "C01"
      },
      client: createSlackClientMock()
    });

    // 검증: 사용자 응답은 내부 에러코드 문구만 포함해야 한다.
    expect(responses.length).toBe(1);
    expect(responses[0]?.text).toContain(ROOM_ERROR_CODES.ROOM_INTERNAL_ERROR);
    expect(responses[0]?.text).not.toContain("sqlite internal path leaked");
  });
});

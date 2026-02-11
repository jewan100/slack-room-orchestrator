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

function createSlackClientMock(): SlackChatClient {
  return {
    chat: {
      postMessage: vi.fn(async () => {
        return { ts: "1000.0001" };
      })
    }
  };
}

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

function createUnusedSummaryService(): SummarizeRoomSessionServicePort {
  return {
    async execute() {
      throw new Error("not used");
    }
  };
}

function createUnusedLaunchService(): LaunchRoomSessionServicePort {
  return {
    async execute() {
      throw new Error("not used");
    }
  };
}

describe("createRoomCommandHandler", () => {
  it("acks before running slow service", async () => {
    let ackCalledAt = 0;
    let serviceCalledAt = 0;
    const responses: CommandResponsePayload[] = [];

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

    const handler = createRoomCommandHandler({
      startChannelId: "C_START",
      launchChannelId: "C_LAUNCH",
      startRoomSessionService: startService,
      summarizeRoomSessionService: createUnusedSummaryService(),
      launchRoomSessionService: createUnusedLaunchService(),
      createSlackThreadPort: () => createNoopSlackThreadPort(),
      logger: createLogger("error")
    });

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

    await handler(request);

    expect(ackCalledAt).toBeGreaterThan(0);
    expect(serviceCalledAt).toBeGreaterThan(0);
    expect(ackCalledAt).toBeLessThanOrEqual(serviceCalledAt);
    expect(responses.length).toBe(1);
    expect(responses[0]?.text).toContain("상태: PREPARED");
  });

  it("returns usage and error code for invalid command", async () => {
    const responses: CommandResponsePayload[] = [];
    const startService: StartRoomSessionServicePort = {
      async execute() {
        throw new Error("not used");
      }
    };

    const handler = createRoomCommandHandler({
      startChannelId: "C_START",
      launchChannelId: "C_LAUNCH",
      startRoomSessionService: startService,
      summarizeRoomSessionService: createUnusedSummaryService(),
      launchRoomSessionService: createUnusedLaunchService(),
      createSlackThreadPort: () => createNoopSlackThreadPort(),
      logger: createLogger("error")
    });

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

    expect(responses.length).toBe(1);
    expect(responses[0]?.text).toContain(ROOM_ERROR_CODES.ROOM_INVALID_COMMAND);
    expect(responses[0]?.text).toContain("/room start <주제>");
  });

  it("maps service errors to common error format", async () => {
    const responses: CommandResponsePayload[] = [];
    const startService: StartRoomSessionServicePort = {
      async execute() {
        throw new RoomCommandError(ROOM_ERROR_CODES.ROOM_ALREADY_RUNNING);
      }
    };

    const handler = createRoomCommandHandler({
      startChannelId: "C_START",
      launchChannelId: "C_LAUNCH",
      startRoomSessionService: startService,
      summarizeRoomSessionService: createUnusedSummaryService(),
      launchRoomSessionService: createUnusedLaunchService(),
      createSlackThreadPort: () => createNoopSlackThreadPort(),
      logger: createLogger("error")
    });

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

    expect(responses.length).toBe(1);
    expect(responses[0]?.text).toContain(ROOM_ERROR_CODES.ROOM_ALREADY_RUNNING);
  });
});

import { describe, expect, it, vi } from "vitest";
import { createRoomCommandHandler } from "../src/adapters/inbound/slack/roomCommandHandler";
import { ROOM_ERROR_CODES } from "../src/shared/errorCodes";
import { ROOM_COMMAND_MESSAGES } from "../src/shared/messages";
import { createLogger } from "../src/shared/logger";
import type { RoomCommandRequest, SlackChatClient, SlackThreadPort } from "../src/shared/types";

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

// `createRoomCommandHandler`의 라우팅/예외 전파/스레드 공지 계약을 검증한다.
describe("createRoomCommandHandler", () => {
  it("routes /room start to start service", async () => {
    const startService = {
      execute: vi.fn(async () => {
        return {
          session: {
            id: "session-1",
            state: "PREPARED",
            startThreadTs: "1000.0001"
          }
        };
      })
    };

    const handler = createRoomCommandHandler({
      startChannelId: "C_START",
      launchChannelId: "C_LAUNCH",
      startRoomSessionService: startService,
      launchRoomSessionService: {
        async execute() {
          throw new Error("not used");
        }
      },
      stopRoomSessionService: {
        async execute() {
          throw new Error("not used");
        }
      },
      createSlackThreadPort: () => createNoopSlackThreadPort(),
      logger: createLogger("error")
    });

    const request: RoomCommandRequest = {
      requestId: "request-1",
      startedAt: Date.now(),
      command: {
        text: "start",
        userId: "U01",
        teamId: "T01",
        channelId: "C01"
      },
      client: createSlackClientMock()
    };

    await handler(request);

    expect(startService.execute).toHaveBeenCalledTimes(1);
    expect(startService.execute).toHaveBeenCalledWith(
      {
        requestedByUserId: "U01",
        workspaceId: "T01",
        startChannelId: "C_START"
      },
      expect.any(Object)
    );
  });

  it("routes /room stop to stop service and posts success notice in thread", async () => {
    const postMessageInThread = vi.fn(async () => {
      return;
    });

    const stopService = {
      execute: vi.fn(async () => {
        return {
          session: {
            id: "session-stop-1",
            state: "DECIDED",
            startThreadTs: "3000.0001"
          }
        };
      })
    };

    const handler = createRoomCommandHandler({
      startChannelId: "C_START",
      launchChannelId: "C_LAUNCH",
      startRoomSessionService: {
        async execute() {
          throw new Error("not used");
        }
      },
      launchRoomSessionService: {
        async execute() {
          throw new Error("not used");
        }
      },
      stopRoomSessionService: stopService,
      createSlackThreadPort: () => ({
        async createThread(input) {
          return {
            channelId: input.channelId,
            threadTs: "3000.0001"
          };
        },
        postMessageInThread
      }),
      logger: createLogger("error")
    });

    await handler({
      requestId: "request-2",
      startedAt: Date.now(),
      command: {
        text: "stop",
        userId: "U01",
        teamId: "T01",
        channelId: "C01"
      },
      client: createSlackClientMock()
    });

    expect(stopService.execute).toHaveBeenCalledTimes(1);
    expect(postMessageInThread).toHaveBeenCalledWith({
      channelId: "C_START",
      threadTs: "3000.0001",
      text: ROOM_COMMAND_MESSAGES.stopSuccessText
    });
  });

  it("throws when stop thread notice fails", async () => {
    const stopService = {
      execute: vi.fn(async () => {
        return {
          session: {
            id: "session-stop-2",
            state: "DECIDED",
            startThreadTs: "3000.0002"
          }
        };
      })
    };

    const handler = createRoomCommandHandler({
      startChannelId: "C_START",
      launchChannelId: "C_LAUNCH",
      startRoomSessionService: {
        async execute() {
          throw new Error("not used");
        }
      },
      launchRoomSessionService: {
        async execute() {
          throw new Error("not used");
        }
      },
      stopRoomSessionService: stopService,
      createSlackThreadPort: () => ({
        async createThread(input) {
          return {
            channelId: input.channelId,
            threadTs: "3000.0002"
          };
        },
        async postMessageInThread() {
          throw new Error("post failed");
        }
      }),
      logger: createLogger("error")
    });

    await expect(
      handler({
        requestId: "request-3",
        startedAt: Date.now(),
        command: {
          text: "stop",
          userId: "U01",
          teamId: "T01",
          channelId: "C01"
        },
        client: createSlackClientMock()
      })
    ).rejects.toMatchObject({
      code: ROOM_ERROR_CODES.ROOM_INTERNAL_ERROR
    });
  });

  it("routes /room launch to launch service", async () => {
    const launchService = {
      execute: vi.fn(async () => {
        return {
          session: {
            id: "session-launch-1",
            state: "RUNNING",
            launchThreadTs: "2000.0001"
          },
          round: {
            roundNo: 1
          }
        };
      })
    };

    const handler = createRoomCommandHandler({
      startChannelId: "C_START",
      launchChannelId: "C_LAUNCH",
      startRoomSessionService: {
        async execute() {
          throw new Error("not used");
        }
      },
      launchRoomSessionService: launchService,
      stopRoomSessionService: {
        async execute() {
          throw new Error("not used");
        }
      },
      createSlackThreadPort: () => createNoopSlackThreadPort(),
      logger: createLogger("error")
    });

    await handler({
      requestId: "request-4",
      startedAt: Date.now(),
      command: {
        text: "launch",
        userId: "U01",
        teamId: "T01",
        channelId: "C01"
      },
      client: createSlackClientMock()
    });

    expect(launchService.execute).toHaveBeenCalledTimes(1);
    expect(launchService.execute).toHaveBeenCalledWith(
      {
        startChannelId: "C_START",
        launchChannelId: "C_LAUNCH"
      },
      expect.any(Object)
    );
  });

  it("throws for /room help because help is handled as inbound fast-path", async () => {
    const handler = createRoomCommandHandler({
      startChannelId: "C_START",
      launchChannelId: "C_LAUNCH",
      startRoomSessionService: {
        async execute() {
          throw new Error("not used");
        }
      },
      launchRoomSessionService: {
        async execute() {
          throw new Error("not used");
        }
      },
      stopRoomSessionService: {
        async execute() {
          throw new Error("not used");
        }
      },
      createSlackThreadPort: () => createNoopSlackThreadPort(),
      logger: createLogger("error")
    });

    await expect(
      handler({
        requestId: "request-5",
        startedAt: Date.now(),
        command: {
          text: "help",
          userId: "U01",
          teamId: "T01",
          channelId: "C01"
        },
        client: createSlackClientMock()
      })
    ).rejects.toMatchObject({
      code: ROOM_ERROR_CODES.ROOM_INVALID_COMMAND
    });
  });
});

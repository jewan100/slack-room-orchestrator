import { describe, expect, it, vi } from "vitest";
import type { AckFn, RespondArguments, RespondFn } from "@slack/bolt";
import type { Logger } from "../src/shared/logger";
import { ROOM_LOG_EVENT_NAMES } from "../src/shared/messages";
import { createRoomSlashResponseController } from "../src/adapters/inbound/slack/roomSlashResponseController";

function createLoggerMock(): {
  logger: Logger;
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  const debug = vi.fn();
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();

  return {
    logger: {
      debug,
      info,
      warn,
      error
    },
    debug,
    info,
    warn,
    error
  };
}

function createSlashAckMock(): ReturnType<typeof vi.fn<AckFn<string | RespondArguments>>> {
  return vi.fn(async () => {
    return;
  });
}

function createSlashRespondMock(): ReturnType<typeof vi.fn<RespondFn>> {
  return vi.fn(async () => {
    return;
  });
}

describe("createRoomSlashResponseController", () => {
  it("acks once and forces response_type=ephemeral", async () => {
    const ack = createSlashAckMock();
    const respond = createSlashRespondMock();
    const { logger, warn } = createLoggerMock();

    const controller = createRoomSlashResponseController({
      logger,
      requestId: "request-1",
      ack,
      respond,
      command: {
        text: "start",
        channelId: "C01",
        teamId: "T01",
        userId: "U01",
        triggerId: "trigger-1"
      }
    });

    await controller.ackOnce({ text: "처리 중" });
    await controller.ackOnce({ text: "중복 호출" });

    expect(ack).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "처리 중",
        response_type: "ephemeral"
      })
    );
    expect(warn).toHaveBeenCalledWith(ROOM_LOG_EVENT_NAMES.slashCommandAckSkipped, expect.any(Object));
  });

  it("replaces original once and injects replace_original/ephemeral", async () => {
    const ack = createSlashAckMock();
    const respond = createSlashRespondMock();
    const { logger, warn } = createLoggerMock();

    const controller = createRoomSlashResponseController({
      logger,
      requestId: "request-2",
      ack,
      respond,
      command: {
        text: "stop",
        channelId: "C01",
        teamId: "T01",
        userId: "U01",
        triggerId: "trigger-2"
      }
    });

    await controller.replaceOriginalOnce({ text: "오류 발생" });
    await controller.replaceOriginalOnce({ text: "중복 교체" });

    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({
        replace_original: true,
        response_type: "ephemeral",
        text: "오류 발생"
      })
    );
    expect(warn).toHaveBeenCalledWith(
      ROOM_LOG_EVENT_NAMES.slashCommandFollowupReplaceSkipped,
      expect.any(Object)
    );
  });

  it("keeps didReplace=false when replace_original fails", async () => {
    const ack = createSlashAckMock();
    const respond: ReturnType<typeof vi.fn<RespondFn>> = vi
      .fn()
      .mockRejectedValueOnce(new Error("network failed"))
      .mockResolvedValueOnce(undefined);
    const { logger } = createLoggerMock();

    const controller = createRoomSlashResponseController({
      logger,
      requestId: "request-3",
      ack,
      respond,
      command: {
        text: "launch",
        channelId: "C01",
        teamId: "T01",
        userId: "U01",
        triggerId: "trigger-3"
      }
    });

    await expect(controller.replaceOriginalOnce({ text: "오류" })).rejects.toThrow("network failed");

    await controller.deleteOriginalBestEffort();

    expect(respond).toHaveBeenCalledTimes(2);
    expect(respond).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        replace_original: true,
        response_type: "ephemeral"
      })
    );
    expect(respond).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        delete_original: true
      })
    );
  });

  it("does not delete original when replace_original succeeded", async () => {
    const ack = createSlashAckMock();
    const respond = createSlashRespondMock();
    const { logger } = createLoggerMock();

    const controller = createRoomSlashResponseController({
      logger,
      requestId: "request-4",
      ack,
      respond,
      command: {
        text: "stop",
        channelId: "C01",
        teamId: "T01",
        userId: "U01",
        triggerId: "trigger-4"
      }
    });

    await controller.replaceOriginalOnce({ text: "오류" });
    await controller.deleteOriginalBestEffort();

    expect(respond).toHaveBeenCalledTimes(1);
  });

  it("swallows delete_original failures and logs warning", async () => {
    const ack = createSlashAckMock();
    const respond: ReturnType<typeof vi.fn<RespondFn>> = vi.fn().mockRejectedValueOnce(new Error("delete failed"));
    const { logger, warn } = createLoggerMock();

    const controller = createRoomSlashResponseController({
      logger,
      requestId: "request-5",
      ack,
      respond,
      command: {
        text: "start",
        channelId: "C01",
        teamId: "T01",
        userId: "U01",
        triggerId: "trigger-5"
      }
    });

    await expect(controller.deleteOriginalBestEffort()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(ROOM_LOG_EVENT_NAMES.slashCommandFollowupDeleteFailed, expect.any(Object));
  });
});

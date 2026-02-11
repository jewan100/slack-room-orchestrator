import { describe, expect, it } from "vitest";
import { ROOM_COMMAND_MESSAGES } from "../src/shared/messages";
import { ROOM_ERROR_CODES } from "../src/shared/errorCodes";
import { parseRoomCommand } from "../src/commands/roomCommandRouter";

describe("parseRoomCommand", () => {
  it("parses /room start with topic", () => {
    const parsed = parseRoomCommand("start build slack mvp");
    expect(parsed).toEqual({
      kind: "start",
      topic: "build slack mvp"
    });
  });

  it("returns missing topic error for /room start without topic", () => {
    const parsed = parseRoomCommand("start");
    expect(parsed).toEqual({
      kind: "invalid",
      code: ROOM_ERROR_CODES.ROOM_MISSING_TOPIC,
      message: "`/room start` 명령에는 주제가 필요합니다."
    });
  });

  it("parses /room summary default mode", () => {
    const parsed = parseRoomCommand("summary");
    expect(parsed).toEqual({
      kind: "summary",
      mode: "brief"
    });
  });

  it("parses /room summary --full", () => {
    const parsed = parseRoomCommand("summary --full");
    expect(parsed).toEqual({
      kind: "summary",
      mode: "full"
    });
  });

  it("rejects unknown summary option", () => {
    const parsed = parseRoomCommand("summary --detail");
    expect(parsed).toEqual({
      kind: "invalid",
      code: ROOM_ERROR_CODES.ROOM_INVALID_COMMAND,
      message: ROOM_COMMAND_MESSAGES.invalidSummaryOption
    });
  });

  it("parses /room launch", () => {
    const parsed = parseRoomCommand("launch");
    expect(parsed).toEqual({
      kind: "launch"
    });
  });

  it("rejects unknown subcommand", () => {
    const parsed = parseRoomCommand("status");
    expect(parsed).toEqual({
      kind: "invalid",
      code: ROOM_ERROR_CODES.ROOM_INVALID_COMMAND,
      message: ROOM_COMMAND_MESSAGES.unsupportedSubcommand("status")
    });
  });
});

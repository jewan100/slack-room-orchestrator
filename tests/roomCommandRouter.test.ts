import { describe, expect, it } from "vitest";
import { ROOM_COMMAND_MESSAGES } from "../src/shared/messages";
import { ROOM_ERROR_CODES } from "../src/shared/errorCodes";
import { parseRoomCommand } from "../src/commands/roomCommandRouter";

// 라우터가 `/room` 서브커맨드를 기대 타입으로 파싱하는지 검증한다.
describe("parseRoomCommand", () => {
  // start는 인자 없이 정상 파싱되는지 검증한다.
  it("parses /room start", () => {
    const parsed = parseRoomCommand("start");
    expect(parsed).toEqual({
      kind: "start"
    });
  });

  // start에 인자가 붙으면 invalid로 처리되는지 검증한다.
  it("rejects /room start with extra arguments", () => {
    const parsed = parseRoomCommand("start build slack mvp");
    expect(parsed).toEqual({
      kind: "invalid",
      code: ROOM_ERROR_CODES.ROOM_INVALID_COMMAND,
      message: ROOM_COMMAND_MESSAGES.invalidCommandNotice
    });
  });

  // summary는 제거되어 미지원 서브커맨드로 처리되는지 검증한다.
  it("rejects removed summary subcommand", () => {
    const parsed = parseRoomCommand("summary");
    expect(parsed).toEqual({
      kind: "invalid",
      code: ROOM_ERROR_CODES.ROOM_INVALID_COMMAND,
      message: ROOM_COMMAND_MESSAGES.invalidCommandNotice
    });
  });

  // launch 명령이 인자 없이 정상 파싱되는지 검증한다.
  it("parses /room launch", () => {
    const parsed = parseRoomCommand("launch");
    expect(parsed).toEqual({
      kind: "launch"
    });
  });

  // stop 명령이 인자 없이 정상 파싱되는지 검증한다.
  it("parses /room stop", () => {
    const parsed = parseRoomCommand("stop");
    expect(parsed).toEqual({
      kind: "stop"
    });
  });

  // stop에 인자가 붙으면 invalid로 처리되는지 검증한다.
  it("rejects /room stop with extra arguments", () => {
    const parsed = parseRoomCommand("stop now");
    expect(parsed).toEqual({
      kind: "invalid",
      code: ROOM_ERROR_CODES.ROOM_INVALID_COMMAND,
      message: ROOM_COMMAND_MESSAGES.invalidCommandNotice
    });
  });

  // help 명령이 인자 없이 정상 파싱되는지 검증한다.
  it("parses /room help", () => {
    const parsed = parseRoomCommand("help");
    expect(parsed).toEqual({
      kind: "help"
    });
  });

  // help에 인자가 붙으면 invalid로 처리되는지 검증한다.
  it("rejects /room help with extra arguments", () => {
    const parsed = parseRoomCommand("help now");
    expect(parsed).toEqual({
      kind: "invalid",
      code: ROOM_ERROR_CODES.ROOM_INVALID_COMMAND,
      message: ROOM_COMMAND_MESSAGES.invalidCommandNotice
    });
  });

  // 미지원 서브커맨드가 invalid로 처리되는지 검증한다.
  it("rejects unknown subcommand", () => {
    const parsed = parseRoomCommand("status");
    expect(parsed).toEqual({
      kind: "invalid",
      code: ROOM_ERROR_CODES.ROOM_INVALID_COMMAND,
      message: ROOM_COMMAND_MESSAGES.invalidCommandNotice
    });
  });
});

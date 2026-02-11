import { describe, expect, it } from "vitest";
import { ROOM_COMMAND_MESSAGES } from "../src/shared/messages";
import { ROOM_ERROR_CODES } from "../src/shared/errorCodes";
import { parseRoomCommand } from "../src/commands/roomCommandRouter";

// 라우터가 `/room` 서브커맨드를 기대 타입으로 파싱하는지 검증한다.
describe("parseRoomCommand", () => {
  // start + topic 입력이 정상 파싱되는지 검증한다.
  it("parses /room start with topic", () => {
    const parsed = parseRoomCommand("start build slack mvp");
    expect(parsed).toEqual({
      kind: "start",
      topic: "build slack mvp"
    });
  });

  // start에서 topic 누락 시 올바른 에러코드를 반환하는지 검증한다.
  it("returns missing topic error for /room start without topic", () => {
    const parsed = parseRoomCommand("start");
    expect(parsed).toEqual({
      kind: "invalid",
      code: ROOM_ERROR_CODES.ROOM_MISSING_TOPIC,
      message: "`/room start` 명령에는 주제가 필요합니다."
    });
  });

  // summary 기본 모드가 brief로 해석되는지 검증한다.
  it("parses /room summary default mode", () => {
    const parsed = parseRoomCommand("summary");
    expect(parsed).toEqual({
      kind: "summary",
      mode: "brief"
    });
  });

  // summary --full 플래그가 full 모드로 파싱되는지 검증한다.
  it("parses /room summary --full", () => {
    const parsed = parseRoomCommand("summary --full");
    expect(parsed).toEqual({
      kind: "summary",
      mode: "full"
    });
  });

  // summary에서 미지원 옵션이 invalid로 처리되는지 검증한다.
  it("rejects unknown summary option", () => {
    const parsed = parseRoomCommand("summary --detail");
    expect(parsed).toEqual({
      kind: "invalid",
      code: ROOM_ERROR_CODES.ROOM_INVALID_COMMAND,
      message: ROOM_COMMAND_MESSAGES.invalidSummaryOption
    });
  });

  // launch 명령이 인자 없이 정상 파싱되는지 검증한다.
  it("parses /room launch", () => {
    const parsed = parseRoomCommand("launch");
    expect(parsed).toEqual({
      kind: "launch"
    });
  });

  // 미지원 서브커맨드가 invalid로 처리되는지 검증한다.
  it("rejects unknown subcommand", () => {
    const parsed = parseRoomCommand("status");
    expect(parsed).toEqual({
      kind: "invalid",
      code: ROOM_ERROR_CODES.ROOM_INVALID_COMMAND,
      message: ROOM_COMMAND_MESSAGES.unsupportedSubcommand("status")
    });
  });
});

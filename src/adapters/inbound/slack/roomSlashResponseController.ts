import { ROOM_LOG_EVENT_NAMES } from "../../../shared/messages";
import type { Logger } from "../../../shared/logger";
import type { AckFn, RespondArguments, RespondFn } from "@slack/bolt";

// slash command ack는 "ephemeral 1개" UX 규칙을 고정하기 위한 단일 진입점이다.
// 이 컨트롤러는 ack/response_url follow-up을 안전하게 감싸 중복 응답을 막는다.

// ack에 실을 payload 타입이다.
// payload 없는 ack를 금지하기 위해 text를 필수로 만든다.
export type RoomSlashAckPayload = Omit<RespondArguments, "text"> & { text: string };

// response_url로 "원본 응답 교체"에 사용할 의도 DTO다.
// Slack 타입(RespondArguments)을 서비스 계층에 침투시키지 않기 위해 최소 필드만 유지한다.
export interface RoomSlashReplaceOriginalIntent {
  text: string;
  blocks?: RespondArguments["blocks"];
}

export interface RoomSlashResponseController {
  ackOnce(payload: RoomSlashAckPayload): Promise<void>;
  replaceOriginalOnce(intent: RoomSlashReplaceOriginalIntent): Promise<void>;
  deleteOriginalBestEffort(): Promise<void>;
}

interface RoomSlashResponseControllerDependencies {
  logger: Logger;
  requestId: string;
  ack: AckFn<string | RespondArguments>;
  respond: RespondFn;
  command: { text: string; channelId: string; teamId: string; userId: string; triggerId: string };
}

// Slack slash ack/respond 호출을 1회 정책으로 고정하는 구현체다.
class RoomSlashResponseControllerImpl implements RoomSlashResponseController {
  private ackCompleted = false;
  private replaceAttempted = false;
  private replaceSucceeded = false;
  private deleteAttempted = false;

  private readonly logger: Logger;
  private readonly requestId: string;
  private readonly ack: AckFn<string | RespondArguments>;
  private readonly respond: RespondFn;
  private readonly command: { text: string; channelId: string; teamId: string; userId: string; triggerId: string };

  public constructor(dependencies: RoomSlashResponseControllerDependencies) {
    this.logger = dependencies.logger;
    this.requestId = dependencies.requestId;
    this.ack = dependencies.ack;
    this.respond = dependencies.respond;
    this.command = dependencies.command;
  }

  // ack는 Slack UI에서 "처리 중" 혹은 fast-path 응답을 즉시 고정하는 용도다.
  public async ackOnce(payload: RoomSlashAckPayload): Promise<void> {
    if (this.ackCompleted) {
      this.logger.warn(ROOM_LOG_EVENT_NAMES.slashCommandAckSkipped, {
        requestId: this.requestId,
        command: this.command.text,
        channelId: this.command.channelId,
        teamId: this.command.teamId,
        userId: this.command.userId,
        triggerId: this.command.triggerId,
        reason: "duplicate_ack"
      });
      return;
    }

    // response_type을 항상 ephemeral로 강제해 UX 규칙을 흔들지 않는다.
    await this.ack({ ...payload, response_type: "ephemeral" });
    this.ackCompleted = true;
  }

  // replace_original은 실패 시 "처리 중"을 에러로 교체하는 데만 사용한다.
  public async replaceOriginalOnce(intent: RoomSlashReplaceOriginalIntent): Promise<void> {
    if (this.replaceAttempted) {
      this.logger.warn(ROOM_LOG_EVENT_NAMES.slashCommandFollowupReplaceSkipped, {
        requestId: this.requestId,
        command: this.command.text,
        channelId: this.command.channelId,
        teamId: this.command.teamId,
        userId: this.command.userId,
        triggerId: this.command.triggerId,
        reason: "duplicate_replace"
      });
      return;
    }
    this.replaceAttempted = true;

    // replace_original 대상은 response_url이 가리키는 "원본 slash 응답"이다.
    // 응답 타입은 항상 ephemeral로 고정해 채널 노이즈를 만들지 않는다.
    const payload: RespondArguments = {
      replace_original: true,
      response_type: "ephemeral",
      text: intent.text
    };
    if (intent.blocks) {
      payload.blocks = intent.blocks;
    }

    await this.respond(payload);
    this.replaceSucceeded = true;
  }

  // 성공 시에는 처리 중 메시지를 지우는 것을 시도한다.
  // ephemeral에서 delete_original은 100% 보장되지 않으므로 실패는 로그로만 남긴다.
  public async deleteOriginalBestEffort(): Promise<void> {
    if (this.deleteAttempted) {
      return;
    }
    this.deleteAttempted = true;

    // 실패 경로에서 replace가 성공했다면 에러 메시지를 숨기지 않는다.
    if (this.replaceSucceeded) {
      return;
    }

    try {
      await this.respond({
        delete_original: true
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(ROOM_LOG_EVENT_NAMES.slashCommandFollowupDeleteFailed, {
        requestId: this.requestId,
        command: this.command.text,
        channelId: this.command.channelId,
        teamId: this.command.teamId,
        userId: this.command.userId,
        triggerId: this.command.triggerId,
        errorMessage
      });
    }
  }
}

// ack/respond의 중복 호출을 방지하고, replace/delete 정책을 강제하는 컨트롤러를 만든다.
export function createRoomSlashResponseController(
  input: RoomSlashResponseControllerDependencies
): RoomSlashResponseController {
  return new RoomSlashResponseControllerImpl(input);
}

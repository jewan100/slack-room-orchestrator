import { ROOM_SLACK_MESSAGES } from "../../../shared/messages";
import { ROOM_ERROR_CODES } from "../../../shared/errorCodes";
import { RoomCommandError } from "../../../shared/roomCommandError";
import type { SlackChatClient, SlackThreadPort } from "../../../shared/types";

// Slack chat.postMessage API를 Thread 포트로 감싸는 outbound 어댑터
export class SlackThreadAdapter implements SlackThreadPort {
  public constructor(private readonly client: SlackChatClient) {}

  // 새 스레드의 루트 메시지를 생성하고 threadTs를 반환한다.
  // Slack 응답에 ts가 없으면 내부오류로 처리한다.
  public async createThread(input: { channelId: string; text: string }): Promise<{ channelId: string; threadTs: string }> {
    const response = await this.client.chat.postMessage({
      channel: input.channelId,
      text: input.text
    });

    if (!response.ts) {
      throw new RoomCommandError(
        ROOM_ERROR_CODES.ROOM_INTERNAL_ERROR,
        ROOM_SLACK_MESSAGES.missingThreadTimestamp
      );
    }

    return {
      channelId: input.channelId,
      threadTs: response.ts
    };
  }

  // 기존 스레드에 후속 메시지를 전송한다.
  public async postMessageInThread(input: { channelId: string; threadTs: string; text: string }): Promise<void> {
    await this.client.chat.postMessage({
      channel: input.channelId,
      thread_ts: input.threadTs,
      text: input.text
    });
  }
}

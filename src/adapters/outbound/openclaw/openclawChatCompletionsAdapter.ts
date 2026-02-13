import { ROOM_LOG_EVENT_NAMES, ROOM_OPENCLAW_MESSAGES } from "../../../shared/messages";
import type { Logger } from "../../../shared/logger";
import type { OpenClawChatClient, OpenClawChatCompletionInput } from "../../../shared/types";

// OpenClaw Chat Completions 어댑터 설정 모델
export interface OpenclawChatCompletionsAdapterOptions {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  agentId: string | null;
  requestTimeoutMs: number;
  logger?: Logger;
}

// OpenAI 호환 chat completions 요청 모델
interface OpenAiChatCompletionRequestBody {
  model: string;
  stream: false;
  user?: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
}

// OpenAI 호환 chat completions 응답 선택지 모델
interface OpenAiChatCompletionChoice {
  message?: {
    content?: unknown;
  };
}

// 문자열 또는 text-part 배열을 문자열로 정규화한다.
function normalizeContentToText(content: unknown): string | null {
  if (typeof content === "string") {
    return content.trim().length > 0 ? content : null;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const textParts = content
    .map((part) => {
      if (typeof part !== "object" || part === null) {
        return null;
      }

      if (!("text" in part)) {
        return null;
      }

      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? text : null;
    })
    .filter((part): part is string => typeof part === "string");

  if (textParts.length === 0) {
    return null;
  }

  const joined = textParts.join("").trim();
  return joined.length > 0 ? joined : null;
}

// OpenAI 호환 응답에서 assistant 텍스트를 추출한다.
function extractAssistantText(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    throw new Error(ROOM_OPENCLAW_MESSAGES.invalidChatResponsePayload);
  }

  if (!("choices" in payload) || !Array.isArray(payload.choices)) {
    throw new Error(ROOM_OPENCLAW_MESSAGES.invalidChatResponsePayload);
  }

  const firstChoice = payload.choices[0] as OpenAiChatCompletionChoice | undefined;
  const content = firstChoice?.message?.content;
  const text = normalizeContentToText(content);

  if (!text) {
    throw new Error(ROOM_OPENCLAW_MESSAGES.invalidChatResponsePayload);
  }

  return text;
}

// base URL 끝 슬래시를 제거해 endpoint 조합을 안정화한다.
function normalizeApiBaseUrl(rawBaseUrl: string): string {
  const trimmed = rawBaseUrl.trim();
  if (trimmed.endsWith("/")) {
    return trimmed.slice(0, -1);
  }

  return trimmed;
}

// OpenAI 호환 요청 body를 생성한다.
function buildRequestBody(options: {
  model: string;
  input: OpenClawChatCompletionInput;
}): OpenAiChatCompletionRequestBody {
  const requestBody: OpenAiChatCompletionRequestBody = {
    model: options.model,
    stream: false,
    messages: [
      {
        role: "system",
        content: options.input.systemMessage
      },
      {
        role: "user",
        content: options.input.userMessage
      }
    ]
  };

  if (options.input.userId) {
    requestBody.user = options.input.userId;
  }

  return requestBody;
}

// OpenClaw Gateway의 OpenAI 호환 HTTP API를 호출하는 outbound 어댑터
export class OpenclawChatCompletionsAdapter implements OpenClawChatClient {
  private readonly apiBaseUrl: string;

  public constructor(private readonly options: OpenclawChatCompletionsAdapterOptions) {
    this.apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
  }

  // 단일 user 메시지를 OpenClaw에 전달해 assistant 텍스트를 반환한다.
  public async complete(input: OpenClawChatCompletionInput): Promise<string> {
    const startedAt = Date.now();
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort();
    }, this.options.requestTimeoutMs);

    try {
      const response = await fetch(`${this.apiBaseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: this.buildHeaders(input),
        body: JSON.stringify(
          buildRequestBody({
            model: this.options.model,
            input
          })
        ),
        signal: abortController.signal
      });

      if (!response.ok) {
        throw new Error(`${ROOM_OPENCLAW_MESSAGES.openclawHttpRequestFailed} (status=${response.status})`);
      }

      const payload = await response.json();
      const assistantText = extractAssistantText(payload);
      this.options.logger?.info(ROOM_LOG_EVENT_NAMES.openclawChatRequestCompleted, {
        sessionKey: input.sessionKey,
        elapsedMs: Date.now() - startedAt
      });
      return assistantText;
    } catch (error) {
      this.options.logger?.warn(ROOM_LOG_EVENT_NAMES.openclawChatRequestFailed, {
        sessionKey: input.sessionKey,
        elapsedMs: Date.now() - startedAt,
        errorMessage: error instanceof Error ? error.message : ROOM_OPENCLAW_MESSAGES.openclawHttpRequestFailed
      });
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(ROOM_OPENCLAW_MESSAGES.openclawHttpRequestFailed);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  // 호출 헤더를 구성한다.
  private buildHeaders(input: OpenClawChatCompletionInput): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.apiKey}`,
      "Content-Type": "application/json",
      "x-openclaw-session-key": input.sessionKey
    };

    if (this.options.agentId) {
      headers["x-openclaw-agent-id"] = this.options.agentId;
    }

    return headers;
  }
}

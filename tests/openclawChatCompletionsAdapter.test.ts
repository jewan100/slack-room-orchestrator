import { afterEach, describe, expect, it, vi } from "vitest";
import { ROOM_OPENCLAW_MESSAGES } from "../src/shared/messages";
import { OpenclawChatCompletionsAdapter } from "../src/adapters/outbound/openclaw/openclawChatCompletionsAdapter";

// OpenClaw HTTP 어댑터의 요청/응답 계약을 검증한다.
describe("OpenclawChatCompletionsAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // 표준 헤더/바디를 포함해 OpenAI 호환 endpoint를 호출하는지 검증한다.
  it("calls OpenClaw chat endpoint with session header and parses text response", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "냐옹, 준비 완료!"
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new OpenclawChatCompletionsAdapter({
      apiBaseUrl: "http://127.0.0.1:18789/",
      apiKey: "test-api-key",
      model: "openclaw:main",
      agentId: "main",
      requestTimeoutMs: 5_000
    });

    const response = await adapter.complete({
      sessionKey: "room:session-1",
      systemMessage: "system",
      userMessage: "user",
      userId: "U01"
    });

    expect(response).toBe("냐옹, 준비 완료!");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) {
      return;
    }

    const [url, init] = call;
    expect(url).toBe("http://127.0.0.1:18789/v1/chat/completions");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer test-api-key",
      "x-openclaw-session-key": "room:session-1",
      "x-openclaw-agent-id": "main"
    });

    expect(typeof init?.body).toBe("string");
    if (typeof init?.body !== "string") {
      return;
    }

    const body = JSON.parse(init.body) as {
      model: string;
      stream: boolean;
      user?: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("openclaw:main");
    expect(body.stream).toBe(false);
    expect(body.user).toBe("U01");
    expect(body.messages.length).toBe(2);
    expect(body.messages[0]?.role).toBe("system");
    expect(body.messages[1]?.role).toBe("user");
  });

  // 응답 포맷이 깨진 경우 표준 오류로 매핑되는지 검증한다.
  it("throws standard error when payload shape is invalid", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{}]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new OpenclawChatCompletionsAdapter({
      apiBaseUrl: "http://127.0.0.1:18789",
      apiKey: "test-api-key",
      model: "openclaw:main",
      agentId: "main",
      requestTimeoutMs: 5_000
    });

    await expect(
      adapter.complete({
        sessionKey: "room:session-1",
        systemMessage: "system",
        userMessage: "user",
        userId: "U01"
      })
    ).rejects.toThrow(ROOM_OPENCLAW_MESSAGES.invalidChatResponsePayload);
  });
});


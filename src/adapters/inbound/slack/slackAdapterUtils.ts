import { randomUUID } from "node:crypto";

// Socket Mode event body에서 requestId(event_id)를 추출한다.
export function resolveSlackEventRequestId(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return randomUUID();
  }

  if (!("event_id" in body)) {
    return randomUUID();
  }

  const eventId = (body as { event_id?: unknown }).event_id;
  if (typeof eventId !== "string" || eventId.trim().length === 0) {
    return randomUUID();
  }

  return eventId;
}

// Socket Mode envelope body에서 envelope_id를 추출한다.
export function resolveSlackEnvelopeRequestId(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return randomUUID();
  }

  if (!("envelope_id" in body)) {
    return randomUUID();
  }

  const envelopeId = (body as { envelope_id?: unknown }).envelope_id;
  if (typeof envelopeId !== "string" || envelopeId.trim().length === 0) {
    return randomUUID();
  }

  return envelopeId;
}

// unknown 오류를 로깅용 문자열로 정규화한다.
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}


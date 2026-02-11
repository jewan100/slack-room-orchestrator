import type { RoomErrorCode } from "./errorCodes";

// 명령 흐름에서 사용하는 세션 생명주기 상태
// "IDLE"은 개념 상태이며 DB에는 저장하지 않는다.
export type RoomSessionState = "IDLE" | "PREPARED" | "RUNNING" | "DECIDED";
export type PersistedRoomSessionState = Exclude<RoomSessionState, "IDLE">;
export type SummaryMode = "brief" | "full";
export type CandidateOption = "A" | "B" | "C";

// 서비스/핸들러/저장소가 공통으로 사용하는 세션 영속 모델
export interface RoomSession {
  id: string;
  topic: string;
  state: PersistedRoomSessionState;
  requestedByUserId: string;
  workspaceId: string;
  startChannelId: string;
  startThreadTs: string;
  launchChannelId: string | null;
  launchThreadTs: string | null;
  decidedOption: CandidateOption | null;
  createdAt: string;
  updatedAt: string;
}

// `/room start` 시점에 저장하는 브리핑 데이터
export interface RoomBriefing {
  id: string;
  sessionId: string;
  goal: string;
  constraints: string;
  successCriteria: string;
  createdAt: string;
}

// 워커 라운드에서 생성되는 단일 후보안
export interface WorkerCandidate {
  option: CandidateOption;
  summary: string;
  pros: string[];
  risk: string;
  estimatedCost: string;
}

// 저장된 라운드 결과. 하나의 세션은 시간에 따라 여러 라운드를 가질 수 있다.
export interface RoomWorkerRound {
  id: string;
  sessionId: string;
  roundNo: number;
  candidates: WorkerCandidate[];
  createdAt: string;
}

// PREPARED 세션 생성용 저장소 입력 모델
export interface CreatePreparedSessionInput {
  topic: string;
  requestedByUserId: string;
  workspaceId: string;
  startChannelId: string;
  startThreadTs: string;
}

// PREPARED -> RUNNING 전이용 저장소 입력 모델
export interface UpdateSessionToRunningInput {
  sessionId: string;
  launchChannelId: string;
  launchThreadTs: string;
}

// PREPARED 세션의 start 스레드 식별자를 갱신할 때 사용하는 입력 모델
export interface UpdatePreparedSessionStartThreadInput {
  sessionId: string;
  startThreadTs: string;
}

// 예약된 PREPARED 세션만 안전하게 삭제할 때 사용하는 입력 모델
export interface DeleteReservedPreparedSessionInput {
  sessionId: string;
  expectedStartThreadTs: string;
}

// 브리핑 생성용 저장소 입력 모델
export interface CreateBriefingInput {
  sessionId: string;
  goal: string;
  constraints: string;
  successCriteria: string;
}

// 라운드 생성용 저장소 입력 모델
export interface CreateWorkerRoundInput {
  sessionId: string;
  roundNo: number;
  candidates: WorkerCandidate[];
}

// 저장소 포트 계약
// 서비스는 인터페이스에만 의존하고 실제 구현은 `repositories/*`가 담당한다.
export interface RoomSessionRepository {
  findActiveSessionByStartChannel(startChannelId: string): Promise<RoomSession | null>;
  createPreparedSession(input: CreatePreparedSessionInput): Promise<RoomSession>;
  updatePreparedSessionStartThread(input: UpdatePreparedSessionStartThreadInput): Promise<RoomSession>;
  claimPreparedSessionForLaunch(sessionId: string): Promise<boolean>;
  rollbackLaunchClaim(sessionId: string): Promise<void>;
  deleteReservedPreparedSession(input: DeleteReservedPreparedSessionInput): Promise<boolean>;
  updateSessionToRunning(input: UpdateSessionToRunningInput): Promise<RoomSession>;
  deleteById(sessionId: string): Promise<void>;
  findById(sessionId: string): Promise<RoomSession | null>;
}

export interface BriefingRepository {
  createBriefing(input: CreateBriefingInput): Promise<RoomBriefing>;
  findBySessionId(sessionId: string): Promise<RoomBriefing | null>;
}

export interface WorkerRoundRepository {
  createRound(input: CreateWorkerRoundInput): Promise<RoomWorkerRound>;
  findLatestBySessionId(sessionId: string): Promise<RoomWorkerRound | null>;
}

// 본 프로젝트가 사용하는 Slack API 최소 표면
// 테스트/모킹 단순화를 위해 필요한 범위만 노출한다.
export interface SlackPostMessageArguments {
  channel: string;
  text: string;
  thread_ts?: string;
}

export interface SlackPostMessageResponse {
  ts?: string;
}

export interface SlackChatClient {
  chat: {
    postMessage(args: SlackPostMessageArguments): Promise<SlackPostMessageResponse>;
  };
}

// 서비스에서 필요한 Slack 스레드 조작 포트
// 실제 구현은 outbound adapter(`SlackThreadAdapter`)가 담당한다.
export interface SlackThreadPort {
  createThread(input: { channelId: string; text: string }): Promise<{ channelId: string; threadTs: string }>;
  postMessageInThread(input: { channelId: string; threadTs: string; text: string }): Promise<void>;
}

// MVP에서 사용하는 slash-command 응답 표준 페이로드
export interface CommandResponsePayload {
  response_type: "ephemeral";
  text: string;
}

// 앱 내부에서 사용하는 slash-command 정규화 페이로드
// Slack 원본 필드를 앱 친화 필드명으로 변환해 사용한다.
export interface SlashCommandPayload {
  text: string;
  userId: string;
  teamId: string;
  channelId: string;
}

// inbound adapter에서 command handler로 전달하는 요청 객체
export interface RoomCommandRequest {
  ack: () => Promise<void>;
  respond: (payload: CommandResponsePayload) => Promise<void>;
  command: SlashCommandPayload;
  client: SlackChatClient;
}

// 라우터가 반환하는 파싱 결과 유니온 타입
// "invalid" 분기는 에러코드+문구를 함께 보관해 응답 일관성을 보장한다.
export type ParsedRoomCommand =
  | { kind: "start"; topic: string }
  | { kind: "summary"; mode: SummaryMode }
  | { kind: "launch" }
  | { kind: "invalid"; code: RoomErrorCode; message: string };

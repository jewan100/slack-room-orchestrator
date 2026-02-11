import type { RoomErrorCode } from "./errorCodes";
import type {
  OpenClawRoomEvent,
  OpenClawRoomEventType,
  RoomModeOffReason,
  RoomThreadMessageMetadata,
  RoomWatchMode,
  RoomWatchTarget
} from "./openclawSyncTypes";

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

// OpenClaw 감시 대상 생성 입력 모델
export interface CreateRoomWatchTargetInput {
  sessionId: string;
  channelId: string;
  threadTs: string;
  mode: RoomWatchMode;
  ttlExpiresAt: string;
}

// OpenClaw 감시 대상 OFF 전환 입력 모델
export interface TurnOffRoomWatchTargetInput {
  watchTargetId: string;
  offReason: RoomModeOffReason;
  turnedOffAt: string;
}

// OpenClaw 질문 트리거 선점 입력 모델
export interface ClaimQuestionTriggerInput {
  watchTargetId: string;
  dueBefore: string;
  triggeredAt: string;
}

// 스레드 메시지 메타데이터 저장 입력 모델
export interface CreateRoomThreadMessageMetadataInput {
  watchTargetId: string;
  sessionId: string;
  channelId: string;
  threadTs: string;
  messageTs: string;
  userId: string | null;
  subtype: string | null;
  isBot: boolean;
  eventTs: string;
}

// outbox에서 디스패치할 pending 이벤트 모델
export interface OpenClawPendingOutboxEvent {
  id: string;
  eventId: string;
  eventType: OpenClawRoomEventType;
  payload: OpenClawRoomEvent;
  retryCount: number;
  availableAt: string;
}

// outbox 재시도 마킹 입력 모델
export interface MarkOpenClawEventRetryInput {
  outboxId: string;
  errorMessage: string;
  retryAt: string;
}

// room 모드 ON/OFF 수명 관리 서비스 입력 모델
export interface TurnOnPlanningRoomModeInput {
  session: RoomSession;
  ttlMinutes: number;
}

export interface TurnOffPlanningRoomModeInput {
  session: RoomSession;
}

// 감시 중인 스레드 메시지 수집 서비스 입력 모델
export interface IngestRoomThreadMessageInput {
  channelId: string;
  threadTs: string;
  messageTs: string;
  userId: string | null;
  subtype: string | null;
  isBot: boolean;
  eventTs: string;
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
  deleteBySessionIdAndRoundNo(sessionId: string, roundNo: number): Promise<void>;
  findLatestBySessionId(sessionId: string): Promise<RoomWorkerRound | null>;
}

// OpenClaw 감시 대상 저장소 포트
export interface RoomWatchTargetRepository {
  createWatchTargetOn(input: CreateRoomWatchTargetInput): Promise<RoomWatchTarget>;
  findActivePlanningByChannel(channelId: string): Promise<RoomWatchTarget | null>;
  findOnWatchTargetByChannelAndThread(channelId: string, threadTs: string): Promise<RoomWatchTarget | null>;
  findOnWatchTargetBySessionId(sessionId: string): Promise<RoomWatchTarget | null>;
  findExpiredOnWatchTargets(nowIso: string, limit: number): Promise<RoomWatchTarget[]>;
  findQuestionTriggerDueWatchTargets(cutoffIso: string, limit: number): Promise<RoomWatchTarget[]>;
  turnOffWatchTarget(input: TurnOffRoomWatchTargetInput): Promise<RoomWatchTarget | null>;
  incrementMessageCount(watchTargetId: string): Promise<RoomWatchTarget>;
  claimSummaryTriggerIfReached(
    watchTargetId: string,
    threshold: number,
    triggeredAt: string
  ): Promise<RoomWatchTarget | null>;
  claimQuestionTriggerIfDue(input: ClaimQuestionTriggerInput): Promise<RoomWatchTarget | null>;
}

// 감시 대상 스레드 메시지 저장소 포트
export interface RoomThreadMessageRepository {
  createMessageMetadataIfAbsent(input: CreateRoomThreadMessageMetadataInput): Promise<boolean>;
  findByCompositeKey(channelId: string, threadTs: string, messageTs: string): Promise<RoomThreadMessageMetadata | null>;
}

// OpenClaw outbox 저장소 포트
export interface OpenClawEventOutboxRepository {
  enqueueEvent(event: OpenClawRoomEvent): Promise<void>;
  claimPendingEvents(nowIso: string, limit: number): Promise<OpenClawPendingOutboxEvent[]>;
  markDispatched(outboxId: string, dispatchedAt: string): Promise<void>;
  markRetry(input: MarkOpenClawEventRetryInput): Promise<void>;
}

// OpenClaw 이벤트 파일 sink 포트
export interface OpenClawEventSink {
  appendEvent(event: OpenClawRoomEvent): Promise<void>;
}

// room start/launch 시점의 ON/OFF 훅 서비스 포트
export interface RoomModeLifecycleService {
  turnOnPlanningRoomMode(input: TurnOnPlanningRoomModeInput): Promise<void>;
  turnOffPlanningRoomMode(input: TurnOffPlanningRoomModeInput): Promise<void>;
}

// Slack message 이벤트를 수집/트리거로 변환하는 서비스 포트
export interface RoomThreadMessageIngestService {
  execute(input: IngestRoomThreadMessageInput): Promise<void>;
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

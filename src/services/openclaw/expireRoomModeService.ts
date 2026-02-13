import { ROOM_LOG_EVENT_NAMES, ROOM_OPENCLAW_MESSAGES, ROOM_OPENCLAW_SLACK_MESSAGES } from "../../shared/messages";
import type { Logger } from "../../shared/logger";
import type { RoomWatchTarget } from "../../shared/openclawSyncTypes";
import type {
  OpenClawEventOutboxRepository,
  RoomSession,
  RoomSessionRepository,
  RoomWatchTargetRepository,
  SlackThreadPort
} from "../../shared/types";
import { createRoomModeOffEvent } from "./openclawRoomEventFactory";

// TTL OFF 서비스 의존성 모델
export interface ExpireRoomModeServiceDependencies {
  roomWatchTargetRepository: RoomWatchTargetRepository;
  roomSessionRepository: RoomSessionRepository;
  openClawEventOutboxRepository: OpenClawEventOutboxRepository;
  createSlackThreadPort?: () => SlackThreadPort | null;
  batchSize: number;
  logger: Logger;
}

// TTL이 지난 planning watch target을 OFF로 전환하고 세션 종료/이벤트 발행을 처리하는 서비스
export class ExpireRoomModeService {
  private readonly roomWatchTargetRepository: RoomWatchTargetRepository;
  private readonly roomSessionRepository: RoomSessionRepository;
  private readonly openClawEventOutboxRepository: OpenClawEventOutboxRepository;
  private readonly createSlackThreadPort: (() => SlackThreadPort | null) | undefined;
  private readonly batchSize: number;
  private readonly logger: Logger;

  public constructor(dependencies: ExpireRoomModeServiceDependencies) {
    this.roomWatchTargetRepository = dependencies.roomWatchTargetRepository;
    this.roomSessionRepository = dependencies.roomSessionRepository;
    this.openClawEventOutboxRepository = dependencies.openClawEventOutboxRepository;
    this.createSlackThreadPort = dependencies.createSlackThreadPort;
    this.batchSize = dependencies.batchSize;
    this.logger = dependencies.logger;
  }

  // unknown 오류를 로깅 가능한 문자열로 변환한다.
  private extractErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return ROOM_OPENCLAW_MESSAGES.unknownLifecycleError;
  }

  // TTL OFF 스킵 로그를 공통 포맷으로 기록한다.
  private logModeOffSkipped(input: {
    sessionId: string;
    channelId: string;
    threadTs: string;
    reason?: string;
  }): void {
    this.logger.warn(ROOM_LOG_EVENT_NAMES.openclawRoomModeOffSkipped, {
      sessionId: input.sessionId,
      channelId: input.channelId,
      threadTs: input.threadTs,
      offReason: "TTL",
      reason: input.reason
    });
  }

  // TTL 만료 안내를 스레드에 남긴다.
  // Slack 포트가 없는 환경에서는 안내를 건너뛴다.
  private async postTtlNoticeInThread(input: { sessionId: string; channelId: string; threadTs: string }): Promise<void> {
    if (!this.createSlackThreadPort) {
      return;
    }

    const slackThreadPort = this.createSlackThreadPort();
    if (!slackThreadPort) {
      return;
    }

    try {
      await slackThreadPort.postMessageInThread({
        channelId: input.channelId,
        threadTs: input.threadTs,
        text: ROOM_OPENCLAW_SLACK_MESSAGES.ttlModeOffNotice
      });
      this.logger.info(ROOM_LOG_EVENT_NAMES.openclawTtlNoticePosted, {
        sessionId: input.sessionId,
        channelId: input.channelId,
        threadTs: input.threadTs,
        offReason: "TTL"
      });
    } catch (error) {
      this.logger.warn(ROOM_LOG_EVENT_NAMES.openclawTtlNoticeFailed, {
        sessionId: input.sessionId,
        channelId: input.channelId,
        threadTs: input.threadTs,
        offReason: "TTL",
        errorMessage: this.extractErrorMessage(error)
      });
    }
  }

  // TTL 만료 세션을 DECIDED로 종료한다.
  // 이미 DECIDED인 세션은 그대로 반환해 멱등성을 유지한다.
  private async finalizeSessionForTtl(session: RoomSession): Promise<RoomSession> {
    if (session.state === "DECIDED") {
      return session;
    }

    try {
      return await this.roomSessionRepository.updateSessionToDecided({
        sessionId: session.id,
        decidedOption: null
      });
    } catch (error) {
      const reloadedSession = await this.roomSessionRepository.findById(session.id);
      if (reloadedSession && reloadedSession.state === "DECIDED") {
        return reloadedSession;
      }

      throw error;
    }
  }

  // 만료된 watch target을 OFF로 전환한다.
  private async turnOffExpiredTarget(target: RoomWatchTarget, nowIso: string): Promise<RoomWatchTarget | null> {
    return this.roomWatchTargetRepository.turnOffWatchTarget({
      watchTargetId: target.id,
      offReason: "TTL",
      turnedOffAt: nowIso
    });
  }

  // 세션이 없는 만료 타깃은 OFF로만 정리하고 스킵 로그를 남긴다.
  private async handleMissingSessionTarget(target: RoomWatchTarget, nowIso: string): Promise<void> {
    const turnedOff = await this.turnOffExpiredTarget(target, nowIso);
    if (!turnedOff) {
      this.logModeOffSkipped({
        sessionId: target.sessionId,
        channelId: target.channelId,
        threadTs: target.threadTs
      });
      return;
    }

    this.logModeOffSkipped({
      sessionId: target.sessionId,
      channelId: target.channelId,
      threadTs: target.threadTs,
      reason: "session_not_found"
    });
  }

  // OFF 이벤트 enqueue, TTL 안내 전송, 완료 로그를 한 번에 수행한다.
  private async enqueueTtlOffAndNotice(input: {
    session: RoomSession;
    turnedOffWatchTarget: RoomWatchTarget;
    nowIso: string;
  }): Promise<void> {
    await this.openClawEventOutboxRepository.enqueueEvent(
      createRoomModeOffEvent({
        session: input.session,
        watchTarget: input.turnedOffWatchTarget,
        offReason: "TTL",
        occurredAt: input.nowIso
      })
    );

    await this.postTtlNoticeInThread({
      sessionId: input.session.id,
      channelId: input.turnedOffWatchTarget.channelId,
      threadTs: input.turnedOffWatchTarget.threadTs
    });

    this.logger.info(ROOM_LOG_EVENT_NAMES.openclawTtlOffQueued, {
      sessionId: input.session.id,
      channelId: input.turnedOffWatchTarget.channelId,
      threadTs: input.turnedOffWatchTarget.threadTs,
      offReason: "TTL",
      sessionState: input.session.state
    });
  }

  // TTL 만료 타깃을 OFF 처리하고, 세션 상태에 맞는 후속 동작을 실행한다.
  private async processExpiredTarget(target: RoomWatchTarget, nowIso: string): Promise<void> {
    const session = await this.roomSessionRepository.findById(target.sessionId);
    if (!session) {
      await this.handleMissingSessionTarget(target, nowIso);
      return;
    }

    const finalizedSession = await this.finalizeSessionForTtl(session);
    const turnedOff = await this.turnOffExpiredTarget(target, nowIso);

    if (!turnedOff) {
      this.logModeOffSkipped({
        sessionId: target.sessionId,
        channelId: target.channelId,
        threadTs: target.threadTs
      });
      return;
    }

    await this.enqueueTtlOffAndNotice({
      session: finalizedSession,
      turnedOffWatchTarget: turnedOff,
      nowIso
    });
  }

  // 만료 대상을 순회하며 OFF 전환/이벤트 enqueue를 수행한다.
  public async execute(): Promise<void> {
    const nowIso = new Date().toISOString();
    const expiredTargets = await this.roomWatchTargetRepository.findExpiredOnWatchTargets(nowIso, this.batchSize);

    for (const target of expiredTargets) {
      await this.processExpiredTarget(target, nowIso);
    }
  }
}

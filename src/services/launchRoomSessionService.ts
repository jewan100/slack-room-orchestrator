import {
  ROOM_COMMAND_NAMES,
  ROOM_LAUNCH_SERVICE_MESSAGES,
  ROOM_LAUNCH_SERVICE_CONSTANTS,
  ROOM_LOG_EVENT_NAMES,
  ROOM_START_SERVICE_CONSTANTS
} from "../shared/messages";
import { ROOM_ERROR_CODES } from "../shared/errorCodes";
import type { Logger } from "../shared/logger";
import { RoomCommandError } from "../shared/roomCommandError";
import type {
  BriefingRepository,
  RoomModeLifecycleService,
  RoomSession,
  RoomSessionRepository,
  RoomWorkerRound,
  SlackThreadPort,
  WorkerCandidate,
  WorkerRoundRepository
} from "../shared/types";
import { ensureActiveSession, ensureLaunchableState } from "../validators/roomCommandValidator";
import type { RunWorkerRoundStubService } from "./runWorkerRoundStubService";

// launch 유스케이스 입력 모델
export interface LaunchRoomSessionInput {
  startChannelId: string;
  launchChannelId: string;
}

// launch 유스케이스 반환 모델
export interface LaunchRoomSessionResult {
  session: RoomSession;
  round: RoomWorkerRound;
}

// launch 서비스가 필요로 하는 의존성 묶음
export interface LaunchRoomSessionServiceDependencies {
  roomSessionRepository: RoomSessionRepository;
  briefingRepository: BriefingRepository;
  workerRoundRepository: WorkerRoundRepository;
  runWorkerRoundStubService: RunWorkerRoundStubService;
  roomModeLifecycleService: RoomModeLifecycleService;
  logger: Logger;
}

// launch 공지에 필요한 입력 모델
interface LaunchRoundNoticeInput {
  channelId: string;
  threadTs: string;
  sessionId: string;
  candidateLines: string[];
}

// launch 실행 중 보상 처리 판단에 필요한 런타임 상태
interface LaunchRuntimeContext {
  createdRoundNo: number | null;
}

// unknown 에러를 로그용 문자열로 정규화한다.
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return ROOM_LAUNCH_SERVICE_CONSTANTS.followupNoticeUnknownError;
}

// `/room launch` 유스케이스 오케스트레이션 서비스
// 상태 검증 후 실행 스레드/워커 라운드/세션 상태 전이를 수행한다.
export class LaunchRoomSessionService {
  private readonly roomSessionRepository: RoomSessionRepository;
  private readonly briefingRepository: BriefingRepository;
  private readonly workerRoundRepository: WorkerRoundRepository;
  private readonly runWorkerRoundStubService: RunWorkerRoundStubService;
  private readonly roomModeLifecycleService: RoomModeLifecycleService;
  private readonly logger: Logger;

  public constructor(dependencies: LaunchRoomSessionServiceDependencies) {
    this.roomSessionRepository = dependencies.roomSessionRepository;
    this.briefingRepository = dependencies.briefingRepository;
    this.workerRoundRepository = dependencies.workerRoundRepository;
    this.runWorkerRoundStubService = dependencies.runWorkerRoundStubService;
    this.roomModeLifecycleService = dependencies.roomModeLifecycleService;
    this.logger = dependencies.logger;
  }

  // launch 흐름 내부 단계별 처리 시간을 표준 포맷으로 기록한다.
  private logLaunchPhaseCompletion(input: {
    phase: string;
    channelId: string;
    elapsedMs: number;
    sessionId?: string | null;
  }): void {
    this.logger.info(ROOM_LOG_EVENT_NAMES.roomLaunchPhaseCompleted, {
      phase: input.phase,
      channelId: input.channelId,
      command: ROOM_COMMAND_NAMES.launch,
      sessionId: input.sessionId ?? null,
      elapsedMs: input.elapsedMs
    });
  }

  // launch 단계 실행 시간을 측정하고 완료 로그를 남긴다.
  private async runLaunchPhaseWithTiming<T>(input: {
    phase: string;
    channelId: string;
    sessionId?: string | null;
    action: () => Promise<T>;
  }): Promise<T> {
    const phaseStartedAt = Date.now();
    const result = await input.action();
    const phaseLogInput = {
      phase: input.phase,
      channelId: input.channelId,
      elapsedMs: Date.now() - phaseStartedAt
    };
    this.logLaunchPhaseCompletion(
      input.sessionId === undefined ? phaseLogInput : { ...phaseLogInput, sessionId: input.sessionId }
    );
    return result;
  }

  // launch 라운드를 생성하고 후보안을 함께 반환한다.
  private async createLaunchRoundWithTiming(input: {
    activeSession: RoomSession;
    launchChannelId: string;
  }): Promise<{ round: RoomWorkerRound; candidates: WorkerCandidate[] }> {
    const candidates = this.runWorkerRoundStubService.execute(input.activeSession.topic);
    const round = await this.runLaunchPhaseWithTiming({
      phase: "create_worker_round",
      channelId: input.launchChannelId,
      sessionId: input.activeSession.id,
      action: async () => {
        const nextRoundNo = await this.getNextRoundNo(input.activeSession.id);
        return this.workerRoundRepository.createRound({
          sessionId: input.activeSession.id,
          roundNo: nextRoundNo,
          candidates
        });
      }
    });

    return {
      round,
      candidates
    };
  }

  // launch 스레드를 만들고 세션의 launch thread 식별자를 동기화한다.
  private async createLaunchThreadAndSessionWithTiming(input: {
    activeSession: RoomSession;
    launchChannelId: string;
    reservedSession: RoomSession;
    slackThreadPort: SlackThreadPort;
  }): Promise<{ launchSession: RoomSession; launchThreadTs: string }> {
    const launchThread = await this.runLaunchPhaseWithTiming({
      phase: "create_launch_thread",
      channelId: input.launchChannelId,
      sessionId: input.activeSession.id,
      action: async () => {
        return input.slackThreadPort.createThread({
          channelId: input.launchChannelId,
          text: ROOM_LAUNCH_SERVICE_MESSAGES.launchThreadText()
        });
      }
    });

    const launchSession = await this.runLaunchPhaseWithTiming({
      phase: "sync_launch_thread_metadata",
      channelId: input.launchChannelId,
      sessionId: input.activeSession.id,
      action: async () => {
        const syncedSession = await this.syncLaunchThreadMetadata(
          input.activeSession.id,
          input.launchChannelId,
          launchThread.threadTs,
          { channelId: input.launchChannelId }
        );
        return syncedSession ?? input.reservedSession;
      }
    });

    return {
      launchSession,
      launchThreadTs: launchThread.threadTs
    };
  }

  // launch 후반 단계(공지/mode OFF/완료 로그)를 처리한다.
  private async finalizeLaunchWithTiming(input: {
    launchChannelId: string;
    launchSession: RoomSession;
    launchThreadTs: string;
    candidates: WorkerCandidate[];
    slackThreadPort: SlackThreadPort;
    flowStartedAt: number;
  }): Promise<void> {
    void this.postLaunchRoundNotice(input.slackThreadPort, {
      channelId: input.launchChannelId,
      threadTs: input.launchThreadTs,
      sessionId: input.launchSession.id,
      candidateLines: this.buildCandidateLines(input.candidates)
    });

    await this.runLaunchPhaseWithTiming({
      phase: "turn_off_planning_room_mode",
      channelId: input.launchChannelId,
      sessionId: input.launchSession.id,
      action: async () => {
        await this.turnOffPlanningRoomMode(input.launchSession);
      }
    });

    this.logger.info(ROOM_LOG_EVENT_NAMES.roomLaunchCompleted, {
      sessionId: input.launchSession.id,
      channelId: input.launchChannelId,
      command: ROOM_COMMAND_NAMES.launch,
      elapsedMs: Date.now() - input.flowStartedAt
    });
  }

  // launch 실패 시 생성된 라운드를 먼저 정리한 뒤 선점 상태를 롤백한다.
  private async rollbackLaunchFailure(
    sessionId: string,
    channelId: string,
    runtimeContext: LaunchRuntimeContext,
    error: unknown
  ): Promise<void> {
    let cleanupFailedError: unknown = null;

    if (runtimeContext.createdRoundNo !== null) {
      try {
        await this.workerRoundRepository.deleteBySessionIdAndRoundNo(sessionId, runtimeContext.createdRoundNo);
      } catch (cleanupError) {
        cleanupFailedError = cleanupError;
        this.logger.error(ROOM_LOG_EVENT_NAMES.roomLaunchRoundCleanupFailed, {
          sessionId,
          channelId,
          command: ROOM_COMMAND_NAMES.launch,
          errorMessage: extractErrorMessage(cleanupError),
          causeErrorMessage: extractErrorMessage(error)
        });
      }
    }

    try {
      await this.roomSessionRepository.rollbackLaunchClaim(sessionId);
    } catch (rollbackError) {
      this.logger.error(ROOM_LOG_EVENT_NAMES.roomLaunchClaimRollbackFailed, {
        sessionId,
        channelId,
        command: ROOM_COMMAND_NAMES.launch,
        errorMessage: extractErrorMessage(rollbackError),
        causeErrorMessage: extractErrorMessage(error)
      });
      throw rollbackError;
    }

    if (cleanupFailedError) {
      throw cleanupFailedError;
    }
  }

  // launch 결과 공지 실패는 launch 성공 여부와 분리해 경고 로그로만 남긴다.
  private async postLaunchRoundNotice(slackThreadPort: SlackThreadPort, input: LaunchRoundNoticeInput): Promise<void> {
    try {
      await slackThreadPort.postMessageInThread({
        channelId: input.channelId,
        threadTs: input.threadTs,
        text: [ROOM_LAUNCH_SERVICE_MESSAGES.roundCompletedTitle, ...input.candidateLines].join("\n")
      });
    } catch (error) {
      this.logger.warn(ROOM_LOG_EVENT_NAMES.roomLaunchFollowupNoticeFailed, {
        sessionId: input.sessionId,
        channelId: input.channelId,
        command: ROOM_COMMAND_NAMES.launch,
        errorMessage: extractErrorMessage(error)
      });
    }
  }

  // 후보안 배열을 사람이 읽기 쉬운 한 줄 요약 리스트로 변환한다.
  private buildCandidateLines(candidates: WorkerCandidate[]): string[] {
    return candidates.map((candidate) => {
      return ROOM_LAUNCH_SERVICE_MESSAGES.candidateLine({
        option: candidate.option,
        summary: candidate.summary,
        risk: candidate.risk,
        estimatedCost: candidate.estimatedCost
      });
    });
  }

  // launch 가능한 PREPARED 세션인지 추가 검증한다.
  // start 초기화가 끝나지 않은 세션은 launch를 차단한다.
  private async ensureLaunchReady(activeSession: RoomSession): Promise<void> {
    if (activeSession.startThreadTs === ROOM_START_SERVICE_CONSTANTS.pendingStartThreadTs) {
      throw new RoomCommandError(ROOM_ERROR_CODES.ROOM_INVALID_STATE_TRANSITION);
    }

    const briefing = await this.briefingRepository.findBySessionId(activeSession.id);
    if (!briefing) {
      throw new RoomCommandError(ROOM_ERROR_CODES.ROOM_INVALID_STATE_TRANSITION);
    }
  }

  // 다음 라운드 번호를 계산한다.
  // 이전 라운드가 남아 있어도 중복 없이 재시도가 가능하도록 한다.
  private async getNextRoundNo(sessionId: string): Promise<number> {
    const latestRound = await this.workerRoundRepository.findLatestBySessionId(sessionId);
    if (!latestRound) {
      return 1;
    }

    return latestRound.roundNo + 1;
  }

  // launch 선점 직후 예약 메타데이터를 먼저 저장한다.
  private async reserveLaunchMetadata(sessionId: string, launchChannelId: string): Promise<RoomSession> {
    return this.roomSessionRepository.updateSessionToRunning({
      sessionId,
      launchChannelId,
      launchThreadTs: ROOM_LAUNCH_SERVICE_CONSTANTS.pendingLaunchThreadTs
    });
  }

  // launch 스레드 식별자 반영은 best-effort로 처리한다.
  private async syncLaunchThreadMetadata(
    sessionId: string,
    launchChannelId: string,
    launchThreadTs: string,
    errorContext: { channelId: string }
  ): Promise<RoomSession | null> {
    try {
      return await this.roomSessionRepository.updateSessionToRunning({
        sessionId,
        launchChannelId,
        launchThreadTs
      });
    } catch (error) {
      this.logger.warn(ROOM_LOG_EVENT_NAMES.roomLaunchThreadMetadataUpdateFailed, {
        sessionId,
        channelId: errorContext.channelId,
        command: ROOM_COMMAND_NAMES.launch,
        errorMessage: extractErrorMessage(error)
      });
      return null;
    }
  }

  // launch 성공 경로에서 planning watch target OFF를 강제한다.
  // OFF 전환 실패는 정합성 우선 원칙에 따라 launch 실패로 승격한다.
  private async turnOffPlanningRoomMode(session: RoomSession): Promise<void> {
    await this.roomModeLifecycleService.turnOffPlanningRoomMode({
      session,
      offReason: "LAUNCH"
    });
  }

  // launch 핵심 단계를 실행하고 결과를 조립한다.
  private async runLaunchCore(
    input: LaunchRoomSessionInput,
    activeSession: RoomSession,
    runtimeContext: LaunchRuntimeContext,
    slackThreadPort: SlackThreadPort
  ): Promise<LaunchRoomSessionResult> {
    const flowStartedAt = Date.now();
    const reservedSession = await this.runLaunchPhaseWithTiming({
      phase: "reserve_launch_metadata",
      channelId: input.launchChannelId,
      sessionId: activeSession.id,
      action: async () => {
        return this.reserveLaunchMetadata(activeSession.id, input.launchChannelId);
      }
    });

    const { round, candidates } = await this.createLaunchRoundWithTiming({
      activeSession,
      launchChannelId: input.launchChannelId
    });
    runtimeContext.createdRoundNo = round.roundNo;

    const { launchSession, launchThreadTs } = await this.createLaunchThreadAndSessionWithTiming({
      activeSession,
      launchChannelId: input.launchChannelId,
      reservedSession,
      slackThreadPort
    });

    await this.finalizeLaunchWithTiming({
      launchChannelId: input.launchChannelId,
      launchSession,
      launchThreadTs,
      candidates,
      slackThreadPort,
      flowStartedAt
    });

    return {
      session: launchSession,
      round
    };
  }

  // launch 흐름:
  // 1) 활성 세션 확인 2) PREPARED 상태 검증 3) PREPARED 선점
  // 4) 실행 스레드 생성 5) 스텁 후보안 생성/저장 6) planning mode OFF
  public async execute(input: LaunchRoomSessionInput, slackThreadPort: SlackThreadPort): Promise<LaunchRoomSessionResult> {
    let phaseStartedAt = Date.now();
    // launch 대상이 되는 활성 세션을 시작 채널 기준으로 조회한다.
    // 세션이 없으면 ROOM_NO_ACTIVE_SESSION 예외로 즉시 종료된다.
    const activeSession = ensureActiveSession(
      await this.roomSessionRepository.findActiveSessionByStartChannel(input.startChannelId)
    );
    this.logLaunchPhaseCompletion({
      phase: "find_active_session",
      channelId: input.startChannelId,
      sessionId: activeSession.id,
      elapsedMs: Date.now() - phaseStartedAt
    });

    // launch 가능한 상태(PREPARED)인지 검증한다.
    // 이미 RUNNING/DECIDED면 상태 전이 규칙 위반이므로 차단한다.
    phaseStartedAt = Date.now();
    ensureLaunchableState(activeSession);
    await this.ensureLaunchReady(activeSession);
    this.logLaunchPhaseCompletion({
      phase: "validate_launch_state",
      channelId: input.startChannelId,
      sessionId: activeSession.id,
      elapsedMs: Date.now() - phaseStartedAt
    }); 

    // PREPARED 세션을 원자적으로 선점해 동시 launch 경쟁을 차단한다.
    phaseStartedAt = Date.now();
    const claimed = await this.roomSessionRepository.claimPreparedSessionForLaunch(activeSession.id);
    if (!claimed) {
      throw new RoomCommandError(ROOM_ERROR_CODES.ROOM_INVALID_STATE_TRANSITION);
    }
    this.logLaunchPhaseCompletion({
      phase: "claim_prepared_session",
      channelId: input.startChannelId,
      sessionId: activeSession.id,
      elapsedMs: Date.now() - phaseStartedAt
    });

    const runtimeContext: LaunchRuntimeContext = {
      createdRoundNo: null
    };

    try {
      return await this.runLaunchCore(input, activeSession, runtimeContext, slackThreadPort);
    } catch (error) {
      // launch 핵심 단계 실패 시 선점 상태를 롤백해 재시도를 가능하게 만든다.
      await this.rollbackLaunchFailure(activeSession.id, input.launchChannelId, runtimeContext, error);
      throw error;
    }
  }
}

import { ROOM_COMMAND_NAMES, ROOM_LAUNCH_SERVICE_MESSAGES, ROOM_LOG_EVENT_NAMES } from "../shared/messages";
import { ROOM_ERROR_CODES } from "../shared/errorCodes";
import type { Logger } from "../shared/logger";
import { RoomCommandError } from "../shared/roomCommandError";
import type {
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

// launch 공지에 필요한 입력 모델
interface LaunchRoundNoticeInput {
  channelId: string;
  threadTs: string;
  sessionId: string;
  candidateLines: string[];
}

// unknown 에러를 로그용 문자열로 정규화한다.
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return ROOM_LAUNCH_SERVICE_MESSAGES.followupNoticeUnknownError;
}

// `/room launch` 유스케이스 오케스트레이션 서비스
// 상태 검증 후 실행 스레드/워커 라운드/세션 상태 전이를 수행한다.
export class LaunchRoomSessionService {
  public constructor(
    private readonly roomSessionRepository: RoomSessionRepository,
    private readonly workerRoundRepository: WorkerRoundRepository,
    private readonly runWorkerRoundStubService: RunWorkerRoundStubService,
    private readonly logger: Logger
  ) {}

  // launch 선점 이후 실패 시 PREPARED로 롤백한다.
  private async rollbackLaunchClaim(sessionId: string, channelId: string, error: unknown): Promise<void> {
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

  // launch 핵심 단계를 실행하고 결과를 조립한다.
  private async runLaunchCore(
    input: LaunchRoomSessionInput,
    activeSession: RoomSession,
    slackThreadPort: SlackThreadPort
  ): Promise<LaunchRoomSessionResult> {
    // launch 채널에 실행 스레드를 생성한다.
    const launchThread = await slackThreadPort.createThread({
      channelId: input.launchChannelId,
      text: ROOM_LAUNCH_SERVICE_MESSAGES.launchThreadText(activeSession.topic)
    });

    // 세션에 실제 launch 스레드 식별자를 기록한다.
    const updatedSession = await this.roomSessionRepository.updateSessionToRunning({
      sessionId: activeSession.id,
      launchChannelId: input.launchChannelId,
      launchThreadTs: launchThread.threadTs
    });

    // 1차 MVP는 실제 LLM 대신 스텁 후보안(A/B/C)을 동기 생성한다.
    const candidates = this.runWorkerRoundStubService.execute(activeSession.topic);

    // 생성된 후보안을 round_no=1로 저장한다.
    const round = await this.workerRoundRepository.createRound({
      sessionId: activeSession.id,
      roundNo: 1,
      candidates
    });

    await this.postLaunchRoundNotice(slackThreadPort, {
      channelId: input.launchChannelId,
      threadTs: launchThread.threadTs,
      sessionId: updatedSession.id,
      candidateLines: this.buildCandidateLines(candidates)
    });

    // 운영 로그를 남겨 세션 상태 전이와 실행 채널을 추적한다.
    this.logger.info(ROOM_LOG_EVENT_NAMES.roomLaunchCompleted, {
      sessionId: updatedSession.id,
      channelId: input.launchChannelId,
      command: ROOM_COMMAND_NAMES.launch
    });

    return {
      session: updatedSession,
      round
    };
  }

  // launch 흐름:
  // 1) 활성 세션 확인 2) PREPARED 상태 검증 3) PREPARED 선점
  // 4) 실행 스레드 생성 5) 스텁 후보안 생성/저장 6) 결과 공지
  public async execute(input: LaunchRoomSessionInput, slackThreadPort: SlackThreadPort): Promise<LaunchRoomSessionResult> {
    // launch 대상이 되는 활성 세션을 시작 채널 기준으로 조회한다.
    // 세션이 없으면 ROOM_NO_ACTIVE_SESSION 예외로 즉시 종료된다.
    const activeSession = ensureActiveSession(
      await this.roomSessionRepository.findActiveSessionByStartChannel(input.startChannelId)
    );

    // launch 가능한 상태(PREPARED)인지 검증한다.
    // 이미 RUNNING/DECIDED면 상태 전이 규칙 위반이므로 차단한다.
    ensureLaunchableState(activeSession);

    // PREPARED 세션을 원자적으로 선점해 동시 launch 경쟁을 차단한다.
    const claimed = await this.roomSessionRepository.claimPreparedSessionForLaunch(activeSession.id);
    if (!claimed) {
      throw new RoomCommandError(ROOM_ERROR_CODES.ROOM_INVALID_STATE_TRANSITION);
    }

    try {
      return await this.runLaunchCore(input, activeSession, slackThreadPort);
    } catch (error) {
      // launch 핵심 단계 실패 시 선점 상태를 롤백해 재시도를 가능하게 만든다.
      await this.rollbackLaunchClaim(activeSession.id, input.launchChannelId, error);
      throw error;
    }
  }
}

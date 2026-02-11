import { ROOM_COMMAND_NAMES, ROOM_LAUNCH_SERVICE_MESSAGES, ROOM_LOG_EVENT_NAMES } from "../shared/messages";
import type { Logger } from "../shared/logger";
import type { RoomSession, RoomSessionRepository, RoomWorkerRound, SlackThreadPort, WorkerRoundRepository } from "../shared/types";
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

// `/room launch` 유스케이스 오케스트레이션 서비스
// 상태 검증 후 실행 스레드/워커 라운드/세션 상태 전이를 수행한다.
export class LaunchRoomSessionService {
  public constructor(
    private readonly roomSessionRepository: RoomSessionRepository,
    private readonly workerRoundRepository: WorkerRoundRepository,
    private readonly runWorkerRoundStubService: RunWorkerRoundStubService,
    private readonly logger: Logger
  ) {}

  // launch 흐름:
  // 1) 활성 세션 확인 2) PREPARED 상태 검증 3) 실행 스레드 생성
  // 4) 스텁 후보안 생성/저장 5) 세션 RUNNING 전이 6) 결과 공지
  public async execute(input: LaunchRoomSessionInput, slackThreadPort: SlackThreadPort): Promise<LaunchRoomSessionResult> {
    // launch 대상이 되는 활성 세션을 시작 채널 기준으로 조회한다.
    // 세션이 없으면 ROOM_NO_ACTIVE_SESSION 예외로 즉시 종료된다.
    const activeSession = ensureActiveSession(
      await this.roomSessionRepository.findActiveSessionByStartChannel(input.startChannelId)
    );

    // launch 가능한 상태(PREPARED)인지 검증한다.
    // 이미 RUNNING/DECIDED면 상태 전이 규칙 위반이므로 차단한다.
    ensureLaunchableState(activeSession);

    // launch 채널에 실행 스레드를 생성한다.
    // 이후 메시지/결과 공유는 이 스레드를 기준으로 진행된다.
    const launchThread = await slackThreadPort.createThread({
      channelId: input.launchChannelId,
      text: ROOM_LAUNCH_SERVICE_MESSAGES.launchThreadText(activeSession.topic)
    });

    // 1차 MVP는 실제 LLM 대신 스텁 후보안(A/B/C)을 동기 생성한다.
    const candidates = this.runWorkerRoundStubService.execute(activeSession.topic);

    // 생성된 후보안을 round_no=1로 저장한다.
    // round 데이터가 있어야 summary에서 의사결정 후보를 보여줄 수 있다.
    const round = await this.workerRoundRepository.createRound({
      sessionId: activeSession.id,
      roundNo: 1,
      candidates
    });

    // 세션 상태를 RUNNING으로 전이하고 launch 스레드 정보를 기록한다.
    // 이 단계가 완료되어야 재시작 후에도 현재 실행 중 세션을 복구할 수 있다.
    const updatedSession = await this.roomSessionRepository.updateSessionToRunning({
      sessionId: activeSession.id,
      launchChannelId: input.launchChannelId,
      launchThreadTs: launchThread.threadTs
    });

    // 후보안 배열을 사람이 읽기 쉬운 한 줄 요약 리스트로 변환한다.
    const candidateLines = candidates.map((candidate) => {
      return ROOM_LAUNCH_SERVICE_MESSAGES.candidateLine({
        option: candidate.option,
        summary: candidate.summary,
        risk: candidate.risk,
        estimatedCost: candidate.estimatedCost
      });
    });

    // launch 스레드에 라운드 결과를 공지한다.
    // 이후 팀원이 스레드만 봐도 현재 제안안들을 바로 파악할 수 있다.
    await slackThreadPort.postMessageInThread({
      channelId: input.launchChannelId,
      threadTs: launchThread.threadTs,
      text: [ROOM_LAUNCH_SERVICE_MESSAGES.roundCompletedTitle, ...candidateLines].join("\n")
    });

    // 운영 로그를 남겨 세션 상태 전이와 실행 채널을 추적한다.
    this.logger.info(ROOM_LOG_EVENT_NAMES.roomLaunchCompleted, {
      sessionId: updatedSession.id,
      channelId: input.launchChannelId,
      command: ROOM_COMMAND_NAMES.launch
    });

    // 핸들러에서 사용자 응답을 만들 수 있도록 갱신된 세션/라운드를 반환한다.
    return {
      session: updatedSession,
      round
    };
  }
}

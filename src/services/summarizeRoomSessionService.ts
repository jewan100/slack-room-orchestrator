import { ROOM_COMMAND_NAMES, ROOM_LOG_EVENT_NAMES, ROOM_SUMMARY_MESSAGES } from "../shared/messages";
import type { Logger } from "../shared/logger";
import type {
  BriefingRepository,
  RoomBriefing,
  RoomSession,
  RoomSessionRepository,
  RoomWorkerRound,
  SummaryMode,
  WorkerRoundRepository
} from "../shared/types";
import { ensureActiveSession } from "../validators/roomCommandValidator";

// summary 유스케이스 입력 모델
export interface SummarizeRoomSessionInput {
  startChannelId: string;
  mode: SummaryMode;
}

// summary 유스케이스 반환 모델
export interface SummarizeRoomSessionResult {
  session: RoomSession;
  summaryText: string;
}

// `/room summary` 유스케이스 서비스
// 세션/브리핑/최신 라운드를 조합해 brief/full 텍스트를 생성한다.
export class SummarizeRoomSessionService {
  public constructor(
    private readonly roomSessionRepository: RoomSessionRepository,
    private readonly briefingRepository: BriefingRepository,
    private readonly workerRoundRepository: WorkerRoundRepository,
    private readonly logger: Logger
  ) {}

  // summary 흐름:
  // 1) 활성 세션 조회 2) 브리핑/최신 라운드 조회 3) 모드별 텍스트 생성
  public async execute(input: SummarizeRoomSessionInput): Promise<SummarizeRoomSessionResult> {
    // 현재 시작 채널의 활성 세션을 조회한다.
    // 없으면 ensureActiveSession에서 ROOM_NO_ACTIVE_SESSION 예외가 발생한다.
    const session = ensureActiveSession(
      await this.roomSessionRepository.findActiveSessionByStartChannel(input.startChannelId)
    );

    // 세션에 연결된 최신 브리핑을 조회한다.
    // 브리핑이 없더라도 summary는 실패하지 않고 "데이터 없음" 메시지로 처리한다.
    const briefing = await this.briefingRepository.findBySessionId(session.id);

    // 가장 최신 워커 라운드를 조회한다.
    // 라운드가 없으면 launch 이전 상태로 간주해 안내 문구를 달리한다.
    const latestRound = await this.workerRoundRepository.findLatestBySessionId(session.id);

    // 요청 모드에 따라 요약 문자열 생성 함수를 선택한다.
    const summaryText = input.mode === "full"
      ? this.buildFullSummary(session, briefing, latestRound)
      : this.buildBriefSummary(session, briefing, latestRound);

    // 어떤 모드로 요약이 수행됐는지 운영 로그를 남긴다.
    this.logger.info(ROOM_LOG_EVENT_NAMES.roomSummaryCompleted, {
      sessionId: session.id,
      command: ROOM_COMMAND_NAMES.summary,
      mode: input.mode
    });

    // 핸들러가 즉시 사용자에게 보낼 수 있도록 완성된 텍스트를 반환한다.
    return {
      session,
      summaryText
    };
  }

  // compact한 요약 형식
  // Slack ephemeral 응답에서 빠르게 상태를 파악하는 용도로 사용한다.
  private buildBriefSummary(
    session: RoomSession,
    briefing: RoomBriefing | null,
    latestRound: RoomWorkerRound | null
  ): string {
    // 최신 라운드가 있으면 후보 옵션 라벨만 추출해 압축 표시한다.
    const candidateOptions = latestRound
      ? latestRound.candidates.map((candidate) => candidate.option).join(", ")
      : ROOM_SUMMARY_MESSAGES.noCandidates;

    // 세션 상태에 따라 다음 커맨드 안내를 분기한다.
    const nextAction = session.state === "PREPARED"
      ? ROOM_SUMMARY_MESSAGES.nextActionPrepared
      : ROOM_SUMMARY_MESSAGES.nextActionRunning;

    return ROOM_SUMMARY_MESSAGES.briefLines({
      sessionId: session.id,
      state: session.state,
      topic: session.topic,
      goal: briefing?.goal ?? ROOM_SUMMARY_MESSAGES.noBriefingSaved,
      candidateOptions,
      nextAction
    }).join("\n");
  }

  // 상세 요약 형식
  // 브리핑/후보안의 세부 항목까지 포함해 사람이 의사결정하기 쉽게 만든다.
  private buildFullSummary(
    session: RoomSession,
    briefing: RoomBriefing | null,
    latestRound: RoomWorkerRound | null
  ): string {
    // full 요약의 헤더(세션/상태/요청자/생성시각)를 먼저 구성한다.
    const lines: string[] = ROOM_SUMMARY_MESSAGES.fullHeaderLines({
      sessionId: session.id,
      state: session.state,
      topic: session.topic,
      requestedByUserId: session.requestedByUserId,
      createdAt: session.createdAt
    });

    // 브리핑 데이터 유무에 따라 섹션 내용을 분기한다.
    if (!briefing) {
      lines.push(ROOM_SUMMARY_MESSAGES.noBriefingAvailable);
    } else {
      lines.push(ROOM_SUMMARY_MESSAGES.briefingSectionTitle);
      lines.push(ROOM_SUMMARY_MESSAGES.briefingGoalLine(briefing.goal));
      lines.push(ROOM_SUMMARY_MESSAGES.briefingConstraintLine(briefing.constraints));
      lines.push(ROOM_SUMMARY_MESSAGES.briefingSuccessCriteriaLine(briefing.successCriteria));
    }

    // 가독성을 위해 섹션 사이에 빈 줄을 삽입한다.
    lines.push("");

    // 최신 라운드 유무에 따라 후보안 목록을 채운다.
    if (!latestRound) {
      lines.push(ROOM_SUMMARY_MESSAGES.noRoundAvailable);
    } else {
      // 각 후보안의 요약/장점/리스크/예상비용을 순서대로 추가한다.
      lines.push(ROOM_SUMMARY_MESSAGES.roundSectionTitle(latestRound.roundNo));
      for (const candidate of latestRound.candidates) {
        lines.push(ROOM_SUMMARY_MESSAGES.roundCandidateLine(candidate.option, candidate.summary));
        lines.push(ROOM_SUMMARY_MESSAGES.roundProsLine(candidate.pros.join(ROOM_SUMMARY_MESSAGES.prosDelimiter)));
        lines.push(ROOM_SUMMARY_MESSAGES.roundRiskLine(candidate.risk));
        lines.push(ROOM_SUMMARY_MESSAGES.roundEstimatedCostLine(candidate.estimatedCost));
      }
    }

    // 마지막 줄에는 항상 다음 액션 안내를 붙여 사용자의 다음 입력을 명확히 한다.
    const nextAction = session.state === "PREPARED"
      ? ROOM_SUMMARY_MESSAGES.nextActionPrepared
      : ROOM_SUMMARY_MESSAGES.nextActionRunning;
    lines.push("");
    lines.push(ROOM_SUMMARY_MESSAGES.nextActionLine(nextAction));

    return lines.join("\n");
  }
}

// 사용자 노출 문구/운영 문구를 중앙 관리하는 카탈로그
// 모듈별 하드코딩을 금지하고 이 파일을 단일 출처로 사용한다.
export const ROOM_USAGE_LINES = [
  "사용법:",
  "/room start <주제>",
  "/room summary [--brief|--full]",
  "/room launch"
] as const;

export const ROOM_SLASH_COMMAND = "/room";

// 파서가 인식하는 서브커맨드 이름 상수
export const ROOM_COMMAND_NAMES = {
  start: "start",
  summary: "summary",
  launch: "launch"
} as const;

// summary 플래그 상수
export const ROOM_SUMMARY_OPTION_FLAGS = {
  brief: "--brief",
  full: "--full"
} as const;

// 에러코드별 기본 사용자 문구
export const ROOM_ERROR_TEXTS_BY_CODE = {
  ROOM_MISSING_TOPIC: "`/room start` 명령에는 주제가 필요합니다.",
  ROOM_NO_ACTIVE_SESSION: "활성 세션이 없습니다. 먼저 `/room start <주제>`를 실행해 주세요.",
  ROOM_ALREADY_RUNNING: "시작 채널에 이미 활성 세션이 있습니다.",
  ROOM_INVALID_STATE_TRANSITION: "현재 세션 상태에서는 해당 명령을 실행할 수 없습니다.",
  ROOM_INVALID_COMMAND: "지원하지 않는 명령이거나 인자가 올바르지 않습니다.",
  ROOM_INTERNAL_ERROR: "예기치 않은 내부 오류가 발생했습니다."
} as const;

// 명령 파싱/응답 조합에 사용하는 공통 문구
export const ROOM_COMMAND_MESSAGES = {
  missingSubcommand: "서브커맨드를 입력해 주세요.",
  summaryTooManyArguments: "`summary` 명령에는 옵션을 하나만 사용할 수 있습니다.",
  invalidSummaryOption: "`summary` 옵션이 올바르지 않습니다.",
  launchDoesNotTakeArguments: "`launch` 명령은 추가 인자를 받지 않습니다.",
  missingTopicFallback: "주제를 입력해 주세요.",
  unsupportedSubcommand: (subcommand: string): string => `지원하지 않는 서브커맨드입니다: ${subcommand}.`,
  errorHeader: (code: string): string => `오류 코드: ${code}`,
  startSuccessLines: (sessionId: string, state: string): string[] => [
    `세션이 생성되었습니다: ${sessionId}`,
    `상태: ${state}`,
    "다음 액션: /room summary 또는 /room launch"
  ],
  launchSuccessLines: (sessionId: string, state: string, roundNo: number): string[] => [
    `실행 스레드가 시작되었습니다. 세션: ${sessionId}`,
    `상태: ${state}`,
    `라운드: ${roundNo}`,
    "다음 액션: /room status (2차 단계)"
  ]
} as const;

// start 유스케이스에서 사용하는 문구
export const ROOM_START_SERVICE_MESSAGES = {
  preparedThreadText: (topic: string): string => `회의 세션을 준비했습니다.\n주제: ${topic}`,
  briefingGoal: (topic: string): string => `다음 주제의 최적 실행 경로를 정리합니다: ${topic}`,
  briefingConstraints: "실행 전 제약사항(범위, 일정, 자원)을 정리합니다.",
  briefingSuccessCriteria: "최종 결정을 위한 측정 가능한 성공 기준을 정의합니다.",
  briefingSavedNotice: "브리핑 템플릿 저장 완료. 다음 액션: /room summary 또는 /room launch"
} as const;

// summary 유스케이스에서 사용하는 문구
export const ROOM_SUMMARY_MESSAGES = {
  noCandidates: "없음",
  prosDelimiter: "; ",
  noBriefingSaved: "저장된 브리핑이 없습니다.",
  noBriefingAvailable: "브리핑: 저장된 데이터가 없습니다.",
  noRoundAvailable: "라운드: 아직 워커 라운드 데이터가 없습니다.",
  nextActionPrepared: "/room launch",
  nextActionRunning: "/room status (2차 단계)",
  briefLines: (input: {
    sessionId: string;
    state: string;
    topic: string;
    goal: string;
    candidateOptions: string;
    nextAction: string;
  }): string[] => [
    `세션: ${input.sessionId}`,
    `상태: ${input.state}`,
    `주제: ${input.topic}`,
    `목표: ${input.goal}`,
    `후보안: ${input.candidateOptions}`,
    `다음 액션: ${input.nextAction}`
  ],
  fullHeaderLines: (input: {
    sessionId: string;
    state: string;
    topic: string;
    requestedByUserId: string;
    createdAt: string;
  }): string[] => [
    `세션: ${input.sessionId}`,
    `상태: ${input.state}`,
    `주제: ${input.topic}`,
    `요청자: ${input.requestedByUserId}`,
    `생성 시각: ${input.createdAt}`,
    ""
  ],
  briefingSectionTitle: "브리핑:",
  briefingGoalLine: (goal: string): string => `- 목표: ${goal}`,
  briefingConstraintLine: (constraints: string): string => `- 제약사항: ${constraints}`,
  briefingSuccessCriteriaLine: (successCriteria: string): string => `- 성공 기준: ${successCriteria}`,
  roundSectionTitle: (roundNo: number): string => `라운드 ${roundNo} 후보안:`,
  roundCandidateLine: (option: string, summary: string): string => `- ${option}: ${summary}`,
  roundProsLine: (pros: string): string => `  장점: ${pros}`,
  roundRiskLine: (risk: string): string => `  리스크: ${risk}`,
  roundEstimatedCostLine: (estimatedCost: string): string => `  예상 비용: ${estimatedCost}`,
  nextActionLine: (nextAction: string): string => `다음 액션: ${nextAction}`
} as const;

// launch 유스케이스에서 사용하는 문구
export const ROOM_LAUNCH_SERVICE_MESSAGES = {
  launchThreadText: (topic: string): string => `실행을 시작합니다.\n주제: ${topic}`,
  roundCompletedTitle: "워커 라운드 완료(스텁):",
  candidateLine: (input: {
    option: string;
    summary: string;
    risk: string;
    estimatedCost: string;
  }): string => `${input.option}: ${input.summary} (리스크: ${input.risk}, 예상 비용: ${input.estimatedCost})`
} as const;

// 스텁 워커 라운드 생성 문구
export const ROOM_WORKER_STUB_MESSAGES = {
  optionASummary: (topic: string): string => `주제 "${topic}"에 대해 가장 빠르게 시작하는 경로입니다.`,
  optionAPros: ["구현 부담이 낮습니다", "빠른 검증이 가능합니다"],
  optionARisk: "요구사항이 빠르게 확장되면 임시방편이 될 수 있습니다.",
  optionACost: "1~2일",
  optionBSummary: (topic: string): string => `주제 "${topic}"에 대해 속도와 확장성을 균형 있게 맞춘 경로입니다.`,
  optionBPros: ["속도와 구조의 균형이 좋습니다", "2차 단계 리팩터링 위험을 줄일 수 있습니다"],
  optionBRisk: "초기 구현 복잡도가 다소 올라갈 수 있습니다.",
  optionBCost: "2~4일",
  optionCSummary: (topic: string): string => `주제 "${topic}"에 대해 장기 확장성을 최우선으로 둔 경로입니다.`,
  optionCPros: ["장기 유연성이 가장 높습니다", "확장 단계의 기반을 탄탄하게 만들 수 있습니다"],
  optionCRisk: "MVP 기준으로는 초기 납기 속도가 느릴 수 있습니다.",
  optionCCost: "4~6일"
} as const;

// 앱 부트스트랩/환경검증 문구
export const ROOM_APP_MESSAGES = {
  missingRequiredEnvironmentVariable: (name: string): string => `필수 환경변수가 없습니다: ${name}`,
  invalidPort: "PORT는 0보다 큰 숫자여야 합니다.",
  unknownBootstrapError: "부트스트랩 중 알 수 없는 오류가 발생했습니다."
} as const;

// 로그 이벤트명 카탈로그
// 이벤트 키를 중앙화해 로그 분석 시 필드 분산을 방지한다.
export const ROOM_LOG_EVENT_NAMES = {
  slackCommandBound: "slack.command.bound",
  roomCommandInvalid: "room.command.invalid",
  roomCommandCompleted: "room.command.completed",
  roomCommandFailed: "room.command.failed",
  roomStartCompleted: "room.start.completed",
  roomSummaryCompleted: "room.summary.completed",
  roomLaunchCompleted: "room.launch.completed",
  appStopping: "slack-room-orchestrator.stop",
  appStarted: "slack-room-orchestrator.start"
} as const;

// SQLite 계층에서 사용하는 오류 문구
export const ROOM_SQLITE_MESSAGES = {
  notConnected: "SqliteClient가 연결되지 않았습니다. connect() 이후에 데이터베이스를 사용해 주세요.",
  createPreparedSessionFailed: "PREPARED 세션 생성에 실패했습니다.",
  updateSessionToRunningFailed: "세션 상태를 RUNNING으로 변경하는 데 실패했습니다.",
  createBriefingFailed: "브리핑 생성에 실패했습니다.",
  createWorkerRoundFailed: "워커 라운드 생성에 실패했습니다."
} as const;

// Slack 어댑터 계층에서 사용하는 오류 문구
export const ROOM_SLACK_MESSAGES = {
  missingThreadTimestamp: "Slack postMessage 응답에 스레드 타임스탬프(ts)가 없습니다."
} as const;

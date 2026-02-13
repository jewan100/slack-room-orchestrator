import type { RoomErrorCode } from "./errorCodes";

// Slack에 출력되는 사용자 친화 문구 카탈로그
// 로그/내부 오류 메시지와 분리해 "짧고 대화체" UX를 유지한다.

export const ROOM_USAGE_LINES = [
  "/room start",
  "/room launch",
  "/room stop",
  "/room help"
] as const;

// 에러코드별 기본 사용자 문구
export const ROOM_ERROR_TEXTS_BY_CODE = {
  ROOM_NO_ACTIVE_SESSION: "지금은 진행 중인 회의가 없어. 먼저 `/room start` 해줘.",
  ROOM_ALREADY_RUNNING: "이미 진행 중인 회의가 있어.",
  ROOM_INVALID_STATE_TRANSITION: "지금은 그 명령을 할 수 없어.",
  ROOM_INVALID_COMMAND: "형, 명령어가 잘못된 것 같아.",
  ROOM_INTERNAL_ERROR: "잠깐 문제가 생겼어. 다시 한 번만 해줘."
} as const satisfies Record<RoomErrorCode, string>;

// 명령 파싱/응답 조합에 사용하는 공통 문구
export const ROOM_COMMAND_MESSAGES = {
  processingNotice: "잠깐만. 처리할게.",
  invalidCommandNotice: ROOM_ERROR_TEXTS_BY_CODE.ROOM_INVALID_COMMAND,
  helpButtonLabel: "도움말 보기",
  helpIntro: "형, `/room`은 이렇게 써.",
  stopNoActiveSessionNotice: "지금은 진행 중인 회의가 없어.",
  stopSuccessText: "회의를 종료했어."
} as const;

// start 유스케이스에서 Slack에 남기는 문구
export const ROOM_START_SERVICE_MESSAGES = {
  preparedThreadText: "회의 준비 스레드를 열었어.",
  briefingGoal: "이번 회의의 실행 최적 경로를 정리합니다.",
  briefingConstraints: "실행 전 제약사항(범위/일정/자원)을 먼저 고정합니다.",
  briefingSuccessCriteria: "최종 결정을 위한 측정 가능한 완료 기준을 정의합니다.",
  kickoffFallbackNotice:
    "형, 어떤 회의 준비할까?\n" +
    "- 목표\n- 제약\n- 완료 기준\n" +
    "이 3가지만 짧게 알려줘."
} as const;

// launch 유스케이스에서 Slack에 남기는 문구
export const ROOM_LAUNCH_SERVICE_MESSAGES = {
  launchThreadText: (): string => "실행 스레드를 열었어.",
  roundCompletedTitle: "후보안을 정리했어:",
  candidateLine: (input: {
    option: string;
    summary: string;
    risk: string;
    estimatedCost: string;
  }): string => `${input.option}: ${input.summary} (리스크: ${input.risk}, 예상 비용: ${input.estimatedCost})`
} as const;

// 스텁 워커 라운드 생성 문구
export const ROOM_WORKER_STUB_MESSAGES = {
  optionASummary: (topic: string): string => `주제 "${topic}" 기준으로 가장 빨리 착수하는 경로예요.`,
  optionAPros: ["구현 부담이 낮아요", "빠른 검증이 가능해요"],
  optionARisk: "요구사항이 급격히 커지면 임시 대응이 될 수 있어요.",
  optionACost: "1~2일",
  optionBSummary: (topic: string): string => `주제 "${topic}" 기준으로 속도와 확장성 균형을 맞춘 경로예요.`,
  optionBPros: ["속도와 구조 균형이 좋아요", "2차 리팩토링 위험을 줄일 수 있어요"],
  optionBRisk: "초기 구현 복잡도가 조금 올라갈 수 있어요.",
  optionBCost: "2~4일",
  optionCSummary: (topic: string): string => `주제 "${topic}" 기준으로 장기 확장성을 최우선으로 둔 경로예요.`,
  optionCPros: ["장기 유연성이 가장 높아요", "확장 단계 기반을 탄탄하게 만들 수 있어요"],
  optionCRisk: "MVP 기준에서는 초기 납기 속도가 느릴 수 있어요.",
  optionCCost: "4~6일"
} as const;

// OpenClaw 연동에서 Slack에 남기는 문구
export const ROOM_OPENCLAW_SLACK_MESSAGES = {
  liveReplyFailureNotice: "형, 답변이 잠깐 끊겼어. 바로 다시 해볼게.",
  ttlModeOffNotice: "형, 한동안 말이 없어서 이번 회의는 여기서 멈출게."
} as const;

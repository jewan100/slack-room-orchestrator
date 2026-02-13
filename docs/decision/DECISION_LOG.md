# DECISION LOG

## 목적
- 이 문서는 "모든 결정의 일지"가 아니라, 현재 프로젝트를 움직이는 **유효한 기준선(Baseline)** 만 유지한다.

## 기록 트리거 (2개 이상 충족 시에만 기록)
1. 시스템/프로세스 기본 동작을 바꾼다.
2. 2개 이상 문서/모듈에 영향을 준다.
3. 30일 뒤에도 참조 가치가 높다.
4. 되돌릴 경우 운영 혼선이 발생한다.

## 기록 제외
- 단순 실행 지시
- 반복되는 일상 명령
- 한 번성 작업 메모
- PR 내부에서 닫히는 미세 구현 선택

## 압축 규칙 (강제)
1. 유효 결정은 최대 8개까지만 유지한다.
2. 같은 주제는 새 항목 추가 대신 기존 항목을 갱신한다.
3. 영향이 끝난 결정은 삭제하거나 `DECISION_LOG_ARCHIVE.md`로 이동한다.
4. 월 1회 정리 시, 중복/파생 결정을 상위 결정으로 병합한다.
5. AI 워커 기본 참조는 이 문서만 대상으로 한다.

## 기록 템플릿
- ID:
- 날짜:
- 주제:
- 영향 범위:
- 결정:
- 근거:
- 후속 액션:
- 상태: `유효` | `검토중`

## 현재 유효 결정

### D-001
- 날짜: 2026-02-10
- 주제: `/room` 2단계 흐름
- 영향 범위: 커맨드 워크플로우
- 결정: `/room start`는 준비, `/room launch`는 실행으로 분리
- 근거:
  - 준비/실행 분리가 상태 관리와 확장(요약/결정)을 단순화함
- 후속 액션:
  - `start -> launch` 상태 전이를 기준으로 구현/문서 유지
- 상태: 유효

### D-002
- 날짜: 2026-02-11
- 주제: MVP 1차 기술/범위 고정
- 영향 범위: 런타임/연동/저장소/공개 인터페이스
- 결정:
  - 런타임: `TypeScript + Node.js`
  - Slack 연동: `Bolt + Socket Mode`
  - 커맨드 모델: 단일 `/room` + 서브커맨드
  - 1차 범위: `start`, `summary`, `launch`
  - 저장소: SQLite
  - `launch` AI 라운드: 1차 스텁
- 근거:
  - 문서 우선순위와 정합
  - E2E 검증 속도와 영속성 요구를 동시에 충족
- 후속 액션:
  - 2차에서 `status`, `decide` 추가
  - 실 LLM adapter 연동
- 상태: 유효

### D-003
- 날짜: 2026-02-11
- 주제: 제품 방향/주체 모델/작업 운영 방식
- 영향 범위: 문서 정책/권한 경계/Owner 운영
- 결정:
  - 제품 목표는 택배/소포를 Slash Command로 제어하는 범용 서버
  - 수행 주체는 `명령 요청자/택배/소포/최종 결정자`로 분리
  - 최종 결정 권한은 사용자(형)에게 유지
  - Owner 트래킹은 Sprint 없이 `PROJECT_TODO.md` 단일 문서로 운영
- 근거:
  - 초기 기획 정체성과 장기 확장성 동시 유지 필요
  - 입력/실행/결정 주체 분리가 운영 책임 경계를 명확히 함
  - 연속 개선형 프로젝트에는 단일 TODO 운영이 관리비용을 낮춤
- 후속 액션:
  - 신규 도메인 커맨드에도 동일 주체 모델 적용
  - `status`/`decide` 구현 시 역할 기반 권한 검증 반영
- 상태: 유효

### D-004
- 날짜: 2026-02-11
- 주제: PR 리뷰 재발 방지 규칙 고정
- 영향 범위: 전역 코드 규칙/Slack 도메인 규칙/최종 리뷰 체크리스트
- 결정:
  - 내부 예외 원문은 사용자 응답에 노출하지 않고 로그 컨텍스트로만 기록
  - 핵심 단계와 후속 알림 단계를 분리하고, 후속 실패는 부분 성공 규칙으로 처리
  - 상태 전이는 원자적 선점 + 보상(롤백) 경로를 강제
  - 동시성 충돌(unique constraint/선점 실패)은 도메인 에러코드로 매핑
- 근거:
  - 이번 PR 리뷰에서 동일 유형 이슈가 다수 반복됨
  - 운영자 관점의 상태/응답 모순과 재시도 혼선을 사전 차단할 필요
- 후속 액션:
  - 신규 커맨드(`status`, `decide`, 택배/소포 확장 도메인) 구현 시 동일 규칙 적용
  - Final review에서 체크리스트 항목으로 반드시 검증
- 상태: 유효

### D-005
- 날짜: 2026-02-11
- 주제: OpenClaw 연동 v1 실시간 우선 경로 고정
- 영향 범위: `/room` 유스케이스, Slack message 이벤트 수집, DB 스키마, 운영 환경변수
- 결정:
  - Slack 입력 소유는 `slack-room-orchestrator`가 유지하고, 감시 대상 판별은 SQLite(`room_watch_targets`)로 수행
  - 실시간 답변 생성은 OpenClaw OpenAI 호환 HTTP API(`POST /v1/chat/completions`)를 사용
  - 세션 연속성 키는 `x-openclaw-session-key=room:{sessionId}` 규칙으로 고정
  - thread별 동적 라우팅 제어(HTTP/NDJSON bind/unbind)는 v1에서 보류
  - `room_watch_targets`는 채널당 ON 1개 불변식을 유지
  - `/room start` 성공 시 planning watch target ON + `ROOM_MODE_ON` 이벤트 enqueue
  - `/room launch` 성공 시 planning watch target OFF + `ROOM_MODE_OFF(offReason=LAUNCH)` enqueue
  - `/room stop` 성공 시 planning watch target OFF + `ROOM_MODE_OFF(offReason=MANUAL)` enqueue
  - planning 스레드 무대응 TTL 만료 시 watch target OFF + 세션 `DECIDED` 종료 + 스레드 종료 안내를 수행
  - OpenClaw 호출 실패 시 사용자 안내 메시지를 1회 게시하고, 비동기 재시도 큐로 복구 시도
  - 주기 기반 자동 트리거(`ROOM_QUESTION_TRIGGER`)는 서버가 enqueue하고 실제 질문 생성은 OpenClaw가 수행
  - outbox -> NDJSON 디스패치는 at-least-once로 운영하며 소비 측에서 `eventId` 기준 중복 제거
  - 보안상 메시지 본문 전문은 이벤트/DB/NDJSON에 저장하지 않음
- 근거:
  - 사용자가 요구한 "실시간 대화형 택배" 경험을 위해 Slack 이벤트 수신과 OpenClaw 호출 경계를 단순화할 필요
  - Slash 명령 서버 구현 완료 이후 "택배가 계속 듣고 정리" 요구를 최소 변경으로 연결하기 위한 확장 필요
  - 수명 규칙(ON/OFF/TTL)을 고정해야 장기 운영에서 감시 대상 누적/정합성 붕괴를 방지 가능
  - outbox 기반 전달은 재시작 복구와 장애 내성을 동시에 확보
- 후속 액션:
  - OpenClaw 소비 측은 `x-openclaw-session-key=room:{sessionId}` 기준으로 세션 메모리 일관성을 유지
  - OpenClaw 소비 측에서 `eventId` 중복 제거를 필수 적용
  - 실 LLM adapter 연동 시 trigger 이벤트 소비 계약 문서화
- 상태: 유효

### D-006
- 날짜: 2026-02-13
- 주제: `/room launch` 멀티 에이전트(Builder/Critic) 호출 구조
- 영향 범위: launch 서비스, 프롬프트 관리(`docs/prompts`), LLM 연동 어댑터
- 결정:
  - `/room start`는 사람(제완)↔택배 대화로 준비를 끝내고 `Launch Brief`(압축본)만 만든다.
  - `/room launch`에서만 멀티 모델을 호출한다(1라운드 기본).
  - 역할 분리:
    - GPT: Builder/Ideator (확장/구체화/MVP/로드맵)
    - Claude: Critic/Editor (리스크/가정/약관/명료화)
  - 프롬프트는 `room launch` 전용으로 `docs/prompts/*`에 보관한다.
  - launch 결과는 모델 원문 2개 덤프가 아니라 Moderator가 합친 `Final Memo`(긴 문서) 1개로 Slack 스레드에 남긴다.
  - LLM 연동은 인터페이스(어댑터) 기반으로 설계하고 구현체는 교체 가능하게 유지한다.
    - launch 단계에서 `Builder`/`Critic` 호출은 `LLMClient`(가칭) 인터페이스로 추상화한다.
    - 실제 호출 방식은 구현체로 분리한다.
      - (초기) `PromptBased*Client`: 모델명 + 프롬프트(서버 보관) + Launch Brief를 보내는 방식
      - (추후) `AgentBased*Client`: 벤더 콘솔/대시보드에서 준비한 agent 설정을 ID로 호출하는 방식(가능해지면 교체)
    - `slack-room-orchestrator`는 우선 OpenAI/Anthropic 벤더 API에 직접 통신해도 된다(별도 서버 필수 아님).
    - 어떤 방식이든 launch 입력은 `Launch Brief`를 단일 소스로 유지한다.
- 근거:
  - start 단계에서 컨텍스트를 압축해 launch 입력을 안정화(품질/비용/일관성)하기 위함
  - Builder/Critic 역할을 분리해야 결과물 중복을 줄이고 최종 문서 편집이 쉬움
  - 벤더별/버전별 API 차이를 흡수하면서도 `/room launch` 유스케이스 코어를 안정적으로 유지하기 위함
  - 형(사용자)이 콘솔에서 agent 세팅을 선호할 때, 코드 변경 범위를 어댑터 교체로 제한하기 위함
- 후속 액션:
  - 스텁 워커(`RunWorkerRoundStubService`)를 교체 가능한 LLM runner/adapter로 분리
  - `Final Memo` 템플릿을 코드 경로에 반영(섹션 헤더 고정)
  - `LaunchRoomSessionService`는 인터페이스만 의존하도록 변경
  - 환경변수로 prompt/agent 모드를 스위치할 수 있게 구성
- 상태: 유효

### D-006A
- 날짜: 2026-02-13
- 주제: 회의 종료 리포트 게시 위치(택배-비서)
- 영향 범위: Slack 채널 라우팅, 회의 종료 UX, 운영 로그 탐색성
- 결정:
  - `/room start`는 `택배-비서`에서 planning 스레드를 연다.
  - `/room launch`는 `아이디어-회의실`에서 실행 스레드를 연다.
  - 회의 중단(종료) 시 택배가 회의 내용을 압축해 리포트를 생성한다.
  - 리포트 게시 정책은 "상세는 start 스레드, 본문에는 짧은 요약"(3번)으로 한다.
    - 상세 리포트: `택배-비서`의 start 스레드에 댓글로 게시
    - 요약 리포트: `택배-비서` 채널 본문에 5~10줄 요약 + 상세 스레드 링크
- 근거:
  - 아이디어별 기록을 하나의 스레드에 누적해 재시작/회고가 쉬워야 함
  - 채널 본문은 최근 리포트를 빠르게 훑는 용도로 유지(도배 방지)
- 후속 액션:
  - `/room end`(정상 종료) 커맨드에서 리포트 게시를 자동 실행
  - `/room stop`(강제 중단) 시에는 리포트 대신 "중단 메모"(3~5줄)만 남긴다.
  - start/launch 스레드 링크를 상호 참조로 남기기
- 상태: 유효

### D-008
- 날짜: 2026-02-13
- 주제: AI 코딩 에이전트 작업 원칙(Karpathy 4원칙) 채택
- 영향 범위: `AGENTS.md`, `README.md`, `docs/developer/STANDARDS.md` (및 향후 PR 운영 전반)
- 결정:
  - 모든 AI 워커는 Karpathy 4원칙(Think Before Coding / Simplicity First / Surgical Changes / Goal-Driven Execution)을 기본 행동 원칙으로 따른다.
  - 상세 코드 스타일 규칙은 `JEWAN_DEV_CONSTITUTION.md`를 단일 원본으로 유지한다.
- 근거:
  - 과잉 변경/추정/과복잡으로 인한 품질 하락을 예방하고, 리뷰/추적 비용을 줄이기 위함
  - 문서로 합의된 “작업 방식”을 고정해 워커 간 일관성을 확보하기 위함
- 후속 액션:
  - 이번 PR에서 `AGENTS.md`에 4원칙을 명문화하고, `README.md`/`docs/developer/STANDARDS.md`에 참조를 연결한다.
  - 리뷰 체크리스트 반영은 별도 PR에서 검토한다.
- 상태: 유효
- 참고:
  - Karpathy 원문: https://x.com/karpathy/status/2015883857489522876
  - 참고 스킬: https://github.com/forrestchang/andrej-karpathy-skills/blob/main/skills/karpathy-guidelines/SKILL.md

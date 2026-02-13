# slack-room-orchestrator 🐾

택배(메인)와 소포(워커) 에이전트를 Slack Slash Command로 컨트롤하는 **범용 오케스트레이션 서버**.

## 캐릭터/운영 컨셉
- **택배 (OpenClaw 메인 에이전트)**: 검정 고양이 형님. 전체 오케스트레이션 흐름을 지휘하고, 중요한 명령을 책임진다.
- **소포 (워커 에이전트들)**: 하얀 고양이 팀. 병렬 실행/분석/검증을 맡아 택배에게 결과를 또렷하게 전달한다.
- 운영 톤: 귀엽게 말해도 일은 정확하게, 기록은 꼼꼼하게.

## 프로젝트 최종 목표
- 목표는 "회의실 기능 하나"가 아니라, Slack Slash Command를 통해 택배/소포를 제어하는 범용 서버를 만드는 것이다.
- `/room`은 그 목표를 검증하는 1차 도메인(vertical slice)이다.

## 초기 기획 유지 원칙
- 기존 기획은 삭제/교체보다 **누적 확장**을 우선한다.
- 변경이 필요하면 기존 의도를 남기고, "추가된 결정/범위"를 문서에 쌓는 방식으로 관리한다.
- 결정 변경은 `docs/decision/DECISION_LOG.md`에 기록한다.

## 현재 구현 범위 (MVP 1차: room 도메인)
- `/room start <topic>`
- `/room summary [--brief|--full]`
- `/room launch`

미구현(2차):
- `/room status`
- `/room decide <A|B|C>`
- 실 LLM 연동 (현재 `launch`는 스텁 라운드)

## 런타임/기술
- Node.js 20+
- TypeScript
- Slack Bolt + Socket Mode
- SQLite (`sqlite3` + `sqlite`)

## 빠른 시작
1. 의존성 설치: `npm install`
2. 환경변수 준비: `.env.example` 참고하여 `.env` 작성
3. 개발 실행: `npm run dev`

## 필수 환경변수
- `SLACK_BOT_TOKEN`
- `SLACK_APP_TOKEN`
- `ROOM_START_CHANNEL_ID`
- `ROOM_LAUNCH_CHANNEL_ID`
- `SQLITE_PATH`

권장:
- `LOG_LEVEL` (`debug|info|warn|error`)
- `PORT` (기본값 `3000`)

## Slack 커맨드 모델
- 현재: 단일 Slash Command `/room` + 서브커맨드 파싱
- 확장 방향: `/room` 외 다른 도메인 커맨드를 모듈 단위로 추가
- 공통 원칙: Slack 진입점은 얇게, 도메인 로직은 `service/repository/adapter` 경계로 분리

## 수행 주체 모델
- 명령 요청자: Slack에서 커맨드를 입력하는 사람(기본: 형)
- 오케스트레이터: 택배(검정 고양이 형님, 커맨드 파싱/상태 전이/실행 조율)
- 워커 실행자: 소포들(하얀 고양이 팀, 분석/후보안/검증 작업 담당)
- 최종 결정자: 형(최종 선택/확정 권한)

예시:
- `/room start improve onboarding flow`
- `/room summary --brief`
- `/room launch`

## 데이터 영속화
- 마이그레이션: `migrations/001_init.sql`
- 현재 저장 대상(`room` 도메인):
  - 세션: `room_sessions`
  - 브리핑: `room_briefings`
  - 워커 라운드: `room_worker_rounds`
- 재시작 후 상태 유지

## 개발/검증 명령
- `npm run lint`
- `npm run typecheck`
- `npm test`

## 필독 문서 우선순위
`AGENTS.md`의 문서 우선순위와 동일하게 유지한다.

1. `AGENTS.md` (AI 워커 작업 계약, 최상위 작업 지침)
2. `JEWAN_DEV_CONSTITUTION.md` (전역 개발 헌법, 최상위 원칙)
3. `STANDARDS.md` (레포 공통 구현/프로세스 표준)
4. `SLACK_COMMAND_ENGINEERING_STANDARDS.md` (도메인 특화 규칙)
5. `README.md` (현재 레포 운영 맥락/확장 방향)
6. `docs/decision/DECISION_LOG.md` (현재 유효 기준선)
7. `docs/reviewer/PR_REVIEW_POLICY.md` (리뷰 절차)
8. `docs/reviewer/CODEX_FINAL_REVIEW_CHECKLIST.md` (최종 점검 항목)
9. `.github/copilot-instructions.md` (Copilot 작업 가이드)
10. `.github/codex-instructions.md` (Codex 최종 게이트 기준)
11. `.github/PULL_REQUEST_TEMPLATE.md` (PR 작성 형식)

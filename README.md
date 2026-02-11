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
- OpenClaw 연동 v1
  - `ROOM_MODE_ON`/`ROOM_MODE_OFF` 이벤트 동기화
  - thread 메타데이터 누적 감시
  - 자동 `ROOM_SUMMARY_TRIGGER`/`ROOM_QUESTION_TRIGGER` 이벤트 발행
  - outbox -> NDJSON 디스패치

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
- `OPENCLAW_EVENTS_FILE_PATH` (기본 `./data/openclaw-room-events.ndjson`)
- `ROOM_MODE_TTL_MINUTES` (기본 `60`)
- `ROOM_AUTO_SUMMARY_MESSAGE_THRESHOLD` (기본 `20`)
- `ROOM_AUTO_QUESTION_INTERVAL_MINUTES` (기본 `30`)
- `OPENCLAW_OUTBOX_DISPATCH_INTERVAL_MS` (기본 `5000`)

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
- OpenClaw 연동 확장: `migrations/002_openclaw_sync.sql`
- 실시간 불변식 보강: `migrations/003_room_watch_target_active_unique.sql`
- 현재 저장 대상(`room` 도메인):
  - 세션: `room_sessions`
  - 브리핑: `room_briefings`
  - 워커 라운드: `room_worker_rounds`
  - OpenClaw 감시 대상: `room_watch_targets`
  - OpenClaw 스레드 메시지 메타데이터: `room_thread_messages`
  - OpenClaw 이벤트 outbox: `openclaw_event_outbox`
- 재시작 후 상태 유지

## OpenClaw 연동 규칙 (v1)
### 실시간 경로 (1순위)
- Relay는 `ROOM_START_CHANNEL_ID` 채널을 OpenClaw 회의 세션으로 고정 매핑한다.
- thread별 동적 라우팅 제어(명령형 bind/unbind)는 v1에서 사용하지 않는다.
- OpenClaw는 수신 메시지마다 SQLite(`room_watch_targets`)를 조회해 아래 조건일 때만 회의 모드로 반응한다.
  - `status='ON'`
  - `channel_id` 일치
  - `thread_ts` 일치
- 시작 채널 기준 활성 planning room은 1개만 허용한다.

### 백그라운드 경로 (2순위 보조)
- `/room start` 성공 시 planning thread를 watch target으로 ON 등록하고 `ROOM_MODE_ON` 이벤트를 적재한다.
- `/room launch` 성공 시 planning watch target을 OFF 전환하고 `ROOM_MODE_OFF(offReason=LAUNCH)`를 적재한다.
- launch 없이 `ROOM_MODE_TTL_MINUTES`가 지나면 `ROOM_MODE_OFF(offReason=TTL)`를 자동 발행한다.
- 감시 대상 thread에서 메시지가 `ROOM_AUTO_SUMMARY_MESSAGE_THRESHOLD`에 도달하면 `ROOM_SUMMARY_TRIGGER`를 자동 적재한다.
- `ROOM_AUTO_QUESTION_INTERVAL_MINUTES` 경과 시 `ROOM_QUESTION_TRIGGER`를 자동 적재한다.
- 이벤트 전달은 at-least-once다. 소비 측(OpenClaw)은 `eventId` 기준으로 중복 제거한다.
- NDJSON에는 메시지 본문 전문을 저장하지 않고 메타데이터만 다룬다.

## 개발/검증 명령
- `npm run lint`
- `npm run typecheck`
- `npm test`

## 필독 문서 우선순위
1. `JEWAN_DEV_CONSTITUTION.md`
2. `STANDARDS.md`
3. `SLACK_COMMAND_ENGINEERING_STANDARDS.md`
4. `AGENTS.md`
5. `docs/reviewer/PR_REVIEW_POLICY.md`
6. `docs/reviewer/CODEX_FINAL_REVIEW_CHECKLIST.md`
7. `.github/copilot-instructions.md`
8. `.github/codex-instructions.md`
9. `.github/PULL_REQUEST_TEMPLATE.md`

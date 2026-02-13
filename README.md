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
- `/room start`
- `/room launch`
- `/room stop`
- `/room help`
- OpenClaw 연동 v1
  - 실시간 답변: Slack thread 메시지 -> OpenClaw HTTP -> Slack thread 답장
  - 수명 관리: `ROOM_MODE_ON`/`ROOM_MODE_OFF` + TTL 자동 종료
  - 백그라운드 보조: outbox -> NDJSON 디스패치(복구/자동화)

미구현(2차):
- `/room status`
- `/room decide <A|B|C>`
- 실 LLM 연동 (현재 `launch`는 스텁 라운드)

## 런타임/기술
- Node.js 20+
- TypeScript
- Slack Bolt + Socket Mode
- SQLite (`sqlite3` + `sqlite`)

## 수행 주체 모델
- 명령 요청자: Slack에서 커맨드를 입력하는 사람(기본: 형)
- 오케스트레이터: 택배(검정 고양이 형님, 커맨드 파싱/상태 전이/실행 조율)
- 워커 실행자: 소포들(하얀 고양이 팀, 분석/후보안/검증 작업 담당)
- 최종 결정자: 형(최종 선택/확정 권한)

## 필독 문서
기본은 `AGENTS.md`의 Core allowlist만 읽고 시작합니다. (충돌 해결 우선순위도 `AGENTS.md` 참고)

Docs(Core 5):
- `docs/README.md`
- `docs/ROOM_FLOW.md`
- `docs/decision/DECISION_LOG.md`
- `docs/owner/PROJECT_TODO.md`
- `docs/developer/COMMAND_SPEC.md`

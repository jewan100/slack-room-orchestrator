# COMMAND_SPEC (/room)

`/room`은 Slack Slash Command로 회의(아이디어 회의실) 세션을 제어합니다.

## 상태(요약)
- `IDLE` -> `PREPARED` -> `RUNNING` -> `DECIDED`

## 서브커맨드(MVP)
- `/room start`: 준비 스레드 생성 + 세션을 `PREPARED`로 시작
- `/room launch`: 실행 스레드 생성 + 세션을 `RUNNING`으로 전환
- `/room stop`: 세션을 `DECIDED`로 종료 + planning mode OFF
- `/room help`: 사용법 안내

## 2차 예정
- `/room status`: 진행 상태 조회
- `/room decide <A|B|C>`: 최종 결정 저장

## 참조
- 흐름: `docs/ROOM_FLOW.md`
- 규칙/UX: `SLACK_COMMAND_ENGINEERING_STANDARDS.md`
- 기준선: `docs/decision/DECISION_LOG.md`

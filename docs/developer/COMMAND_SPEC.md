# COMMAND_SPEC

이 문서는 Slack Slash Command 기반 오케스트레이션 서버에서
**`/room` 도메인(1차 vertical slice)** 의 서브커맨드 스펙을 정의한다.

상위 목표는 택배/소포 에이전트를 Slash Command로 제어하는 범용 서버이며,
`/room`은 그 목표를 검증하는 첫 구현 범위다.

## 문서 운영 원칙
- 기존 기획은 유지하고, 변경사항은 누적 방식으로 추가한다.
- 상태 표기는 `구현 완료`, `2차 예정`으로 구분한다.
- 큰 방향 변경은 `docs/decision/DECISION_LOG.md`에 기록한다.

## 커맨드 수행 주체 정의
- **명령 요청자(Command Requester)**: Slack에서 Slash Command를 입력하는 사람(기본: 형).
- **오케스트레이터(Command Orchestrator)**: 입력된 명령을 해석하고 실행 흐름을 조율하는 택배.
- **워커 실행자(Worker Executors)**: 택배가 트리거한 작업(분석/후보안 생성/검증)을 수행하는 소포들.
- **최종 결정자(Decision Owner)**: 최종 선택/확정 권한을 가진 사람(기본: 형).

## 표현 원칙 (택배/소포)
- 택배와 소포는 단순한 로봇 표현이 아니라, 실제 고양이 캐릭터 주체로 다룬다.
- 문서에서 택배/소포의 책임은 명확하게 쓰되, 톤은 딱딱하지 않게 유지한다.

## 권한/책임 경계
- 명령 입력은 요청자가 한다.
- 명령 처리와 상태 전이는 택배가 책임진다.
- 후보안 생성/보조 실행은 소포가 담당한다.
- 최종 결정 확정은 결정자만 수행한다. (`/room decide` 2차 범위)
- 서버는 결정을 "추천/요약"할 수 있지만 "강제 확정"하지 않는다.

## 커맨드 모델
- Slack 등록 커맨드: `/room` (단일)
- 파싱 규칙: `command.text`의 첫 토큰을 서브커맨드로 해석
- 지원(1차): `start`, `launch`, `stop`, `help`
- 확장(2차): `status`, `decide`

## 범용 확장 관점
- `/room` 외 도메인은 별도 command module로 확장한다.
- 각 도메인은 동일한 진입 패턴(파싱 -> validator -> service -> repository -> adapter)을 따른다.
- 공통 운영 규칙(로그/에러/타입/보안)은 루트 표준 문서(`STANDARDS.md`)를 따른다.

## 상태 모델
- `IDLE`: 활성 세션 없음
- `PREPARED`: `/room start` 완료
- `RUNNING`: `/room launch` 완료
- `DECIDED`: `/room stop` 또는 `/room decide` 완료

## 공통 규칙
- Slack Slash Command는 **3초 내 ack**가 없으면 Slack이 자동으로 실패 처리할 수 있다.
- `/room`은 어떤 입력이든 **ack을 최우선**으로 처리한다.
- Slash 응답은 "진행 UI"다. 실제 결과는 **스레드에만** 남긴다.
- Slash 응답 UX는 **1회 호출당 ephemeral 1개**만 남긴다.
- fast-path: `invalid/help`는 **ack 1회로 최종 안내**를 반환하고 종료한다.
- 정상 명령(`start/launch/stop`): **ack 1회로 "처리 중"**을 표시하고 post-ack에서 실행한다.
- 성공 시: `delete_original`을 **best-effort**로 시도한다(실패해도 추가 보정 메시지는 보내지 않는다).
- 실패 시: `replace_original`로 "처리 중"을 **에러로 교체**한다.
- 에러는 공통 포맷과 에러코드를 사용한다.
- 영속 저장소는 SQLite를 사용한다.

---

## 1) `/room start` (구현 완료)

### 목적
회의 준비 세션을 만들고 브리핑 템플릿을 저장한다.

### 수행 주체
- 입력: 명령 요청자(형)
- 실행 조율: 택배
- 보조 실행: 없음 (필요 시 후속 라운드에서 소포 참여)

### 처리
1. 활성 세션 존재 여부 확인
2. `ROOM_START_CHANNEL_ID`에 준비 스레드 생성
3. 세션 상태를 `PREPARED`로 저장
4. 브리핑 기본 템플릿 저장
5. planning watch target ON 등록 + `ROOM_MODE_ON` outbox enqueue
6. 택배가 스레드 첫 메시지에서 회의 목표/제약/완료기준을 질문

### 결과
- 상태: `PREPARED`
- 다음 액션: `/room launch`

### 실패
- 활성 세션 이미 존재

---

## 2) `/room launch` (구현 완료)

### 목적
실행 스레드를 열고 워커 라운드(스텁)를 시작한다.

### 수행 주체
- 입력: 명령 요청자(형)
- 실행 조율: 택배
- 보조 실행: 소포 (현재 1차는 스텁 라운드)

### 처리
1. 현재 세션이 `PREPARED`인지 검증
2. `ROOM_LAUNCH_CHANNEL_ID`에 실행 스레드 생성
3. 스텁 후보안 `A/B/C` 생성 및 저장
4. 세션 상태를 `RUNNING`으로 전이
5. planning watch target OFF 전환 + `ROOM_MODE_OFF(offReason=LAUNCH)` outbox enqueue

### 결과
- 상태: `RUNNING`
- 라운드: `1`
- 다음 액션: `/room status` (2차)

### 실패
- 활성 세션 없음
- 상태 전이 불가(`PREPARED` 아님)

---

## 3) `/room stop` (구현 완료)
- 입력: 명령 요청자(형)
- 실행 조율: 택배
- 역할: 현재 활성 세션을 강제 종료하고 planning 감시를 즉시 중단

### 처리
1. 시작 채널 기준 활성 세션 조회
2. 세션 상태를 `DECIDED`로 전이(`decided_option=NULL`)
3. planning watch target OFF 전환
4. `ROOM_MODE_OFF(offReason=MANUAL)` outbox enqueue

### 결과
- 상태: `DECIDED`
- 다음 액션: `/room start`

### 실패
- 활성 세션 없음

---

## 4) `/room help` (구현 완료)
- 입력: 명령 요청자(형)
- 실행 조율: 택배
- 역할: 지원되는 `/room` 명령과 옵션을 즉시 안내

### 처리
1. 서비스/DB 접근 없이 사용법 본문을 즉시 반환
2. invalid 응답의 버튼과 동일한 도움말 내용을 제공

### 결과
- `/room start`
- `/room launch`
- `/room stop`
- `/room help`

---

## 5) `/room status` (2차 예정)
- 입력: 명령 요청자(형)
- 실행 조율: 택배
- 역할: 진행 상태/라운드/후보안/미해결 이슈 조회

## 6) `/room decide <A|B|C>` (2차 예정)
- 입력: 최종 결정자(형)
- 실행 조율: 택배
- 역할: 최종 선택 저장 + 상태 `DECIDED` 전환 + 후속 액션 생성

---

## 에러 코드
- `ROOM_NO_ACTIVE_SESSION`
- `ROOM_ALREADY_RUNNING`
- `ROOM_INVALID_STATE_TRANSITION`
- `ROOM_INVALID_COMMAND`
- `ROOM_INTERNAL_ERROR`

---

## OpenClaw 연동 v1 (구현 완료)

### 실시간 라우팅 계약 (v1 우선순위)
- Slack 메시지 입력은 `slack-room-orchestrator`가 소유한다.
- `message` 이벤트가 들어오면 `room_watch_targets`를 조회해 아래 조건을 동시에 만족할 때만 실시간 답변을 생성한다.
  - `status='ON'`
  - `channel_id` 일치
  - `thread_ts` 일치
- 실시간 답변은 OpenClaw OpenAI 호환 HTTP API(`POST /v1/chat/completions`)로 생성한다.
- OpenClaw 세션 키는 `x-openclaw-session-key=room:{sessionId}` 규칙으로 고정한다.
- 응답 모드는 non-stream 단일 완료 응답이다.
- 시작 채널 기준 활성 planning room은 1개만 허용한다.
- launch/TTL 레이스 방지를 위해 게시 직전에 ON 상태를 재검증한다.
- OpenClaw 호출 실패 시 thread에 안내를 1회 게시하고, 비동기 재시도를 수행한다.

### 이벤트 프로토콜
- 타입: `ROOM_MODE_ON`, `ROOM_MODE_OFF`, `ROOM_QUESTION_TRIGGER`
- 공통 필드: `eventId`, `eventType`, `sessionId`, `channelId`, `threadTs`, `topic`, `state`, `occurredAt`, `version`
- OFF 전용 필드: `offReason` (`LAUNCH` | `TTL` | `MANUAL`)
- 보안 규칙: 이벤트/DB/NDJSON에는 메시지 본문 전문을 저장하지 않는다.

### 수명 규칙
- ON 시점: `/room start` 성공 직후
- OFF 시점:
  - `/room launch` 성공 직후 `offReason=LAUNCH`
  - `/room stop` 성공 직후 `offReason=MANUAL`
  - planning 스레드에 `ROOM_MODE_TTL_MINUTES` 동안 메시지가 없으면 watch target OFF + 세션 `DECIDED` 종료 + 스레드 종료 안내를 수행

### 자동 트리거 규칙
- question: `ROOM_AUTO_QUESTION_INTERVAL_MINUTES` 주기로 due 대상 enqueue

### 전달/복구
- 서버는 outbox에 이벤트를 적재하고, 디스패처가 `OPENCLAW_EVENTS_FILE_PATH` NDJSON로 append한다.
- 전달 보장은 at-least-once다.
- 서버 재시작 시 pending outbox는 재디스패치된다.

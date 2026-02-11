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
- 지원(1차): `start`, `summary`, `launch`
- 확장(2차): `status`, `decide`

## 범용 확장 관점
- `/room` 외 도메인은 별도 command module로 확장한다.
- 각 도메인은 동일한 진입 패턴(파싱 -> validator -> service -> repository -> adapter)을 따른다.
- 공통 운영 규칙(로그/에러/타입/보안)은 루트 표준 문서(`STANDARDS.md`)를 따른다.

## 상태 모델
- `IDLE`: 활성 세션 없음
- `PREPARED`: `/room start` 완료
- `RUNNING`: `/room launch` 완료
- `DECIDED`: `/room decide` 완료(2차)

## 공통 규칙
- `ack()`는 즉시 호출한다.
- 응답은 기본적으로 "현재 상태 + 다음 액션"을 포함한다.
- 에러는 공통 포맷과 에러코드를 사용한다.
- 영속 저장소는 SQLite를 사용한다.

---

## 1) `/room start <topic>` (구현 완료)

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

### 결과
- 상태: `PREPARED`
- 다음 액션: `/room summary` 또는 `/room launch`

### 실패
- `topic` 누락
- 활성 세션 이미 존재

---

## 2) `/room summary [--brief|--full]` (구현 완료)

### 목적
현재 세션의 브리핑/라운드 정보를 요약한다.

### 수행 주체
- 입력: 명령 요청자(형)
- 실행 조율: 택배
- 보조 실행: 소포 결과(저장된 라운드 데이터)가 있으면 집계 반영

### 옵션
- `--brief` (기본값)
- `--full`

### 처리
1. 활성 세션 조회
2. 브리핑 정보 조회
3. 최신 라운드 조회(있으면 포함)
4. 요약 텍스트 반환

### 결과
- `PREPARED` 상태에서는 `/room launch`를 다음 액션으로 안내
- `RUNNING` 상태에서는 `/room status`(2차)를 안내

### 실패
- 활성 세션 없음
- 옵션 파싱 오류

---

## 3) `/room launch` (구현 완료)

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

### 결과
- 상태: `RUNNING`
- 라운드: `1`
- 다음 액션: `/room status` (2차)

### 실패
- 활성 세션 없음
- 상태 전이 불가(`PREPARED` 아님)

---

## 4) `/room status` (2차 예정)
- 입력: 명령 요청자(형)
- 실행 조율: 택배
- 역할: 진행 상태/라운드/후보안/미해결 이슈 조회

## 5) `/room decide <A|B|C>` (2차 예정)
- 입력: 최종 결정자(형)
- 실행 조율: 택배
- 역할: 최종 선택 저장 + 상태 `DECIDED` 전환 + 후속 액션 생성

---

## 에러 코드
- `ROOM_MISSING_TOPIC`
- `ROOM_NO_ACTIVE_SESSION`
- `ROOM_ALREADY_RUNNING`
- `ROOM_INVALID_STATE_TRANSITION`
- `ROOM_INVALID_COMMAND`
- `ROOM_INTERNAL_ERROR`

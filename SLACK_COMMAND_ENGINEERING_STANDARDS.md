# SLACK_COMMAND_ENGINEERING_STANDARDS.md

> 목적: Slack command 도메인에서 필요한 **도메인 특화 규칙**만 정의한다.
> 전역 코드 스타일 상세 규칙은 `JEWAN_DEV_CONSTITUTION.md`를 단일 원본으로 따른다.

## 0) 적용 범위
- 이 문서는 Slack command 도메인 아키텍처/워크플로우/운영 규칙에만 집중한다.
- 가독성/SRP/네이밍/주석/복잡도 등 전역 스타일 항목은 재정의하지 않는다.

---

## 1) 도메인 아키텍처 규칙

- Runtime: **TypeScript + Node.js (LTS)**
- Slack: **Bolt + Socket Mode**
- DB: **SQLite(MVP) -> Postgres(확장)**
- 구조: Adapter / Service / Repository 분리
- 외부 연동(LLM, Search, Slack API)은 Adapter 계층으로 분리

### 1.1 책임 분리 (도메인)
- `commands/`: Slack 명령 파싱 및 진입점
- `services/`: 유스케이스 오케스트레이션 (`start`, `summary`, `launch`, `status`, `decide`)
- `repositories/`: DB CRUD
- `adapters/`: Slack/LLM/외부 API 연동

---

## 2) Slack 워크플로우 표준

### 2.1 채널 라우팅 표준 (설정 기반)
- `/room start`: `ROOM_START_CHANNEL_ID`(또는 `ROOM_START_CHANNEL_NAME`) 채널 스레드
- `/room launch`: `ROOM_LAUNCH_CHANNEL_ID`(또는 `ROOM_LAUNCH_CHANNEL_NAME`) 채널 스레드
- 환경별 채널 ID/이름은 환경변수로 주입하고 코드/문서에 하드코딩하지 않는다.

### 2.2 명령 세트 (MVP)
- `/room start <topic>`
- `/room summary`
- `/room launch`
- `/room status`
- `/room decide <A|B|C>`

### 2.3 상태 전이 원칙
- `IDLE -> PREPARED -> RUNNING -> DECIDED`
- 허용되지 않는 전이는 에러코드로 명시적으로 거부
- 상태 전이는 저장소에 영속화되어야 하며 재시작 후 복구 가능해야 함

### 2.4 주체 모델
- 명령 요청자: 형
- 오케스트레이터: 택배
- 워커 실행자: 소포
- 최종 결정자: 형

---

## 3) 에러/응답 규격 (도메인)

### 3.1 에러 포맷
```json
{
  "error": {
    "code": "ROOM_LAUNCH_FAILED",
    "message": "launch failed"
  }
}
```

### 3.2 성공 포맷
```json
{
  "data": { }
}
```

### 3.3 규칙
- 에러코드 필수
- 임의 포맷 금지
- 원인 로그에 `errorCode` 반드시 포함

---

## 4) DB/상태 보존 규칙

- 상태 영속화 대상
  - room session
  - start briefing 문맥
  - launch round 결과
  - 최종 decision
  - reminder 등록 상태
- 마이그레이션 필수
- 재시작 후 복구 시나리오 테스트 필수
- `idempotency_key`로 중복 이벤트 방지

---

## 5) 로깅/관측성 규칙 (도메인 필드)

기본 원칙:
- 개발 친화 로그(debug/info/warn/error) 사용
- 민감정보 마스킹 필수
- 디버깅/에러 추적을 위한 충분한 컨텍스트 기록
- 고빈도 호출 구간은 샘플링/집계 로그 허용

필수 로그 필드:
- `requestId`
- `sessionId`
- `channelId`
- `threadTs`
- `command`
- `elapsedMs`
- `errorCode` (오류 시)

금지:
- 토큰/API 키/민감정보 원문 로그 출력

---

## 6) 테스트 전략 (도메인 시나리오)

- Given/When/Then 구조
- 핵심 유스케이스 우선
  - start 스레드 생성
  - launch 스레드 생성
  - round 진행
  - decision 저장
  - reminder 등록
- 실패 시나리오 포함
  - Slack API 실패
  - LLM timeout
  - DB lock/retry

---

## 7) 이식/백업 표준 (도메인)

백업 단위는 반드시 세트로 관리:
1. 코드
2. DB 파일
3. 마이그레이션 버전
4. `.env`(비밀은 별도 안전 저장)
5. 런타임 버전 정보(Node/OpenClaw)

복구 목표:
- 다른 환경에서 30분 내 재기동
- start/launch 커맨드 재현 가능

---

## 8) 참조
- 전역 스타일/품질 단일 원본: `JEWAN_DEV_CONSTITUTION.md`
- 전역 강제 요약/프로세스: `STANDARDS.md`

# ROOM_ENGINEERING_STANDARDS.md

> 목적: Slack 기반 아이디어 회의실 오케스트레이터 프로젝트의 개발 표준을 중앙화하여,
> 확장성과 이식성을 유지하고 장기 운영 시 품질을 보장한다.

## 0) 최우선 원칙

1. **이식성 우선**: 로컬/N100/다른 서버에서 동일 동작해야 한다.
2. **확장성 우선**: 명령/워크플로우 추가 시 기존 구조를 깨지 않는다.
3. **영속성 보장**: 재시작/이전 후에도 상태와 히스토리가 유지된다.
4. **추적 가능성**: 누가/언제/무엇을 실행했는지 로그로 남아야 한다.

---

## 1) 아키텍처 원칙

- Runtime: **TypeScript + Node.js (LTS)**
- Slack: **Bolt + Socket Mode**
- DB: **SQLite(MVP) → Postgres(확장)**
- 구조: Adapter / Service / Repository 분리
- 외부 연동(LLM, Search, Slack API)은 Adapter 계층으로 분리

### 1.1 책임 분리
- `commands/`: Slack 명령 파싱 및 진입점
- `services/`: 유스케이스(briefing, launch, decide, reminder)
- `repositories/`: DB CRUD
- `adapters/`: Slack/LLM/외부 API 연동

---

## 2) 코딩 규칙

### 2.0 스타일 우선순위
- **가독성 최우선**
- 파라미터 출처가 드러나는 명시적 호출 스타일 선호
- 코드 포맷팅(줄바꿈/정렬/미적 일관성) 필수
- 코드 depth 들쑥날쑥 금지

### 2.1 제어 흐름
- Guard clause(조기 반환) 우선
- `else` 최소화
- 중첩 분기/중첩 반복 최소화

### 2.2 네이밍 (엄격)
- 동사 시작 함수명 사용 (`createRoomSession`, `launchDebate`)
- 도메인 용어 통일: `session`, `briefing`, `launch`, `round`, `decision`
- 약어 남용 금지
- 네이밍만 봐도 컴포넌트/클래스 역할이 즉시 파악되어야 함
- 네이밍 규칙 위반은 PR 차단 대상

### 2.3 SRP(단일 책임) 강제
- 함수 1개 = 책임 1개
- 서비스는 유스케이스 오케스트레이션 책임만 가짐
- 유효성 검증은 별도 `validator` 컴포넌트로 분리
- 공통 검증 규칙은 전역 재사용 가능 구조로 설계

### 2.4 타입 안정성
- `any` 금지
- 입력/출력 타입 명시
- API 응답 타입 접미어 `Response` 사용

### 2.5 상수/중복
- 매직넘버/매직스트링 상수화
- 공통 로직은 util/service로 추출

---

## 3) 에러/응답 규격

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
- idempotency_key로 중복 이벤트 방지

---

## 5) Slack 워크플로우 표준

### 5.1 채널 라우팅 고정
- `/room start`: `택배-비서` 채널 스레드
- `/room launch`: `아이디어-회의실` 채널(`C0ADRCT09DK`) 스레드

### 5.2 명령 세트 (MVP)
- `/room start <topic>`
- `/room summary`
- `/room launch`
- `/room status`
- `/room decide <A|B|C>`

### 5.3 AI 토론 방식
- AI-1/AI-2 역할 고정 금지
- 둘 다 발산/반박/검증 교차 수행
- 최종 결정은 사용자(형)

---

## 6) 로깅/관측성 규칙

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

## 7) 보안/비밀 관리

- `.env` 커밋 금지
- `.env.example`만 커밋
- 키는 환경변수/시크릿 매니저 사용
- Slack signature 검증 필수

---

## 8) Git/PR/CI 규칙

### 8.0 브랜치 전략 (엄격)
- `main` 직접 작업 금지
- `develop`을 기본 브랜치로 사용
- 기능 개발은 `feat/*` 브랜치에서만 수행
- 멀티 에이전트 병렬 개발 시 `git worktree` 사용 권장

### 8.1 커밋
- Conventional Commits 사용 (`feat:`, `fix:`, `docs:`, `chore:`...)
- 한 커밋 = 한 의도

### 8.2 PR
- 목적/변경점/검증방법 필수
- DB 변경 시 마이그레이션+롤백 설명 필수
- AI 리뷰 필수
- CI 통과 전 머지 금지

### 8.3 CI
- lint
- typecheck
- test
- CI 실패 시 머지 금지

### 8.4 병렬 개발/통합 규칙
- 에이전트는 담당 영역(폴더/기능)을 사전에 명시
- 공통 파일 변경은 통합 담당 승인 하에 진행
- 통합 담당 AI(Integrator)가 최종 정리/머지 담당
- 충돌 방지를 위해 작은 PR 단위 유지 + 자주 rebase

---

## 9) 테스트 전략

- Given/When/Then 구조
- 초기 개발 단계: **B 전략**(핵심 + 경계/예외)
- 마무리/다중 연동 단계: **C 전략**(통합/E2E 필수 승격)
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

## 10) 이식/백업 표준

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

## 11) 금지 사항

- else 난무 코드
- 컨트롤러/핸들러 비대화
- any 남용
- 에러 응답 포맷 임의 변경
- 민감정보 로그 출력
- 문서/스키마 미갱신 상태로 기능 머지

---

## 11.1) 기술 도입 심사 규칙 (강제)

신규 기술/라이브러리 도입 전 아래 항목 문서화 필수:
1. 도입 필요성
2. 대안(최소 2개)
3. 트레이드오프
4. 동작 원리
5. 기술의 원래 목적/사용 맥락
6. 유사 기술 비교

추가 규칙:
- 승인 없는 신규 의존성 도입 금지
- 버전 고정 필수 (`latest` 금지)

---

## 11.2) 문서화 원칙 (강제)

- 모든 의사결정은 문서화 대상
- "나중에 하자" 같은 보류 결정도 backlog/decision log에 기록
- 문서 없는 결정은 없는 결정으로 간주

필수 문서:
- `README.md`
- `ARCHITECTURE.md`
- `ADR/*`
- 명령/API 문서
- 운영 Runbook
- CHANGELOG (SemVer)

---

## 12) 작업 체크리스트

### 시작 전
- 요구사항/가정 명시
- 변경 범위 확정
- 실패 케이스 정의

### 종료 전
- 타입/린트/테스트 통과
- 로그/에러코드 점검
- 문서 업데이트
- 이식성 체크(경로/환경 의존성 제거)

# DECISION LOG (Baseline)

목적: 지금 프로젝트를 움직이는 "유효 기준선"만 남깁니다.

운영:
- 항목은 최대 8개만 유지합니다.
- 같은 주제는 새 항목 추가 대신 기존 항목을 갱신합니다.
- 영향이 끝난 결정은 삭제합니다. (Git 히스토리에 남음)

## D-001 (2026-02-10) `/room` 2단계 흐름
- 영향: 커맨드 워크플로우
- 결정:
  - `/room start` = 준비(`PREPARED`)
  - `/room launch` = 실행(`RUNNING`)
- 상태: 유효

## D-002 (2026-02-11) MVP 1차 범위/기술 고정
- 영향: 런타임/연동/저장소/공개 인터페이스
- 결정:
  - 런타임: TypeScript + Node.js
  - Slack 연동: Bolt + Socket Mode
  - 커맨드 모델: 단일 `/room` + 서브커맨드
  - 1차 범위: `start`, `launch`, `stop`, `help`
  - 저장소: SQLite
  - `launch` AI 라운드: 스텁
- 상태: 유효

## D-003 (2026-02-11) 주체 모델/운영
- 영향: 문서 정책/권한 경계/Owner 운영
- 결정:
  - 수행 주체: `명령 요청자/택배/소포/최종 결정자`
  - 최종 결정 권한은 사용자(형)에게 유지합니다.
  - Owner 트래킹은 `docs/owner/PROJECT_TODO.md` 단일 문서로 운영합니다.
- 상태: 유효

## D-004 (2026-02-11) Slash UX + 에러/상태 정합 규칙 고정
- 영향: inbound adapter, 서비스 에러 처리, 로그
- 결정:
  - Slack ack 제약(3초): 어떤 입력이든 ack을 최우선으로 처리합니다.
  - Slash UX: 1회 호출당 ephemeral 1개만 남깁니다.
  - 성공: `delete_original` best-effort, 실패: `replace_original` 1회로 교체합니다.
  - 에러 교체 책임은 inbound adapter 1곳으로 고정합니다. (서비스/핸들러는 throw만)
  - 핵심 단계와 후속 알림 단계를 분리합니다. (후속 실패는 부분 성공)
  - 상태 전이는 원자 선점 + 보상(롤백) 경로를 강제합니다.
  - 선점 실패/unique 충돌은 도메인 에러코드로 매핑합니다.
- 상태: 유효

## D-005 (2026-02-11) OpenClaw 연동 v1(실시간 우선) 고정
- 영향: `/room` 유스케이스, Slack message 이벤트 수집, DB 스키마, 운영 env
- 결정:
  - watch target 판별은 SQLite(`room_watch_targets`)로 수행합니다.
  - 실시간 답변 생성은 OpenClaw OpenAI 호환 HTTP API(`POST /v1/chat/completions`)를 사용합니다.
  - 세션 연속성 키는 `x-openclaw-session-key=room:{sessionId}`로 고정합니다.
  - outbox -> NDJSON 디스패치는 at-least-once로 운영합니다. (consumer는 `eventId` 중복 제거)
  - 메시지 본문 전문은 이벤트/DB/NDJSON에 저장하지 않습니다.
- 상태: 유효

## D-006 (2026-02-13) `/room launch` 멀티 역할(Builder/Critic) 호출 구조
- 영향: launch 서비스, LLM 연동 어댑터
- 결정:
  - `/room start`는 Launch Brief(압축 입력)만 준비합니다.
  - `/room launch`에서만 멀티 모델(Builder/Critic)을 호출합니다. (기본 1라운드)
  - launch 결과는 모델 원문 2개 덤프가 아니라 Final Memo 1개로 남깁니다.
  - 프롬프트는 레포에 저장하지 않고 외부(벤더 콘솔/Agent 설정 등)에서 관리합니다.
- 상태: 유효

## D-006A (2026-02-13) 종료 UX 최소화(스레드 중심)
- 영향: 회의 종료 UX, 채널 노이즈, 기록 위치
- 결정:
  - 종료(`/room stop`/TTL)는 planning 스레드에 1줄 종료 안내만 남깁니다.
  - 채널 본문 공지/요약은 v1 범위에서 제외합니다.
- 상태: 유효

## D-008 (2026-02-13) AI 워커 4원칙 채택
- 영향: 작업 방식/리뷰 운영
- 결정:
  - Think Before Coding / Simplicity First / Surgical Changes / Goal-Driven Execution
  - 상세 스타일 단일 원본은 `JEWAN_DEV_CONSTITUTION.md`를 유지합니다.
- 상태: 유효

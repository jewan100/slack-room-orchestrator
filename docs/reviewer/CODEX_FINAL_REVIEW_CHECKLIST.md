# CODEX_FINAL_REVIEW_CHECKLIST.md

## 목적
머지 직전, Codex가 전체 변경을 최종 검증한다.

## 체크 항목

### 1) 기능 정합성
- [ ] 요구사항 대비 누락 기능 없음
- [ ] start/launch/status/decide 흐름 연결 정상

### 2) 아키텍처/책임 분리
- [ ] SRP 위반 없음
- [ ] service/validator/adapter/repository 경계 준수
- [ ] 외부 연동은 adapter로 분리됨

### 3) 코드 품질
- [ ] 네이밍 규칙 준수(역할 명확)
- [ ] 가독성/포맷팅 일관성
- [ ] any 사용 없음

### 4) 안정성/에러 처리
- [ ] 에러 응답 형식 통일
- [ ] 에러코드 누락 없음
- [ ] 예외 처리 일관성

### 5) 보안/로그
- [ ] 민감정보 로그 노출 없음
- [ ] requestId/elapsedMs 등 추적 필드 존재

### 6) 테스트/CI
- [ ] lint 통과
- [ ] typecheck 통과
- [ ] 테스트(단위/통합) 통과

### 7) 문서/추적
- [ ] PR 본문 한글 상세 작성
- [ ] CHANGELOG/ADR/DECISION_LOG 반영
- [ ] 후속 TODO/리스크 문서화

## 결과 분류
- PASS: 즉시 머지 가능
- CONDITIONAL: 경미 수정 후 머지
- BLOCK: 머지 금지, 수정 필수

# STANDARDS.md

이 문서는 모든 프로젝트에서 공통 적용되는 전역 개발 표준의 **강제 요약/프로세스 문서**다.

## 단일 원본 원칙
- 코드 스타일 상세 규칙의 단일 원본은 `JEWAN_DEV_CONSTITUTION.md`다.
- 이 문서는 구현 강제 절차와 운영 규칙만 요약한다.
- 스타일 상세 항목을 이 문서에서 중복 정의하지 않는다.

## 핵심 원칙 (요약)
1. 가독성/명시성/SRP 우선
2. 이식성/확장성 우선
3. 추적 가능한 개발(문서/로그/PR)
4. 규칙 예외는 문서화(ADR) 필수

## 구현 강제 규칙
- `main` 직접 작업 금지, `develop` 기본
- `develop` 직접 작업/커밋/푸시 금지(사용자 명시 승인 시에만 예외)
- 저장소에 `develop`이 없으면 작업 시작 전에 생성하고 default branch로 지정
- 기능 브랜치: `feat/` prefix 사용
- 브랜치명: `prefix/actual-name-vN` 형식
- `actual-name`: 영어 소문자/하이픈
- `vN`: 같은 기능 반복 작업 차수 (`v1`, `v2`, `v3` ...)
- 날짜/이슈번호는 현재 필수 아님
- 모든 변경은 기능 브랜치에서 작업 후 PR로 반영
- 커밋/푸시 전 사용자 확인 필수
- PR + AI 리뷰 + CI 통과 전 머지 금지
- PR/커밋 관련 메시지는 한글 우선
- PR 본문은 기능 목적/변경점/검증 내용을 상세 작성
- 모든 의사결정/보류사항 문서화

## 코드 품질 강제 기준
- lint/typecheck/test 통과 필수
- `any` 금지, `latest` 금지
- 민감정보 로그 금지
- 상세 코드 스타일 기준은 `JEWAN_DEV_CONSTITUTION.md` 준수

## 문서 기본 세트 (필수)
- README
- ARCHITECTURE
- ADR
- API/Command 문서
- RUNBOOK
- CHANGELOG

## 참조
- `JEWAN_DEV_CONSTITUTION.md` (코드 스타일 단일 원본)

# DEVELOPER_STANDARDS_GUIDE

이 문서는 개발자/워커를 위한 **프로젝트 작업 가이드 요약**이다.

## 단일 소스 오브 트루스 (필수)
- 전역 강제 요약/프로세스의 단일 소스는 루트의 `STANDARDS.md`다.
- 코드 스타일 상세 규칙의 단일 소스는 `JEWAN_DEV_CONSTITUTION.md`다.
- 규칙 변경은 `JEWAN_DEV_CONSTITUTION.md` 또는 `STANDARDS.md`에서 먼저 수정한다.

## 이 문서의 역할
- 프로젝트 맥락에서 자주 참고하는 규칙을 요약한다.
- 루트 규칙과 충돌하는 규칙을 새로 정의하지 않는다.

## 핵심 요약
- 기본 브랜치: `develop`
- 기능 브랜치: `feat/` prefix (예: `feat/add-login-api-v1`)
- 브랜치명: `prefix/actual-name-vN` 형식
- `actual-name`: 영어/소문자/하이픈
- `vN`: 같은 기능 반복 작업 차수 (`v1`, `v2`, `v3` ...)
- 날짜/이슈번호는 현재 필수 아님
- `develop` 직접 작업/커밋/푸시 금지(사용자 명시 승인 시에만 예외)
- 모든 변경은 기능 브랜치 + PR로 반영
- 커밋/푸시 전 사용자 확인 필수
- PR/커밋 메시지: 한글 우선
- lint/typecheck/test 통과 전 머지 금지
- 코드 스타일 상세(독자 친화형+맥락형 주석/복잡도/함수 길이/비동기 안전성)는 `JEWAN_DEV_CONSTITUTION.md` 기준 적용
- 사용자 노출 문구/에러 문구는 중앙 카탈로그에서 관리

## 참조
- `STANDARDS.md`
- `JEWAN_DEV_CONSTITUTION.md`
- `SLACK_COMMAND_ENGINEERING_STANDARDS.md`

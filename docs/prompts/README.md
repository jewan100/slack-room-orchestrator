# Prompts

이 폴더는 **회의실(room) 오케스트레이션 중 `room launch` 단계에서만** 쓰는 전용 프롬프트를 보관한다.

원칙:
- 프롬프트는 확정본이 아니며, 실험/개선 전제를 가진다.
- `room start`는 사람(제완)↔택배의 대화/정리 단계이고, **모델 호출 프롬프트는 `room launch`에서만 사용**한다.
- `room start` 결과는 `Launch Brief`(압축 입력)로만 전달한다.
- 모델별 역할(Builder vs Critic)을 분리하여 품질을 안정화한다.
- 다른 제품/봇에서 재사용 가능한 형태를 유지하되, 이 폴더의 파일은 **회의(launch) 전용**임을 명시한다.

구성:
- `common_system.md`: 두 모델에 공통으로 적용할 규칙/출력 포맷
- `launch_brief_template.md`: room start 산출물(압축 입력) 템플릿
- `gpt_builder.md`: GPT(Builder/Ideator) 역할 프롬프트
- `claude_critic.md`: Claude(Critic/Editor) 역할 프롬프트
- `moderator_merge.md`: 택배(Moderator)가 두 결과를 합본으로 편집할 때의 가이드

Tip:
- 실제 호출 시에는 `common_system` + `role_prompt` + `launch_brief` 3조합을 사용.
- 토큰 폭주 방지: 아이디어 뱅크 원문 전체를 넣지 말고, 관련 항목만 요약해 brief에 포함.

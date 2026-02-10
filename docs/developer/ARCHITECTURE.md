# ARCHITECTURE

## 원칙
- 내부: layered
- 외부 연동: adapter 경계

## 디렉토리
- commands/
- services/
- validators/
- repositories/
- adapters/inbound
- adapters/outbound

## 워크플로우
1. `/room start <topic>`
2. `/room launch`
3. `/room decide`

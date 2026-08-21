# Project Agent Index

작업을 시작하기 전에 다음 순서로 읽는다.

1. `FOUNDATION.md` — 공통 규칙과 규칙 ID
2. `PROJECT.md` — 현재 프로젝트의 명령, 아키텍처, 예외, 성능 예산
3. 작업 경로에 더 가까운 `AGENTS.md` — 해당 하위 영역의 추가 지침

규칙 우선순위는 시스템·도구 보안 정책, 현재 사용자의 명시적 요청, 프로젝트 규칙, Foundation 기본값 순서다. 공통 규칙 본문을 이 파일에 복사하지 않는다.

기본 검증:

```text
node scripts/foundation.mjs verify --base origin/main
```

구조나 디자인 패턴 변경 전에는 `architecture-selection` Skill로 후보와 파일 증가량을 비교하고 사용자 승인을 받는다.
일반 구현 변경에는 `change-workflow` Skill로 기존 구현·타입·SCSS 자산 검색, 파일 생성 근거, 의존성 검토, 테스트와 최종 diff 검토를 수행한다.

# Project Agent Index

작업을 시작하기 전에 다음 순서로 읽는다.

1. `FOUNDATION.md` — 공통 규칙과 규칙 ID
2. `PROJECT.md` — Observed·Inferred·Unverified Intake, 아키텍처, 예외, 성능 예산
3. `.foundation/project.json` — 활성 Page·Capability와 실행 명령
4. 서비스 공정·고객 행동·DB·보안·배포 작업이면 `.foundation/service-workflow.json` — 실행 가능한 단일 원본
5. 작업 경로에 더 가까운 `AGENTS.md` — 해당 하위 영역의 추가 지침

규칙 우선순위는 시스템·도구 보안 정책, 현재 사용자의 명시적 요청, 프로젝트 규칙, Foundation 기본값 순서다. 공통 규칙 본문을 이 파일에 복사하지 않는다.

서비스 워크플로우를 바꿀 때는 JSON의 modules·objects·stages·transitions·database·securityGates·releaseVersioning을 함께 검증한다. `docs/service-workflow-canvas.html`은 해당 JSON을 동적으로 표시하는 읽기 전용 화면이므로 업무 내용이나 연결선을 HTML에 직접 복제하지 않는다.

기본 검증:

```text
node scripts/foundation.mjs verify --base origin/main
```

구조나 디자인 패턴 변경 전에는 `architecture-selection` Skill로 후보와 파일 증가량을 비교하고 사용자 승인을 받는다.
일반 구현 변경에는 `change-workflow` Skill로 기존 구현·타입·SCSS 자산 검색, 파일 생성 근거, 의존성 검토, 테스트와 최종 diff 검토를 수행한다.
새 PHP 사이트·페이지·Capability 구성에는 `site-starter` Skill로 선행 정보를 분류하고 plan/apply 절차를 사용한다.

완료 보고는 실제 파일·공식 source ID·명령 종료 코드·테스트 결과만 증거로 사용한다. 확인하지 못한 내용은 `Unverified`로 남기며 실행하지 않은 검사를 성공했다고 말하지 않는다.

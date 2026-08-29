# Project Foundation Project Rules

## Identity

- Project: project-foundation
- Foundation version: 2.0.3
- Runtime: Foundation CLI는 Node, 생성되는 소비 애플리케이션은 PHP
- Active profiles: core, github, docker, php, web, assets, typescript, scss
- Owner: @DevCrop

## Project Intake

### Observed

- 사용자는 Foundation 저장소를 공개 MIT Template로 배포하도록 명시했다.
- 소비 프로젝트는 PHP가 HTML을 렌더링하고 Vite는 SCSS·TypeScript asset만 빌드한다.
- 기본 서버 구성은 Nginx와 PHP-FPM이다.
- 공통 규칙 본문은 `FOUNDATION.md`, 프로젝트 결정은 `PROJECT.md`가 소유한다.
- Codex를 1순위로 사용하고 Cursor, Claude는 같은 규칙과 Skill 원본을 읽는다.
- 파일·폴더는 독립 책임이나 경계가 확인될 때만 생성한다.
- 서비스 제작 공정은 `.foundation/service-workflow.json` 하나를 기계·LLM·Canvas가 함께 읽는 단일 원본으로 사용한다.

### Inferred

- 일반 퍼블리싱, 기능형 사이트, 3D 카탈로그는 동일한 PHP 웹 기반에서 Capability만 다르게 활성화할 수 있다.
- 120개 canonical scenario와 mutation 검사가 에이전트 문맥 손실과 구조 이탈을 발견하는 최종 회귀 기준이 된다.

### Unverified

- GitHub 보안 기능과 ruleset의 계정별 지원 여부는 인증 후 `github plan`으로 확인해야 한다.
- Cursor GUI와 Claude `/context`의 실제 로딩 결과는 각 도구가 설치·인증된 환경에서 최종 확인해야 한다.
- production 성능 예산은 실제 소비 프로젝트 측정 전에는 숫자로 확정하지 않는다.
- Codex Security CI 활성화 여부는 계정 접근 권한과 `CODEX_SECURITY_API_KEY`를 확인한 뒤 결정한다.

## Commands

```text
npm ci
npm test
npm run build
node scripts/foundation.mjs validate --strict
node scripts/foundation.mjs verify --base origin/main
```

## Architecture

Foundation은 의존성 없는 단일 Node CLI가 프로젝트 정보를 분석해 PHP 웹 seed와 활성 Capability만 생성하는 정책 엔진으로 구성한다. 최대 확장 모델은 catalog에 보관하지만 소비 프로젝트에는 필요한 파일만 만든다.

승인된 기본 구조는 HTTP 표현 경계의 최소 MVC다. Symfony HttpFoundation과 Routing을 standalone component로 사용하고 Foundation 전용 Router·Request·Response·Container는 만들지 않는다. 단순 페이지는 `config/pages.php`와 공통 PageController가 처리하고, 서버 행위가 생긴 기능만 feature Controller로 확장한다.

서비스 제작 자동화는 다음 세 모듈로 분리한다.

1. Architecture Governance — 객체 책임, SOLID, DB 정규화, Port·Adapter, 보안 게이트와 변경 절차
2. Delivery Workflow — 고객 유입부터 요구사항 정규화, 설계, 디자인, 개발, 컨펌, 배포, 이력화까지의 상태 전환
3. Release & Versioning — `main`·`prod` 보호, Preview 검증, 동일 artifact 승격, 버전·증거·rollback

세 모듈의 실행 가능한 계약은 `.foundation/service-workflow.json`이 소유한다. `docs/service-workflow-canvas.html`은 JSON을 읽어 그리는 읽기 전용 투영이며 업무 내용이나 화살표를 HTML에 직접 기록하지 않는다. Stage는 서로 직접 호출하지 않고 Orchestrator가 명시된 transition과 gate만 평가한다. 공급자 변경은 기존 Port의 Adapter 추가로 처리하고 도메인 객체의 책임은 유지한다.

`main`은 기본 통합 브랜치, `prod`는 첫 운영 승인 시 한 번 만드는 운영 일치 브랜치다. 최초 release workflow는 두 브랜치의 존재와 보호 상태를 검사해 없는 브랜치만 멱등하게 생성·보호한다. 작업 브랜치 PR → `main` → Preview/UAT → 승인된 동일 commit·artifact digest → `prod` → Production 순으로 승격한다. 두 브랜치는 보호하고 force push를 금지하며, rollback은 이력을 되감지 않고 이전 immutable tag에서 새 patch release를 만든다. 실제 GitHub ruleset·Codex Security·호스팅 자동화는 각 계정과 Adapter를 확인하기 전까지 계획 상태로 둔다.

## Type Ownership

CLI 내부 계약은 검증 함수나 catalog에서 한 번만 소유한다. 소비 프로젝트의 PHP·TypeScript 타입은 해당 개념 module이 소유하며 전역 catch-all 타입 파일은 만들지 않는다.

## Styling

SCSS 공통 entry는 `resource/scss/main.scss` 하나이며 `@use` 조립만 담당한다. 현재 section shell은 layouts, card는 components가 소유한다. 추가 abstract·base·components·layouts·pages 파일은 실제 책임이 생길 때만 만들고, 페이지 entry는 main이나 다른 페이지 entry를 import하지 않는다.

## Docker

- Runtime contract: `.foundation/project.json`
- Services: Nginx `web`, PHP-FPM `php`; Vite 개발 서버는 필요할 때 호스트에서 실행
- Application port: 소비 프로젝트가 Intake에서 확정, 기본 seed는 8080
- PHP production: Composer no-dev optimized autoload와 OPcache
- Asset production output: `public/build/`

## Performance Budgets

Foundation은 공통 숫자를 강제하지 않는다. 첫 production 측정 후 다음 항목의 기준값과 허용 회귀율을 이곳에 기록한다.

- Production image size: not measured
- Cold build time: not measured
- Cached build time: not measured
- Container readiness time: not measured

## Exceptions

현재 Foundation 규칙 예외 없음.

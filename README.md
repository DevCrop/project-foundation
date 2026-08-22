# Project Foundation

PHP 8.2 웹사이트를 위한 공통 규칙, 최소 파일 생성, SCSS·TypeScript·Vite, Nginx·PHP-FPM Docker, GitHub 운영과 AI 에이전트 검증을 제공하는 공개 MIT Template다. Foundation CLI만 Node를 사용하며 소비 애플리케이션 런타임은 PHP 8.2로 고정한다.

Foundation은 최대 파일 구조를 복사하지 않는다. 프로젝트 정보를 먼저 분류하고 승인된 Page만 명시적으로 추가한다. Capability는 동일 상태에 묶인 SHA-256 계획을 승인받은 뒤 원자적으로 적용한다.

## 먼저 제공해야 하는 정보

새 프로젝트든 기존 프로젝트든 다음 정보를 먼저 제공한다. 모르는 값은 추측해서 채우지 말고 `Unverified`로 남긴다.

1. 프로젝트명, 담당자, GitHub owner와 저장소 visibility
2. 사이트 목적과 사용자 유형
3. 페이지 목록, URL, 각 페이지의 서버 기능
4. 제공된 디자인·이미지·Figma와 반응형 기준
5. 공통 component 후보와 페이지 전용 영역
6. 폼·인증·관리 UI·API·DB·업로드·결제·메일·CMS 여부
7. motion·pin·Three.js·KTX2·DRACO 등 복잡한 interaction 여부
8. 외부 공급자, 공식 API 문서, credential 책임자
9. 지원 브라우저·접근성·SEO 요구
10. Docker port, 배포 대상, secret 주입 방식, rollback 조건
11. 이미지 크기·빌드·시작·readiness·프런트 성능 예산
12. 기존 프로젝트라면 실제 install·lint·test·build·start 명령과 lockfile

정보 상태는 다음처럼 기록한다.

- `Observed`: 실제 파일, 디자인, 공식 문서, 실행 결과에서 확인
- `Inferred`: 관찰 사실에서 도출했지만 사용자가 아직 확정하지 않음
- `Unverified`: 확인되지 않아 구현 근거로 사용할 수 없음

필수 정보가 `Unverified`인 구조·외부 연동·보안 변경은 plan까지만 만들고 apply하지 않는다.

## 권장 작업 프로세스

```text
Intake 작성
→ 저장소·디자인·기존 자산 조사
→ 프로젝트 유형과 Capability 분류
→ 최소 구조 후보·대안·파일 증가량 보고
→ 사용자 승인
→ plan SHA 생성
→ 동일 상태에서 apply
→ validate·verify·evidence
→ PR stable checks
→ ruleset 병합
```

에이전트의 설명은 증거가 아니다. 완료 판단에는 실제 파일·해시·공식 source ID·명령 종료 코드·테스트·API 응답만 사용한다.

## Codex 작업 요청 계약

Codex에 구현을 맡기기 전에 목표, 제외 범위, 실제 입력 파일·디자인, 페이지·URL, 필요한 서버 기능, 선택 Capability, 배포 조건, 성능 예산과 승인 경계를 전달한다. 값이 없으면 Codex가 임의로 채우지 않고 `Unverified`로 기록한다.

```text
Goal: 이번 작업이 끝났을 때 관찰 가능한 결과
Out of scope: 이번 작업에서 만들지 않을 것
Observed inputs: 저장소 경로, 디자인, API 공식 문서, 실제 실행 명령
Pages and capabilities: 페이지·route·form·auth·DB·payment·three·motion 등
Constraints: 런타임, 파일 생성 제한, 기존 type·SCSS API, 보안·성능 조건
Unverified: 아직 결정되지 않은 항목
Approval boundary: plan만 허용할지 apply까지 허용할지
Acceptance: 실행해야 할 validate·test·build·Docker·브라우저 검사
```

Codex는 구현 전에 Intake gate를 먼저 보고한다. 보고에는 `Observed`, `Inferred`, `Unverified`, 차단 결정, 재사용할 기존 경로, 생성이 필요한 경로와 이유, 실행할 검증이 들어가야 한다. 구조·외부 연동·보안 경계가 미확인이면 코드를 생성하지 않고 질문 또는 plan에서 멈춘다. 이것은 에이전트의 추론을 사실로 인정하는 규칙이 아니라 추론을 검증 가능한 상태와 사용자 승인에 묶는 Project Foundation Policy다.

## 새 프로젝트

```text
node scripts/foundation.mjs init --profile web,assets,typescript,scss,docker,github --project-name my-project --owner github-login
node scripts/foundation.mjs doctor
node scripts/foundation.mjs validate --strict
node scripts/foundation.mjs verify --base origin/main
```

기본 결과는 PHP PageController, 순수 PHP View, SCSS 공통 entry, TypeScript 공통 entry, Vite asset manifest, Nginx·PHP-FPM Compose와 GitHub stable checks다. DB·결제·Three.js 같은 기능 파일은 생성하지 않는다.

## 기존 프로젝트 도입

```text
node path/to/project-foundation/scripts/foundation.mjs adopt plan --profile web,typescript,scss,docker,github --project-name my-project --owner github-login
node path/to/project-foundation/scripts/foundation.mjs adopt apply --plan-sha <sha256> --confirm
node scripts/foundation.mjs validate --strict
```

`adopt plan`은 기존 PHP 구조, Composer·npm lockfile, page·asset entry, Dockerfile과 workflow 충돌을 조사한다. 충돌 파일은 자동 덮어쓰지 않는다. 계획 후 파일 상태가 하나라도 달라지면 SHA가 무효화된다.

## 페이지 추가

서버 동작이 없는 페이지는 전용 Controller를 만들지 않는다.

```text
node scripts/foundation.mjs page add sub-1 --path /sub-1 --title "Sub 1" --scss --typescript
node scripts/foundation.mjs validate --strict
node scripts/foundation.mjs architecture render
```

페이지 ID `sub-1`의 선택 파일은 다음과 같다.

```text
resource/views/pages/sub-1.php
resource/scss/pages/sub-1.scss   # --scss일 때만
resource/ts/pages/sub-1.ts       # --typescript일 때만
```

`config/pages.php`가 route, View와 asset entry의 단일 runtime 원본이다.

## Capability 추가

```text
node scripts/foundation.mjs capability plan three
node scripts/foundation.mjs capability apply three --plan-sha <sha256> --confirm three
```

초기 catalog는 publishing, form, auth, admin-ui, api, mysql, upload, payment, mail, cache, queue, search, i18n, cms, three, motion, analytics, seo를 제공한다. 각 항목은 trigger, requires, conflicts, 추가 파일, 의존성, 보안·성능·테스트·제거 조건을 가진다.

catalog에 없는 요구는 자동으로 비슷한 기능에 끼워 맞추지 않는다. `unknown capability`로 보고하고 공식 출처, 후보 구조, 파일 증가량과 테스트를 승인받은 뒤 catalog를 확장한다.

## PHP·View·HTML

MVC는 HTTP 표현 경계에만 적용한다. Symfony HttpFoundation과 Routing component를 사용하며 Foundation 전용 Router·Request·Response·service locator를 만들지 않는다.

기본 section shell은 다음 순서를 사용하되 내용이 없는 요소는 출력하지 않는다.

```text
section
└─ container
   └─ inner
      ├─ section-header (optional)
      │  ├─ eyebrow (optional)
      │  ├─ section-title (optional)
      │  └─ section-body (optional)
      └─ section-contents
         └─ reusable components or page content
```

View는 전달된 표시 데이터만 렌더링한다. DB·외부 API·권한 결정·상태 변경은 View에서 금지하며 동적 값은 문맥에 맞게 escape한다.

## SCSS·TypeScript·Vite

`resource/scss/main.scss`는 공통 module을 `@use`로 조립만 하며 selector 구현을 두지 않는다. abstract·base·components·layouts·pages 폴더는 실제 첫 책임 파일이 생길 때만 만든다. 페이지 SCSS는 main이나 다른 페이지 entry를 import하지 않는다.

TypeScript는 공통 초기화, 페이지 entry, 독립 수명주기 feature로만 나눈다. listener·observer·RAF·animation·WebGL 자원을 만드는 feature는 mount와 destroy를 함께 제공한다. Three.js의 KTX2·DRACO loader는 실제 압축 asset이 있을 때만 활성화한다.

Vite는 PHP가 HTML을 렌더링하는 backend integration으로 사용한다. 개발 중에는 승인된 Vite origin을 사용하고 production에서는 `public/build/.vite/manifest.json`에서 해시 asset을 해석한다.

## 공개 CLI

```text
foundation.mjs init [--profile ...] [--project-name ...] [--owner ...]
foundation.mjs adopt plan|apply
foundation.mjs page add <slug> --path <path> --title <title> [--scss] [--typescript]
foundation.mjs capability list|plan|apply
foundation.mjs architecture render
foundation.mjs validate [--strict]
foundation.mjs verify [--base <ref>] [--scope all|policy|project|dependency]
foundation.mjs evidence add --status <status> --statement <text> [--source-file <path>|--source-url <url>]
foundation.mjs evidence audit
foundation.mjs container verify|image|config
foundation.mjs run <configured-command>
foundation.mjs doctor
foundation.mjs update [--version <version>]
foundation.mjs agent context
foundation.mjs github plan --repo <owner/name>
foundation.mjs github apply --repo <owner/name> --confirm <owner/name>
```

원격 visibility는 보존한다. Foundation 저장소 공개 전환처럼 사용자가 정확한 저장소를 승인한 경우에만 별도 `--make-public`을 사용한다.

## 문서와 설정 소유권

- [FOUNDATION.md](FOUNDATION.md): 공통 규칙 본문의 유일한 원본
- [PROJECT.md](PROJECT.md): 프로젝트 Intake, 결정, 예외, 예산
- `.foundation/project.json`: 실행 명령, Page·Capability 상태, Docker·GitHub 설정
- `.foundation/capabilities.json`: 선택 기능 catalog
- `.foundation/recipes/*.json`: 다섯 개 영역의 분석 질문과 규칙 인덱스
- [SOURCES.json](SOURCES.json): 공식 출처와 확인 날짜
- `.foundation/manifest.json`: 설치 버전, 파일 소유권, managed SHA-256
- `ARCHITECTURE.md`: 실제 설정에서 생성되는 읽기 전용 구조·UML 인덱스
- `AGENTS.md`, `CLAUDE.md`, Cursor Rule: 원본을 복제하지 않는 adapter

`ARCHITECTURE.md`를 직접 편집하지 않는다. `architecture render`가 실제 page, Capability, 의존성에서 다시 생성하고 drift를 검출한다.

## Codex → Cursor → Claude

Codex는 짧은 `AGENTS.md`, `.agents/skills`, 신뢰된 `.codex/hooks.json`을 사용한다. SessionStart는 시작·재개·clear·compact 때 현재 Intake와 Capability를 주입한다. PreToolUse는 저장소 탈출·파괴 명령·승인되지 않은 구조 생성을 조기 차단하고 Stop은 verify 실패 시 한 번만 작업을 계속시킨다. Hook은 완전한 강제 계층이 아니므로 CI가 최종 차단한다.

Cursor는 `AGENTS.md`, `.agents/skills`, Always Apply Rule의 `@FOUNDATION.md`와 `@PROJECT.md`를 사용한다. Claude는 `CLAUDE.md`가 세 문서를 import하고 Skill wrapper가 `.agents/skills` 원본으로 라우팅한다.

## Docker와 Make

Docker는 Composer dependency, asset, PHP test, PHP development, PHP production, Nginx production stage를 분리한다. base는 tag와 digest를 함께 고정하고 production은 non-root·OPcache·healthcheck·최소 산출물을 사용한다.

`node scripts/foundation.mjs container verify`는 build check와 세 production target을 검증한 뒤 임시 project name과 임시 host port로 Compose를 기동한다. health·페이지·해시 asset·immutable cache·non-root를 확인하고 검증용 컨테이너와 네트워크를 자동 제거한다.

Compose 기본 서비스는 `web`, `php`다. Vite 개발 서버가 필요하면 호스트에서 `npm run dev`를 실행하고 승인된 localhost origin만 PHP에 전달한다. MySQL·Redis는 활성 Capability가 있을 때만 추가한다. 기본 `down`은 volume·image·데이터를 삭제하지 않는다.

```text
make help
make doctor
make validate
make test
make build
make image
make config
make up
make watch
make down
make logs
make ps
make release-check
```

GNU Make가 없어도 Node·Composer·npm·Docker Compose 원본 명령으로 같은 작업을 실행할 수 있다.

## GitHub 강제 계층

required check 이름은 런타임·버전과 무관하게 고정한다.

```text
foundation-policy
project-quality
container
dependency-gate
```

PR에는 적용 PF 규칙, 새 파일 책임, 의존성 검토, 실제 검증 결과, 생략 검사와 남은 위험을 기록한다. Actions는 전체 commit SHA, 최소 token permission, timeout, concurrency를 사용하며 `pull_request_target`과 PR secret을 금지한다.

## 업데이트와 릴리스

```text
node scripts/foundation.mjs update --version 2.0.0
node scripts/foundation.mjs verify --base origin/main
```

업데이트는 정식 Release 자산, 경로, 크기, 버전과 SHA-256을 검증한다. managed 파일이 수정됐으면 다운로드 전에 전체를 중단하고 `PROJECT.md`, `.foundation/project.json`, Page·Capability 설정과 다른 seed 파일을 덮어쓰지 않는다. 같은 메이저의 Release tarball은 이전 updater가 읽을 수 있는 Git tree archive로 만들고 실제 immutable Release에서 update를 시험한다. Dependency 검증은 애플리케이션용 Composer 설정에 맞춰 `composer validate --strict --no-check-publish`와 `composer audit --locked`를 각각 실행한다.

메이저 버전 변경은 런타임·Docker·의존성 같은 프로젝트 소유 seed 계약이 달라질 수 있으므로 자동 update하지 않는다. v1에서 v2로 이동할 때는 PHP를 8.2.33으로 명시적으로 전환하고 Composer lock·Docker image를 다시 검증한 뒤 새 Foundation을 도입한다. 승인된 migration 없이 실행한 update는 파일을 바꾸기 전에 중단한다.

정식 릴리스는 12개 그룹의 canonical scenario 120개, mutation 검사, PHP 8.2.33, Docker build·health, agent adapter, GitHub ruleset과 31일 이내 공식 출처를 모두 증명해야 한다. GitHub Release는 draft에 자산과 체크섬을 먼저 올린 뒤 불변 상태로 게시한다.

## 공식 기준

외부 동작은 [SOURCES.json](SOURCES.json)의 공급자 공식 문서만 근거로 한다. SOLID, 파일 생성 게이트, 최소 MVC, Capability와 Evidence 절차는 `Project Foundation Policy`로 구분한다.

## 라이선스

[MIT](LICENSE)

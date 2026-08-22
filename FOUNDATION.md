# Project Foundation Rules

이 문서는 공통 규칙 본문의 유일한 원본이다. 외부 도구의 공식 동작은 `SOURCES.json`의 출처 ID를 사용하고, Foundation이 선택한 설계 판단은 `policy:project-foundation`으로 구분한다.

## 규칙 형식

- `Level`: `MUST`, `SHOULD`, `MAY`
- `Profiles`: 규칙이 적용되는 활성 프로필
- `Authority`: 공식 출처 ID 또는 `policy:project-foundation`
- `Trigger`: 규칙을 적용하기 시작하는 관찰 가능한 조건
- `Do`: 허용되는 기본 행동
- `Don't`: 금지되는 행동
- `Exception`: `yes` 또는 `no`
- `Enforced by`: `validator`, `hook`, `ci`, `github`, `review`
- `Evidence`: 완료를 증명하는 기계 결과 또는 `judgment:`로 시작하는 판단 근거
- `Rule`: 중복 검사용 한 문장 규칙 본문

## Core

### PF-CORE-001 — 요청 범위

- Level: MUST
- Profiles: core
- Authority: policy:project-foundation
- Trigger: 파일·설정·원격 상태를 변경하려는 경우
- Do: 현재 사용자가 승인한 목표와 변경 계획 안에서만 작업한다.
- Don't: 유용해 보인다는 이유로 별도 기능·정리·공개 전환을 추가하지 않는다.
- Exception: no
- Enforced by: review, ci
- Evidence: judgment:요청과 변경 경로의 대응표
- Rule: 승인된 목표와 변경 계획을 벗어난 작업을 수행하지 않는다.

### PF-CORE-002 — 사용자 변경 보존

- Level: MUST
- Profiles: core
- Authority: policy:project-foundation
- Trigger: 기존 프로젝트를 수정하거나 Foundation을 도입하는 경우
- Do: 작업 전 상태와 충돌 파일을 조사하고 기존 내용을 보존한다.
- Don't: 사용자 파일을 자동 덮어쓰기·초기화·정리하지 않는다.
- Exception: no
- Enforced by: validator, ci, review
- Evidence: 상태 SHA와 변경 전후 경로 목록
- Rule: 기존 프로젝트의 사용자 소유 변경은 명시적 승인 없이 교체하지 않는다.

### PF-CORE-003 — 규칙 우선순위

- Level: MUST
- Profiles: core
- Authority: codex-agents-md
- Trigger: 둘 이상의 지침이 같은 행동을 다르게 요구하는 경우
- Do: 시스템·도구 보안 정책, 현재 사용자 요청, `PROJECT.md`와 하위 지침, Foundation 순으로 적용한다.
- Don't: 낮은 우선순위 문서로 높은 우선순위 요청을 무효화하지 않는다.
- Exception: no
- Enforced by: review
- Evidence: judgment:충돌한 지침과 선택 근거
- Rule: 지침 충돌은 정해진 우선순위와 더 가까운 프로젝트 범위에 따라 해결한다.

### PF-CORE-004 — 선행 정보

- Level: MUST
- Profiles: core
- Authority: policy:project-foundation
- Trigger: 새 프로젝트 생성 또는 기존 프로젝트 도입 계획을 확정하는 경우
- Do: 필수 Project Intake 항목을 `Observed`, `Inferred`, `Unverified`로 분류한다.
- Don't: 미확인 포트·페이지·외부 API·인증·배포 조건을 사실로 채우지 않는다.
- Exception: no
- Enforced by: validator, ci
- Evidence: `.foundation/project.json`의 intake 상태와 plan SHA
- Rule: 필수 선행 정보가 확인되지 않은 구조 변경은 적용 단계로 진행하지 않는다.

## Evidence and uncertainty

### PF-EVIDENCE-001 — 진술 등급

- Level: MUST
- Profiles: core
- Authority: policy:project-foundation
- Trigger: 저장소나 외부 시스템에 관한 판단을 기록하는 경우
- Do: 확인된 사실은 `Observed`, 사실에서 도출한 판단은 `Inferred`, 확인하지 못한 내용은 `Unverified`로 기록한다.
- Don't: 추론과 미확인 내용을 관찰 사실처럼 표현하지 않는다.
- Exception: no
- Enforced by: validator, ci, review
- Evidence: evidence JSON의 `observed`, `inferred`, `unverified`
- Rule: 중요한 작업 진술은 관찰·추론·미확인 상태를 명시해야 한다.

### PF-EVIDENCE-002 — 증거 출처

- Level: MUST
- Profiles: core
- Authority: policy:project-foundation
- Trigger: 규칙 준수나 완료를 주장하는 경우
- Do: 실제 파일·해시·공식 출처·명령 결과·테스트·API 응답을 근거로 사용한다.
- Don't: 에이전트의 설명이나 의도만을 증거로 인정하지 않는다.
- Exception: no
- Enforced by: validator, ci
- Evidence: evidence JSON의 source와 artifact 참조
- Rule: 완료 증거는 에이전트의 자기 보고가 아니라 독립적으로 확인 가능한 결과여야 한다.

### PF-EVIDENCE-003 — 완료 주장

- Level: MUST
- Profiles: core
- Authority: policy:project-foundation
- Trigger: 작업·검사·릴리스를 완료했다고 보고하는 경우
- Do: 실행한 명령, 종료 코드, 생략 검사와 남은 위험을 기록한다.
- Don't: 실행하지 않았거나 일부만 실행한 검사를 전체 성공으로 보고하지 않는다.
- Exception: no
- Enforced by: hook, ci
- Evidence: command result와 completion audit
- Rule: 실행 증거가 없는 검증은 완료 판정에 사용할 수 없다.

### PF-EVIDENCE-004 — 공식 출처 최신성

- Level: MUST
- Profiles: core
- Authority: policy:project-foundation
- Trigger: 외부 도구 동작을 영구 규칙이나 릴리스 기준으로 사용하는 경우
- Do: 해당 공급자의 공식 문서와 확인 날짜를 `SOURCES.json`에 기록한다.
- Don't: 블로그·포럼·기억만으로 도구 규칙을 추가하지 않는다.
- Exception: no
- Enforced by: validator, ci
- Evidence: source ID와 31일 이내 verifiedAt
- Rule: 외부 동작에 의존하는 규칙은 최신 공식 출처 레지스트리에 연결되어야 한다.

## Git and history

### PF-GIT-001 — 작업 브랜치

- Level: MUST
- Profiles: github
- Authority: github-rulesets
- Trigger: 기본 브랜치에 병합할 변경을 시작하는 경우
- Do: 허용된 소문자 유형 브랜치에서 하나의 논리 변경을 작업한다.
- Don't: 보호된 기본 브랜치에서 직접 구현하거나 force push하지 않는다.
- Exception: yes
- Enforced by: ci, github
- Evidence: branch name과 ruleset 결과
- Rule: 기본 브랜치 변경은 허용된 작업 브랜치와 PR을 통해서만 병합한다.

### PF-GIT-002 — 이력 단위

- Level: MUST
- Profiles: github
- Authority: policy:project-foundation
- Trigger: 커밋 또는 PR을 만드는 경우
- Do: Conventional Commit 제목과 하나의 논리적 변경 단위를 사용한다.
- Don't: 서로 독립적인 기능·정리·의존성 갱신을 한 PR에 섞지 않는다.
- Exception: yes
- Enforced by: ci, github, review
- Evidence: PR 제목·diff·squash 결과
- Rule: 커밋과 PR은 검토 가능한 단일 목적을 가져야 한다.

### PF-GIT-003 — 릴리스 일치

- Level: MUST
- Profiles: github
- Authority: semantic-versioning
- Trigger: `v*` 태그나 정식 Release를 생성하는 경우
- Do: tag, package, manifest, CHANGELOG와 checksum 버전을 일치시킨다.
- Don't: 이동 가능한 태그나 검증되지 않은 Release 자산을 배포하지 않는다.
- Exception: no
- Enforced by: validator, ci, github
- Evidence: release check와 자산 SHA-256
- Rule: 정식 릴리스의 모든 버전 표기와 체크섬은 동일한 불변 버전을 가리켜야 한다.

### PF-GIT-004 — 불변 릴리스 게시

- Level: MUST
- Profiles: github
- Authority: github-immutable-releases
- Trigger: 정식 GitHub Release와 자산을 게시하는 경우
- Do: draft Release를 만들고 모든 자산과 체크섬을 업로드한 뒤 마지막 단계에서 게시한다.
- Don't: 자산이 없는 Release를 먼저 게시하거나 게시된 불변 Release의 자산을 교체하지 않는다.
- Exception: no
- Enforced by: validator, ci, github
- Evidence: Release API의 `immutable: true`와 자산 digest
- Rule: 정식 GitHub Release는 draft에 자산을 완성한 뒤 불변 상태로 게시해야 한다.

### PF-GIT-005 — 업데이트 자산 호환성

- Level: MUST
- Profiles: github
- Authority: git-archive
- Trigger: 이전 Foundation 버전이 읽을 정식 업데이트 archive를 만드는 경우
- Do: 같은 메이저의 지원 중인 updater가 읽을 수 있는 tree archive를 만들고 실제 이전 Release에서 update를 시험한다. 메이저가 바뀌면 seed migration을 자동 적용하지 않고 원자적으로 중단한다.
- Don't: 현재 parser의 자체 생성 fixture만으로 배포 archive 호환성을 선언하거나 메이저 변경에서 프로젝트 소유 seed를 덮어쓰지 않는다.
- Exception: no
- Enforced by: validator, ci
- Evidence: 같은 메이저 immutable Release의 update 성공 또는 이전 메이저 immutable Release의 무변경 중단 smoke test
- Rule: 같은 메이저 업데이트 archive는 실제 지원 중인 이전 Release parser와 호환되어야 하며 메이저 변경은 승인된 seed migration 없이 자동 적용하지 않아야 한다.

## Security

### PF-SEC-001 — 비밀값

- Level: MUST
- Profiles: core
- Authority: github-actions-security
- Trigger: 토큰·비밀번호·키·운영 환경값을 사용하는 경우
- Do: 승인된 secret 저장소와 런타임 주입을 사용한다.
- Don't: 소스·로그·`.env.example`·Docker ARG·PR 출력에 실제 값을 기록하지 않는다.
- Exception: no
- Enforced by: validator, ci, github
- Evidence: secret scan과 변경 파일 검사
- Rule: 비밀값은 저장소와 빌드 기록에 평문으로 남아서는 안 된다.

### PF-SEC-002 — 외부 입력

- Level: MUST
- Profiles: php, web
- Authority: php-pdo-prepare
- Trigger: HTTP·파일·DB·외부 API 입력을 소비하는 경우
- Do: 입력 경계에서 형식·크기·허용값을 검증하고 문맥에 맞게 출력한다.
- Don't: SQL·HTML·경로·명령 문자열에 검증되지 않은 값을 결합하지 않는다.
- Exception: no
- Enforced by: validator, ci, review
- Evidence: 경계 테스트와 정적 검사
- Rule: 신뢰되지 않은 입력은 검증·매개변수화·문맥별 출력 처리 없이 사용하지 않는다.

### PF-SEC-003 — 세션과 요청 위조

- Level: MUST
- Profiles: php, web
- Authority: php-session-security
- Trigger: 인증 상태나 상태 변경 HTTP 요청을 처리하는 경우
- Do: 안전한 cookie 설정, 세션 ID 회전, CSRF 검증과 서버 권한 검사를 적용한다.
- Don't: UI 노출 여부나 클라이언트 값만으로 권한을 승인하지 않는다.
- Exception: no
- Enforced by: ci, review
- Evidence: 인증·세션·CSRF 실패 테스트
- Rule: 인증 상태와 변경 요청은 서버에서 세션·권한·CSRF를 검증해야 한다.

### PF-SEC-004 — 최소 권한

- Level: MUST
- Profiles: core, docker, github
- Authority: github-actions-security
- Trigger: 프로세스·컨테이너·워크플로 권한을 설정하는 경우
- Do: 필요한 최소 사용자·capability·token permission만 허용한다.
- Don't: root, privileged, host network, Docker socket, write-all token을 기본값으로 사용하지 않는다.
- Exception: yes
- Enforced by: validator, ci, github
- Evidence: 구성 검사와 승인된 예외
- Rule: 실행 환경과 자동화는 필요한 범위보다 넓은 권한을 기본으로 갖지 않는다.

## Agent integration

### PF-AGENT-001 — 단일 규칙 원본

- Level: MUST
- Profiles: core
- Authority: policy:project-foundation
- Trigger: 에이전트 지침·Skill·Rule을 추가하거나 수정하는 경우
- Do: 공통 본문은 `FOUNDATION.md`에만 두고 어댑터는 참조와 절차만 가진다.
- Don't: AGENTS·CLAUDE·Cursor·Skill wrapper에 공통 규칙을 복사하지 않는다.
- Exception: no
- Enforced by: validator, ci
- Evidence: 중복 본문 검사
- Rule: 에이전트별 파일은 Foundation 공통 규칙 본문을 복제하지 않는다.

### PF-AGENT-002 — Codex 우선 연결

- Level: MUST
- Profiles: core
- Authority: codex-agents-md
- Trigger: 에이전트 작업 세션을 시작하거나 압축 후 재개하는 경우
- Do: `AGENTS.md`, `PROJECT.md`, 활성 Capability와 검증 명령을 짧게 로드한다.
- Don't: 전체 문서를 Hook 출력에 복제하거나 32KiB 기본 한도를 소진하지 않는다.
- Exception: no
- Enforced by: validator, hook, ci
- Evidence: agent context 출력과 AGENTS 총 byte
- Rule: Codex 작업 문맥은 짧은 계층형 인덱스와 실제 프로젝트 상태에서 구성한다.

### PF-AGENT-003 — Hook 한계

- Level: MUST
- Profiles: core
- Authority: codex-hooks
- Trigger: 프로젝트 Hook으로 변경을 차단하거나 검증하는 경우
- Do: 신뢰 상태를 진단하고 Stop 재진입을 막으며 CI를 최종 강제 계층으로 둔다.
- Don't: Hook이 모든 도구와 환경에서 실행된다고 가정하지 않는다.
- Exception: no
- Enforced by: validator, ci
- Evidence: Hook schema·재진입·비활성 fallback 테스트
- Rule: Codex Hook은 조기 가드레일로만 사용하고 최종 승인은 CI가 담당한다.

### PF-AGENT-004 — 에이전트 동등성

- Level: MUST
- Profiles: core
- Authority: policy:project-foundation
- Trigger: Cursor 또는 Claude 어댑터를 갱신하는 경우
- Do: 동일 원본 문서와 `.agents/skills`로 라우팅한다.
- Don't: 에이전트별로 서로 다른 아키텍처 규칙을 소유하지 않는다.
- Exception: no
- Enforced by: validator, ci
- Evidence: adapter reference와 conformance scenario
- Rule: Codex·Cursor·Claude는 같은 규칙 ID와 프로젝트 결정을 소비해야 한다.

## Architecture and files

### PF-ARCH-001 — 최소 구조

- Level: MUST
- Profiles: core
- Authority: policy:project-foundation
- Trigger: 폴더·계층·디자인 패턴을 새로 도입하는 경우
- Do: 무패턴 선택을 포함해 필요한 후보와 추가 파일 수를 비교한다.
- Don't: 최대 확장 구조를 초기 파일 트리로 생성하지 않는다.
- Exception: yes
- Enforced by: review
- Evidence: judgment:후보·의존성 방향·파일 증가량·제거 조건
- Rule: 관찰된 문제를 해결하는 최소 구조만 사용자 승인 후 도입한다.

### PF-ARCH-002 — MVC 경계

- Level: MUST
- Profiles: php, web
- Authority: policy:project-foundation
- Trigger: PHP HTTP 요청과 응답 흐름을 설계하는 경우
- Do: MVC를 HTTP 표현 경계에 적용하고 도메인·외부 연동은 필요한 기능 안에서 분리한다.
- Don't: 모든 코드를 Controller·Model·View 폴더에 강제로 배치하지 않는다.
- Exception: yes
- Enforced by: review, ci
- Evidence: judgment:요청 흐름과 의존성 그래프
- Rule: MVC는 PHP 웹 표현 계층의 경계이며 전체 시스템의 강제 폴더 분류가 아니다.

### PF-ARCH-003 — 클래스와 함수

- Level: SHOULD
- Profiles: core, php, typescript
- Authority: policy:project-foundation
- Trigger: 새로운 로직 단위를 구현하는 경우
- Do: 상태·불변식·수명주기는 클래스로, 순수 계산·변환은 함수로 표현한다.
- Don't: 네임스페이스 역할만 하는 클래스나 상태 없는 서비스 객체를 자동 생성하지 않는다.
- Exception: yes
- Enforced by: review
- Evidence: judgment:상태·수명주기·함수 순수성 설명
- Rule: 클래스와 함수는 실제 상태와 책임의 성격에 따라 선택한다.

### PF-FILE-001 — 파일 생성 게이트

- Level: MUST
- Profiles: core
- Authority: policy:project-foundation
- Trigger: 새 파일이나 폴더를 생성하는 경우
- Do: 독립 책임·실제 재사용·독립 테스트·배포·보안 경계 중 하나를 기록한다.
- Don't: 예상되는 미래 사용이나 보기 좋은 분류만으로 경로를 추가하지 않는다.
- Exception: yes
- Enforced by: hook, ci, review
- Evidence: plan의 path rationale과 PR 증거
- Rule: 새 경로는 검증 가능한 책임 또는 경계를 증명해야 생성할 수 있다.

### PF-FILE-002 — 추상화 시점

- Level: SHOULD
- Profiles: core
- Authority: policy:project-foundation
- Trigger: 공통 모듈·helper·base class를 만들려는 경우
- Do: 실제 두 번째 사용처 또는 확정된 독립 변경 축을 확인한다.
- Don't: 중복이 발생하기 전에 예측만으로 공통 계층을 만들지 않는다.
- Exception: yes
- Enforced by: review
- Evidence: judgment:사용처 또는 변경 축 목록
- Rule: 공통화는 관찰된 재사용이나 독립 변경 축이 있을 때 수행한다.

## PHP HTTP and View

### PF-PHP-001 — 지원 런타임

- Level: MUST
- Profiles: php
- Authority: php-supported-versions
- Trigger: PHP 버전·문법·CI matrix를 결정하는 경우
- Do: toolchain의 최소 지원 PHP에서 실행되는 문법과 잠금 의존성을 사용한다.
- Don't: EOL PHP나 기본 버전에서만 동작하는 미검증 코드를 병합하지 않는다.
- Exception: yes
- Enforced by: validator, ci
- Evidence: PHP 호환 matrix 결과
- Rule: PHP 코드는 선언된 모든 지원 버전과 platform requirement를 통과해야 한다.

### PF-PHP-002 — Composer 소유권

- Level: MUST
- Profiles: php
- Authority: composer-schema
- Trigger: PHP 클래스나 의존성을 추가하는 경우
- Do: PSR-4 소유 경로와 `composer.lock`을 사용한다.
- Don't: 수동 require 체인·복수 Composer lock·잠금 불일치를 허용하지 않는다.
- Exception: no
- Enforced by: validator, ci
- Evidence: composer validate와 lock 검사
- Rule: PHP 코드와 의존성 해석은 Composer PSR-4 설정과 단일 잠금 파일이 소유한다.

### PF-HTTP-001 — HTTP 구성요소

- Level: MUST
- Profiles: php, web
- Authority: symfony-http-foundation
- Trigger: Request·Response·Router 기능이 필요한 경우
- Do: 검증된 standalone HTTP·Routing component를 조합한다.
- Don't: Foundation 전용 Router·Request·Response·service locator를 새로 구현하지 않는다.
- Exception: yes
- Enforced by: validator, ci, review
- Evidence: composer dependency와 금지 클래스 검사
- Rule: PHP HTTP 기반 기능은 검증된 독립 구성요소를 재사용하고 자체 프레임워크를 만들지 않는다.

### PF-HTTP-002 — 단순 페이지

- Level: MUST
- Profiles: web
- Authority: policy:project-foundation
- Trigger: 서버 동작이 없는 새로운 페이지를 추가하는 경우
- Do: `config/pages.php`와 공통 PageController에 페이지·View·asset을 등록한다.
- Don't: 단순 페이지마다 Controller나 Service를 생성하지 않는다.
- Exception: yes
- Enforced by: validator, ci
- Evidence: page graph와 경로 대응 검사
- Rule: 서버 행위가 없는 PHP 페이지는 공통 페이지 구성에서 선언하고 전용 Controller를 만들지 않는다.

### PF-VIEW-001 — View 순수성

- Level: MUST
- Profiles: php, web
- Authority: policy:project-foundation
- Trigger: PHP View나 layout을 작성하는 경우
- Do: 전달된 표시 데이터와 재사용 component만 조립한다.
- Don't: View에서 DB·외부 API·권한 결정·상태 변경을 실행하지 않는다.
- Exception: no
- Enforced by: validator, ci, review
- Evidence: View 정적 검사와 렌더 테스트
- Rule: PHP View는 표시 데이터의 안전한 렌더링만 담당해야 한다.

### PF-VIEW-002 — 출력 인코딩

- Level: MUST
- Profiles: php, web
- Authority: php-htmlspecialchars
- Trigger: 동적 값을 HTML에 출력하는 경우
- Do: 출력 문맥에 맞는 escape를 적용하고 명시적으로 승인된 안전 HTML만 별도 처리한다.
- Don't: 신뢰되지 않은 값을 raw echo하거나 문자열로 script·style 문맥에 삽입하지 않는다.
- Exception: no
- Enforced by: validator, ci
- Evidence: 악성 입력 렌더 테스트
- Rule: 동적 View 값은 기본적으로 HTML 문맥에 맞게 인코딩해야 한다.

## HTML and assets

### PF-HTML-001 — 의미 구조

- Level: MUST
- Profiles: web
- Authority: html-sections
- Trigger: 페이지나 section markup을 만드는 경우
- Do: 콘텐츠 의미에 맞는 section·article·nav·heading을 선택한다.
- Don't: 스타일링 wrapper를 의미 요소로 오용하거나 제목 계층을 건너뛰지 않는다.
- Exception: yes
- Enforced by: ci, review
- Evidence: semantic HTML·heading·accessibility 검사
- Rule: HTML 구조는 시각적 배치보다 문서 의미와 접근 가능한 제목 계층을 우선한다.

### PF-HTML-002 — 범용 section shell

- Level: SHOULD
- Profiles: web, scss
- Authority: policy:project-foundation
- Trigger: 독립된 콘텐츠 section을 구현하는 경우
- Do: section, container, inner, 선택적 section-header, section-contents 순서로 필요한 요소만 조립한다.
- Don't: eyebrow·title·body 또는 wrapper를 내용이 없는데도 생성하지 않는다.
- Exception: yes
- Enforced by: review, ci
- Evidence: judgment:디자인 section map과 렌더 DOM
- Rule: 공통 section shell은 선택 요소를 허용하며 불필요한 빈 래퍼를 출력하지 않는다.

### PF-ASSET-001 — Backend asset manifest

- Level: MUST
- Profiles: assets, web
- Authority: vite-backend-integration
- Trigger: PHP가 Vite 빌드 asset을 렌더링하는 경우
- Do: development origin 또는 production manifest에서 entry와 의존 asset을 해석한다.
- Don't: 해시된 파일명을 PHP View에 직접 하드코딩하지 않는다.
- Exception: no
- Enforced by: validator, ci
- Evidence: Vite manifest 통합 테스트
- Rule: PHP View의 production asset URL은 Vite manifest가 소유한다.

## TypeScript and interaction

### PF-TYPE-001 — 타입 소유권

- Level: MUST
- Profiles: typescript
- Authority: policy:project-foundation
- Trigger: 공유 타입이나 runtime schema를 정의하는 경우
- Do: 개념을 소유하는 module에서 한 번 정의하고 소비자가 import한다.
- Don't: 거대한 전역 types 파일이나 동일 구조 재정의를 만들지 않는다.
- Exception: yes
- Enforced by: ci, review
- Evidence: type owner와 import graph
- Rule: TypeScript 타입은 개념 소유 모듈에서 한 번만 정의한다.

### PF-TYPE-002 — strict

- Level: MUST
- Profiles: typescript
- Authority: typescript-strict
- Trigger: TypeScript를 컴파일하거나 새 코드를 추가하는 경우
- Do: strict 검사를 통과하고 unknown을 검증 후 좁힌다.
- Don't: 예외 기록 없이 explicit any나 무검증 assertion을 사용하지 않는다.
- Exception: yes
- Enforced by: validator, ci
- Evidence: tsc 결과와 any scan
- Rule: TypeScript는 strict mode와 검증된 타입 좁히기를 사용한다.

### PF-INTERACTION-001 — 수명주기 정리

- Level: MUST
- Profiles: typescript
- Authority: policy:project-foundation
- Trigger: listener·observer·RAF·animation·WebGL 자원을 생성하는 경우
- Do: mount와 destroy 경계를 제공하고 페이지 이탈 시 자원을 해제한다.
- Don't: 전역 초기화만 만들거나 dispose할 수 없는 장기 실행 상태를 남기지 않는다.
- Exception: yes
- Enforced by: ci, review
- Evidence: mount/destroy 및 cleanup 테스트
- Rule: 상태ful 프런트 기능은 생성한 브라우저 자원을 명시적으로 정리해야 한다.

## SCSS

### PF-SCSS-001 — 기존 자산 우선

- Level: MUST
- Profiles: scss
- Authority: policy:project-foundation
- Trigger: token·변수·함수·Mixin을 추가하려는 경우
- Do: 기존 SCSS 공개 API와 실제 사용처를 먼저 검색한다.
- Don't: 같은 의미·값·책임의 자산을 새 이름으로 중복 생성하지 않는다.
- Exception: yes
- Enforced by: ci, review
- Evidence: 검색 결과와 신규 자산 사용처
- Rule: SCSS 확장은 기존 token·변수·함수·Mixin 재사용 가능성을 먼저 확인한다.

### PF-SCSS-002 — Sass module

- Level: MUST
- Profiles: scss
- Authority: sass-use
- Trigger: SCSS 모듈을 연결하거나 공개 API를 구성하는 경우
- Do: `@use`와 필요한 `@forward`를 사용한다.
- Don't: legacy `@import`나 전역 이름 충돌에 의존하지 않는다.
- Exception: no
- Enforced by: validator, ci
- Evidence: Sass compile과 import scan
- Rule: SCSS 의존성은 Sass module system으로 명시해야 한다.

### PF-SCSS-003 — 공통 entry

- Level: MUST
- Profiles: scss
- Authority: policy:project-foundation
- Trigger: 공통 또는 페이지 스타일 entry를 구성하는 경우
- Do: `main.scss`는 공통 base·layout·component module을 조립만 하고 실제 selector는 책임 module이 소유한다.
- Don't: main에 구현 selector를 두거나 페이지 entry가 main·다른 페이지 entry를 import하지 않는다.
- Exception: no
- Enforced by: validator, ci
- Evidence: SCSS import graph
- Rule: main은 공통 module의 단일 조립 entry이고 공통 구현과 페이지 entry는 각 책임 파일이 소유한다.

### PF-SCSS-004 — 지연 폴더

- Level: SHOULD
- Profiles: scss
- Authority: policy:project-foundation
- Trigger: abstract·base·components·layouts·pages 영역을 확장하는 경우
- Do: 첫 실제 책임 파일이 생길 때 폴더와 module을 만든다.
- Don't: 빈 아키텍처를 보여주기 위해 placeholder 파일을 추가하지 않는다.
- Exception: yes
- Enforced by: ci, review
- Evidence: judgment:첫 책임 파일과 생성 이유
- Rule: SCSS 아키텍처 폴더는 실제 소유 코드가 생길 때 지연 생성한다.

## Capabilities and integrations

### PF-CAP-001 — Capability 활성화

- Level: MUST
- Profiles: core
- Authority: policy:project-foundation
- Trigger: 인증·결제·DB·3D 같은 선택 기능을 추가하는 경우
- Do: catalog의 trigger·requires·conflicts·security·tests를 확인하고 plan으로 활성화한다.
- Don't: 관련 파일과 의존성을 수동으로 일부만 추가해 활성 상태를 숨기지 않는다.
- Exception: no
- Enforced by: validator, ci
- Evidence: capability plan SHA와 manifest 상태
- Rule: 선택 기능은 검증된 Capability 계약을 통해 원자적으로 활성화한다.

### PF-CAP-002 — 알 수 없는 기능

- Level: MUST
- Profiles: core
- Authority: policy:project-foundation
- Trigger: catalog에 없는 기능 요구를 발견한 경우
- Do: unknown으로 보고하고 후보 구조·출처·파일 증가·테스트를 제안한다.
- Don't: 가장 비슷해 보이는 Capability를 사실 확인 없이 적용하지 않는다.
- Exception: no
- Enforced by: review, ci
- Evidence: judgment:unknown 분석과 승인된 확장 plan
- Rule: 미등록 기능은 추측 적용하지 않고 명시적 Capability 확장 절차를 거친다.

### PF-DB-001 — 데이터 접근

- Level: MUST
- Profiles: php
- Authority: php-pdo-prepare
- Trigger: SQL 조회·변경을 구현하는 경우
- Do: PDO prepared statement와 명시적 transaction 경계를 사용한다.
- Don't: 사용자 값을 SQL 문자열에 결합하거나 View에서 query하지 않는다.
- Exception: no
- Enforced by: validator, ci, review
- Evidence: SQL injection·transaction 테스트
- Rule: 데이터 접근은 매개변수화된 PDO와 기능 소유 경계 안에서 수행한다.

### PF-INTEGRATION-001 — 외부 시스템

- Level: MUST
- Profiles: php, typescript
- Authority: policy:project-foundation
- Trigger: 결제·메일·검색·CMS·외부 API를 연결하는 경우
- Do: 공급자 adapter, timeout, 오류 매핑, 재시도·idempotency 필요성을 명시한다.
- Don't: 공급자 SDK 응답을 도메인·View 전역에 직접 확산하지 않는다.
- Exception: yes
- Enforced by: review, ci
- Evidence: adapter contract와 실패 시나리오
- Rule: 외부 시스템은 기능 경계의 adapter와 명시적 실패 계약을 통해 연결한다.

## Dependencies and versions

### PF-DEP-001 — 잠금 파일

- Level: MUST
- Profiles: php, assets
- Authority: composer-schema
- Trigger: Composer 또는 npm 의존성을 설치·변경하는 경우
- Do: `composer.lock`과 `package-lock.json`을 해당 manifest와 함께 갱신한다.
- Don't: 같은 ecosystem의 복수 lockfile이나 불일치 상태를 커밋하지 않는다.
- Exception: no
- Enforced by: validator, ci
- Evidence: frozen install과 lock root 비교
- Rule: 각 의존성 ecosystem은 하나의 일치하는 잠금 파일을 가져야 한다.

### PF-DEP-002 — 의존성 도입

- Level: MUST
- Profiles: core
- Authority: policy:project-foundation
- Trigger: production 또는 development dependency를 추가하는 경우
- Do: 목적·내장 대안·라이선스·보안·유지보수·번들 또는 이미지 비용을 기록한다.
- Don't: 편의성만으로 기존 기능과 중복되는 패키지를 설치하지 않는다.
- Exception: yes
- Enforced by: ci, review
- Evidence: dependency rationale와 audit 결과
- Rule: 신규 의존성은 대안과 공급망 비용을 검토한 증거가 있어야 한다.

### PF-DEP-003 — 버전 기준점

- Level: MUST
- Profiles: core
- Authority: node-release-policy
- Trigger: 런타임·패키지 관리자·Docker base·Action 버전을 변경하는 경우
- Do: toolchain과 lockfile을 공식 지원 상태에 맞춰 갱신한다.
- Don't: floating latest·EOL runtime·부분 버전 갱신을 허용하지 않는다.
- Exception: yes
- Enforced by: validator, ci
- Evidence: toolchain source와 호환 matrix
- Rule: 도구와 런타임 버전은 공식 지원 상태와 재현 가능한 잠금 기준점에 연결한다.

## Docker and performance

### PF-DOCKER-001 — 다단계 이미지

- Level: MUST
- Profiles: docker
- Authority: docker-build-best-practices
- Trigger: PHP production 이미지를 빌드하는 경우
- Do: Composer·asset·test·PHP runtime·Nginx 산출물을 분리한 최소 stage를 사용한다.
- Don't: 개발 도구·테스트·소스맵·불필요한 패키지를 production stage에 남기지 않는다.
- Exception: yes
- Enforced by: validator, ci
- Evidence: Docker stage와 image content 검사
- Rule: production 컨테이너에는 실행에 필요한 최소 산출물만 포함한다.

### PF-DOCKER-002 — Compose 표준

- Level: MUST
- Profiles: docker
- Authority: docker-compose-model
- Trigger: 로컬 서비스 구성을 정의하는 경우
- Do: `compose.yaml`과 활성 Capability에 필요한 서비스만 사용한다.
- Don't: obsolete version 필드·compose.yml 동시 존재·불필요한 DB 서비스를 허용하지 않는다.
- Exception: no
- Enforced by: validator, ci
- Evidence: `docker compose config -q`
- Rule: Compose 구성은 단일 표준 파일과 실제 활성 서비스만 포함해야 한다.

### PF-DOCKER-003 — 이미지 재현성

- Level: MUST
- Profiles: docker
- Authority: docker-build-best-practices
- Trigger: Docker base image를 선언하는 경우
- Do: 버전 태그와 SHA-256 digest를 함께 고정하고 릴리스 전에 갱신 여부를 확인한다.
- Don't: latest·edge·digest 없는 base를 사용하지 않는다.
- Exception: yes
- Enforced by: validator, ci
- Evidence: Dockerfile pin 검사와 build check
- Rule: 모든 외부 Docker base image는 버전 태그와 불변 digest를 함께 사용한다.

### PF-PERF-001 — 측정 기반 최적화

- Level: MUST
- Profiles: core, docker, assets
- Authority: policy:project-foundation
- Trigger: 성능 최적화나 회귀 차단을 주장하는 경우
- Do: PROJECT에 선언된 실제 기준과 동일 조건 측정을 비교한다.
- Don't: 근거 없는 공통 숫자나 체감만으로 성공을 선언하지 않는다.
- Exception: yes
- Enforced by: ci, review
- Evidence: 프로젝트 예산과 전후 측정 결과
- Rule: 성능 판정은 프로젝트가 선언한 예산과 재현 가능한 측정을 사용한다.

## Verification

### PF-TEST-001 — 변경 범위 검증

- Level: MUST
- Profiles: core
- Authority: policy:project-foundation
- Trigger: 파일 변경을 완료하거나 PR을 갱신하는 경우
- Do: 변경 경로에 해당하는 정책·코드·보안·컨테이너 검사를 실행한다.
- Don't: 좁은 단위 검사 하나로 전체 시스템 검증을 대체하지 않는다.
- Exception: no
- Enforced by: hook, ci
- Evidence: changed-path verification result
- Rule: 검증 범위는 변경이 영향을 줄 수 있는 실제 범위와 일치해야 한다.

### PF-TEST-002 — 실패·경계 시나리오

- Level: MUST
- Profiles: core
- Authority: policy:project-foundation
- Trigger: 새 기능·보안 경계·업데이트 동작을 추가하는 경우
- Do: 정상·실패·경계·롤백 시나리오를 테스트한다.
- Don't: 성공 경로만으로 원자성·보안·호환성을 완료 처리하지 않는다.
- Exception: yes
- Enforced by: ci, review
- Evidence: 관련 scenario ID와 결과
- Rule: 변경은 성공 경로뿐 아니라 실패·경계·롤백 동작도 증명해야 한다.

### PF-TEST-003 — Canonical scenario corpus

- Level: MUST
- Profiles: core
- Authority: policy:project-foundation
- Trigger: Foundation v1 정식 릴리스를 검증하는 경우
- Do: 12개 그룹의 canonical scenario 120개와 mutation 검사를 모두 실행한다.
- Don't: scenario 개수만 채우거나 같은 검사를 이름만 바꿔 중복하지 않는다.
- Exception: no
- Enforced by: validator, ci
- Evidence: scenario ID·그룹·oracle 결과
- Rule: Foundation 릴리스는 서로 다른 위험을 다루는 120개 기준 시나리오를 통과해야 한다.

## 예외 형식

MUST 예외가 허용된 규칙은 `PROJECT.md`의 `Exceptions`에 다음 형식으로만 기록한다. 재검토 날짜가 지나면 strict 검증이 실패한다.

```text
### PF-AREA-NNN
- Reason: 구체적 기술 이유
- Owner: 책임자
- Review by: 2026-12-31
- Compensating control: 대체 통제와 검증 명령
```

# Project Foundation Rules

이 문서는 공통 규칙 본문의 유일한 원본이다. 에이전트 연결 파일과 프로젝트 문서에 아래 규칙을 복사하지 않는다.

## 규칙 형식

- `Level`: `MUST`, `SHOULD`, `MAY`
- `Profiles`: 적용 프로필
- `Authority`: `SOURCES.json`의 출처 ID 또는 `policy:project-foundation`
- `Exception`: 프로젝트 예외 허용 여부
- `Rule`: 규칙 본문

## Core

### PF-CORE-001 — 작업 범위

- Level: MUST
- Profiles: core
- Authority: policy:project-foundation
- Exception: no
- Rule: 변경은 사용자가 요청한 결과와 그 결과에 필요한 검증으로 제한하고 관계없는 정리나 재구성을 포함하지 않는다.

### PF-CORE-002 — 사용자 변경 보존

- Level: MUST
- Profiles: core
- Authority: policy:project-foundation
- Exception: no
- Rule: 작업 전 저장소 상태를 확인하고 사용자의 기존 변경을 승인 없이 되돌리거나 덮어쓰거나 숨기지 않는다.

### PF-CORE-003 — 규칙 우선순위

- Level: MUST
- Profiles: core
- Authority: codex-agents-md
- Exception: no
- Rule: 시스템과 도구 보안 정책, 현재 사용자의 명시적 요청, 프로젝트 규칙, Foundation 기본값 순서로 지침을 해석한다.

## Git and history

### PF-GIT-001 — 작업 브랜치

- Level: MUST
- Profiles: core
- Authority: github-rulesets
- Exception: yes
- Rule: 기본 브랜치는 릴리스 가능한 상태로 유지하고 구현 변경은 집중된 작업 브랜치와 pull request를 통해 병합한다.

### PF-GIT-002 — 이력 단위

- Level: SHOULD
- Profiles: core
- Authority: policy:project-foundation
- Exception: yes
- Rule: 하나의 커밋과 pull request는 검토와 롤백이 가능한 하나의 논리적 변경만 표현한다.

### PF-GIT-003 — 릴리스 버전

- Level: MUST
- Profiles: core
- Authority: semantic-versioning
- Exception: no
- Rule: 공개 API의 호환성 변화는 Semantic Versioning에 따라 버전과 CHANGELOG에 함께 기록한다.

## Security

### PF-SEC-001 — 비밀값

- Level: MUST
- Profiles: core,docker
- Authority: github-actions-security
- Exception: no
- Rule: 인증정보와 비밀값은 소스, 로그, 이미지 레이어, build argument, 테스트 fixture에 저장하지 않고 승인된 secret 저장소에서 주입한다.

### PF-SEC-002 — 외부 입력

- Level: MUST
- Profiles: core
- Authority: policy:project-foundation
- Exception: no
- Rule: 외부 입력이 경로, URL, 명령, 쿼리, HTML 또는 파일 시스템 경계에 도달하기 전에 해당 문맥에 맞게 검증하고 제한한다.

### PF-SEC-003 — 최소 권한

- Level: MUST
- Profiles: core,docker
- Authority: github-actions-security
- Exception: yes
- Rule: 자동화 토큰과 런타임 프로세스에는 작업 수행에 필요한 최소 권한만 부여하고 권한 확대는 문서화한다.

## Agent integration

### PF-AGENT-001 — 단일 규칙 원본

- Level: MUST
- Profiles: core
- Authority: codex-agents-md
- Exception: no
- Rule: 공통 규칙 본문은 이 문서에서만 정의하고 에이전트별 파일은 로딩 순서와 원본 위치만 안내한다.

### PF-AGENT-002 — 프로젝트 결정

- Level: MUST
- Profiles: core
- Authority: claude-memory
- Exception: no
- Rule: 프로젝트 고유 명령, 아키텍처, 예외와 성능 예산은 PROJECT.md에서만 소유한다.

### PF-AGENT-003 — 인덱스 크기

- Level: SHOULD
- Profiles: core
- Authority: cursor-rules
- Exception: yes
- Rule: 항상 로드되는 에이전트 문서는 짧은 인덱스로 유지하고 긴 절차는 필요할 때 로드하는 Skill로 분리한다.

## Architecture and files

### PF-ARCH-001 — 책임 설계

- Level: SHOULD
- Profiles: core,typescript
- Authority: policy:project-foundation
- Exception: yes
- Rule: 모듈과 객체는 하나의 명확한 변경 이유를 가지며 의존성은 구체 구현보다 안정된 계약을 향하도록 설계한다.

### PF-ARCH-002 — 클래스와 함수

- Level: SHOULD
- Profiles: core,typescript
- Authority: policy:project-foundation
- Exception: yes
- Rule: 상태와 불변식과 수명주기가 있는 책임은 클래스로 캡슐화하고 순수 계산과 변환은 함수로 표현한다.

### PF-ARCH-003 — 패턴 선택

- Level: MUST
- Profiles: core
- Authority: policy:project-foundation
- Exception: yes
- Rule: 디자인 패턴은 프로젝트의 상태 흐름과 변경 축을 분석해 무패턴 선택과 비교한 뒤 사용자 승인 전에는 구조에 도입하지 않는다.

### PF-FILE-001 — 파일 생성 게이트

- Level: MUST
- Profiles: core
- Authority: policy:project-foundation
- Exception: yes
- Rule: 새 파일이나 폴더는 독립 책임, 재사용 경계, 테스트 경계 중 하나가 설명될 때만 생성한다.

### PF-FILE-002 — 추상화 시점

- Level: SHOULD
- Profiles: core
- Authority: policy:project-foundation
- Exception: yes
- Rule: 공통화는 실제 두 번째 사용처가 존재하거나 확정된 독립 변경 축이 확인된 경우에만 수행한다.

## TypeScript

### PF-TYPE-001 — 타입 소유권

- Level: MUST
- Profiles: typescript
- Authority: typescript-strict
- Exception: yes
- Rule: 타입은 해당 개념을 소유하는 모듈에서 한 번만 정의하고 소비자는 복제하지 않고 가져다 사용한다.

### PF-TYPE-002 — 런타임 스키마

- Level: SHOULD
- Profiles: typescript
- Authority: policy:project-foundation
- Exception: yes
- Rule: 런타임 검증 스키마가 존재하면 동일 구조를 수동 타입으로 다시 쓰지 말고 타입을 스키마에서 파생한다.

### PF-TYPE-003 — strict와 any

- Level: MUST
- Profiles: typescript
- Authority: typescript-strict
- Exception: yes
- Rule: TypeScript strict 모드를 사용하고 any는 경계가 문서화된 최소 범위의 승인된 예외에서만 허용한다.

## SCSS

### PF-SCSS-001 — 기존 자산 우선

- Level: MUST
- Profiles: scss
- Authority: policy:project-foundation
- Exception: yes
- Rule: 새 값이나 Mixin을 만들기 전에 기존 토큰, 변수, 함수와 Mixin을 검색하고 의미가 일치하면 재사용한다.

### PF-SCSS-002 — Sass module system

- Level: MUST
- Profiles: scss
- Authority: sass-use
- Exception: yes
- Rule: SCSS 모듈은 전역 import 대신 Sass의 use와 forward 규칙으로 명시적인 네임스페이스와 공개 표면을 구성한다.

### PF-SCSS-003 — 신규 토큰 조건

- Level: SHOULD
- Profiles: scss
- Authority: sass-mixin
- Exception: yes
- Rule: 신규 토큰이나 Mixin은 기존 의미와 구분되는 이름과 둘 이상의 예상 소비 지점 또는 명확한 도메인 소유권을 가져야 한다.

## Dependencies and versions

### PF-DEP-001 — 잠금 파일

- Level: MUST
- Profiles: typescript
- Authority: npm-ci
- Exception: yes
- Rule: 프로젝트는 하나의 패키지 관리자와 하나의 잠금 파일을 사용하고 자동화 환경은 잠금 파일을 변경하지 않는 재현 가능한 설치 명령을 사용한다.

### PF-DEP-002 — 의존성 도입

- Level: MUST
- Profiles: core,typescript
- Authority: policy:project-foundation
- Exception: yes
- Rule: 신규 의존성은 목적, 표준 기능 대안, 라이선스, 보안, 유지보수 상태와 빌드 및 배포 비용을 검토한 뒤 추가한다.

### PF-DEP-003 — 고정과 자동 갱신

- Level: MUST
- Profiles: core,docker
- Authority: github-dependabot
- Exception: yes
- Rule: 잠긴 패키지, 컨테이너 이미지와 자동화 Action은 재현 가능한 참조를 사용하고 갱신은 검증을 거치는 pull request로 수행한다.

## Docker and performance

### PF-DOCKER-001 — 이미지 단계

- Level: MUST
- Profiles: docker
- Authority: docker-build-best-practices
- Exception: yes
- Rule: 컨테이너 빌드는 의존성, 빌드, 테스트와 production 단계를 분리하고 최종 이미지에는 실행에 필요한 산출물만 포함한다.

### PF-DOCKER-002 — Compose 표준

- Level: MUST
- Profiles: docker
- Authority: docker-compose-model
- Exception: yes
- Rule: 기본 Compose 파일명은 compose.yaml을 사용하고 obsolete version 필드와 동시에 존재하는 호환 파일을 허용하지 않는다.

### PF-DOCKER-003 — 이미지 재현성

- Level: MUST
- Profiles: docker
- Authority: docker-build-best-practices
- Exception: yes
- Rule: 외부 컨테이너 이미지는 의미 있는 버전 태그와 immutable SHA-256 digest를 함께 사용한다.

### PF-DOCKER-004 — 개발 동기화

- Level: SHOULD
- Profiles: docker
- Authority: docker-compose-watch
- Exception: yes
- Rule: 컨테이너 개발 동기화는 host node_modules를 공유하지 않고 변경 종류에 맞는 sync 또는 rebuild 동작을 사용한다.

### PF-PERF-001 — 측정 기반 최적화

- Level: MUST
- Profiles: core,docker
- Authority: policy:project-foundation
- Exception: yes
- Rule: 최적화는 PROJECT.md에 정의한 이미지 크기, 빌드 시간, 시작 시간 또는 번들 비용의 측정값과 회귀 기준을 근거로 수행한다.

### PF-PERF-002 — 빌드 캐시

- Level: SHOULD
- Profiles: docker
- Authority: docker-cache-optimization
- Exception: yes
- Rule: 변경 빈도가 낮은 의존성 입력을 소스보다 먼저 처리하고 BuildKit cache mount와 CI 외부 캐시를 사용한다.

## Verification

### PF-TEST-001 — 최소 검증

- Level: MUST
- Profiles: core
- Authority: policy:project-foundation
- Exception: yes
- Rule: 변경은 가장 작은 관련 테스트부터 실행하고 배포 또는 공개 인터페이스 변경은 전체 strict 검증과 롤백 가능성을 확인한다.

### PF-TEST-002 — 검증 증거

- Level: MUST
- Profiles: core
- Authority: github-actions-security
- Exception: no
- Rule: pull request와 릴리스 기록에는 실제 실행한 검증, 결과, 생략한 검사와 남은 위험을 사실대로 남긴다.

## 예외 형식

Foundation `MUST` 예외가 허용된 경우 `PROJECT.md`에 다음을 모두 기록한다.

```text
### PF-EXAMPLE-001
- Reason: 예외가 필요한 이유
- Owner: 책임자
- Review by: 2026-09-21
- Compensating control: 위험을 줄이는 대체 통제
```

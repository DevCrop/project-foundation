# Project Foundation

언어·프레임워크와 분리된 공통 규칙, AI 에이전트 연결, Docker 계약, GitHub 운영과 검증을 제공하는 공개 MIT 템플릿이다. Foundation 관리 CLI만 Node를 사용하며 소비 애플리케이션은 Node 또는 Custom 런타임 어댑터를 선택한다.

## 새 프로젝트

완성형 Node/TypeScript/SCSS/Docker 프로젝트:

```text
node scripts/foundation.mjs init --runtime node --profile github,docker,typescript,scss --project-name my-project --owner github-login
npm ci
node scripts/foundation.mjs doctor
node scripts/foundation.mjs verify --base origin/main
```

언어 중립 프로젝트는 불필요한 npm·TypeScript·SCSS 파일을 만들지 않는다.

```text
node scripts/foundation.mjs init --runtime custom --profile core --project-name my-project
node scripts/foundation.mjs validate --strict
```

`custom` Docker 프로젝트는 기존 Dockerfile과 명령 계약을 보존해야 하므로 `init` 대신 기존 프로젝트 도입 절차를 사용한다.

## 기존 프로젝트 도입

Custom Docker 도입 전에는 프로젝트가 실제 명령과 target을 소유하도록 `.foundation/project.json`을 먼저 작성한다. command/args 배열에는 최소 `test`, `build`, `start`를 기록하며 Foundation은 셸 문자열을 추측하지 않는다.

```text
node path/to/project-foundation/scripts/foundation.mjs adopt plan --runtime custom --profile github,docker --owner github-login
node path/to/project-foundation/scripts/foundation.mjs adopt apply --plan-sha <출력된-sha256> --confirm
node scripts/foundation.mjs validate --strict
```

`plan`은 생성 예정 파일, 충돌과 현재 상태에 묶인 SHA를 출력한다. `apply`는 프로젝트 상태와 SHA가 모두 같을 때만 실행되며 기존 파일 충돌이 있으면 아무것도 변경하지 않는다. Custom 프로젝트의 test, build, start와 dependency audit 명령은 프로젝트가 작성한 설정을 계속 소유한다.

## 프로필

- `core`: 규칙, 검증·업데이트 CLI, 에이전트 연결
- `github`: stable Actions checks, PR 템플릿, Dependabot과 원격 설정 계획
- `docker`: Compose·Make·Docker 보안 및 최적화 계약
- `node`: npm lockfile과 완성형 Node Docker 어댑터
- `typescript`: strict TypeScript와 타입 단일 소유권
- `scss`: Sass module system과 기존 토큰·변수·Mixin 재사용
- `custom`: 기존 언어·명령·Dockerfile을 공통 자동화에 연결하는 어댑터

Docker는 TypeScript에 의존하지 않는다. Node와 Custom은 동시에 활성화할 수 없다.

## 공개 CLI

```text
foundation.mjs init --runtime node|custom [--profile ...] [--project-name ...] [--owner ...]
foundation.mjs adopt plan --runtime custom [--profile ...] [--owner ...]
foundation.mjs adopt apply --plan-sha <sha256> --confirm
foundation.mjs validate [--strict]
foundation.mjs verify [--base <ref>] [--scope all|policy|project|dependency]
foundation.mjs run <configured-command>
foundation.mjs doctor
foundation.mjs update [--version <version>]
foundation.mjs agent context
foundation.mjs github plan --repo <owner/name>
foundation.mjs github apply --repo <owner/name> --confirm <owner/name>
```

원격 적용은 visibility를 보존한다. Foundation 저장소를 공개로 바꾸는 별도 작업처럼 공개 전환이 명시된 경우에만 `--make-public`을 추가한다.

## 규칙과 설정 소유권

- [FOUNDATION.md](FOUNDATION.md): 공통 규칙 본문의 유일한 원본
- [PROJECT.md](PROJECT.md): 프로젝트의 서술형 결정, 아키텍처, 예외, 성능 예산
- `.foundation/project.json`: 셸 문자열이 아닌 command/args, runtime, Docker, GitHub 실행 설정
- [SOURCES.json](SOURCES.json): 공식 출처와 재확인 날짜
- `.foundation/manifest.json`: 설치 버전, 활성 프로필, 관리 파일 SHA-256
- `AGENTS.md`, `CLAUDE.md`, Cursor Rule: 원본을 복제하지 않는 에이전트 어댑터

규칙 우선순위는 시스템·도구 보안 정책, 현재 사용자 요청, 프로젝트 규칙, Foundation 기본값 순서다. 모든 MUST는 validator, Hook, CI, GitHub 또는 판단 증거 중 강제 수단을 가진다.

## Codex → Cursor → Claude

Codex는 짧은 `AGENTS.md`, `.agents/skills`, 신뢰된 `.codex/hooks.json`을 사용한다. `SessionStart`는 활성 계약을 context로 추가하고 `Stop`은 변경이 있을 때 verify를 한 번 재요청한다. 프로젝트 Hook은 사용자가 `/hooks`에서 신뢰해야 하며 비활성 환경에서는 CI가 최종 차단한다.

Cursor는 루트·하위 `AGENTS.md`, `.agents/skills`, Always Apply Rule의 `@FOUNDATION.md`와 `@PROJECT.md` 참조를 사용한다. Cursor Inline Edit에는 Rules가 적용되지 않는 공식 제약이 있으므로 결과는 CI에서 다시 검사한다.

Claude는 `CLAUDE.md`가 `AGENTS.md`, `FOUNDATION.md`, `PROJECT.md`를 명시적으로 import하고 Skill wrapper가 `.agents/skills` 원본으로 라우팅한다.

## Docker와 Make

`compose.yaml`만 표준 파일명으로 사용한다. Node Dockerfile은 dependency, build, test, development, production 단계를 제공하고 base image tag+digest, cache mount, non-root production과 healthcheck를 검사한다. Custom은 기존 Dockerfile target과 `.foundation/project.json` 계약을 대조한다.

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

Makefile은 Node CLI, 프로젝트 command/args와 Docker Compose를 연결하는 편의 계층이다. 기본 down은 volume, image, 데이터를 삭제하지 않는다.

## GitHub 강제 계층

필수 검사 이름은 런타임·Node 버전과 무관하게 고정된다.

```text
foundation-policy
project-quality
container
dependency-gate
```

Dependency Review가 가능한 공개 저장소 또는 적격 private 저장소에서는 공식 Action을 사용한다. 사용할 수 없는 private 저장소는 `.foundation/project.json`의 `dependencyAudit`을 실행하고 제한 사항을 보고한다.

브랜치는 `(feature|fix|security|docs|refactor|test|chore|release)/<lowercase-topic>`, PR 제목은 Conventional Commit 형식을 사용한다. 신규 경로와 의존성 변경은 PR에 책임·대안·보안·비용 증거를 남긴다.

## 업데이트와 검증

```text
node scripts/foundation.mjs update --version 1.0.1
node scripts/foundation.mjs verify --base origin/main
```

업데이트는 정식 Release 자산과 SHA-256을 검증한다. 관리 파일이 하나라도 수정됐으면 전체를 중단하고 `PROJECT.md`, `.foundation/project.json`, CODEOWNERS와 다른 seed 파일을 덮어쓰지 않는다.

Foundation 자체 검증:

```text
npm ci
npm test
node scripts/foundation.mjs verify --base origin/main
docker buildx build --check .
docker compose config -q
docker build --target production -t project-foundation:local .
```

## 공식 기준

외부 동작은 [SOURCES.json](SOURCES.json)의 공급자 공식 문서만 근거로 한다. SOLID, 파일 생성 게이트, 객체 책임과 최적화 판단은 `Project Foundation Policy`로 구분한다. 출처가 31일 넘게 재확인되지 않으면 strict 검증과 릴리스를 차단한다.

## 라이선스

[MIT](LICENSE)

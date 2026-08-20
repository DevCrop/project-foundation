# Project Foundation

여러 프로젝트에서 반복해서 사용할 개발 규칙, AI 에이전트 연결, 버전 관리, 검증, GitHub 운영 자동화를 제공하는 공개 MIT 템플릿이다. 특정 제품이나 프레임워크의 도메인 코드는 포함하지 않는다.

## 빠른 시작

GitHub Template로 새 저장소를 만들거나 이 저장소를 복제한 후 실행한다.

```text
node scripts/foundation.mjs init --profile typescript,scss,docker --project-name my-project
npm ci
node scripts/foundation.mjs doctor
node scripts/foundation.mjs validate --strict
```

Docker가 필요하지 않으면 `docker` 프로필을 생략한다.

```text
node scripts/foundation.mjs init --profile typescript,scss --project-name my-project
```

## 명령

```text
node scripts/foundation.mjs init [--profile ...] [--project-name ...]
node scripts/foundation.mjs validate [--strict]
node scripts/foundation.mjs update [--version 1.0.0]
node scripts/foundation.mjs doctor
node scripts/foundation.mjs github plan [--repo owner/name]
node scripts/foundation.mjs github apply --repo owner/name --confirm
```

Docker 프로필에서는 같은 작업을 짧은 Make target으로 실행할 수 있다.

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
```

Make는 편의 계층이다. Windows 등 GNU Make가 없는 환경에서도 README에 표시되는 Node, npm, Docker 원본 명령이 기준이다.

## 규칙 소유권

- [`FOUNDATION.md`](FOUNDATION.md): 모든 프로젝트가 공유하는 규칙의 유일한 원본
- [`PROJECT.md`](PROJECT.md): 현재 프로젝트의 선택, 명령, 예외, 성능 예산
- [`SOURCES.json`](SOURCES.json): 공식 출처와 확인 날짜
- `AGENTS.md`, `CLAUDE.md`, Cursor Rule: 원본 규칙을 복사하지 않는 에이전트 연결 파일
- `.foundation/manifest.json`: 설치 버전, 활성 프로필, 관리 파일 체크섬

규칙 우선순위는 시스템·도구 보안 정책, 현재 사용자 요청, 프로젝트 규칙, Foundation 기본값 순서다.

## 프로필

- `core`: 규칙, 검증 CLI, 에이전트 연결, GitHub 운영 파일
- `typescript`: strict TypeScript와 타입 단일 소유권
- `scss`: Sass module system과 기존 토큰·Mixin 재사용
- `docker`: multi-stage Dockerfile, `compose.yaml`, `.dockerignore`, `.env.example`, Makefile

`docker`는 v1에서 `typescript`와 함께 사용한다. 기본 Compose 파일명은 Docker 공식 권장 이름인 `compose.yaml`이다.

## 업데이트

```text
node scripts/foundation.mjs update --version 1.0.1
```

업데이트는 정식 GitHub Release의 아카이브와 SHA-256을 확인한다. 설치 이후 관리 파일이 직접 수정되었다면 어떤 파일도 교체하지 않고 차이만 보고한다. `PROJECT.md`와 seed 파일은 변경하지 않는다.

## 개발과 검증

```text
npm ci
npm test
npm run build
npm run styles:build
node scripts/foundation.mjs validate --strict
git diff --check
```

Docker 프로필 검증:

```text
docker buildx build --check .
docker compose config -q
docker build --target production -t project-foundation:local .
```

## 원격 GitHub 설정

먼저 인증 상태와 변경 예정 항목만 확인한다.

```text
node scripts/foundation.mjs github plan --repo DevCrop/project-foundation
```

실제 변경은 정확한 저장소와 확인 플래그가 모두 있을 때만 수행한다.

```text
node scripts/foundation.mjs github apply --repo DevCrop/project-foundation --confirm
```

저장소 플랜이나 계정 권한상 사용할 수 없는 보안 기능은 성공으로 가장하지 않고 제한 사항으로 출력한다.

## 공식 기준

외부 도구 동작은 [`SOURCES.json`](SOURCES.json)에 등록된 공식 문서만 근거로 한다. SOLID, 파일 생성 게이트, 객체 책임과 같은 선택은 `Project Foundation Policy`로 구분한다. 출처는 매월과 릴리스 직전에 재확인하며 31일 이상 지난 출처가 있으면 strict 검증과 릴리스를 중단한다.

## 라이선스

[MIT](LICENSE)

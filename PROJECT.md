# Project Foundation Project Rules

## Identity

- Project: project-foundation
- Foundation version: 1.0.0
- Runtime adapter: node
- Active profiles: core, github, docker, node, typescript, scss
- Owner: @DevCrop

## Commands

```text
npm ci
npm test
npm run build
npm run styles:build
node scripts/foundation.mjs validate --strict
```

## Architecture

Foundation은 규칙 문서, 의존성 없는 단일 Node CLI, 프로젝트가 소유하는 seed 파일로 구성한다. 애플리케이션 프레임워크나 고정 디자인 패턴을 기본값으로 선택하지 않는다.
소비 애플리케이션은 Node 완성형 어댑터 또는 기존 명령·Dockerfile을 연결하는 Custom 어댑터를 선택한다.

## Type Ownership

CLI 내부 타입 계약은 값을 검증하는 함수 가까이에서 한 번만 소유한다. 소비 프로젝트의 타입은 해당 개념 모듈이 소유한다.

## Styling

SCSS 공개 토큰과 Mixin은 각각 소유 모듈에서 정의하고 `styles/main.scss`가 `@use`로 소비한다.

## Docker

- Runtime contract: `.foundation/project.json`
- Application port: 3000
- Production output: `dist/`
- Build command: `npm run build`
- Start command: `npm start`

## Performance Budgets

Foundation은 공통 숫자를 강제하지 않는다. 첫 production 측정 후 다음 항목의 기준값과 허용 회귀율을 이곳에 기록한다.

- Production image size: not measured
- Cold build time: not measured
- Cached build time: not measured
- Container readiness time: not measured

## Exceptions

현재 Foundation 규칙 예외 없음.

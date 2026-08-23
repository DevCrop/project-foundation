# Changelog

모든 주요 변경은 이 파일에 기록한다. 형식은 Keep a Changelog의 범주를 참고하되 Foundation 정책으로 관리하며 버전은 Semantic Versioning을 따른다.

## Unreleased

### Added

### Changed

### Fixed

### Security

### Breaking

## 2.0.1 - 2026-08-23

### Fixed

- 신뢰된 Dependabot PR이 사람용 PR template 섹션을 작성할 수 없어 `foundation-policy`에서 무조건 실패하던 자동화 충돌 수정
- 성공한 Git 명령의 stderr 경고가 변경 파일 목록으로 섞이지 않도록 Git 출력 판정 분리

### Security

- `dependabot[bot]` actor·PR 작성자·Bot type·전용 브랜치를 모두 확인하고 수정 상태의 의존성 표면만 허용하도록 자동화 예외 제한
- `@types/node`를 최저 지원 Node 22 계열로 맞추고 상위 major 자동 업데이트와 타입 표면 불일치를 차단

## 2.0.0 - 2026-08-22

### Changed

- 소비 애플리케이션 런타임을 PHP 8.2.33 단일 기준으로 고정하고 Symfony 7.4 LTS·PHPUnit 11 호환 계약으로 전환
- Composer 바이너리만 공식 Composer image에서 가져오고 install·lint·PHPStan·PHPUnit은 고정된 PHP 8.2.33 tooling stage에서 실행
- Codex 작업 전에 필수 정보를 Observed·Inferred·Unverified로 분류하고 승인 경계를 확인하는 Intake gate 요청 형식 명시

### Fixed

- `docker info`가 연결·권한 오류를 함께 출력하는 경우 종료 코드만 보고 daemon을 정상으로 오인하지 않도록 doctor 판정 보강

### Security

- Page slug와 route 중복 검사에서 입력 기반 동적 정규식을 제거해 CodeQL `js/regex-injection` High 경고 2건 해소
- 정규식을 조립하지 않는 고정 형식 비교와 slug·route 중복 회귀 테스트 추가

### Breaking

- PHP 8.4·8.5 seed 계약을 폐기하고 PHP 8.2.33만 지원한다. v1 소비 프로젝트의 `composer.json`, `composer.lock`, Dockerfile은 프로젝트 소유 파일이므로 자동 덮어쓰지 않으며 v2 update는 승인된 seed migration 없이는 원자적으로 중단한다.
- Foundation manifest schema를 3으로 올리고 자동 update를 동일 메이저 버전으로 제한한다.

## 1.0.2 - 2026-08-22

### Fixed

- 이전 updater도 읽을 수 있도록 Release tarball을 commit이 아닌 tree object에서 생성
- Git archive가 commit archive에 기록하는 global extended PAX metadata를 새 parser가 안전하게 건너뛰도록 보강

### Security

- 실제 immutable v1.0.0 자산에서 최신 Release로 업데이트하는 smoke test를 릴리스 승인 증거에 포함

## 1.0.1 - 2026-08-22

### Fixed

- GitHub ruleset API가 추가하는 응답 전용 기본 필드를 실제 설정 drift로 오인하지 않도록 비교를 정규화

### Security

- Release를 draft로 생성하고 자산·체크섬 업로드가 끝난 뒤 불변 상태로 게시하도록 순서 강제

## 1.0.0 - 2026-08-22

### Added

- PHP 웹사이트 공통 규칙, 프로젝트 인테이크, 공식 출처와 검증 증거 레지스트리
- 신규 프로젝트 init, 기존 PHP 프로젝트 adopt plan/apply, Page 추가와 Capability plan/apply CLI
- `section > container > inner` 기반의 선택형 section shell과 순수 PHP View·공통 PageController
- 최소 SCSS main entry, Sass module, strict TypeScript와 Vite backend manifest 통합
- PHP-FPM·Nginx non-root multi-stage Docker, Compose Watch와 얇은 Make 명령 계층
- PHP 8.4·8.5, Node LTS, 잠금 파일과 정확한 npm 도구 버전 호환 검사
- Codex SessionStart·PreToolUse·Stop Hook, 공유 Skills와 Cursor·Claude 원본 라우팅
- Foundation·프로젝트·컨테이너·의존성 stable checks와 GitHub ruleset·보안 계획
- 12개 위험 그룹으로 구분한 정확히 120개 canonical scenario와 mutation 검사

# Changelog

모든 주요 변경은 이 파일에 기록한다. 형식은 Keep a Changelog의 범주를 참고하되 Foundation 정책으로 관리하며 버전은 Semantic Versioning을 따른다.

## Unreleased

### Added

### Changed

### Fixed

### Security

### Breaking

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

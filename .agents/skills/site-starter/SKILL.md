---
name: site-starter
description: PHP 웹 프로젝트·페이지·기능을 시작하거나 기존 사이트에 Foundation을 도입할 때 선행 정보를 분류하고 최소 Page·Capability 계획을 만든다.
---

# Site Starter

새 PHP 사이트, 디자인 기반 페이지 구현, 기존 사이트 도입, 선택 기능 활성화에 사용한다.

## Intake

`README.md`의 선행 정보와 실제 저장소를 대조해 각 항목을 `Observed`, `Inferred`, `Unverified`로 분류한다. 디자인 이미지에서 보이는 레이아웃은 관찰할 수 있지만 보이지 않는 동작·API·breakpoint·권한을 사실로 추정하지 않는다.

구조·외부 연동·보안 경계에 필요한 정보가 `Unverified`이면 분석과 plan까지만 진행하고 apply하지 않는다.

## 최소 계획

1. 단순 페이지인지 서버 행위가 있는 기능인지 구분한다.
2. 현재 `config/pages.php`, View, SCSS 자산, TypeScript feature와 Capability를 검색한다.
3. 무패턴·기존 구조 유지 선택을 포함해 필요한 후보만 비교한다.
4. 추천안, 대안, 의존성 방향, 생성 경로와 각 경로의 책임, 제거 조건을 보고한다.
5. 구조 변경은 사용자 승인 후 해당 Foundation 명령으로 실행한다. 단순 페이지는 `page add`, Capability는 상태 SHA가 있는 `plan/apply`를 사용한다.

단순 페이지는 공통 PageController와 `config/pages.php`를 사용한다. 전용 Controller는 입력 처리·권한·외부 연동·도메인 행위가 있을 때만 만든다.

## 적용과 증거

- 단순 페이지는 사용자가 경로·제목·선택 asset을 명시적으로 승인한 뒤 `foundation.mjs page add`로 생성한다.
- Capability apply에는 현재 상태 SHA에 묶인 plan SHA와 정확한 Capability ID 확인값을 사용한다.
- 계획 밖 파일, dependency, route, service를 추가하지 않는다.
- 공통 규칙은 `FOUNDATION.md`, 프로젝트 결정은 `PROJECT.md`, 실행 상태는 `.foundation/project.json`에서 읽는다.
- 완료 전 strict validation, changed-path verify와 `foundation.mjs evidence audit`를 실행한다.
- 실행하지 못한 검사는 `Unverified`와 남은 위험으로 기록한다.

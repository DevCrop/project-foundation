# Contributing

변경은 `(feature|fix|security|docs|refactor|test|chore|release)/<lowercase-topic>` 형식의 집중된 작업 브랜치에서 수행하고 pull request로 제출한다. Dependabot과 최초 bootstrap PR만 문서화된 예외를 사용한다.

## 검증

```text
npm ci
npm test
node scripts/foundation.mjs verify --base origin/main
```

규칙 변경은 `FOUNDATION.md`, 공식 출처 변경은 `SOURCES.json`, 공개 동작 변경은 `CHANGELOG.md`를 함께 갱신한다. 한 pull request에는 하나의 논리적 변경만 포함하며 적용 규칙 ID, 신규 파일 책임, 의존성 검토와 실제 검증 결과를 PR 본문에 남긴다.

커밋 제목 형식:

```text
type(scope): summary
```

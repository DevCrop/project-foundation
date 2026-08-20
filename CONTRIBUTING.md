# Contributing

변경은 `codex/` 접두사의 집중된 작업 브랜치에서 수행하고 pull request로 제출한다.

## 검증

```text
npm ci
npm test
npm run build
npm run styles:build
node scripts/foundation.mjs validate --strict
git diff --check
```

규칙 변경은 `FOUNDATION.md`, 공식 출처 변경은 `SOURCES.json`, 공개 동작 변경은 `CHANGELOG.md`를 함께 갱신한다. 한 pull request에는 하나의 논리적 변경만 포함한다.

커밋 제목 형식:

```text
type(scope): summary
```

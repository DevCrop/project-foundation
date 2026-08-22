# Generated Architecture

이 문서는 `.foundation/project.json`, capability catalog, 실제 페이지 View에서 생성된다. 직접 수정하지 말고 Foundation CLI를 사용한다.

## Observed configuration

- Runtime: `php`
- Profiles: core, php, web, assets, typescript, scss, docker, github
- Page source: `config/pages.php`
- Asset manifest: `public/build/.vite/manifest.json`
- Docker: `php` via `Dockerfile`

## Dependency direction

`public/index.php -> bootstrap/app.php -> Symfony Routing -> PageController -> ViewRenderer -> PHP View`

HTTP Request, Response, and route matching belong to Symfony components. Page configuration belongs to `config/pages.php`. HTML belongs to PHP Views. Vite owns asset compilation only.

## Pages

- `home`: `resource/views/pages/home.php`

## Active capabilities

- `publishing` via recipe `web-core`; triggers: server-rendered pages, marketing or corporate content
- `seo` via recipe `operations-governance`; triggers: public indexable pages, structured metadata

## Expansion gate

Feature folders, provider adapters, page-specific asset entries, and dependencies are added only after an approved capability plan identifies their owner, evidence, tests, security boundary, and removal condition.

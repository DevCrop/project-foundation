.DEFAULT_GOAL := help

.PHONY: help doctor validate test build image config up watch down logs ps release-check

help:
	@echo "doctor         Check required local tools"
	@echo "validate       Run strict Foundation validation"
	@echo "test           Run automated tests"
	@echo "build          Build application and styles"
	@echo "image          Build the production container image"
	@echo "config         Validate and render Compose configuration"
	@echo "up             Start the development service"
	@echo "watch          Start with Compose Watch"
	@echo "down           Stop containers without deleting volumes or images"
	@echo "logs           Follow service logs"
	@echo "ps             Show service status"
	@echo "release-check  Run release validation"

doctor:
	node scripts/foundation.mjs doctor

validate:
	node scripts/foundation.mjs validate --strict

test:
	npm test

build:
	npm run build
	npm run styles:build

image:
	docker build --target production -t $${COMPOSE_PROJECT_NAME:-project-foundation}:local .

config:
	docker compose config -q

up:
	docker compose up --build

watch:
	docker compose up --watch

down:
	docker compose down --remove-orphans

logs:
	docker compose logs --follow

ps:
	docker compose ps

release-check:
	npm run release:check

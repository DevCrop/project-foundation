.DEFAULT_GOAL := help

.PHONY: help install doctor validate test build image config up watch down logs ps release-check

help:
	@echo "install        Install runtime and asset dependencies from lockfiles"
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

install:
	node scripts/foundation.mjs run install

doctor:
	node scripts/foundation.mjs doctor

validate:
	node scripts/foundation.mjs validate --strict

test:
	node scripts/foundation.mjs run test

build:
	node scripts/foundation.mjs run build

image:
	node scripts/foundation.mjs container image

config:
	node scripts/foundation.mjs container config

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
	node scripts/foundation.mjs verify --base origin/main

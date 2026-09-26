# ==============================================================================
# FlowPilot Automation Makefile
# ==============================================================================
# Linux/macOS standard targets. For Windows PowerShell users, use:
# .\scripts\dev.ps1 <command>
# ==============================================================================

.PHONY: help dev build up down logs test lint migrate clean ps

help:
	@echo "FlowPilot Management Commands:"
	@echo "  make up          - Start all services with docker-compose"
	@echo "  make down        - Stop all running containers"
	@echo "  make build       - Build docker images"
	@echo "  make logs        - Tail container logs"
	@echo "  make test        - Run backend and frontend test suites"
	@echo "  make lint        - Run linters (ruff, mypy, eslint)"
	@echo "  make migrate     - Run database migrations (alembic upgrade head)"
	@echo "  make clean       - Remove temporary artifacts and caches"

up:
	docker compose up -d

down:
	docker compose down

build:
	docker compose build

logs:
	docker compose logs -f

test:
	docker compose exec backend pytest
	docker compose exec frontend npm run test

lint:
	docker compose exec backend ruff check app
	docker compose exec backend mypy app
	docker compose exec frontend npm run lint

migrate:
	docker compose exec backend alembic upgrade head

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type d -name ".pytest_cache" -exec rm -rf {} +
	find . -type d -name ".ruff_cache" -exec rm -rf {} +

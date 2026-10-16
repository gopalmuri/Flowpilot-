# ==============================================================================
# FlowPilot Automation Makefile
# ==============================================================================
# Linux/macOS standard targets. For Windows PowerShell users, use:
# .\scripts\dev.ps1 <command>
# ==============================================================================

.PHONY: help setup dev build up down logs test test-local lint migrate seed clean ps

help:
	@echo "FlowPilot Management Commands:"
	@echo "  make setup       - Create backend venv and install backend + frontend dependencies"
	@echo "  make test-local  - Run backend and frontend tests locally (no Docker)"
	@echo "  make seed        - Seed demo data (Docker)"
	@echo "  make up          - Start all services with docker-compose"
	@echo "  make down        - Stop all running containers"
	@echo "  make build       - Build docker images"
	@echo "  make logs        - Tail container logs"
	@echo "  make test        - Run backend and frontend test suites"
	@echo "  make lint        - Run linters (ruff, mypy, eslint)"
	@echo "  make migrate     - Run database migrations (alembic upgrade head)"
	@echo "  make clean       - Remove temporary artifacts and caches"

setup:
	test -f .env || cp .env.example .env
	cd backend && python -m venv venv && ./venv/bin/pip install -r requirements.txt
	cd frontend && npm install

test-local:
	cd backend && ./venv/bin/python -m pytest tests
	cd frontend && npm run test

seed:
	docker compose exec backend python -m scripts.seed_demo_data

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

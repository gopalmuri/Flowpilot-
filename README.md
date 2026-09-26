# FlowPilot

<div align="center">

![FlowPilot Architecture](https://img.shields.io/badge/Architecture-Distributed%20Event--Driven-blue?style=for-the-badge)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-18.3+-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6+-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Celery](https://img.shields.io/badge/Celery-5.4+-37814A?style=for-the-badge&logo=celery&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7+-DC382D?style=for-the-badge&logo=redis&logoColor=white)
![Tests](https://img.shields.io/badge/Tests-335%20Passing-brightgreen?style=for-the-badge)

**AI-Powered Business Integration & Fault-Tolerant Workflow Automation Platform**

*Automate mission-critical business processes with fast AI triage, Celery background queues, and Human-in-the-Loop governance.*

[Key Features](#1-core-features) | [Quick Start](#2-quick-start-local-development) | [Architecture](#3-system-architecture) | [Demo Login](#demo-credentials) | [Testing](#5-testing--quality) | [Documentation](#8-documentation-index)

</div>

---

## Problem Statement & Solution

### The Real-World Problem
Modern organizations want the speed of AI automation, but **cannot afford the risk of uncontrolled bot decisions in mission-critical workflows** (e.g., enterprise lead qualification, loan approvals, financial payouts, contract signing). 
- If workflows are 100% manual, staff are overwhelmed and high-value deals are lost to competitors due to slow response times.
- If workflows rely on generic no-code tools (Zapier/Make), they lack audit trails, tamper-proof logs, SLA compliance tracking, and reliable distributed state pausing.

### The FlowPilot Solution
FlowPilot provides a production-grade, multi-tenant B2B orchestration platform that bridges incoming webhooks with AI classification and deterministic business logic, while safely pausing at a **Human-in-the-Loop approval gate** before touching downstream CRMs or external systems.

```
Incoming Webhook (<50ms Fast ACK)
        ↓
Data Validation & Sanitization (Pydantic v2)
        ↓
AI Classification & Semantic Extraction (LLM / Mock)
        ↓
Deterministic Rule Engine (AST Boolean Logic)
        ↓
Human-in-the-Loop Approval (Pauses Execution for Reviewer)
        ↓
Automated Side Effects (HubSpot/CRM Lead Creation & Slack Notification)
        ↓
Cryptographic Audit Logging & Real-Time SLA Monitoring (<60s Target)
```

---

## Demo Credentials

Once the application is running, log into the dashboard using the pre-seeded enterprise administrator account:

| Attribute | Value |
|---|---|
| **Email** | `demo.admin@flowpilot.internal` |
| **Password** | `Password123!` |
| **Role** | `OWNER` / Administrator |
| **Organization** | `FlowPilot Enterprise Corp` |

---

## 1. Core Features

- **High-Throughput Webhook Ingestion**: Acknowledges payloads with `202 Accepted` in `< 50ms`. Enforces HMAC-SHA256 signature verification and Redis sliding-window rate limiting.
- **24-Hour Idempotency Guard**: Guarantees zero duplicate side effects across CRM, database, or external notification channels even on duplicate webhook retries.
- **Asynchronous Celery Workers**: Long-running AI calls, CRM integrations, and Slack dispatches run entirely in background worker queues isolated from HTTP threads.
- **Human-in-the-Loop Approval Gate**: Suspends execution safely in Redis/PostgreSQL, alerts authorized managers in the dashboard, and resumes in milliseconds upon approval.
- **Visual React Flow Canvas**: Visual DAG builder for creating, configuring, validating, and testing multi-step workflows.
- **Contractual SLA Monitoring**: Real-time duration metrics (P50, P90, P95, P99), latency breakdowns per step, and active breach alarms.
- **Immutable Audit Trail**: Cryptographically captures every lifecycle event (`workflow.created`, `execution.started`, `approval.approved`) with user attribution and zero credential leakage.
- **Enterprise Security Hardening**: Strict Argon2id password hashing, AES-256 field encryption for secrets, SSRF-safe HTTP client, strict CSP, and HSTS.

---

## 2. Quick Start: Local Development (Without Docker)

### Prerequisites
- **Python 3.12+**
- **Node.js 20+** & **npm 10+**
- **PostgreSQL 16+** (running on port `5432`)
- **Redis 7+** (running on port `6379`)

> **Tip for Windows/WSL users**: If using WSL for datastores, start them with:
> ```bash
> wsl -u root service postgresql start
> wsl -u root service redis-server start
> ```

---

### Terminal 1: Backend API (FastAPI)
```powershell
cd backend
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```
- API Endpoint: `http://127.0.0.1:8001`
- Interactive Swagger Docs: `http://127.0.0.1:8001/docs`

---

### Terminal 2: Celery Worker (Async Workflow Engine)
```powershell
cd backend
py -m celery -A app.workers.celery_app.celery_app worker -l INFO -P solo -Q default,workflows,webhooks,maintenance
```

---

### Terminal 3: Frontend (React / Vite)
```powershell
cd frontend
npm install
npm run dev
```
- Web Application: `http://localhost:5173`

---

## 3. Quick Start: Docker Compose

FlowPilot includes pre-configured, production-hardened multi-stage containerfiles:

```bash
# 1. Clone & copy environment variables
cp .env.example .env

# 2. Build production images
docker compose -f docker-compose.prod.yml build

# 3. Start datastores
docker compose -f docker-compose.prod.yml up -d postgres redis

# 4. Run database migrations
docker compose -f docker-compose.prod.yml run --rm backend alembic upgrade head

# 5. Launch all services (Nginx, Backend, Celery, Frontend)
docker compose -f docker-compose.prod.yml up -d
```

- Accessible via Nginx reverse proxy at: `https://localhost` (or `http://localhost:80`)

---

## 4. System Architecture

```
                      +-----------------------------+
                      |   Client / Browser / Hook   |
                      +--------------+--------------+
                                     |
                                 TLS 1.3
                                     |
                      +--------------v--------------+
                      |     Nginx Reverse Proxy     |
                      |   (HSTS, CSP, Rate Buffers) |
                      +-------+--------------+------+
                              |              |
                    /api/, /health/          | / (SPA Static)
                              |              |
                      +-------v-------+  +---v---------------+
                      | FlowPilot App |  | React 18 SPA      |
                      | (4x Uvicorn)  |  | (Nginx Alpine)    |
                      +---+-------+---+  +-------------------+
                          |       |
                 PostgreSQL       Redis
                 (AsyncPG)    (Celery + Cache)
                          |       |
                      +---v-------v---+
                      | Celery Worker |
                      | (Concurrency) |
                      +---------------+
```

---

## 5. Testing & Quality

FlowPilot maintains strict quality baselines with 335 passing tests and 0 lint errors:

### Backend Test Suite (Pytest)
```bash
cd backend
python -m pytest tests/ -v
```
- **276 / 276 Tests Passing** (100% pass rate)
- **86.52%** Core Engine Coverage

### Frontend Test Suite (Vitest)
```bash
cd frontend
npm test
```
- **59 / 59 Tests Passing** (12 test suites)

### Code Quality & Production Build
```bash
cd frontend
npm run lint    # 0 errors
npm run build   # TypeScript compilation & Vite bundle
```

---

## 6. Repository Layout

```text
flowpilot/
|-- README.md                           # Master Project Guide & Architecture
|-- .gitignore                          # Git exclusions (credentials, caches)
|-- .dockerignore                       # Docker build context exclusions
|-- .env.example                        # Template environment variables
|-- docker-compose.yml                  # Local development orchestration
|-- docker-compose.prod.yml             # Hardened production orchestration
|-- .github/workflows/ci.yml            # CI/CD pipeline (Ruff, Mypy, Pytest, Vitest, Build)
|-- docker/nginx/nginx.conf             # Production Nginx reverse proxy & security headers
|-- docs/                               # Engineering & architectural documentation
|   |-- product-requirements.md         # Full PRD and acceptance criteria
|   |-- architecture.md                 # C4 system models & data boundaries
|   |-- database-design.md              # Database schemas, ERD & indexing strategy
|   |-- api-specification.md            # REST API contracts & error formats
|   |-- security.md                     # RBAC matrix, encryption, token lifecycle
|   |-- workflow-engine.md              # Execution engine & approval lifecycle
|   |-- ui-design.md                    # UI/UX design tokens & React Flow design
|   |-- production-deployment.md        # Production guide, health probes & rollbacks
|   `-- operations/secret-rotation.md   # Secret rotation & disaster recovery runbook
|-- backend/                            # FastAPI, SQLAlchemy, Celery, Alembic
|   |-- Dockerfile.prod                 # Hardened non-root production container
|   |-- app/
|   |   |-- main.py                     # ASGI application entrypoint
|   |   |-- engine/                     # Workflow execution & condition evaluator
|   |   |-- routers/                    # REST endpoints (auth, workflows, webhooks, SLA)
|   |   |-- services/                   # Business logic (AI, CRM, Slack, analytics)
|   |   `-- workers/                    # Celery app & task definitions
|   `-- tests/                          # 276 automated test cases
`-- frontend/                           # React 18, Vite, TypeScript, Tailwind
    |-- Dockerfile.prod                 # Multi-stage Nginx container with SPA routing
    |-- nginx.conf                      # SPA try_files configuration
    |-- src/
    |   |-- components/                 # Workflow editor, analytics, approvals UI
    |   |-- pages/                      # Dashboard, Executions, Settings views
    |   `-- services/                   # Typed API client & queries
    `-- src/tests/                      # 59 automated Vitest test cases
```

---

## 7. Roadmap & Verification Status

- [x] **Phase 0**: Workspace & System Inspection
- [x] **Phase 1**: Project Architecture & Documentation Specifications
- [x] **Phase 2**: Backend, Frontend & Docker Scaffolding with Health Checks
- [x] **Phase 3**: PostgreSQL Database Design & Alembic Migrations (14 Tables)
- [x] **Phase 4**: Multi-Tenant Authentication, Argon2id & RBAC Guards
- [x] **Phase 5**: Dashboard Shell, Navigation & Layout
- [x] **Phase 6**: Workflow CRUD, DAG Cycle Detection & Step Configuration APIs
- [x] **Phase 7**: Deterministic Workflow Execution Engine
- [x] **Phase 8**: High-Throughput Webhook Processing & Redis Idempotency
- [x] **Phase 9**: AI Classification Service with Schema Validation & Fallbacks
- [x] **Phase 10**: Business Rule Engine & Human-in-the-Loop Approvals
- [x] **Phase 11**: Mock CRM & Slack Integration Executors
- [x] **Phase 12**: Celery & Redis Background Worker Pipeline
- [x] **Phase 13**: Execution Telemetry, Step Timelines & Tamper-Evident Audit Logging
- [x] **Phase 14**: React Flow Visual Workflow Builder Canvas
- [x] **Phase 15**: Execution Analytics, SLA Monitoring & Metrics Dashboard
- [x] **Phase 16**: Automated Testing, Security Hardening & Production CI/CD
- [x] **v1.0.0-rc1 Release Audit**: Completed & Verified

---

## 8. Documentation Index

- [Architecture & C4 Diagrams](docs/architecture.md)
- [Database ERD & Schema](docs/database-design.md)
- [API Specifications](docs/api-specification.md)
- [Security & RBAC Matrix](docs/security.md)
- [Workflow Engine Internals](docs/workflow-engine.md)
- [Production Deployment Guide](docs/production-deployment.md)
- [Secret Rotation Runbook](docs/operations/secret-rotation.md)

---

## 9. License

This project is licensed under the MIT License - see the LICENSE file for details.

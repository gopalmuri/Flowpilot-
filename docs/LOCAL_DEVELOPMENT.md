# FlowPilot — Local Development & Contributing Guide

> **Developer Setup, Testing Workflows, and Local Tooling**  
> *Release Candidate (RC-1.0) Development Manual*

---

## 1. Local Prerequisites

- **Python**: 3.13+ installed
- **Node.js**: v18.0+ or v20.0+ LTS
- **PostgreSQL**: 16.x (via native service, WSL2, or Docker)
- **Redis**: 7.x (via native service, WSL2, or Docker)
- **Git**: 2.38+

---

## 2. Infrastructure Services Setup

If using WSL2 or native Linux services:
```bash
# Start PostgreSQL 16 & Redis 7
sudo service postgresql start
sudo service redis-server start

# Verify listening ports
sudo ss -tulpn | grep -E '5432|6379'
```

Alternatively, use the development Docker Compose stack:
```bash
docker compose up -d postgres redis
```

---

> **Shortcut:** `.\scripts\dev.ps1 setup` (Windows) or `make setup` (macOS/Linux) performs the venv, dependency and `.env` steps below. Python 3.12+ is required; always use the project venv, since globally installed packages (e.g. SQLAlchemy 1.x) will break the backend.

## 3. Backend Setup & Startup

```bash
cd E:\flowpilot\backend

# 1. Create and activate virtual environment
python -m venv venv
venv\Scripts\activate  # Windows PowerShell
# source venv/bin/activate  # macOS / Linux

# 2. Install dependencies
pip install -r requirements-dev.txt

# 3. Configure environment
cp ../.env.example .env   # template lives at the repo root

# 4. Start FastAPI server with live reload (Port 8000)
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### Start the Background Celery Worker (In separate terminal)
```bash
cd E:\flowpilot\backend
venv\Scripts\activate

# Start Celery worker (use -P solo on Windows)
celery -A app.workers.celery_app.celery_app worker --loglevel=info -P solo
```

### Start the Celery Beat scheduler (one terminal, exactly one process)
Periodic work (the outbound-delivery relay every 15 s, stale-delivery recovery every 60 s, approval-resume recovery
every 120 s) only runs while a scheduler is running. Without it, committed deliveries are still sent when something
nudges the relay, and the worker also runs recovery once each time it starts, but nothing re-queues a lost task.
```bash
cd E:\flowpilot\backend
venv\Scripts\activate
celery -A app.workers.celery_app.celery_app beat --loglevel=info --schedule=%TEMP%\celerybeat-schedule
```
Verify it is really running: the Integrations page warns when no heartbeat is seen, beat stamps
`flowpilot:beat:last_tick` in Redis every 30 s (`redis-cli GET flowpilot:beat:last_tick`), and
`python -c "from app.workers.celery_app import celery_app as c; print(c.conf.beat_schedule)"` lists the schedule.
Gmail setup is in `docs/GMAIL_INTEGRATION.md`.

Never run two beat processes against the same broker: every periodic task would be enqueued twice. (Duplicates are
harmless to correctness because each delivery can be claimed once, but they waste work.) With Docker Compose use
`docker compose up -d celery_beat`; the service has a fixed `container_name`, so Compose refuses to scale it.

---

## 4. Frontend Setup & Startup

```bash
cd E:\flowpilot\frontend

# 1. Install dependencies
npm install

# 2. Start Vite dev server (Port 5173)
npm run dev
```

Visit the application:
- **Landing Page**: `http://localhost:5173/`
- **Dashboard**: `http://localhost:5173/dashboard`
- **FastAPI OpenAPI Swagger**: `http://localhost:8000/docs`
- **Health Check**: `http://localhost:8000/health`

---

## 5. Running the Test Suites

### Backend Unit & Integration Tests (276 Tests)
```bash
cd E:\flowpilot\backend
pytest
```

### Frontend Unit & Component Tests (59 Tests)
```bash
cd E:\flowpilot\frontend
npm test -- --run
```

### Frontend Code Quality Checks
```bash
cd E:\flowpilot\frontend

# ESLint inspection (must pass with 0 errors)
npm run lint

# TypeScript compilation and production bundle build
npm run build
```

---

## 6. Common Troubleshooting

| Issue | Root Cause | Solution |
| :--- | :--- | :--- |
| `PostgreSQL connection refused` | Database daemon stopped | Run `sudo service postgresql start` or verify `DATABASE_URL` port. |
| `Celery broker connection error` | Redis daemon stopped | Run `sudo service redis-server start` or check `CELERY_BROKER_URL`. |
| `FastAPI CORS error in browser` | Missing frontend origin | Verify `CORS_ORIGINS` in `.env` includes `http://localhost:5173`. |
| `Windows Celery worker freeze` | Default prefork pool on Windows | Add `-P solo` flag when starting Celery on Windows. |

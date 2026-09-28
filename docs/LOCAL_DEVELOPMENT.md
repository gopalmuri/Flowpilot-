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

## 3. Backend Setup & Startup

```bash
cd E:\flowpilot\backend

# 1. Create and activate virtual environment
python -m venv venv
venv\Scripts\activate  # Windows PowerShell
# source venv/bin/activate  # macOS / Linux

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env

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

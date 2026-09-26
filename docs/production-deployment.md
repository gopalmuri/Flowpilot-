# FlowPilot - Production Deployment Guide

## 1. Overview & Architecture

FlowPilot production deployment is architected for high availability, zero secret leakage, defense-in-depth security, and sub-100ms API response times.

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

## 2. Environment Variables & Configuration

The application validates all settings at startup. In `ENVIRONMENT=production`, running with default secrets, missing encryption keys, or `DEBUG=True` causes immediate process termination with code 1.

| Variable | Required | Production Constraint | Purpose |
| :--- | :--- | :--- | :--- |
| `ENVIRONMENT` | Yes | Must be `production` | Enforces strict validation |
| `DEBUG` | Yes | Must be `False` | Prevents stack trace leakage |
| `SECRET_KEY` | Yes | Min 32 chars, cannot contain "change-this" | Signs JWT and session tokens |
| `FIELD_ENCRYPTION_KEY` | Yes | 32-byte hex (64 chars) or base64 Fernet | AES-256-GCM database encryption |
| `DATABASE_URL` | Yes | `postgresql+asyncpg://...` | Asynchronous database connection |
| `REDIS_URL` | Yes | `redis://[:password@]host:port/0` | Sliding window rate limiting & locks |
| `CELERY_BROKER_URL` | Yes | `redis://[:password@]host:port/1` | Background task message queue |
| `CELERY_RESULT_BACKEND` | Yes | `redis://[:password@]host:port/2` | Async task execution results |
| `CORS_ORIGINS` | Yes | Exact domain list, NO wildcards `*` | Prevents cross-origin credential leaks |
| `FORCE_HTTPS` | Yes | Must be `True` | Enforces HSTS and secure cookies |
| `RATE_LIMIT_ENABLED` | Yes | Must be `True` | Enables sliding window throttling |

---

## 3. Database Migration Policy & Deployment Continuity

- **Backward-Compatible Schema Evolution**: All database migrations must be forward- and backward-compatible. Schema changes must support N-1 application versions simultaneously. Destructive migrations (column drops, renames) must follow a 2-phase release cycle.
- **Pre-Deployment Execution**: Always run lembic upgrade head before booting new application worker instances:

`ash
# Execute migrations prior to container restart
docker compose -f docker-compose.prod.yml run --rm backend alembic upgrade head
`

- **Deployment Availability & Rolling Update Notice**:
  - The baseline production Docker Compose architecture runs a single backend service upstream (`backend:8000`). Consequently, container recreation during application updates may involve a brief 1–3 second service interruption.
  - The current Compose setup is fully functional and suitable as the baseline production deployment for FlowPilot v1.0.0-rc1.
  - Achieving true zero-downtime rolling deployments requires running multiple backend replicas behind a load balancer with health-checked rolling restarts (e.g. Kubernetes, Docker Swarm, or AWS ECS).

---

## 4. Containerized Orchestration

### Starting the Production Cluster
```bash
# 1. Build production images
docker compose -f docker-compose.prod.yml build

# 2. Start core datastores (PostgreSQL, Redis)
docker compose -f docker-compose.prod.yml up -d postgres redis

# 3. Apply schema migrations
docker compose -f docker-compose.prod.yml run --rm backend alembic upgrade head

# 4. Bring up backend workers, frontend, and reverse proxy
docker compose -f docker-compose.prod.yml up -d
```

---

## 5. Health Probes & Monitoring

FlowPilot provides two decoupled health endpoints:

### Liveness Probe (`GET /health/live`)
- **Purpose**: Kubernetes/Docker liveness check.
- **Verification**: Fast, internal memory check. Never connects to external dependencies.
- **HTTP Code**: Always returns `200 OK` if the process is responsive.

### Readiness Probe (`GET /health/ready`)
- **Purpose**: Load balancer traffic routing decision.
- **Verification**: Actively pings PostgreSQL (`SELECT 1`), Redis (`PING`), and checks Celery broker connectivity.
- **HTTP Code**:
  - `200 OK`: All dependencies operational.
  - `503 Service Unavailable`: One or more subsystems degraded.

---

## 6. Rollback Procedures

If an anomalous regression is detected post-deployment:

1. **Traffic Drain**: Stop sending traffic to degraded containers via load balancer.
2. **Revert Application Image**:
   ```bash
   docker tag flowpilot-backend:previous flowpilot-backend:latest
   docker compose -f docker-compose.prod.yml up -d --no-deps backend celery_worker
   ```
3. **Database Rollback** (Only if forward compatibility is broken):
   ```bash
   docker compose -f docker-compose.prod.yml run --rm backend alembic downgrade -1
   ```
4. **Cache Invalidation**:
   ```bash
   docker compose -f docker-compose.prod.yml exec redis redis-cli -a "$REDIS_PASSWORD" FLUSHDB
   ```

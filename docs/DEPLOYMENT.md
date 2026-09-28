# FlowPilot — Production Deployment & Operations Guide

> **Release Candidate (RC-1.0) Deployment Runbook**  
> *Target Audience: DevOps Engineers, Site Reliability Engineers (SRE), Platform Leads*

---

## 1. System Requirements & Hardware Sizing

### Minimum Production Specifications
- **CPU**: 4 vCPUs (x86_64 or ARM64)
- **RAM**: 8 GB ECC RAM
- **Disk**: 50 GB NVMe / SSD Storage
- **Operating System**: Ubuntu 22.04 LTS, Debian 12, or Enterprise Linux (RHEL 9)
- **Container Runtime**: Docker Engine 24.0+ & Docker Compose 2.20+

---

## 2. Environment Configuration Reference

Create a production `.env` file in the project root:

```ini
# Core Application Settings
ENVIRONMENT=production
DEBUG=False
FORCE_HTTPS=True
SECRET_KEY=change-me-to-a-cryptographically-secure-random-64-char-string
FIELD_ENCRYPTION_KEY=your-32-byte-base64-encoded-fernet-key-here

# Database Settings
POSTGRES_USER=flowpilot_admin
POSTGRES_PASSWORD=use-a-strong-random-password-here
POSTGRES_DB=flowpilot_prod
DATABASE_URL=postgresql+asyncpg://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}

# Cache & Message Broker (Redis)
REDIS_PASSWORD=use-a-strong-redis-password-here
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0
CELERY_BROKER_URL=redis://:${REDIS_PASSWORD}@redis:6379/1
CELERY_RESULT_BACKEND=redis://:${REDIS_PASSWORD}@redis:6379/2

# Networking & CORS
CORS_ORIGINS=["https://flowpilot.yourcompany.com"]
COOKIE_SECURE=True
COOKIE_SAMESITE=lax

# Optional AI Providers (Defaults to Mock Provider if not supplied)
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
```

---

## 3. Production Deployment Commands

### 3.1 Initial Deployment
```bash
# 1. Clone repository
git clone https://github.com/your-org/flowpilot.git /opt/flowpilot
cd /opt/flowpilot

# 2. Configure production environment
cp .env.example .env
nano .env

# 3. Mount SSL/TLS certificates
mkdir -p certs
cp /etc/letsencrypt/live/flowpilot.yourcompany.com/fullchain.pem certs/flowpilot.crt
cp /etc/letsencrypt/live/flowpilot.yourcompany.com/privkey.pem certs/flowpilot.key

# 4. Build and start services via Docker Compose
docker compose -f docker-compose.prod.yml up -d --build

# 5. Verify service health
docker compose -f docker-compose.prod.yml ps
```

---

## 4. Verification & Health Monitoring

The deployment is verified against three probe endpoints:

```bash
# Liveness probe
curl -f https://flowpilot.yourcompany.com/health

# Subsystem readiness probe (checks PostgreSQL, Redis, Celery)
curl -f https://flowpilot.yourcompany.com/api/v1/health/ready
```

Expected readiness output:
```json
{
  "status": "ready",
  "services": {
    "database": "ready",
    "redis": "ready",
    "celery_broker": "ready"
  },
  "timestamp": "2026-09-28T12:00:00Z"
}
```

---

## 5. Backup & Disaster Recovery

### Automated PostgreSQL Backup
```bash
# Daily snapshot
docker exec -t flowpilot-prod-postgres pg_dump -U flowpilot_admin flowpilot_prod | gzip > /opt/backups/flowpilot_$(date +%Y%m%d_%H%M%S).sql.gz

# Restore from snapshot
gunzip < /opt/backups/flowpilot_20260928_120000.sql.gz | docker exec -i flowpilot-prod-postgres psql -U flowpilot_admin -d flowpilot_prod
```

---

## 6. Rolling Upgrades & Rollback Procedures

### Rolling Upgrade
```bash
# Pull latest release candidate
git pull origin main

# Build updated images without dropping current traffic
docker compose -f docker-compose.prod.yml build

# Recreate containers with zero downtime
docker compose -f docker-compose.prod.yml up -d --no-deps backend celery_worker frontend
```

### Rollback Procedure
```bash
# Revert to previous release tag
git checkout tags/v1.0.0-rc1

# Re-deploy
docker compose -f docker-compose.prod.yml up -d --build
```

# FlowPilot: Testing Strategy Specification

| Metadata | Specification |
|---|---|
| **Document Version** | 1.0.0 |
| **Status** | Approved for MVP (Phase 1) |
| **Backend Testing Framework** | Pytest + Pytest-asyncio + HTTPX |
| **Frontend Testing Framework** | Vitest + React Testing Library |
| **Coverage Requirement** | >= 85% Core Engine, >= 80% Overall Codebase |

---

## 1. Testing Pyramid & Principles

```
           / \
          /   \     E2E Simulation Tests (Lead Automation Flow)
         /     \    -------------------------------------------
        / API   \   FastAPI AsyncClient Route & Tenancy Tests
       /---------\  -------------------------------------------
      / Integration\ Database Migrations, Redis Idempotency, Celery
     /---------------\ -------------------------------------------
    /   Unit Tests    \ Pydantic Schemas, AST Rules, DAG Sorters, Security
   /-------------------\
```

1. **Deterministic Isolation**: Tests must run hermetically without requiring external third-party API connections (no real OpenAI, Slack, or CRM requests are made during test runs).
2. **Multi-Tenant Security Testing**: Every endpoint must be explicitly tested with mismatched tenant headers to assert `404 Not Found` or `403 Forbidden` responses.
3. **Transaction Rollbacks**: Integration tests run inside isolated database transactions that roll back upon test completion, preventing state pollution.

---

## 2. Test Suites Organization

### 2.1 Backend Tests (`backend/tests/`)

```
backend/tests/
├── conftest.py                     # Global pytest fixtures (async DB, Redis mock, auth headers)
├── unit/
│   ├── test_security.py            # Argon2 password hashing, JWT signing & expiration
│   ├── test_rule_engine.py         # Boolean expression AST evaluator (==, !=, >, <, AND, OR)
│   ├── test_workflow_validator.py  # DAG cycle detection, orphan nodes, trigger validation
│   ├── test_ai_schemas.py          # AI classification Pydantic validation & boundary checks
│   └── test_idempotency.py         # Redis key hashing and TTL expiration logic
├── integration/
│   ├── test_database_isolation.py  # Cross-tenant query boundary assertions
│   ├── test_step_executors.py      # BaseStepExecutor implementations with mock inputs
│   ├── test_mock_crm.py            # Mock CRM lead creation and error handling
│   └── test_slack_notifier.py      # Slack webhook block builder and payload verification
└── api/
    ├── test_auth_api.py            # Registration, login, token refresh, current user
    ├── test_organizations_api.py   # Membership management, RBAC enforcement
    ├── test_workflows_api.py       # Workflow CRUD, version publishing, pause/resume
    ├── test_webhooks_api.py        # Fast 202 ACK (<100ms), idempotency deduplication
    ├── test_approvals_api.py       # Manager approve/reject, permission checks
    └── test_health_api.py          # Health check endpoint verification
```

---

## 3. Mocking Strategy & Test Fixtures

### 3.1 Deterministic Mock AI Provider
To prevent latency, token costs, and non-deterministic test flakiness, tests use `MockAIProvider`:
```python
class MockAIProvider(BaseAIProvider):
    async def classify_lead(self, lead_data: LeadInputSchema) -> AIClassificationOutput:
        if lead_data.employee_count >= 100:
            return AIClassificationOutput(
                lead_category="enterprise",
                priority="high",
                confidence=0.95,
                reason="Large company with enterprise requirements"
            )
        return AIClassificationOutput(
            lead_category="smb",
            priority="low",
            confidence=0.88,
            reason="Small business with standard self-serve needs"
        )
```

### 3.2 Webhook Fast Acknowledgement Benchmark Test
Validates the user requirement that webhook ingestion returns within **< 100ms**:
```python
@pytest.mark.asyncio
async def test_webhook_ingestion_latency_under_100ms(async_client, active_workflow):
    payload = {"event_id": "bench_01", "name": "Test", "email": "test@example.com"}
    start_time = time.perf_counter()
    response = await async_client.post(
        f"/api/v1/webhooks/{active_workflow.webhook_key}",
        json=payload
    )
    elapsed_ms = (time.perf_counter() - start_time) * 1000
    assert response.status_code == 202
    assert elapsed_ms < 100, f"Webhook response took {elapsed_ms}ms, exceeding 100ms target"
```

---

## 4. Test Execution Commands

| Environment | Command | Scope |
|---|---|---|
| **Local (Docker)** | `docker compose exec backend pytest` | Full backend test suite |
| **Local (PowerShell)** | `.\scripts\dev.ps1 test` | Backend and frontend tests |
| **Unit Tests Only** | `pytest backend/tests/unit -v` | Fast in-memory unit tests |
| **Coverage Report** | `pytest backend/tests --cov=app --cov-report=term-missing` | Code coverage verification |
| **Frontend Tests** | `npm run test` (in `frontend/`) | Vitest unit and component tests |

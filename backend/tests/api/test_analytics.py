import asyncio
import uuid
from datetime import datetime, timedelta, timezone
import pytest
from httpx import AsyncClient
from sqlalchemy import text

from contextlib import asynccontextmanager
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from app.core.config import settings

@asynccontextmanager
async def get_test_db():
    engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    maker = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with maker() as session:
            yield session
    finally:
        await engine.dispose()
from app.models.membership import OrganizationRole


async def create_authenticated_user(async_client: AsyncClient, name: str):
    unique = uuid.uuid4().hex[:8]
    email = f"{name}_{unique}@flowpilot.internal"
    password = f"SecurePass_{unique}!123"
    reg_payload = {
        "email": email,
        "password": password,
        "full_name": f"{name.capitalize()} User",
    }
    await async_client.post("/api/v1/auth/register", json=reg_payload)
    login_resp = await async_client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    return email, password, headers


async def create_org_and_owner(async_client: AsyncClient, name: str):
    email, password, headers = await create_authenticated_user(async_client, name)
    resp = await async_client.post(
        "/api/v1/organizations",
        headers=headers,
        json={"name": f"{name.capitalize()} Analytics Corp"},
    )
    assert resp.status_code == 201
    org_id = resp.json()["id"]

    login_resp = await async_client.post(
        "/api/v1/auth/login", json={"email": email, "password": password, "organization_id": org_id}
    )
    org_token = login_resp.json()["access_token"]
    return org_id, {"Authorization": f"Bearer {org_token}"}, email, password


# ==============================================================================
# 1. SLA Validation Rules
# ==============================================================================

@pytest.mark.asyncio
async def test_sla_validation_rules(async_client: AsyncClient):
    """Verifies strict SLA validation: positive targets, finite numbers, warning < target, <= 7 days."""
    org_id, headers, _, _ = await create_org_and_owner(async_client, "sla_val")

    # Create workflow
    wf_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows",
        headers=headers,
        json={"name": "SLA Validation Flow"},
    )
    assert wf_res.status_code == 201
    wf = wf_res.json()
    wf_id = wf["id"]

    v_res = await async_client.get(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
        headers=headers,
    )
    v1_id = v_res.json()[0]["id"]

    # 1. Valid SLA configuration -> 200 OK
    valid_res = await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/sla",
        headers=headers,
        json={"target_seconds": 60.0, "warning_threshold_seconds": 45.0, "enabled": True},
    )
    assert valid_res.status_code == 200
    sla_data = valid_res.json()["sla"]
    assert sla_data["target_seconds"] == 60.0
    assert sla_data["warning_threshold_seconds"] == 45.0
    assert sla_data["enabled"] is True

    # 2. target_seconds <= 0 -> 422
    neg_target = await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/sla",
        headers=headers,
        json={"target_seconds": 0.0, "warning_threshold_seconds": 0.0, "enabled": True},
    )
    assert neg_target.status_code == 422

    # 3. warning_threshold_seconds < 0 -> 422
    neg_warning = await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/sla",
        headers=headers,
        json={"target_seconds": 60.0, "warning_threshold_seconds": -5.0, "enabled": True},
    )
    assert neg_warning.status_code == 422

    # 4. warning >= target -> 422
    warn_gt_target = await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/sla",
        headers=headers,
        json={"target_seconds": 30.0, "warning_threshold_seconds": 35.0, "enabled": True},
    )
    assert warn_gt_target.status_code == 422

    # 5. target > 604800 (7 days) -> 422
    too_large = await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/sla",
        headers=headers,
        json={"target_seconds": 700000.0, "warning_threshold_seconds": 100.0, "enabled": True},
    )
    assert too_large.status_code == 422


# ==============================================================================
# 2. SLA Versioning: Draft Updates vs. Published Immutability
# ==============================================================================

@pytest.mark.asyncio
async def test_sla_version_scoped_draft_update_and_published_immutability(async_client: AsyncClient):
    """Verifies that SLA is version-scoped, editable on drafts, and strictly immutable on published versions."""
    org_id, headers, _, _ = await create_org_and_owner(async_client, "sla_immut")

    # Create workflow
    wf_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows",
        headers=headers,
        json={"name": "SLA Versioning Test"},
    )
    wf_id = wf_res.json()["id"]

    v_res = await async_client.get(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
        headers=headers,
    )
    v1_id = v_res.json()[0]["id"]

    # 1. Update SLA on draft v1
    sla_res = await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/sla",
        headers=headers,
        json={"target_seconds": 40.0, "warning_threshold_seconds": 30.0, "enabled": True},
    )
    assert sla_res.status_code == 200

    # 2. Add valid trigger step to v1 and publish
    await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=headers,
        json={
            "steps": [
                {"step_key": "start", "step_type": "MANUAL_TRIGGER", "name": "Start", "config": {}},
            ],
            "connections": [],
        },
    )
    pub_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )
    assert pub_res.status_code == 200

    # 3. Attempt to update SLA on published v1 -> must fail with HTTP 400
    pub_sla_res = await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/sla",
        headers=headers,
        json={"target_seconds": 50.0, "warning_threshold_seconds": 35.0, "enabled": True},
    )
    assert pub_sla_res.status_code == 400
    assert "immutable" in pub_sla_res.json()["detail"].lower()

    # 4. Create draft v2 (cloned from v1)
    v2_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
        headers=headers,
        json={"base_version_id": v1_id},
    )
    assert v2_res.status_code == 201
    v2_id = v2_res.json()["id"]

    # 5. SLA can be updated on draft v2
    v2_sla_res = await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v2_id}/sla",
        headers=headers,
        json={"target_seconds": 25.0, "warning_threshold_seconds": 15.0, "enabled": True},
    )
    assert v2_sla_res.status_code == 200
    assert v2_sla_res.json()["sla"]["target_seconds"] == 25.0


# ==============================================================================
# 3. SLA Audit Event Emitted
# ==============================================================================

@pytest.mark.asyncio
async def test_sla_audit_event_emitted_with_no_secrets(async_client: AsyncClient):
    """Verifies that workflow.sla_updated is emitted to audit_logs without secrets."""
    org_id, headers, _, _ = await create_org_and_owner(async_client, "sla_audit")

    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "SLA Audit Flow"},
        )
    ).json()
    wf_id = wf["id"]

    v1_id = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
            headers=headers,
        )
    ).json()[0]["id"]

    # Update SLA
    await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/sla",
        headers=headers,
        json={"target_seconds": 15.0, "warning_threshold_seconds": 10.0, "enabled": True},
    )

    # Query audit logs
    audit_res = await async_client.get(
        f"/api/v1/organizations/{org_id}/audit-logs",
        headers=headers,
        params={"action": "workflow.sla_updated"},
    )
    assert audit_res.status_code == 200
    logs = audit_res.json()["items"]
    assert len(logs) >= 1
    sla_log = logs[0]
    assert sla_log["action"] == "workflow.sla_updated"
    assert sla_log["resource_type"] == "workflow"
    assert sla_log["resource_id"] == wf_id
    assert sla_log["details"]["new_sla"]["target_seconds"] == 15.0
    assert "token" not in str(sla_log["details"]).lower()
    assert "password" not in str(sla_log["details"]).lower()


# ==============================================================================
# 4. SLA & Analytics RBAC
# ==============================================================================

@pytest.mark.asyncio
async def test_sla_and_analytics_rbac(async_client: AsyncClient):
    """Verifies that VIEWER and OPERATOR cannot configure SLA (403), but can read analytics (200)."""
    org_id, owner_headers, _, _ = await create_org_and_owner(async_client, "rbac_sla")

    # Register manager, operator, viewer
    mgr_email, mgr_pw, _ = await create_authenticated_user(async_client, "mgr")
    op_email, op_pw, _ = await create_authenticated_user(async_client, "op")
    view_email, view_pw, _ = await create_authenticated_user(async_client, "view")

    await async_client.post(
        f"/api/v1/organizations/{org_id}/members",
        headers=owner_headers,
        json={"email": mgr_email, "role": "MANAGER"},
    )
    await async_client.post(
        f"/api/v1/organizations/{org_id}/members",
        headers=owner_headers,
        json={"email": op_email, "role": "OPERATOR"},
    )
    await async_client.post(
        f"/api/v1/organizations/{org_id}/members",
        headers=owner_headers,
        json={"email": view_email, "role": "VIEWER"},
    )

    # Get org tokens
    def get_token_header(resp):
        return {"Authorization": f"Bearer {resp.json()['access_token']}"}

    mgr_headers = get_token_header(
        await async_client.post("/api/v1/auth/login", json={"email": mgr_email, "password": mgr_pw, "organization_id": org_id})
    )
    op_headers = get_token_header(
        await async_client.post("/api/v1/auth/login", json={"email": op_email, "password": op_pw, "organization_id": org_id})
    )
    view_headers = get_token_header(
        await async_client.post("/api/v1/auth/login", json={"email": view_email, "password": view_pw, "organization_id": org_id})
    )

    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=owner_headers,
            json={"name": "RBAC Flow"},
        )
    ).json()
    wf_id = wf["id"]
    v1_id = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
            headers=owner_headers,
        )
    ).json()[0]["id"]

    # 1. Manager can update SLA -> 200
    mgr_sla = await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/sla",
        headers=mgr_headers,
        json={"target_seconds": 30.0, "warning_threshold_seconds": 20.0, "enabled": True},
    )
    assert mgr_sla.status_code == 200

    # 2. Operator cannot update SLA -> 403 Forbidden
    op_sla = await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/sla",
        headers=op_headers,
        json={"target_seconds": 40.0, "warning_threshold_seconds": 25.0, "enabled": True},
    )
    assert op_sla.status_code == 403

    # 3. Viewer cannot update SLA -> 403 Forbidden
    view_sla = await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/sla",
        headers=view_headers,
        json={"target_seconds": 40.0, "warning_threshold_seconds": 25.0, "enabled": True},
    )
    assert view_sla.status_code == 403

    # 4. Viewer can read all analytics endpoints -> 200 OK
    assert (await async_client.get(f"/api/v1/organizations/{org_id}/analytics/overview", headers=view_headers)).status_code == 200
    assert (await async_client.get(f"/api/v1/organizations/{org_id}/analytics/time-series", headers=view_headers)).status_code == 200
    assert (await async_client.get(f"/api/v1/organizations/{org_id}/analytics/workflows", headers=view_headers)).status_code == 200
    assert (await async_client.get(f"/api/v1/organizations/{org_id}/analytics/steps", headers=view_headers)).status_code == 200
    assert (await async_client.get(f"/api/v1/organizations/{org_id}/analytics/sla", headers=view_headers)).status_code == 200


# ==============================================================================
# 5. Cross-Tenant Isolation
# ==============================================================================

@pytest.mark.asyncio
async def test_analytics_cross_tenant_isolation(async_client: AsyncClient):
    """Verifies that attempting cross-tenant analytics access returns 404."""
    org_a_id, headers_a, _, _ = await create_org_and_owner(async_client, "org_a")
    org_b_id, headers_b, _, _ = await create_org_and_owner(async_client, "org_b")

    # Org A tries to access Org B analytics overview -> 404
    cross_resp = await async_client.get(
        f"/api/v1/organizations/{org_b_id}/analytics/overview",
        headers=headers_a,
    )
    assert cross_resp.status_code == 404

    # Create workflow in Org B
    wf_b = (
        await async_client.post(
            f"/api/v1/organizations/{org_b_id}/workflows",
            headers=headers_b,
            json={"name": "Org B Workflow"},
        )
    ).json()

    # Org A tries to pass Org B workflow_id -> 404
    cross_wf_resp = await async_client.get(
        f"/api/v1/organizations/{org_a_id}/analytics/overview",
        headers=headers_a,
        params={"workflow_id": wf_b["id"]},
    )
    assert cross_wf_resp.status_code == 404


# ==============================================================================
# 6. Date Range Validation
# ==============================================================================

@pytest.mark.asyncio
async def test_date_range_validation(async_client: AsyncClient):
    """Verifies rejection of date ranges > 90 days and start_time >= end_time."""
    org_id, headers, _, _ = await create_org_and_owner(async_client, "date_range")

    now = datetime.now(timezone.utc)
    # 1. Range > 90 days (e.g. 100 days) -> 400
    start_100d = (now - timedelta(days=100)).isoformat()
    end_now = now.isoformat()
    resp_too_large = await async_client.get(
        f"/api/v1/organizations/{org_id}/analytics/overview",
        headers=headers,
        params={"start_time": start_100d, "end_time": end_now},
    )
    assert resp_too_large.status_code == 400
    assert "90 days" in resp_too_large.json()["detail"]

    # 2. start_time >= end_time -> 400
    resp_inverted = await async_client.get(
        f"/api/v1/organizations/{org_id}/analytics/overview",
        headers=headers,
        params={"start_time": end_now, "end_time": start_100d},
    )
    assert resp_inverted.status_code == 400
    assert "strictly before" in resp_inverted.json()["detail"]


# ==============================================================================
# 7. Execution Volume Metrics (including PENDING & In-Flight)
# ==============================================================================

@pytest.mark.asyncio
async def test_execution_volume_metrics_including_pending_and_rates(async_client: AsyncClient):
    """Verifies that PENDING is included in total and in_flight, and terminal rates use terminal denominator."""
    org_id, headers, _, _ = await create_org_and_owner(async_client, "vol_calc")

    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "Volume Flow"},
        )
    ).json()
    wf_id = wf["id"]
    v1_id = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
            headers=headers,
        )
    ).json()[0]["id"]

    # Insert executions directly to test various statuses
    async with get_test_db() as session:
        statuses = ["SUCCESS", "FAILED", "CANCELLED", "RUNNING", "PENDING", "WAITING_APPROVAL"]
        now = datetime.now(timezone.utc)
        for s in statuses:
            started = now - timedelta(minutes=10)
            completed = now if s in ("SUCCESS", "FAILED", "CANCELLED") else None
            await session.execute(
                text("""
                    INSERT INTO workflow_runs (
                        id, organization_id, workflow_id, workflow_version_id,
                        status, trigger_type, correlation_id, started_at, completed_at, trigger_payload,
                        created_at, updated_at
                    ) VALUES (
                        gen_random_uuid(), :org_id, :wf_id, :v_id,
                        :status, 'MANUAL', gen_random_uuid()::text, :started, :completed, '{}'::jsonb,
                        NOW(), NOW()
                    )
                """),
                {
                    "org_id": org_id,
                    "wf_id": wf_id,
                    "v_id": v1_id,
                    "status": s,
                    "started": started,
                    "completed": completed,
                },
            )
        await session.commit()

    resp = await async_client.get(
        f"/api/v1/organizations/{org_id}/analytics/overview",
        headers=headers,
        params={"range": "24h"},
    )
    assert resp.status_code == 200
    vol = resp.json()["volume"]
    assert vol["total"] == 6  # 3 terminal + 3 in-flight (PENDING included!)
    assert vol["terminal"] == 3
    assert vol["in_flight"] == 3
    assert vol["pending_count"] == 1
    assert vol["running_count"] == 1
    assert vol["waiting_approval_count"] == 1
    assert vol["success_count"] == 1
    assert vol["failed_count"] == 1
    assert vol["cancelled_count"] == 1
    # Rates must use terminal denominator: 1/3 * 100 = 33.33%
    assert vol["success_rate"] == 33.33
    assert vol["failure_rate"] == 33.33
    assert vol["cancellation_rate"] == 33.33


# ==============================================================================
# 8. Zero Terminal Executions
# ==============================================================================

@pytest.mark.asyncio
async def test_zero_terminal_executions_returns_zero_rates(async_client: AsyncClient):
    """Verifies that when terminal == 0, success/failure/cancellation rates are 0.0."""
    org_id, headers, _, _ = await create_org_and_owner(async_client, "zero_term")

    resp = await async_client.get(
        f"/api/v1/organizations/{org_id}/analytics/overview",
        headers=headers,
        params={"range": "24h"},
    )
    assert resp.status_code == 200
    vol = resp.json()["volume"]
    assert vol["total"] == 0
    assert vol["terminal"] == 0
    assert vol["success_rate"] == 0.0
    assert vol["failure_rate"] == 0.0
    assert vol["cancellation_rate"] == 0.0


# ==============================================================================
# 9. Duration Percentiles
# ==============================================================================

@pytest.mark.asyncio
async def test_duration_percentiles_calculation_and_empty_dataset(async_client: AsyncClient):
    """Verifies duration percentiles via PERCENTILE_CONT and empty dataset handling."""
    org_id, headers, _, _ = await create_org_and_owner(async_client, "dur_pct")

    # 1. Empty dataset returns 0.0
    resp_empty = await async_client.get(
        f"/api/v1/organizations/{org_id}/analytics/overview",
        headers=headers,
    )
    dur = resp_empty.json()["duration"]
    assert dur["avg_duration_ms"] == 0.0
    assert dur["p50_duration_ms"] == 0.0
    assert dur["p95_duration_ms"] == 0.0
    assert dur["p99_duration_ms"] == 0.0

    # 2. Insert runs with specific durations: 100ms, 200ms, 300ms, 400ms, 500ms
    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "Duration Flow"},
        )
    ).json()
    wf_id = wf["id"]
    v1_id = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
            headers=headers,
        )
    ).json()[0]["id"]

    now = datetime.now(timezone.utc)
    durations_ms = [100, 200, 300, 400, 500]
    async with get_test_db() as session:
        for d in durations_ms:
            start_ts = now - timedelta(seconds=10)
            end_ts = start_ts + timedelta(milliseconds=d)
            await session.execute(
                text("""
                    INSERT INTO workflow_runs (
                        id, organization_id, workflow_id, workflow_version_id,
                        status, trigger_type, correlation_id, started_at, completed_at, trigger_payload,
                        created_at, updated_at
                    ) VALUES (
                        gen_random_uuid(), :org_id, :wf_id, :v_id,
                        'SUCCESS', 'MANUAL', gen_random_uuid()::text, :started, :completed, '{}'::jsonb,
                        NOW(), NOW()
                    )
                """),
                {
                    "org_id": org_id,
                    "wf_id": wf_id,
                    "v_id": v1_id,
                    "started": start_ts,
                    "completed": end_ts,
                },
            )
        await session.commit()

    resp_data = await async_client.get(
        f"/api/v1/organizations/{org_id}/analytics/overview",
        headers=headers,
    )
    dur_data = resp_data.json()["duration"]
    assert dur_data["avg_duration_ms"] == 300.0
    assert dur_data["p50_duration_ms"] == 300.0
    assert dur_data["p95_duration_ms"] == 480.0
    assert dur_data["p99_duration_ms"] == 496.0


# ==============================================================================
# 10. SLA Metrics & Compliance Calculations
# ==============================================================================

@pytest.mark.asyncio
async def test_sla_compliance_healthy_breached_and_not_applicable_states(async_client: AsyncClient):
    """Verifies query-derived SLA evaluation across HEALTHY, WARNING, BREACHED, NOT_APPLICABLE states."""
    org_id, headers, _, _ = await create_org_and_owner(async_client, "sla_states")

    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "SLA Metrics Flow"},
        )
    ).json()
    wf_id = wf["id"]
    v1_id = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
            headers=headers,
        )
    ).json()[0]["id"]

    # Target: 30s, Warning: 20s
    await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/sla",
        headers=headers,
        json={"target_seconds": 30.0, "warning_threshold_seconds": 20.0, "enabled": True},
    )

    now = datetime.now(timezone.utc)
    async with get_test_db() as session:
        # Run 1: 10s completed -> HEALTHY
        await session.execute(
            text("""
                INSERT INTO workflow_runs (
                    id, organization_id, workflow_id, workflow_version_id,
                    status, trigger_type, correlation_id, started_at, completed_at, trigger_payload,
                    created_at, updated_at
                ) VALUES (
                    gen_random_uuid(), :org_id, :wf_id, :v_id,
                    'SUCCESS', 'MANUAL', gen_random_uuid()::text, :st, :ct, '{}'::jsonb,
                    NOW(), NOW()
                )
            """),
            {"org_id": org_id, "wf_id": wf_id, "v_id": v1_id, "st": now - timedelta(seconds=10), "ct": now},
        )
        # Run 2: 25s completed -> WARNING
        await session.execute(
            text("""
                INSERT INTO workflow_runs (
                    id, organization_id, workflow_id, workflow_version_id,
                    status, trigger_type, correlation_id, started_at, completed_at, trigger_payload,
                    created_at, updated_at
                ) VALUES (
                    gen_random_uuid(), :org_id, :wf_id, :v_id,
                    'SUCCESS', 'MANUAL', gen_random_uuid()::text, :st, :ct, '{}'::jsonb,
                    NOW(), NOW()
                )
            """),
            {"org_id": org_id, "wf_id": wf_id, "v_id": v1_id, "st": now - timedelta(seconds=25), "ct": now},
        )
        # Run 3: 35s completed -> BREACHED
        await session.execute(
            text("""
                INSERT INTO workflow_runs (
                    id, organization_id, workflow_id, workflow_version_id,
                    status, trigger_type, correlation_id, started_at, completed_at, trigger_payload,
                    created_at, updated_at
                ) VALUES (
                    gen_random_uuid(), :org_id, :wf_id, :v_id,
                    'FAILED', 'MANUAL', gen_random_uuid()::text, :st, :ct, '{}'::jsonb,
                    NOW(), NOW()
                )
            """),
            {"org_id": org_id, "wf_id": wf_id, "v_id": v1_id, "st": now - timedelta(seconds=35), "ct": now},
        )
        # Run 4: Cancelled at 5s (before warning threshold) -> NOT_APPLICABLE
        await session.execute(
            text("""
                INSERT INTO workflow_runs (
                    id, organization_id, workflow_id, workflow_version_id,
                    status, trigger_type, correlation_id, started_at, completed_at, trigger_payload,
                    created_at, updated_at
                ) VALUES (
                    gen_random_uuid(), :org_id, :wf_id, :v_id,
                    'CANCELLED', 'MANUAL', gen_random_uuid()::text, :st, :ct, '{}'::jsonb,
                    NOW(), NOW()
                )
            """),
            {"org_id": org_id, "wf_id": wf_id, "v_id": v1_id, "st": now - timedelta(seconds=5), "ct": now},
        )
        await session.commit()

    resp = await async_client.get(
        f"/api/v1/organizations/{org_id}/analytics/overview",
        headers=headers,
    )
    sla = resp.json()["sla"]
    # Monitored: healthy (1) + warning (1) + breached (1) = 3
    assert sla["monitored_count"] == 3
    assert sla["healthy_count"] == 1
    assert sla["warning_count"] == 1
    assert sla["breached_count"] == 1
    assert sla["not_applicable_count"] == 1
    # Compliance: (1 + 1) / 3 * 100 = 66.67%
    assert sla["sla_compliance_rate"] == 66.67
    # Healthy: 1 / 3 * 100 = 33.33%
    assert sla["sla_healthy_rate"] == 33.33
    # Breach: 1 / 3 * 100 = 33.33%
    assert sla["sla_breach_rate"] == 33.33

    # Check SLA monitoring endpoint
    sla_mon_resp = await async_client.get(
        f"/api/v1/organizations/{org_id}/analytics/sla",
        headers=headers,
    )
    assert sla_mon_resp.status_code == 200
    mon_data = sla_mon_resp.json()
    assert mon_data["summary"]["monitored_count"] == 3
    assert len(mon_data["workflows"]) >= 1


# ==============================================================================
# 11. Time-Series Granularity & Continuous Buckets
# ==============================================================================

@pytest.mark.asyncio
async def test_time_series_granularity_and_continuous_zero_filled_buckets(async_client: AsyncClient):
    """Verifies continuous zero-filled time buckets for hourly, daily, and weekly."""
    org_id, headers, _, _ = await create_org_and_owner(async_client, "ts_test")

    # 1. 24h range -> hourly granularity
    resp_24h = await async_client.get(
        f"/api/v1/organizations/{org_id}/analytics/time-series",
        headers=headers,
        params={"range": "24h"},
    )
    assert resp_24h.status_code == 200
    ts_24 = resp_24h.json()
    assert ts_24["granularity"] == "hourly"
    assert len(ts_24["buckets"]) >= 24
    # Zero-filled buckets check
    for b in ts_24["buckets"]:
        assert b["total_count"] == 0
        assert b["avg_duration_ms"] == 0.0

    # 2. 7d range -> daily granularity
    resp_7d = await async_client.get(
        f"/api/v1/organizations/{org_id}/analytics/time-series",
        headers=headers,
        params={"range": "7d"},
    )
    assert resp_7d.status_code == 200
    ts_7d = resp_7d.json()
    assert ts_7d["granularity"] == "daily"
    assert len(ts_7d["buckets"]) >= 7

    # 3. 70d range -> weekly granularity
    now = datetime.now(timezone.utc)
    start_70d = (now - timedelta(days=70)).isoformat()
    end_now = now.isoformat()
    resp_70d = await async_client.get(
        f"/api/v1/organizations/{org_id}/analytics/time-series",
        headers=headers,
        params={"start_time": start_70d, "end_time": end_now},
    )
    assert resp_70d.status_code == 200
    ts_70d = resp_70d.json()
    assert ts_70d["granularity"] == "weekly"
    assert len(ts_70d["buckets"]) >= 10


# ==============================================================================
# 12. Step Latency Analytics & Maximum Limit Bounding
# ==============================================================================

@pytest.mark.asyncio
async def test_step_latency_analytics_and_bounding(async_client: AsyncClient):
    """Verifies bounded top-N step latency queries with maximum 100 limit."""
    org_id, headers, _, _ = await create_org_and_owner(async_client, "step_lat")

    # Requesting limit 200 must be clamped to 100
    resp_bound = await async_client.get(
        f"/api/v1/organizations/{org_id}/analytics/steps",
        headers=headers,
        params={"limit": 200, "sort_by": "avg_latency"},
    )
    assert resp_bound.status_code == 200
    assert resp_bound.json()["limit"] == 100


# ==============================================================================
# 13. Workflow Performance Pagination & Sorting
# ==============================================================================

@pytest.mark.asyncio
async def test_workflow_performance_pagination_and_sorting(async_client: AsyncClient):
    """Verifies workflow performance pagination and sorting."""
    org_id, headers, _, _ = await create_org_and_owner(async_client, "wf_perf")

    # Create 3 workflows
    for i in range(3):
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": f"Workflow {i}"},
        )

    resp = await async_client.get(
        f"/api/v1/organizations/{org_id}/analytics/workflows",
        headers=headers,
        params={"page": 1, "page_size": 2, "sort_by": "executions", "sort_order": "desc"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 3
    assert len(data["items"]) == 2
    assert data["total_pages"] == 2


@pytest.mark.asyncio
async def test_workflow_performance_sorting_variants(async_client: AsyncClient):
    """Verifies sorting by success_rate, avg_duration, name, ascending/descending."""
    org_id, headers, _, _ = await create_org_and_owner(async_client, "wf_sort")

    # Create 2 workflows
    wf1 = (await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows",
        headers=headers,
        json={"name": "Alpha Flow"},
    )).json()

    wf2 = (await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows",
        headers=headers,
        json={"name": "Beta Flow"},
    )).json()

    # Sort by failure_rate desc
    resp = await async_client.get(
        f"/api/v1/organizations/{org_id}/analytics/workflows",
        headers=headers,
        params={"sort_by": "failure_rate", "sort_order": "desc"},
    )
    assert resp.status_code == 200

    # Sort by breaches asc
    resp = await async_client.get(
        f"/api/v1/organizations/{org_id}/analytics/workflows",
        headers=headers,
        params={"sort_by": "breaches", "sort_order": "asc"},
    )
    assert resp.status_code == 200

    # Sort by avg_duration asc
    resp = await async_client.get(
        f"/api/v1/organizations/{org_id}/analytics/workflows",
        headers=headers,
        params={"sort_by": "avg_duration", "sort_order": "asc"},
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_step_latency_sorting_and_filtering(async_client: AsyncClient):
    """Verifies step latency sorting and workflow_id filtering."""
    org_id, headers, _, _ = await create_org_and_owner(async_client, "step_sort")

    wf = (await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows",
        headers=headers,
        json={"name": "Step Flow"},
    )).json()
    wf_id = wf["id"]

    # Test sorting by avg_latency
    resp = await async_client.get(
        f"/api/v1/organizations/{org_id}/analytics/steps",
        headers=headers,
        params={"sort_by": "avg_latency", "workflow_id": wf_id},
    )
    assert resp.status_code == 200

    # Test sorting by p95_latency
    resp = await async_client.get(
        f"/api/v1/organizations/{org_id}/analytics/steps",
        headers=headers,
        params={"sort_by": "p95_latency"},
    )
    assert resp.status_code == 200

    # Test sorting by execution_count
    resp = await async_client.get(
        f"/api/v1/organizations/{org_id}/analytics/steps",
        headers=headers,
        params={"sort_by": "execution_count"},
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_time_series_daily_and_weekly_granularity(async_client: AsyncClient):
    """Verifies explicit daily and weekly time series aggregations."""
    org_id, headers, _, _ = await create_org_and_owner(async_client, "ts_gran")

    # Daily granularity
    resp_daily = await async_client.get(
        f"/api/v1/organizations/{org_id}/analytics/time-series",
        headers=headers,
        params={"range": "30d", "granularity": "daily"},
    )
    assert resp_daily.status_code == 200
    assert resp_daily.json()["granularity"] == "daily"
    assert len(resp_daily.json()["buckets"]) > 0

    # Weekly granularity
    resp_weekly = await async_client.get(
        f"/api/v1/organizations/{org_id}/analytics/time-series",
        headers=headers,
        params={"range": "90d", "granularity": "weekly"},
    )
    assert resp_weekly.status_code == 200
    assert resp_weekly.json()["granularity"] == "weekly"
    assert len(resp_weekly.json()["buckets"]) > 0


@pytest.mark.asyncio
async def test_sla_monitoring_filtered_by_workflow(async_client: AsyncClient):
    """Verifies SLA monitoring endpoint filtered by specific workflow_id."""
    org_id, headers, _, _ = await create_org_and_owner(async_client, "sla_filt")

    wf = (await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows",
        headers=headers,
        json={"name": "SLA Specific Flow"},
    )).json()
    wf_id = wf["id"]

    resp = await async_client.get(
        f"/api/v1/organizations/{org_id}/analytics/sla",
        headers=headers,
        params={"workflow_id": wf_id},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "summary" in data
    assert "workflows" in data

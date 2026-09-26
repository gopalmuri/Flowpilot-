import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_check_endpoint(async_client: AsyncClient):
    response = await async_client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert data["project"] == "FlowPilot"
    assert "services" in data
    assert "database" in data["services"]
    assert "redis" in data["services"]
    assert "timestamp" in data


@pytest.mark.asyncio
async def test_health_check_alias(async_client: AsyncClient):
    response = await async_client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in ["healthy", "degraded"]


@pytest.mark.asyncio
async def test_root_index_endpoint(async_client: AsyncClient):
    response = await async_client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["project"] == "FlowPilot"
    assert data["status"] == "operational"
    assert data["health_check"] == "/api/v1/health"


@pytest.mark.asyncio
async def test_liveness_probe(async_client: AsyncClient):
    response = await async_client.get("/api/v1/health/live")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "alive"
    assert data["project"] == "FlowPilot"
    assert "timestamp" in data


@pytest.mark.asyncio
async def test_readiness_probe(async_client: AsyncClient):
    response = await async_client.get("/api/v1/health/ready")
    assert response.status_code in [200, 503]
    data = response.json()
    assert data["status"] in ["ready", "unready"]
    assert "services" in data
    assert "database" in data["services"]
    assert "redis" in data["services"]
    assert "celery_broker" in data["services"]

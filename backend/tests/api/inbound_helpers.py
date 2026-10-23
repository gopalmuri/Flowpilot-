"""Shared helpers for inbound-channel API tests (organisation setup, signing, workflow publishing)."""

import json
import time
import uuid
from typing import Any, Dict, List, Optional

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.models.conversation import InboundMessage
from app.services.webhook_service import calculate_hmac_signature

TRIGGER_ONLY_STEPS = [{"step_key": "trigger", "step_type": "MANUAL_TRIGGER", "name": "Trigger", "config": {}}]


async def create_org(async_client: AsyncClient, name: str):
    unique = uuid.uuid4().hex[:8]
    email, password = f"{name}_{unique}@flowpilot.internal", f"SecurePass_{unique}!123"
    await async_client.post(
        "/api/v1/auth/register", json={"email": email, "password": password, "full_name": "Portfolio Tester"}
    )
    login = await async_client.post("/api/v1/auth/login", json={"email": email, "password": password})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    org = (await async_client.post("/api/v1/organizations", headers=headers, json={"name": f"{name} Corp"})).json()
    login = await async_client.post(
        "/api/v1/auth/login", json={"email": email, "password": password, "organization_id": org["id"]}
    )
    return org["id"], {"Authorization": f"Bearer {login.json()['access_token']}"}


async def publish_workflow(
    async_client: AsyncClient,
    org_id: str,
    headers: dict,
    steps: Optional[List[Dict[str, Any]]] = None,
    connections: Optional[List[Dict[str, Any]]] = None,
) -> str:
    base = f"/api/v1/organizations/{org_id}/workflows"
    wf = (await async_client.post(base, headers=headers, json={"name": f"Inbound {uuid.uuid4().hex[:6]}"})).json()
    ver = (await async_client.get(f"{base}/{wf['id']}/versions", headers=headers)).json()[0]["id"]
    await async_client.put(
        f"{base}/{wf['id']}/versions/{ver}",
        headers=headers,
        json={"steps": steps or TRIGGER_ONLY_STEPS, "connections": connections or []},
    )
    pub = await async_client.post(f"{base}/{wf['id']}/versions/{ver}/publish", headers=headers)
    assert pub.status_code == 200, pub.text
    return wf["id"]


async def connect_form(async_client: AsyncClient, org_id: str, headers: dict, workflow_id: Optional[str] = None):
    config = {"workflow_id": workflow_id} if workflow_id else {}
    resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/integrations",
        headers=headers,
        json={"name": f"Portfolio {uuid.uuid4().hex[:6]}", "type": "PORTFOLIO_FORM", "config": config},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def signed(secret: str, payload: dict, ts: Optional[int] = None):
    body = json.dumps(payload).encode()
    stamp = str(ts or int(time.time()))
    return body, {
        "Content-Type": "application/json",
        "X-Webhook-Timestamp": stamp,
        "X-Webhook-Signature": calculate_hmac_signature(secret, stamp, body),
    }


def submission(**over):
    data = {
        "submission_id": f"sub-{uuid.uuid4().hex[:10]}",
        "name": "Asha Rao",
        "email": "asha@example.com",
        "company": "Acme",
        "subject": "AI project",
        "message": "We need a custom AI solution to process business documents.",
    }
    data.update(over)
    return data


def make_session_maker():
    """Fresh engine per call (NullPool) so it is safe across pytest event loops. Caller disposes `.kw['bind']`."""
    engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def count_messages(org_id: str) -> int:
    maker = make_session_maker()
    try:
        async with maker() as s:
            return (
                await s.execute(
                    select(func.count())
                    .select_from(InboundMessage)
                    .where(InboundMessage.organization_id == uuid.UUID(org_id))
                )
            ).scalar_one()
    finally:
        await maker.kw["bind"].dispose()

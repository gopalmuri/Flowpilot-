import json
import time

import pytest
from httpx import AsyncClient

from app.workers import tasks as worker_tasks
from tests.api.inbound_helpers import (
    connect_form as _connect_form,
)
from tests.api.inbound_helpers import (
    count_messages as _count_messages,
)
from tests.api.inbound_helpers import (
    create_org as _org,
)
from tests.api.inbound_helpers import (
    publish_workflow as _publish_workflow,
)
from tests.api.inbound_helpers import (
    signed as _signed,
)
from tests.api.inbound_helpers import (
    submission as _submission,
)


@pytest.fixture(autouse=True)
def captured_dispatch(monkeypatch):
    calls = []
    monkeypatch.setattr(worker_tasks.execute_workflow_run, "delay", lambda **kw: calls.append(kw))
    return calls


@pytest.mark.asyncio
async def test_create_returns_secret_once_and_never_in_list(async_client: AsyncClient):
    org_id, headers = await _org(async_client, "pf_secret")
    created = await _connect_form(async_client, org_id, headers)
    assert created["setup"]["signing_secret"]
    assert created["public_key"] in created["setup"]["inbound_path"]

    listing = (await async_client.get(f"/api/v1/organizations/{org_id}/integrations", headers=headers)).json()
    assert "signing_secret" not in json.dumps(listing)
    assert listing["items"][0]["setup"] is None


@pytest.mark.asyncio
async def test_valid_submission_starts_workflow_run(async_client: AsyncClient, captured_dispatch):
    org_id, headers = await _org(async_client, "pf_ok")
    wf_id = await _publish_workflow(async_client, org_id, headers)
    form = await _connect_form(async_client, org_id, headers, wf_id)

    body, hdrs = _signed(form["setup"]["signing_secret"], _submission())
    resp = await async_client.post(f"/api/v1/inbound/portfolio/{form['public_key']}", content=body, headers=hdrs)

    assert resp.status_code == 202, resp.text
    data = resp.json()
    assert data["status"] == "accepted" and data["workflow_run_id"]
    assert len(captured_dispatch) == 1
    payload = captured_dispatch[0]["trigger_payload"]
    assert payload["channel"] == "PORTFOLIO_FORM"
    assert "custom AI solution" in payload["message"]
    assert await _count_messages(org_id) == 1


@pytest.mark.asyncio
async def test_duplicate_submission_is_idempotent(async_client: AsyncClient, captured_dispatch):
    org_id, headers = await _org(async_client, "pf_dup")
    wf_id = await _publish_workflow(async_client, org_id, headers)
    form = await _connect_form(async_client, org_id, headers, wf_id)
    payload = _submission()
    url = f"/api/v1/inbound/portfolio/{form['public_key']}"

    body, hdrs = _signed(form["setup"]["signing_secret"], payload)
    first = await async_client.post(url, content=body, headers=hdrs)
    body, hdrs = _signed(form["setup"]["signing_secret"], payload)
    second = await async_client.post(url, content=body, headers=hdrs)

    assert first.status_code == 202 and second.status_code == 200
    assert second.json()["status"] == "duplicate"
    assert second.json()["workflow_run_id"] == first.json()["workflow_run_id"]
    assert len(captured_dispatch) == 1
    assert await _count_messages(org_id) == 1


@pytest.mark.asyncio
async def test_bad_signature_wrong_secret_and_stale_timestamp_rejected(async_client: AsyncClient, captured_dispatch):
    org_id, headers = await _org(async_client, "pf_sig")
    form = await _connect_form(async_client, org_id, headers)
    url = f"/api/v1/inbound/portfolio/{form['public_key']}"

    body, hdrs = _signed("not-the-secret", _submission())
    assert (await async_client.post(url, content=body, headers=hdrs)).status_code == 401

    body, hdrs = _signed(form["setup"]["signing_secret"], _submission(), ts=int(time.time()) - 3600)
    assert (await async_client.post(url, content=body, headers=hdrs)).status_code == 401

    body, _ = _signed(form["setup"]["signing_secret"], _submission())
    assert (await async_client.post(url, content=body)).status_code == 401  # unsigned

    assert captured_dispatch == []
    assert await _count_messages(org_id) == 0


@pytest.mark.asyncio
async def test_unknown_key_is_404_and_tampered_body_rejected(async_client: AsyncClient):
    org_id, headers = await _org(async_client, "pf_404")
    form = await _connect_form(async_client, org_id, headers)

    body, hdrs = _signed(form["setup"]["signing_secret"], _submission())
    assert (await async_client.post("/api/v1/inbound/portfolio/nope", content=body, headers=hdrs)).status_code == 404

    tampered = body.replace(b"Asha", b"Evil")
    url = f"/api/v1/inbound/portfolio/{form['public_key']}"
    assert (await async_client.post(url, content=tampered, headers=hdrs)).status_code == 401


@pytest.mark.asyncio
async def test_malformed_and_oversized_payloads(async_client: AsyncClient):
    org_id, headers = await _org(async_client, "pf_bad")
    form = await _connect_form(async_client, org_id, headers)
    url = f"/api/v1/inbound/portfolio/{form['public_key']}"
    secret = form["setup"]["signing_secret"]

    body, hdrs = _signed(secret, _submission(email="not-an-email"))
    assert (await async_client.post(url, content=body, headers=hdrs)).status_code == 422

    body, hdrs = _signed(secret, {"name": "x"})
    assert (await async_client.post(url, content=body, headers=hdrs)).status_code == 422

    body, hdrs = _signed(secret, _submission(message="x" * 20000))
    assert (await async_client.post(url, content=body, headers=hdrs)).status_code == 413


@pytest.mark.asyncio
async def test_honeypot_creates_nothing(async_client: AsyncClient, captured_dispatch):
    org_id, headers = await _org(async_client, "pf_bot")
    wf_id = await _publish_workflow(async_client, org_id, headers)
    form = await _connect_form(async_client, org_id, headers, wf_id)

    body, hdrs = _signed(form["setup"]["signing_secret"], _submission(website="http://spam.example"))
    resp = await async_client.post(f"/api/v1/inbound/portfolio/{form['public_key']}", content=body, headers=hdrs)

    assert resp.status_code == 202 and resp.json()["status"] == "ignored"
    assert captured_dispatch == []
    assert await _count_messages(org_id) == 0


@pytest.mark.asyncio
async def test_without_workflow_message_is_stored_not_run(async_client: AsyncClient, captured_dispatch):
    org_id, headers = await _org(async_client, "pf_nowf")
    form = await _connect_form(async_client, org_id, headers)

    body, hdrs = _signed(form["setup"]["signing_secret"], _submission())
    resp = await async_client.post(f"/api/v1/inbound/portfolio/{form['public_key']}", content=body, headers=hdrs)

    assert resp.status_code == 202 and resp.json()["workflow_run_id"] is None
    assert captured_dispatch == []
    assert await _count_messages(org_id) == 1


@pytest.mark.asyncio
async def test_tenant_isolation_cannot_bind_foreign_workflow_or_use_foreign_key(async_client: AsyncClient):
    org_a, headers_a = await _org(async_client, "pf_a")
    org_b, headers_b = await _org(async_client, "pf_b")
    wf_b = await _publish_workflow(async_client, org_b, headers_b)

    # Org A cannot point its form at Org B's workflow.
    resp = await async_client.post(
        f"/api/v1/organizations/{org_a}/integrations",
        headers=headers_a,
        json={"name": "Portfolio A", "type": "PORTFOLIO_FORM", "config": {"workflow_id": wf_b}},
    )
    assert resp.status_code == 422

    # Org B's signing secret does not authenticate against Org A's key.
    form_a = await _connect_form(async_client, org_a, headers_a)
    form_b = await _connect_form(async_client, org_b, headers_b)
    body, hdrs = _signed(form_b["setup"]["signing_secret"], _submission())
    resp = await async_client.post(f"/api/v1/inbound/portfolio/{form_a['public_key']}", content=body, headers=hdrs)
    assert resp.status_code == 401
    assert await _count_messages(org_a) == 0


@pytest.mark.asyncio
async def test_disconnected_integration_stops_accepting(async_client: AsyncClient):
    org_id, headers = await _org(async_client, "pf_off")
    form = await _connect_form(async_client, org_id, headers)
    await async_client.put(
        f"/api/v1/organizations/{org_id}/integrations/{form['id']}", headers=headers, json={"status": "DISCONNECTED"}
    )

    body, hdrs = _signed(form["setup"]["signing_secret"], _submission())
    resp = await async_client.post(f"/api/v1/inbound/portfolio/{form['public_key']}", content=body, headers=hdrs)
    assert resp.status_code == 404

"""
Phase 4: outbound delivery foundation.

Real Postgres, real row locks, real HTTP for the approval and operator APIs. The only provider is the deterministic
in-memory mock; its ledger records every message it "accepts", so tests can prove exactly how many sends happened.
Nothing here can reach a live Gmail/WhatsApp/Meta endpoint.
"""

import ast
import asyncio
import hashlib
import socket
import uuid
from datetime import timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest
import pytest_asyncio
from sqlalchemy import select, text

from app.core.config import settings
from app.models.audit_log import AuditLog
from app.models.base import utc_now
from app.models.conversation import Conversation, InboundMessage, ReplyDraft
from app.models.integration import Integration
from app.models.outbound import OutboundDelivery
from app.services.outbound import delivery as dsvc
from app.services.outbound.delivery import (
    DeliveryRefused,
    create_delivery,
    dispatch_due,
    process_delivery,
    recover_stale,
)
from app.services.outbound.providers import ErrorKind, MockOutboundProvider, ProviderError, get_provider
from app.services.outbound.routing import RoutingError, resolve_route
from app.workers import tasks as worker_tasks
from tests.api.inbound_helpers import make_session_maker
from tests.api.test_draft_approval import (
    CONNECTIONS,
    STEPS,
    add_member,
    audit_actions,
    get_draft,
    pending_approval,
    step_keys_run,
    url,
)

PREFIX = "outbound."

SEND_STEPS = [s for s in STEPS if s["step_key"] != "after_approved"] + [
    {"step_key": "send", "step_type": "SEND_REPLY", "name": "Send reply", "config": {}},
]
SEND_CONNECTIONS = [c for c in CONNECTIONS if c["target_step_key"] != "after_approved"] + [
    {"source_step_key": "approve", "target_step_key": "send", "condition_label": "approved"},
]


@pytest.fixture(autouse=True)
def isolate(monkeypatch):
    """No broker traffic, no shared mock state, instant backoff and reconciliation grace unless a test overrides."""
    MockOutboundProvider.reset()
    calls: List[Any] = []
    monkeypatch.setattr(worker_tasks.execute_workflow_run, "delay", lambda **kw: calls.append(kw))
    monkeypatch.setattr(worker_tasks.dispatch_outbound_deliveries, "delay", lambda *a, **k: None)
    monkeypatch.setattr(worker_tasks.deliver_outbound, "delay", lambda *a, **k: None)
    monkeypatch.setattr(settings, "OUTBOUND_BACKOFF_BASE_SECONDS", 0)
    monkeypatch.setattr(settings, "OUTBOUND_RECONCILE_GRACE_SECONDS", 0)
    yield calls
    MockOutboundProvider.reset()


@pytest.fixture
def captured_dispatch(isolate):
    return isolate


@pytest_asyncio.fixture
async def sm():
    """Session maker; afterwards cancel any delivery this test left in flight so the shared dev DB stays clean."""
    maker = make_session_maker()
    started = utc_now()
    yield maker
    async with maker() as s:
        await s.execute(
            text(
                "UPDATE outbound_deliveries SET status='CANCELLED' "
                "WHERE created_at >= :t AND status IN ('PENDING','CLAIMED','SENDING','FAILED_RETRYABLE','UNKNOWN_OUTCOME')"
            ),
            {"t": started},
        )
        await s.commit()
    await maker.kw["bind"].dispose()


async def sql(sm, statement: str, **params) -> None:
    async with sm() as s:
        await s.execute(text(statement), params)
        await s.commit()


async def scenario(
    async_client,
    sm,
    captured_dispatch,
    name: str,
    *,
    send_step: bool = False,
    behavior: Optional[str] = "ok",
    message: str = "We need a custom AI solution to process business documents.",
    approve: bool = True,
    edited: Optional[str] = None,
) -> Dict[str, Any]:
    c = await pending_approval(
        async_client,
        sm,
        captured_dispatch,
        name,
        message=message,
        steps=SEND_STEPS if send_step else None,
        connections=SEND_CONNECTIONS if send_step else None,
        reply_behavior=behavior,
    )
    if approve:
        body: Dict[str, Any] = {"reviewed_version": 1}
        if edited:
            body["edited_content"] = edited
        resp = await async_client.post(url(c["org_id"], c["approval_id"], "/approve"), headers=c["headers"], json=body)
        assert resp.status_code == 200, resp.text
    return c


async def new_delivery(sm, c) -> uuid.UUID:
    async with sm() as s:
        d, created = await create_delivery(s, uuid.UUID(c["org_id"]), uuid.UUID(c["draft_id"]), uuid.UUID(c["run_id"]))
        await s.commit()
        assert created
        return d.id


async def deliveries(sm, c) -> List[OutboundDelivery]:
    async with sm() as s:
        rows = (
            await s.execute(
                select(OutboundDelivery)
                .where(OutboundDelivery.draft_id == uuid.UUID(c["draft_id"]))
                .order_by(OutboundDelivery.version_number)
            )
        ).scalars()
        return list(rows)


async def get_delivery(sm, delivery_id) -> OutboundDelivery:
    async with sm() as s:
        d = await s.get(OutboundDelivery, delivery_id)
        assert d is not None
        return d


async def outbound_audit(sm, org_id: str, delivery_id) -> List[str]:
    return [a.removeprefix(PREFIX) for a in await audit_actions(sm, org_id, str(delivery_id))]


async def work(sm, delivery_id, worker="w1") -> str:
    return await process_delivery(sm, delivery_id, worker)


# ============================================================================ authorisation gate


@pytest.mark.asyncio
async def test_only_an_approved_current_version_can_be_scheduled_and_only_once(async_client, captured_dispatch, sm):
    c = await scenario(async_client, sm, captured_dispatch, "ob_gate", approve=False)
    async with sm() as s:
        with pytest.raises(DeliveryRefused) as refused:
            await create_delivery(s, uuid.UUID(c["org_id"]), uuid.UUID(c["draft_id"]), uuid.UUID(c["run_id"]))
        assert refused.value.code == "draft_not_approved"
        await s.commit()  # the refusal is audited
    assert "outbound.delivery_refused" in await audit_actions(sm, c["org_id"], c["draft_id"])

    approve = await async_client.post(
        url(c["org_id"], c["approval_id"], "/approve"), headers=c["headers"], json={"reviewed_version": 1}
    )
    assert approve.status_code == 200
    first = await new_delivery(sm, c)
    async with sm() as s:
        again, created = await create_delivery(
            s, uuid.UUID(c["org_id"]), uuid.UUID(c["draft_id"]), uuid.UUID(c["run_id"])
        )
        await s.commit()
    assert created is False and again.id == first
    assert len(await deliveries(sm, c)) == 1
    d = await get_delivery(sm, first)
    assert d.status == "PENDING" and d.version_number == 1 and d.attempt_count == 0
    assert d.idempotency_key == f"delivery:{c['draft_id']}:1"
    assert d.content_hash == (await _current_hash(sm, c))


async def _current_hash(sm, c) -> str:
    from app.models.conversation import ReplyDraftVersion

    async with sm() as s:
        v = (
            (await s.execute(select(ReplyDraftVersion).where(ReplyDraftVersion.draft_id == uuid.UUID(c["draft_id"]))))
            .scalars()
            .first()
        )
        assert v is not None
        return v.content_hash


@pytest.mark.asyncio
@pytest.mark.parametrize("how", ["reject", "expire", "cancel", "revision"])
async def test_unapproved_drafts_never_get_a_delivery(async_client, captured_dispatch, sm, how):
    c = await scenario(async_client, sm, captured_dispatch, f"ob_unapproved_{how}", approve=False)
    base = url(c["org_id"], c["approval_id"])
    if how == "reject":
        assert (await async_client.post(base + "/reject", headers=c["headers"], json={})).status_code == 200
    elif how == "revision":
        r = await async_client.post(base + "/request-revision", headers=c["headers"], json={"instructions": "x"})
        assert r.status_code == 200
    elif how == "expire":
        await sql(
            sm,
            "UPDATE approval_requests SET created_at = now() - interval '48 hours' WHERE id = :i",
            i=uuid.UUID(c["approval_id"]),
        )
        await async_client.get(f"/api/v1/organizations/{c['org_id']}/approvals?status=PENDING", headers=c["headers"])
    else:
        from app.engine.workflow_engine import WorkflowEngine

        await WorkflowEngine(session_factory=sm).cancel_run(uuid.UUID(c["org_id"]), uuid.UUID(c["run_id"]))
    async with sm() as s:
        with pytest.raises(DeliveryRefused) as refused:
            await create_delivery(s, uuid.UUID(c["org_id"]), uuid.UUID(c["draft_id"]), uuid.UUID(c["run_id"]))
        assert refused.value.code == "draft_not_approved"
    assert await deliveries(sm, c) == []
    assert MockOutboundProvider.sent_messages() == []


@pytest.mark.asyncio
async def test_invalidated_approval_cancels_queued_delivery_and_blocks_new_ones(async_client, captured_dispatch, sm):
    c = await scenario(async_client, sm, captured_dispatch, "ob_invalidate")
    queued = await new_delivery(sm, c)

    edit = await async_client.put(
        url(c["org_id"], c["approval_id"], "/draft"),
        headers=c["headers"],
        json={"content": "Hello,\n\nChanged after approval.\n\nThe Team", "reviewed_version": 1},
    )
    assert edit.status_code == 200, edit.text

    d = await get_delivery(sm, queued)
    assert d.status == "CANCELLED" and d.last_error_code == "approval_invalidated"
    assert await work(sm, queued) == "skipped"
    async with sm() as s:
        with pytest.raises(DeliveryRefused) as refused:
            await create_delivery(s, uuid.UUID(c["org_id"]), uuid.UUID(c["draft_id"]), uuid.UUID(c["run_id"]))
        assert refused.value.code == "draft_not_approved"
    assert MockOutboundProvider.sent_messages() == []


@pytest.mark.asyncio
async def test_approval_changing_between_creation_and_dispatch_stops_the_send(async_client, captured_dispatch, sm):
    c = await scenario(async_client, sm, captured_dispatch, "ob_between")
    queued = await new_delivery(sm, c)
    # The edit invalidates the approval and cancels the queued delivery; simulate a stale queued task regardless.
    await async_client.put(
        url(c["org_id"], c["approval_id"], "/draft"),
        headers=c["headers"],
        json={"content": "Hello,\n\nNew text.\n\nThe Team", "reviewed_version": 1},
    )
    await sql(
        sm,
        "UPDATE outbound_deliveries SET status='PENDING', enqueued_at=NULL, last_error_code=NULL WHERE id=:i",
        i=queued,
    )

    assert await work(sm, queued) == "skipped"
    d = await get_delivery(sm, queued)
    assert d.status == "CANCELLED" and d.last_error_code == "draft_not_approved" and d.attempt_count == 0
    assert MockOutboundProvider.sent_messages() == []
    assert "delivery_cancelled" in await outbound_audit(sm, c["org_id"], queued)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "tamper,code",
    [
        ("UPDATE outbound_deliveries SET content_hash = repeat('0', 64) WHERE id = :i", "delivery_hash_mismatch"),
        ("UPDATE outbound_deliveries SET version_number = 7 WHERE id = :i", "version_mismatch"),
        ("UPDATE reply_drafts SET approved_version_number = NULL WHERE id = :d", "approved_version_not_current"),
        ("UPDATE reply_drafts SET decided_by = NULL WHERE id = :d", "no_human_decision"),
        ("UPDATE approval_requests SET status = 'REJECTED' WHERE id = :a", "approval_not_active"),
        ("UPDATE outbound_deliveries SET approval_request_id = NULL WHERE id = :i", "approval_superseded"),
    ],
)
async def test_gate_rechecks_everything_at_claim_time(async_client, captured_dispatch, sm, tamper, code):
    c = await scenario(async_client, sm, captured_dispatch, "ob_tamper")
    queued = await new_delivery(sm, c)
    await sql(sm, tamper, i=queued, d=uuid.UUID(c["draft_id"]), a=uuid.UUID(c["approval_id"]))

    assert await work(sm, queued) == "skipped"
    d = await get_delivery(sm, queued)
    assert d.status == "CANCELLED" and d.last_error_code == code
    assert MockOutboundProvider.sent_messages() == []
    assert (await get_draft(sm, c["draft_id"])).status in ("APPROVED", "PENDING_APPROVAL")  # never moved to SENDING


@pytest.mark.asyncio
async def test_run_must_belong_to_the_approval_and_organization(async_client, captured_dispatch, sm):
    a = await scenario(async_client, sm, captured_dispatch, "ob_run_a")
    b = await scenario(async_client, sm, captured_dispatch, "ob_run_b")
    async with sm() as s:
        with pytest.raises(DeliveryRefused) as wrong_run:
            await create_delivery(s, uuid.UUID(a["org_id"]), uuid.UUID(a["draft_id"]), uuid.UUID(b["run_id"]))
        assert wrong_run.value.code in ("run_not_in_organization", "run_mismatch")
        with pytest.raises(DeliveryRefused) as cross_org:
            await create_delivery(s, uuid.UUID(b["org_id"]), uuid.UUID(a["draft_id"]), uuid.UUID(b["run_id"]))
        assert cross_org.value.code == "draft_not_found"
    assert await deliveries(sm, a) == [] and await deliveries(sm, b) == []


# ============================================================================ routing / tenancy


@pytest.mark.asyncio
async def test_cross_tenant_sending_account_is_rejected_everywhere(async_client, captured_dispatch, sm):
    a = await scenario(async_client, sm, captured_dispatch, "ob_tenant_a", behavior=None)
    b = await scenario(async_client, sm, captured_dispatch, "ob_tenant_b", behavior="ok")

    # API: org A cannot point its form at org B's reply account.
    resp = await async_client.put(
        f"/api/v1/organizations/{a['org_id']}/integrations/{a['form_id']}",
        headers=a["headers"],
        json={"config": {"workflow_id": a["workflow_id"], "reply_integration_id": b["sender_id"]}},
    )
    assert resp.status_code == 422

    # Even if the row were forced in (bypassing the API), routing refuses another organization's account.
    await sql(
        sm,
        "UPDATE integrations SET config = jsonb_set(config::jsonb, '{reply_integration_id}', to_jsonb(CAST(:s AS text)))::json WHERE id = :f",
        s=b["sender_id"],
        f=uuid.UUID(a["form_id"]),
    )
    async with sm() as s:
        with pytest.raises(DeliveryRefused) as refused:
            await create_delivery(s, uuid.UUID(a["org_id"]), uuid.UUID(a["draft_id"]), uuid.UUID(a["run_id"]))
        assert refused.value.code == "account_not_found"
    assert MockOutboundProvider.sent_messages() == []

    # Operator API: another organization's deliveries are invisible and untouchable.
    queued = await new_delivery(sm, b)
    other = await async_client.get(f"/api/v1/organizations/{a['org_id']}/deliveries/{queued}", headers=a["headers"])
    assert other.status_code == 404
    cancel = await async_client.post(
        f"/api/v1/organizations/{a['org_id']}/deliveries/{queued}/cancel", headers=a["headers"]
    )
    assert cancel.status_code == 404
    foreign_path = await async_client.get(
        f"/api/v1/organizations/{b['org_id']}/deliveries/{queued}", headers=a["headers"]
    )
    assert foreign_path.status_code in (403, 404)
    assert (await get_delivery(sm, queued)).status == "PENDING"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "setup,code",
    [
        ("none", "no_reply_account"),
        ("disconnected", "account_disconnected"),
        ("bad_destination", "destination_invalid"),
        ("destination_mismatch", "destination_mismatch"),
        ("channel_mismatch", "channel_mismatch"),
        ("provider_off", "provider_not_enabled"),
        ("invalid_destination_provider", "invalid_destination"),
    ],
)
async def test_unverifiable_destination_or_account_stops_delivery_with_an_actionable_error(
    async_client, captured_dispatch, sm, setup, code
):
    behavior = "invalid_destination" if setup == "invalid_destination_provider" else ("ok" if setup != "none" else None)
    c = await scenario(async_client, sm, captured_dispatch, f"ob_route_{setup}", behavior=behavior)
    sender, conv, msg = c["sender_id"], uuid.UUID(c["draft_id"]), None
    if setup == "disconnected":
        await sql(sm, "UPDATE integrations SET status='DISCONNECTED' WHERE id=:i", i=uuid.UUID(sender))
    elif setup == "bad_destination":
        await sql(
            sm,
            "UPDATE conversations SET sender_identity='not-an-email' WHERE id=(SELECT conversation_id FROM reply_drafts WHERE id=:d)",
            d=conv,
        )
    elif setup == "destination_mismatch":
        await sql(
            sm,
            "UPDATE conversations SET sender_identity='someone-else@example.com' WHERE id=(SELECT conversation_id FROM reply_drafts WHERE id=:d)",
            d=conv,
        )
    elif setup == "channel_mismatch":
        await sql(
            sm,
            "UPDATE inbound_messages SET channel='WHATSAPP' WHERE id=(SELECT source_message_id FROM reply_drafts WHERE id=:d)",
            d=conv,
        )
    elif setup == "provider_off":
        await sql(
            sm,
            "UPDATE integrations SET config = jsonb_set(config::jsonb, '{provider}', '\"gmail\"')::json WHERE id=:i",
            i=uuid.UUID(sender),
        )
    async with sm() as s:
        with pytest.raises(DeliveryRefused) as refused:
            await create_delivery(s, uuid.UUID(c["org_id"]), uuid.UUID(c["draft_id"]), uuid.UUID(c["run_id"]))
        assert refused.value.code == code
        assert refused.value.message  # actionable text for the operator
        await s.commit()
    assert await deliveries(sm, c) == [] and MockOutboundProvider.sent_messages() == []
    assert msg is None


async def _retarget(
    sm, c, channel: str, integration_type: str, config: Dict[str, Any], sender_identity: str, thread: str
):
    """Turns the scenario's conversation into a Gmail/WhatsApp one, with its own connected account."""
    import json

    account = uuid.uuid4()
    async with sm() as s:
        draft = await s.get(ReplyDraft, uuid.UUID(c["draft_id"]))
        assert draft is not None
        s.add(
            Integration(
                id=account,
                organization_id=draft.organization_id,
                type=integration_type,
                name=f"{integration_type} {account.hex[:6]}",
                status="CONNECTED",
                config={"provider": "mock", **config},
            )
        )
        await s.flush()
        conversation = await s.get(Conversation, draft.conversation_id)
        message = await s.get(InboundMessage, draft.source_message_id)
        assert conversation is not None and message is not None
        conversation.channel = message.channel = channel
        conversation.integration_id = message.integration_id = account
        conversation.sender_identity = sender_identity
        message.sender_address = sender_identity
        conversation.external_conversation_id = thread
        await s.commit()
    assert json.dumps(config)
    return account


@pytest.mark.asyncio
async def test_gmail_reply_keeps_the_original_thread_and_mailbox(async_client, captured_dispatch, sm):
    c = await scenario(async_client, sm, captured_dispatch, "ob_gmail", behavior=None)
    account = await _retarget(
        sm, c, "GMAIL", "GMAIL", {"email_address": "owner@business.example"}, "asha@example.com", "thread-abc-123"
    )
    queued = await new_delivery(sm, c)
    d = await get_delivery(sm, queued)
    assert d.channel == "GMAIL" and d.integration_id == account and d.destination == "asha@example.com"
    assert d.provider_context["thread_id"] == "thread-abc-123"
    assert d.provider_context["mailbox"] == "owner@business.example"
    assert await work(sm, queued) == "sent"
    sent = MockOutboundProvider.sent_messages()[0]
    assert sent.context["thread_id"] == "thread-abc-123" and sent.destination == "asha@example.com"


@pytest.mark.asyncio
async def test_whatsapp_reply_keeps_business_number_and_recipient_and_validates_the_phone(
    async_client, captured_dispatch, sm
):
    c = await scenario(async_client, sm, captured_dispatch, "ob_wa", behavior=None)
    await _retarget(
        sm, c, "WHATSAPP", "WHATSAPP_BUSINESS", {"phone_number_id": "1234567890"}, "+15551234567", "wa-conv-1"
    )
    queued = await new_delivery(sm, c)
    d = await get_delivery(sm, queued)
    assert d.channel == "WHATSAPP" and d.destination == "+15551234567"
    assert d.provider_context["phone_number_id"] == "1234567890" and d.provider_context["recipient"] == "+15551234567"
    assert await work(sm, queued) == "sent"
    assert MockOutboundProvider.sent_messages()[0].context["phone_number_id"] == "1234567890"

    bad = await scenario(async_client, sm, captured_dispatch, "ob_wa_bad", behavior=None)
    await _retarget(sm, bad, "WHATSAPP", "WHATSAPP_BUSINESS", {"phone_number_id": "1"}, "12ab", "wa-conv-2")
    async with sm() as s:
        with pytest.raises(DeliveryRefused) as refused:
            await create_delivery(s, uuid.UUID(bad["org_id"]), uuid.UUID(bad["draft_id"]), uuid.UUID(bad["run_id"]))
        assert refused.value.code == "destination_invalid"


@pytest.mark.asyncio
async def test_channels_never_fall_back_to_another_channel(async_client, captured_dispatch, sm):
    # A WhatsApp conversation whose account is an email sender (or missing) must stop, not email the person instead.
    c = await scenario(async_client, sm, captured_dispatch, "ob_nofallback", behavior="ok")
    await sql(
        sm,
        "UPDATE conversations SET channel='WHATSAPP', sender_identity='+15551234567', integration_id=(SELECT id FROM integrations WHERE id=:s) "
        "WHERE id=(SELECT conversation_id FROM reply_drafts WHERE id=:d)",
        s=uuid.UUID(c["sender_id"]),
        d=uuid.UUID(c["draft_id"]),
    )
    await sql(
        sm,
        "UPDATE inbound_messages SET channel='WHATSAPP' WHERE id=(SELECT source_message_id FROM reply_drafts WHERE id=:d)",
        d=uuid.UUID(c["draft_id"]),
    )
    async with sm() as s:
        draft = await s.get(ReplyDraft, uuid.UUID(c["draft_id"]))
        assert draft is not None
        with pytest.raises(RoutingError) as err:
            await resolve_route(s, draft)
        assert err.value.code == "account_wrong_type"
    assert MockOutboundProvider.sent_messages() == []


# ============================================================================ the happy path and exact text


@pytest.mark.asyncio
async def test_the_exact_approved_text_is_what_the_provider_receives(async_client, captured_dispatch, sm):
    edited = "Hello Asha,\n\nOnly this exact text was approved.\n\nThe Team"
    c = await scenario(async_client, sm, captured_dispatch, "ob_exact", edited=edited)
    queued = await new_delivery(sm, c)
    assert await work(sm, queued) == "sent"

    d = await get_delivery(sm, queued)
    sent = MockOutboundProvider.sent_messages()
    assert len(sent) == 1
    assert sent[0].body == edited  # the approver's edit, not the AI draft
    assert hashlib.sha256(sent[0].body.encode()).hexdigest() == d.content_hash
    assert sent[0].subject == "Re: AI project" and sent[0].destination == "asha@example.com"
    assert sent[0].context["from_address"] == "sales@business.example"
    assert d.status == "SENT" and d.version_number == 2 and d.provider_message_id == sent[0].provider_message_id
    assert d.attempt_count == 1 and d.sent_at is not None and d.last_error_code is None
    assert (await get_draft(sm, c["draft_id"])).status == "SENT"


@pytest.mark.asyncio
async def test_a_draft_cannot_be_edited_once_its_delivery_has_consumed_the_approval(
    async_client, captured_dispatch, sm
):
    c = await scenario(async_client, sm, captured_dispatch, "ob_noedit")
    queued = await new_delivery(sm, c)
    assert await work(sm, queued) == "sent"
    edit = await async_client.put(
        url(c["org_id"], c["approval_id"], "/draft"),
        headers=c["headers"],
        json={"content": "too late", "reviewed_version": 1},
    )
    assert edit.status_code == 409


@pytest.mark.asyncio
async def test_sent_approval_cannot_be_consumed_a_second_time(async_client, captured_dispatch, sm):
    c = await scenario(async_client, sm, captured_dispatch, "ob_consumed")
    queued = await new_delivery(sm, c)
    assert await work(sm, queued) == "sent"
    async with sm() as s:
        # The draft is SENT, so the gate refuses a new delivery; the existing one is never recreated.
        with pytest.raises(DeliveryRefused) as refused:
            await create_delivery(s, uuid.UUID(c["org_id"]), uuid.UUID(c["draft_id"]), uuid.UUID(c["run_id"]))
        assert refused.value.code == "draft_not_approved"
    assert await work(sm, queued) == "skipped"
    assert len(MockOutboundProvider.sent_messages()) == 1
    assert len(await deliveries(sm, c)) == 1


# ============================================================================ concurrency, retries, failures


@pytest.mark.asyncio
async def test_duplicate_creation_requests_make_one_logical_delivery(async_client, captured_dispatch, sm):
    c = await scenario(async_client, sm, captured_dispatch, "ob_dup_create")

    async def create():
        async with sm() as s:
            d, created = await create_delivery(
                s, uuid.UUID(c["org_id"]), uuid.UUID(c["draft_id"]), uuid.UUID(c["run_id"])
            )
            await s.commit()
            return d.id, created

    results = await asyncio.gather(*[create() for _ in range(6)])
    assert len({r[0] for r in results}) == 1
    assert sum(1 for r in results if r[1]) == 1
    assert len(await deliveries(sm, c)) == 1
    audit = await outbound_audit(sm, c["org_id"], results[0][0])
    assert audit.count("delivery_created") == 1


@pytest.mark.asyncio
async def test_concurrent_workers_cannot_claim_the_same_delivery(async_client, captured_dispatch, sm):
    c = await scenario(async_client, sm, captured_dispatch, "ob_claim_race")
    queued = await new_delivery(sm, c)
    outcomes = await asyncio.gather(*[work(sm, queued, f"worker-{i}") for i in range(8)])
    assert outcomes.count("sent") == 1, outcomes
    assert all(o in ("sent", "skipped") for o in outcomes)
    assert len(MockOutboundProvider.sent_messages()) == 1
    d = await get_delivery(sm, queued)
    assert d.status == "SENT" and d.attempt_count == 1
    audit = await outbound_audit(sm, c["org_id"], queued)
    assert audit.count("delivery_claimed") == 1 and audit.count("delivery_sent") == 1


@pytest.mark.asyncio
async def test_transient_failure_retries_with_backoff_then_sends_once(async_client, captured_dispatch, sm, monkeypatch):
    monkeypatch.setattr(settings, "OUTBOUND_BACKOFF_BASE_SECONDS", 3600)
    c = await scenario(async_client, sm, captured_dispatch, "ob_transient", behavior="transient_once")
    queued = await new_delivery(sm, c)

    assert await work(sm, queued) == "failed_retryable"
    d = await get_delivery(sm, queued)
    assert d.status == "FAILED_RETRYABLE" and d.attempt_count == 1 and d.last_error_category == "transient"
    assert d.next_attempt_at is not None and d.next_attempt_at > utc_now()
    assert (await get_draft(sm, c["draft_id"])).status == "SENDING"  # still consumed: edits stay blocked

    assert await work(sm, queued) == "skipped"  # not due yet
    assert MockOutboundProvider.sent_messages() == []
    assert queued not in await dispatch_due(sm, lambda i: None)  # (other tests' rows may be due; only ours matters)

    await sql(sm, "UPDATE outbound_deliveries SET next_attempt_at = now() - interval '1 second' WHERE id=:i", i=queued)
    assert await work(sm, queued) == "sent"
    d = await get_delivery(sm, queued)
    assert d.status == "SENT" and d.attempt_count == 2 and d.last_error_code is None
    assert len(MockOutboundProvider.sent_messages()) == 1
    audit = await outbound_audit(sm, c["org_id"], queued)
    assert audit.count("delivery_failed_retryable") == 1 and audit.count("delivery_attempt_started") == 2


@pytest.mark.asyncio
async def test_retries_are_bounded_and_then_need_a_person(async_client, captured_dispatch, sm, monkeypatch):
    monkeypatch.setattr(settings, "OUTBOUND_MAX_ATTEMPTS", 2)
    c = await scenario(async_client, sm, captured_dispatch, "ob_exhaust", behavior="transient_always")
    queued = await new_delivery(sm, c)
    assert await work(sm, queued) == "failed_retryable"
    assert await work(sm, queued) == "failed_permanent"
    d = await get_delivery(sm, queued)
    assert d.status == "FAILED_PERMANENT" and d.last_error_code == "retries_exhausted" and d.attempt_count == 2
    assert await work(sm, queued) == "skipped"
    assert (await get_draft(sm, c["draft_id"])).status == "SEND_FAILED"
    assert MockOutboundProvider.sent_messages() == []

    # A person can fix it: editing a SEND_FAILED draft opens a fresh approval for the new text.
    edit = await async_client.put(
        url(c["org_id"], c["approval_id"], "/draft"),
        headers=c["headers"],
        json={"content": "Hello,\n\nRevised after the failure.\n\nThe Team", "reviewed_version": 1},
    )
    assert edit.status_code == 200, edit.text
    assert edit.json()["draft"]["status"] == "PENDING_APPROVAL"


@pytest.mark.asyncio
async def test_permanent_failure_is_final_and_never_retried(async_client, captured_dispatch, sm):
    c = await scenario(async_client, sm, captured_dispatch, "ob_permanent", behavior="permanent")
    queued = await new_delivery(sm, c)
    assert await work(sm, queued) == "failed_permanent"
    d = await get_delivery(sm, queued)
    assert d.status == "FAILED_PERMANENT" and d.last_error_category == "permanent" and d.attempt_count == 1
    assert await work(sm, queued) == "skipped"
    assert (await get_draft(sm, c["draft_id"])).status == "SEND_FAILED"
    assert (await outbound_audit(sm, c["org_id"], queued)).count("delivery_failed_permanent") == 1


# ============================================================================ uncertain outcomes (the critical ones)


@pytest.mark.asyncio
async def test_provider_accepts_then_response_is_lost_and_reconciliation_prevents_a_resend(
    async_client, captured_dispatch, sm
):
    c = await scenario(async_client, sm, captured_dispatch, "ob_lost_reconciled", behavior="accept_then_lose_response")
    queued = await new_delivery(sm, c)
    key = f"delivery:{c['draft_id']}:1"

    assert await work(sm, queued) == "sent_after_reconcile"
    d = await get_delivery(sm, queued)
    assert d.status == "SENT" and d.resolution == "auto_reconciled" and d.attempt_count == 1
    assert d.provider_message_id == MockOutboundProvider.sent_messages(key)[0].provider_message_id
    assert len(MockOutboundProvider.sent_messages()) == 1  # accepted exactly once; never blindly resent
    assert await work(sm, queued) == "skipped"
    assert len(MockOutboundProvider.sent_messages()) == 1


@pytest.mark.asyncio
async def test_lost_response_without_reconciliation_is_unknown_and_is_never_resent(async_client, captured_dispatch, sm):
    c = await scenario(async_client, sm, captured_dispatch, "ob_lost_unknown", behavior="no_reconcile")
    queued = await new_delivery(sm, c)

    assert await work(sm, queued) == "unknown_outcome"
    d = await get_delivery(sm, queued)
    assert d.status == "UNKNOWN_OUTCOME" and d.last_error_category == "uncertain" and d.attempt_count == 1
    assert len(MockOutboundProvider.sent_messages()) == 1  # the provider did accept it

    # Nothing automatic may resend it: not another worker, not the relay, not recovery.
    assert await work(sm, queued, "w2") == "skipped"
    assert queued not in await dispatch_due(sm, lambda i: None)  # (other tests' rows may be due; only ours matters)
    await recover_stale(sm)
    await recover_stale(sm, now=utc_now() + timedelta(days=1))
    assert (await get_delivery(sm, queued)).status == "UNKNOWN_OUTCOME"
    assert len(MockOutboundProvider.sent_messages()) == 1
    assert (await get_draft(sm, c["draft_id"])).status == "SENDING"  # still consumed

    # A person who checked the provider resolves it. Only an admin may.
    base = f"/api/v1/organizations/{c['org_id']}/deliveries/{queued}"
    manager = await add_member(async_client, c["headers"], c["org_id"], "MANAGER")
    assert (await async_client.post(base + "/reconcile", headers=manager, json={"outcome": "SENT"})).status_code == 403
    resolved = await async_client.post(
        base + "/reconcile", headers=c["headers"], json={"outcome": "SENT", "provider_message_id": "checked-by-hand"}
    )
    assert resolved.status_code == 200, resolved.text
    body = resolved.json()
    assert body["status"] == "SENT" and body["resolution"] == "manual_sent" and "not confirmed" in body["status_label"]
    assert (await get_draft(sm, c["draft_id"])).status == "SENT"
    assert len(MockOutboundProvider.sent_messages()) == 1
    # And it cannot be resolved twice.
    assert (
        await async_client.post(base + "/reconcile", headers=c["headers"], json={"outcome": "NOT_SENT"})
    ).status_code == 409


@pytest.mark.asyncio
async def test_manual_not_sent_authorises_exactly_one_more_attempt(async_client, captured_dispatch, sm):
    c = await scenario(async_client, sm, captured_dispatch, "ob_manual_resend", behavior="no_reconcile")
    queued = await new_delivery(sm, c)
    assert await work(sm, queued) == "unknown_outcome"
    resp = await async_client.post(
        f"/api/v1/organizations/{c['org_id']}/deliveries/{queued}/reconcile",
        headers=c["headers"],
        json={"outcome": "NOT_SENT"},
    )
    assert resp.status_code == 200 and resp.json()["status"] == "FAILED_RETRYABLE"
    d = await get_delivery(sm, queued)
    assert d.max_attempts >= d.attempt_count + 1 and d.resolution == "manual_not_sent"
    assert "delivery_reconciled" in await outbound_audit(sm, c["org_id"], queued)


@pytest.mark.asyncio
async def test_not_found_is_only_trusted_after_the_grace_period(async_client, captured_dispatch, sm, monkeypatch):
    monkeypatch.setattr(settings, "OUTBOUND_RECONCILE_GRACE_SECONDS", 3600)
    c = await scenario(async_client, sm, captured_dispatch, "ob_grace", behavior="lose_response_no_accept")
    queued = await new_delivery(sm, c)
    assert await work(sm, queued) == "unknown_outcome"  # provider says "no record" but it is too early to trust that
    assert MockOutboundProvider.sent_messages() == []

    monkeypatch.setattr(settings, "OUTBOUND_RECONCILE_GRACE_SECONDS", 0)
    result = await recover_stale(sm)
    assert result["reconciled"]["retry"] == 1
    d = await get_delivery(sm, queued)
    assert (
        d.status == "FAILED_RETRYABLE"
        and d.last_error_code == "confirmed_not_accepted"
        and d.resolution == "auto_reconciled"
    )

    await sql(
        sm,
        "UPDATE integrations SET config = jsonb_set(config::jsonb, '{mock_behavior}', '\"ok\"')::json WHERE id=:i",
        i=uuid.UUID(c["sender_id"]),
    )
    assert await work(sm, queued) == "sent"
    assert len(MockOutboundProvider.sent_messages()) == 1


@pytest.mark.asyncio
async def test_inconclusive_reconciliation_stays_unknown(async_client, captured_dispatch, sm):
    c = await scenario(async_client, sm, captured_dispatch, "ob_inconclusive", behavior="inconclusive_reconcile")
    queued = await new_delivery(sm, c)
    assert await work(sm, queued) == "unknown_outcome"
    await recover_stale(sm)
    assert (await get_delivery(sm, queued)).status == "UNKNOWN_OUTCOME"
    assert len(MockOutboundProvider.sent_messages()) == 1


# ============================================================================ worker death and recovery


class Crash(BaseException):
    """Simulates the process dying: not an Exception, so no handler in the code under test may swallow it."""


@pytest.mark.asyncio
async def test_worker_dying_after_claim_but_before_sending_releases_the_claim_and_sends_once(
    async_client, captured_dispatch, sm, monkeypatch
):
    c = await scenario(async_client, sm, captured_dispatch, "ob_crash_claim")
    queued = await new_delivery(sm, c)

    async def die(*a, **k):
        raise Crash()

    monkeypatch.setattr(dsvc, "_mark_sending", die)
    with pytest.raises(Crash):
        await work(sm, queued, "dead-worker")
    monkeypatch.undo()
    # (re-apply the autouse isolation that undo() removed)
    monkeypatch.setattr(worker_tasks.dispatch_outbound_deliveries, "delay", lambda *a, **k: None)
    monkeypatch.setattr(settings, "OUTBOUND_RECONCILE_GRACE_SECONDS", 0)

    d = await get_delivery(sm, queued)
    assert d.status == "CLAIMED" and d.claimed_by == "dead-worker" and MockOutboundProvider.sent_messages() == []
    # A live lease is respected: recovery does not steal it.
    assert (await recover_stale(sm))["released_claims"] == 0
    await sql(sm, "UPDATE outbound_deliveries SET lease_expires_at = now() - interval '1 minute' WHERE id=:i", i=queued)
    assert (await recover_stale(sm))["released_claims"] == 1
    d = await get_delivery(sm, queued)
    assert d.status == "PENDING" and d.claimed_by is None

    assert await work(sm, queued, "healthy-worker") == "sent"
    assert len(MockOutboundProvider.sent_messages()) == 1
    audit = await outbound_audit(sm, c["org_id"], queued)
    assert "stale_claim_released" in audit and audit.count("delivery_sent") == 1


@pytest.mark.asyncio
async def test_a_slow_worker_whose_claim_was_released_cannot_send(async_client, captured_dispatch, sm):
    c = await scenario(async_client, sm, captured_dispatch, "ob_lost_claim")
    queued = await new_delivery(sm, c)
    claimed = await dsvc._claim(sm, queued, "slow-worker", get_provider)
    assert claimed is not None
    await sql(sm, "UPDATE outbound_deliveries SET lease_expires_at = now() - interval '1 minute' WHERE id=:i", i=queued)
    await recover_stale(sm)
    assert await dsvc._mark_sending(sm, claimed, "slow-worker") is None  # CAS fails: it no longer owns the delivery
    assert MockOutboundProvider.sent_messages() == []


@pytest.mark.asyncio
@pytest.mark.parametrize("behavior,final", [("ok", "SENT"), ("no_reconcile", "UNKNOWN_OUTCOME")])
async def test_worker_dying_during_the_send_is_reconciled_never_resent(
    async_client, captured_dispatch, sm, monkeypatch, behavior, final
):
    c = await scenario(async_client, sm, captured_dispatch, f"ob_crash_send_{behavior}", behavior=behavior)
    queued = await new_delivery(sm, c)

    real_send = MockOutboundProvider.send

    async def accept_then_die(self, request):
        try:
            await real_send(self, request)
        except ProviderError:
            pass
        raise Crash()  # the provider has the message; the worker never saw the answer

    monkeypatch.setattr(MockOutboundProvider, "send", accept_then_die)
    with pytest.raises(Crash):
        await work(sm, queued, "dying-worker")
    monkeypatch.setattr(MockOutboundProvider, "send", real_send)

    d = await get_delivery(sm, queued)
    assert d.status == "SENDING" and len(MockOutboundProvider.sent_messages()) == 1
    await sql(sm, "UPDATE outbound_deliveries SET lease_expires_at = now() - interval '1 minute' WHERE id=:i", i=queued)
    result = await recover_stale(sm)

    assert result["marked_unknown"] == 1
    d = await get_delivery(sm, queued)
    assert d.status == final
    if final == "SENT":
        assert d.resolution == "auto_reconciled"
    else:
        assert d.last_error_code == "worker_lost_during_send"
    assert len(MockOutboundProvider.sent_messages()) == 1  # recovery never resent
    assert await work(sm, queued, "w2") == "skipped"
    assert len(MockOutboundProvider.sent_messages()) == 1


# ============================================================================ outbox relay


@pytest.mark.asyncio
async def test_outbox_relay_re_enqueues_deliveries_whose_enqueue_was_lost(async_client, captured_dispatch, sm):
    c = await scenario(async_client, sm, captured_dispatch, "ob_outbox")
    queued = await new_delivery(sm, c)
    assert (await get_delivery(sm, queued)).enqueued_at is None  # committed, not yet handed to the broker

    seen: List[str] = []
    mine = str(queued)
    assert queued in await dispatch_due(sm, seen.append) and seen.count(mine) == 1
    assert queued not in await dispatch_due(sm, seen.append)  # already enqueued, still within the visibility window

    def broker_down(_id: str) -> None:
        raise ConnectionError("broker unavailable")

    later = utc_now() + timedelta(seconds=settings.OUTBOUND_ENQUEUE_VISIBILITY_SECONDS + 5)
    with pytest.raises(ConnectionError):
        await dispatch_due(sm, broker_down, now=later)  # the enqueue is lost after the row was marked
    assert queued not in await dispatch_due(sm, seen.append, now=later + timedelta(seconds=1))
    much_later = later + timedelta(seconds=settings.OUTBOUND_ENQUEUE_VISIBILITY_SECONDS + 5)
    assert queued in await dispatch_due(sm, seen.append, now=much_later)  # picked up again: it cannot be forgotten

    assert await work(sm, queued) == "sent"
    assert queued not in await dispatch_due(
        sm, seen.append, now=much_later + timedelta(days=1)
    )  # finished: never re-enqueued
    # Duplicate tasks for the same delivery are harmless.
    assert await work(sm, queued, "dup") == "skipped" and len(MockOutboundProvider.sent_messages()) == 1


# ============================================================================ the workflow step end to end


@pytest.mark.asyncio
async def test_send_reply_step_queues_a_delivery_after_approval_and_never_before(async_client, captured_dispatch, sm):
    c = await scenario(async_client, sm, captured_dispatch, "ob_step", send_step=True, approve=False)
    assert await deliveries(sm, c) == []  # the run is paused at approval: nothing queued, nothing sent

    resp = await async_client.post(
        url(c["org_id"], c["approval_id"], "/approve"), headers=c["headers"], json={"reviewed_version": 1}
    )
    assert resp.status_code == 200, resp.text
    rows = await deliveries(sm, c)
    assert len(rows) == 1 and rows[0].status == "PENDING" and rows[0].workflow_run_id == uuid.UUID(c["run_id"])
    assert "send" in await step_keys_run(sm, c["run_id"])
    assert MockOutboundProvider.sent_messages() == []  # approval queues the intent; a worker sends

    assert await work(sm, rows[0].id) == "sent"
    review = await async_client.get(url(c["org_id"], c["approval_id"], "/review"), headers=c["headers"])
    assert review.status_code == 200
    summary = review.json()["delivery"]
    assert summary["status"] == "SENT" and "not confirmed" in summary["status_label"]
    assert review.json()["draft"]["status"] == "SENT"


@pytest.mark.asyncio
async def test_rejection_never_reaches_the_send_step(async_client, captured_dispatch, sm):
    c = await scenario(async_client, sm, captured_dispatch, "ob_reject_path", send_step=True, approve=False)
    resp = await async_client.post(url(c["org_id"], c["approval_id"], "/reject"), headers=c["headers"], json={})
    assert resp.status_code == 200
    assert await deliveries(sm, c) == []
    assert "send" not in await step_keys_run(sm, c["run_id"])
    assert MockOutboundProvider.sent_messages() == []


@pytest.mark.asyncio
async def test_send_reply_step_refuses_when_the_draft_is_not_approved(async_client, captured_dispatch, sm):
    from app.engine.base import StepExecutionContext
    from app.engine.executors import SendReplyExecutor

    c = await scenario(async_client, sm, captured_dispatch, "ob_step_refuse", approve=False)
    ctx = StepExecutionContext(
        organization_id=uuid.UUID(c["org_id"]),
        workflow_run_id=uuid.UUID(c["run_id"]),
        step_id=uuid.uuid4(),
        step_key="send",
        step_type="SEND_REPLY",
        workflow_data={"analyze": {"draft_id": c["draft_id"]}},
        session_factory=sm,
    )
    result = await SendReplyExecutor().execute(ctx)
    assert result.status == "FAILED" and "draft_not_approved" in (result.error_message or "")
    assert await deliveries(sm, c) == []
    empty = await SendReplyExecutor().execute(ctx.model_copy(update={"workflow_data": {}}))
    assert empty.status == "FAILED"


@pytest.mark.asyncio
async def test_reapproved_edit_gets_its_own_delivery_with_the_new_text(async_client, captured_dispatch, sm):
    c = await scenario(async_client, sm, captured_dispatch, "ob_reapprove", send_step=True)
    first = (await deliveries(sm, c))[0]
    assert first.version_number == 1 and first.status == "PENDING"

    new_text = "Hello Asha,\n\nThis is the re-approved wording.\n\nThe Team"
    edit = await async_client.put(
        url(c["org_id"], c["approval_id"], "/draft"),
        headers=c["headers"],
        json={"content": new_text, "reviewed_version": 1},
    )
    assert edit.status_code == 200, edit.text
    assert (await get_delivery(sm, first.id)).status == "CANCELLED"  # the old text can no longer go out
    assert await work(sm, first.id) == "skipped"

    new_approval = (await get_draft(sm, c["draft_id"])).approval_request_id
    ok = await async_client.post(
        url(c["org_id"], str(new_approval), "/approve"), headers=c["headers"], json={"reviewed_version": 2}
    )
    assert ok.status_code == 200, ok.text
    rows = await deliveries(sm, c)
    assert [r.version_number for r in rows] == [1, 2] and rows[1].status == "PENDING"
    assert await work(sm, rows[1].id) == "sent"
    sent = MockOutboundProvider.sent_messages()
    assert len(sent) == 1 and sent[0].body == new_text


# ============================================================================ audit and secrecy


@pytest.mark.asyncio
async def test_audit_trail_matches_what_happened_and_holds_no_content(async_client, captured_dispatch, sm):
    edited = "Hello Asha,\n\nSECRET-BODY-MARKER only in the approved text.\n\nThe Team"
    c = await scenario(async_client, sm, captured_dispatch, "ob_audit", edited=edited)
    queued = await new_delivery(sm, c)
    assert await work(sm, queued) == "sent"

    assert await outbound_audit(sm, c["org_id"], queued) == [
        "delivery_created",
        "delivery_claimed",
        "delivery_attempt_started",
        "delivery_sent",
    ]
    async with sm() as s:
        rows = (await s.execute(select(AuditLog).where(AuditLog.resource_id == str(queued)))).scalars().all()
        sent = next(r for r in rows if r.action == "outbound.delivery_sent")
        assert sent.details["provider_accepted"] is True and sent.details["delivery_confirmed"] is False
        assert (
            sent.details["attempt"] == 1
            and sent.details["version"] == 2
            and sent.organization_id == uuid.UUID(c["org_id"])
        )
        everything = " ".join(str(r.details) for r in rows)
        for secret in ("SECRET-BODY-MARKER", "asha@example.com", "sales@business.example", "Hello Asha"):
            assert secret not in everything
    d = await get_delivery(sm, queued)
    assert "SECRET-BODY-MARKER" not in str(
        [d.last_error_detail, d.provider_context, d.destination.replace("asha@example.com", "")]
    )


@pytest.mark.asyncio
async def test_mock_provider_makes_no_network_requests(async_client, captured_dispatch, sm, monkeypatch):
    c = await scenario(async_client, sm, captured_dispatch, "ob_nonet")
    queued = await new_delivery(sm, c)

    resolved_hosts: List[str] = []
    real_getaddrinfo = socket.getaddrinfo

    def guarded(host, *args, **kwargs):
        resolved_hosts.append(str(host))
        if str(host) not in ("localhost", "127.0.0.1", "::1", "None"):
            raise AssertionError(f"unexpected name resolution for {host}")
        return real_getaddrinfo(host, *args, **kwargs)

    monkeypatch.setattr(socket, "getaddrinfo", guarded)
    assert await work(sm, queued) == "sent"
    assert all(h in ("localhost", "127.0.0.1", "::1", "None") for h in resolved_hosts)

    source = Path(__file__).resolve().parents[2] / "app" / "services" / "outbound" / "providers.py"
    imported = {
        n.module.split(".")[0] if isinstance(n, ast.ImportFrom) and n.module else a.name.split(".")[0]
        for n in ast.walk(ast.parse(source.read_text(encoding="utf-8")))
        if isinstance(n, (ast.Import, ast.ImportFrom))
        for a in (n.names if isinstance(n, ast.Import) else [n])
    }
    assert not imported & {"httpx", "requests", "aiohttp", "socket", "smtplib", "urllib", "http"}


# ============================================================================ operator API


@pytest.mark.asyncio
async def test_operator_api_roles_cancel_retry_and_listing(async_client, captured_dispatch, sm):
    c = await scenario(async_client, sm, captured_dispatch, "ob_api")
    queued = await new_delivery(sm, c)
    base = f"/api/v1/organizations/{c['org_id']}/deliveries"
    viewer = await add_member(async_client, c["headers"], c["org_id"], "VIEWER")
    operator = await add_member(async_client, c["headers"], c["org_id"], "OPERATOR")
    manager = await add_member(async_client, c["headers"], c["org_id"], "MANAGER")

    for headers in (viewer, operator):
        assert (await async_client.get(base, headers=headers)).status_code == 403
        assert (await async_client.post(f"{base}/{queued}/cancel", headers=headers)).status_code == 403
    assert (await async_client.post(f"{base}/{queued}/retry", headers=manager)).status_code == 409  # not failed yet

    listing = await async_client.get(base + "?status=PENDING", headers=manager)
    assert listing.status_code == 200 and listing.json()["total"] == 1
    item = listing.json()["items"][0]
    assert item["id"] == str(queued) and item["status_label"] == "Queued" and "provider_context" not in item
    assert len(item["content_hash_prefix"]) == 16

    cancelled = await async_client.post(f"{base}/{queued}/cancel", headers=manager)
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "CANCELLED"
    assert await work(sm, queued) == "skipped" and MockOutboundProvider.sent_messages() == []
    assert (await async_client.post(f"{base}/{queued}/cancel", headers=manager)).status_code == 409
    assert (await get_draft(sm, c["draft_id"])).status == "APPROVED"  # never started, so the approval is untouched
    assert "delivery_cancelled" in await outbound_audit(sm, c["org_id"], queued)


@pytest.mark.asyncio
async def test_retry_now_skips_the_backoff_for_a_failed_delivery(async_client, captured_dispatch, sm, monkeypatch):
    monkeypatch.setattr(settings, "OUTBOUND_BACKOFF_BASE_SECONDS", 3600)
    c = await scenario(async_client, sm, captured_dispatch, "ob_retry_now", behavior="transient_once")
    queued = await new_delivery(sm, c)
    assert await work(sm, queued) == "failed_retryable"
    assert await work(sm, queued) == "skipped"
    resp = await async_client.post(
        f"/api/v1/organizations/{c['org_id']}/deliveries/{queued}/retry", headers=c["headers"]
    )
    assert resp.status_code == 200
    assert await work(sm, queued) == "sent" and len(MockOutboundProvider.sent_messages()) == 1


# ============================================================================ configuration and classification


def test_provider_errors_are_classified_and_non_mock_providers_are_refused():
    assert {k.value for k in ErrorKind} == {"transient", "permanent", "uncertain"}
    err = ProviderError(ErrorKind.UNCERTAIN, "x", "safe")
    assert err.kind == ErrorKind.UNCERTAIN and str(err) == "safe"
    assert get_provider("mock").name == "mock"
    for name in ("gmail", "whatsapp", "smtp", "meta", ""):
        with pytest.raises(ProviderError) as refused:
            get_provider(name)
        assert refused.value.code == "provider_not_enabled" and refused.value.kind == ErrorKind.PERMANENT


def test_beat_schedule_and_compose_run_exactly_one_scheduler():
    from app.workers.celery_app import celery_app

    schedule = {v["task"] for v in celery_app.conf.beat_schedule.values()}
    assert {
        "tasks.dispatch_outbound_deliveries",
        "tasks.recover_stale_deliveries",
        "tasks.recover_stalled_approvals",
    } <= schedule
    assert celery_app.conf.task_routes["tasks.deliver_outbound"] == {"queue": "outbound"}
    assert any(q.name == "outbound" for q in celery_app.conf.task_queues)

    root = Path(__file__).resolve().parents[3]
    for compose in ("docker-compose.yml", "docker-compose.prod.yml"):
        text_ = (root / compose).read_text(encoding="utf-8")
        beat_services = [ln for ln in text_.splitlines() if ln.startswith("  celery_beat:")]
        assert len(beat_services) == 1, compose
        beat_commands = [
            ln
            for ln in text_.splitlines()
            if ln.strip().startswith("command:") and ("celery_app beat" in ln or '"beat"' in ln)
        ]
        assert len(beat_commands) == 1, compose  # exactly one scheduler process per stack
        block = text_[text_.index("  celery_beat:") :].split("\n  frontend:")[0]
        assert "container_name:" in block  # fixed name: compose refuses to scale it past one replica
        assert "--schedule=/tmp/celerybeat-schedule" in block

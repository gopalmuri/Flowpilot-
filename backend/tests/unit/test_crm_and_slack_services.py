import asyncio
import pytest
from app.services.crm.mock_crm_service import MockCRMService
from app.services.slack.slack_service import SlackService


@pytest.mark.asyncio
async def test_mock_crm_lead_creation_and_retrieval():
    crm = MockCRMService(use_redis=False)  # In-memory test

    lead_input = {
        "company": "Acme Corp",
        "email": "pilot@acme.com",
        "deal_size": "$50,000",
        "lead_score": 92,
    }

    result = await crm.create_lead("org-crm-1", lead_input)
    assert result["status"] == "created"
    assert result["crm_id"].startswith("crm_lead_")
    assert result["attributes"]["company"] == "Acme Corp"
    assert result["latency_ms"] >= 0.0

    # Retrieve
    stored = await crm.get_lead("org-crm-1", result["crm_id"])
    assert stored is not None
    assert stored["email"] == "pilot@acme.com"
    assert stored["company"] == "Acme Corp"


@pytest.mark.asyncio
async def test_mock_crm_email_deduplication():
    crm = MockCRMService(use_redis=False)

    lead_1 = {
        "company": "Stark Industries",
        "email": "tony@stark.com",
        "tier": "Enterprise",
    }
    res1 = await crm.create_lead("org-crm-1", lead_1)
    assert res1["status"] == "created"
    first_id = res1["crm_id"]

    # Attempt to create duplicate lead with same email in same org
    lead_2 = {
        "company": "Stark Industries Inc",
        "email": "tony@stark.com",
        "tier": "Tier 1",
    }
    res2 = await crm.create_lead("org-crm-1", lead_2)
    assert res2["status"] == "already_exists"
    assert res2["crm_id"] == first_id
    assert res2["attributes"]["tier"] == "Tier 1"

    # Only 1 lead should exist in search
    search_res = await crm.search_leads("org-crm-1", "tony@stark.com")
    assert len(search_res) == 1


@pytest.mark.asyncio
async def test_mock_crm_organization_isolation():
    crm = MockCRMService(use_redis=False)

    res_org1 = await crm.create_lead("org-111", {"company": "Org1 Co", "email": "user@org.com"})
    lead_id = res_org1["crm_id"]

    # Org 2 cannot retrieve Org 1's lead
    res_org2 = await crm.get_lead("org-222", lead_id)
    assert res_org2 is None

    # Searching in Org 2 yields 0 results
    search_org2 = await crm.search_leads("org-222", "user@org.com")
    assert len(search_org2) == 0


@pytest.mark.asyncio
async def test_mock_crm_concurrent_duplicate_create():
    crm = MockCRMService(use_redis=False)

    lead_data = {"company": "Speedy Corp", "email": "speedy@test.com"}

    # Run 5 concurrent creations with identical email
    tasks = [
        crm.create_lead("org-concurrent", lead_data)
        for _ in range(5)
    ]
    results = await asyncio.gather(*tasks)

    # Exactly one should be "created", others "already_exists"
    statuses = [r["status"] for r in results]
    assert statuses.count("created") == 1
    assert statuses.count("already_exists") == 4

    # All must share the exact same crm_id
    ids = {r["crm_id"] for r in results}
    assert len(ids) == 1


@pytest.mark.asyncio
async def test_mock_crm_test_connection():
    crm = MockCRMService(use_redis=False)
    diag = await crm.test_connection("org-diag")
    assert diag["status"] == "healthy"
    assert diag["latency_ms"] >= 1.0


def test_slack_template_interpolation_valid_and_nested():
    slack = SlackService()

    template = "Lead {{ lead.company }} (Category: {{ ai.category }}) scored {{ lead.score }}. Sub: {{ trigger.user.name }}."
    context = {
        "lead": {"company": "Globex", "score": 98},
        "ai": {"category": "ENTERPRISE"},
        "trigger": {
            "user": {
                "name": "Homer Simpson"
            }
        },
    }

    rendered = slack.interpolate_template(template, context)
    assert rendered == "Lead Globex (Category: ENTERPRISE) scored 98. Sub: Homer Simpson."


def test_slack_template_interpolation_missing_variable():
    slack = SlackService()

    template = "Contact: {{ trigger.email }} & Phone: {{ trigger.phone }}."
    context = {
        "trigger": {
            "email": "homer@globex.com"
        }
    }

    # Missing variable trigger.phone resolves to empty string
    rendered = slack.interpolate_template(template, context)
    assert rendered == "Contact: homer@globex.com & Phone: ."


def test_slack_template_interpolation_blocks_unauthorized_namespace():
    slack = SlackService()

    template = "Key: {{ settings.SECRET_KEY }} & Path: {{ env.PATH }}."
    context = {
        "settings": {"SECRET_KEY": "supersecret"},
        "env": {"PATH": "/usr/bin"},
    }

    rendered = slack.interpolate_template(template, context)
    assert "[UNAUTHORIZED_NAMESPACE]" in rendered
    assert "supersecret" not in rendered


def test_slack_template_interpolation_blocks_sensitive_keys():
    slack = SlackService()

    template = "Password: {{ lead.password }} & Token: {{ trigger.api_key }}."
    context = {
        "lead": {"password": "mypassword123"},
        "trigger": {"api_key": "sk-test-token"},
    }

    rendered = slack.interpolate_template(template, context)
    assert rendered == "Password: [REDACTED] & Token: [REDACTED]."
    assert "mypassword123" not in rendered
    assert "sk-test-token" not in rendered


def test_slack_format_lead_notification():
    slack = SlackService()

    lead = {"company": "Wayne Enterprises", "email": "bruce@wayne.com", "deal_size": "$1,000,000"}
    classification = {"category": "enterprise", "priority": "urgent", "confidence": 0.96}

    res = slack.format_lead_notification(lead, classification, channel="#sales-vip")
    assert "Wayne Enterprises" in res["text"]
    assert res["channel"] == "#sales-vip"
    assert len(res["blocks"]) == 3
    assert res["blocks"][0]["type"] == "header"
    assert res["blocks"][1]["type"] == "section"
    assert res["blocks"][2]["type"] == "context"


@pytest.mark.asyncio
async def test_slack_mock_delivery_and_test():
    slack = SlackService()

    # Dispatch to mock URL
    res = await slack.send_notification(
        webhook_url="https://hooks.slack.com/services/MOCK/000/111",
        message="Hello World",
        channel="#general",
    )
    assert res["delivery_status"] == "delivered"
    assert res["mock_adapter"] is True
    assert res["message_id"].startswith("slack_msg_")

    # Test webhook diagnostic
    diag = await slack.test_webhook("mock://slack", mock_mode=True)
    assert diag["status"] == "healthy"
    assert diag["latency_ms"] >= 1.0

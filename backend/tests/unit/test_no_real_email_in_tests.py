import smtplib

import pytest

from app.core.config import settings
from app.services.email.verification import send_verification_email


def test_test_suite_has_no_smtp_credentials():
    assert not settings.SMTP_USER and not settings.SMTP_PASSWORD


@pytest.mark.asyncio
async def test_verification_email_never_opens_an_smtp_connection_under_test(monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("a test tried to open a real SMTP connection")

    monkeypatch.setattr(smtplib, "SMTP", boom)
    assert await send_verification_email("someone@example.com", "123456") is True


@pytest.mark.asyncio
async def test_registering_a_user_sends_no_real_email(async_client, monkeypatch):
    import uuid

    def boom(*args, **kwargs):
        raise AssertionError("registration tried to open a real SMTP connection")

    monkeypatch.setattr(smtplib, "SMTP", boom)
    resp = await async_client.post(
        "/api/v1/auth/register",
        json={"email": f"nomail_{uuid.uuid4().hex[:8]}@flowpilot.internal", "password": "Str0ng!Passw0rd#1", "full_name": "No Mail"},
    )
    assert resp.status_code == 201, resp.text

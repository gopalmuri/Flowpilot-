import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.models.email_verification import EmailVerification
from app.models.user import User
from app.services.email.verification import hash_otp


async def _register_and_verify(async_client: AsyncClient):
    engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    uid = uuid.uuid4().hex[:8]
    email = f"already_verified_{uid}@company.com"

    reg = await async_client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": f"SecurePass_{uid}!123", "full_name": "Already Verified", "organization_name": "AV Org"},
    )
    assert reg.status_code == 201, reg.text

    async with session_factory() as session:
        user = (await session.execute(select(User).where(User.email == email))).scalar_one()
        verification = (await session.execute(select(EmailVerification).where(EmailVerification.user_id == user.id))).scalar_one()
        verification.otp_hash = hash_otp("123456", salt=str(user.id))
        await session.commit()

    ok = await async_client.post("/api/v1/auth/verify-email", json={"email": email, "code": "123456"})
    assert ok.status_code == 200, ok.text
    return email


@pytest.mark.asyncio
async def test_verified_account_cannot_get_tokens_from_verify_email_with_any_code(async_client: AsyncClient):
    """Regression: /verify-email used to issue tokens for an already-verified account without checking the code,
    bypassing both the password and the login code."""
    email = await _register_and_verify(async_client)

    for code in ("000000", "123456", "999999"):
        resp = await async_client.post("/api/v1/auth/verify-email", json={"email": email, "code": code})
        assert resp.status_code == 400, (code, resp.text)
        body = resp.json()
        assert "access_token" not in body and "refresh_token" not in body
        assert "already verified" in body["detail"].lower()
    assert "refresh_token" not in resp.cookies


@pytest.mark.asyncio
async def test_unknown_email_is_still_404(async_client: AsyncClient):
    resp = await async_client.post("/api/v1/auth/verify-email", json={"email": f"nobody_{uuid.uuid4().hex[:8]}@company.com", "code": "123456"})
    assert resp.status_code == 404

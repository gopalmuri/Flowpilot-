import uuid
import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.models.email_verification import EmailVerification
from app.models.user import User
from app.services.email.verification import hash_otp


@pytest.mark.asyncio
async def test_login_otp_flow_and_no_dev_otp_exposed(async_client: AsyncClient):
    engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    unique_id = uuid.uuid4().hex[:8]
    email = f"otp_login_user_{unique_id}@company.com"
    password = f"SecurePass_{unique_id}!123"

    # 1. Register user
    reg_resp = await async_client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": password,
            "full_name": "Test Login OTP User",
            "organization_name": "Test Org",
        },
    )
    assert reg_resp.status_code == 201
    reg_data = reg_resp.json()
    assert reg_data["requires_verification"] is True
    # Verify dev_otp is NOT exposed in signup response
    assert reg_data.get("dev_otp") is None

    # 2. Verify email so account becomes verified
    async with session_factory() as session:
        u_res = await session.execute(select(User).where(User.email == email))
        user = u_res.scalar_one()
        user.is_verified = True
        await session.commit()

    # 3. Step 1 of Login: Post email + password
    login_resp = await async_client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert login_resp.status_code == 200, login_resp.text
    login_data = login_resp.json()
    # Should require OTP and NOT expose tokens or dev_otp yet
    assert login_data.get("requires_otp") is True
    assert "access_token" not in login_data
    assert login_data.get("dev_otp") is None

    # 4. Check that a login OTP was created in database
    async with session_factory() as session:
        v_res = await session.execute(
            select(EmailVerification).where(EmailVerification.user_id == user.id)
        )
        verification = v_res.scalar_one_or_none()
        assert verification is not None

        # Set a deterministic OTP for testing
        known_otp = "654321"
        verification.otp_hash = hash_otp(known_otp, salt=str(user.id))
        await session.commit()

    # 5. Verify login with WRONG code -> 400 Bad Request
    wrong_resp = await async_client.post(
        "/api/v1/auth/verify-login-otp",
        json={"email": email, "code": "000000"},
    )
    assert wrong_resp.status_code == 400
    assert "Invalid" in wrong_resp.json()["detail"]

    # 6. Verify login with CORRECT code -> 200 OK + JWT tokens
    correct_resp = await async_client.post(
        "/api/v1/auth/verify-login-otp",
        json={"email": email, "code": known_otp},
    )
    assert correct_resp.status_code == 200, correct_resp.text
    token_data = correct_resp.json()
    assert "access_token" in token_data
    assert token_data["token_type"] == "bearer"

    # 7. Verification record should be cleaned up after successful login
    async with session_factory() as session:
        v_res = await session.execute(
            select(EmailVerification).where(EmailVerification.user_id == user.id)
        )
        assert v_res.scalar_one_or_none() is None

    await engine.dispose()

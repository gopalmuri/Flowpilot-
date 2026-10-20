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
async def test_full_email_verification_flow(async_client: AsyncClient):
    engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    unique_id = uuid.uuid4().hex[:8]
    email = f"verified_user_{unique_id}@company.com"
    password = f"SecurePass_{unique_id}!123"

    # 1. Register user
    reg_resp = await async_client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": password,
            "full_name": "Test Verified User",
            "organization_name": "Test Org",
        },
    )
    assert reg_resp.status_code == 201, reg_resp.text
    data = reg_resp.json()
    assert data["requires_verification"] is True
    assert data["email"] == email

    # 2. Attempt login BEFORE verification -> should be blocked with 403 email_not_verified
    login_resp = await async_client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert login_resp.status_code == 403
    assert login_resp.json()["detail"] == "email_not_verified"

    # 3. Fetch verification record from DB to test OTP
    async with session_factory() as session:
        u_res = await session.execute(select(User).where(User.email == email))
        user = u_res.scalar_one()
        assert user.is_verified is False

        v_res = await session.execute(
            select(EmailVerification).where(EmailVerification.user_id == user.id)
        )
        verification = v_res.scalar_one_or_none()
        assert verification is not None

        # Set a known OTP for deterministic testing
        known_otp = "123456"
        verification.otp_hash = hash_otp(known_otp, salt=str(user.id))
        await session.commit()

    # 4. Verify with WRONG code -> should fail with 400
    wrong_resp = await async_client.post(
        "/api/v1/auth/verify-email",
        json={"email": email, "code": "000000"},
    )
    assert wrong_resp.status_code == 400
    assert "Invalid verification code" in wrong_resp.json()["detail"]

    # 5. Verify with CORRECT code -> should succeed and issue tokens
    verify_resp = await async_client.post(
        "/api/v1/auth/verify-email",
        json={"email": email, "code": known_otp},
    )
    assert verify_resp.status_code == 200
    verify_data = verify_resp.json()
    assert "access_token" in verify_data
    assert verify_data["token_type"] == "bearer"

    # 6. Check database: user is now verified, verification record deleted
    async with session_factory() as session:
        u_res = await session.execute(select(User).where(User.email == email))
        user = u_res.scalar_one()
        assert user.is_verified is True

        v_res = await session.execute(
            select(EmailVerification).where(EmailVerification.user_id == user.id)
        )
        assert v_res.scalar_one_or_none() is None

    # 7. Attempt login AFTER verification -> should succeed with 200 and return tokens
    login_success = await async_client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert login_success.status_code == 200
    assert "access_token" in login_success.json()

    await engine.dispose()

import pytest
from app.services.email.verification import (
    generate_otp,
    hash_otp,
    verify_otp_hash,
    send_verification_email,
)

def test_generate_otp():
    otp = generate_otp()
    assert len(otp) == 6
    assert otp.isdigit()

def test_otp_hash_and_verification():
    salt = "test-salt-uuid"
    otp = "123456"
    hashed = hash_otp(otp, salt=salt)
    
    assert verify_otp_hash("123456", hashed, salt=salt) is True
    assert verify_otp_hash("654321", hashed, salt=salt) is False
    assert verify_otp_hash("123456", hashed, salt="wrong-salt") is False

@pytest.mark.asyncio
async def test_send_verification_email_dev_fallback():
    # When SMTP is unconfigured, should log and return True without throwing
    success = await send_verification_email("dev.user@example.com", "999888")
    assert success is True

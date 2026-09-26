import uuid
from datetime import timedelta
import pytest
from pydantic import ValidationError
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_password_hash,
    verify_password,
)
from app.schemas.auth import UserRegisterRequest


def test_argon2id_password_hashing():
    password = "FlowPilotSecurePassword123!"
    h = get_password_hash(password)
    assert h.startswith("$argon2id$")
    assert "m=65536" in h
    assert "t=3" in h
    assert "p=4" in h
    assert verify_password(password, h) is True
    assert verify_password("WrongPassword123!", h) is False


def test_access_token_claims_and_decoding():
    user_id = str(uuid.uuid4())
    email = "pilot@flowpilot.internal"
    org_id = str(uuid.uuid4())
    role = "OWNER"

    token, jti, expires_in = create_access_token(
        user_id=user_id,
        email=email,
        org_id=org_id,
        role=role,
    )
    assert isinstance(token, str)
    assert isinstance(jti, str)
    assert expires_in == 1800

    payload = decode_token(token, expected_type="access")
    assert payload["sub"] == user_id
    assert payload["email"] == email
    assert payload["org_id"] == org_id
    assert payload["role"] == role
    assert payload["jti"] == jti
    assert payload["type"] == "access"


def test_refresh_token_claims():
    user_id = str(uuid.uuid4())
    token, jti, expires_in = create_refresh_token(user_id=user_id)
    assert expires_in == 7 * 86400

    payload = decode_token(token, expected_type="refresh")
    assert payload["sub"] == user_id
    assert payload["type"] == "refresh"
    assert payload["jti"] == jti


def test_expired_token_rejection():
    user_id = str(uuid.uuid4())
    token, _, _ = create_access_token(
        user_id=user_id,
        email="test@flowpilot.internal",
        expires_delta=timedelta(seconds=-10),
    )
    with pytest.raises(ValueError, match="Token validation failed"):
        decode_token(token)


def test_password_complexity_validator():
    # Valid password
    valid = UserRegisterRequest(
        email="user@flowpilot.internal",
        password="ValidPassword123!",
        full_name="Valid User",
    )
    assert valid.password == "ValidPassword123!"

    # Too short (< 10)
    with pytest.raises(ValidationError):
        UserRegisterRequest(
            email="user@flowpilot.internal",
            password="Sh1!",
            full_name="User",
        )

    # Missing uppercase
    with pytest.raises(ValidationError, match="uppercase"):
        UserRegisterRequest(
            email="user@flowpilot.internal",
            password="lowercase123!",
            full_name="User",
        )

    # Missing lowercase
    with pytest.raises(ValidationError, match="lowercase"):
        UserRegisterRequest(
            email="user@flowpilot.internal",
            password="UPPERCASE123!",
            full_name="User",
        )

    # Missing digit
    with pytest.raises(ValidationError, match="numeric"):
        UserRegisterRequest(
            email="user@flowpilot.internal",
            password="NoDigitsHere!",
            full_name="User",
        )

    # Missing special char
    with pytest.raises(ValidationError, match="special"):
        UserRegisterRequest(
            email="user@flowpilot.internal",
            password="NoSpecialChars123",
            full_name="User",
        )

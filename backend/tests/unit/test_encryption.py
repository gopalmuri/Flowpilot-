import os
import pytest
from app.core.config import settings
from app.core.encryption import (
    DecryptionFailedError,
    EncryptionError,
    InvalidKeyError,
    decrypt_credentials,
    encrypt_credentials,
    parse_encryption_key,
    validate_production_key,
)


def test_parse_encryption_key_valid_formats():
    # 1. 32-byte raw bytes
    raw_32 = os.urandom(32)
    assert parse_encryption_key(raw_32) == raw_32

    # 2. 64-char hex string
    hex_64 = raw_32.hex()
    assert parse_encryption_key(hex_64) == raw_32

    # 3. 32-char string
    str_32 = "12345678901234567890123456789012"
    assert parse_encryption_key(str_32) == str_32.encode("utf-8")


def test_parse_encryption_key_invalid_length_and_encoding():
    # Too short
    with pytest.raises(InvalidKeyError, match="must decode to exactly 32 bytes"):
        parse_encryption_key("short_key_16_b!")

    # Too long (33 bytes)
    with pytest.raises(InvalidKeyError, match="must decode to exactly 32 bytes"):
        parse_encryption_key("123456789012345678901234567890123")

    # Empty string
    with pytest.raises(InvalidKeyError, match="cannot be empty"):
        parse_encryption_key("")

    # Non-32 bytes
    with pytest.raises(InvalidKeyError, match="must be exactly 32 bytes"):
        parse_encryption_key(b"short")


def test_encryption_round_trip():
    creds = {
        "webhook_url": "https://hooks.slack.com/services/T00/B00/SECRET",
        "api_key": "sk-crm-prod-secret-999",
        "nested": {"client_id": "cid-123", "sub": "val"},
        "active": True,
        "count": 42,
    }

    encrypted = encrypt_credentials(creds)
    assert isinstance(encrypted, bytes)
    assert len(encrypted) >= 28

    decrypted = decrypt_credentials(encrypted)
    assert decrypted == creds


def test_encryption_unicode_credentials():
    creds = {
        "channel": "#日本語-alerts",
        "description": "Enterprise 🚀 Notification & 客户管理",
        "emoji": "🎉🔥✨",
    }

    encrypted = encrypt_credentials(creds)
    decrypted = decrypt_credentials(encrypted)
    assert decrypted == creds


def test_encryption_empty_credentials():
    creds = {}
    encrypted = encrypt_credentials(creds)
    decrypted = decrypt_credentials(encrypted)
    assert decrypted == {}


def test_encryption_auth_tag_tampering():
    creds = {"api_key": "secret"}
    encrypted = bytearray(encrypt_credentials(creds))

    # Tamper with the last byte (part of auth tag)
    encrypted[-1] ^= 0x01

    with pytest.raises(DecryptionFailedError, match="authentication tag verification failed"):
        decrypt_credentials(bytes(encrypted))


def test_encryption_wrong_key():
    key_a = os.urandom(32)
    key_b = os.urandom(32)
    creds = {"api_key": "secret"}

    encrypted = encrypt_credentials(creds, key=key_a)

    with pytest.raises(DecryptionFailedError, match="authentication tag verification failed"):
        decrypt_credentials(encrypted, key=key_b)


def test_encryption_corrupted_nonce():
    creds = {"token": "secret-token"}
    encrypted = bytearray(encrypt_credentials(creds))

    # Tamper with the nonce (first 12 bytes)
    encrypted[0] ^= 0xFF

    with pytest.raises(DecryptionFailedError, match="authentication tag verification failed"):
        decrypt_credentials(bytes(encrypted))


def test_encryption_truncated_ciphertext():
    # Pass fewer than 28 bytes
    with pytest.raises(DecryptionFailedError, match="corrupted or truncated"):
        decrypt_credentials(b"too_short_bytes")


def test_encryption_malformed_decrypted_json():
    # Encrypt raw non-JSON bytes with valid key/nonce using AESGCM directly
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    key = parse_encryption_key(settings.ENCRYPTION_KEY)
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    bad_payload = b"not a json string at all {"
    ciphertext = aesgcm.encrypt(nonce, bad_payload, None)

    with pytest.raises(DecryptionFailedError, match="malformed JSON"):
        decrypt_credentials(nonce + ciphertext)


def test_validate_production_key(monkeypatch):
    # In production, default dev key must raise RuntimeError
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef")

    with pytest.raises(RuntimeError, match="Production environment requires a secure, non-default ENCRYPTION_KEY"):
        validate_production_key()

    # In production, valid non-default 32-byte key must pass
    safe_prod_key = os.urandom(32).hex()
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", safe_prod_key)
    validate_production_key()  # Should not raise

    # In development, default key must pass
    monkeypatch.setattr(settings, "ENVIRONMENT", "development")
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef")
    validate_production_key()  # Should not raise

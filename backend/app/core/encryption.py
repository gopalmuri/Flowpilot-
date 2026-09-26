import base64
import json
import os
from typing import Any, Dict, Optional, Union
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from app.core.config import settings

DEFAULT_DEV_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef"


class EncryptionError(Exception):
    """Base exception for encryption and decryption errors. Never includes sensitive data."""
    pass


class InvalidKeyError(EncryptionError):
    """Raised when an encryption key is invalid or does not decode to exactly 32 bytes."""
    pass


class DecryptionFailedError(EncryptionError):
    """Raised when decryption fails due to tag mismatch, corrupted nonce, or bad key."""
    pass


def parse_encryption_key(key_input: Union[str, bytes]) -> bytes:
    """
    Parses and validates an AES-256 key, requiring exactly 32 decoded bytes (256 bits).
    Supports:
      1. Raw 32-byte bytes.
      2. 64-character hexadecimal string.
      3. 32-character raw UTF-8 string.
      4. 44-character Base64 encoded string.
    Raises InvalidKeyError if decoding fails or decoded length is not 32 bytes.
    """
    if isinstance(key_input, bytes):
        if len(key_input) == 32:
            return key_input
        raise InvalidKeyError(f"Encryption key bytes must be exactly 32 bytes, got {len(key_input)}")

    if not isinstance(key_input, str) or not key_input.strip():
        raise InvalidKeyError("Encryption key string cannot be empty or non-string")

    cleaned = key_input.strip()

    # 1. Check for 64-hex chars
    if len(cleaned) == 64:
        try:
            decoded = bytes.fromhex(cleaned)
            if len(decoded) == 32:
                return decoded
        except ValueError:
            pass

    # 2. Check for Base64 (44 chars)
    if len(cleaned) == 44:
        try:
            decoded = base64.b64decode(cleaned, validate=True)
            if len(decoded) == 32:
                return decoded
        except Exception:
            pass

    # 3. Check for raw 32-byte UTF-8 string
    encoded = cleaned.encode("utf-8")
    if len(encoded) == 32:
        return encoded

    raise InvalidKeyError(
        f"Encryption key must decode to exactly 32 bytes. Decoded size was {len(encoded)} bytes."
    )


def validate_production_key() -> None:
    """
    Validates encryption key on application startup.
    Fails startup if in production and key is missing, invalid, or using the development default.
    Never silently generates a replacement key or falls back to dev key in production.
    """
    key_str = getattr(settings, "ENCRYPTION_KEY", None)

    if settings.ENVIRONMENT.lower() == "production":
        if not key_str or key_str == DEFAULT_DEV_ENCRYPTION_KEY:
            raise RuntimeError(
                "FATAL: Production environment requires a secure, non-default ENCRYPTION_KEY of exactly 32 bytes. Cannot start."
            )
        try:
            parse_encryption_key(key_str)
        except Exception as e:
            raise RuntimeError(
                f"FATAL: Production ENCRYPTION_KEY is invalid: {str(e)}. Cannot start."
            )
    else:
        # Development / testing mode validation
        if not key_str:
            raise InvalidKeyError("ENCRYPTION_KEY setting is missing or empty.")
        parse_encryption_key(key_str)


def encrypt_credentials(
    data: Dict[str, Any],
    key: Optional[Union[str, bytes]] = None,
    aad: Optional[bytes] = None,
) -> bytes:
    """
    Encrypts a credentials dictionary using AES-256-GCM.
    Returns: nonce (12 bytes) + ciphertext_with_tag.
    Sensitive credentials are never logged or exposed in exceptions.
    """
    resolved_key = parse_encryption_key(key if key is not None else settings.ENCRYPTION_KEY)

    try:
        json_bytes = json.dumps(data, ensure_ascii=False).encode("utf-8")
    except Exception as e:
        raise EncryptionError(f"Failed to serialize credentials to JSON: {type(e).__name__}")

    nonce = os.urandom(12)
    aesgcm = AESGCM(resolved_key)

    try:
        ciphertext = aesgcm.encrypt(nonce, json_bytes, aad)
    except Exception as e:
        raise EncryptionError(f"Encryption failed: {type(e).__name__}")

    return nonce + ciphertext


def decrypt_credentials(
    encrypted_bytes: bytes,
    key: Optional[Union[str, bytes]] = None,
    aad: Optional[bytes] = None,
) -> Dict[str, Any]:
    """
    Decrypts an AES-256-GCM encrypted byte payload into a dictionary.
    Payload format: nonce (12 bytes) + ciphertext_with_tag (min 16 bytes).
    Raises DecryptionFailedError if tag mismatch, corrupted nonce, wrong key, or truncated.
    """
    if not isinstance(encrypted_bytes, (bytes, bytearray)):
        raise DecryptionFailedError("Encrypted payload must be bytes")

    # 12 bytes nonce + 16 bytes authentication tag = minimum 28 bytes
    if len(encrypted_bytes) < 28:
        raise DecryptionFailedError("Encrypted payload is corrupted or truncated (fewer than 28 bytes)")

    resolved_key = parse_encryption_key(key if key is not None else settings.ENCRYPTION_KEY)

    nonce = bytes(encrypted_bytes[:12])
    ciphertext = bytes(encrypted_bytes[12:])

    aesgcm = AESGCM(resolved_key)

    try:
        decrypted_bytes = aesgcm.decrypt(nonce, ciphertext, aad)
    except InvalidTag:
        raise DecryptionFailedError("Decryption authentication tag verification failed. Bad key, corrupted ciphertext, or tampered payload.")
    except Exception as e:
        raise DecryptionFailedError(f"Decryption failed: {type(e).__name__}")

    try:
        parsed = json.loads(decrypted_bytes.decode("utf-8"))
        if not isinstance(parsed, dict):
            raise DecryptionFailedError("Decrypted credentials payload is not a JSON object")
        return parsed
    except DecryptionFailedError:
        raise
    except Exception:
        raise DecryptionFailedError("Decrypted payload contains malformed JSON")

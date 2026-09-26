import json
from typing import Any, Dict, List, Optional, Set, Union

SENSITIVE_KEY_PATTERNS: Set[str] = {
    "password",
    "token",
    "secret",
    "api_key",
    "authorization",
    "auth",
    "access_token",
    "refresh_token",
    "credit_card",
    "card_number",
    "cvv",
    "ssn",
}

MAX_STORED_PAYLOAD_BYTES: int = 65536  # 64 KB

AI_TOKEN_KEYS: Set[str] = {
    "tokens_used",
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "ai_tokens",
    "max_tokens",
}


def is_sensitive_key(key: str) -> bool:
    """Checks whether a dictionary key matches any sensitive security pattern."""
    normalized = key.lower().replace("-", "_")
    if normalized in AI_TOKEN_KEYS:
        return False
    for pattern in SENSITIVE_KEY_PATTERNS:
        if pattern in normalized:
            return True
    return False


def mask_sensitive_data(data: Any) -> Any:
    """
    Recursively inspects and masks sensitive keys within nested dictionaries and lists.
    Replaces sensitive values with '[REDACTED]'.
    If a sensitive key contains a nested dict or list (e.g. auth: {...}), recurses to preserve
    structure while masking internal leaf credentials.
    """
    if isinstance(data, dict):
        masked_dict: Dict[str, Any] = {}
        for k, v in data.items():
            if isinstance(k, str) and is_sensitive_key(k):
                if isinstance(v, (dict, list)):
                    masked_dict[k] = mask_sensitive_data(v)
                else:
                    masked_dict[k] = "[REDACTED]"
            else:
                masked_dict[k] = mask_sensitive_data(v)
        return masked_dict

    elif isinstance(data, list):
        return [mask_sensitive_data(item) for item in data]

    return data


def truncate_payload(data: Any, max_bytes: int = MAX_STORED_PAYLOAD_BYTES) -> Any:
    """
    Ensures serialized payload size does not exceed max_bytes.
    If payload exceeds the threshold, safely truncates while preserving valid JSON
    structure and attaching explicit truncation metadata.
    """
    try:
        serialized = json.dumps(data)
        encoded_len = len(serialized.encode("utf-8"))
        if encoded_len <= max_bytes:
            return data

        # Data exceeds maximum bytes; construct structured truncation container
        preview_data: Any = {}
        if isinstance(data, dict):
            # Include keys with truncated string representations until budget
            budget = max_bytes - 1024  # Reserve 1KB for metadata envelope
            current_bytes = 0
            for k, v in data.items():
                v_str = json.dumps(v)
                v_len = len(v_str.encode("utf-8"))
                if current_bytes + v_len < budget:
                    preview_data[k] = v
                    current_bytes += v_len
                else:
                    preview_data[k] = f"[TRUNCATED: original value size {v_len} bytes]"
                    break
        elif isinstance(data, list):
            preview_data = data[:10]  # First 10 items
        else:
            preview_data = str(data)[:1000]

        return {
            "_truncated": True,
            "_original_size": encoded_len,
            "data": preview_data,
        }
    except Exception:
        return {"_truncated": True, "data": "[UNSERIALIZABLE PAYLOAD]"}


def sanitize_payload(data: Any, max_bytes: int = MAX_STORED_PAYLOAD_BYTES) -> Any:
    """
    Combined utility: recursively masks sensitive credentials and enforces
    the 64KB storage cap.
    """
    if data is None:
        return {}
    masked = mask_sensitive_data(data)
    return truncate_payload(masked, max_bytes=max_bytes)


def sanitize_error_message(msg: Optional[str]) -> Optional[str]:
    """
    Strips raw tokens, passwords, and sensitive keywords from user-facing error text.
    """
    if not msg:
        return msg

    sanitized = str(msg)
    # Check for authorization headers or bearer tokens
    for pattern in ["Bearer ", "token=", "key=", "secret="]:
        if pattern.lower() in sanitized.lower():
            idx = sanitized.lower().find(pattern.lower())
            sanitized = sanitized[:idx + len(pattern)] + "[REDACTED]"

    # Truncate overly long error messages to 2000 chars
    if len(sanitized) > 2000:
        sanitized = sanitized[:2000] + "... [error message truncated]"

    return sanitized

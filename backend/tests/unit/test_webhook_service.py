import ast
import hashlib
import hmac
import time
import uuid
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.models.workflow_step import WorkflowStep
from app.services.webhook_service import (
    MAX_PAYLOAD_SIZE_BYTES,
    MAX_TIMESTAMP_TOLERANCE_SECONDS,
    calculate_hmac_signature,
    extract_signature_header,
    extract_webhook_secret_and_config,
    format_scoped_idempotency_key,
    validate_payload_size,
    verify_hmac_signature,
    verify_timestamp,
)


def test_validate_payload_size_valid():
    """Payloads within 64KB limit pass validation."""
    valid_body = b'{"event": "test"}'
    validate_payload_size(valid_body)

    boundary_body = b"x" * MAX_PAYLOAD_SIZE_BYTES
    validate_payload_size(boundary_body)


def test_validate_payload_size_exceeded():
    """Payloads exceeding 64KB raise HTTP 413 Payload Too Large."""
    oversized_body = b"x" * (MAX_PAYLOAD_SIZE_BYTES + 1)
    with pytest.raises(HTTPException) as exc_info:
        validate_payload_size(oversized_body)
    assert exc_info.value.status_code == 413
    assert "Payload exceeds maximum limit" in exc_info.value.detail


def test_verify_timestamp_valid():
    """Valid UTC epoch timestamp within 300s tolerance returns float."""
    now_ts = datetime.now(timezone.utc).timestamp()
    ts = verify_timestamp(str(now_ts))
    assert isinstance(ts, float)
    assert abs(ts - now_ts) < 2.0


def test_verify_timestamp_missing():
    """Missing or empty timestamp raises HTTP 401."""
    with pytest.raises(HTTPException) as exc_info:
        verify_timestamp(None)
    assert exc_info.value.status_code == 401
    assert "Missing required X-Webhook-Timestamp header" in exc_info.value.detail

    with pytest.raises(HTTPException) as exc_info:
        verify_timestamp("   ")
    assert exc_info.value.status_code == 401
    assert "Missing required X-Webhook-Timestamp header" in exc_info.value.detail


def test_verify_timestamp_malformed():
    """Non-numeric timestamp raises HTTP 401."""
    with pytest.raises(HTTPException) as exc_info:
        verify_timestamp("invalid-timestamp-format")
    assert exc_info.value.status_code == 401
    assert "Malformed X-Webhook-Timestamp header" in exc_info.value.detail


def test_verify_timestamp_expired():
    """Timestamps older than tolerance (300s) raise HTTP 401."""
    old_ts = datetime.now(timezone.utc).timestamp() - (MAX_TIMESTAMP_TOLERANCE_SECONDS + 5)
    with pytest.raises(HTTPException) as exc_info:
        verify_timestamp(str(old_ts))
    assert exc_info.value.status_code == 401
    assert "Webhook timestamp expired" in exc_info.value.detail


def test_verify_timestamp_future_skew():
    """Timestamps skewed into the future by > 300s raise HTTP 401."""
    future_ts = datetime.now(timezone.utc).timestamp() + (MAX_TIMESTAMP_TOLERANCE_SECONDS + 10)
    with pytest.raises(HTTPException) as exc_info:
        verify_timestamp(str(future_ts))
    assert exc_info.value.status_code == 401
    assert "Webhook timestamp skewed into the future" in exc_info.value.detail


def test_hmac_signature_calculation_and_validation():
    """Valid signature created with matching secret, timestamp, and body passes verification."""
    secret = "my_super_secret_token_12345"
    raw_body = b'{"lead_id": 999, "amount": 100.5}'
    ts_str = str(int(datetime.now(timezone.utc).timestamp()))

    sig = calculate_hmac_signature(secret, ts_str, raw_body)
    assert sig.startswith("sha256=")
    assert len(sig[len("sha256=") :]) == 64

    # Verification must succeed without exception
    verify_hmac_signature(
        raw_body=raw_body,
        signature_header=sig,
        secret_token=secret,
        timestamp_str=ts_str,
    )


def test_hmac_tampered_payload_rejected():
    """Altering payload bytes invalidates HMAC signature (HTTP 401)."""
    secret = "secret_key_abc"
    raw_body = b'{"amount": 100}'
    tampered_body = b'{"amount": 999}'
    ts_str = str(int(datetime.now(timezone.utc).timestamp()))

    sig = calculate_hmac_signature(secret, ts_str, raw_body)

    with pytest.raises(HTTPException) as exc_info:
        verify_hmac_signature(
            raw_body=tampered_body,
            signature_header=sig,
            secret_token=secret,
            timestamp_str=ts_str,
        )
    assert exc_info.value.status_code == 401
    assert "Invalid webhook signature" in exc_info.value.detail


def test_hmac_tampered_timestamp_rejected():
    """Altering the timestamp header invalidates the cryptographically bound HMAC digest."""
    secret = "secret_key_xyz"
    raw_body = b'{"status": "ok"}'
    ts_str = str(int(datetime.now(timezone.utc).timestamp()))
    tampered_ts = str(int(ts_str) - 10)

    sig = calculate_hmac_signature(secret, ts_str, raw_body)

    with pytest.raises(HTTPException) as exc_info:
        verify_hmac_signature(
            raw_body=raw_body,
            signature_header=sig,
            secret_token=secret,
            timestamp_str=tampered_ts,
        )
    assert exc_info.value.status_code == 401
    assert "Invalid webhook signature" in exc_info.value.detail


def test_hmac_malformed_signature_format():
    """Malformed signature header formats raise HTTP 401."""
    secret = "test_secret"
    raw_body = b"{}"
    ts_str = str(int(datetime.now(timezone.utc).timestamp()))

    # Missing sha256= prefix
    with pytest.raises(HTTPException) as exc_info:
        verify_hmac_signature(
            raw_body=raw_body,
            signature_header="1234567890abcdef",
            secret_token=secret,
            timestamp_str=ts_str,
        )
    assert exc_info.value.status_code == 401
    assert "Malformed signature format" in exc_info.value.detail

    # Invalid hex length
    with pytest.raises(HTTPException) as exc_info:
        verify_hmac_signature(
            raw_body=raw_body,
            signature_header="sha256=not_a_valid_64_char_hex",
            secret_token=secret,
            timestamp_str=ts_str,
        )
    assert exc_info.value.status_code == 401
    assert "Invalid hex digest" in exc_info.value.detail


def test_hmac_timing_attack_safety_uses_compare_digest():
    """Verifies that hmac.compare_digest is utilized for constant-time comparison."""
    secret = "test_timing_secret"
    raw_body = b'{"event": "ping"}'
    ts_str = str(int(datetime.now(timezone.utc).timestamp()))
    sig = calculate_hmac_signature(secret, ts_str, raw_body)

    with patch("hmac.compare_digest", wraps=hmac.compare_digest) as mock_cmp:
        verify_hmac_signature(
            raw_body=raw_body,
            signature_header=sig,
            secret_token=secret,
            timestamp_str=ts_str,
        )
        assert mock_cmp.called
        assert mock_cmp.call_count >= 1


def test_extract_signature_header_aliases():
    """extract_signature_header properly detects standard and vendor alias headers."""
    h1 = {"X-Webhook-Signature": "sha256=1111"}
    assert extract_signature_header(h1) == "sha256=1111"

    h2 = {"x-signature-256": "sha256=2222"}
    assert extract_signature_header(h2) == "sha256=2222"

    h3 = {"X-Hub-Signature-256": "sha256=3333"}
    assert extract_signature_header(h3) == "sha256=3333"

    h4 = {"Content-Type": "application/json"}
    assert extract_signature_header(h4) is None


def test_format_scoped_idempotency_key():
    """Scoped idempotency key format: f'{operation_scope}:{workflow_id}:{client_key}'."""
    wf_id = uuid.uuid4()
    key = format_scoped_idempotency_key("webhook", wf_id, "req_123")
    assert key == f"webhook:{wf_id}:req_123"

    # Excessively long key (> 128 chars) raises HTTP 400
    oversized_key = "a" * 129
    with pytest.raises(HTTPException) as exc_info:
        format_scoped_idempotency_key("webhook", wf_id, oversized_key)
    assert exc_info.value.status_code == 400
    assert "Idempotency-Key header is too long" in exc_info.value.detail


def test_extract_webhook_secret_and_config():
    """Extracts private secret_token and allowed_methods from WEBHOOK_TRIGGER step."""
    step_webhook = WorkflowStep(
        workflow_version_id=uuid.uuid4(),
        step_key="trigger_1",
        step_type="WEBHOOK_TRIGGER",
        name="Inbound Webhook",
        config={"secret_token": "priv_tok_123", "allowed_methods": ["POST", "PUT"]},
    )
    step_other = WorkflowStep(
        workflow_version_id=uuid.uuid4(),
        step_key="other_1",
        step_type="SLACK_NOTIFICATION",
        name="Slack",
        config={},
    )

    secret, methods = extract_webhook_secret_and_config([step_other, step_webhook])
    assert secret == "priv_tok_123"
    assert methods == ["POST", "PUT"]

    # When no WEBHOOK_TRIGGER step is present
    secret2, methods2 = extract_webhook_secret_and_config([step_other])
    assert secret2 is None
    assert methods2 == ["POST"]


def test_zero_eval_exec_compile_in_codebase():
    """
    Security invariant: Scans Python source code of webhook modules to verify
    zero occurrences of eval(), exec(), or compile().
    """
    from pathlib import Path

    files_to_check = [
        Path("E:/flowpilot/backend/app/services/webhook_service.py"),
        Path("E:/flowpilot/backend/app/routers/webhooks.py"),
        Path("E:/flowpilot/backend/app/schemas/webhook.py"),
    ]

    for file_path in files_to_check:
        assert file_path.exists(), f"File {file_path} must exist"
        tree = ast.parse(file_path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                if isinstance(node.func, ast.Name):
                    assert node.func.id not in {
                        "eval",
                        "exec",
                        "compile",
                    }, f"Forbidden dynamic execution '{node.func.id}' detected in {file_path.name} at line {node.lineno}!"

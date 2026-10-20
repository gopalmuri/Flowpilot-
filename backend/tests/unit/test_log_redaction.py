"""
Credentials must never reach a log line.

Found during the first live Google test: requests_oauthlib logged the authorization code, the PKCE verifier and the full
token response (access + refresh token) at DEBUG, and uvicorn's access log wrote the OAuth callback URL (code, state).
Mocked-Google tests could not see this because it is the real libraries that log. These tests drive the REAL
requests_oauthlib and the real logging setup, with obviously fake credentials shaped like Google's.
"""

import io
import json
import logging
import os
import sys

import pytest
from requests import Response
from requests.adapters import BaseAdapter
from requests_oauthlib import OAuth2Session

from app.core import logging as app_logging
from app.core.config import settings
from app.core.logging import RedactingFormatter, harden_logging, redact, setup_logging

FAKE_ACCESS = "ya29.a0FAKEACCESSTOKEN" + "x" * 80
FAKE_REFRESH = "1//0gFAKEREFRESHTOKEN" + "y" * 60
FAKE_CODE = "4/0AXFAKEAUTHORIZATIONCODE" + "z" * 40
FAKE_SECRET = "GOCSPX-FAKECLIENTSECRET1234567"
FAKE_VERIFIER = "FAKEPKCEVERIFIER" + "v" * 50
FAKE_STATE = "FAKESTATEVALUE" + "s" * 29
FAKE_JWT = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJlYnl0ZXM"
SECRETS = [FAKE_ACCESS, FAKE_REFRESH, FAKE_CODE, FAKE_SECRET, FAKE_VERIFIER, FAKE_STATE, FAKE_JWT]


def assert_clean(text: str) -> None:
    for secret in SECRETS:
        assert secret not in text, f"{secret[:8]}... leaked"


# ----------------------------------------------------------------------------- the redaction function


def test_the_exact_leaking_lines_from_the_live_run_are_redacted():
    token_response = (
        f"Obtained token {{'access_token': '{FAKE_ACCESS}', 'expires_in': 3599, 'refresh_token': '{FAKE_REFRESH}', "
        "'scope': ['https://www.googleapis.com/auth/gmail.readonly'], 'token_type': 'Bearer'}"
    )
    token_request = (
        f"Supplying headers {{'Accept': 'application/json'}} and data {{'grant_type': 'authorization_code', "
        f"'code_verifier': '{FAKE_VERIFIER}', 'code': '{FAKE_CODE}', 'client_secret': '{FAKE_SECRET}'}}"
    )
    callback = (
        f'172.18.0.1:52862 - "GET /api/v1/gmail/oauth/callback?state={FAKE_STATE}&iss=https://accounts.google.com'
        f'&code={FAKE_CODE}&scope=https://www.googleapis.com/auth/gmail.readonly HTTP/1.1" 302'
    )
    for line in (token_response, token_request, callback):
        out = redact(line)
        assert_clean(out)
        assert REDACTED_MARK in out
    # What is useful for debugging survives.
    assert "gmail.readonly" in redact(callback) and "/api/v1/gmail/oauth/callback" in redact(callback)
    assert "'expires_in': 3599" in redact(token_response) and "302" in redact(callback)


REDACTED_MARK = app_logging.REDACTED


@pytest.mark.parametrize(
    "line",
    [
        f"POST /revoke?token={FAKE_REFRESH} HTTP/1.1",
        f'{{"access_token": "{FAKE_ACCESS}", "refresh_token": "{FAKE_REFRESH}", "id_token": "{FAKE_JWT}"}}',
        f"Authorization: Bearer {FAKE_JWT}",
        f"bare token in text {FAKE_ACCESS} and again {FAKE_REFRESH}",
        f"https://x.example/cb?code={FAKE_CODE}&state={FAKE_STATE}",
        f"client_secret={FAKE_SECRET}&grant_type=refresh_token",
        f'"password": "hunter2-{"p" * 10}"',
    ],
)
def test_redaction_covers_the_common_leak_shapes(line):
    out = redact(line)
    assert_clean(out)
    assert "hunter2" not in out


def test_redaction_is_idempotent_and_leaves_ordinary_text_alone():
    ordinary = (
        "Task tasks.sync_gmail_mailbox[abc] succeeded in 0.5s: {'ingested': 2, 'status': 'ok'} code=200 state=ready"
    )
    assert redact(ordinary) == ordinary  # not URL parameters, so untouched
    once = redact(f"x?code={FAKE_CODE}")
    assert redact(once) == once
    assert redact("") == ""


def test_formatter_redacts_messages_arguments_and_tracebacks():
    formatter = RedactingFormatter("%(levelname)s %(message)s")
    record = logging.LogRecord("t", logging.ERROR, __file__, 1, "token %s for %s", (FAKE_ACCESS, "user"), None)
    assert_clean(formatter.format(record))
    try:
        raise RuntimeError(f"upstream said refresh_token={FAKE_REFRESH} and {FAKE_ACCESS}")
    except RuntimeError:
        record = logging.LogRecord("t", logging.ERROR, __file__, 1, "failed", (), sys.exc_info())
    out = formatter.format(record)
    assert_clean(out)
    assert "Traceback" in out and "RuntimeError" in out  # still useful


# ----------------------------------------------------------------------------- the real libraries, real logging setup


@pytest.fixture
def captured_logging(monkeypatch):
    """Runs the app's real setup_logging() against a captured stdout, then restores global logging state."""
    stream = io.StringIO()
    monkeypatch.setattr(sys, "stdout", stream)
    root = logging.getLogger()
    saved = (root.handlers[:], root.level, logging.getLogger("uvicorn.access").handlers[:])
    saved_levels = {n: logging.getLogger(n).level for n in app_logging.NOISY_LIBRARIES}
    monkeypatch.setattr(settings, "DEBUG", True)  # the dev default, which is what leaked
    setup_logging()
    yield stream
    root.handlers[:], root.level = saved[0], saved[1]
    logging.getLogger("uvicorn.access").handlers[:] = saved[2]
    for name, level in saved_levels.items():
        logging.getLogger(name).setLevel(level)


class _FakeGoogleToken(BaseAdapter):
    """Answers the token endpoint with a realistic token response. No network."""

    def send(self, request, **kwargs):
        response = Response()
        response.status_code = 200
        response.headers["Content-Type"] = "application/json"
        response._content = json.dumps(
            {
                "access_token": FAKE_ACCESS,
                "expires_in": 3599,
                "refresh_token": FAKE_REFRESH,
                "scope": "https://www.googleapis.com/auth/gmail.readonly",
                "token_type": "Bearer",
                "refresh_token_expires_in": 604799,
            }
        ).encode()
        response.url = request.url
        response.request = request
        return response

    def close(self):
        pass


def _exchange_with_real_requests_oauthlib() -> None:
    os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = "1"
    session = OAuth2Session("client-id.apps.example", redirect_uri="http://localhost:8000/api/v1/gmail/oauth/callback")
    session.mount("https://", _FakeGoogleToken())
    session.fetch_token(
        "https://oauth2.googleapis.com/token",
        code=FAKE_CODE,
        client_secret=FAKE_SECRET,
        code_verifier=FAKE_VERIFIER,
        include_client_id=True,
    )


def test_the_real_oauth_library_leaks_without_the_fix_and_not_with_it(monkeypatch):
    """Control: proves this test would have caught the live leak. Plain DEBUG logging prints the tokens."""
    stream = io.StringIO()
    plain = logging.StreamHandler(stream)
    plain.setFormatter(logging.Formatter("%(name)s: %(message)s"))
    lib = logging.getLogger("requests_oauthlib.oauth2_session")
    previous = (lib.level, lib.propagate)
    lib.setLevel(logging.DEBUG)
    lib.addHandler(plain)
    try:
        _exchange_with_real_requests_oauthlib()
    finally:
        lib.removeHandler(plain)
        lib.setLevel(previous[0])
    assert FAKE_ACCESS in stream.getvalue() and FAKE_REFRESH in stream.getvalue(), (
        "control failed: nothing leaked to catch"
    )


def test_with_the_hardened_logging_the_real_oauth_exchange_logs_no_credentials(captured_logging):
    _exchange_with_real_requests_oauthlib()
    logging.getLogger("flowpilot").info("exchange done")  # the pipeline itself still logs
    output = captured_logging.getvalue()
    assert "exchange done" in output
    assert_clean(output)
    for name in ("requests_oauthlib", "oauthlib", "urllib3", "google.auth", "googleapiclient"):
        assert logging.getLogger(name).level >= logging.WARNING


def test_uvicorn_access_log_never_prints_oauth_callback_parameters(captured_logging):
    access = logging.getLogger("uvicorn.access")
    access.setLevel(logging.INFO)
    access.info(
        '%s - "%s %s HTTP/%s" %d',
        "172.18.0.1:52862",
        "GET",
        f"/api/v1/gmail/oauth/callback?state={FAKE_STATE}&code={FAKE_CODE}&scope=https://www.googleapis.com/auth/gmail.readonly",
        "1.1",
        302,
    )
    output = captured_logging.getvalue()
    assert "/api/v1/gmail/oauth/callback" in output and "302" in output
    assert_clean(output)


def test_even_a_warning_from_a_library_is_redacted(captured_logging):
    logging.getLogger("urllib3.connectionpool").warning("Retrying (Retry(total=2)) POST /revoke?token=%s", FAKE_REFRESH)
    logging.getLogger("google.auth").warning("refresh failed: {'refresh_token': '%s'}", FAKE_REFRESH)
    assert_clean(captured_logging.getvalue())


def test_harden_logging_wraps_foreign_handlers_and_is_idempotent():
    logger = logging.getLogger("celery.test.hardening")
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(logging.Formatter("%(name)s %(message)s"))
    logger.addHandler(handler)
    logger.propagate = False
    try:
        harden_logging(logger)
        harden_logging(logger)
        assert isinstance(handler.formatter, RedactingFormatter)
        logger.warning("token=%s", FAKE_ACCESS)  # not a URL param, caught by the shape rule
        logger.warning("callback ?code=%s&state=%s", FAKE_CODE, FAKE_STATE)
        assert_clean(stream.getvalue())
    finally:
        logger.removeHandler(handler)

"""
The real Google adapters (GoogleGmailClient, GoogleOAuthClient, GooglePubSubVerifier) exercised against mocked
googleapiclient / google-auth objects. These prove request shapes, error classification and token handling. They do
NOT prove behaviour against Google itself: no test here has network access.
"""

import base64
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List
from urllib.parse import parse_qs, urlparse

import httplib2
import pytest
from google.auth.exceptions import RefreshError, TransportError
from googleapiclient.errors import HttpError

from app.core.config import settings
from app.services.gmail.client import GoogleGmailClient, map_exception
from app.services.gmail.errors import (
    GmailAuthError,
    GmailHistoryExpired,
    GmailNotFound,
    GmailPermanentError,
    GmailRateLimitError,
    GmailTransientError,
    OAuthFlowError,
)
from app.services.gmail.oauth import GoogleOAuthClient
from app.services.gmail.pubsub import GooglePubSubVerifier, PubSubAuthError
from app.services.gmail.types import GMAIL_READONLY_SCOPE

CREDS = {
    "access_token": "ACCESS-1",
    "refresh_token": "REFRESH-1",
    "expiry": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
    "scopes": [GMAIL_READONLY_SCOPE],
    "token_uri": "https://oauth2.googleapis.com/token",
}


# ----------------------------------------------------------------------------- a scriptable Gmail service double


class Request:
    def __init__(self, service: "Service", name: str, kwargs: Dict[str, Any]):
        self.service, self.name, self.kwargs = service, name, kwargs

    def execute(self, num_retries: int = 0) -> Any:
        self.service.calls.append((self.name, self.kwargs, num_retries))
        outcome = self.service.script[self.name]
        if isinstance(outcome, list):
            outcome = outcome.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


class Resource:
    def __init__(self, service: "Service", prefix: str):
        self.service, self.prefix = service, prefix

    def __getattr__(self, name: str):
        def method(**kwargs: Any) -> Request:
            return Request(self.service, f"{self.prefix}{name}", kwargs)

        return method


class Users:
    def __init__(self, service: "Service"):
        self.service = service

    def getProfile(self, **kw):
        return Request(self.service, "getProfile", kw)

    def watch(self, **kw):
        return Request(self.service, "watch", kw)

    def stop(self, **kw):
        return Request(self.service, "stop", kw)

    def history(self):
        return Resource(self.service, "history.")

    def messages(self):
        return Resource(self.service, "messages.")


class Service:
    def __init__(self, script: Dict[str, Any]):
        self.script = script
        self.calls: List[tuple] = []

    def users(self) -> Users:
        return Users(self)


def client_with(script: Dict[str, Any]) -> tuple:
    service = Service(script)
    return GoogleGmailClient(CREDS, service_factory=lambda creds: service), service


def http_error(status: int, reason: str = "", message: str = "boom") -> HttpError:
    body = {
        "error": {
            "code": status,
            "message": message,
            "errors": [{"reason": reason, "message": message}] if reason else [],
        }
    }
    return HttpError(httplib2.Response({"status": str(status)}), json.dumps(body).encode())


# ----------------------------------------------------------------------------- API calls


@pytest.mark.asyncio
async def test_profile_watch_history_and_message_calls_use_the_right_parameters():
    raw = b"From: a@b.example\r\n\r\nhi"
    client, service = client_with(
        {
            "getProfile": {"emailAddress": "Owner@Business.Example", "historyId": "123", "messagesTotal": 7},
            "watch": {"historyId": "200", "expiration": "1893456000000"},
            "stop": {},
            "history.list": {
                "historyId": "300",
                "nextPageToken": "next",
                "history": [
                    {"messagesAdded": [{"message": {"id": "m1"}}, {"message": {"id": "m2"}}]},
                    {"messagesAdded": [{"message": {"id": "m1"}}]},
                    {"labelsAdded": []},
                ],
            },
            "messages.list": {"messages": [{"id": "m9"}, {"id": "m8"}]},
            "messages.get": {
                "id": "m1",
                "threadId": "t1",
                "labelIds": ["INBOX", "UNREAD"],
                "historyId": "299",
                "internalDate": "1760000000000",
                "snippet": "hi",
                "sizeEstimate": 42,
                "raw": base64.urlsafe_b64encode(raw).decode().rstrip("="),  # Gmail omits padding
            },
        }
    )

    profile = await client.get_profile()
    assert (profile.email_address, profile.history_id, profile.messages_total) == ("owner@business.example", "123", 7)

    watch = await client.watch("projects/p/topics/gmail")
    assert (watch.history_id, watch.expiration_ms) == ("200", 1893456000000)
    await client.stop_watch()

    page = await client.list_history("123", "tok")
    assert page.message_ids == ["m1", "m2"] and page.next_page_token == "next" and page.history_id == "300"
    assert await client.list_messages("newer_than:3d", 50) == ["m9", "m8"]

    message = await client.get_raw_message("m1")
    assert message.raw == raw and message.thread_id == "t1" and message.label_ids == ["INBOX", "UNREAD"]
    assert message.internal_date_ms == 1760000000000 and message.size_estimate == 42

    calls = {name: (kwargs, retries) for name, kwargs, retries in service.calls}
    assert calls["watch"][0] == {
        "userId": "me",
        "body": {"topicName": "projects/p/topics/gmail", "labelIds": ["INBOX"], "labelFilterBehavior": "INCLUDE"},
    }
    assert calls["history.list"][0] == {
        "userId": "me",
        "startHistoryId": "123",
        "historyTypes": ["messageAdded"],
        "labelId": "INBOX",
        "maxResults": 100,
        "pageToken": "tok",
    }
    assert calls["messages.get"][0] == {"userId": "me", "id": "m1", "format": "raw"}
    assert calls["messages.list"][0]["labelIds"] == ["INBOX"] and calls["messages.list"][0]["q"] == "newer_than:3d"
    assert all(retries == settings.GMAIL_API_NUM_RETRIES for _, retries in calls.values())  # library-level backoff on


@pytest.mark.asyncio
async def test_a_profile_without_an_address_is_refused():
    client, _ = client_with({"getProfile": {"historyId": "1"}})
    with pytest.raises(GmailPermanentError) as err:
        await client.get_profile()
    assert err.value.code == "no_mailbox_identity"


# ----------------------------------------------------------------------------- error classification


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "exc,expected,code",
    [
        (http_error(401), GmailAuthError, "reauthorization_required"),
        (http_error(403, "insufficientPermissions"), GmailAuthError, "permission_denied"),
        (http_error(403, "rateLimitExceeded"), GmailRateLimitError, "rate_limited"),
        (http_error(403, "userRateLimitExceeded"), GmailRateLimitError, "rate_limited"),
        (http_error(429), GmailRateLimitError, "rate_limited"),
        (http_error(500), GmailTransientError, "server_error"),
        (http_error(503), GmailTransientError, "server_error"),
        (http_error(400), GmailPermanentError, "api_error"),
        (RefreshError("invalid_grant: Token has been expired or revoked."), GmailAuthError, "reauthorization_required"),
        (TransportError("connection reset"), GmailTransientError, "network_error"),
        (TimeoutError("slow"), GmailTransientError, "network_error"),
        (ConnectionResetError("reset"), GmailTransientError, "network_error"),
        (ValueError("???"), GmailTransientError, "unexpected_error"),
    ],
)
async def test_failures_are_classified_and_never_leak_provider_text(exc, expected, code):
    client, _ = client_with({"getProfile": exc})
    with pytest.raises(expected) as err:
        await client.get_profile()
    assert err.value.code == code
    for leaked in ("invalid_grant", "Token has been expired", "connection reset", "boom"):
        assert leaked not in str(err.value)


@pytest.mark.asyncio
async def test_a_404_means_expired_history_only_for_history_calls():
    client, _ = client_with({"history.list": http_error(404), "messages.get": http_error(404)})
    with pytest.raises(GmailHistoryExpired):
        await client.list_history("1")
    with pytest.raises(GmailNotFound):
        await client.get_raw_message("gone")


def test_map_exception_passes_through_our_own_errors():
    own = GmailRateLimitError("x", retry_after=3)
    assert map_exception(own) is own


@pytest.mark.asyncio
async def test_cancellation_is_not_swallowed():
    import asyncio

    client, _ = client_with({"getProfile": asyncio.CancelledError()})
    with pytest.raises(asyncio.CancelledError):
        await client.get_profile()


# ----------------------------------------------------------------------------- credentials


def test_credentials_use_the_configured_client_and_the_stored_scopes(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "client-id")
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_SECRET", "client-secret")
    client = GoogleGmailClient(CREDS, service_factory=lambda c: Service({}))
    creds = client._credentials()
    assert creds.token == "ACCESS-1" and creds.refresh_token == "REFRESH-1" and creds.client_id == "client-id"
    assert list(creds.scopes) == [GMAIL_READONLY_SCOPE] and creds.token_uri == CREDS["token_uri"]


def test_a_refreshed_token_shows_up_in_the_snapshot_to_be_persisted_encrypted():
    client = GoogleGmailClient(CREDS, service_factory=lambda c: Service({}))
    assert client.credentials_snapshot() == CREDS  # nothing built yet: unchanged
    creds = client._credentials()
    assert client.credentials_snapshot()["access_token"] == "ACCESS-1"
    creds.token = "ACCESS-2"
    creds.expiry = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(
        hours=1
    )  # google-auth keeps naive UTC expiries
    snap = client.credentials_snapshot()
    assert snap["access_token"] == "ACCESS-2" and snap["refresh_token"] == "REFRESH-1"
    assert datetime.fromisoformat(snap["expiry"]).tzinfo is not None
    assert snap["scopes"] == [GMAIL_READONLY_SCOPE]


def test_the_google_service_is_built_without_network_discovery(monkeypatch):
    captured: Dict[str, Any] = {}

    def fake_build(name, version, **kwargs):
        captured.update(name=name, version=version, **kwargs)
        return Service({})

    monkeypatch.setattr("googleapiclient.discovery.build", fake_build)
    client = GoogleGmailClient(CREDS)
    client._svc()
    assert captured["name"] == "gmail" and captured["version"] == "v1"
    assert captured["static_discovery"] is True and captured["cache_discovery"] is False
    assert captured["credentials"] is client._credentials()


@pytest.mark.asyncio
async def test_revoke_is_best_effort(monkeypatch):
    posts: List[Any] = []

    def fake_post(url, data=None, headers=None, params=None, timeout=None):
        assert params is None, "the token must never be sent in the URL"
        posts.append((url, data, timeout))
        raise ConnectionError("google unreachable")

    monkeypatch.setattr("requests.post", fake_post)
    client = GoogleGmailClient(CREDS, service_factory=lambda c: Service({}))
    await client.revoke()  # must not raise even though the call fails
    assert posts == [("https://oauth2.googleapis.com/revoke", {"token": "REFRESH-1"}, 10)]  # body, not URL
    posts.clear()
    await GoogleGmailClient({"scopes": []}).revoke()
    assert posts == []


# ----------------------------------------------------------------------------- OAuth client


@pytest.fixture
def oauth_settings(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "client-id.apps.example")
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_SECRET", "client-secret")
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_REDIRECT_URI", "https://api.example/api/v1/gmail/oauth/callback")


def test_authorization_url_requests_only_read_access_with_pkce_and_offline_consent(oauth_settings):
    request = GoogleOAuthClient().authorization_url("state-123")
    parsed = urlparse(request.url)
    query = {k: v[0] for k, v in parse_qs(parsed.query).items()}
    assert parsed.netloc == "accounts.google.com"
    assert query["client_id"] == "client-id.apps.example" and query["response_type"] == "code"
    assert query["redirect_uri"] == "https://api.example/api/v1/gmail/oauth/callback"
    assert query["scope"] == GMAIL_READONLY_SCOPE  # least privilege: nothing else, no identity scopes, no send
    assert query["state"] == "state-123" and query["access_type"] == "offline" and query["prompt"] == "consent"
    assert query["code_challenge_method"] == "S256" and query["code_challenge"] and request.code_verifier
    assert "include_granted_scopes" not in query and "client-secret" not in request.url


def test_oauth_client_reports_missing_configuration(monkeypatch):
    for name in ("GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_REDIRECT_URI"):
        monkeypatch.setattr(settings, name, None)
    client = GoogleOAuthClient()
    assert client.is_configured() is False
    with pytest.raises(OAuthFlowError) as err:
        client.authorization_url("s")
    assert err.value.code == "oauth_not_configured"


@pytest.mark.asyncio
async def test_code_exchange_returns_tokens_and_hides_provider_errors(oauth_settings, monkeypatch):
    from google_auth_oauthlib.flow import Flow

    expiry = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1)

    class FakeCredentials:
        token, refresh_token, scopes = "ACCESS-X", "REFRESH-X", [GMAIL_READONLY_SCOPE]

    FakeCredentials.expiry = expiry
    seen: Dict[str, Any] = {}

    def fetch_token(self, code=None, **kwargs):
        seen["code"], seen["verifier"] = code, self.code_verifier

    monkeypatch.setattr(Flow, "fetch_token", fetch_token)
    monkeypatch.setattr(Flow, "credentials", property(lambda self: FakeCredentials))
    tokens = await GoogleOAuthClient().exchange_code("the-code", "the-verifier")
    assert seen == {"code": "the-code", "verifier": "the-verifier"}
    assert (tokens.access_token, tokens.refresh_token, tokens.scopes) == (
        "ACCESS-X",
        "REFRESH-X",
        [GMAIL_READONLY_SCOPE],
    )
    assert tokens.expiry is not None and tokens.expiry.tzinfo is not None

    def failing(self, code=None, **kwargs):
        raise RuntimeError("invalid_grant with client-secret and the-code in the text")

    monkeypatch.setattr(Flow, "fetch_token", failing)
    with pytest.raises(OAuthFlowError) as err:
        await GoogleOAuthClient().exchange_code("the-code", "the-verifier")
    assert err.value.code == "token_exchange_failed" and "client-secret" not in str(err.value)


# ----------------------------------------------------------------------------- Pub/Sub verifier


@pytest.fixture
def push_settings(monkeypatch):
    monkeypatch.setattr(settings, "GMAIL_PUBSUB_AUDIENCE", "https://api.example/api/v1/gmail/pubsub")
    monkeypatch.setattr(settings, "GMAIL_PUBSUB_SERVICE_ACCOUNT", "push@project.iam.gserviceaccount.com")


@pytest.mark.asyncio
async def test_verifier_requires_configuration_and_a_bearer_token(monkeypatch):
    monkeypatch.setattr(settings, "GMAIL_PUBSUB_AUDIENCE", None)
    monkeypatch.setattr(settings, "GMAIL_PUBSUB_SERVICE_ACCOUNT", None)
    with pytest.raises(PubSubAuthError) as unconfigured:
        await GooglePubSubVerifier().verify("Bearer anything")
    assert unconfigured.value.status_code == 503  # never "accept because nothing is configured"


@pytest.mark.asyncio
@pytest.mark.parametrize("header", [None, "", "Bearer", "Bearer ", "Basic abc", "token-without-scheme"])
async def test_verifier_rejects_missing_or_malformed_authorization(push_settings, header):
    with pytest.raises(PubSubAuthError) as err:
        await GooglePubSubVerifier().verify(header)
    assert err.value.status_code == 401


@pytest.mark.asyncio
async def test_verifier_checks_audience_signature_and_service_account(push_settings, monkeypatch):
    calls: List[Dict[str, Any]] = []

    def good(token, request, audience=None):
        calls.append({"token": token, "audience": audience})
        return {
            "email": "Push@Project.iam.gserviceaccount.com",
            "email_verified": True,
            "iss": "https://accounts.google.com",
        }

    monkeypatch.setattr("google.oauth2.id_token.verify_oauth2_token", good)
    await GooglePubSubVerifier().verify("Bearer jwt-abc")  # accepted
    assert calls == [{"token": "jwt-abc", "audience": "https://api.example/api/v1/gmail/pubsub"}]

    for claims in (
        {"email": "attacker@evil.example", "email_verified": True},
        {"email": "push@project.iam.gserviceaccount.com", "email_verified": False},
        {"email": "push@project.iam.gserviceaccount.com"},
        {},
    ):
        monkeypatch.setattr("google.oauth2.id_token.verify_oauth2_token", lambda t, r, audience=None, c=claims: c)
        with pytest.raises(PubSubAuthError) as err:
            await GooglePubSubVerifier().verify("Bearer jwt-abc")
        assert err.value.status_code == 401

    def bad_signature(token, request, audience=None):
        raise ValueError("Could not verify token signature / wrong audience")

    monkeypatch.setattr("google.oauth2.id_token.verify_oauth2_token", bad_signature)
    with pytest.raises(PubSubAuthError) as err:
        await GooglePubSubVerifier().verify("Bearer forged")
    assert err.value.status_code == 401 and "signature" not in err.value.detail

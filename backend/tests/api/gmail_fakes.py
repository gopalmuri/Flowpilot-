"""
In-memory stand-ins for Google (OAuth, Gmail API, Pub/Sub token verification).

They implement the same interfaces as the real adapters (app.services.gmail.types), so the production sync, watch,
connect and notification code runs unmodified. Nothing here touches the network.
"""

import itertools
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Any, Callable, Dict, List, Optional

from app.services.gmail.errors import (
    GmailAuthError,
    GmailError,
    GmailHistoryExpired,
    GmailNotFound,
    OAuthFlowError,
)
from app.services.gmail.pubsub import PubSubAuthError, PubSubVerifier
from app.services.gmail.types import (
    GMAIL_READONLY_SCOPE,
    AuthorizationRequest,
    GmailApiClient,
    HistoryPage,
    OAuthClient,
    Profile,
    RawMessage,
    TokenSet,
    WatchResult,
)

_ids = itertools.count(1000)


@dataclass
class FakeMessage:
    id: str
    thread_id: str
    labels: List[str]
    raw: bytes
    internal_date_ms: int
    history_id: int
    snippet: str = ""


@dataclass
class FakeMailbox:
    email: str
    history: int = 100
    messages: Dict[str, FakeMessage] = field(default_factory=dict)
    history_log: List[tuple] = field(default_factory=list)  # (history_id, message_id)
    watch_calls: int = 0
    watch_expiration_ms: Optional[int] = None
    stopped: bool = False
    calls: List[str] = field(default_factory=list)
    # scripted failures: method name -> list of exceptions raised once each, in order
    failures: Dict[str, List[BaseException]] = field(default_factory=dict)
    expired_history_before: Optional[int] = None
    on_get_raw: Optional[Callable[[str], None]] = None

    def next_history(self) -> int:
        self.history += 1
        return self.history


class FakeGoogle:
    """The Google side: mailboxes, issued tokens and authorization codes."""

    def __init__(self) -> None:
        self.mailboxes: Dict[str, FakeMailbox] = {}
        self.token_owner: Dict[str, str] = {}  # access or refresh token -> mailbox email
        self.revoked: List[str] = []
        self.revoked_tokens: set = set()
        self.codes: Dict[str, TokenSet] = {}
        self.code_owner: Dict[str, str] = {}
        self.profile_failure: Optional[BaseException] = None
        self.refresh_on_use = False  # simulate Google refreshing the access token during a call
        self.clients: List["FakeGmailClient"] = []

    # --- setup helpers -------------------------------------------------------------------------------------------

    def mailbox(self, email: str) -> FakeMailbox:
        return self.mailboxes.setdefault(email.lower(), FakeMailbox(email=email.lower()))

    def grant(
        self,
        email: str,
        scopes: Optional[List[str]] = None,
        refresh_token: bool = True,
    ) -> str:
        """Prepares an authorization code that the fake OAuth client will exchange for tokens on `email`."""
        self.mailbox(email)
        suffix = uuid.uuid4().hex[:10]
        access, refresh = f"ACCESS-{suffix}", f"REFRESH-{suffix}"
        tokens = TokenSet(
            access_token=access,
            refresh_token=refresh if refresh_token else None,
            expiry=datetime.now(timezone.utc) + timedelta(hours=1),
            scopes=scopes if scopes is not None else [GMAIL_READONLY_SCOPE],
        )
        code = f"CODE-{suffix}"
        self.codes[code] = tokens
        self.code_owner[code] = email.lower()
        self.token_owner[access] = email.lower()
        if refresh_token:
            self.token_owner[refresh] = email.lower()
        return code

    def deliver(
        self,
        email: str,
        sender: str = "customer@example.com",
        subject: str = "Question about your products",
        body: str = "Hello, we need a custom AI solution. Can you help?",
        labels: tuple = ("INBOX", "UNREAD"),
        thread_id: Optional[str] = None,
        html: Optional[str] = None,
        headers: Optional[Dict[str, str]] = None,
        to: Optional[str] = None,
        raw: Optional[bytes] = None,
    ) -> str:
        mailbox = self.mailbox(email)
        message_id = f"msg{next(_ids)}"
        if raw is None:
            msg = EmailMessage()
            msg["From"] = sender
            msg["To"] = to or email
            msg["Subject"] = subject
            msg["Message-ID"] = f"<{message_id}@mail.example>"
            msg["Date"] = "Sat, 17 Oct 2026 10:00:00 +0000"
            for k, v in (headers or {}).items():
                msg[k] = v
            msg.set_content(body)
            if html:
                msg.add_alternative(html, subtype="html")
            raw = msg.as_bytes()
        history_id = mailbox.next_history()
        mailbox.messages[message_id] = FakeMessage(
            id=message_id,
            thread_id=thread_id or f"thr{message_id}",
            labels=list(labels),
            raw=raw,
            internal_date_ms=int(datetime.now(timezone.utc).timestamp() * 1000),
            history_id=history_id,
            snippet=body[:100],
        )
        mailbox.history_log.append((history_id, message_id))
        return message_id

    def client_factory(self, creds: Dict[str, Any]) -> "FakeGmailClient":
        client = FakeGmailClient(self, creds)
        self.clients.append(client)
        return client


class FakeOAuthClient(OAuthClient):
    def __init__(self, google: FakeGoogle, configured: bool = True):
        self.google = google
        self.configured = configured
        self.states_issued: List[str] = []

    def is_configured(self) -> bool:
        return self.configured

    def authorization_url(self, state: str) -> AuthorizationRequest:
        self.states_issued.append(state)
        return AuthorizationRequest(
            url=f"https://accounts.example.test/auth?state={state}", code_verifier=f"verifier-{state}"
        )

    async def exchange_code(self, code: str, code_verifier: str) -> TokenSet:
        tokens = self.google.codes.pop(code, None)  # an authorization code is single use
        if tokens is None or not code_verifier.startswith("verifier-"):
            raise OAuthFlowError("token_exchange_failed")
        return tokens


class FakeGmailClient(GmailApiClient):
    def __init__(self, google: FakeGoogle, creds: Dict[str, Any]):
        self.google = google
        self.creds = dict(creds)
        self._snapshot = dict(creds)

    def _mailbox(self) -> FakeMailbox:
        token = self.creds.get("access_token")
        owner = self.google.token_owner.get(token) or self.google.token_owner.get(self.creds.get("refresh_token"))
        if (
            owner is None
            or token in self.google.revoked_tokens
            or self.creds.get("refresh_token") in self.google.revoked_tokens
        ):
            raise GmailAuthError("token revoked or unknown")
        return self.google.mailboxes[owner]

    def _enter(self, name: str) -> FakeMailbox:
        mailbox = self._mailbox()
        mailbox.calls.append(name)
        queue = mailbox.failures.get(name)
        if queue:
            raise queue.pop(0)
        if self.google.refresh_on_use:
            self._snapshot["access_token"] = f"REFRESHED-{uuid.uuid4().hex[:8]}"
            self._snapshot["expiry"] = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        return mailbox

    async def get_profile(self) -> Profile:
        if self.google.profile_failure is not None:
            raise self.google.profile_failure
        mailbox = self._enter("get_profile")
        return Profile(mailbox.email, str(mailbox.history), len(mailbox.messages))

    async def watch(self, topic_name: str) -> WatchResult:
        mailbox = self._enter("watch")
        mailbox.watch_calls += 1
        mailbox.watch_expiration_ms = int((datetime.now(timezone.utc) + timedelta(days=7)).timestamp() * 1000)
        return WatchResult(str(mailbox.history), mailbox.watch_expiration_ms)

    async def stop_watch(self) -> None:
        mailbox = self._enter("stop_watch")
        mailbox.stopped = True
        mailbox.watch_expiration_ms = None

    async def list_history(self, start_history_id: str, page_token: Optional[str] = None) -> HistoryPage:
        mailbox = self._enter("list_history")
        start = int(start_history_id)
        if mailbox.expired_history_before is not None and start < mailbox.expired_history_before:
            raise GmailHistoryExpired("history id too old")
        offset = int(page_token or 0)
        pending = [(h, m) for h, m in mailbox.history_log if h > start]
        page = pending[offset : offset + 2]  # two per page so pagination is exercised
        next_token = str(offset + 2) if offset + 2 < len(pending) else None
        return HistoryPage(str(mailbox.history), [m for _, m in page], next_token)

    async def list_messages(self, query: str, max_results: int) -> List[str]:
        mailbox = self._enter("list_messages")
        ids = [m.id for m in mailbox.messages.values() if "INBOX" in m.labels]
        return list(reversed(ids))[:max_results]  # Gmail lists newest first

    async def get_raw_message(self, message_id: str) -> RawMessage:
        mailbox = self._enter("get_raw_message")
        if mailbox.on_get_raw:
            mailbox.on_get_raw(message_id)
        msg = mailbox.messages.get(message_id)
        if msg is None:
            raise GmailNotFound("gone")
        return RawMessage(
            id=msg.id,
            thread_id=msg.thread_id,
            label_ids=list(msg.labels),
            history_id=str(msg.history_id),
            internal_date_ms=msg.internal_date_ms,
            snippet=msg.snippet,
            raw=msg.raw,
        )

    async def revoke(self) -> None:
        token = self.creds.get("refresh_token") or self.creds.get("access_token")
        self.google.revoked.append(str(token))
        for t in (self.creds.get("refresh_token"), self.creds.get("access_token")):
            if t:
                self.google.revoked_tokens.add(t)

    def credentials_snapshot(self) -> Dict[str, Any]:
        return dict(self._snapshot)


class FakePubSubVerifier(PubSubVerifier):
    """Accepts exactly one bearer token; everything else is rejected like the real verifier would."""

    GOOD = "valid-push-token"

    async def verify(self, authorization: Optional[str]) -> None:
        if not authorization or not authorization.lower().startswith("bearer "):
            raise PubSubAuthError(401, "Missing bearer token")
        if authorization.split(" ", 1)[1].strip() != self.GOOD:
            raise PubSubAuthError(401, "Invalid token")


class FakeGmailError(GmailError):
    pass

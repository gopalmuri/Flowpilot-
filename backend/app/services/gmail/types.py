"""Interfaces between FlowPilot and Google. Real implementations live in client.py / oauth.py; tests use fakes."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

# Least privilege for this phase: read mail and manage the mailbox watch. Sending is NOT requested; it will be
# added (by reconnecting) when live outbound is approved.
GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
REQUIRED_SCOPES = [GMAIL_READONLY_SCOPE]


@dataclass(frozen=True)
class TokenSet:
    access_token: str
    refresh_token: Optional[str]
    expiry: Optional[datetime]
    scopes: List[str]
    token_uri: str = "https://oauth2.googleapis.com/token"


@dataclass(frozen=True)
class Profile:
    email_address: str
    history_id: str
    messages_total: int = 0


@dataclass(frozen=True)
class WatchResult:
    history_id: str
    expiration_ms: int


@dataclass(frozen=True)
class HistoryPage:
    history_id: Optional[str]
    message_ids: List[str]
    next_page_token: Optional[str] = None


@dataclass(frozen=True)
class RawMessage:
    id: str
    thread_id: str
    label_ids: List[str]
    history_id: str
    internal_date_ms: int
    snippet: str
    raw: bytes
    size_estimate: int = 0
    extra: Dict[str, Any] = field(default_factory=dict)


class OAuthClient(ABC):
    @abstractmethod
    def is_configured(self) -> bool: ...

    @abstractmethod
    def authorization_url(self, state: str) -> "AuthorizationRequest":
        """Builds the Google consent URL for this state (PKCE included)."""

    @abstractmethod
    async def exchange_code(self, code: str, code_verifier: str) -> TokenSet:
        """Trades the authorization code for tokens. Raises OAuthFlowError."""


@dataclass(frozen=True)
class AuthorizationRequest:
    url: str
    code_verifier: str


class GmailApiClient(ABC):
    """One mailbox's Gmail API access. Every method raises a GmailError subclass on failure."""

    @abstractmethod
    async def get_profile(self) -> Profile: ...

    @abstractmethod
    async def watch(self, topic_name: str) -> WatchResult: ...

    @abstractmethod
    async def stop_watch(self) -> None: ...

    @abstractmethod
    async def list_history(self, start_history_id: str, page_token: Optional[str] = None) -> HistoryPage: ...

    @abstractmethod
    async def list_messages(self, query: str, max_results: int) -> List[str]: ...

    @abstractmethod
    async def get_raw_message(self, message_id: str) -> RawMessage: ...

    @abstractmethod
    async def revoke(self) -> None: ...

    @abstractmethod
    def credentials_snapshot(self) -> Dict[str, Any]:
        """Current token material (it may have been refreshed during use) so the caller can persist it encrypted."""


GmailClientFactory = Callable[[Dict[str, Any]], GmailApiClient]

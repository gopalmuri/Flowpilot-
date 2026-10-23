"""
Real Gmail API client built on the maintained Google libraries (google-auth, google-api-python-client).

The Google client is synchronous (httplib2), so each call runs in a worker thread. googleapiclient already retries
429/5xx and connection errors with exponential backoff (`num_retries`); what is left after that is classified here as
auth (reconnect needed), transient, rate-limit, expired-history, not-found or permanent.

This module has been exercised against mocked `googleapiclient` objects only. It has not talked to Google.
"""

import asyncio
import base64
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

from app.core.config import settings
from app.services.gmail.errors import (
    GmailAuthError,
    GmailError,
    GmailHistoryExpired,
    GmailNotFound,
    GmailPermanentError,
    GmailRateLimitError,
    GmailTransientError,
)
from app.services.gmail.types import (
    REQUIRED_SCOPES,
    GmailApiClient,
    HistoryPage,
    Profile,
    RawMessage,
    WatchResult,
)

_RATE_REASONS = {"ratelimitexceeded", "userratelimitexceeded", "quotaexceeded", "dailylimitexceeded"}
TOKEN_URI = "https://oauth2.googleapis.com/token"
REVOKE_URI = "https://oauth2.googleapis.com/revoke"


def _http_status(exc: Any) -> Optional[int]:
    resp = getattr(exc, "resp", None)
    status = getattr(resp, "status", None)
    try:
        return int(status) if status is not None else None
    except (TypeError, ValueError):
        return None


def _http_reason(exc: Any) -> str:
    """Google's machine-readable error reason (not the free-text message)."""
    details = getattr(exc, "error_details", None)
    if isinstance(details, list):
        for item in details:
            if isinstance(item, dict) and item.get("reason"):
                return str(item["reason"]).lower()
    return str(getattr(exc, "reason", "") or "").lower()


def map_exception(exc: BaseException, history: bool = False) -> GmailError:
    """Turns a google-auth / googleapiclient / network exception into FlowPilot's taxonomy (no message text leaks)."""
    from google.auth.exceptions import RefreshError, TransportError  # lazy: only when a real call fails
    from googleapiclient.errors import HttpError

    if isinstance(exc, GmailError):
        return exc
    if isinstance(exc, RefreshError):
        return GmailAuthError("The stored authorization is no longer valid", code="reauthorization_required")
    if isinstance(exc, HttpError):
        status = _http_status(exc)
        reason = _http_reason(exc)
        if status == 401:
            return GmailAuthError("Google rejected the access token", code="reauthorization_required")
        if status == 403 and reason in _RATE_REASONS:
            return GmailRateLimitError("Gmail API quota/rate limit", code="rate_limited")
        if status == 403:
            return GmailAuthError("Gmail denied access (permission or scope)", code="permission_denied")
        if status == 404:
            return GmailHistoryExpired("History id not found") if history else GmailNotFound("Not found")
        if status == 429:
            return GmailRateLimitError("Gmail API rate limit", code="rate_limited")
        if status is not None and status >= 500:
            return GmailTransientError(f"Gmail API server error {status}", code="server_error")
        return GmailPermanentError(f"Gmail API error {status}", code="api_error")
    if isinstance(exc, (TransportError, TimeoutError, ConnectionError, OSError)):
        return GmailTransientError("Network error talking to Google", code="network_error")
    return GmailTransientError(f"Unexpected {type(exc).__name__} from the Gmail client", code="unexpected_error")


class GoogleGmailClient(GmailApiClient):
    def __init__(self, credentials: Dict[str, Any], service_factory: Optional[Callable[[Any], Any]] = None):
        self._stored = dict(credentials)
        self._creds: Any = None
        self._service_factory = service_factory
        self._service: Any = None

    # -- construction ----------------------------------------------------------------------------------------------

    def _credentials(self) -> Any:
        if self._creds is None:
            from google.oauth2.credentials import Credentials

            expiry = self._stored.get("expiry")
            parsed: Optional[datetime] = None
            if expiry:
                parsed = datetime.fromisoformat(str(expiry)).astimezone(timezone.utc).replace(tzinfo=None)
            self._creds = Credentials(
                token=self._stored.get("access_token"),
                refresh_token=self._stored.get("refresh_token"),
                token_uri=self._stored.get("token_uri", TOKEN_URI),
                client_id=settings.GOOGLE_OAUTH_CLIENT_ID,
                client_secret=settings.GOOGLE_OAUTH_CLIENT_SECRET,
                scopes=self._stored.get("scopes") or REQUIRED_SCOPES,
                expiry=parsed,
            )
        return self._creds

    def _svc(self) -> Any:
        if self._service is None:
            if self._service_factory is not None:
                self._service = self._service_factory(self._credentials())
            else:
                from googleapiclient.discovery import build

                # static_discovery avoids a network fetch of the API description; cache_discovery avoids a file cache
                self._service = build(
                    "gmail", "v1", credentials=self._credentials(), cache_discovery=False, static_discovery=True
                )
        return self._service

    async def _run(self, fn: Callable[[], Any], history: bool = False) -> Any:
        try:
            return await asyncio.to_thread(fn)
        except GmailError:
            raise
        except BaseException as exc:  # noqa: BLE001 - classify everything; never leak provider text
            if isinstance(exc, (KeyboardInterrupt, SystemExit, asyncio.CancelledError)):
                raise
            raise map_exception(exc, history=history) from None

    def _execute(self, request: Any) -> Any:
        return request.execute(num_retries=settings.GMAIL_API_NUM_RETRIES)

    # -- API ------------------------------------------------------------------------------------------------------

    async def get_profile(self) -> Profile:
        data = await self._run(lambda: self._execute(self._svc().users().getProfile(userId="me")))
        email = str(data.get("emailAddress", "")).strip().lower()
        if not email or "@" not in email:
            raise GmailPermanentError("Google returned no mailbox address", code="no_mailbox_identity")
        return Profile(email, str(data.get("historyId", "")), int(data.get("messagesTotal", 0) or 0))

    async def watch(self, topic_name: str) -> WatchResult:
        body = {"topicName": topic_name, "labelIds": ["INBOX"], "labelFilterBehavior": "INCLUDE"}
        data = await self._run(lambda: self._execute(self._svc().users().watch(userId="me", body=body)))
        return WatchResult(str(data["historyId"]), int(data["expiration"]))

    async def stop_watch(self) -> None:
        await self._run(lambda: self._execute(self._svc().users().stop(userId="me")))

    async def list_history(self, start_history_id: str, page_token: Optional[str] = None) -> HistoryPage:
        def call() -> Any:
            return self._execute(
                self._svc()
                .users()
                .history()
                .list(
                    userId="me",
                    startHistoryId=start_history_id,
                    historyTypes=["messageAdded"],
                    labelId="INBOX",
                    maxResults=100,
                    pageToken=page_token,
                )
            )

        data = await self._run(call, history=True)
        ids: List[str] = []
        for record in data.get("history", []) or []:
            for added in record.get("messagesAdded", []) or []:
                message_id = (added.get("message") or {}).get("id")
                if message_id and message_id not in ids:
                    ids.append(str(message_id))
        history_id = data.get("historyId")
        return HistoryPage(str(history_id) if history_id else None, ids, data.get("nextPageToken"))

    async def list_messages(self, query: str, max_results: int) -> List[str]:
        def call() -> Any:
            return self._execute(
                self._svc().users().messages().list(userId="me", q=query, labelIds=["INBOX"], maxResults=max_results)
            )

        data = await self._run(call)
        return [str(m["id"]) for m in data.get("messages", []) or [] if m.get("id")]

    async def get_raw_message(self, message_id: str) -> RawMessage:
        data = await self._run(
            lambda: self._execute(self._svc().users().messages().get(userId="me", id=message_id, format="raw"))
        )
        encoded = data.get("raw", "")
        raw = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)) if encoded else b""
        return RawMessage(
            id=str(data["id"]),
            thread_id=str(data.get("threadId", data["id"])),
            label_ids=[str(x) for x in data.get("labelIds", []) or []],
            history_id=str(data.get("historyId", "")),
            internal_date_ms=int(data.get("internalDate", 0) or 0),
            snippet=str(data.get("snippet", "")),
            raw=raw,
            size_estimate=int(data.get("sizeEstimate", 0) or 0),
        )

    async def revoke(self) -> None:
        """Best effort: asks Google to revoke the refresh (or access) token. Failure is not an error."""
        token = self._stored.get("refresh_token") or self._stored.get("access_token")
        if not token:
            return

        def call() -> None:
            import requests

            # In the body, never the URL: request URLs end up in logs and proxies.
            requests.post(
                REVOKE_URI,
                data={"token": token},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=10,
            )

        try:
            await asyncio.to_thread(call)
        except Exception:  # noqa: BLE001
            return

    def credentials_snapshot(self) -> Dict[str, Any]:
        creds = self._creds
        if creds is None:
            return dict(self._stored)
        expiry = getattr(creds, "expiry", None)
        snapshot = dict(self._stored)
        snapshot.update(
            {
                "access_token": creds.token,
                "refresh_token": creds.refresh_token or self._stored.get("refresh_token"),
                "expiry": expiry.replace(tzinfo=timezone.utc).isoformat() if expiry else None,
            }
        )
        return snapshot


def default_client_factory(credentials: Dict[str, Any]) -> GmailApiClient:
    return GoogleGmailClient(credentials)

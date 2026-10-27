"""
Outbound provider abstraction.

A provider turns an approved, already-authorised message into a provider API call and classifies every failure as
one of three kinds, because the right reaction differs:

- TRANSIENT: the provider definitively did NOT accept the message (e.g. refused to connect, 429 before processing).
  Safe to retry.
- PERMANENT: the provider definitively rejected it (e.g. invalid recipient). Never retried.
- UNCERTAIN: the request may or may not have been accepted (timeout after the request left, connection dropped
  before the response, worker died). Never blindly retried: it is reconciled with the provider first, and if that
  is impossible the outcome is recorded as UNKNOWN and a human resolves it.

Only the deterministic MockOutboundProvider exists in this phase. It performs no network I/O. Live Gmail and
WhatsApp providers are a later phase; `get_provider` refuses every other provider name.
"""

import time
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class ErrorKind(str, Enum):
    TRANSIENT = "transient"
    PERMANENT = "permanent"
    UNCERTAIN = "uncertain"


class ProviderError(Exception):
    """Carries a classification and a SAFE message (no credentials, no message body)."""

    def __init__(self, kind: ErrorKind, code: str, safe_message: str):
        super().__init__(safe_message)
        self.kind = kind
        self.code = code
        self.safe_message = safe_message


class ReconcileStatus(str, Enum):
    FOUND = "found"  # the provider has this message: it WAS accepted
    NOT_FOUND = "not_found"  # the provider has no record of it
    INCONCLUSIVE = "inconclusive"  # the provider could not tell


@dataclass(frozen=True)
class AccountRef:
    """Non-secret view of the sending account. Credentials are never passed through this layer in this phase."""

    integration_id: uuid.UUID
    integration_type: str
    config: Dict[str, Any]


@dataclass(frozen=True)
class SendRequest:
    delivery_id: uuid.UUID
    idempotency_key: str
    channel: str
    destination: str
    body: str
    subject: Optional[str]
    context: Dict[str, Any]
    attempt: int
    account: AccountRef


@dataclass(frozen=True)
class SendResult:
    provider_message_id: str


@dataclass(frozen=True)
class ReconcileResult:
    status: ReconcileStatus
    provider_message_id: Optional[str] = None


class OutboundProvider(ABC):
    name: str = "base"

    @abstractmethod
    def supports_reconciliation(self, account: AccountRef) -> bool:
        """True if the provider can be asked "did you accept the message with this idempotency key?"."""

    @abstractmethod
    def reconciliation_is_authoritative(self, account: AccountRef) -> bool:
        """True if NOT_FOUND really means "not accepted" (after the grace period), so a resend is safe."""

    @abstractmethod
    async def validate(self, account: AccountRef, channel: str, destination: str, context: Dict[str, Any]) -> None:
        """Checks the account and destination are usable. Raises ProviderError; sends nothing."""

    @abstractmethod
    async def send(self, request: SendRequest) -> SendResult:
        """Sends one approved reply. Raises ProviderError on any failure."""

    @abstractmethod
    async def reconcile(self, request: SendRequest) -> ReconcileResult:
        """Asks the provider whether the message for request.idempotency_key was accepted."""


@dataclass
class _LedgerEntry:
    provider_message_id: str
    delivery_id: uuid.UUID
    destination: str
    body: str
    subject: Optional[str]
    context: Dict[str, Any]
    at: float = field(default_factory=time.time)


class MockOutboundProvider(OutboundProvider):
    """
    Deterministic in-memory provider for tests and local development. It never touches the network.

    Behaviour is chosen by the sending account's non-secret `config["mock_behavior"]`:
      ok (default)                  accept and record
      transient_once                fail once as TRANSIENT, then accept
      transient_always              always TRANSIENT
      permanent                     reject as PERMANENT
      invalid_destination           validate() rejects the destination as PERMANENT
      accept_then_lose_response     record the message as accepted, then raise UNCERTAIN (lost response)
      lose_response_no_accept       raise UNCERTAIN without having accepted anything
      no_reconcile                  like accept_then_lose_response, and reconciliation is unavailable
      inconclusive_reconcile        like accept_then_lose_response, reconcile() answers INCONCLUSIVE
    The ledger is a process-wide dict keyed by idempotency key. The mock deliberately does NOT deduplicate: if the
    platform resent, the ledger would show two entries, which is how tests prove it never blindly resends.
    """

    name = "mock"
    LEDGER: Dict[str, List[_LedgerEntry]] = {}
    ATTEMPTS: Dict[str, int] = {}

    @classmethod
    def reset(cls) -> None:
        cls.LEDGER.clear()
        cls.ATTEMPTS.clear()

    @classmethod
    def sent_messages(cls, idempotency_key: Optional[str] = None) -> List[_LedgerEntry]:
        if idempotency_key is not None:
            return list(cls.LEDGER.get(idempotency_key, []))
        return [e for entries in cls.LEDGER.values() for e in entries]

    @staticmethod
    def _behavior(account: AccountRef) -> str:
        return str((account.config or {}).get("mock_behavior", "ok"))

    def supports_reconciliation(self, account: AccountRef) -> bool:
        return self._behavior(account) != "no_reconcile"

    def reconciliation_is_authoritative(self, account: AccountRef) -> bool:
        return self.supports_reconciliation(account)

    async def validate(self, account: AccountRef, channel: str, destination: str, context: Dict[str, Any]) -> None:
        if self._behavior(account) == "invalid_destination":
            raise ProviderError(ErrorKind.PERMANENT, "invalid_destination", "The provider rejected the destination")

    async def send(self, request: SendRequest) -> SendResult:
        behavior = self._behavior(request.account)
        key = request.idempotency_key
        self.ATTEMPTS[key] = self.ATTEMPTS.get(key, 0) + 1

        if behavior == "transient_always" or (behavior == "transient_once" and self.ATTEMPTS[key] == 1):
            raise ProviderError(ErrorKind.TRANSIENT, "provider_unavailable", "The provider was temporarily unavailable")
        if behavior == "permanent":
            raise ProviderError(ErrorKind.PERMANENT, "rejected_by_provider", "The provider rejected the message")
        if behavior == "lose_response_no_accept":
            raise ProviderError(ErrorKind.UNCERTAIN, "response_lost", "The response was lost; outcome unknown")

        entry = _LedgerEntry(
            provider_message_id=f"mock-{uuid.uuid4().hex[:12]}",
            delivery_id=request.delivery_id,
            destination=request.destination,
            body=request.body,
            subject=request.subject,
            context=dict(request.context),
        )
        self.LEDGER.setdefault(key, []).append(entry)
        if behavior in ("accept_then_lose_response", "no_reconcile", "inconclusive_reconcile"):
            raise ProviderError(ErrorKind.UNCERTAIN, "response_lost", "The response was lost; outcome unknown")
        return SendResult(provider_message_id=entry.provider_message_id)

    async def reconcile(self, request: SendRequest) -> ReconcileResult:
        behavior = self._behavior(request.account)
        if behavior == "no_reconcile":
            raise ProviderError(ErrorKind.PERMANENT, "reconcile_unsupported", "Reconciliation is not supported")
        if behavior == "inconclusive_reconcile":
            return ReconcileResult(ReconcileStatus.INCONCLUSIVE)
        entries = self.LEDGER.get(request.idempotency_key)
        if entries:
            return ReconcileResult(ReconcileStatus.FOUND, entries[0].provider_message_id)
        return ReconcileResult(ReconcileStatus.NOT_FOUND)


def get_provider(name: str) -> OutboundProvider:
    """Only the mock exists. Anything else is refused so no code path can reach a live service by accident."""
    if name == "mock":
        return MockOutboundProvider()
    raise ProviderError(
        ErrorKind.PERMANENT,
        "provider_not_enabled",
        f"Outbound provider '{name}' is not enabled; live sending is not implemented yet",
    )

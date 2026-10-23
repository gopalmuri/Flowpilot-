"""Gmail/OAuth error taxonomy. Messages are safe to log and to show: they never carry tokens or message content."""

from typing import Optional


class GmailError(Exception):
    code = "gmail_error"

    def __init__(self, message: str = "", code: Optional[str] = None):
        super().__init__(message or self.code)
        if code:
            self.code = code


class GmailAuthError(GmailError):
    """The credentials no longer work (revoked, expired refresh token, scope removed). A person must reconnect."""

    code = "reauthorization_required"


class GmailTransientError(GmailError):
    """Worth retrying later: 5xx, network trouble, timeouts."""

    code = "transient_error"

    def __init__(self, message: str = "", code: Optional[str] = None, retry_after: Optional[float] = None):
        super().__init__(message, code)
        self.retry_after = retry_after


class GmailRateLimitError(GmailTransientError):
    code = "rate_limited"


class GmailHistoryExpired(GmailError):
    """The stored historyId is too old or invalid; the mailbox must be resynchronised."""

    code = "history_expired"


class GmailNotFound(GmailError):
    code = "not_found"


class GmailPermanentError(GmailError):
    code = "permanent_error"


class OAuthFlowError(Exception):
    """Raised by the OAuth layer. `code` is a short stable reason shown to the user, never provider text."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code

import logging
import re
import sys

from app.core.config import settings

# ----------------------------------------------------------------------------- secret redaction
#
# Credentials must never reach a log line. Some libraries (requests_oauthlib, urllib3, uvicorn's access log) write
# tokens, authorization codes and callback URLs themselves, so redaction is applied to every formatted record (message
# and traceback), not only to our own log calls.

REDACTED = "[REDACTED]"

_TOKEN_SHAPES = [
    re.compile(r"ya29\.[0-9A-Za-z_\-\.]{10,}"),  # Google access token
    re.compile(r"1//[0-9A-Za-z_\-]{20,}"),  # Google refresh token
    re.compile(r"GOCSPX-[0-9A-Za-z_\-]{8,}"),  # Google OAuth client secret
    re.compile(r"4/0[0-9A-Za-z_\-]{20,}"),  # Google authorization code
    re.compile(r"eyJ[0-9A-Za-z_\-]{10,}\.[0-9A-Za-z_\-]{10,}\.[0-9A-Za-z_\-]{10,}"),  # JWT
]
# ?code=...&state=... style URL / form parameters.
_URL_PARAMS = re.compile(
    r"(?i)(?<=[?&])(code|state|access_token|refresh_token|id_token|client_secret|code_verifier|token|password)=[^&\s\"']+"
)
# JSON / Python-repr style: "access_token": "...", 'refresh_token': '...', 'code': '...'
_KEYED_VALUES = re.compile(
    r"""(?ix)(['"](?:access_token|refresh_token|id_token|client_secret|code_verifier|code|token|password)['"]\s*[:=]\s*)(['"])(.*?)\2"""
)
_BEARER = re.compile(r"(?i)\b(bearer\s+)[0-9A-Za-z_\-\.~+/]{8,}=*")


def redact(text: str) -> str:
    """Returns `text` with credential-shaped values replaced. Idempotent and safe on any string."""
    if not text:
        return text
    text = _KEYED_VALUES.sub(lambda m: f"{m.group(1)}{m.group(2)}{REDACTED}{m.group(2)}", text)
    text = _URL_PARAMS.sub(lambda m: f"{m.group(1)}={REDACTED}", text)
    text = _BEARER.sub(lambda m: f"{m.group(1)}{REDACTED}", text)
    for shape in _TOKEN_SHAPES:
        text = shape.sub(REDACTED, text)
    return text


class RedactingFormatter(logging.Formatter):
    """Formats a record normally, then redacts the whole result (message, arguments and exception text)."""

    def format(self, record: logging.LogRecord) -> str:
        return redact(super().format(record))


# Libraries that log request/response bodies, URLs or tokens at DEBUG. Held at WARNING regardless of the app level.
NOISY_LIBRARIES = (
    "requests_oauthlib",
    "oauthlib",
    "google_auth_oauthlib",
    "google.auth",
    "google.oauth2",
    "google_auth_httplib2",
    "googleapiclient",
    "httplib2",
    "urllib3",
    "requests",
    "sqlalchemy.engine",
)


def harden_logging(logger_obj: logging.Logger | None = None) -> None:
    """
    Makes logging safe for credentials: redact every handler's output and keep credential-logging libraries quiet.
    Idempotent. Used for the API process (setup_logging) and the Celery worker/beat loggers.
    """
    for name in NOISY_LIBRARIES:
        lib = logging.getLogger(name)
        if lib.level == logging.NOTSET or lib.level < logging.WARNING:
            lib.setLevel(logging.WARNING)
    targets = [logger_obj] if logger_obj is not None else [logging.getLogger()]
    for target in targets:
        for handler in target.handlers:
            fmt = handler.formatter
            if isinstance(fmt, RedactingFormatter):
                continue
            pattern = getattr(fmt, "_fmt", None) or "%(message)s"
            datefmt = getattr(fmt, "datefmt", None)
            handler.setFormatter(RedactingFormatter(pattern, datefmt=datefmt))


def setup_logging():
    log_level = logging.DEBUG if settings.DEBUG else logging.INFO

    # Custom filter to provide correlation_id if missing
    class CorrelationIdFilter(logging.Filter):
        def filter(self, record):
            if not hasattr(record, "correlation_id"):
                record.correlation_id = "system"
            return True

    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(log_level)
    handler.addFilter(CorrelationIdFilter())
    formatter = RedactingFormatter(
        "%(asctime)s [%(levelname)s] %(name)s [%(correlation_id)s]: %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
    )
    handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)
    root_logger.handlers = [handler]

    # uvicorn's access log prints the full request line, including OAuth callback parameters (code, state):
    # route it through the same redacting handler.
    logging.getLogger("uvicorn.access").handlers = [handler]
    harden_logging()


logger = logging.getLogger("flowpilot")

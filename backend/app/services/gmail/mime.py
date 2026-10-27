"""
Safe parsing of a raw RFC 822 message into what FlowPilot needs.

Uses the standard library `email` package (maintained, strict policy) and BeautifulSoup for HTML. The result is plain
text only: HTML is never rendered or forwarded, links are never followed, attachments are never opened or stored (only
their name, type and size are recorded) and anything that could be an instruction hidden from a human reader is dropped.
"""

import re
from dataclasses import dataclass, field
from datetime import datetime
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import getaddresses, parseaddr, parsedate_to_datetime
from typing import Any, Dict, List, Optional

MAX_TEXT_CHARS = 9500  # NormalizedMessage allows 10000
MAX_SUBJECT_CHARS = 500
MAX_ATTACHMENTS_LISTED = 25
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f‪-‮⁦-⁩]")
_BLANKS = re.compile(r"[ \t\r\f\v]+")
_MANY_NEWLINES = re.compile(r"\n{3,}")
_HIDDEN_STYLE = re.compile(
    r"display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0|opacity\s*:\s*0(?!\.)|max-height\s*:\s*0", re.I
)
_AUTO_LOCALPARTS = {"mailer-daemon", "postmaster", "no-reply", "noreply", "donotreply", "do-not-reply", "bounce"}


@dataclass
class ParsedEmail:
    from_address: str
    from_name: Optional[str]
    subject: str
    text: str
    to_addresses: List[str] = field(default_factory=list)
    cc_addresses: List[str] = field(default_factory=list)
    reply_to: List[str] = field(default_factory=list)
    message_id_header: Optional[str] = None
    in_reply_to: Optional[str] = None
    references: List[str] = field(default_factory=list)
    date: Optional[datetime] = None
    attachments: List[Dict[str, Any]] = field(default_factory=list)
    had_html: bool = False
    auto_generated: Optional[str] = None  # reason, if the mail is machine-generated
    defects: List[str] = field(default_factory=list)

    def metadata(self) -> Dict[str, Any]:
        """Reply-routing and audit metadata (no body text)."""
        return {
            "message_id_header": self.message_id_header,
            "in_reply_to": self.in_reply_to,
            "references": self.references[-20:],
            "to": self.to_addresses[:20],
            "cc": self.cc_addresses[:20],
            "reply_to": self.reply_to[:5],
            "attachments": self.attachments,
            "had_html": self.had_html,
            "parse_defects": self.defects[:10],
        }


def clean_text(value: str, limit: int) -> str:
    value = _CONTROL.sub("", value or "")
    value = "\n".join(_BLANKS.sub(" ", line).strip() for line in value.replace("\r\n", "\n").split("\n"))
    value = _MANY_NEWLINES.sub("\n\n", value).strip()
    return value[:limit]


def html_to_text(html: str) -> str:
    """HTML to text without executing, rendering or following anything. Hidden content is removed."""
    from bs4 import BeautifulSoup  # imported lazily: only needed when an HTML body exists

    soup = BeautifulSoup(html or "", "html.parser")
    for tag in soup(["script", "style", "template", "noscript", "head", "title", "meta", "link", "iframe", "object"]):
        tag.decompose()
    for tag in soup.find_all(True):
        attrs = getattr(tag, "attrs", None) or {}
        if "hidden" in attrs or _HIDDEN_STYLE.search(str(attrs.get("style", ""))) or attrs.get("aria-hidden") == "true":
            tag.decompose()
    for br in soup.find_all("br"):
        br.replace_with("\n")
    for block in soup.find_all(["p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote"]):
        block.append("\n")
    return soup.get_text()


def _addresses(message: EmailMessage, header: str) -> List[str]:
    values = message.get_all(header) or []
    out: List[str] = []
    for _, addr in getaddresses([str(v) for v in values]):
        addr = addr.strip().lower()
        if addr and "@" in addr and addr not in out:
            out.append(addr)
    return out


def _body(message: EmailMessage) -> tuple[str, bool]:
    """Returns (text, had_html). Prefers the plain part; falls back to HTML reduced to text."""
    had_html = False
    chosen = message.get_body(preferencelist=("plain", "html"))
    if chosen is None:
        return "", False
    try:
        content = chosen.get_content()
    except (LookupError, UnicodeDecodeError, ValueError):
        payload = chosen.get_payload(decode=True)
        content = (payload if isinstance(payload, bytes) else b"").decode("utf-8", errors="replace")
    if chosen.get_content_type() == "text/html":
        had_html = True
        content = html_to_text(content)
    elif message.get_body(preferencelist=("html",)) is not None:
        had_html = True
    return content or "", had_html


def _attachments(message: EmailMessage) -> List[Dict[str, Any]]:
    """Name, type and size only. The attachment content is never decoded into storage or opened."""
    listed: List[Dict[str, Any]] = []
    for part in message.iter_attachments():
        if len(listed) >= MAX_ATTACHMENTS_LISTED:
            break
        raw_name = part.get_filename() or ""
        name = clean_text(raw_name.replace("\\", "/").split("/")[-1], 255) or "(unnamed)"
        try:
            size = len(part.get_payload(decode=True) or b"")
        except Exception:  # noqa: BLE001 - a malformed part must not break ingestion
            size = 0
        listed.append({"filename": name, "content_type": part.get_content_type(), "size": size})
    return listed


def _auto_generated(message: EmailMessage, from_address: str) -> Optional[str]:
    auto_submitted = str(message.get("Auto-Submitted", "")).strip().lower()
    if auto_submitted and auto_submitted != "no":
        return "auto_submitted"
    if str(message.get("Precedence", "")).strip().lower() in {"bulk", "junk", "list", "auto_reply"}:
        return "precedence"
    for header in ("X-Autoreply", "X-Autorespond", "X-Auto-Response-Suppress", "List-Id"):
        if message.get(header) is not None:
            return header.lower()
    if from_address.split("@")[0] in _AUTO_LOCALPARTS:
        return "automated_sender"
    return None


def parse_email(raw: bytes) -> ParsedEmail:
    """Parses raw RFC 822 bytes. Never raises for malformed input: defects are recorded and what exists is used."""
    message = BytesParser(policy=policy.default).parsebytes(raw)
    assert isinstance(message, EmailMessage)

    name, address = parseaddr(str(message.get("From", "")))
    address = address.strip().lower()
    subject = clean_text(str(message.get("Subject", "") or ""), MAX_SUBJECT_CHARS)

    try:
        text, had_html = _body(message)
    except Exception:  # noqa: BLE001 - never lose a message because one MIME part is broken
        text, had_html = "", False
    parsed_date: Optional[datetime] = None
    try:
        raw_date = message.get("Date")
        parsed_date = parsedate_to_datetime(str(raw_date)) if raw_date else None
    except (TypeError, ValueError, IndexError):
        parsed_date = None

    references = [r for r in re.split(r"\s+", str(message.get("References", "") or "").strip()) if r]
    return ParsedEmail(
        from_address=address,
        from_name=clean_text(name, 255) or None,
        subject=subject,
        text=clean_text(text, MAX_TEXT_CHARS),
        to_addresses=_addresses(message, "To"),
        cc_addresses=_addresses(message, "Cc"),
        reply_to=_addresses(message, "Reply-To"),
        message_id_header=clean_text(str(message.get("Message-ID", "") or ""), 500) or None,
        in_reply_to=clean_text(str(message.get("In-Reply-To", "") or ""), 500) or None,
        references=references,
        date=parsed_date,
        attachments=_attachments(message),
        had_html=had_html,
        auto_generated=_auto_generated(message, address),
        defects=[type(d).__name__ for d in message.defects],
    )

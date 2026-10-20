"""MIME parsing: safe plain-text extraction, attachment metadata only, malformed input never raises."""

from email.message import EmailMessage

import pytest

from app.services.gmail.mime import MAX_TEXT_CHARS, clean_text, html_to_text, parse_email
from app.services.gmail.sync import classify_inbound
from app.services.gmail.types import RawMessage


def build(**headers) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = headers.pop("From", "Asha Rao <ASHA@Customer.Example>")
    msg["To"] = headers.pop("To", "owner@business.example")
    msg["Subject"] = headers.pop("Subject", "Hello")
    for key, value in headers.items():
        msg[key.replace("_", "-")] = value
    return msg


def raw_for(parsed_labels=("INBOX",)) -> RawMessage:
    return RawMessage("m1", "t1", list(parsed_labels), "10", 1, "snippet", b"")


def test_plain_text_headers_and_addresses_are_extracted():
    msg = build(
        Message_ID="<abc@mail.example>",
        In_Reply_To="<prev@mail.example>",
        References="<a@m> <prev@mail.example>",
        Reply_To="Asha <reply@customer.example>",
        Cc="Bob <bob@x.example>, bob@x.example",
    )
    msg.set_content("Hello team,\r\n\r\n\r\n\r\nWe need help.")
    parsed = parse_email(msg.as_bytes())
    assert parsed.from_address == "asha@customer.example" and parsed.from_name == "Asha Rao"
    assert parsed.to_addresses == ["owner@business.example"] and parsed.cc_addresses == ["bob@x.example"]
    assert parsed.reply_to == ["reply@customer.example"] and parsed.message_id_header == "<abc@mail.example>"
    assert parsed.in_reply_to == "<prev@mail.example>" and parsed.references == ["<a@m>", "<prev@mail.example>"]
    assert parsed.text == "Hello team,\n\nWe need help."  # blank-line runs collapsed
    assert parsed.auto_generated is None and not parsed.had_html


def test_plain_part_is_preferred_over_html_in_multipart_alternative():
    msg = build()
    msg.set_content("the plain version")
    msg.add_alternative("<p>the <b>html</b> version</p>", subtype="html")
    parsed = parse_email(msg.as_bytes())
    assert parsed.text == "the plain version" and parsed.had_html


def test_html_only_mail_is_reduced_to_visible_text():
    msg = build()
    msg.set_content(
        """<html><head><title>x</title><style>p{color:red}</style></head><body>
        <p>Visible paragraph</p><script>steal()</script>
        <div style="display:none">hidden instruction</div>
        <span style="font-size:0">tiny instruction</span>
        <p hidden>attribute hidden</p>
        <p aria-hidden="true">aria hidden</p>
        <a href="http://evil.example/track">click text</a><br>after break</body></html>""",
        subtype="html",
    )
    parsed = parse_email(msg.as_bytes())
    assert "Visible paragraph" in parsed.text and "click text" in parsed.text and "after break" in parsed.text
    for banned in ("steal", "hidden", "tiny instruction", "aria hidden", "color:red", "evil.example", "<", ">"):
        assert banned not in parsed.text, banned
    assert parsed.had_html


def test_html_to_text_never_executes_or_renders_anything():
    assert html_to_text("<img src=x onerror=alert(1)><iframe src=http://x></iframe>ok") == "ok"
    assert html_to_text("") == ""


def test_attachments_are_listed_by_metadata_only_and_never_stored():
    msg = build()
    msg.set_content("see attached")
    msg.add_attachment(
        b"MZ\x90\x00 pretend executable",
        maintype="application",
        subtype="octet-stream",
        filename="..\\..\\windows\\evil.exe",
    )
    msg.add_attachment(b"%PDF-1.4 ...", maintype="application", subtype="pdf", filename="invoice.pdf")
    parsed = parse_email(msg.as_bytes())
    assert [a["filename"] for a in parsed.attachments] == ["evil.exe", "invoice.pdf"]  # path components stripped
    assert parsed.attachments[0]["content_type"] == "application/octet-stream" and parsed.attachments[1]["size"] > 0
    assert "pretend executable" not in parsed.text and "%PDF" not in parsed.text
    assert set(parsed.attachments[0]) == {"filename", "content_type", "size"}
    many = build()
    many.set_content("x")
    for i in range(40):
        many.add_attachment(b"a", maintype="application", subtype="octet-stream", filename=f"f{i}.bin")
    assert len(parse_email(many.as_bytes()).attachments) == 25


def test_header_injection_control_characters_and_oversize_text_are_neutralised():
    msg = build(Subject="Invoice‮exe.pdf")
    msg.set_content("A" * 50000)
    parsed = parse_email(msg.as_bytes())
    assert "‮" not in parsed.subject and len(parsed.text) == MAX_TEXT_CHARS
    assert clean_text("a\x00b\x07c\x7fd", 100) == "abcd"
    crlf = parse_email(b"From: a@b.example\r\nSubject: Hi\r\nX-Injected: yes\r\n\r\nbody")
    assert crlf.subject == "Hi"


@pytest.mark.parametrize(
    "raw",
    [
        b"",
        b"not a mail at all",
        b"\xff\xfe\x00\x01 binary garbage",
        b"From: =?utf-8?q?bad?= <broken\r\nSubject: =?utf-8?b?!!!?=\r\n\r\n\xff body",
        b"From: a@b.example\r\nContent-Type: text/plain; charset=nonexistent-charset\r\n\r\nbody \xe9",
        b"From: a@b.example\r\nContent-Type: multipart/mixed; boundary=zz\r\n\r\n--zz\r\nContent-Type: text/plain\r\n\r\nunterminated",
    ],
)
def test_malformed_mail_never_raises(raw):
    parsed = parse_email(raw)
    assert isinstance(parsed.text, str) and isinstance(parsed.subject, str)


def test_encoded_headers_and_charsets_decode():
    parsed = parse_email(
        b"From: =?utf-8?q?Jos=C3=A9?= <jose@x.example>\r\nSubject: =?utf-8?q?Caf=C3=A9?=\r\n"
        b"Content-Type: text/plain; charset=iso-8859-1\r\nContent-Transfer-Encoding: 8bit\r\n\r\nna\xefve caf\xe9"
    )
    assert parsed.from_name == "José" and parsed.subject == "Café" and parsed.text == "naïve café"


@pytest.mark.parametrize(
    "header,value,reason",
    [
        ("Auto-Submitted", "auto-replied", "auto_submitted"),
        ("Precedence", "bulk", "precedence"),
        ("Precedence", "junk", "precedence"),
        ("X-Autoreply", "yes", "x-autoreply"),
        ("List-Id", "<list.example>", "list-id"),
        ("X-Auto-Response-Suppress", "All", "x-auto-response-suppress"),
    ],
)
def test_machine_generated_mail_is_detected(header, value, reason):
    msg = build(**{header.replace("-", "_"): value})
    msg.set_content("x")
    assert parse_email(msg.as_bytes()).auto_generated == reason


def test_auto_submitted_no_is_a_person_and_automated_senders_are_caught():
    msg = build(Auto_Submitted="no")
    msg.set_content("x")
    assert parse_email(msg.as_bytes()).auto_generated is None
    bot = build(From="Mail Delivery <MAILER-DAEMON@x.example>")
    bot.set_content("x")
    assert parse_email(bot.as_bytes()).auto_generated == "automated_sender"


@pytest.mark.parametrize(
    "labels,reason",
    [
        (("INBOX",), None),
        (("SENT",), "sent"),
        (("DRAFT", "INBOX"), "draft"),
        (("INBOX", "SPAM"), "spam"),
        (("INBOX", "TRASH"), "trash"),
        (("CATEGORY_UPDATES",), "not_inbox"),
    ],
)
def test_label_based_filtering(labels, reason):
    msg = build()
    msg.set_content("x")
    assert classify_inbound(raw_for(labels), parse_email(msg.as_bytes()), "owner@business.example") == reason


def test_self_sent_and_senderless_mail_are_filtered():
    msg = build(From="Owner <OWNER@business.example>")
    msg.set_content("x")
    assert classify_inbound(raw_for(), parse_email(msg.as_bytes()), "owner@business.example") == "self_sent"
    assert (
        classify_inbound(raw_for(), parse_email(b"Subject: no sender\r\n\r\nbody"), "owner@business.example")
        == "no_sender"
    )

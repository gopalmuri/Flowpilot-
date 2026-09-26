import ipaddress
import socket
import pytest
from app.core.ssrf import (
    SSRFValidationError,
    create_ssrf_safe_client,
    is_ip_blocked,
    validate_outbound_url,
)


def test_is_ip_blocked_ipv4():
    # Loopback
    assert is_ip_blocked(ipaddress.ip_address("127.0.0.1")) is True
    assert is_ip_blocked(ipaddress.ip_address("127.12.34.56")) is True

    # Private RFC 1918
    assert is_ip_blocked(ipaddress.ip_address("10.0.0.1")) is True
    assert is_ip_blocked(ipaddress.ip_address("172.16.0.1")) is True
    assert is_ip_blocked(ipaddress.ip_address("172.31.255.254")) is True
    assert is_ip_blocked(ipaddress.ip_address("192.168.1.1")) is True

    # Link-local / Cloud metadata
    assert is_ip_blocked(ipaddress.ip_address("169.254.169.254")) is True
    assert is_ip_blocked(ipaddress.ip_address("169.254.1.1")) is True

    # Unspecified / Multicast / Broadcast
    assert is_ip_blocked(ipaddress.ip_address("0.0.0.0")) is True
    assert is_ip_blocked(ipaddress.ip_address("224.0.0.1")) is True
    assert is_ip_blocked(ipaddress.ip_address("255.255.255.255")) is True

    # Public IP
    assert is_ip_blocked(ipaddress.ip_address("8.8.8.8")) is False
    assert is_ip_blocked(ipaddress.ip_address("1.1.1.1")) is False
    assert is_ip_blocked(ipaddress.ip_address("54.148.12.34")) is False


def test_is_ip_blocked_ipv6():
    # Loopback
    assert is_ip_blocked(ipaddress.ip_address("::1")) is True

    # Unique Local Address (fc00::/7)
    assert is_ip_blocked(ipaddress.ip_address("fc00::1")) is True
    assert is_ip_blocked(ipaddress.ip_address("fd00::abcd")) is True

    # Link-local (fe80::/10)
    assert is_ip_blocked(ipaddress.ip_address("fe80::1")) is True

    # Unspecified (::)
    assert is_ip_blocked(ipaddress.ip_address("::")) is True

    # Cloud metadata IPv6
    assert is_ip_blocked(ipaddress.ip_address("fd00:ec2::254")) is True

    # Public IPv6 (Google public DNS)
    assert is_ip_blocked(ipaddress.ip_address("2001:4860:4860::8888")) is False


def test_is_ip_blocked_ipv4_mapped_ipv6():
    # ::ffff:127.0.0.1 should be detected as blocked loopback
    mapped_loopback = ipaddress.ip_address("::ffff:127.0.0.1")
    assert is_ip_blocked(mapped_loopback) is True

    # ::ffff:169.254.169.254 metadata
    mapped_metadata = ipaddress.ip_address("::ffff:169.254.169.254")
    assert is_ip_blocked(mapped_metadata) is True

    # ::ffff:8.8.8.8 public IPv4 mapped
    mapped_public = ipaddress.ip_address("::ffff:8.8.8.8")
    assert is_ip_blocked(mapped_public) is False


def test_validate_outbound_url_protocol_enforcement():
    # Plain HTTP rejected by default
    with pytest.raises(SSRFValidationError, match="Insecure protocol 'http'"):
        validate_outbound_url("http://example.com/webhook")

    # Plain HTTP permitted in mock/test mode
    validate_outbound_url("http://127.0.0.1:8000/mock", allow_local_mock=True)

    # Disallowed schemes
    with pytest.raises(SSRFValidationError, match="Insecure protocol 'ftp'"):
        validate_outbound_url("ftp://example.com/file")


def test_validate_outbound_url_blocks_internal_ips():
    # Loopback IP literal
    with pytest.raises(SSRFValidationError, match="blocked/private range"):
        validate_outbound_url("https://127.0.0.1/services/hooks")

    # Private IP literal
    with pytest.raises(SSRFValidationError, match="blocked/private range"):
        validate_outbound_url("https://10.0.0.5/api")

    # Cloud metadata literal
    with pytest.raises(SSRFValidationError, match="blocked/private range"):
        validate_outbound_url("https://169.254.169.254/latest/meta-data")


def test_validate_outbound_url_dns_resolution(monkeypatch):
    # Mock DNS resolving to private IP
    def mock_getaddrinfo(host, port, **kwargs):
        if host == "internal.company.corp":
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.168.1.50", port))]
        elif host == "hooks.slack.com":
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("54.148.10.20", port))]
        raise socket.gaierror(-2, "Name or service not known")

    monkeypatch.setattr(socket, "getaddrinfo", mock_getaddrinfo)

    # Private resolved IP must fail
    with pytest.raises(SSRFValidationError, match="belongs to a blocked/private range"):
        validate_outbound_url("https://internal.company.corp/webhook")

    # Public resolved IP must pass
    hostname, ips = validate_outbound_url("https://hooks.slack.com/services/T00/B00/X")
    assert hostname == "hooks.slack.com"
    assert "54.148.10.20" in ips

    # Unknown host must fail
    with pytest.raises(SSRFValidationError, match="DNS resolution failed"):
        validate_outbound_url("https://unknown-non-existent-domain-xyz999.com/webhook")


def test_create_ssrf_safe_client_configuration():
    client = create_ssrf_safe_client(timeout_seconds=4.0, connect_timeout=2.0)
    assert client.follow_redirects is False
    assert client.trust_env is False
    assert client.timeout.read == 4.0
    assert client.timeout.connect == 2.0

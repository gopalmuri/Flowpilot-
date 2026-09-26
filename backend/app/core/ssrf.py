import ipaddress
import socket
from typing import List, Optional, Set, Tuple
from urllib.parse import urlparse
import httpx

CLOUD_METADATA_IPS: Set[str] = {
    "169.254.169.254",  # AWS, GCP, Azure, OpenStack instance metadata
    "fd00:ec2::254",    # AWS IPv6 metadata
}

BLOCKED_HOSTNAMES: Set[str] = {
    "localhost",
    "metadata.google.internal",
    "instance-data",
}


class SSRFValidationError(ValueError):
    """Raised when an outbound URL fails SSRF security checks."""
    pass


def is_ip_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """
    Checks if an IP address belongs to private, loopback, link-local, multicast,
    unspecified, reserved, or cloud metadata ranges.
    Handles IPv4, IPv6, and IPv4-mapped IPv6.
    """
    # 1. Check if IPv4-mapped IPv6 (::ffff:x.x.x.x)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped

    ip_str = str(ip)

    # 2. Check explicit cloud metadata IPs
    if ip_str in CLOUD_METADATA_IPS:
        return True

    # 3. Check loopback (127.0.0.0/8, ::1)
    if ip.is_loopback:
        return True

    # 4. Check private networks (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7)
    if ip.is_private:
        return True

    # 5. Check link-local (169.254.0.0/16, fe80::/10)
    if ip.is_link_local:
        return True

    # 6. Check multicast (224.0.0.0/4, ff00::/8)
    if ip.is_multicast:
        return True

    # 7. Check unspecified (0.0.0.0/8, ::/128)
    if ip.is_unspecified:
        return True

    # 8. Check reserved / special
    if ip.is_reserved:
        return True

    # 9. Explicit check for IPv6 Unique Local Address (fc00::/7)
    if isinstance(ip, ipaddress.IPv6Address):
        if ip in ipaddress.IPv6Network("fc00::/7"):
            return True
        if ip in ipaddress.IPv6Network("fe80::/10"):
            return True

    return False


def validate_outbound_url(
    url: str,
    allow_local_mock: bool = False,
) -> Tuple[str, List[str]]:
    """
    Validates an outbound integration URL (e.g. Slack webhook).
    Requirements:
      - Valid HTTPS URL (or HTTP if allow_local_mock is True).
      - Pre-resolves DNS to all IP addresses.
      - Rejects any private, loopback, link-local, multicast, or cloud-metadata IP.
      - Returns (hostname, resolved_ips).
    """
    if not url or not isinstance(url, str):
        raise SSRFValidationError("URL must be a non-empty string")

    parsed = urlparse(url)

    if not parsed.scheme or not parsed.hostname:
        raise SSRFValidationError(f"Invalid URL structure: {url}")

    # Protocol enforcement
    scheme = parsed.scheme.lower()
    if scheme != "https":
        if scheme == "http" and allow_local_mock:
            pass  # Allowed only for explicit local mock/test mode
        else:
            raise SSRFValidationError(
                f"Insecure protocol '{scheme}'. Real outbound integration endpoints require HTTPS."
            )

    hostname = parsed.hostname.lower()

    if not allow_local_mock and hostname in BLOCKED_HOSTNAMES:
        raise SSRFValidationError(f"Blocked hostname '{hostname}' is not permitted.")

    # Determine port
    port = parsed.port or (443 if scheme == "https" else 80)

    # 1. Check if hostname is directly an IP literal
    try:
        literal_ip = ipaddress.ip_address(hostname)
        if not allow_local_mock and is_ip_blocked(literal_ip):
            raise SSRFValidationError(f"Target IP '{hostname}' belongs to a blocked/private range.")
        return hostname, [str(literal_ip)]
    except ValueError:
        pass  # Hostname is a domain name, proceed to DNS resolution

    # 2. DNS Pre-Resolution
    try:
        addr_info = socket.getaddrinfo(
            hostname,
            port,
            family=socket.AF_UNSPEC,
            proto=socket.IPPROTO_TCP,
        )
    except socket.gaierror as e:
        raise SSRFValidationError(f"DNS resolution failed for host '{hostname}': {str(e)}")

    if not addr_info:
        raise SSRFValidationError(f"No IP addresses resolved for host '{hostname}'")

    resolved_ips: List[str] = []
    for info in addr_info:
        ip_str = info[4][0]
        try:
            ip_obj = ipaddress.ip_address(ip_str)
        except ValueError:
            raise SSRFValidationError(f"Invalid resolved IP '{ip_str}'")

        if not allow_local_mock and is_ip_blocked(ip_obj):
            raise SSRFValidationError(
                f"Resolved IP '{ip_str}' for host '{hostname}' belongs to a blocked/private range."
            )

        if ip_str not in resolved_ips:
            resolved_ips.append(ip_str)

    return hostname, resolved_ips


def create_ssrf_safe_client(
    timeout_seconds: float = 5.0,
    connect_timeout: float = 3.0,
) -> httpx.AsyncClient:
    """
    Creates an httpx.AsyncClient configured for SSRF protection:
      - follow_redirects=False (disables redirect-based SSRF)
      - trust_env=False (ignores local proxy env vars)
      - Strict connect and total timeouts.
    """
    return httpx.AsyncClient(
        follow_redirects=False,
        trust_env=False,
        timeout=httpx.Timeout(timeout_seconds, connect=connect_timeout),
    )

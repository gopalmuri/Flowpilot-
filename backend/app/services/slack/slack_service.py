import json
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set
import httpx
from app.core.ssrf import (
    SSRFValidationError,
    create_ssrf_safe_client,
    validate_outbound_url,
)

# Allowed root variable namespaces for safe template interpolation
ALLOWED_NAMESPACES: Set[str] = {
    "trigger",
    "lead",
    "ai",
    "steps",
    "workflow",
}

# Blocked sensitive keywords in template path lookups
BLOCKED_SENSITIVE_KEYS: Set[str] = {
    "password",
    "token",
    "access_token",
    "refresh_token",
    "secret",
    "credentials",
    "key",
    "auth",
    "authorization",
    "api_key",
}

TEMPLATE_VAR_REGEX = re.compile(r"\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}")
MAX_RESPONSE_BYTES = 10 * 1024  # 10 KB response size limit


class SlackDeliveryError(Exception):
    """Raised when Slack notification delivery fails. Never exposes credentials."""
    pass


class SlackService:
    """
    Slack integration client providing:
      - Deterministic regex-based variable template interpolation.
      - Slack Block Kit message formatting for lead qualification.
      - Mock delivery mode for automated testing / offline environments.
      - Live delivery mode with SSRF validation, HTTPS enforcement, and size/timeout limits.
    """

    def interpolate_template(
        self,
        template: str,
        context: Dict[str, Any],
    ) -> str:
        """
        Safely interpolates variables from context into the template.
        Supports paths like:
          {{ trigger.email }}
          {{ ai.category }}
          {{ lead.company }}
          {{ steps.check_enterprise.output.result }}
        Zero eval, exec, compile, or Jinja execution.
        """
        if not template or not isinstance(template, str):
            return ""

        def _replace_var(match: re.Match) -> str:
            path_str = match.group(1).strip()
            parts = path_str.split(".")

            root = parts[0].lower()
            if root not in ALLOWED_NAMESPACES:
                # Disallowed namespace (e.g. {{ settings.SECRET_KEY }} or {{ env.PATH }})
                return "[UNAUTHORIZED_NAMESPACE]"

            # Check if any path component touches sensitive fields
            for part in parts:
                if part.lower() in BLOCKED_SENSITIVE_KEYS:
                    return "[REDACTED]"

            # Traverse context safely
            curr: Any = context.get(root)
            for part in parts[1:]:
                if isinstance(curr, dict):
                    curr = curr.get(part)
                else:
                    return ""
                if curr is None:
                    return ""

            if curr is None:
                return ""
            if isinstance(curr, (dict, list)):
                return json.dumps(curr)
            return str(curr)

        return TEMPLATE_VAR_REGEX.sub(_replace_var, template)

    def format_lead_notification(
        self,
        lead: Dict[str, Any],
        classification: Optional[Dict[str, Any]] = None,
        channel: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Formats a standard message and rich Slack Block Kit blocks for a qualified lead.
        """
        company = lead.get("company") or lead.get("name") or "Unknown Company"
        email = lead.get("email") or "Not provided"
        deal_size = lead.get("deal_size") or lead.get("lead_score") or "N/A"

        category = "GENERAL"
        confidence = "N/A"
        priority = "NORMAL"

        if classification:
            category = str(classification.get("category", "GENERAL")).upper()
            priority = str(classification.get("priority", "NORMAL")).upper()
            conf_val = classification.get("confidence")
            if conf_val is not None:
                confidence = f"{round(float(conf_val) * 100, 1)}%"

        text_fallback = f"🎯 Qualified Lead: {company} ({category}) | Email: {email}"

        blocks = [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": f"🎯 New Qualified Lead: {company}",
                    "emoji": True,
                },
            },
            {
                "type": "section",
                "fields": [
                    {"type": "mrkdwn", "text": f"*Company:*\n{company}"},
                    {"type": "mrkdwn", "text": f"*Contact Email:*\n{email}"},
                    {"type": "mrkdwn", "text": f"*Category:*\n`{category}`"},
                    {"type": "mrkdwn", "text": f"*Priority:*\n*{priority}*"},
                    {"type": "mrkdwn", "text": f"*Confidence:*\n{confidence}"},
                    {"type": "mrkdwn", "text": f"*Score / Value:*\n{deal_size}"},
                ],
            },
            {
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": f"Automated via *FlowPilot Engine* &bull; {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}",
                    }
                ],
            },
        ]

        payload: Dict[str, Any] = {
            "text": text_fallback,
            "blocks": blocks,
        }
        if channel:
            payload["channel"] = channel

        return payload

    async def send_notification(
        self,
        webhook_url: str,
        message: str,
        blocks: Optional[List[Dict[str, Any]]] = None,
        channel: Optional[str] = None,
        mock_mode: bool = False,
    ) -> Dict[str, Any]:
        """
        Dispatches a Slack notification to an incoming webhook URL.
        Enforces SSRF boundary, size limits, and timeout.
        """
        start_time = time.perf_counter()

        # Check for mock mode or mock URL
        is_mock = (
            mock_mode
            or webhook_url.startswith("mock://")
            or "hooks.slack.com/services/MOCK" in webhook_url
        )

        mock_msg_id = f"slack_msg_{uuid.uuid4().hex[:12]}"
        now_iso = datetime.now(timezone.utc).isoformat()

        if is_mock:
            # Simulated delivery
            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
            return {
                "message_id": mock_msg_id,
                "channel": channel or "#general",
                "rendered_message": message,
                "delivery_status": "delivered",
                "delivered_at": now_iso,
                "latency_ms": max(elapsed_ms, 1.0),
                "mock_adapter": True,
            }

        # Real Outbound Dispatch
        # 1. Enforce HTTPS & SSRF validation
        validate_outbound_url(webhook_url, allow_local_mock=False)

        payload: Dict[str, Any] = {"text": message}
        if blocks:
            payload["blocks"] = blocks
        if channel:
            payload["channel"] = channel

        # 2. Safe HTTP POST
        client = create_ssrf_safe_client(timeout_seconds=5.0, connect_timeout=3.0)
        try:
            async with client:
                response = await client.post(
                    webhook_url,
                    json=payload,
                    headers={"Content-Type": "application/json"},
                )

                # Read body with response size limit (10 KB max)
                body_bytes = b""
                async for chunk in response.aiter_bytes():
                    body_bytes += chunk
                    if len(body_bytes) > MAX_RESPONSE_BYTES:
                        break

                if response.status_code >= 400:
                    raise SlackDeliveryError(
                        f"Slack webhook endpoint returned HTTP {response.status_code}"
                    )

                elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
                return {
                    "message_id": mock_msg_id,
                    "channel": channel or "#general",
                    "rendered_message": message,
                    "delivery_status": "delivered",
                    "delivered_at": now_iso,
                    "latency_ms": elapsed_ms,
                    "mock_adapter": False,
                }
        except httpx.TimeoutException:
            raise SlackDeliveryError("Slack delivery timed out after 5.0 seconds")
        except SSRFValidationError:
            raise
        except Exception as e:
            if isinstance(e, SlackDeliveryError):
                raise
            raise SlackDeliveryError(f"Slack delivery failed: {type(e).__name__}")

    async def test_webhook(
        self,
        webhook_url: str,
        channel: Optional[str] = None,
        mock_mode: bool = False,
    ) -> Dict[str, Any]:
        """
        Tests connectivity to the Slack webhook endpoint.
        """
        start_time = time.perf_counter()
        test_msg = "🔔 FlowPilot Slack Integration Diagnostic: Handshake Successful!"

        res = await self.send_notification(
            webhook_url=webhook_url,
            message=test_msg,
            channel=channel,
            mock_mode=mock_mode,
        )

        elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
        return {
            "status": "healthy",
            "latency_ms": max(res.get("latency_ms", elapsed_ms), 1.0),
            "message": "Slack webhook handshake verified successfully",
            "tested_at": datetime.now(timezone.utc).isoformat(),
        }

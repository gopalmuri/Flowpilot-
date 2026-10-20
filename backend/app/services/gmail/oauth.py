"""
Google OAuth 2.0 authorization-code flow (with PKCE) for mailbox access, using google-auth-oauthlib.

This is mailbox authorization, not "Sign in with Google" for FlowPilot users: it requests only the Gmail scope and no
identity scopes. The mailbox identity comes from the Gmail API itself (`users.getProfile`).

The flow has been exercised offline (URL construction) and against fakes. The code exchange has not run against Google.
"""

import asyncio
import os
from datetime import timezone
from typing import Any, Dict

from app.core.config import settings
from app.services.gmail.errors import OAuthFlowError
from app.services.gmail.types import (
    REQUIRED_SCOPES,
    AuthorizationRequest,
    OAuthClient,
    TokenSet,
)

AUTH_URI = "https://accounts.google.com/o/oauth2/auth"
TOKEN_URI = "https://oauth2.googleapis.com/token"


class GoogleOAuthClient(OAuthClient):
    def is_configured(self) -> bool:
        return bool(
            settings.GOOGLE_OAUTH_CLIENT_ID
            and settings.GOOGLE_OAUTH_CLIENT_SECRET
            and settings.GOOGLE_OAUTH_REDIRECT_URI
        )

    def _config(self) -> Dict[str, Any]:
        return {
            "web": {
                "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
                "client_secret": settings.GOOGLE_OAUTH_CLIENT_SECRET,
                "auth_uri": AUTH_URI,
                "token_uri": TOKEN_URI,
                "redirect_uris": [settings.GOOGLE_OAUTH_REDIRECT_URI],
            }
        }

    def _flow(self) -> Any:
        from google_auth_oauthlib.flow import Flow

        flow = Flow.from_client_config(self._config(), scopes=REQUIRED_SCOPES)
        flow.redirect_uri = settings.GOOGLE_OAUTH_REDIRECT_URI
        return flow

    def authorization_url(self, state: str) -> AuthorizationRequest:
        if not self.is_configured():
            raise OAuthFlowError("oauth_not_configured")
        flow = self._flow()
        # offline + consent: Google only returns a refresh token on consent. No include_granted_scopes: we never want
        # scopes from other apps/features piled onto this grant.
        url, _ = flow.authorization_url(access_type="offline", prompt="consent", state=state)
        verifier = getattr(flow, "code_verifier", None)
        if not verifier:
            raise OAuthFlowError("pkce_unavailable")
        return AuthorizationRequest(url=url, code_verifier=verifier)

    async def exchange_code(self, code: str, code_verifier: str) -> TokenSet:
        def call() -> TokenSet:
            # oauthlib raises when Google reorders or adds scopes; we validate the granted scopes ourselves instead.
            os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = "1"
            flow = self._flow()
            flow.code_verifier = code_verifier
            flow.fetch_token(code=code)
            creds = flow.credentials
            expiry = creds.expiry.replace(tzinfo=timezone.utc) if creds.expiry else None
            return TokenSet(
                access_token=creds.token,
                refresh_token=creds.refresh_token,
                expiry=expiry,
                scopes=list(creds.scopes or []),
                token_uri=TOKEN_URI,
            )

        try:
            return await asyncio.to_thread(call)
        except OAuthFlowError:
            raise
        except Exception:  # noqa: BLE001 - provider text may contain secrets; surface only a stable code
            raise OAuthFlowError("token_exchange_failed") from None


def default_oauth_client() -> OAuthClient:
    return GoogleOAuthClient()

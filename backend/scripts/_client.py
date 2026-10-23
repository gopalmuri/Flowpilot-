"""Shared helpers for the demo scripts. They talk to a running FlowPilot API over HTTP."""

import os
from dataclasses import dataclass
from typing import Any, Dict, Optional

import httpx

DEFAULT_BASE_URL = os.getenv("FLOWPILOT_API_URL", "http://localhost:8000/api/v1")
DEFAULT_EMAIL = os.getenv("FLOWPILOT_DEMO_EMAIL", "demo.admin@flowpilot.internal")
DEFAULT_PASSWORD = os.getenv("FLOWPILOT_DEMO_PASSWORD", "Password123!")
DEFAULT_ORG_NAME = os.getenv("FLOWPILOT_DEMO_ORG", "FlowPilot Demo")

WORKFLOW_NAME = "Enterprise Lead Intake Pipeline"
WEBHOOK_SECRET = "demo_webhook_secret_change_me"


class DemoError(RuntimeError):
    pass


@dataclass
class Session:
    http: httpx.Client
    org_id: str
    headers: Dict[str, str]

    def request(self, method: str, path: str, expected: int = 200, **kwargs: Any) -> Any:
        resp = self.http.request(method, path, headers=self.headers, **kwargs)
        if resp.status_code != expected:
            raise DemoError(f"{method} {path} -> {resp.status_code}: {resp.text[:300]}")
        return resp.json() if resp.content else None


def _check(resp: httpx.Response, what: str, ok: int = 200) -> Dict[str, Any]:
    if resp.status_code != ok:
        raise DemoError(f"{what} failed ({resp.status_code}): {resp.text[:300]}")
    return resp.json()


def open_session(
    base_url: str = DEFAULT_BASE_URL,
    email: str = DEFAULT_EMAIL,
    password: str = DEFAULT_PASSWORD,
    org_name: str = DEFAULT_ORG_NAME,
) -> Session:
    """Log in (registering the demo user on first run) and resolve an organization."""
    http = httpx.Client(base_url=base_url, timeout=30)
    login = http.post("/auth/login", json={"email": email, "password": password})
    if login.status_code in (401, 404):
        _check(
            http.post(
                "/auth/register",
                json={"email": email, "password": password, "full_name": "Demo Admin"},
            ),
            "register",
            ok=201,
        )
        login = http.post("/auth/login", json={"email": email, "password": password})
    token = _check(login, "login")["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    me = _check(http.get("/auth/me", headers=headers), "load profile")
    org_id = me.get("active_organization_id")
    if org_id and me.get("active_role") in ("OWNER", "ADMIN", "MANAGER"):
        return Session(http=http, org_id=org_id, headers=headers)

    # No usable organization yet: create one and switch the token to it.
    org_id = _check(
        http.post("/organizations", headers=headers, json={"name": org_name}),
        "create organization",
        ok=201,
    )["id"]
    relogin = http.post("/auth/login", json={"email": email, "password": password, "organization_id": org_id})
    headers = {"Authorization": f"Bearer {_check(relogin, 'login (org scope)')['access_token']}"}
    return Session(http=http, org_id=org_id, headers=headers)


def find_workflow(session: Session, name: Optional[str] = None) -> Optional[Dict[str, Any]]:
    items = session.request("GET", f"/organizations/{session.org_id}/workflows", params={"page_size": 100})["items"]
    return next((w for w in items if w["name"] == (name or WORKFLOW_NAME)), None)

"""Send a signed inbound lead, approve it, and print the outcome (the full demo flow).

Requires the pipeline from `python -m scripts.seed_demo`.

    python -m scripts.run_demo            # send lead and approve it
    python -m scripts.run_demo --reject   # send lead and reject it
    python -m scripts.run_demo --no-decision   # leave it waiting in /approvals
"""

import argparse
import json
import time

from app.services.webhook_service import calculate_hmac_signature
from scripts._client import (
    DEFAULT_BASE_URL,
    DEFAULT_EMAIL,
    DEFAULT_PASSWORD,
    WEBHOOK_SECRET,
    WORKFLOW_NAME,
    DemoError,
    find_workflow,
    open_session,
)

LEAD = {
    "company": "Acme Corporation",
    "contact_name": "Sarah Lin",
    "contact_email": "sarah.lin@acme.corp",
    "employees": 500,
    "deal_value": 50000,
    "message": "Urgent enterprise partnership: need workflow automation with SSO SAML.",
}


def run(base_url: str, email: str, password: str, decision: str) -> None:
    session = open_session(base_url, email, password)
    wf = find_workflow(session)
    if not wf:
        raise DemoError(f"'{WORKFLOW_NAME}' not found. Run: python -m scripts.seed_demo")

    # Unique company per run so CRM email de-duplication never hides a failure.
    lead = {**LEAD, "contact_email": f"sarah.{int(time.time())}@acme.corp"}
    body = json.dumps(lead).encode()
    ts = str(int(time.time()))
    resp = session.http.post(
        f"/webhooks/{wf['webhook_key']}",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Webhook-Timestamp": ts,
            "X-Webhook-Signature": calculate_hmac_signature(WEBHOOK_SECRET, ts, body),
        },
    )
    if resp.status_code != 200:
        raise DemoError(f"webhook rejected ({resp.status_code}): {resp.text[:300]}")
    run_id = resp.json()["workflow_run_id"]
    print(f"[1] Webhook accepted -> run {run_id}")

    org = f"/organizations/{session.org_id}"
    status = session.request("GET", f"{org}/runs/{run_id}")["status"]
    print(f"[2] Run status: {status}")

    if decision != "none":
        pending = session.request("GET", f"{org}/approvals", params={"status": "PENDING"})["items"]
        approval = next((a for a in pending if str(a["workflow_run_id"]) == str(run_id)), None)
        if not approval:
            raise DemoError("no pending approval found for this run")
        result = session.request(
            "POST",
            f"{org}/approvals/{approval['id']}/{decision}",
            json={"comment": f"Demo script: {decision}"},
        )
        print(f"[3] Decision '{decision}' recorded -> {result['status']}")
        status = session.request("GET", f"{org}/runs/{run_id}")["status"]
    print(f"[4] Final run status: {status}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--email", default=DEFAULT_EMAIL)
    parser.add_argument("--password", default=DEFAULT_PASSWORD)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--reject", action="store_true")
    group.add_argument("--no-decision", action="store_true")
    args = parser.parse_args()
    choice = "reject" if args.reject else "none" if args.no_decision else "approve"
    try:
        run(args.base_url, args.email, args.password, choice)
    except DemoError as exc:
        raise SystemExit(f"[x] {exc}") from exc

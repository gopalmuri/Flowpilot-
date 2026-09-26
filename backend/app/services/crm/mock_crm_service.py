import asyncio
import json
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from app.core.security import get_redis_client


class MockCRMService:
    """
    High-fidelity simulated CRM service (HubSpot / Salesforce style).
    Supports:
      - Multi-process persistence in Redis with organization-scoped key isolation.
      - Atomic email deduplication per organization via HSETNX.
      - In-memory fallback for local unit tests without Redis.
      - Latency tracking and connectivity health check.
    """

    def __init__(self, use_redis: bool = True):
        self.use_redis = use_redis
        self._local_lock = asyncio.Lock()
        # Fallback local in-memory storage: org_id -> {lead_id: lead_dict}
        self._local_leads: Dict[str, Dict[str, Dict[str, Any]]] = {}
        # Fallback local email index: org_id -> {email: lead_id}
        self._local_emails: Dict[str, Dict[str, str]] = {}

    async def _get_redis(self):
        if not self.use_redis:
            return None
        try:
            return get_redis_client()
        except Exception:
            return None

    async def create_lead(
        self,
        organization_id: str,
        lead_data: Dict[str, Any],
        simulated_latency_ms: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        Creates or deduplicates a lead within the given organization.
        Atomically prevents duplicate email records per organization.
        """
        start_time = time.perf_counter()

        if simulated_latency_ms and simulated_latency_ms > 0:
            await asyncio.sleep(simulated_latency_ms / 1000.0)

        org_str = str(organization_id)
        email = (lead_data.get("email") or "").strip().lower()
        company = (lead_data.get("company") or "").strip()

        redis = await self._get_redis()
        now_iso = datetime.now(timezone.utc).isoformat()

        if redis:
            email_key = f"mock_crm:{org_str}:emails"
            leads_key = f"mock_crm:{org_str}:leads"

            new_lead_id = f"crm_lead_{uuid.uuid4().hex[:12]}"

            if email:
                # Atomic deduplication via HSETNX
                is_new = await redis.hsetnx(email_key, email, new_lead_id)
                if not is_new:
                    # Duplicate email in this org! Fetch existing lead
                    existing_id = await redis.hget(email_key, email)
                    if isinstance(existing_id, bytes):
                        existing_id = existing_id.decode("utf-8")

                    raw_lead = await redis.hget(leads_key, existing_id)
                    existing_lead = json.loads(raw_lead) if raw_lead else {}

                    # Merge attributes
                    existing_lead.setdefault("attributes", {})
                    existing_lead["attributes"].update(lead_data)
                    existing_lead["updated_at"] = now_iso

                    await redis.hset(leads_key, existing_id, json.dumps(existing_lead))

                    elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
                    return {
                        "crm_id": existing_id,
                        "entity_type": "lead",
                        "status": "already_exists",
                        "attributes": existing_lead.get("attributes", {}),
                        "created_at": existing_lead.get("created_at", now_iso),
                        "updated_at": now_iso,
                        "latency_ms": elapsed_ms,
                        "mock_adapter": True,
                    }

            # Unique lead
            lead_record = {
                "crm_id": new_lead_id,
                "organization_id": org_str,
                "entity_type": "lead",
                "email": email,
                "company": company,
                "attributes": lead_data,
                "created_at": now_iso,
                "updated_at": now_iso,
            }
            await redis.hset(leads_key, new_lead_id, json.dumps(lead_record))

            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
            return {
                "crm_id": new_lead_id,
                "entity_type": "lead",
                "status": "created",
                "attributes": lead_data,
                "created_at": now_iso,
                "updated_at": now_iso,
                "latency_ms": elapsed_ms,
                "mock_adapter": True,
            }
        else:
            # In-memory local fallback
            async with self._local_lock:
                org_leads = self._local_leads.setdefault(org_str, {})
                org_emails = self._local_emails.setdefault(org_str, {})

                if email and email in org_emails:
                    existing_id = org_emails[email]
                    existing_lead = org_leads[existing_id]
                    existing_lead["attributes"].update(lead_data)
                    existing_lead["updated_at"] = now_iso

                    elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
                    return {
                        "crm_id": existing_id,
                        "entity_type": "lead",
                        "status": "already_exists",
                        "attributes": existing_lead["attributes"],
                        "created_at": existing_lead["created_at"],
                        "updated_at": now_iso,
                        "latency_ms": elapsed_ms,
                        "mock_adapter": True,
                    }

                new_lead_id = f"crm_lead_{uuid.uuid4().hex[:12]}"
                if email:
                    org_emails[email] = new_lead_id

                lead_record = {
                    "crm_id": new_lead_id,
                    "organization_id": org_str,
                    "entity_type": "lead",
                    "email": email,
                    "company": company,
                    "attributes": lead_data,
                    "created_at": now_iso,
                    "updated_at": now_iso,
                }
                org_leads[new_lead_id] = lead_record

                elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
                return {
                    "crm_id": new_lead_id,
                    "entity_type": "lead",
                    "status": "created",
                    "attributes": lead_data,
                    "created_at": now_iso,
                    "updated_at": now_iso,
                    "latency_ms": elapsed_ms,
                    "mock_adapter": True,
                }

    async def get_lead(self, organization_id: str, lead_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves a single lead by ID, strictly respecting organization isolation."""
        org_str = str(organization_id)
        redis = await self._get_redis()

        if redis:
            raw = await redis.hget(f"mock_crm:{org_str}:leads", lead_id)
            if raw:
                return json.loads(raw)
            return None
        else:
            async with self._local_lock:
                return self._local_leads.get(org_str, {}).get(lead_id)

    async def search_leads(self, organization_id: str, query: str) -> List[Dict[str, Any]]:
        """Searches leads within the organization by email or company."""
        org_str = str(organization_id)
        q = query.strip().lower()
        redis = await self._get_redis()

        leads: List[Dict[str, Any]] = []

        if redis:
            all_raw = await redis.hgetall(f"mock_crm:{org_str}:leads")
            for raw_val in all_raw.values():
                val = json.loads(raw_val)
                email = val.get("email", "")
                company = val.get("company", "")
                if q in email.lower() or q in company.lower():
                    leads.append(val)
        else:
            async with self._local_lock:
                for val in self._local_leads.get(org_str, {}).values():
                    email = val.get("email", "")
                    company = val.get("company", "")
                    if q in email.lower() or q in company.lower():
                        leads.append(val)

        return leads

    async def test_connection(
        self,
        organization_id: str,
        credentials: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Tests Mock CRM connectivity, measuring round-trip latency."""
        start_time = time.perf_counter()
        redis = await self._get_redis()

        if redis:
            try:
                await redis.ping()
                status = "healthy"
                msg = "Connected to Mock CRM storage (Redis persistent cluster)"
            except Exception as e:
                status = "degraded"
                msg = f"Connected to Mock CRM in-memory fallback: {str(e)}"
        else:
            status = "healthy"
            msg = "Connected to Mock CRM local simulated engine"

        elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
        return {
            "status": status,
            "latency_ms": max(elapsed_ms, 1.0),
            "message": msg,
            "tested_at": datetime.now(timezone.utc).isoformat(),
        }

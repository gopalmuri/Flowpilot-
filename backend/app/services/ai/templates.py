"""
Ready-made starting points shown on the Workflows page and used as the offline fallback when the AI provider is
unavailable. Every prompt only uses steps that exist in the step catalog, so each one produces a runnable flow.
"""

import re
from typing import List, Set

from app.schemas.workflow_ai import AITemplateSuggestion, AIWorkflowTemplate

TEMPLATES: List[AIWorkflowTemplate] = [
    AIWorkflowTemplate(
        id="tmpl_enterprise_lead",
        title="Enterprise Lead Qualification & Approval",
        description="Sort new leads by size with AI. Big accounts wait for a manager's approval before they reach the CRM and the sales team.",
        category="Sales",
        uses=["Webhook received", "AI sorts it", "If / else", "Ask a person to approve", "Add to CRM", "Slack"],
        prompt=(
            "Build a lead qualification flow: when a lead arrives by webhook, check that email and company are present, "
            "have AI classify it as enterprise, mid_market or smb, and if it is enterprise ask a manager to approve. "
            "After approval add it to the CRM as a lead and notify Slack channel #sales-alerts."
        ),
    ),
    AIWorkflowTemplate(
        id="tmpl_email_reply",
        title="Customer Email → AI Draft → Approved Reply",
        description="When a customer message arrives, AI reads it and drafts a reply. A manager reviews it before anything is sent.",
        category="Support",
        uses=["Message received", "AI reads & drafts a reply", "Ask a person to approve", "Send the approved reply"],
        prompt=(
            "When a customer message arrives, have AI analyze it and draft a reply, ask a manager to approve the draft, "
            "and when approved send the reply. If rejected, notify Slack channel #support so a person can follow up."
        ),
    ),
    AIWorkflowTemplate(
        id="tmpl_support_triage",
        title="Support Ticket Triage",
        description="AI sorts incoming requests into billing, technical, sales or general and alerts the right team.",
        category="Support",
        uses=["Webhook received", "AI sorts it", "If / else", "Slack"],
        prompt=(
            "Create a support triage flow: when a request arrives by webhook, have AI classify it as billing, technical, "
            "sales or general. If it is billing notify Slack #billing-team, otherwise notify Slack #support."
        ),
    ),
    AIWorkflowTemplate(
        id="tmpl_invoice_approval",
        title="Invoice Approval Over a Limit",
        description="Invoices above an amount need an owner's approval. Smaller ones are logged automatically.",
        category="Finance",
        uses=["Webhook received", "Check required details", "If / else", "Ask a person to approve", "Slack"],
        prompt=(
            "Create an invoice flow: when an invoice arrives by webhook, check that invoice_number and amount are present. "
            "If amount is greater than 50000 ask an owner to approve and then notify Slack #finance. "
            "If it is 50000 or less just notify Slack #finance that it was auto-logged."
        ),
    ),
    AIWorkflowTemplate(
        id="tmpl_contact_form",
        title="Website Form → CRM + Team Alert",
        description="AI pulls the name, company and need out of a free-text form and creates a CRM contact.",
        category="Sales",
        uses=["Webhook received", "AI pulls out key details", "Add to CRM", "Slack"],
        prompt=(
            "When a website contact form arrives by webhook, have AI extract name, company, email and what they need, "
            "create a contact in the CRM, and notify Slack channel #new-inquiries."
        ),
    ),
    AIWorkflowTemplate(
        id="tmpl_refund_request",
        title="Refund Request Approval",
        description="Refund requests are checked, sent to a manager for a decision, and the team is told the outcome.",
        category="Finance",
        uses=["Start manually", "Check required details", "Ask a person to approve", "Slack"],
        prompt=(
            "Create a refund flow: a person starts it manually with order_id and reason, check both are present, ask a "
            "manager to approve. If approved notify Slack #refunds that it is approved, if rejected notify Slack #refunds "
            "that it was declined."
        ),
    ),
    AIWorkflowTemplate(
        id="tmpl_incident_escalation",
        title="Urgent Incident Escalation",
        description="Critical alerts go straight to the incident channel and wait for a person to confirm the fix.",
        category="Operations",
        uses=["Webhook received", "If / else", "Slack", "Ask a person to approve"],
        prompt=(
            "Create an incident flow: when an alert arrives by webhook check if severity equals critical. If true alert "
            "Slack #incident-room and ask an admin to approve the resolution; if false notify Slack #monitoring."
        ),
    ),
    AIWorkflowTemplate(
        id="tmpl_access_request",
        title="Access / Purchase Request",
        description="Staff submit a request, a manager approves it, and the team channel is notified.",
        category="Operations",
        uses=["Start manually", "Check required details", "Ask a person to approve", "Slack"],
        prompt=(
            "Create a request flow: a person starts it manually with requester, item and justification, check all three are "
            "present, ask a manager to approve within 48 hours, then notify Slack #ops-requests with the result."
        ),
    ),
]

DEFAULT_TEMPLATE_SUGGESTIONS: List[AITemplateSuggestion] = [
    AITemplateSuggestion(id=t.id, title=t.title, description=t.description, prompt=t.prompt) for t in TEMPLATES
]

_WORD = re.compile(r"[a-z]{3,}")
_STOP: Set[str] = {"the", "and", "for", "with", "when", "that", "this", "then", "from", "have", "has", "are", "can", "will"}


def _tokens(text: str) -> Set[str]:
    return {w for w in _WORD.findall(text.lower()) if w not in _STOP}


def match_templates(prompt: str, limit: int = 3) -> List[AITemplateSuggestion]:
    """Offline fallback: rank templates by word overlap with the user's request."""
    wanted = _tokens(prompt)
    scored = []
    for t in TEMPLATES:
        overlap = len(wanted & _tokens(f"{t.title} {t.description} {t.category} {' '.join(t.uses)}"))
        scored.append((overlap, t))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [
        AITemplateSuggestion(id=t.id, title=t.title, description=t.description, prompt=t.prompt)
        for _, t in scored[:limit]
    ]

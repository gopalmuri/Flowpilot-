from celery import Celery
from celery.signals import after_setup_logger, after_setup_task_logger, worker_ready
from kombu import Queue

from app.core.config import settings
from app.core.logging import harden_logging

celery_app = Celery(
    "flowpilot_worker",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
)

# Define task queues
celery_app.conf.task_queues = (
    Queue("default", routing_key="default"),
    Queue("workflows", routing_key="workflows"),
    Queue("webhooks", routing_key="webhooks"),
    Queue("maintenance", routing_key="maintenance"),
    Queue("outbound", routing_key="outbound"),
    Queue("gmail", routing_key="gmail"),
)

celery_app.conf.task_default_queue = "default"

# Task routing
celery_app.conf.task_routes = {
    "tasks.execute_workflow_run": {"queue": "workflows"},
    "tasks.resume_workflow_run": {"queue": "workflows"},
    "tasks.process_webhook_event": {"queue": "webhooks"},
    "tasks.health_check": {"queue": "maintenance"},
    "tasks.recover_stalled_approvals": {"queue": "maintenance"},
    "tasks.deliver_outbound": {"queue": "outbound"},
    "tasks.dispatch_outbound_deliveries": {"queue": "outbound"},
    "tasks.recover_stale_deliveries": {"queue": "maintenance"},
    "tasks.sync_gmail_mailbox": {"queue": "gmail"},
    "tasks.sync_due_gmail_mailboxes": {"queue": "gmail"},
    "tasks.renew_gmail_watches": {"queue": "gmail"},
    "tasks.scheduler_heartbeat": {"queue": "maintenance"},
}

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_soft_time_limit=240,
    task_time_limit=300,
    task_always_eager=getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False),
    task_eager_propagates=True,
)

# Periodic work needs exactly ONE `celery beat` process (see docker-compose celery_beat). The worker_ready hook below
# also runs recovery once at worker start, so a restart never waits for the next tick.
celery_app.conf.beat_schedule = {
    "recover-stalled-approvals": {"task": "tasks.recover_stalled_approvals", "schedule": 120.0},
    "dispatch-outbound-deliveries": {"task": "tasks.dispatch_outbound_deliveries", "schedule": 15.0},
    "recover-stale-deliveries": {"task": "tasks.recover_stale_deliveries", "schedule": 60.0},
    "sync-due-gmail-mailboxes": {"task": "tasks.sync_due_gmail_mailboxes", "schedule": 30.0},
    "renew-gmail-watches": {"task": "tasks.renew_gmail_watches", "schedule": 1800.0},
    "scheduler-heartbeat": {"task": "tasks.scheduler_heartbeat", "schedule": 30.0},
}


@after_setup_logger.connect
@after_setup_task_logger.connect
def _harden_celery_logging(logger=None, **kwargs):
    """Worker and beat logs get the same credential redaction as the API process."""
    harden_logging(logger)


@worker_ready.connect
def _recover_on_worker_start(sender=None, **kwargs):
    """After a worker (re)start, immediately look for decisions whose resume was lost."""
    celery_app.send_task("tasks.recover_stalled_approvals", kwargs={"older_than_seconds": 60})
    celery_app.send_task("tasks.recover_stale_deliveries")


# Auto-import tasks from app.workers.tasks
celery_app.autodiscover_tasks(["app.workers"])


@celery_app.task(name="tasks.health_check")
def health_check_task():
    """Celery worker diagnostic health check task."""
    return {"status": "ok", "worker": "celery", "message": "Worker is healthy and ready"}

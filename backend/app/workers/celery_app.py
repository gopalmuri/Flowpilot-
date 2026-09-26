from celery import Celery
from kombu import Queue
from app.core.config import settings

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
)

celery_app.conf.task_default_queue = "default"

# Task routing
celery_app.conf.task_routes = {
    "tasks.execute_workflow_run": {"queue": "workflows"},
    "tasks.resume_workflow_run": {"queue": "workflows"},
    "tasks.process_webhook_event": {"queue": "webhooks"},
    "tasks.health_check": {"queue": "maintenance"},
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

# Auto-import tasks from app.workers.tasks
celery_app.autodiscover_tasks(["app.workers"])


@celery_app.task(name="tasks.health_check")
def health_check_task():
    """Celery worker diagnostic health check task."""
    return {"status": "ok", "worker": "celery", "message": "Worker is healthy and ready"}

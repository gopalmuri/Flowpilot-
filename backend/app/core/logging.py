import logging
import sys
from app.core.config import settings

def setup_logging():
    log_level = logging.DEBUG if settings.DEBUG else logging.INFO
    log_format = "%(asctime)s [%(levelname)s] %(name)s (%(correlation_id)s): %(message)s"
    
    # Custom filter to provide correlation_id if missing
    class CorrelationIdFilter(logging.Filter):
        def filter(self, record):
            if not hasattr(record, "correlation_id"):
                record.correlation_id = "system"
            return True

    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(log_level)
    handler.addFilter(CorrelationIdFilter())
    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s [%(correlation_id)s]: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )
    handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)
    root_logger.handlers = [handler]

    # Silence verbose third-party loggers
    logging.getLogger("uvicorn.access").handlers = [handler]
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

logger = logging.getLogger("flowpilot")

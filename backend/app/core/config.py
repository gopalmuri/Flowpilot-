import os
from pathlib import Path
from typing import List, Optional, Union
from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Automatically find project root .env
current_file = Path(__file__).resolve()
project_root_env = current_file.parents[3] / ".env"
backend_root_env = current_file.parents[2] / ".env"

DEFAULT_DEV_SECRET = "default-secret-key-change-in-production-32chars"
DEFAULT_DEV_JWT_SECRET = "default-jwt-secret-key-change-in-production"
DEFAULT_DEV_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(project_root_env), str(backend_root_env), ".env"),
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore"
    )

    # Core Application
    PROJECT_NAME: str = "FlowPilot"
    VERSION: str = "1.0.0"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True
    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str = DEFAULT_DEV_SECRET
    ENCRYPTION_KEY: str = DEFAULT_DEV_ENCRYPTION_KEY

    # Security & HTTPS
    FORCE_HTTPS: bool = False
    RATE_LIMIT_ENABLED: bool = True

    # CORS
    ALLOWED_CORS_ORIGINS: Union[str, List[str]] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
    ]

    @field_validator("ALLOWED_CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",") if i.strip()]
        elif isinstance(v, list):
            return v
        return []

    # Database (PostgreSQL)
    POSTGRES_HOST: str = "127.0.0.1"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str = "flowpilot"
    POSTGRES_USER: str = "flowpilot_admin"
    POSTGRES_PASSWORD: str = "flowpilot_secret_password"
    DATABASE_URL: str = (
        "postgresql+asyncpg://flowpilot_admin:flowpilot_secret_password@127.0.0.1:5432/flowpilot"
    )
    SYNC_DATABASE_URL: str = (
        "postgresql://flowpilot_admin:flowpilot_secret_password@127.0.0.1:5432/flowpilot"
    )

    # Redis & Celery
    REDIS_HOST: str = "127.0.0.1"
    REDIS_PORT: int = 6379
    REDIS_URL: str = "redis://127.0.0.1:6379/0"
    CELERY_BROKER_URL: str = "redis://127.0.0.1:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://127.0.0.1:6379/2"
    CELERY_TASK_TIMEOUT_SECONDS: int = 300
    CELERY_TASK_ALWAYS_EAGER: bool = False

    # JWT Authentication
    JWT_SECRET: str = DEFAULT_DEV_JWT_SECRET
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # AI Service Configuration (Phase 9)
    AI_PROVIDER: str = "mock"
    OPENAI_API_KEY: Optional[str] = None
    ANTHROPIC_API_KEY: Optional[str] = None
    AI_DEFAULT_MODEL: str = "gpt-4o-mini"
    AI_REQUEST_TIMEOUT_SECONDS: float = 10.0

    @model_validator(mode="after")
    def assemble_urls(self) -> "Settings":
        """
        Dynamically adjust database and redis connection strings when
        POSTGRES_HOST or REDIS_HOST are customized (e.g. inside Docker network).
        """
        if self.POSTGRES_HOST != "127.0.0.1":
            if "127.0.0.1" in self.DATABASE_URL:
                self.DATABASE_URL = self.DATABASE_URL.replace("127.0.0.1", self.POSTGRES_HOST)
            if "127.0.0.1" in self.SYNC_DATABASE_URL:
                self.SYNC_DATABASE_URL = self.SYNC_DATABASE_URL.replace("127.0.0.1", self.POSTGRES_HOST)
        if self.REDIS_HOST != "127.0.0.1":
            if "127.0.0.1" in self.REDIS_URL:
                self.REDIS_URL = self.REDIS_URL.replace("127.0.0.1", self.REDIS_HOST)
            if "127.0.0.1" in self.CELERY_BROKER_URL:
                self.CELERY_BROKER_URL = self.CELERY_BROKER_URL.replace("127.0.0.1", self.REDIS_HOST)
            if "127.0.0.1" in self.CELERY_RESULT_BACKEND:
                self.CELERY_RESULT_BACKEND = self.CELERY_RESULT_BACKEND.replace("127.0.0.1", self.REDIS_HOST)
        return self

    @model_validator(mode="after")
    def validate_production_security(self) -> "Settings":
        """
        Validates security settings in production:
        1. Refuses default development secrets.
        2. Refuses DEBUG=True.
        3. Refuses insecure or wildcard CORS origins.
        """
        if self.ENVIRONMENT.lower() == "production":
            if not self.SECRET_KEY or self.SECRET_KEY == DEFAULT_DEV_SECRET or len(self.SECRET_KEY) < 32:
                raise ValueError("FATAL: Production SECRET_KEY must be a cryptographically secure string of at least 32 characters")
            if not self.JWT_SECRET or self.JWT_SECRET == DEFAULT_DEV_JWT_SECRET or len(self.JWT_SECRET) < 32:
                raise ValueError("FATAL: Production JWT_SECRET must be a cryptographically secure string of at least 32 characters")
            if self.DEBUG:
                raise ValueError("FATAL: DEBUG mode must be disabled (DEBUG=False) in production")
            if isinstance(self.ALLOWED_CORS_ORIGINS, list):
                for origin in self.ALLOWED_CORS_ORIGINS:
                    if origin == "*":
                        raise ValueError("FATAL: Wildcard CORS origin '*' is strictly prohibited in production")
                    if "localhost" in origin or "127.0.0.1" in origin:
                        raise ValueError(f"FATAL: Localhost CORS origin '{origin}' is prohibited in production")
        return self


settings = Settings()

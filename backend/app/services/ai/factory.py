from typing import Optional
from app.core.config import settings
from app.services.ai.anthropic_provider import AnthropicProvider
from app.services.ai.base import BaseAIProvider
from app.services.ai.mock_provider import MockAIProvider
from app.services.ai.openai_provider import OpenAIProvider


class AIProviderFactory:
    """
    Factory for instantiating AI providers with deterministic configuration precedence.
    Precedence:
    1. Step configuration (explicit provider requested)
    2. Environment configuration (settings.AI_PROVIDER)
    3. Mock provider default
    """

    @classmethod
    def get_provider(
        cls,
        provider_name: Optional[str] = None,
        api_key: Optional[str] = None,
    ) -> BaseAIProvider:
        # Resolve provider name following precedence rules
        selected = (provider_name or "").strip().lower()
        if not selected:
            selected = (settings.AI_PROVIDER or "").strip().lower()
        if not selected:
            selected = "mock"

        if selected == "mock":
            return MockAIProvider()
        elif selected == "openai":
            key = api_key or settings.OPENAI_API_KEY
            return OpenAIProvider(api_key=key)
        elif selected == "anthropic":
            key = api_key or settings.ANTHROPIC_API_KEY
            return AnthropicProvider(api_key=key)
        else:
            raise ValueError(
                f"Unsupported AI provider '{selected}'. Supported providers: ['mock', 'openai', 'anthropic']"
            )

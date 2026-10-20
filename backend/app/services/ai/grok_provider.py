from typing import Optional

from app.core.config import settings
from app.schemas.ai import AIProviderConfig
from app.services.ai.openai_provider import OpenAIProvider


class GrokProvider(OpenAIProvider):
    """
    Grok (xAI) provider. xAI exposes an OpenAI-compatible chat-completions API, so this reuses the
    OpenAI provider's transport and error sanitising (zero secret exposure).

    The model is never guessed: it comes only from GROK_MODEL. A step-level `model` is ignored
    because the platform default (AI_DEFAULT_MODEL) is an OpenAI model name and would be wrong here.
    """

    PROVIDER_NAME = "grok"
    LABEL = "Grok"

    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None, model: Optional[str] = None):
        super().__init__(api_key=api_key)
        self._base_url = (base_url or settings.GROK_BASE_URL).rstrip("/")
        self._model = model or settings.GROK_MODEL
        self.API_URL = f"{self._base_url}/chat/completions"

    def resolve_model(self, config: AIProviderConfig) -> str:
        if not self._model or not self._model.strip():
            raise ValueError("Grok model is not configured (set GROK_MODEL)")
        return self._model.strip()

import logging
import time
from typing import Any, Dict, List, Optional

import httpx

from app.core.config import settings
from app.schemas.ai import AIProviderConfig, LeadClassificationInput
from app.services.ai.base import AIProviderResponse, BaseAIProvider
from app.services.ai.openai_provider import OpenAIProvider

logger = logging.getLogger(__name__)


class GrokProvider(OpenAIProvider):
    """
    Grok (xAI) provider. xAI exposes an OpenAI-compatible chat-completions API,
    so this reuses the OpenAI provider's transport and error sanitising.
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


class GroqProvider(BaseAIProvider):
    """
    Groq provider with automatic key rotation fallback.

    Tries API keys in order (1→2→3→4). On authentication errors (401/403) or
    rate limits (429), the next key is tried. Other errors are raised immediately.
    Zero secret exposure: keys are never logged or included in error messages.
    """

    PROVIDER_NAME = "groq"
    LABEL = "Groq"


    def __init__(self, api_keys: Optional[List[str]] = None, base_url: Optional[str] = None, model: Optional[str] = None):
        # Collect all non-empty keys, preserving order
        if api_keys:
            self._api_keys = [k for k in api_keys if k and k.strip()]
        else:
            self._api_keys = [
                k for k in [
                    settings.GROQ_API_KEY_1,
                    settings.GROQ_API_KEY_2,
                    settings.GROQ_API_KEY_3,
                    settings.GROQ_API_KEY_4,
                ] if k and k.strip()
            ]
        self._base_url = (base_url or settings.GROQ_BASE_URL).rstrip("/")
        self._model = model or settings.GROQ_MODEL
        self._api_url = f"{self._base_url}/chat/completions"

    def _require_keys(self) -> List[str]:
        if not self._api_keys:
            raise ValueError("No Groq API keys configured. Set GROQ_API_KEY_1 (through _4) in .env")
        return self._api_keys

    async def _chat_with_fallback(self, payload: Dict[str, Any], timeout_seconds: float) -> Dict[str, Any]:
        """
        Try each API key in order. On 401/403/429, rotate to the next key.
        Other errors are raised immediately.
        """
        keys = self._require_keys()
        last_error: Optional[Exception] = None

        for idx, key in enumerate(keys, start=1):
            headers = {
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            }
            try:
                async with httpx.AsyncClient(timeout=timeout_seconds) as client:
                    response = await client.post(self._api_url, json=payload, headers=headers)
                    response.raise_for_status()
                    return response.json()
            except httpx.HTTPStatusError as e:
                status_code = e.response.status_code if e.response else 500
                if status_code in (401, 403, 429) and idx < len(keys):
                    # Rotatable error — try next key
                    logger.warning("Groq key #%d hit HTTP %d, rotating to next key", idx, status_code)
                    last_error = e
                    continue
                # Final key or non-rotatable error
                if status_code == 429:
                    raise RuntimeError(f"Groq rate limit reached on all keys (HTTP {status_code})") from None
                elif status_code in (401, 403):
                    raise RuntimeError(f"Groq authentication failed on all keys (HTTP {status_code})") from None
                raise RuntimeError(f"Groq API returned HTTP {status_code}") from None
            except httpx.TimeoutException:
                raise TimeoutError(f"Groq request timed out after {timeout_seconds}s") from None
            except httpx.RequestError as e:
                raise RuntimeError(f"Groq network request error: {type(e).__name__}") from None

        # Should not reach here, but safety net
        raise RuntimeError("Groq: all API keys exhausted") from last_error

    async def classify(
        self,
        input_data: LeadClassificationInput,
        config: AIProviderConfig,
    ) -> AIProviderResponse:
        import json

        start_time = time.monotonic()
        model = self._model

        system_prompt = (
            "You are an expert B2B lead classification engine. Analyze the provided lead and return "
            "a JSON object with keys: 'category', 'priority', 'confidence', 'reasoning', and 'suggested_action'.\n"
            f"Allowed categories: {json.dumps(input_data.categories)}\n"
            "Allowed priorities: ['low', 'medium', 'high', 'urgent']\n"
            "Confidence must be a float between 0.0 and 1.0.\n"
            "Reasoning must be concise and application-facing (do not output private chain-of-thought)."
        )
        user_prompt = f"Lead Content:\n{input_data.text}"
        if input_data.context:
            user_prompt += f"\nAdditional Context:\n{json.dumps(input_data.context)}"

        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": config.temperature,
            "max_tokens": config.max_tokens,
            "response_format": {"type": "json_object"},
        }

        data = await self._chat_with_fallback(payload, config.timeout_seconds)

        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as e:
            raise ValueError(f"Groq response missing choice content: {type(e).__name__}") from None

        usage = data.get("usage") or {}
        prompt_tokens = usage.get("prompt_tokens", 0)
        completion_tokens = usage.get("completion_tokens", 0)
        total_tokens = usage.get("total_tokens", prompt_tokens + completion_tokens)

        return AIProviderResponse(
            raw_output=content,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            provider=self.PROVIDER_NAME,
            model=model,
            latency_ms=max(1, int((time.monotonic() - start_time) * 1000)),
        )

    async def generate_json(
        self,
        system_prompt: str,
        user_prompt: str,
        config: AIProviderConfig,
    ) -> AIProviderResponse:
        start_time = time.monotonic()
        model = self._model
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": config.temperature,
            "max_tokens": config.max_tokens,
            "response_format": {"type": "json_object"},
        }

        data = await self._chat_with_fallback(payload, config.timeout_seconds)

        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as e:
            raise ValueError(f"Groq response missing choice content: {type(e).__name__}") from None

        usage = data.get("usage") or {}
        prompt_tokens = usage.get("prompt_tokens", 0)
        completion_tokens = usage.get("completion_tokens", 0)
        total_tokens = usage.get("total_tokens", prompt_tokens + completion_tokens)

        return AIProviderResponse(
            raw_output=content,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            provider=self.PROVIDER_NAME,
            model=model,
            latency_ms=max(1, int((time.monotonic() - start_time) * 1000)),
        )





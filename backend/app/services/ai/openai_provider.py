import json
import time
from typing import Any, Dict, Optional

import httpx

from app.schemas.ai import AIProviderConfig, LeadClassificationInput
from app.services.ai.base import AIProviderResponse, BaseAIProvider


class OpenAIProvider(BaseAIProvider):
    """
    OpenAI provider implementation using async HTTPX.
    Also the base for OpenAI-compatible providers (e.g. Grok) via PROVIDER_NAME, LABEL, API_URL
    and resolve_model().
    Enforces strict zero-secret-exposure: API key is never logged, exposed in
    exceptions, or included in outgoing error strings.
    """

    DEFAULT_MODEL = "gpt-4o-mini"
    API_URL = "https://api.openai.com/v1/chat/completions"
    PROVIDER_NAME = "openai"
    LABEL = "OpenAI"

    def __init__(self, api_key: Optional[str] = None):
        self._api_key = api_key

    def resolve_model(self, config: AIProviderConfig) -> str:
        return config.model or self.DEFAULT_MODEL

    async def _chat(self, key: str, payload: Dict[str, Any], timeout_seconds: float) -> Dict[str, Any]:
        """POST a chat-completions payload and return the decoded body with sanitised errors."""
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }
        try:
            async with httpx.AsyncClient(timeout=timeout_seconds) as client:
                response = await client.post(self.API_URL, json=payload, headers=headers)
                response.raise_for_status()
                return response.json()
        except httpx.HTTPStatusError as e:
            status_code = e.response.status_code if e.response else 500
            # Sanitize exception message: zero secret exposure
            if status_code == 429:
                raise RuntimeError(f"{self.LABEL} rate limit reached (HTTP {status_code})") from None
            elif status_code in (401, 403):
                raise RuntimeError(f"{self.LABEL} authentication failed (HTTP {status_code})") from None
            raise RuntimeError(f"{self.LABEL} API returned HTTP {status_code}") from None
        except httpx.TimeoutException:
            raise TimeoutError(f"{self.LABEL} request timed out after {timeout_seconds}s") from None
        except httpx.RequestError as e:
            # Mask any URLs/headers that might leak credentials
            raise RuntimeError(f"{self.LABEL} network request error: {type(e).__name__}") from None

    def _to_response(self, data: Dict[str, Any], model: str, start_time: float) -> AIProviderResponse:
        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as e:
            raise ValueError(f"{self.LABEL} response missing choice content: {type(e).__name__}") from None

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

    def _require_key(self, config: AIProviderConfig) -> str:
        key = self._api_key or config.api_key
        if not key or not key.strip():
            raise ValueError(f"{self.LABEL} API key is not configured or missing")
        return key

    async def classify(
        self,
        input_data: LeadClassificationInput,
        config: AIProviderConfig,
    ) -> AIProviderResponse:
        start_time = time.monotonic()
        key = self._require_key(config)

        model = self.resolve_model(config)
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
        data = await self._chat(key, payload, config.timeout_seconds)
        return self._to_response(data, model, start_time)

    async def generate_json(
        self,
        system_prompt: str,
        user_prompt: str,
        config: AIProviderConfig,
    ) -> AIProviderResponse:
        start_time = time.monotonic()
        key = self._require_key(config)
        model = self.resolve_model(config)
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
        data = await self._chat(key, payload, config.timeout_seconds)
        return self._to_response(data, model, start_time)

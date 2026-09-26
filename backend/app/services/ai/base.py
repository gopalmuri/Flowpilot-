from abc import ABC, abstractmethod
from dataclasses import dataclass
from app.schemas.ai import AIProviderConfig, LeadClassificationInput


@dataclass
class AIProviderResponse:
    raw_output: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    provider: str = "mock"
    model: str = "mock-model"
    latency_ms: int = 0


class BaseAIProvider(ABC):
    """
    Abstract base class for all AI providers.
    Exposes a provider-independent interface. WorkflowEngine and executors
    must not contain provider-specific HTTP/API logic.
    """

    @abstractmethod
    async def classify(
        self,
        input_data: LeadClassificationInput,
        config: AIProviderConfig,
    ) -> AIProviderResponse:
        """
        Classifies input text according to candidate categories.
        Must return normalized AIProviderResponse with raw string output and usage metrics.
        """
        pass

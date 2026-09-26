from typing import Dict, Type
from app.engine.base import BaseStepExecutor
from app.engine.executors import (
    AIClassificationExecutor,
    ConditionRuleExecutor,
    HumanApprovalExecutor,
    MockAIClassificationExecutor,
    MockCRMCreateExecutor,
    MockSlackNotificationExecutor,
    TriggerExecutor,
    ValidateDataExecutor,
)
from app.schemas.workflow import StepType

STEP_EXECUTOR_REGISTRY: Dict[str, Type[BaseStepExecutor]] = {
    StepType.WEBHOOK_TRIGGER.value: TriggerExecutor,
    StepType.MANUAL_TRIGGER.value: TriggerExecutor,
    StepType.VALIDATE_DATA.value: ValidateDataExecutor,
    StepType.CONDITION.value: ConditionRuleExecutor,
    StepType.MOCK_CRM_CREATE.value: MockCRMCreateExecutor,
    StepType.SLACK_NOTIFICATION.value: MockSlackNotificationExecutor,
    StepType.AI_CLASSIFICATION.value: AIClassificationExecutor,
    StepType.HUMAN_APPROVAL.value: HumanApprovalExecutor,
}


def get_step_executor(step_type: str) -> BaseStepExecutor:
    """
    Retrieves and instantiates the registered step executor for a given step_type.
    Raises ValueError if step_type is not registered.
    """
    executor_cls = STEP_EXECUTOR_REGISTRY.get(step_type)
    if not executor_cls:
        raise ValueError(
            f"Unsupported step_type '{step_type}'. Registered types: {list(STEP_EXECUTOR_REGISTRY.keys())}"
        )
    return executor_cls()

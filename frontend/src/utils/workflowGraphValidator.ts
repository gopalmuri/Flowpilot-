import { Node, Edge } from '@xyflow/react';
import { StepType, WorkflowValidationResult } from '../types/workflow';

export interface WorkflowNodeData {
  step_key: string;
  step_type: StepType | string;
  name: string;
  config: Record<string, any>;
  [key: string]: any;
}

export interface WorkflowEdgeData {
  condition_label?: string | null;
  [key: string]: any;
}

export const APPROVED_STEP_TYPES: Set<string> = new Set([
  StepType.WEBHOOK_TRIGGER,
  StepType.MANUAL_TRIGGER,
  StepType.VALIDATE_DATA,
  StepType.AI_CLASSIFICATION,
  StepType.CONDITION,
  StepType.MOCK_CRM_CREATE,
  StepType.SLACK_NOTIFICATION,
  StepType.HUMAN_APPROVAL,
]);

export const TRIGGER_STEP_TYPES: Set<string> = new Set([
  StepType.WEBHOOK_TRIGGER,
  StepType.MANUAL_TRIGGER,
]);

export function validateStepConfig(
  stepKey: string,
  stepType: string,
  config: Record<string, any>
): string[] {
  const errors: string[] = [];
  const cfg = config || {};

  if (stepType === StepType.AI_CLASSIFICATION) {
    if (!cfg.prompt && (!cfg.categories || cfg.categories.length === 0)) {
      errors.push(`Step '${stepKey}' (${stepType}) requires 'prompt' or 'categories' in configuration`);
    }
  } else if (stepType === StepType.SLACK_NOTIFICATION) {
    if (!cfg.channel && !cfg.message && !cfg.webhook_url) {
      errors.push(`Step '${stepKey}' (${stepType}) requires 'channel', 'message', or 'webhook_url' in configuration`);
    }
  } else if (stepType === StepType.CONDITION) {
    if (!cfg.conditions && !cfg.expression && !cfg.field) {
      errors.push(`Step '${stepKey}' (${stepType}) requires 'conditions', 'expression', or 'field' in configuration`);
    }
  } else if (stepType === StepType.MOCK_CRM_CREATE) {
    if (!cfg.entity_type && !cfg.mapping) {
      errors.push(`Step '${stepKey}' (${stepType}) requires 'entity_type' or 'mapping' in configuration`);
    }
  } else if (stepType === StepType.VALIDATE_DATA) {
    if (!cfg.schema && !cfg.rules && (!cfg.required_fields || cfg.required_fields.length === 0)) {
      errors.push(`Step '${stepKey}' (${stepType}) requires 'schema', 'rules', or 'required_fields' in configuration`);
    }
  } else if (stepType === StepType.HUMAN_APPROVAL) {
    if (!cfg.approver_role && !cfg.title && !cfg.timeout_hours) {
      errors.push(`Step '${stepKey}' (${stepType}) requires 'approver_role', 'title', or 'timeout_hours' in configuration`);
    }
  }

  return errors;
}

export function validateWorkflowGraph(
  nodes: Node<WorkflowNodeData>[],
  edges: Edge<WorkflowEdgeData>[]
): WorkflowValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (nodes.length === 0) {
    return {
      valid: false,
      errors: ['Workflow must contain at least one step'],
      warnings: [],
    };
  }

  const stepKeys = new Set<string>();
  const stepKeyToId = new Map<string, string>();
  const idToStepKey = new Map<string, string>();
  const triggers: string[] = [];

  for (const node of nodes) {
    const data = node.data;
    const key = data.step_key;
    const stype = data.step_type;

    if (!key || key.trim() === '') {
      errors.push(`Node '${node.id}' is missing required 'step_key'`);
      continue;
    }

    if (stepKeys.has(key)) {
      errors.push(`Duplicate step_key detected: '${key}'`);
    }
    stepKeys.add(key);
    stepKeyToId.set(key, node.id);
    idToStepKey.set(node.id, key);

    if (!APPROVED_STEP_TYPES.has(stype)) {
      errors.push(`Step '${key}' specifies invalid step_type: '${stype}'`);
    } else if (TRIGGER_STEP_TYPES.has(stype)) {
      triggers.push(key);
    }

    const configErrors = validateStepConfig(key, stype, data.config);
    errors.push(...configErrors);
  }

  // Trigger Cardinality
  if (triggers.length === 0) {
    errors.push('Workflow must contain exactly one trigger step (WEBHOOK_TRIGGER or MANUAL_TRIGGER)');
  } else if (triggers.length > 1) {
    errors.push(
      `Workflow contains ${triggers.length} trigger steps (${triggers.join(', ')}); exactly one trigger is permitted`
    );
  }

  // Connections
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();

  for (const k of stepKeys) {
    adj.set(k, []);
    inDegree.set(k, 0);
    outDegree.set(k, 0);
  }

  for (const edge of edges) {
    const srcKey = idToStepKey.get(edge.source);
    const tgtKey = idToStepKey.get(edge.target);

    if (!srcKey || !tgtKey) {
      errors.push(`Edge connects unknown step: '${edge.source}' -> '${edge.target}'`);
      continue;
    }

    if (srcKey === tgtKey) {
      errors.push(`Self-referencing loop detected on step '${srcKey}'`);
      continue;
    }

    if (triggers.includes(tgtKey)) {
      errors.push(`Trigger step '${tgtKey}' cannot be the target of a connection`);
    }

    adj.get(srcKey)?.push(tgtKey);
    inDegree.set(tgtKey, (inDegree.get(tgtKey) || 0) + 1);
    outDegree.set(srcKey, (outDegree.get(srcKey) || 0) + 1);
  }

  // Reachability
  if (triggers.length === 1) {
    const root = triggers[0];
    const reachable = new Set<string>();
    const queue = [root];

    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (!reachable.has(curr)) {
        reachable.add(curr);
        const neighbors = adj.get(curr) || [];
        for (const n of neighbors) {
          if (!reachable.has(n)) {
            queue.push(n);
          }
        }
      }
    }

    for (const k of stepKeys) {
      if (!reachable.has(k)) {
        errors.push(`Step '${k}' is not reachable from the trigger node`);
      }
    }
  }

  // Cycle Detection (Kahn's Algorithm)
  const inDegreeCopy = new Map(inDegree);
  const zeroQueue = Array.from(stepKeys).filter((k) => (inDegreeCopy.get(k) || 0) === 0);
  let visitedCount = 0;

  while (zeroQueue.length > 0) {
    const curr = zeroQueue.shift()!;
    visitedCount++;

    const neighbors = adj.get(curr) || [];
    for (const n of neighbors) {
      const updated = (inDegreeCopy.get(n) || 0) - 1;
      inDegreeCopy.set(n, updated);
      if (updated === 0) {
        zeroQueue.push(n);
      }
    }
  }

  if (visitedCount < stepKeys.size) {
    errors.push('Workflow contains circular dependencies (cycles detected in DAG)');
  }

  // Warnings
  for (const node of nodes) {
    const key = node.data.step_key;
    if (node.data.step_type === StepType.CONDITION && (outDegree.get(key) || 0) < 2) {
      warnings.push(`Condition step '${key}' has fewer than 2 outgoing branch connections`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

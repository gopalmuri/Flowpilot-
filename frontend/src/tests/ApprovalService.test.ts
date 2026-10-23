import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as apiClient from '../services/apiClient';
import { listApprovals, normalizeApproval } from '../services/approvalService';
import { ApprovalApiResponse } from '../types/approval';

// Payload copied from a live GET /organizations/{id}/approvals response.
const backendApproval: ApprovalApiResponse = {
  id: '46389928-19ae-4c71-ac41-30d03ec82cf1',
  organization_id: '23f5eb34-7b77-492e-91b3-a41489384387',
  workflow_run_id: '667b5326-770b-42be-b75d-8bb42fcc71dd',
  step_id: 'e649d019-a666-4981-bf04-e4d071c464c5',
  status: 'PENDING',
  payload_snapshot: { step_key: 'manager_approval', trigger_payload: { company: 'Acme Corporation' } },
  reviewed_by: null,
  comment: null,
  resolved_at: null,
  created_at: '2026-10-16T15:27:52.217086Z',
  updated_at: '2026-10-16T15:27:52.217086Z',
  time_remaining_seconds: 3600,
  approver_role: 'OWNER',
  workflow_name: 'Enterprise Lead Intake Pipeline',
  step_key: 'manager_approval',
};

describe('approval API adapter', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('maps backend field names onto the UI model', () => {
    const a = normalizeApproval(backendApproval);
    expect(a.requested_at).toBe(backendApproval.created_at);
    expect(Number.isNaN(new Date(a.requested_at).getTime())).toBe(false);
    expect(a.required_role).toBe('OWNER');
    expect(a.context_snapshot).toEqual(backendApproval.payload_snapshot);
    expect(a.workflow_name).toBe('Enterprise Lead Intake Pipeline');
    expect(a.expires_at).not.toBeNull();
  });

  it('copes with missing optional fields', () => {
    const a = normalizeApproval({
      ...backendApproval,
      approver_role: null,
      time_remaining_seconds: null,
      step_key: null,
      comment: 'Looks good',
    });
    expect(a.required_role).toBeNull();
    expect(a.expires_at).toBeNull();
    expect(a.step_key).toBe('manager_approval'); // falls back to the snapshot
    expect(a.decision_comment).toBe('Looks good');
  });

  it('normalizes every item returned by listApprovals', async () => {
    vi.spyOn(apiClient, 'apiRequest').mockResolvedValue({
      items: [backendApproval],
      total: 1,
      page: 1,
      page_size: 20,
    });
    const res = await listApprovals('org-1', 'PENDING');
    expect(res.total).toBe(1);
    expect(res.items[0].requested_at).toBe(backendApproval.created_at);
  });
});

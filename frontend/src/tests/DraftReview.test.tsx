import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApprovalsPage } from '../pages/approvals/ApprovalsPage';
import * as AuthContextModule from '../context/AuthContext';
import * as ApprovalServiceModule from '../services/approvalService';
import { ApprovalRequest, ApprovalReview } from '../types/approval';

const mockOrg = {
  id: 'org-test-1',
  name: 'Acme Test Corp',
  slug: 'acme-test',
  role: 'MANAGER' as any,
  created_at: '2026-01-01T00:00:00Z',
};

const AI_TEXT = 'Hello Asha,\n\nThanks for reaching out. How many documents a month?\n\nThe Team';

const pendingDraftApproval: ApprovalRequest = {
  id: 'appr-draft-1',
  organization_id: 'org-test-1',
  workflow_run_id: 'run-draft-12345678',
  step_key: 'approve',
  status: 'PENDING',
  required_role: 'MANAGER',
  context_snapshot: {},
  requested_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 3600000).toISOString(),
  draft_id: 'draft-1',
  draft_status: 'PENDING_APPROVAL',
};

const baseReview = (overrides: Partial<ApprovalReview['draft']> = {}): ApprovalReview => ({
  approval_id: 'appr-draft-1',
  approval_status: 'PENDING',
  is_reapproval: false,
  message: {
    channel: 'PORTFOLIO_FORM',
    sender_name: 'Asha Rao',
    sender_address: 'asha@example.com',
    subject: 'AI project',
    text: 'We need a custom AI solution to process business documents.',
    received_at: '2026-10-17T10:00:00Z',
  },
  analysis: {
    category: 'new_project',
    summary: 'Prospect wants AI document processing.',
    requirements: ['Process business documents with AI'],
    missing_information: ['document volume', 'timeline'],
    urgency: 'medium',
    recommended_action: 'ask_clarification',
    confidence: 0.86,
    uncertainty_notes: null,
    injection_suspected: false,
    needs_human_attention: true,
    risk_flags: ['unverified_price'],
    is_fallback: false,
    provider: 'grok',
    model: 'grok-test',
  },
  draft: {
    id: 'draft-1',
    status: 'PENDING_APPROVAL',
    current_version: 1,
    approved_version: null,
    revision_instructions: null,
    decision_comment: null,
    decided_by: null,
    decided_at: null,
    risk_flags: ['unverified_price'],
    versions: [
      {
        version_number: 1,
        author_type: 'AI',
        content: AI_TEXT,
        content_hash: 'a'.repeat(64),
        created_at: '2026-10-17T10:00:05Z',
        is_approved: false,
      },
    ],
    ...overrides,
  },
});

const openReview = async () => {
  render(<ApprovalsPage />);
  await waitFor(() => expect(screen.getByText('approve')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /Review & Authorize/i }));
  await waitFor(() => expect(screen.getByTestId('draft-review-panel')).toBeInTheDocument());
};

describe('Reply draft approval UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'usr-1', email: 'm@acme.com', full_name: 'Manager', is_active: true, is_superuser: false, created_at: '2026-01-01T00:00:00Z' },
      organizations: [mockOrg],
      activeOrganization: mockOrg,
      activeRole: 'MANAGER',
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      switchOrganization: vi.fn(),
      refreshProfile: vi.fn(),
    });
    vi.spyOn(ApprovalServiceModule, 'listApprovals').mockImplementation(async (_o, status) => ({
      items: status === 'PENDING' ? [pendingDraftApproval] : [pendingDraftApproval],
      total: 1,
      page: 1,
      page_size: 20,
    }));
    vi.spyOn(ApprovalServiceModule, 'getApprovalReview').mockResolvedValue(baseReview());
    vi.spyOn(ApprovalServiceModule, 'approveRequest').mockResolvedValue({ ...pendingDraftApproval, status: 'APPROVED' });
    vi.spyOn(ApprovalServiceModule, 'rejectRequest').mockResolvedValue({ ...pendingDraftApproval, status: 'REJECTED' });
  });

  it('shows the original message, AI analysis, risk flags and the complete draft', async () => {
    await openReview();

    expect(screen.getByText(/We need a custom AI solution to process business documents\./)).toBeInTheDocument();
    expect(screen.getByText(/asha@example.com/)).toBeInTheDocument();
    expect(screen.getByText('AI project')).toBeInTheDocument();
    expect(screen.getByText('Prospect wants AI document processing.')).toBeInTheDocument();
    expect(screen.getByText('Process business documents with AI')).toBeInTheDocument();
    expect(screen.getByText('document volume')).toBeInTheDocument();
    expect(screen.getByText(/confidence: 86%/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/price not in the business profile/i);

    const textarea = screen.getByLabelText(/Text that will be authorised/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe(AI_TEXT);
    expect(screen.getByText(/Awaiting approval/i)).toBeInTheDocument();
    expect(screen.getByText(/AI-written/i)).toBeInTheDocument();
  });

  it('approves the unchanged AI draft bound to the reviewed version', async () => {
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: /Approve This Text/i }));

    await waitFor(() =>
      expect(ApprovalServiceModule.approveRequest).toHaveBeenCalledWith('org-test-1', 'appr-draft-1', {
        comment: undefined,
        reviewed_version: 1,
      })
    );
  });

  it('sends the edited text (and warns) when the manager changes the draft', async () => {
    await openReview();
    const textarea = screen.getByLabelText(/Text that will be authorised/i);
    fireEvent.change(textarea, { target: { value: 'Hello,\n\nMy own wording.\n\nThe Team' } });

    expect(screen.getByRole('status')).toHaveTextContent(/your edited version/i);
    fireEvent.click(screen.getByRole('button', { name: /Approve My Edited Version/i }));

    await waitFor(() =>
      expect(ApprovalServiceModule.approveRequest).toHaveBeenCalledWith('org-test-1', 'appr-draft-1', {
        comment: undefined,
        reviewed_version: 1,
        edited_content: 'Hello,\n\nMy own wording.\n\nThe Team',
      })
    );
  });

  it('rejects the draft with a reason', async () => {
    await openReview();
    fireEvent.change(screen.getByPlaceholderText(/Add audit rationale or context/i), {
      target: { value: 'Tone is off' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Reject Draft/i }));

    await waitFor(() =>
      expect(ApprovalServiceModule.rejectRequest).toHaveBeenCalledWith('org-test-1', 'appr-draft-1', {
        comment: 'Tone is off',
      })
    );
    expect(ApprovalServiceModule.approveRequest).not.toHaveBeenCalled();
  });

  it('saves a manual edit as a new version without approving', async () => {
    const edited = 'Hello,\n\nEdited.\n\nThe Team';
    const saved = baseReview({
      current_version: 2,
      versions: [
        ...baseReview().draft!.versions,
        { version_number: 2, author_type: 'HUMAN', content: edited, content_hash: 'b'.repeat(64), created_at: '2026-10-17T10:05:00Z', is_approved: false },
      ],
    });
    const save = vi.spyOn(ApprovalServiceModule, 'saveDraftEdit').mockResolvedValue(saved);

    await openReview();
    fireEvent.change(screen.getByLabelText(/Text that will be authorised/i), { target: { value: edited } });
    fireEvent.click(screen.getByRole('button', { name: /Save edit as new version/i }));

    await waitFor(() => expect(save).toHaveBeenCalledWith('org-test-1', 'appr-draft-1', edited, 1));
    await waitFor(() => expect(screen.getByText('(edited by a person)')).toBeInTheDocument());
    // The original AI draft stays visible and distinguishable in the history.
    fireEvent.click(screen.getByText(/Version history/i));
    expect(screen.getByText('AI draft')).toBeInTheDocument();
    expect(ApprovalServiceModule.approveRequest).not.toHaveBeenCalled();
  });

  it('requests a revision, then blocks approval until a new version exists', async () => {
    const revised = baseReview({ status: 'REVISION_REQUESTED', revision_instructions: 'Make it shorter' });
    const request = vi.spyOn(ApprovalServiceModule, 'requestDraftRevision').mockResolvedValue(revised);

    await openReview();
    fireEvent.change(screen.getByLabelText(/Request a revision/i), { target: { value: 'Make it shorter' } });
    fireEvent.click(screen.getByRole('button', { name: /^Request revision$/i }));

    await waitFor(() => expect(request).toHaveBeenCalledWith('org-test-1', 'appr-draft-1', 'Make it shorter'));
    await waitFor(() => expect(screen.getByText(/Revision requested:/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Regenerate with AI/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve This Text/i })).toBeDisabled();
    expect(ApprovalServiceModule.approveRequest).not.toHaveBeenCalled();
  });

  it('regenerates with AI against the current version', async () => {
    vi.spyOn(ApprovalServiceModule, 'getApprovalReview').mockResolvedValue(
      baseReview({ status: 'REVISION_REQUESTED', revision_instructions: 'Warmer tone' })
    );
    const regen = vi.spyOn(ApprovalServiceModule, 'regenerateDraft').mockResolvedValue(baseReview());

    await openReview();
    fireEvent.click(screen.getByRole('button', { name: /Regenerate with AI/i }));

    await waitFor(() => expect(regen).toHaveBeenCalledWith('org-test-1', 'appr-draft-1', 1));
  });

  it('shows the authorised text read-only with approver and time once approved', async () => {
    vi.spyOn(ApprovalServiceModule, 'getApprovalReview').mockResolvedValue({
      ...baseReview({
        status: 'APPROVED',
        approved_version: 1,
        decided_by: '11111111-2222-3333-4444-555555555555',
        decided_at: '2026-10-17T10:10:00Z',
        versions: [{ ...baseReview().draft!.versions[0], is_approved: true }],
      }),
      approval_status: 'APPROVED',
    });
    vi.spyOn(ApprovalServiceModule, 'listApprovals').mockResolvedValue({
      items: [{ ...pendingDraftApproval, status: 'APPROVED', draft_status: 'APPROVED' }],
      total: 1,
      page: 1,
      page_size: 20,
    });

    render(<ApprovalsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Resolution History/i }));
    fireEvent.click(await screen.findByRole('button', { name: /View Audit Details/i }));

    await waitFor(() => expect(screen.getByTestId('draft-readonly-text')).toHaveTextContent('How many documents a month?'));
    expect(screen.getByText(/Authorised text \(version 1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/11111111/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Text that will be authorised/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Edit approved text/i })).toBeInTheDocument();
  });

  it('shows the draft status on the approval list', async () => {
    render(<ApprovalsPage />);
    await waitFor(() => expect(screen.getByTestId('draft-status-badge')).toHaveTextContent(/pending approval/i));
  });

  it('does not offer draft controls for approvals without a draft', async () => {
    const plain = { ...pendingDraftApproval, draft_id: null, draft_status: null, context_snapshot: { company: 'BigCorp' } };
    vi.spyOn(ApprovalServiceModule, 'listApprovals').mockResolvedValue({ items: [plain], total: 1, page: 1, page_size: 20 });
    render(<ApprovalsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Review & Authorize/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Approve & Resume/i })).toBeEnabled());
    expect(screen.queryByTestId('draft-review-panel')).not.toBeInTheDocument();
    expect(ApprovalServiceModule.getApprovalReview).not.toHaveBeenCalled();
  });
});

describe('Delivery status on the reply draft', () => {
  const withDelivery = (delivery: any, draftOverrides: any = {}) =>
    ({
      ...baseReview({ status: 'SENT', approved_version: 1, ...draftOverrides }),
      approval_status: 'APPROVED',
      delivery,
    }) as ApprovalReview;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'usr-1', email: 'm@acme.com', full_name: 'Manager', is_active: true, is_superuser: false, created_at: '2026-01-01T00:00:00Z' },
      organizations: [mockOrg],
      activeOrganization: mockOrg,
      activeRole: 'MANAGER',
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      switchOrganization: vi.fn(),
      refreshProfile: vi.fn(),
    });
    vi.spyOn(ApprovalServiceModule, 'listApprovals').mockResolvedValue({
      items: [{ ...pendingDraftApproval, status: 'APPROVED', draft_status: 'SENT' }],
      total: 1,
      page: 1,
      page_size: 20,
    });
  });

  const openHistory = async () => {
    render(<ApprovalsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Resolution History/i }));
    fireEvent.click(await screen.findByRole('button', { name: /View Audit Details/i }));
    await waitFor(() => expect(screen.getByTestId('draft-review-panel')).toBeInTheDocument());
  };

  it('never says delivered when the provider has only accepted the message', async () => {
    vi.spyOn(ApprovalServiceModule, 'getApprovalReview').mockResolvedValue(
      withDelivery({
        id: 'del-1',
        status: 'SENT',
        status_label: 'Accepted by provider (delivery not confirmed)',
        version_number: 1,
        attempt_count: 1,
        max_attempts: 5,
        sent_at: '2026-10-17T11:00:00Z',
        provider_message_id: 'mock-abc123',
      })
    );
    await openHistory();
    const status = screen.getByTestId('delivery-status');
    expect(status).toHaveTextContent(/accepted by provider/i);
    expect(status).toHaveTextContent(/not confirmed/i);
    expect(status.textContent).not.toMatch(/^delivered/i);
    expect(screen.getByText('mock-abc123')).toBeInTheDocument();
  });

  it('warns that an unknown outcome will not be resent automatically', async () => {
    vi.spyOn(ApprovalServiceModule, 'getApprovalReview').mockResolvedValue(
      withDelivery(
        {
          id: 'del-2',
          status: 'UNKNOWN_OUTCOME',
          status_label: 'Outcome unknown, needs reconciliation',
          version_number: 1,
          attempt_count: 1,
          max_attempts: 5,
          error: { category: 'uncertain', code: 'response_lost', detail: 'The response was lost; outcome unknown' },
        },
        { status: 'SENDING' }
      )
    );
    await openHistory();
    expect(screen.getByText(/will not be resent automatically/i)).toBeInTheDocument();
    expect(screen.getByText(/The response was lost/)).toBeInTheDocument();
  });

  it('shows a failed delivery and offers editing so the text can be re-approved', async () => {
    vi.spyOn(ApprovalServiceModule, 'getApprovalReview').mockResolvedValue(
      withDelivery(
        {
          id: 'del-3',
          status: 'FAILED_PERMANENT',
          status_label: 'Failed',
          version_number: 1,
          attempt_count: 1,
          max_attempts: 5,
          error: { category: 'permanent', code: 'rejected_by_provider', detail: 'The provider rejected the message' },
        },
        { status: 'SEND_FAILED' }
      )
    );
    await openHistory();
    expect(screen.getByTestId('delivery-status')).toHaveTextContent('Failed');
    expect(screen.getByText(/Sending failed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Edit approved text/i })).toBeInTheDocument();
  });
});

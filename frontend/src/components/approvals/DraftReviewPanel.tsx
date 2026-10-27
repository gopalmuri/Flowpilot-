import React from 'react';
import { AlertTriangle, FileText, History, Mail, MessageSquare, PenLine, Sparkles } from 'lucide-react';
import { ApprovalReview, DraftStatus } from '../../types/approval';

interface DraftReviewPanelProps {
  review: ApprovalReview;
  /** The reviewer may act (pending approval and sufficient role). */
  canAct: boolean;
  editedText: string;
  onEditedTextChange: (value: string) => void;
  revisionText: string;
  onRevisionTextChange: (value: string) => void;
  busy: boolean;
  onSaveEdit: () => void;
  onRequestRevision: () => void;
  onRegenerate: () => void;
}

const DRAFT_STATUS_LABEL: Record<DraftStatus, { label: string; tone: string }> = {
  DRAFT: { label: 'Draft', tone: 'bg-slate-500/10 text-warm-600 dark:text-charcoal-300 border-slate-500/20' },
  PENDING_APPROVAL: { label: 'Awaiting approval', tone: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60' },
  APPROVED: { label: 'Approved', tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20' },
  REJECTED: { label: 'Rejected', tone: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800/60' },
  REVISION_REQUESTED: { label: 'Revision requested', tone: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800/60' },
  EXPIRED: { label: 'Expired', tone: 'bg-slate-500/10 text-warm-500 dark:text-charcoal-400 border-slate-500/20' },
  CANCELLED: { label: 'Cancelled', tone: 'bg-slate-500/10 text-warm-500 dark:text-charcoal-400 border-slate-500/20' },
  SENDING: { label: 'Sending', tone: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800/60' },
  SENT: { label: 'Accepted by provider', tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20' },
  SEND_FAILED: { label: 'Sending failed', tone: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800/60' },
};

const RISK_FLAG_LABEL: Record<string, string> = {
  prompt_injection_suspected: 'Possible prompt injection',
  unverified_price: 'Mentions a price not in the business profile',
  unverified_timeline: 'Mentions a timeline not in the business profile',
  unverified_guarantee: 'Makes a guarantee not in the business profile',
  unverified_link: 'Contains a link not in the business profile',
  low_confidence: 'Low AI confidence',
  no_draft_generated: 'No draft was generated',
};

const cardClass =
  'p-3.5 bg-warm-50 dark:bg-charcoal-850 border border-warm-200 dark:border-charcoal-750 rounded-xl text-left';
const labelClass = 'text-[11px] font-semibold uppercase tracking-wide text-warm-500 dark:text-charcoal-400';

export const DraftReviewPanel: React.FC<DraftReviewPanelProps> = ({
  review,
  canAct,
  editedText,
  onEditedTextChange,
  revisionText,
  onRevisionTextChange,
  busy,
  onSaveEdit,
  onRequestRevision,
  onRegenerate,
}) => {
  const { message, analysis, draft, delivery } = review;
  if (!draft) return null;

  const current = draft.versions.find((v) => v.version_number === draft.current_version);
  const original = draft.versions[0];
  const approved = draft.versions.find((v) => v.is_approved);
  const status = DRAFT_STATUS_LABEL[draft.status] ?? DRAFT_STATUS_LABEL.DRAFT;
  const editable = canAct && (draft.status === 'PENDING_APPROVAL' || draft.status === 'REVISION_REQUESTED');
  const hasUnsavedEdits = editable && current !== undefined && editedText.trim() !== current.content.trim();
  const flags = Array.from(new Set([...(draft.risk_flags || []), ...(analysis?.risk_flags || [])]));
  const ChannelIcon = message?.channel === 'PORTFOLIO_FORM' ? Mail : MessageSquare;

  return (
    <div className="space-y-4" data-testid="draft-review-panel">
      {/* Original message */}
      {message && (
        <section className={cardClass} aria-label="Original message">
          <div className="flex items-center justify-between mb-2">
            <span className={`${labelClass} flex items-center gap-1.5`}>
              <ChannelIcon className="w-3.5 h-3.5" />
              Original message &bull; {message.channel.replace('_', ' ').toLowerCase()}
            </span>
            <span className="text-[11px] text-warm-400 dark:text-charcoal-500">
              {new Date(message.received_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
            </span>
          </div>
          <div className="text-xs text-warm-700 dark:text-charcoal-300 space-y-0.5">
            <div>
              <span className="text-warm-500 dark:text-charcoal-400">From: </span>
              <span className="font-medium">{message.sender_name || 'Unknown'}</span>
              {message.sender_address && <span className="font-mono"> &lt;{message.sender_address}&gt;</span>}
            </div>
            {message.subject && (
              <div>
                <span className="text-warm-500 dark:text-charcoal-400">Subject: </span>
                {message.subject}
              </div>
            )}
          </div>
          <p className="mt-2 text-xs whitespace-pre-wrap text-warm-900 dark:text-charcoal-100 bg-white dark:bg-charcoal-950 border border-warm-200 dark:border-charcoal-750 rounded-lg p-2.5">
            {message.text}
          </p>
        </section>
      )}

      {/* AI analysis */}
      {analysis && (
        <section className={cardClass} aria-label="AI analysis">
          <div className={`${labelClass} flex items-center gap-1.5 mb-2`}>
            <Sparkles className="w-3.5 h-3.5" />
            AI analysis
            {analysis.provider && (
              <span className="normal-case font-mono text-warm-400 dark:text-charcoal-500">
                {analysis.provider}
                {analysis.model ? ` / ${analysis.model}` : ''}
              </span>
            )}
          </div>
          {analysis.is_fallback && (
            <div className="mb-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 dark:bg-amber-950/40 dark:border-amber-800/60 dark:text-amber-300 text-xs">
              Automatic analysis was unavailable for this message. Review it manually.
            </div>
          )}
          {analysis.summary && <p className="text-xs text-warm-900 dark:text-charcoal-100">{analysis.summary}</p>}
          <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
            {analysis.category && (
              <span className="px-2 py-0.5 rounded bg-warm-100 dark:bg-charcoal-800 border border-warm-300 dark:border-charcoal-700 font-mono">
                {analysis.category}
              </span>
            )}
            {analysis.urgency && (
              <span className="px-2 py-0.5 rounded bg-warm-100 dark:bg-charcoal-800 border border-warm-300 dark:border-charcoal-700">
                urgency: {analysis.urgency}
              </span>
            )}
            {typeof analysis.confidence === 'number' && (
              <span className="px-2 py-0.5 rounded bg-warm-100 dark:bg-charcoal-800 border border-warm-300 dark:border-charcoal-700">
                confidence: {Math.round(analysis.confidence * 100)}%
              </span>
            )}
          </div>
          {analysis.requirements.length > 0 && (
            <div className="mt-2.5">
              <div className={labelClass}>Requirements</div>
              <ul className="list-disc pl-4 mt-1 text-xs text-warm-700 dark:text-charcoal-300 space-y-0.5">
                {analysis.requirements.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          {analysis.missing_information.length > 0 && (
            <div className="mt-2.5">
              <div className={labelClass}>Missing information</div>
              <ul className="list-disc pl-4 mt-1 text-xs text-warm-700 dark:text-charcoal-300 space-y-0.5">
                {analysis.missing_information.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          {analysis.uncertainty_notes && (
            <p className="mt-2 text-[11px] italic text-warm-500 dark:text-charcoal-400">
              Uncertainty: {analysis.uncertainty_notes}
            </p>
          )}
        </section>
      )}

      {/* Risk flags */}
      {flags.length > 0 && (
        <div
          className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 dark:bg-rose-950/40 dark:border-rose-800/60 dark:text-rose-300 text-xs space-y-1"
          role="alert"
        >
          <div className="font-semibold flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" />
            Check before approving
          </div>
          <ul className="list-disc pl-5">
            {flags.map((f) => (
              <li key={f}>{RISK_FLAG_LABEL[f] ?? f}</li>
            ))}
          </ul>
        </div>
      )}

      {/* The draft */}
      <section className={cardClass} aria-label="Reply draft">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <span className={`${labelClass} flex items-center gap-1.5`}>
            <FileText className="w-3.5 h-3.5" />
            Reply draft &bull; version {draft.current_version}
            {current && (
              <span className="normal-case font-medium">
                {current.author_type === 'AI' ? '(AI-written)' : '(edited by a person)'}
              </span>
            )}
          </span>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${status.tone}`}>
            {status.label}
          </span>
        </div>

        {draft.status === 'REVISION_REQUESTED' && draft.revision_instructions && (
          <div className="mb-2 p-2.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-800 dark:bg-sky-950/40 dark:border-sky-800/60 dark:text-sky-200 text-xs">
            <span className="font-semibold">Revision requested: </span>
            {draft.revision_instructions}
          </div>
        )}

        {editable ? (
          <>
            <label htmlFor="draft-text" className="block text-xs font-medium text-warm-700 dark:text-charcoal-300 mb-1">
              Text that will be authorised <span className="text-warm-400 dark:text-charcoal-500">(you can edit it)</span>
            </label>
            <textarea
              id="draft-text"
              rows={9}
              value={editedText}
              onChange={(e) => onEditedTextChange(e.target.value)}
              disabled={busy}
              maxLength={3000}
              className="w-full px-3 py-2.5 bg-white dark:bg-charcoal-950 border border-warm-200 dark:border-charcoal-750 rounded-xl text-xs font-mono text-warm-900 dark:text-charcoal-100 focus:outline-none focus:ring-1 focus:ring-brand-500/20 focus:border-brand-600"
            />
            {hasUnsavedEdits && (
              <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400" role="status">
                You changed the AI text. Approving will authorise <strong>your edited version</strong>, not the AI draft.
              </p>
            )}
          </>
        ) : (
          <div>
            <div className="text-xs font-medium text-warm-700 dark:text-charcoal-300 mb-1">
              {approved ? `Authorised text (version ${approved.version_number})` : 'Draft text'}
            </div>
            <pre
              className="whitespace-pre-wrap text-xs font-mono p-3 bg-white dark:bg-charcoal-950 border border-warm-200 dark:border-charcoal-750 rounded-xl text-warm-900 dark:text-charcoal-100"
              data-testid="draft-readonly-text"
            >
              {(approved ?? current)?.content}
            </pre>
          </div>
        )}

        {(approved ?? current) && (
          <p className="mt-1.5 text-[10px] font-mono text-warm-400 dark:text-charcoal-500">
            sha256 {(approved ?? current)!.content_hash.slice(0, 16)}&hellip;
          </p>
        )}

        {draft.decided_at && (
          <div className="mt-2 text-[11px] text-warm-500 dark:text-charcoal-400">
            {draft.status === 'APPROVED' ? 'Approved' : draft.status === 'REJECTED' ? 'Rejected' : 'Decided'} on{' '}
            {new Date(draft.decided_at).toLocaleString()}
            {draft.decided_by && <> by user <span className="font-mono">{draft.decided_by.slice(0, 8)}</span></>}
            {draft.decision_comment && <> &mdash; &ldquo;{draft.decision_comment}&rdquo;</>}
          </div>
        )}

        {editable && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onSaveEdit}
              disabled={busy || !hasUnsavedEdits || !editedText.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-warm-100 dark:bg-charcoal-800 hover:bg-warm-200 dark:hover:bg-charcoal-750 text-warm-700 dark:text-charcoal-300 disabled:opacity-50"
            >
              <PenLine className="w-3.5 h-3.5" />
              Save edit as new version
            </button>
          </div>
        )}
      </section>

      {/* Delivery status (what happened to the approved text) */}
      {delivery && (
        <section className={cardClass} aria-label="Delivery">
          <div className={`${labelClass} mb-1.5`}>Delivery of version {delivery.version_number}</div>
          <p className="text-xs font-medium text-warm-900 dark:text-charcoal-100" data-testid="delivery-status">
            {delivery.status_label}
          </p>
          <p className="mt-1 text-[11px] text-warm-500 dark:text-charcoal-400">
            Attempt {delivery.attempt_count} of {delivery.max_attempts}
            {delivery.sent_at && <> &bull; accepted {new Date(delivery.sent_at).toLocaleString()}</>}
            {delivery.provider_message_id && (
              <> &bull; provider id <span className="font-mono">{delivery.provider_message_id}</span></>
            )}
          </p>
          {delivery.status === 'FAILED_RETRYABLE' && delivery.next_attempt_at && (
            <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
              Next attempt {new Date(delivery.next_attempt_at).toLocaleString()}
            </p>
          )}
          {delivery.status === 'UNKNOWN_OUTCOME' && (
            <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400" role="alert">
              The provider may have accepted this message. It will not be resent automatically; an administrator
              must check the provider and resolve it.
            </p>
          )}
          {delivery.error?.detail && (
            <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">{delivery.error.detail}</p>
          )}
        </section>
      )}

      {/* Revision */}
      {canAct && draft.status === 'PENDING_APPROVAL' && (
        <section className={cardClass} aria-label="Request revision">
          <label htmlFor="revision-instructions" className={`${labelClass} block mb-1`}>
            Request a revision
          </label>
          <textarea
            id="revision-instructions"
            rows={2}
            value={revisionText}
            onChange={(e) => onRevisionTextChange(e.target.value)}
            disabled={busy}
            maxLength={2000}
            placeholder="What should change? e.g. shorter, ask about timeline, friendlier tone"
            className="w-full px-3 py-2 bg-white dark:bg-charcoal-950 border border-warm-200 dark:border-charcoal-750 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-brand-500/20 focus:border-brand-600"
          />
          <button
            type="button"
            onClick={onRequestRevision}
            disabled={busy || !revisionText.trim()}
            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 dark:bg-sky-950/40 dark:hover:bg-sky-900/50 dark:text-sky-300 dark:border-sky-800/60 disabled:opacity-50"
          >
            <History className="w-3.5 h-3.5" />
            Request revision
          </button>
        </section>
      )}

      {canAct && draft.status === 'REVISION_REQUESTED' && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-warm-600 dark:text-charcoal-400">
          <button
            type="button"
            onClick={onRegenerate}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Regenerate with AI
          </button>
          <span>or edit the text above and save it as a new version. Nothing is sent either way.</span>
        </div>
      )}

      {/* Version history */}
      {draft.versions.length > 1 && (
        <details className={cardClass}>
          <summary className="cursor-pointer text-xs font-medium text-warm-700 dark:text-charcoal-300">
            Version history ({draft.versions.length}) &mdash; original AI draft vs. edits
          </summary>
          <ol className="mt-2 space-y-2">
            {draft.versions.map((v) => (
              <li key={v.version_number} className="text-xs">
                <div className="flex items-center gap-2 text-[11px] text-warm-500 dark:text-charcoal-400">
                  <span className="font-semibold">v{v.version_number}</span>
                  <span>{v.author_type === 'AI' ? 'AI draft' : 'Edited by a person'}</span>
                  {v.is_approved && <span className="text-emerald-700 dark:text-emerald-400 font-semibold">approved</span>}
                  {v.version_number === original.version_number && <span>(original)</span>}
                </div>
                <pre className="whitespace-pre-wrap font-mono mt-0.5 p-2 bg-white dark:bg-charcoal-950 border border-warm-200 dark:border-charcoal-750 rounded-lg">
                  {v.content}
                </pre>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
};

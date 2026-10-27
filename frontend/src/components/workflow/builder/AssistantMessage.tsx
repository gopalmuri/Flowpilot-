import React from 'react';
import { AlertTriangle, Clock, Minus, Pencil, Plus, RotateCcw, Sparkles, GitCommitHorizontal } from 'lucide-react';
import { btn } from './styles';

export interface MessageChanges {
  added: string[];
  removed: string[];
  modified: string[];
  reconnected: number;
}

export interface BuilderMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  tone?: 'normal' | 'error' | 'limit';
  /** Concise summary of what this reply changed in the workflow (from the proposal's diff). */
  changes?: MessageChanges;
}

interface AssistantMessageProps {
  message: BuilderMessage;
  onRetry?: () => void;
  retryDisabled?: boolean;
}

const ChangeRow: React.FC<{ icon: React.ElementType; label: string; items: string[] }> = ({ icon: Icon, label, items }) =>
  items.length === 0 ? null : (
    <li className="flex items-start gap-2 text-sm text-warm-700 dark:text-charcoal-300">
      <Icon className="w-4 h-4 mt-0.5 flex-shrink-0 text-warm-500 dark:text-charcoal-400" aria-hidden="true" />
      <span>
        <span className="font-medium text-warm-900 dark:text-charcoal-100">{label}: </span>
        {items.join(', ')}
      </span>
    </li>
  );

export const AssistantMessage: React.FC<AssistantMessageProps> = ({ message, onRetry, retryDisabled }) => {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-[15px] leading-relaxed text-white whitespace-pre-wrap dark:bg-brand-500">
          <span className="sr-only">You said: </span>
          {message.content}
        </div>
      </div>
    );
  }

  const isError = message.tone === 'error';
  const isLimit = message.tone === 'limit';
  const ch = message.changes;
  const hasChanges = ch && (ch.added.length || ch.removed.length || ch.modified.length || ch.reconnected > 0);

  if (isError || isLimit) {
    return (
      <div
        role="alert"
        className={`rounded-xl border px-4 py-3 ${
          isError
            ? 'border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10'
            : 'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10'
        }`}
      >
        <div
          className={`flex items-center gap-2 text-sm font-semibold ${
            isError ? 'text-red-800 dark:text-red-300' : 'text-amber-900 dark:text-amber-200'
          }`}
        >
          {isError ? <AlertTriangle className="w-4 h-4" aria-hidden="true" /> : <Clock className="w-4 h-4" aria-hidden="true" />}
          {isError ? 'That did not work' : 'Daily AI limit reached'}
        </div>
        <p className="mt-1 text-[15px] leading-relaxed text-warm-800 dark:text-charcoal-200 whitespace-pre-wrap">
          {message.content}
        </p>
        {isError && onRetry && (
          <button type="button" onClick={onRetry} disabled={retryDisabled} className={`${btn.secondary} mt-3`}>
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3">
      <div
        className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400"
        aria-hidden="true"
      >
        <Sparkles className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <p className="text-[15px] leading-relaxed text-warm-800 dark:text-charcoal-200 whitespace-pre-wrap">
          <span className="sr-only">Assistant: </span>
          {message.content}
        </p>
        {hasChanges && ch && (
          <div className="rounded-lg border border-warm-300 bg-warm-50 px-3 py-2.5 dark:border-charcoal-750 dark:bg-charcoal-850">
            <p className="text-xs font-semibold uppercase tracking-wide text-warm-500 dark:text-charcoal-400">
              Changes to the workflow
            </p>
            <ul className="mt-1.5 space-y-1.5">
              <ChangeRow icon={Plus} label="Added" items={ch.added} />
              <ChangeRow icon={Pencil} label="Updated" items={ch.modified} />
              <ChangeRow icon={Minus} label="Removed" items={ch.removed} />
              {ch.reconnected > 0 && (
                <li className="flex items-center gap-2 text-sm text-warm-700 dark:text-charcoal-300">
                  <GitCommitHorizontal className="w-4 h-4 text-warm-500 dark:text-charcoal-400" aria-hidden="true" />
                  {ch.reconnected} {ch.reconnected === 1 ? 'connection' : 'connections'} rearranged
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

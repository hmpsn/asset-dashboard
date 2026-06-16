import { Archive, Check, Pause, Target, X, XCircle } from 'lucide-react';

import {
  KEYWORD_COMMAND_CENTER_ACTIONS,
  type KeywordCommandCenterBulkActionType,
} from '../../../shared/types/keyword-command-center';
import { Button } from '../ui';

interface KeywordBulkActionBarProps {
  selectedCount: number;
  isPending: boolean;
  onAction: (action: KeywordCommandCenterBulkActionType) => void;
  onClear: () => void;
}

export function KeywordBulkActionBar({ selectedCount, isPending, onAction, onClear }: KeywordBulkActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div
      role="toolbar"
      aria-label="Selected keyword bulk actions"
      className="sticky bottom-4 mt-4 z-[var(--z-sticky)] w-full rounded-[var(--radius-xl)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      style={{ boxShadow: 'var(--brand-shadow-md)' }}
    >
      <div className="min-w-0">
        <p className="t-caption font-semibold text-[var(--brand-text-bright)]">{selectedCount} selected</p>
        <p className="t-caption-sm text-[var(--brand-text-muted)]">Bulk lifecycle changes preserve protected keywords unless confirmed.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            icon={Target}
            disabled={isPending}
            onClick={() => onAction(KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY)}
          >
            Add to strategy
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={Check}
            disabled={isPending}
            onClick={() => onAction(KEYWORD_COMMAND_CENTER_ACTIONS.TRACK)}
          >
            Track
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={Pause}
            disabled={isPending}
            onClick={() => onAction(KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING)}
          >
            Pause
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={Archive}
            disabled={isPending}
            onClick={() => onAction(KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE)}
          >
            Retire
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={XCircle}
            disabled={isPending}
            onClick={() => onAction(KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE)}
          >
            Decline
          </Button>
          <Button size="sm" variant="ghost" icon={X} disabled={isPending} onClick={onClear}>
            Clear
          </Button>
      </div>
    </div>
  );
}

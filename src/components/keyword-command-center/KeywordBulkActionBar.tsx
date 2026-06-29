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

  // fixed: SectionCard has overflow-hidden which prevents sticky from anchoring
  // to the viewport. The scroll clearance (pb-24) is applied in KeywordHub.tsx
  // on the outer page wrapper so it falls outside the overflow-hidden boundary.
  return (
    <div className="fixed inset-x-0 bottom-2 sm:bottom-4 z-[var(--z-dropdown)] pointer-events-none">
      <div
        role="toolbar"
        aria-label="Selected keyword bulk actions"
        className="mx-auto w-[min(960px,calc(100%-2rem))] max-h-[calc(100vh-2rem)] overflow-y-auto pointer-events-auto rounded-[var(--radius-xl)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        style={{ boxShadow: 'var(--brand-shadow-md)' }}
      >
        <div className="min-w-0">
          <p className="t-caption font-semibold text-[var(--brand-text-bright)]">{selectedCount} selected</p>
          <p className="t-caption-sm text-[var(--brand-text-muted)]">Bulk lifecycle changes preserve protected keywords unless confirmed.</p>
        </div>
        <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
          <Button
            size="sm"
            variant="primary"
            icon={Target}
            disabled={isPending}
            className="w-full sm:w-auto"
            onClick={() => onAction(KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY)}
          >
            Add to strategy
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={Check}
            disabled={isPending}
            className="w-full sm:w-auto"
            onClick={() => onAction(KEYWORD_COMMAND_CENTER_ACTIONS.TRACK)}
          >
            Track
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={Pause}
            disabled={isPending}
            className="w-full sm:w-auto"
            onClick={() => onAction(KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING)}
          >
            Pause
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={Archive}
            disabled={isPending}
            className="w-full text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 sm:w-auto"
            onClick={() => onAction(KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE)}
          >
            Retire
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={XCircle}
            disabled={isPending}
            className="w-full text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 sm:w-auto"
            onClick={() => onAction(KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE)}
          >
            Decline
          </Button>
          <Button size="sm" variant="ghost" icon={X} disabled={isPending} className="w-full sm:w-auto" onClick={onClear}>
            Clear
          </Button>
        </div>
      </div>
    </div>
  );
}

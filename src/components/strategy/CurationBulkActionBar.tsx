import { useState } from 'react';
import { Send, Pause, XCircle, X } from 'lucide-react';

import { Button } from '../ui';

export type BulkAction = 'send' | 'throttle' | 'strike';

interface CurationBulkActionBarProps {
  selectedCount: number;
  isAllInFilter: boolean;
  isPending: boolean;
  /** Throttle passes the chosen day count; send/strike pass undefined. */
  onAction: (action: BulkAction, throttleDays?: 7 | 30 | 90) => void;
  onClear: () => void;
  /**
   * Bulk send-action verb. Optional — defaults to "Send" so StrategyCockpit and the flag-OFF
   * path stay byte-identical. The Issue cockpit passes "Stage" (staging only — the one client
   * commit is the header "Send issue" button; Blocker 5).
   */
  sendVerb?: string;
  /** Optional sendable subset count when non-send bulk actions may target a wider selection. */
  sendCount?: number;
}

export function CurationBulkActionBar({
  selectedCount,
  isAllInFilter,
  isPending,
  onAction,
  onClear,
  sendVerb = 'Send',
  sendCount = selectedCount,
}: CurationBulkActionBarProps) {
  const [throttleOpen, setThrottleOpen] = useState(false);
  const [strikeArmed, setStrikeArmed] = useState(false);

  if (selectedCount === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-[var(--z-dropdown)] pointer-events-none">
      <div
        role="toolbar"
        aria-label="Selected recommendation bulk actions"
        className="mx-auto w-[min(960px,calc(100%-2rem))] pointer-events-auto rounded-[var(--radius-xl)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        style={{ boxShadow: 'var(--brand-shadow-md)' }}
      >
        <div className="min-w-0">
          <p className="t-caption font-semibold text-[var(--brand-text-bright)]">
            {selectedCount} selected{isAllInFilter ? ' (all matching)' : ''}
          </p>
          <p className="t-caption-sm text-[var(--brand-text-muted)]">
            Bulk changes apply in one step. Strike still confirms before suppressing.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            icon={Send}
            disabled={isPending || sendCount === 0}
            onClick={() => onAction('send')}
          >
            {sendVerb} {sendCount}
          </Button>

          {throttleOpen ? (
            <div className="flex items-center gap-1" role="group" aria-label="Throttle duration">
              {([7, 30, 90] as const).map(days => (
                <Button
                  key={days}
                  size="sm"
                  variant="secondary"
                  disabled={isPending}
                  onClick={() => { onAction('throttle', days); setThrottleOpen(false); }}
                >
                  {days}d
                </Button>
              ))}
              <Button size="sm" variant="ghost" icon={X} onClick={() => setThrottleOpen(false)} aria-label="Cancel throttle" />
            </div>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              icon={Pause}
              disabled={isPending}
              onClick={() => setThrottleOpen(true)}
            >
              Throttle {selectedCount}
            </Button>
          )}

          {strikeArmed ? (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="danger"
                icon={XCircle}
                disabled={isPending}
                onClick={() => { onAction('strike'); setStrikeArmed(false); }}
              >
                Confirm strike {selectedCount}
              </Button>
              <Button size="sm" variant="ghost" icon={X} onClick={() => setStrikeArmed(false)} aria-label="Cancel strike" />
            </div>
          ) : (
            <Button
              size="sm"
              variant="danger"
              icon={XCircle}
              disabled={isPending}
              onClick={() => setStrikeArmed(true)}
            >
              Strike {selectedCount}
            </Button>
          )}

          <Button size="sm" variant="ghost" icon={X} disabled={isPending} onClick={onClear}>
            Clear
          </Button>
        </div>
      </div>
    </div>
  );
}

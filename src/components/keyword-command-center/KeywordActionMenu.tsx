import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { TRACKED_KEYWORD_SOURCE } from '../../../shared/types/rank-tracking';
import {
  KEYWORD_COMMAND_CENTER_ACTIONS,
  type KeywordCommandCenterActionType,
  type KeywordCommandCenterNextAction,
  type KeywordCommandCenterNextActionType,
  type KeywordCommandCenterRow,
} from '../../../shared/types/keyword-command-center';

interface KeywordActionMenuProps {
  row: KeywordCommandCenterRow;
  onAction: (action: KeywordCommandCenterActionType, opts?: { force?: boolean }) => void;
  /** Separate channel — NOT an action enum value (hard delete is never a lifecycle action). */
  onDeleteHard: (keyword: string) => void;
  isPending?: boolean;
}

// The lifecycle action enum values (everything in nextActions that is a real KCC action,
// as opposed to a navigation affordance like view_rankings / generate_brief).
const LIFECYCLE_ACTION_TYPES = new Set<KeywordCommandCenterNextActionType>([
  KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY,
  KEYWORD_COMMAND_CENTER_ACTIONS.PROMOTE_EVIDENCE,
  KEYWORD_COMMAND_CENTER_ACTIONS.TRACK,
  KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING,
  KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE,
  KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE,
  KEYWORD_COMMAND_CENTER_ACTIONS.RESTORE,
]);

function isLifecycleAction(type: KeywordCommandCenterNextActionType): type is KeywordCommandCenterActionType {
  return LIFECYCLE_ACTION_TYPES.has(type);
}

/**
 * Hub action-tone reconciliation (Four Laws). The shared server `buildNextActions`
 * still tags retire/decline `red` for the flag-OFF KCC (preserved byte-identical). The
 * Hub REMAPS those to AMBER here so RED is reserved EXCLUSIVELY for the irreversible
 * Delete. track/move/restore stay teal; view_rankings etc. stay blue.
 */
function hubToneClass(action: KeywordCommandCenterNextAction): string {
  const amber = action.type === KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE
    || action.type === KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE;
  if (amber) return 'text-[var(--amber)] hover:text-[var(--amber)]';
  if (action.tone === 'blue') return 'text-[var(--blue)] hover:text-[var(--blue)]';
  // teal (default Hub action tone) for track / add-to-strategy / restore / local etc.
  return 'text-[var(--teal)] hover:text-[var(--teal)]';
}

/**
 * Client-side hard-delete eligibility — MIRRORS the server `isHardDeleteEligible`:
 * MANUAL, unpinned, with NO strategy/client provenance (no sourceGapKey, not
 * CLIENT_REQUESTED, not strategy-owned, no approved/requested feedback). Ineligible
 * rows hide Delete entirely (retire is the only remove).
 */
export function canHardDelete(row: KeywordCommandCenterRow): boolean {
  const t = row.tracking;
  if (!t || t.status === 'not_tracked') return false;
  if (t.pinned) return false;
  if (t.source === TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED) return false;
  if (t.sourceGapKey) return false;
  if (t.strategyOwned === true) return false;
  if (row.feedback?.status === 'approved' || row.feedback?.status === 'requested') return false;
  return t.source === TRACKED_KEYWORD_SOURCE.MANUAL;
}

export function KeywordActionMenu({ row, onAction, onDeleteHard, isPending }: KeywordActionMenuProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Only render the lifecycle actions (nextActions already encodes the lifecycle-aware set:
  // Restore-only for retired/declined, Add-to-strategy for needs-review, Track for not-tracked,
  // Pause/Retire/Decline for tracked). Navigation affordances are not part of this menu.
  const lifecycleActions = row.nextActions.filter((a) => isLifecycleAction(a.type));
  const deletable = canHardDelete(row);

  return (
    <div className="flex items-center justify-end gap-1.5">
      {lifecycleActions.map((a) => (
        <Button
          key={a.type}
          variant="ghost"
          size="sm"
          disabled={isPending || a.disabled}
          title={a.disabledReason ?? a.detail}
          className={hubToneClass(a)}
          onClick={() => onAction(a.type as KeywordCommandCenterActionType, a.disabledReason ? { force: true } : undefined)}
        >
          {a.label}
        </Button>
      ))}

      {deletable && (
        <>
          {/* Visual separation: divider + the ONLY red affordance in the Hub. */}
          <span className="mx-1 h-5 w-px bg-[var(--brand-border)]" aria-hidden="true" />
          <IconButton
            icon={Trash2}
            variant="danger"
            size="sm"
            label={`Delete permanently: ${row.keyword}`}
            disabled={isPending}
            onClick={() => setConfirmOpen(true)}
          />
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        variant="destructive"
        title="Delete keyword permanently?"
        message={`This permanently deletes "${row.keyword}" and its rank history. This cannot be undone.`}
        confirmLabel="Delete permanently"
        cancelLabel="Cancel"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          onDeleteHard(row.keyword);
        }}
      />
    </div>
  );
}

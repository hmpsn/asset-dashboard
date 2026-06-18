import { Button } from '../ui';

interface CockpitStrikeConfirmProps {
  /** Cascade copy for keyword/topic strikes ("removes from strategy — reversible"). */
  cascadeNote?: string;
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

/** Strategy v3 cockpit — Strike arm-then-confirm (spec §4.3). One click in the ⋯ overflow
 *  ARMS this strip; the operator must explicitly confirm. Brand-law M4: muted-zinc, never violet. */
export function CockpitStrikeConfirm({ cascadeNote, onConfirm, onCancel, disabled }: CockpitStrikeConfirmProps) {
  return (
    <div className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)] px-3 py-2">
      <span className="t-caption-sm text-[var(--brand-text-muted)]">
        Strike — won&apos;t be re-suggested{cascadeNote ? ` · ${cascadeNote}` : ''}
      </span>
      <Button size="sm" variant="danger" disabled={disabled} onClick={onConfirm}>Confirm</Button>
      <Button variant="ghost" size="sm" disabled={disabled} onClick={onCancel}>Cancel</Button>
    </div>
  );
}

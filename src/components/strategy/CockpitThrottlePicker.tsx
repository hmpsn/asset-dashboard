import { Button } from '../ui';

interface CockpitThrottlePickerProps {
  onPick: (days: 7 | 30 | 90) => void;
  onCancel: () => void;
  disabled?: boolean;
}

const OPTIONS: ReadonlyArray<{ days: 7 | 30 | 90; label: string }> = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

/** Strategy v3 cockpit — Throttle 7/30/90-day picker (spec §4.3 confirmed micro-choice 2).
 *  Resurface is on-read (no cron); the row shows a visible auto-resurface clock afterward. */
export function CockpitThrottlePicker({ onPick, onCancel, disabled }: CockpitThrottlePickerProps) {
  return (
    <div className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)] px-3 py-2">
      <span className="t-caption-sm text-[var(--brand-text-muted)]">Hide for</span>
      {OPTIONS.map(({ days, label }) => (
        <Button key={days} size="sm" variant="secondary" disabled={disabled} onClick={() => onPick(days)}>
          {label}
        </Button>
      ))}
      {/* // button-ok — inline Cancel affordance; Button ghost adds excessive padding in tight row */}
      <button
        type="button"
        className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] px-1"
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  );
}

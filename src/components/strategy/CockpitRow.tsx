import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button, IconButton, Checkbox } from '../ui';
import { CockpitSendPanel } from './CockpitSendPanel';
import { CockpitThrottlePicker } from './CockpitThrottlePicker';
import { CockpitStrikeConfirm } from './CockpitStrikeConfirm';
import { toCockpitRow } from './cockpitRowModel';
import type { CockpitActions } from './StrategyCockpit';
import type { Recommendation } from '../../../shared/types/recommendations';

interface CockpitRowProps {
  rec: Recommendation;
  actions: CockpitActions;
  /** Bulk-curation selection state. When `onToggleSelect` is provided the row renders a
   *  left-edge selection checkbox; when absent (flag-OFF / other consumers) the row is unchanged. */
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}

type RowMode = 'idle' | 'send' | 'throttle' | 'strike';

/** Left-edge accent rail color map. Brand-law compliant: teal=action, emerald=success, muted=struck.
 *  Uses bg-[var(--teal)] / bg-emerald-400 (not bg-accent-brand which has no .bg- utility). */
const RAIL_CLASS: Record<string, string> = {
  teal: 'bg-[var(--teal)]',
  emerald: 'bg-emerald-400',
  blue: 'bg-blue-400',
  muted: 'bg-[var(--brand-border-hover)]',
};

const TAG_TONE: Record<string, string> = {
  teal: 'text-accent-brand',
  blue: 'text-blue-400',
  emerald: 'text-emerald-400',
  amber: 'text-amber-400',
  red: 'text-red-400',
  muted: 'text-[var(--brand-text-muted)]',
};

function resurfaceLabel(rec: Recommendation): string | null {
  if (rec.lifecycle !== 'throttled' || !rec.throttledUntil) return null;
  const days = Math.max(0, Math.ceil((Date.parse(rec.throttledUntil) - Date.now()) / 86_400_000));
  return `resurfaces in ${days}d`;
}

/** Strategy v3 cockpit row — fixed [severity][value][lifecycle] tag slots + single-line-clamped
 *  why-line + left-edge lifecycle accent rail + the four row actions. NOT the shared
 *  admin/recommendations/RecommendationRow (3 consumers) — this is the v3 curation row. */
export function CockpitRow({ rec, actions, selected, onToggleSelect }: CockpitRowProps) {
  const [mode, setMode] = useState<RowMode>('idle');
  const model = toCockpitRow(rec);
  const isStruck = rec.lifecycle === 'struck';
  const cascadeNote = rec.cascade?.reversible ? 'removes from strategy — reversible' : undefined;
  const resurface = resurfaceLabel(rec);

  const close = () => setMode('idle');

  return (
    <div
      className={`relative flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] py-3 pl-4 pr-3 ${
        isStruck ? 'opacity-60' : ''
      }`}
    >
      <span
        className={`absolute left-0 top-0 h-full w-1 rounded-l-lg ${RAIL_CLASS[model.railTone]}`}
        aria-hidden
      />
      <div className="flex items-start justify-between gap-3">
        {onToggleSelect && (
          <Checkbox
            checked={selected ?? false}
            onChange={() => onToggleSelect(rec.id)}
            label={`Select: ${rec.title}`}
            srOnlyLabel
            className="mt-0.5 shrink-0"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="t-ui font-semibold text-[var(--brand-text)] truncate">{rec.title}</span>
            {model.tags.map((t) => (
              <span key={t.slot} className={`t-caption-sm ${TAG_TONE[t.tone]} shrink-0`}>
                {t.label}
              </span>
            ))}
            {resurface && <span className="t-caption-sm text-amber-400 shrink-0">{resurface}</span>}
          </div>
          <p className="t-caption-sm text-[var(--brand-text-muted)] truncate">{model.whyLine}</p>
        </div>
        {!isStruck && mode === 'idle' && (
          <div className="flex items-center gap-1 shrink-0">
            <Button size="sm" disabled={actions.isPending} onClick={() => setMode('send')}>
              Send to client
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={actions.isPending}
              onClick={() => actions.fix(rec.id)}
            >
              Fix
            </Button>
            <IconButton
              icon={MoreHorizontal}
              label="More actions"
              size="sm"
              variant="ghost"
              disabled={actions.isPending}
              onClick={() => setMode('throttle')}
            />
          </div>
        )}
        {isStruck && (
          <Button
            size="sm"
            variant="secondary"
            disabled={actions.isPending}
            onClick={() => actions.unstrike(rec.id)}
          >
            Undo
          </Button>
        )}
      </div>

      {mode === 'send' && (
        <CockpitSendPanel
          disabled={actions.isPending}
          onSend={(note) => {
            actions.send(rec.id, note || undefined);
            close();
          }}
          onCancel={close}
        />
      )}
      {mode === 'throttle' && (
        <div className="flex flex-wrap items-center gap-2">
          <CockpitThrottlePicker
            disabled={actions.isPending}
            onPick={(days) => {
              actions.throttle(rec.id, days);
              close();
            }}
            onCancel={close}
          />
          <Button
            variant="ghost"
            size="sm"
            className="text-red-400 hover:text-red-300"
            disabled={actions.isPending}
            onClick={() => setMode('strike')}
          >
            Strike instead
          </Button>
        </div>
      )}
      {mode === 'strike' && (
        <CockpitStrikeConfirm
          cascadeNote={cascadeNote}
          disabled={actions.isPending}
          onConfirm={() => {
            actions.strike(rec.id);
            close();
          }}
          onCancel={close}
        />
      )}
    </div>
  );
}

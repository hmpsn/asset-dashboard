import { useState } from 'react';
import { MoreHorizontal, Pencil } from 'lucide-react';
import { Button, IconButton, Checkbox, FormInput, FormTextarea } from '../ui';
import { CockpitSendPanel } from './CockpitSendPanel';
import { CockpitThrottlePicker } from './CockpitThrottlePicker';
import { CockpitStrikeConfirm } from './CockpitStrikeConfirm';
import { toCockpitRow } from './cockpitRowModel';
import {
  REC_WORDING_TITLE_MAX,
  REC_WORDING_INSIGHT_MAX,
  type RecWordingOverridePayload,
} from '../../../shared/types/rec-operator-steering';
import type { CockpitActions } from './cockpitTypes';
import type { Recommendation } from '../../../shared/types/recommendations';

interface CockpitRowProps {
  rec: Recommendation;
  actions: CockpitActions;
  /** Bulk-curation selection state. When `onToggleSelect` is provided the row renders a
   *  left-edge selection checkbox; when absent (flag-OFF / other consumers) the row is unchanged. */
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  /** Operator-steering wording edit (The Issue §11). When provided, the row renders a pencil
   *  toggle → inline title (FormInput) + insight (FormTextarea) editor, committed on blur. When
   *  ABSENT (flag-OFF / command-center / other consumers) the row renders exactly as before. */
  onEditWording?: (recId: string, payload: RecWordingOverridePayload) => void;
  /**
   * Per-row send-action label. Optional — defaults to "Send to client" so StrategyCockpit and
   * the flag-OFF path stay byte-identical. The Issue cockpit (BackingMovesQueue) passes
   * "Stage for issue" because staging is not a client commit; the single commit is the header
   * "Send issue" button (Blocker 5 — the word "send" lives in exactly one place).
   */
  sendLabel?: string;
  /**
   * Blocker 5 staging model. When provided (the Issue cockpit), the primary button STAGES the rec
   * into a local set — it does NOT send to the client (no `actions.send`, no CockpitSendPanel). The
   * header "Send issue" is the only client commit. `staged` reflects whether this rec is in the set.
   * ABSENT on StrategyCockpit / flag-OFF → the primary button keeps the real per-row send flow,
   * byte-identical.
   */
  onStage?: (recId: string) => void;
  staged?: boolean;
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
export function CockpitRow({ rec, actions, selected, onToggleSelect, onEditWording, sendLabel = 'Send to client', onStage, staged = false }: CockpitRowProps) {
  const [mode, setMode] = useState<RowMode>('idle');
  const [editingWording, setEditingWording] = useState(false);
  const model = toCockpitRow(rec);
  const isStruck = rec.lifecycle === 'struck';
  const cascadeNote = rec.cascade?.reversible ? 'removes from strategy — reversible' : undefined;
  const resurface = resurfaceLabel(rec);

  const close = () => setMode('idle');

  // Wording-edit is opt-in: rendered only when the parent threads `onEditWording` (flag-ON Issue
  // path). Commit-on-blur sends only the changed field so an unedited field is left untouched.
  const canEditWording = !!onEditWording && !isStruck;
  const commitTitle = (next: string) => {
    const trimmed = next.trim();
    if (trimmed !== rec.title) onEditWording?.(rec.id, { title: trimmed });
  };
  const commitInsight = (next: string) => {
    const trimmed = next.trim();
    if (trimmed !== rec.insight) onEditWording?.(rec.id, { insight: trimmed });
  };

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
            {canEditWording && (
              <IconButton
                icon={Pencil}
                label={editingWording ? 'Done editing wording' : 'Edit wording'}
                size="sm"
                variant="ghost"
                onClick={() => setEditingWording((e) => !e)}
              />
            )}
            {onStage ? (
              // Blocker 5 staging: toggle membership in the staged set — NO client write. The header
              // "Send issue" commits the staged set. CockpitSendPanel is never opened in this path.
              <Button
                size="sm"
                variant={staged ? 'secondary' : 'primary'}
                disabled={actions.isPending}
                aria-pressed={staged}
                onClick={() => onStage(rec.id)}
              >
                {staged ? 'Staged' : sendLabel}
              </Button>
            ) : (
              <Button size="sm" disabled={actions.isPending} onClick={() => setMode('send')}>
                {sendLabel}
              </Button>
            )}
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

      {canEditWording && editingWording && mode === 'idle' && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-2">
          <div className="space-y-1">
            <span className="t-label text-[var(--brand-text-muted)] uppercase tracking-wide">Title</span>
            <FormInput
              aria-label={`Edit title for ${rec.title}`}
              value={rec.title}
              commitOnBlur
              maxLength={REC_WORDING_TITLE_MAX}
              disabled={actions.isPending}
              onCommit={commitTitle}
            />
          </div>
          <div className="space-y-1">
            <span className="t-label text-[var(--brand-text-muted)] uppercase tracking-wide">Insight</span>
            <FormTextarea
              aria-label={`Edit insight for ${rec.title}`}
              value={rec.insight}
              commitOnBlur
              maxLength={REC_WORDING_INSIGHT_MAX}
              rows={3}
              disabled={actions.isPending}
              onCommit={commitInsight}
            />
          </div>
        </div>
      )}

      {mode === 'send' && (
        <CockpitSendPanel
          disabled={actions.isPending}
          commitLabel={sendLabel}
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

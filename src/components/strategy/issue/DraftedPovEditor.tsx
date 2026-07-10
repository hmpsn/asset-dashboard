/**
 * DraftedPovEditor — the editable narrated point of view (The Issue, Lane 1C).
 *
 * Renders the system-drafted POV (situation / lead sentence / wins / flags) as inline-editable
 * prose. Edits are batched locally and emitted on a debounce via `onEdit` (the parent hook PATCHes
 * with an optimistic mutation). This is a NEW component — no editable-prose primitive exists
 * (audit §7). It composes over the `FormTextarea` + `Button` primitives.
 *
 * THE CUT→SENTENCE CONTRACT (audit §4 / §10): each rec-linked sentence carries its originating rec
 * id. The lead sentence originates from `pov.leadMoveRecId`. When the backing card for that rec is
 * cut in the queue (its id appears in `struckRecIds`), the lead sentence is removed from the
 * rendered prose LIVE — the operator sees the POV reflow the instant they cut a move, before any
 * save round-trips. (situation/wins/flags are free prose and are not rec-linked in the current
 * StrategyPov shape, so only the lead sentence participates in the cut reconcile.)
 *
 * Tokens: src/tokens.css only. Typography: .t-* utilities. Color law: teal=action, NO purple.
 * Only mounts under the strategy-the-issue flag (parent gates) — byte-identical OFF.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, RefreshCw } from 'lucide-react';
import { SectionCard } from '../../ui/SectionCard';
import { EmptyState } from '../../ui/EmptyState';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { FormTextarea } from '../../ui/forms/FormTextarea';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import type { StrategyPov } from '../../../../shared/types/strategy-pov';
import type { StrategyPovEdit } from '../../../api/strategyPov';

interface DraftedPovEditorProps {
  pov: StrategyPov | null;
  /** Emits a debounced operator edit. Parent (useStrategyPov) PATCHes optimistically. */
  onEdit: (edit: StrategyPovEdit) => void;
  /**
   * Rec ids whose backing cards have been cut in the queue. When `pov.leadMoveRecId` is in this
   * set, the lead sentence is removed from the rendered prose live (cut→sentence contract).
   */
  struckRecIds?: string[];
  /** Optional regenerate affordance (wired to useStrategyPov.regenerate by the parent). */
  onRegenerate?: () => void;
  isGenerating?: boolean;
  className?: string;
  title?: string;
  subtitle?: string;
  /** Opt-in prototype composition for the Engine spine. The default full editor is unchanged. */
  presentation?: 'default' | 'engine-summary';
  /** Truthful staged-move count used only by the Engine summary footer. */
  stagedCount?: number;
  /** Opens the canonical full-editor Drawer from the Engine summary. */
  onOpenEditor?: () => void;
}

const DEBOUNCE_MS = 700;

/** A label + edit toggle row shared by the prose and list editors. */
function FieldHeader({ label, editing, onToggle }: { label: string; editing: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="t-label text-[var(--brand-text-muted)] uppercase tracking-wide">{label}</span>
      <Button
        variant="ghost"
        size="sm"
        icon={Pencil}
        aria-label={`${editing ? 'Done editing' : 'Edit'} ${label}`}
        onClick={onToggle}
        className="px-1 py-0.5"
      />
    </div>
  );
}

/** Editable paragraph field. Click the pencil to edit; blur commits via onChange. */
function EditableProse({
  label,
  value,
  onChange,
  ariaLabel,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="space-y-1">
      <FieldHeader label={label} editing={editing} onToggle={() => setEditing(e => !e)} />
      {editing ? (
        <FormTextarea
          aria-label={ariaLabel}
          autoFocus
          value={value}
          onChange={onChange}
          onBlur={() => setEditing(false)}
          rows={Math.max(2, Math.ceil((value.length || 1) / 70))}
        />
      ) : (
        <p className="t-body text-[var(--brand-text)] whitespace-pre-wrap">{value || '—'}</p>
      )}
    </div>
  );
}

/** Editable bullet list (wins / flags). Each line is one item; blur commits the array. */
function EditableList({
  label,
  items,
  onChange,
  accentDot,
}: {
  label: string;
  items: string[];
  onChange: (next: string[]) => void;
  accentDot: string;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="space-y-1">
      <FieldHeader label={label} editing={editing} onToggle={() => setEditing(e => !e)} />
      {editing ? (
        <FormTextarea
          aria-label={`Edit ${label} list`}
          autoFocus
          value={items.join('\n')}
          onChange={next => onChange(next.split('\n'))}
          onBlur={() => {
            // Drop blank lines on commit.
            onChange(items.filter(i => i.trim().length > 0));
            setEditing(false);
          }}
          rows={Math.max(2, items.length + 1)}
        />
      ) : items.length > 0 ? (
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 t-body text-[var(--brand-text)]">
              <span
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-[var(--radius-pill)] ${accentDot}`}
                aria-hidden
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="t-caption-sm text-[var(--brand-text-muted)]">—</p>
      )}
    </div>
  );
}

export function DraftedPovEditor({
  pov,
  onEdit,
  struckRecIds,
  onRegenerate,
  isGenerating = false,
  className,
  title = 'The point of view',
  subtitle,
  presentation = 'default',
  stagedCount = 0,
  onOpenEditor,
}: DraftedPovEditorProps) {
  // Local draft mirrors the POV; edits flow through here and are emitted on a debounce.
  const [draft, setDraft] = useState<StrategyPovEdit>({});
  // Track ONLY the last-synced generatedAt so an EXTERNAL regenerate resets the local draft.
  // We must NOT key the reset on version/editedAt — those bump on the operator's own optimistic
  // PATCH, and resetting the draft mid-flight would wipe keystrokes typed during the in-flight
  // save (the lost-keystroke race). Only a regenerate (new generatedAt) is an external change.
  const lastGeneratedAtRef = useRef<string | null>(null);

  // The cut→sentence contract: when the lead move's rec id is cut, the lead sentence is gone.
  const leadCut = useMemo(
    () => !!pov?.leadMoveRecId && (struckRecIds ?? []).includes(pov.leadMoveRecId),
    [pov?.leadMoveRecId, struckRecIds],
  );

  // Resolved (rendered) values: local draft overrides the server POV per-field.
  const situation = draft.situation ?? pov?.situation ?? '';
  const leadSentence = draft.leadSentence ?? pov?.leadSentence ?? '';
  const wins = draft.wins ?? pov?.wins ?? [];
  const flags = draft.flags ?? pov?.flags ?? [];

  // When the server POV is regenerated (a NEW generatedAt), drop the local draft. Keyed on
  // generatedAt ONLY — a successful PATCH bumps version/editedAt but NOT generatedAt, so in-flight
  // edits survive the optimistic save round-trip (lost-keystroke fix).
  const generatedAt = pov?.generatedAt ?? null;
  useEffect(() => {
    if (generatedAt !== lastGeneratedAtRef.current) {
      lastGeneratedAtRef.current = generatedAt;
      setDraft({});
    }
  }, [generatedAt]);

  // Debounce the draft and emit only the changed fields.
  const debouncedDraft = useDebouncedValue(draft, DEBOUNCE_MS);
  useEffect(() => {
    if (Object.keys(debouncedDraft).length === 0) return;
    onEdit(debouncedDraft);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- emit on debounced draft change only; onEdit is parent-stable
  }, [debouncedDraft]);

  if (!pov) {
    return (
      <SectionCard
        title={title}
        subtitle={subtitle}
        titleIcon={subtitle ? (
          presentation === 'engine-summary'
            ? <Icon name="pencil" size="md" className="text-[var(--teal)]" />
            : <Icon as={Pencil} size="md" className="text-[var(--teal)]" />
        ) : undefined}
        iconChip={!!subtitle}
        className={className}
      >
        <EmptyState
          icon={Pencil}
          title="No point of view drafted yet"
          description={presentation === 'engine-summary'
            ? 'Generate a point of view from the current strategy and staged moves.'
            : 'Generate the issue to draft a curated point of view over your sent moves.'}
          action={
            onRegenerate ? (
              <Button
                variant="primary"
                size="sm"
                icon={RefreshCw}
                loading={isGenerating}
                disabled={isGenerating}
                onClick={onRegenerate}
              >
                Generate
              </Button>
            ) : undefined
          }
        />
      </SectionCard>
    );
  }

  if (presentation === 'engine-summary') {
    const moveWord = stagedCount === 1 ? 'move' : 'moves';
    return (
      <SectionCard
        title={title}
        subtitle={subtitle}
        titleIcon={subtitle ? <Icon name="pencil" size="md" className="text-[var(--teal)]" /> : undefined}
        iconChip={!!subtitle}
        className={className}
        action={onOpenEditor ? (
          <Button variant="secondary" size="sm" onClick={onOpenEditor}>
            <Icon name="pencil" size="sm" />
            Edit POV
          </Button>
        ) : undefined}
      >
        <div
          data-testid="drafted-pov-summary"
          className="relative rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)] px-4 py-3"
        >
          <div className="space-y-2.5 t-body leading-relaxed text-[var(--brand-text)]">
            {situation && <p className="whitespace-pre-wrap">{situation}</p>}
            {!leadCut && leadSentence && <p className="whitespace-pre-wrap">{leadSentence}</p>}
          </div>
          <div className="mt-3 border-t border-[var(--brand-border)] pt-3 t-caption-sm text-[var(--brand-text-muted)]">
            Draft auto-generated from your {stagedCount} staged {moveWord} · edited by you before send
          </div>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title={title}
      subtitle={subtitle}
      titleIcon={subtitle ? <Icon as={Pencil} size="md" className="text-[var(--teal)]" /> : undefined}
      iconChip={!!subtitle}
      className={className}
      action={
        onRegenerate ? (
          <Button
            variant="secondary"
            size="sm"
            icon={RefreshCw}
            loading={isGenerating}
            disabled={isGenerating}
            onClick={onRegenerate}
          >
            Regenerate
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <EditableProse
          label="Situation"
          value={situation}
          ariaLabel="Edit situation"
          onChange={next => setDraft(d => ({ ...d, situation: next }))}
        />

        {/* The one rec-linked sentence — disappears live when its backing move is cut. */}
        {!leadCut && (
          <EditableProse
            label="The one move I'd bring"
            value={leadSentence}
            ariaLabel="Edit lead sentence"
            onChange={next => setDraft(d => ({ ...d, leadSentence: next }))}
          />
        )}

        <EditableList
          label="Wins worth saying"
          items={wins}
          accentDot="bg-emerald-400"
          onChange={next => setDraft(d => ({ ...d, wins: next }))}
        />

        <EditableList
          label="What I'd flag"
          items={flags}
          accentDot="bg-amber-400"
          onChange={next => setDraft(d => ({ ...d, flags: next }))}
        />
      </div>
    </SectionCard>
  );
}

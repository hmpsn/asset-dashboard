/**
 * BackingMovesQueue — The Issue (Phase 1, Lane 1D)
 *
 * Archetype-grouped curation queue. Wraps the StrategyCockpit row model
 * (cockpitRowModel.ts), groups recs by recArchetype in ARCHETYPE_ORDER,
 * shortlists each group to shortlistCap with a "show the rest" toggle.
 *
 * Reuses CockpitRow + the existing keep/cut/park/send verbs (actions via
 * CockpitActions / useRecommendationLifecycle / useRecBulkMutation) and
 * CurationBulkActionBar verbatim. Exposes onCut(recId) for the cut→POV-sentence
 * contract consumed by DraftedPovEditor (Lane 1C integrator).
 *
 * Brand-law compliance: teal=action, blue=data, emerald=wins. No purple.
 * No TierGate. All tokens from src/tokens.css. Typography via .t-* utilities.
 */
import { useMemo, useState } from 'react';
import { Target, Plus } from 'lucide-react';
import { SectionCard, Icon, Button } from '../../ui';
import { CockpitRow } from '../CockpitRow';
import { CurationBulkActionBar } from '../CurationBulkActionBar';
import { sortRecs } from '../cockpitRowModel';
import { useCurationSelection } from '../hooks/useCurationSelection';
import { useRecBulkMutation } from '../../../hooks/admin/useRecBulkMutation';
import { ARCHETYPE_ORDER, ARCHETYPE_LABELS, recArchetype } from '../../../../shared/types/strategy-archetype';
import { ARCHETYPE_ACCENT } from '../../../lib/recArchetypeMap';
import type { Archetype } from '../../../../shared/types/strategy-archetype';
import type { CockpitActions } from '../cockpitTypes';
import type { Recommendation } from '../../../../shared/types/recommendations';
import type { RecWordingOverridePayload } from '../../../../shared/types/rec-operator-steering';

// ── Default shortlist cap (used when the prop is absent) ──────────────────────
const DEFAULT_SHORTLIST_CAP = 5;

// Per-row + bulk staging verbs (Blocker 5). The header "Send issue" button is the ONE commit, so
// every queue-level action stages only — the word "send" never appears at queue level.
const STAGE_ROW_LABEL = 'Stage for issue';
const STAGE_BULK_VERB = 'Stage';

// Group-dot color comes from the ONE shared ARCHETYPE_ACCENT map (recArchetypeMap.ts),
// imported by StanceBar too — so the stance legend dot and this group dot are byte-
// identical per archetype (the authority_bet teal/blue swap is fixed at the source).

export interface BackingMovesQueueProps {
  workspaceId: string;
  recs: Recommendation[];
  actions: CockpitActions;
  /** Called with the rec id when a rec is struck (cut). Consumed by the
   *  POV editor (Lane 1C) to remove the rec's sentence from the prose. */
  onCut: (recId: string) => void;
  /** Maximum recs shown per archetype group before a "show the rest" toggle.
   *  Defaults to DEFAULT_SHORTLIST_CAP (5). */
  shortlistCap?: number;
  /** Operator-steering wording edit (The Issue §11). Threaded down to each CockpitRow so the
   *  operator can correct a rec's title/insight inline. Optional — absent on any consumer that
   *  doesn't steer (the row renders unchanged), so the flag-OFF path stays byte-identical. */
  onEditWording?: (recId: string, payload: RecWordingOverridePayload) => void;
  /**
   * Blocker 5 live counter: N = staged (sendableRecIds.length) · M = already with client
   * (cockpitRecs.filter(isCuratedForClient).length). Both derived ONCE in the orchestrator from the
   * SAME rec set + shared predicate (numerator/denominator share a source). Rendered near the queue
   * header. Optional so other (future) consumers render the queue without the counter.
   */
  stagedCount?: number;
  curatedCount?: number;
  /**
   * Blocker 5 staging model. `stagedRecIds` is the orchestrator-owned set of recs queued for the
   * one commit (the header "Send issue"). `onStage` toggles one rec; `onStageMany` adds the bulk
   * selection. NEITHER writes to the client — staging is local selection only. When provided, the
   * per-row primary button + the bulk bar STAGE instead of sending.
   */
  stagedRecIds?: Set<string>;
  onStage?: (recId: string) => void;
  onStageMany?: (recIds: string[]) => void;
  /**
   * T3.5 — "Add a recommendation" action placed in the SectionCard header (queue header slot).
   * When provided, renders a compact "+ Add a recommendation" button alongside the counter.
   * Absent on consumers that don't support manual rec creation.
   */
  onAddRec?: () => void;
}

/**
 * A single archetype group: header + capped list + optional "show N more" toggle.
 * Selection is managed externally (all-queue flat list via useCurationSelection).
 */
function ArchetypeGroup({
  archetype,
  recs,
  shortlistCap,
  actions,
  onCut,
  selectionState,
  onEditWording,
  sendLabel,
  stagedRecIds,
  onStage,
}: {
  archetype: Archetype;
  recs: Recommendation[];
  shortlistCap: number;
  actions: CockpitActions;
  onCut: (recId: string) => void;
  selectionState: {
    isSelected: (id: string) => boolean;
    toggle: (id: string) => void;
  };
  onEditWording?: (recId: string, payload: RecWordingOverridePayload) => void;
  /** Per-row send label threaded to each CockpitRow ("Stage for issue" in the Issue cockpit). */
  sendLabel: string;
  /** Blocker 5 staging — the staged set + the toggle, threaded to each CockpitRow. */
  stagedRecIds?: Set<string>;
  onStage?: (recId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const capped = !expanded && recs.length > shortlistCap;
  const visible = capped ? recs.slice(0, shortlistCap) : recs;
  const hiddenCount = recs.length - shortlistCap;

  // Wrap actions to intercept strike → onCut
  const wrappedActions: CockpitActions = {
    ...actions,
    strike: (recId: string) => {
      actions.strike(recId);
      onCut(recId);
    },
  };

  return (
    <div className="space-y-2">
      {/* Group header */}
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-2 w-2 rounded-[var(--radius-pill)] shrink-0 ${ARCHETYPE_ACCENT[archetype]}`}
          aria-hidden
        />
        <h3 className="t-caption font-semibold text-[var(--brand-text-bright)]">
          {ARCHETYPE_LABELS[archetype]}
          <span className="ml-1.5 t-caption-sm text-[var(--brand-text-muted)] font-normal">
            {recs.length}
          </span>
        </h3>
      </div>

      {/* Rec rows */}
      {visible.map((r) => (
        <CockpitRow
          key={r.id}
          rec={r}
          actions={wrappedActions}
          selected={selectionState.isSelected(r.id)}
          onToggleSelect={selectionState.toggle}
          onEditWording={onEditWording}
          sendLabel={sendLabel}
          onStage={onStage}
          staged={stagedRecIds?.has(r.id) ?? false}
        />
      ))}

      {/* "Show the rest" affordance */}
      {capped && (
        <Button
          variant="ghost"
          size="sm"
          className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-transparent ml-4"
          onClick={() => setExpanded(true)}
          aria-label={`Show ${hiddenCount} more in ${ARCHETYPE_LABELS[archetype]}`}
        >
          Show {hiddenCount} more
        </Button>
      )}
    </div>
  );
}

/**
 * BackingMovesQueue — archetype-grouped curation queue for The Issue cockpit.
 *
 * Groups all recs by recArchetype in ARCHETYPE_ORDER. Empty groups are skipped.
 * Each group is shortlisted to shortlistCap with a "show the rest" toggle.
 * Reuses CockpitRow + CurationBulkActionBar verbatim.
 *
 * Exposes onCut(recId) — fired when any rec is struck — for the cut→POV-sentence
 * contract with DraftedPovEditor (Lane 1C integration).
 */
export function BackingMovesQueue({
  workspaceId,
  recs,
  actions,
  onCut,
  shortlistCap = DEFAULT_SHORTLIST_CAP,
  onEditWording,
  stagedCount,
  curatedCount,
  stagedRecIds,
  onStage,
  onStageMany,
  onAddRec,
}: BackingMovesQueueProps) {
  // Group recs by archetype, preserving ARCHETYPE_ORDER
  const groups = useMemo(() => {
    // Sort by value within each group (consistent with the plain cockpit's default sort)
    const sorted = sortRecs(recs, 'value');

    const grouped = new Map<Archetype, Recommendation[]>();
    for (const arch of ARCHETYPE_ORDER) {
      grouped.set(arch, []);
    }
    for (const rec of sorted) {
      const arch = recArchetype(rec.type);
      grouped.get(arch)!.push(rec);
    }
    // Return only groups with at least one rec, in ARCHETYPE_ORDER
    return ARCHETYPE_ORDER
      .filter((arch) => (grouped.get(arch)?.length ?? 0) > 0)
      .map((arch) => ({ archetype: arch, recs: grouped.get(arch)! }));
  }, [recs]);

  // Flat list of all rec ids (for the bulk selection predicate)
  const allIds = useMemo(() => recs.map((r) => r.id), [recs]);
  const sel = useCurationSelection(allIds);

  const bulk = useRecBulkMutation(workspaceId);

  const titleIcon = <Icon as={Target} size="md" className="text-accent-brand" />;

  // Blocker 5 live counter, rendered as part of the SectionCard action slot. N and M share the
  // orchestrator's single rec set + the shared isCuratedForClient predicate
  // (numerator/denominator-share-a-source). Only rendered when both counts are provided (the Issue
  // cockpit always passes them).
  // T3.5 — "Add a recommendation" button (onAddRec) is placed here in the header action slot so
  // the operator can mint a rec without leaving the queue context. Rendered only when onAddRec is
  // provided so the queue stays usable by future consumers that don't support manual rec creation.
  const counterEl =
    stagedCount !== undefined && curatedCount !== undefined ? (
      <span className="flex items-center gap-3">
        <span className="t-caption-sm text-[var(--brand-text-muted)] tabular-nums" data-testid="backing-moves-counter">
          {stagedCount} staged · {curatedCount} already with client
        </span>
        {onAddRec && (
          <Button
            variant="ghost"
            size="sm"
            icon={Plus}
            onClick={onAddRec}
            data-testid="queue-add-rec-btn"
          >
            Add a recommendation
          </Button>
        )}
      </span>
    ) : onAddRec ? (
      <Button
        variant="ghost"
        size="sm"
        icon={Plus}
        onClick={onAddRec}
        data-testid="queue-add-rec-btn"
      >
        Add a recommendation
      </Button>
    ) : undefined;

  if (groups.length === 0) {
    return (
      <SectionCard title="Backing moves" titleIcon={titleIcon} action={counterEl}>
        <p className="t-caption-sm text-[var(--brand-text-muted)] py-6 text-center">
          No recommendations to back the issue yet.
        </p>
      </SectionCard>
    );
  }

  return (
    <>
      <SectionCard title="Backing moves" titleIcon={titleIcon} action={counterEl}>
        <div className="space-y-6">
          {groups.map(({ archetype, recs: groupRecs }) => (
            <ArchetypeGroup
              key={archetype}
              archetype={archetype}
              recs={groupRecs}
              shortlistCap={shortlistCap}
              actions={actions}
              onCut={onCut}
              selectionState={sel}
              onEditWording={onEditWording}
              sendLabel={STAGE_ROW_LABEL}
              stagedRecIds={stagedRecIds}
              onStage={onStage}
            />
          ))}
        </div>
      </SectionCard>

      {/* Sticky bulk-action bar — outside the SectionCard so fixed positioning isn't clipped.
          sendVerb="Stage" so the bulk action reads "Stage N". Blocker 5: "Stage N" STAGES the
          selection (no client write) — the one client commit is the header "Send issue". Throttle /
          strike remain real bulk mutations (they are not client sends). */}
      <CurationBulkActionBar
        selectedCount={sel.selectedCount}
        isAllInFilter={sel.isAllInFilter}
        isPending={bulk.isPending}
        onClear={sel.clear}
        sendVerb={STAGE_BULK_VERB}
        onAction={(action, throttleDays) => {
          if (action === 'send') {
            // Stage the selected recs (local set) — NOT a client send.
            onStageMany?.(sel.resolveSelectedIds());
            sel.clear();
            return;
          }
          bulk.mutate({
            recIds: sel.resolveSelectedIds(),
            action,
            throttleDays,
            confirmStrike: action === 'strike',
          });
        }}
      />
    </>
  );
}

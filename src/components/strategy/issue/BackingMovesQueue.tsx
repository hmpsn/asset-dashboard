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
import { Target } from 'lucide-react';
import { SectionCard, Icon, Button } from '../../ui';
import { CockpitRow } from '../CockpitRow';
import { CurationBulkActionBar } from '../CurationBulkActionBar';
import { sortRecs } from '../cockpitRowModel';
import { useCurationSelection } from '../hooks/useCurationSelection';
import { useRecBulkMutation } from '../../../hooks/admin/useRecBulkMutation';
import { ARCHETYPE_ORDER, ARCHETYPE_LABELS, recArchetype } from '../../../../shared/types/strategy-archetype';
import type { Archetype } from '../../../../shared/types/strategy-archetype';
import type { CockpitActions } from '../StrategyCockpit';
import type { Recommendation } from '../../../../shared/types/recommendations';

// ── Default shortlist cap (used when the prop is absent) ──────────────────────
const DEFAULT_SHORTLIST_CAP = 5;

// ── Per-archetype accent dot for the group header ─────────────────────────────
// Brand-law: teal=action, blue=data, emerald=wins. No purple anywhere.
const ARCHETYPE_ACCENT_SAFE: Record<Archetype, string> = {
  authority_bet: 'bg-blue-500',
  refresh_reclaim: 'bg-teal-500',
  defend: 'bg-amber-500',
  quick_win: 'bg-emerald-500',
  technical: 'bg-[var(--zinc-600)]',
  local: 'bg-cyan-600',
};

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
          className={`inline-block h-2 w-2 rounded-full shrink-0 ${ARCHETYPE_ACCENT_SAFE[archetype]}`} // rounded-literal-ok: circular bullet indicator, no standard --radius-* equivalent
          aria-hidden
        />
        <h3 className="t-caption font-semibold text-[var(--brand-text-bright)]" role="heading">
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

  if (groups.length === 0) {
    return (
      <SectionCard title="Backing moves" titleIcon={titleIcon}>
        <p className="t-caption-sm text-[var(--brand-text-muted)] py-6 text-center">
          No recommendations to back the issue yet.
        </p>
      </SectionCard>
    );
  }

  return (
    <>
      <SectionCard title="Backing moves" titleIcon={titleIcon}>
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
            />
          ))}
        </div>
      </SectionCard>

      {/* Sticky bulk-action bar — outside the SectionCard so fixed positioning isn't clipped. */}
      <CurationBulkActionBar
        selectedCount={sel.selectedCount}
        isAllInFilter={sel.isAllInFilter}
        isPending={bulk.isPending}
        onClear={sel.clear}
        onAction={(action, throttleDays) =>
          bulk.mutate({
            recIds: sel.resolveSelectedIds(),
            action,
            throttleDays,
            confirmStrike: action === 'strike',
          })
        }
      />
    </>
  );
}

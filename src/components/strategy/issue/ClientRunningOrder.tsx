/**
 * ClientRunningOrder — The Issue operator-steering verb 3 (spec §12): reorder the client-facing
 * running order. Lists the curated/sent recs (already in front of the client) in their client order
 * with up/down controls; each move recomputes the full ordered id list and persists it via
 * `onReorder` → PATCH /api/recommendations/:ws/reorder → `sort_order` in `rec_operator_override`.
 *
 * This is DECOUPLED from the archetype-grouped BackingMovesQueue (the curation view) — it is purely
 * the client-facing order, so it never fights the grouping. The public client projection orders by
 * the same `sort_order` (operator-ordered first ascending, the rest by natural order), flag-gated.
 *
 * The `isCuratedForClient` predicate is replicated INLINE (no server import): a rec is in front of
 * the client when its clientStatus is one of {sent, approved, discussing} AND it is not struck.
 *
 * Tokens: src/tokens.css only. Color law: teal=action, NO purple. Mounts under the
 * strategy-the-issue flag (parent gates) — byte-identical OFF.
 */
import { useMemo } from 'react';
import { ChevronUp, ChevronDown, ListOrdered } from 'lucide-react';
import { SectionCard, EmptyState, IconButton, Icon } from '../../ui';
import type { Recommendation } from '../../../../shared/types/recommendations';

interface ClientRunningOrderProps {
  recs: Recommendation[];
  /** recId → client-facing sort position (lower = earlier). From useOperatorSteering. */
  sortOrder: Record<string, number>;
  /** Persist the full ordered id list (the curated recs in desired client order). */
  onReorder: (orderedIds: string[]) => void;
  isPending?: boolean;
}

/** In front of the client: clientStatus ∈ {sent, approved, discussing} AND not struck.
 *  Replicated inline (no server import) — mirrors the public projection's curated set. */
function isCuratedForClient(rec: Recommendation): boolean {
  if (rec.lifecycle === 'struck') return false;
  return (
    rec.clientStatus === 'sent' ||
    rec.clientStatus === 'approved' ||
    rec.clientStatus === 'discussing'
  );
}

export function ClientRunningOrder({ recs, sortOrder, onReorder, isPending = false }: ClientRunningOrderProps) {
  // Curated recs in client order: those with an explicit sortOrder first (ascending), then the
  // rest by impactScore desc — the same precedence the public projection applies server-side.
  const ordered = useMemo(() => {
    const curated = recs.filter(isCuratedForClient);
    return [...curated].sort((a, b) => {
      const ao = sortOrder[a.id];
      const bo = sortOrder[b.id];
      const aHas = ao !== undefined;
      const bHas = bo !== undefined;
      if (aHas && bHas) return ao - bo;
      if (aHas) return -1;
      if (bHas) return 1;
      return b.impactScore - a.impactScore;
    });
  }, [recs, sortOrder]);

  const titleIcon = <Icon as={ListOrdered} size="md" className="text-accent-brand" />;

  if (ordered.length === 0) {
    return (
      <SectionCard title="Client running order" titleIcon={titleIcon}>
        <EmptyState
          icon={ListOrdered}
          title="Nothing sent yet"
          description="Send moves to the client and they'll appear here in the order they read them. Drag the order with the up/down controls."
        />
      </SectionCard>
    );
  }

  // Swap two adjacent positions and persist the full new id list.
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    const ids = ordered.map((r) => r.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    onReorder(ids);
  };

  return (
    <SectionCard title="Client running order" titleIcon={titleIcon}>
      <ol className="space-y-2">
        {ordered.map((rec, i) => (
          <li
            key={rec.id}
            className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] py-2 pl-3 pr-2"
          >
            <span className="t-caption-sm text-[var(--brand-text-muted)] w-5 shrink-0 text-right tabular-nums">
              {i + 1}
            </span>
            <span className="t-ui text-[var(--brand-text)] truncate flex-1 min-w-0">{rec.title}</span>
            <div className="flex items-center gap-0.5 shrink-0">
              <IconButton
                icon={ChevronUp}
                label={`Move "${rec.title}" up`}
                size="sm"
                variant="ghost"
                disabled={isPending || i === 0}
                onClick={() => move(i, -1)}
              />
              <IconButton
                icon={ChevronDown}
                label={`Move "${rec.title}" down`}
                size="sm"
                variant="ghost"
                disabled={isPending || i === ordered.length - 1}
                onClick={() => move(i, 1)}
              />
            </div>
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}

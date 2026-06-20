import { useEffect, useMemo, useState } from 'react';
import { Target } from 'lucide-react';
import { SectionCard, Icon, Button } from '../ui';
import { CockpitRow } from './CockpitRow';
import { CurationMeter } from './CurationMeter';
import { NeedsAttentionStrip, type AttentionKind } from './NeedsAttentionStrip';
import { CurationBulkActionBar } from './CurationBulkActionBar';
import { buildAttentionItems, countSentThisCycle } from './cockpitAttention';
import { recActCategory, ACT_CATEGORIES, type ActCategory } from '../../lib/recCategoryMap';
import {
  toCockpitRow, partitionByLifecycle, bucketOf, sortRecs, FIX_NOW_CAP,
  type LifecycleBucket, type CockpitSort,
} from './cockpitRowModel';
import { useToggleSet, UNBOUNDED_TOGGLE_SET_OPTIONS } from '../../hooks/useToggleSet';
import { useCurationSelection } from './hooks/useCurationSelection';
import { useRecBulkMutation } from '../../hooks/admin/useRecBulkMutation';
import type { Recommendation } from '../../../shared/types/recommendations';

export interface CockpitActions {
  send: (recId: string, note?: string) => void;
  strike: (recId: string) => void;
  unstrike: (recId: string) => void;
  throttle: (recId: string, days: 7 | 30 | 90) => void;
  fix: (recId: string) => void;
  isPending: boolean;
}

interface StrategyCockpitProps {
  workspaceId: string;
  recs: Recommendation[];
  actions: CockpitActions;
}

const LIFECYCLE_TABS: ReadonlyArray<{ id: LifecycleBucket; label: string }> = [
  { id: 'active', label: 'Active' },
  { id: 'sent', label: 'Sent' },
  { id: 'approved', label: 'Approved' },
  { id: 'throttled', label: 'Throttled' },
];

const CATEGORY_LABELS: Record<ActCategory, string> = {
  content: 'Content',
  technical: 'Technical',
  'quick-win': 'Quick wins',
};

const SORTS: ReadonlyArray<{ id: CockpitSort; label: string }> = [
  { id: 'value', label: 'Value' },
  { id: 'impact', label: 'Impact' },
  { id: 'age', label: 'Age' },
];

/** Strategy v3 admin Curation Cockpit (spec §4) — the Overview-tab hero. Fix-now pin +
 *  lifecycle segmented control + category toggle chips + sort, rendering the v3 CockpitRow.
 *  Pure: recs + lifecycle actions are injected by the host (Lane C wiring).
 *
 *  The Issue's archetype grouping + per-group shortlist live entirely in BackingMovesQueue (a
 *  sibling component, not a child), so this cockpit takes NO additive props — the flag-OFF
 *  command-center path is byte-identical. */
export function StrategyCockpit({ workspaceId, recs, actions }: StrategyCockpitProps) {
  const [bucket, setBucket] = useState<LifecycleBucket>('active');
  // useToggleSet with min:0 (all categories optional = "show all"), max:unbounded.
  const [cats, toggleCat, setCats] = useToggleSet<ActCategory>([], UNBOUNDED_TOGGLE_SET_OPTIONS);
  const [sort, setSort] = useState<CockpitSort>('value');

  const lifeCounts = useMemo(() => partitionByLifecycle(recs), [recs]);

  // Self-managing attention strip + curation meter — derived client-side from the rec set.
  const attentionItems = useMemo(() => buildAttentionItems(recs), [recs]);
  const sentThisCycle = useMemo(() => countSentThisCycle(recs), [recs]);

  // Jump the operator to the rec so the attention CTA lands on it in the faceted list.
  const handleAttentionAct = (recId: string, _kind: AttentionKind) => {
    const rec = recs.find((r) => r.id === recId);
    if (!rec) return;
    setBucket(bucketOf(rec));
    if (cats.size > 0) setCats(new Set());
  };

  // Fix-now pin: capped, by value, visible regardless of the active bucket/category chip.
  const fixNow = useMemo(
    () => sortRecs(recs.filter((r) => toCockpitRow(r).isFixNow), 'value').slice(0, FIX_NOW_CAP),
    [recs],
  );

  const inBucket = useMemo(() => recs.filter((r) => bucketOf(r) === bucket), [recs, bucket]);

  const catCounts = useMemo(() => {
    const c: Record<ActCategory, number> = { content: 0, technical: 0, 'quick-win': 0 };
    for (const r of inBucket) c[recActCategory(r.type)] += 1;
    return c;
  }, [inBucket]);

  const visible = useMemo(() => {
    const filtered = cats.size === 0 ? inBucket : inBucket.filter((r) => cats.has(recActCategory(r.type)));
    return sortRecs(filtered, sort);
  }, [inBucket, cats, sort]);

  // Bulk-curation selection is scoped to the faceted (visible) set — the "all-in-filter" predicate
  // resolves against exactly these ids, so it stays in sync with the active bucket + category + sort.
  const visibleIds = useMemo(() => visible.map((r) => r.id), [visible]);
  const sel = useCurationSelection(visibleIds);

  // Clear selection when the filter basis (bucket or category set) changes — but NOT on every
  // visibleIds identity change (it re-identifies on every recs refetch, nuking in-progress work).
  const catsKey = useMemo(() => [...cats].sort().join(','), [cats]);
  useEffect(() => { sel.clear(); }, [bucket, catsKey]); // eslint-disable-line react-hooks/exhaustive-deps -- reset selection only when the filter basis (bucket/cats) changes; sel.clear is a stable useCallback

  const bulk = useRecBulkMutation(workspaceId);

  const titleIcon = <Icon as={Target} size="md" className="text-accent-brand" />;

  return (
    <>
    <SectionCard title="Curate recommendations" titleIcon={titleIcon}>
      <div className="space-y-4">
        {/* Self-managing header: curation meter + needs-attention strip (both render null when empty) */}
        <CurationMeter sentThisCycle={sentThisCycle} />
        <NeedsAttentionStrip items={attentionItems} onAct={handleAttentionAct} />

        {/* Fix now pin */}
        {fixNow.length > 0 && (
          <div className="space-y-2">
            <div className="t-caption text-[var(--brand-text-muted)] uppercase tracking-wide">
              Fix now · {fixNow.length}
            </div>
            {fixNow.map((r) => <CockpitRow key={`fix-${r.id}`} rec={r} actions={actions} />)}
          </div>
        )}

        {/* Lifecycle segmented control (single-select) */}
        <div className="flex flex-wrap items-center gap-1 rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)] p-1 w-fit">
          {LIFECYCLE_TABS.map((t) => (
            <Button
              key={t.id}
              variant="ghost"
              size="sm"
              aria-pressed={bucket === t.id}
              className={`rounded-[var(--radius-md)] t-ui ${
                bucket === t.id
                  ? 'bg-[var(--teal)] text-[var(--button-primary-text)] font-semibold hover:bg-[var(--teal)]'
                  : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-transparent'
              }`}
              onClick={() => setBucket(t.id)}
            >
              {t.label} {lifeCounts[t.id]}
            </Button>
          ))}
        </div>

        {/* Category toggle chips (multi-select) + sort */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {ACT_CATEGORIES.map((cat) => (
              <Button
                key={cat}
                variant="ghost"
                size="sm"
                aria-pressed={cats.has(cat)}
                className={`rounded-[var(--radius-pill)] border t-caption-sm hover:bg-transparent ${
                  cats.has(cat)
                    ? 'border-[var(--teal)] text-accent-brand hover:text-accent-brand'
                    : 'border-[var(--brand-border)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'
                }`}
                onClick={() => toggleCat(cat)}
              >
                {CATEGORY_LABELS[cat]} {catCounts[cat]}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="t-caption-sm text-[var(--brand-text-muted)]">Sort</span>
            {SORTS.map((s) => (
              <Button
                key={s.id}
                variant="ghost"
                size="sm"
                aria-pressed={sort === s.id}
                className={`t-caption-sm hover:bg-transparent ${
                  sort === s.id ? 'text-accent-brand hover:text-accent-brand' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'
                }`}
                onClick={() => setSort(s.id)}
              >
                {s.label}
              </Button>
            ))}
          </div>
        </div>

        {/* The faceted list */}
        <div className="space-y-2">
          {visible.length > 0 && (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={sel.isAllInFilter}
                className={`t-caption-sm hover:bg-transparent ${
                  sel.isAllInFilter ? 'text-accent-brand hover:text-accent-brand' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'
                }`}
                onClick={sel.selectAllInFilter}
              >
                Select all {visible.length}
              </Button>
              {sel.selectedCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-transparent"
                  onClick={sel.clear}
                >
                  Clear
                </Button>
              )}
            </div>
          )}
          {visible.map((r) => (
            <CockpitRow
              key={r.id}
              rec={r}
              actions={actions}
              selected={sel.isSelected(r.id)}
              onToggleSelect={sel.toggle}
            />
          ))}
          {visible.length === 0 && (
            <p className="t-caption-sm text-[var(--brand-text-muted)] py-6 text-center">
              Nothing in this view. Switch lifecycle or clear a category filter.
            </p>
          )}
        </div>
      </div>
    </SectionCard>

    {/* Sticky bulk-action bar — outside the SectionCard so its fixed positioning isn't clipped. */}
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

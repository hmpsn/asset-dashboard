import { useMemo, useState } from 'react';
import { Target } from 'lucide-react';
import { SectionCard, Icon } from '../ui';
import { CockpitRow } from './CockpitRow';
import { recActCategory, ACT_CATEGORIES, type ActCategory } from '../../lib/recCategoryMap';
import {
  toCockpitRow, partitionByLifecycle, bucketOf, sortRecs, FIX_NOW_CAP,
  type LifecycleBucket, type CockpitSort,
} from './cockpitRowModel';
import { useToggleSet, UNBOUNDED_TOGGLE_SET_OPTIONS } from '../../hooks/useToggleSet';
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
 *  Pure: recs + lifecycle actions are injected by the host (Lane C wiring). */
export function StrategyCockpit({ recs, actions }: StrategyCockpitProps) {
  const [bucket, setBucket] = useState<LifecycleBucket>('active');
  // useToggleSet with min:0 (all categories optional = "show all"), max:unbounded.
  const [cats, toggleCat] = useToggleSet<ActCategory>([], UNBOUNDED_TOGGLE_SET_OPTIONS);
  const [sort, setSort] = useState<CockpitSort>('value');

  const lifeCounts = useMemo(() => partitionByLifecycle(recs), [recs]);

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

  const titleIcon = <Icon as={Target} size="md" className="text-accent-brand" />;

  return (
    <SectionCard title="Curate recommendations" titleIcon={titleIcon}>
      <div className="space-y-4">
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
        <div className="flex flex-wrap items-center gap-1 rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-1 w-fit">
          {LIFECYCLE_TABS.map((t) => (
            // button-ok — segmented-control tab; Button has no segmented-control variant
            <button
              key={t.id}
              type="button"
              aria-pressed={bucket === t.id}
              className={`rounded-[var(--radius-md)] px-3 py-1.5 t-ui ${
                bucket === t.id
                  ? 'bg-[var(--teal)] text-[var(--button-primary-text)] font-semibold'
                  : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'
              }`}
              onClick={() => setBucket(t.id)}
            >
              {t.label} {lifeCounts[t.id]}
            </button>
          ))}
        </div>

        {/* Category toggle chips (multi-select) + sort */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {ACT_CATEGORIES.map((cat) => (
              // button-ok — category toggle chip; Button primitive has no chip/pill variant
              <button
                key={cat}
                type="button"
                aria-pressed={cats.has(cat)}
                className={`rounded-[var(--radius-pill)] border px-3 py-1 t-caption-sm ${
                  cats.has(cat)
                    ? 'border-[var(--teal)] text-accent-brand'
                    : 'border-[var(--brand-border)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'
                }`}
                onClick={() => toggleCat(cat)}
              >
                {CATEGORY_LABELS[cat]} {catCounts[cat]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="t-caption-sm text-[var(--brand-text-muted)]">Sort</span>
            {SORTS.map((s) => (
              // button-ok — sort chip; Button primitive has no inline sort-chip variant
              <button
                key={s.id}
                type="button"
                aria-pressed={sort === s.id}
                className={`rounded-[var(--radius-md)] px-2 py-1 t-caption-sm ${
                  sort === s.id ? 'text-accent-brand' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'
                }`}
                onClick={() => setSort(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* The faceted list */}
        <div className="space-y-2">
          {visible.map((r) => <CockpitRow key={r.id} rec={r} actions={actions} />)}
          {visible.length === 0 && (
            <p className="t-caption-sm text-[var(--brand-text-muted)] py-6 text-center">
              Nothing in this view. Switch lifecycle or clear a category filter.
            </p>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

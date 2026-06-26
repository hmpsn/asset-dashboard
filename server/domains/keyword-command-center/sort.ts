import type { KeywordCommandCenterSort } from '../../../shared/types/keyword-command-center.js';

export type ExplicitKeywordCommandCenterSort = Exclude<KeywordCommandCenterSort, 'priority'>;

/** Per-type field readers. `null`/`undefined` numeric values mean "missing". */
export interface SortFieldAccessors<T> {
  keyword: (item: T) => string;
  demand: (item: T) => number | null | undefined;
  rank: (item: T) => number | null | undefined;
  clicks: (item: T) => number | null | undefined;
  difficulty: (item: T) => number | null | undefined;
  /** Opportunity score (0-100): volume-weighted times ease. The default Hub sort. */
  opportunity: (item: T) => number | null | undefined;
}

/**
 * Natural sort directions when `direction` is absent. `keyword`/`rank` ascend
 * (A-Z, position 1 first); `demand`/`clicks`/`difficulty` descend (biggest
 * first). An explicit `direction` always overrides these.
 */
const NATURAL_SORT_DIRECTION: Record<ExplicitKeywordCommandCenterSort, 'asc' | 'desc'> = {
  keyword: 'asc',
  rank: 'asc',
  demand: 'desc',
  clicks: 'desc',
  difficulty: 'desc',
  opportunity: 'desc',
};

/**
 * Compare two possibly-missing numeric metric values such that missing values
 * always sort last regardless of direction.
 */
function compareMetric(
  a: number | null | undefined,
  b: number | null | undefined,
  direction: 'asc' | 'desc',
): number {
  const aMissing = a == null || Number.isNaN(a);
  const bMissing = b == null || Number.isNaN(b);
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return direction === 'asc' ? a - b : b - a;
}

/**
 * Shared comparator for explicit, directioned KCC sorts. Row and candidate
 * pipelines both consume this so page-bounded candidate order cannot drift from
 * full-row order.
 */
export function keywordSortComparator<T>(
  sort: ExplicitKeywordCommandCenterSort,
  direction: 'asc' | 'desc' | undefined,
  accessors: SortFieldAccessors<T>,
): (a: T, b: T) => number {
  const dir = direction ?? NATURAL_SORT_DIRECTION[sort];
  const tiebreak = (a: T, b: T) => accessors.keyword(a).localeCompare(accessors.keyword(b));
  if (sort === 'keyword') {
    return (a, b) => {
      const cmp = accessors.keyword(a).localeCompare(accessors.keyword(b));
      return dir === 'asc' ? cmp : -cmp;
    };
  }
  const read: (item: T) => number | null | undefined =
    sort === 'demand' ? accessors.demand
      : sort === 'rank' ? accessors.rank
        : sort === 'clicks' ? accessors.clicks
          : sort === 'opportunity' ? accessors.opportunity
            : accessors.difficulty;
  return (a, b) => {
    const cmp = compareMetric(read(a), read(b), dir);
    if (cmp !== 0) return cmp;
    return tiebreak(a, b);
  };
}

import { describe, it, expect } from 'vitest';
import { matchesFilters, sortItems, DEFAULT_FILTERS, filtersFromParams, estToHours } from '../../src/lib/roadmapFilters.js';
import type { RoadmapItem } from '../../shared/types/roadmap.js';

const base: RoadmapItem = {
  id: 1, title: 'Test', source: 'test', est: '1h',
  priority: 'P1', notes: '', status: 'pending',
};

describe('matchesFilters', () => {
  it('returns true when all filters are "all"', () => {
    expect(matchesFilters(base, DEFAULT_FILTERS, 'backlog')).toBe(true);
  });

  it('filters by priority', () => {
    expect(matchesFilters(base, { ...DEFAULT_FILTERS, priority: 'P0' }, 'backlog')).toBe(false);
    expect(matchesFilters(base, { ...DEFAULT_FILTERS, priority: 'P1' }, 'backlog')).toBe(true);
  });

  it('filters by status', () => {
    expect(matchesFilters(base, { ...DEFAULT_FILTERS, status: 'done' }, 'backlog')).toBe(false);
    expect(matchesFilters(base, { ...DEFAULT_FILTERS, status: 'pending' }, 'backlog')).toBe(true);
  });

  it('filters by sprint id', () => {
    expect(matchesFilters(base, { ...DEFAULT_FILTERS, sprint: 'backlog' }, 'backlog')).toBe(true);
    expect(matchesFilters(base, { ...DEFAULT_FILTERS, sprint: 'other' }, 'backlog')).toBe(false);
  });

  it('filters by tags with OR semantics', () => {
    const tagged: RoadmapItem = { ...base, tags: ['auth', 'infra'] };
    expect(matchesFilters(tagged, { ...DEFAULT_FILTERS, tags: 'auth' }, 'backlog')).toBe(true);
    expect(matchesFilters(tagged, { ...DEFAULT_FILTERS, tags: 'infra,analytics' }, 'backlog')).toBe(true);
    expect(matchesFilters(tagged, { ...DEFAULT_FILTERS, tags: 'analytics' }, 'backlog')).toBe(false);
    expect(matchesFilters(base, { ...DEFAULT_FILTERS, tags: 'auth' }, 'backlog')).toBe(false);
  });

  it('filters by featureId (compared as string)', () => {
    const withFeature: RoadmapItem = { ...base, featureId: 5 };
    expect(matchesFilters(withFeature, { ...DEFAULT_FILTERS, feature: '5' }, 'backlog')).toBe(true);
    expect(matchesFilters(withFeature, { ...DEFAULT_FILTERS, feature: '6' }, 'backlog')).toBe(false);
    expect(matchesFilters(base, { ...DEFAULT_FILTERS, feature: '5' }, 'backlog')).toBe(false);
  });
});

describe('sortItems', () => {
  type FlatItem = RoadmapItem & { sprintId: string; sprintName: string };
  const items: FlatItem[] = [
    { ...base, id: 3, priority: 'P2', status: 'pending', sprintId: 'a', sprintName: 'A' },
    { ...base, id: 1, priority: 'P0', status: 'done', sprintId: 'b', sprintName: 'B' },
    { ...base, id: 2, priority: 'P1', status: 'in_progress', sprintId: 'c', sprintName: 'C' },
  ];

  it('sorts by priority asc (P0 first)', () => {
    const sorted = sortItems(items, 'priority', 'asc');
    expect(sorted.map(i => i.priority)).toEqual(['P0', 'P1', 'P2']);
  });

  it('sorts by priority desc (P4 first)', () => {
    const sorted = sortItems(items, 'priority', 'desc');
    expect(sorted.map(i => i.priority)).toEqual(['P2', 'P1', 'P0']);
  });

  it('sorts by status asc — in_progress → pending → done', () => {
    const sorted = sortItems(items, 'status', 'asc');
    expect(sorted.map(i => i.status)).toEqual(['in_progress', 'pending', 'done']);
  });

  it('sorts by id asc', () => {
    const sorted = sortItems(items, 'id', 'asc');
    expect(sorted.map(i => i.id)).toEqual([1, 2, 3]);
  });

  it('does not mutate the original array', () => {
    const original = items.map(i => i.id);
    sortItems(items, 'priority', 'asc');
    expect(items.map(i => i.id)).toEqual(original);
  });

  it('sorts by est without crashing when some items have undefined est', () => {
    const mixed: FlatItem[] = [
      { ...base, id: 1, est: '4h', sprintId: 'a', sprintName: 'A' },
      { ...base, id: 2, est: undefined, sprintId: 'b', sprintName: 'B' },
      { ...base, id: 3, est: '2h', sprintId: 'c', sprintName: 'C' },
    ];
    expect(() => sortItems(mixed, 'est', 'asc')).not.toThrow();
  });
});

describe('filtersFromParams', () => {
  it('coerces empty/missing params to "all"', () => {
    const f = filtersFromParams(new URLSearchParams(''));
    expect(f).toEqual(DEFAULT_FILTERS);
  });

  it('coerces malformed enum values to "all"', () => {
    const f = filtersFromParams(new URLSearchParams('priority=BOGUS&status=invalid'));
    expect(f.priority).toBe('all');
    expect(f.status).toBe('all');
  });

  it('treats empty string params as "all"', () => {
    const f = filtersFromParams(new URLSearchParams('priority=&status=&sprint=&feature=&tags='));
    expect(f).toEqual(DEFAULT_FILTERS);
  });

  it('passes through valid enum and freeform values', () => {
    const f = filtersFromParams(new URLSearchParams('priority=P0&status=done&sprint=s1&feature=42&tags=auth,infra'));
    expect(f.priority).toBe('P0');
    expect(f.status).toBe('done');
    expect(f.sprint).toBe('s1');
    expect(f.feature).toBe('42');
    expect(f.tags).toBe('auth,infra');
  });
});

describe('matchesFilters tag edge cases', () => {
  it('treats empty selected tag list (just commas) as match-all', () => {
    expect(matchesFilters(base, { ...DEFAULT_FILTERS, tags: ',,' }, 'backlog')).toBe(true);
  });
});

describe('estToHours', () => {
  it('parses minutes', () => {
    expect(estToHours('30m')).toBe(0.5);
  });
  it('parses single hours', () => {
    expect(estToHours('1h')).toBe(1);
    expect(estToHours('15h')).toBe(15);
  });
  it('averages ranges', () => {
    expect(estToHours('2-3h')).toBe(2.5);
    expect(estToHours('10-14h')).toBe(12);
  });
  it('returns Infinity for missing/unparseable values so they sort last', () => {
    expect(estToHours(undefined)).toBe(Infinity);
    expect(estToHours('')).toBe(Infinity);
    expect(estToHours('TBD')).toBe(Infinity);
  });
  it('produces numerically correct ordering when used in sort', () => {
    type FlatItem = RoadmapItem & { sprintId: string; sprintName: string };
    const items: FlatItem[] = [
      { ...base, id: 1, est: '15-20h', sprintId: 's', sprintName: 's' },
      { ...base, id: 2, est: '1h', sprintId: 's', sprintName: 's' },
      { ...base, id: 3, est: '30m', sprintId: 's', sprintName: 's' },
      { ...base, id: 4, est: '2-3h', sprintId: 's', sprintName: 's' },
    ];
    const sorted = sortItems(items, 'est', 'asc');
    expect(sorted.map(i => i.id)).toEqual([3, 2, 4, 1]);
  });
});

describe('sortItems with mixed string/number IDs', () => {
  it('handles default id sort without producing NaN for string IDs', () => {
    type FlatItem = RoadmapItem & { sprintId: string; sprintName: string };
    const items: FlatItem[] = [
      { ...base, id: 'meeting-brief-phase1', sprintId: 's', sprintName: 's' },
      { ...base, id: 5, sprintId: 's', sprintName: 's' },
      { ...base, id: 'brandscript-engine-phase1', sprintId: 's', sprintName: 's' },
    ];
    expect(() => sortItems(items, 'id', 'asc')).not.toThrow();
  });
});

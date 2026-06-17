import { describe, it, expect } from 'vitest';
import { recActCategory, REC_TYPE_ACT_CATEGORY, ACT_CATEGORIES } from '../../src/lib/recCategoryMap';
import type { RecType } from '../../shared/types/recommendations';

const ALL_REC_TYPES: RecType[] = [
  'technical', 'content', 'content_refresh', 'schema', 'metadata', 'performance',
  'accessibility', 'strategy', 'aeo', 'keyword_gap', 'topic_cluster', 'cannibalization',
  'local_visibility', 'local_service_gap',
];

describe('recCategoryMap', () => {
  it('maps every RecType to a valid category', () => {
    for (const t of ALL_REC_TYPES) {
      expect(ACT_CATEGORIES).toContain(recActCategory(t));
    }
  });

  it('categorizes representative types correctly', () => {
    expect(recActCategory('content')).toBe('content');
    expect(recActCategory('content_refresh')).toBe('content');
    expect(recActCategory('keyword_gap')).toBe('content');
    expect(recActCategory('technical')).toBe('technical');
    expect(recActCategory('cannibalization')).toBe('technical');
    expect(recActCategory('metadata')).toBe('technical');
    expect(recActCategory('strategy')).toBe('quick-win');
  });

  it('is exhaustive — covers exactly the RecType union', () => {
    expect(Object.keys(REC_TYPE_ACT_CATEGORY).sort()).toEqual([...ALL_REC_TYPES].sort());
  });
});

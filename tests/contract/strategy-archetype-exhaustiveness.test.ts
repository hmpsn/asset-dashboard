import { describe, it, expect } from 'vitest';
import {
  REC_TYPE_ARCHETYPE,
  ARCHETYPE_ORDER,
  ARCHETYPE_LABELS,
  ARCHETYPE_HEADLINE_VERB,
  recArchetype,
} from '../../shared/types/strategy-archetype.js';

// Runtime defense beyond `satisfies Record<RecType, Archetype>`: if a RecType is added to the
// union without an archetype assignment, this list must be updated and the test forces the choice.
const REC_TYPES = [
  'technical', 'content', 'content_refresh', 'schema', 'metadata', 'performance',
  'accessibility', 'strategy', 'aeo', 'keyword_gap', 'topic_cluster', 'cannibalization',
  'local_visibility', 'local_service_gap', 'competitor',
] as const;

describe('strategy archetype contract', () => {
  it('maps all 15 RecTypes to a known archetype', () => {
    for (const t of REC_TYPES) {
      expect(ARCHETYPE_ORDER).toContain(recArchetype(t));
    }
  });

  it('has exactly the 15 RecTypes as keys (no missing, no extra)', () => {
    expect(Object.keys(REC_TYPE_ARCHETYPE).sort()).toEqual([...REC_TYPES].sort());
  });

  it('labels and headline verbs cover every archetype in ARCHETYPE_ORDER', () => {
    for (const a of ARCHETYPE_ORDER) {
      expect(ARCHETYPE_LABELS[a]).toBeTruthy();
      expect(ARCHETYPE_HEADLINE_VERB[a]).toBeTruthy();
    }
  });
});

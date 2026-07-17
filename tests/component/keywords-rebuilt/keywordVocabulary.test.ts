import { describe, expect, it } from 'vitest';
import {
  KEYWORDS_SAY_IT_ALOUD,
  keywordLifecycleDisplayLabel,
} from '../../../src/components/keywords-rebuilt/keywordVocabulary';

describe('rebuilt Keywords say-it-aloud vocabulary', () => {
  it('uses the operator-facing labels approved by the conventions judge', () => {
    expect(KEYWORDS_SAY_IT_ALOUD).toEqual({
      rawEvidence: 'Seen in search',
      unclustered: 'Not in a topic yet',
      opportunity: 'Opportunity',
      currentMonthly: '$/mo',
    });
    expect(keywordLifecycleDisplayLabel('raw_evidence', 'Raw Evidence')).toBe('Seen in search');
    expect(keywordLifecycleDisplayLabel('tracked', 'Tracked')).toBe('Tracked');
  });
});

import { describe, expect, it } from 'vitest';
import { runQualityCheck } from '../../server/copy-generation.js';
import type { SectionPlanItem } from '../../shared/types/page-strategy.js';

const BASE_SECTION: SectionPlanItem = {
  id: 'section-1',
  sectionType: 'hero',
  narrativeRole: 'hook',
  wordCountTarget: 8,
  order: 1,
};

describe('copy-generation runQualityCheck', () => {
  it('returns no flags for clean copy inside the word-count window', () => {
    const flags = runQualityCheck('Clear reporting helps teams choose better priorities today', BASE_SECTION);

    expect(flags).toEqual([]);
  });

  it('flags forbidden phrases case-insensitively', () => {
    const flags = runQualityCheck('Our Best-In-Class workflow helps teams move faster today', BASE_SECTION);

    expect(flags).toContainEqual({
      type: 'forbidden_phrase',
      message: 'Contains forbidden phrase: "best-in-class"',
      severity: 'warning',
    });
  });

  it('flags copy that misses the section word-count window', () => {
    const tooShort = runQualityCheck('Too short', BASE_SECTION);
    const tooLong = runQualityCheck(
      'This section keeps adding extra words until the paragraph is clearly beyond the expected target range',
      BASE_SECTION,
    );

    expect(tooShort).toContainEqual({
      type: 'word_count_violation',
      message: 'Too short: 2 words (target: 8)',
      severity: 'warning',
    });
    expect(tooLong.some(flag => flag.message.startsWith('Too long:'))).toBe(true);
  });

  it('flags repeated long words as keyword stuffing', () => {
    const flags = runQualityCheck(
      'reporting reporting reporting reporting keeps the message narrow',
      BASE_SECTION,
    );

    expect(flags).toContainEqual({
      type: 'keyword_stuffing',
      message: 'Keyword "reporting" appears 4 times',
      severity: 'warning',
    });
  });

  it('flags voice-profile guardrail terms from a Never use list', () => {
    const flags = runQualityCheck(
      'This page should never promise effortless growth.',
      BASE_SECTION,
      'Never use: effortless, instant wins',
    );

    expect(flags).toContainEqual({
      type: 'guardrail_violation',
      message: 'Uses guardrail-forbidden term: "effortless"',
      severity: 'error',
    });
  });
});

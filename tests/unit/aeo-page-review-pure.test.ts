/**
 * Wave 24-A21 — Pure unit tests for server/aeo-page-review.ts
 *
 * Extends coverage beyond aeo-page-review-normalization.test.ts, which covers
 * basic normalizeAeoReviewResponse cases. This file covers:
 *   - normalizeAeoReviewResponse: edge cases, all change types, auto-generated IDs,
 *     quickWinCount/estimatedTimeMinutes inference vs explicit values,
 *     verifiedSourceEvidence trimming, non-citations with requiresSourceResearch
 *   - AEO shared type helpers from shared/types/aeo.ts:
 *     countAeoQuickWins, estimateAeoChangesMinutes, estimateAeoChangeMinutes
 *
 * No DB, no AI calls, no I/O — all pure function tests.
 */

import { describe, expect, it } from 'vitest';
import { normalizeAeoReviewResponse } from '../../server/aeo-page-review.js';
import {
  AEO_CHANGE_TYPES,
  AEO_EFFORTS,
  countAeoQuickWins,
  estimateAeoChangeMinutes,
  estimateAeoChangesMinutes,
} from '../../shared/types/aeo.js';

// ════════════════════════════════════════════════════════════════════════════
// Shared type helpers (countAeoQuickWins, estimateAeoChangesMinutes)
// ════════════════════════════════════════════════════════════════════════════

describe('countAeoQuickWins', () => {
  it('returns 0 for empty array', () => {
    expect(countAeoQuickWins([])).toBe(0);
  });

  it('counts only quick-effort changes', () => {
    const changes = [
      { effort: 'quick' as const },
      { effort: 'moderate' as const },
      { effort: 'quick' as const },
      { effort: 'significant' as const },
    ];
    expect(countAeoQuickWins(changes)).toBe(2);
  });

  it('returns 0 when no quick changes exist', () => {
    const changes = [
      { effort: 'moderate' as const },
      { effort: 'significant' as const },
    ];
    expect(countAeoQuickWins(changes)).toBe(0);
  });

  it('counts all when all are quick', () => {
    const changes = [
      { effort: 'quick' as const },
      { effort: 'quick' as const },
      { effort: 'quick' as const },
    ];
    expect(countAeoQuickWins(changes)).toBe(3);
  });
});

describe('estimateAeoChangeMinutes', () => {
  it('returns 15 for quick effort', () => {
    expect(estimateAeoChangeMinutes('quick')).toBe(15);
  });

  it('returns 45 for moderate effort', () => {
    expect(estimateAeoChangeMinutes('moderate')).toBe(45);
  });

  it('returns 90 for significant effort', () => {
    expect(estimateAeoChangeMinutes('significant')).toBe(90);
  });
});

describe('estimateAeoChangesMinutes', () => {
  it('returns 0 for empty array', () => {
    expect(estimateAeoChangesMinutes([])).toBe(0);
  });

  it('sums minutes correctly for mixed effort changes', () => {
    const changes = [
      { effort: 'quick' as const },      // 15
      { effort: 'moderate' as const },   // 45
      { effort: 'significant' as const }, // 90
    ];
    expect(estimateAeoChangesMinutes(changes)).toBe(150);
  });

  it('handles all quick changes', () => {
    const changes = Array.from({ length: 4 }, () => ({ effort: 'quick' as const }));
    expect(estimateAeoChangesMinutes(changes)).toBe(60);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AEO constant arrays
// ════════════════════════════════════════════════════════════════════════════

describe('AEO_CHANGE_TYPES', () => {
  it('includes all expected change types', () => {
    const expected = [
      'rewrite_intro', 'add_author', 'add_date', 'add_section', 'add_citations',
      'add_schema', 'add_faq', 'add_comparison', 'add_definition',
      'restructure_content', 'remove_dark_pattern', 'copy_edit',
    ];
    for (const type of expected) {
      expect(AEO_CHANGE_TYPES).toContain(type);
    }
  });

  it('has 12 change types', () => {
    expect(AEO_CHANGE_TYPES).toHaveLength(12);
  });
});

describe('AEO_EFFORTS', () => {
  it('contains exactly quick, moderate, significant', () => {
    expect(AEO_EFFORTS).toContain('quick');
    expect(AEO_EFFORTS).toContain('moderate');
    expect(AEO_EFFORTS).toContain('significant');
    expect(AEO_EFFORTS).toHaveLength(3);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// normalizeAeoReviewResponse — extended coverage
// ════════════════════════════════════════════════════════════════════════════

describe('normalizeAeoReviewResponse — extended coverage', () => {
  // ── Auto-generated IDs ────────────────────────────────────────────────────

  describe('auto-generated change IDs', () => {
    it('assigns id=change-N when AI omits the id field', () => {
      const result = normalizeAeoReviewResponse({
        overallScore: 60,
        summary: 'Good page.',
        changes: [
          { changeType: 'copy_edit', location: 'Intro', suggestedChange: 'Rewrite it.', rationale: 'Clarity.', effort: 'quick', priority: 'high', aeoImpact: 'Better readability.' },
          { changeType: 'add_faq', location: 'Footer', suggestedChange: 'Add FAQ.', rationale: 'Answers.', effort: 'moderate', priority: 'medium', aeoImpact: 'FAQ schema eligible.' },
        ],
      });
      expect(result.changes[0].id).toBe('change-0');
      expect(result.changes[1].id).toBe('change-1');
    });

    it('preserves explicit id when provided', () => {
      const result = normalizeAeoReviewResponse({
        overallScore: 55,
        summary: 'Review done.',
        changes: [
          { id: 'my-custom-id', changeType: 'add_schema', location: 'Page', suggestedChange: 'Add FAQ schema.', rationale: 'Schema.', effort: 'quick', priority: 'high', aeoImpact: 'Schema.' },
        ],
      });
      expect(result.changes[0].id).toBe('my-custom-id');
    });
  });

  // ── quickWinCount and estimatedTimeMinutes inference ─────────────────────

  describe('quickWinCount and estimatedTimeMinutes inference', () => {
    it('infers quickWinCount from changes when not provided', () => {
      const result = normalizeAeoReviewResponse({
        overallScore: 70,
        summary: 'Good.',
        changes: [
          { changeType: 'copy_edit', location: 'H1', suggestedChange: 'Fix H1.', rationale: 'SEO.', effort: 'quick', priority: 'high', aeoImpact: 'Better ranking.' },
          { changeType: 'add_section', location: 'Body', suggestedChange: 'Add section.', rationale: 'Coverage.', effort: 'significant', priority: 'medium', aeoImpact: 'Topic coverage.' },
        ],
      });
      expect(result.quickWinCount).toBe(1);
    });

    it('uses explicit quickWinCount when provided', () => {
      const result = normalizeAeoReviewResponse({
        overallScore: 70,
        summary: 'Good.',
        changes: [
          { changeType: 'copy_edit', location: 'H1', suggestedChange: 'Fix H1.', rationale: 'SEO.', effort: 'quick', priority: 'high', aeoImpact: 'Better.' },
        ],
        quickWinCount: 99, // explicit override
      });
      expect(result.quickWinCount).toBe(99);
    });

    it('infers estimatedTimeMinutes from changes when not provided', () => {
      const result = normalizeAeoReviewResponse({
        overallScore: 65,
        summary: 'Review.',
        changes: [
          { changeType: 'copy_edit', location: 'Intro', suggestedChange: 'Rewrite.', rationale: 'Clarity.', effort: 'quick', priority: 'high', aeoImpact: 'Better.' },
          { changeType: 'add_author', location: 'Bio', suggestedChange: 'Add bio.', rationale: 'E-E-A-T.', effort: 'moderate', priority: 'medium', aeoImpact: 'Trust.' },
        ],
      });
      // quick=15, moderate=45 → total 60
      expect(result.estimatedTimeMinutes).toBe(60);
    });

    it('uses explicit estimatedTimeMinutes when provided', () => {
      const result = normalizeAeoReviewResponse({
        overallScore: 65,
        summary: 'Review.',
        changes: [],
        estimatedTimeMinutes: 120,
      });
      expect(result.estimatedTimeMinutes).toBe(120);
    });
  });

  // ── verifiedSourceEvidence trimming ───────────────────────────────────────

  describe('verifiedSourceEvidence trimming', () => {
    it('trims whitespace from verifiedSourceEvidence', () => {
      const result = normalizeAeoReviewResponse({
        overallScore: 80,
        summary: 'Done.',
        changes: [
          {
            changeType: 'add_citations',
            location: 'Claims section',
            suggestedChange: 'Add source.',
            rationale: 'Trust.',
            effort: 'moderate',
            priority: 'high',
            aeoImpact: 'Citation.',
            verifiedSourceEvidence: '   CDC 2024 report on oral health.   ',
          },
        ],
      });
      expect(result.changes[0].verifiedSourceEvidence).toBe('CDC 2024 report on oral health.');
    });

    it('sets verifiedSourceEvidence to undefined when empty string', () => {
      const result = normalizeAeoReviewResponse({
        overallScore: 50,
        summary: 'Review.',
        changes: [
          {
            changeType: 'add_citations',
            location: 'Evidence section',
            suggestedChange: 'Add source.',
            rationale: 'Trust.',
            effort: 'quick',
            priority: 'high',
            aeoImpact: 'Citation.',
            verifiedSourceEvidence: '',
          },
        ],
      });
      expect(result.changes[0].verifiedSourceEvidence).toBeUndefined();
    });

    it('sets verifiedSourceEvidence to undefined when not provided', () => {
      const result = normalizeAeoReviewResponse({
        overallScore: 55,
        summary: 'Review.',
        changes: [
          {
            changeType: 'copy_edit',
            location: 'H1',
            suggestedChange: 'Rewrite.',
            rationale: 'Clarity.',
            effort: 'quick',
            priority: 'medium',
            aeoImpact: 'Readability.',
          },
        ],
      });
      expect(result.changes[0].verifiedSourceEvidence).toBeUndefined();
    });
  });

  // ── requiresSourceResearch logic ──────────────────────────────────────────

  describe('requiresSourceResearch logic', () => {
    it('marks add_citations without evidence as requiresSourceResearch=true', () => {
      const result = normalizeAeoReviewResponse({
        overallScore: 60,
        summary: 'Review.',
        changes: [
          {
            changeType: 'add_citations',
            location: 'Claims',
            suggestedChange: 'Cite a study.',
            rationale: 'Evidence.',
            effort: 'moderate',
            priority: 'high',
            aeoImpact: 'Trust.',
          },
        ],
      });
      expect(result.changes[0].requiresSourceResearch).toBe(true);
    });

    it('marks add_citations WITH evidence as requiresSourceResearch=false', () => {
      const result = normalizeAeoReviewResponse({
        overallScore: 75,
        summary: 'Done.',
        changes: [
          {
            changeType: 'add_citations',
            location: 'Claims',
            suggestedChange: 'Cite the provided survey.',
            rationale: 'Evidence.',
            effort: 'moderate',
            priority: 'high',
            aeoImpact: 'Trust.',
            verifiedSourceEvidence: 'Knowledge base: 2025 industry survey by ACME Research.',
          },
        ],
      });
      expect(result.changes[0].requiresSourceResearch).toBe(false);
    });

    it('prepends research-needed prefix to suggestedChange when requiresSourceResearch=true', () => {
      const result = normalizeAeoReviewResponse({
        overallScore: 60,
        summary: 'Review.',
        changes: [
          {
            changeType: 'add_citations',
            location: 'Claims',
            suggestedChange: 'Cite a reliable source here.',
            rationale: 'Evidence.',
            effort: 'quick',
            priority: 'high',
            aeoImpact: 'Trust.',
          },
        ],
      });
      expect(result.changes[0].suggestedChange).toMatch(/^Research needed before client handoff/);
      expect(result.changes[0].suggestedChange).toContain('Cite a reliable source here.');
    });

    it('does not set requiresSourceResearch for non-citations change types', () => {
      const result = normalizeAeoReviewResponse({
        overallScore: 60,
        summary: 'Done.',
        changes: [
          {
            changeType: 'copy_edit',
            location: 'Intro',
            suggestedChange: 'Rewrite this paragraph.',
            rationale: 'Clarity.',
            effort: 'quick',
            priority: 'medium',
            aeoImpact: 'Readability.',
            requiresSourceResearch: false,
          },
        ],
      });
      expect(result.changes[0].requiresSourceResearch).toBe(false);
    });

    it('respects explicit requiresSourceResearch=true for non-citations change types', () => {
      const result = normalizeAeoReviewResponse({
        overallScore: 60,
        summary: 'Done.',
        changes: [
          {
            changeType: 'add_definition',
            location: 'Terminology section',
            suggestedChange: 'Define this term.',
            rationale: 'Clarity.',
            effort: 'moderate',
            priority: 'low',
            aeoImpact: 'Definition coverage.',
            requiresSourceResearch: true,
          },
        ],
      });
      expect(result.changes[0].requiresSourceResearch).toBe(true);
    });
  });

  // ── overallScore clamping ─────────────────────────────────────────────────

  describe('overallScore clamping and defaults', () => {
    it('clamps overallScore below 0 to 0', () => {
      const result = normalizeAeoReviewResponse({ overallScore: -50, summary: 'Bad.', changes: [] });
      expect(result.overallScore).toBe(0);
    });

    it('clamps overallScore above 100 to max — Zod catches with default 0', () => {
      // Zod z.number().min(0).max(100).catch(0) — value >100 fails → catches → 0
      const result = normalizeAeoReviewResponse({ overallScore: 150, summary: 'Perfect.', changes: [] });
      expect(result.overallScore).toBe(0);
    });

    it('accepts valid score of 0', () => {
      const result = normalizeAeoReviewResponse({ overallScore: 0, summary: 'Poor.', changes: [] });
      expect(result.overallScore).toBe(0);
    });

    it('accepts valid score of 100', () => {
      const result = normalizeAeoReviewResponse({ overallScore: 100, summary: 'Perfect.', changes: [] });
      expect(result.overallScore).toBe(100);
    });

    it('accepts valid score mid-range', () => {
      const result = normalizeAeoReviewResponse({ overallScore: 73, summary: 'Good.', changes: [] });
      expect(result.overallScore).toBe(73);
    });
  });

  // ── All recognized change types pass through ──────────────────────────────

  describe('all AEO_CHANGE_TYPES pass through normalization', () => {
    for (const changeType of AEO_CHANGE_TYPES) {
      it(`normalizes changeType="${changeType}" correctly`, () => {
        const result = normalizeAeoReviewResponse({
          overallScore: 60,
          summary: 'Review.',
          changes: [
            {
              changeType,
              location: 'Page',
              suggestedChange: 'Do the change.',
              rationale: 'Reason.',
              effort: 'quick',
              priority: 'medium',
              aeoImpact: 'Impact.',
            },
          ],
        });
        expect(result.changes[0].changeType).toBe(changeType);
      });
    }
  });

  // ── All effort values normalize correctly ─────────────────────────────────

  describe('effort normalization for all AEO_EFFORTS', () => {
    for (const effort of AEO_EFFORTS) {
      it(`passes through effort="${effort}"`, () => {
        const result = normalizeAeoReviewResponse({
          overallScore: 60,
          summary: 'Review.',
          changes: [
            {
              changeType: 'copy_edit',
              location: 'Body',
              suggestedChange: 'Edit text.',
              rationale: 'Clarity.',
              effort,
              priority: 'low',
              aeoImpact: 'Readability.',
            },
          ],
        });
        expect(result.changes[0].effort).toBe(effort);
      });
    }
  });

  // ── Empty changes array ───────────────────────────────────────────────────

  describe('empty changes array', () => {
    it('returns empty changes array with zero counts', () => {
      const result = normalizeAeoReviewResponse({
        overallScore: 85,
        summary: 'Well optimized page — no changes needed.',
        changes: [],
      });
      expect(result.changes).toHaveLength(0);
      expect(result.quickWinCount).toBe(0);
      expect(result.estimatedTimeMinutes).toBe(0);
    });
  });

  // ── Malformed / missing outer fields ─────────────────────────────────────

  describe('malformed outer fields fall back to safe defaults', () => {
    it('defaults summary when non-string is provided', () => {
      const result = normalizeAeoReviewResponse({
        overallScore: 50,
        summary: null,
        changes: [],
      });
      expect(result.summary).toBe('AEO review completed.');
    });

    it('defaults changes to empty array when not an array', () => {
      const result = normalizeAeoReviewResponse({
        overallScore: 50,
        summary: 'OK',
        changes: 'not an array',
      });
      expect(result.changes).toEqual([]);
    });

    it('handles completely empty input gracefully', () => {
      const result = normalizeAeoReviewResponse({});
      expect(result.overallScore).toBe(0);
      expect(result.summary).toBe('AEO review completed.');
      expect(result.changes).toHaveLength(0);
    });
  });
});

// Unit tests for the pure helpers exported from
// src/components/client/Briefing/DataSpread.tsx — Phase 2.5b.
// Verifies category-to-tone mapping, detail-line projection, and the
// drop-from-spread cases (no useful detail; no metrics on period_change).

import { describe, it, expect } from 'vitest';
import { spreadItemFromStory } from '../../src/components/client/Briefing/DataSpread';
import type { BriefingStory, BriefingMetric } from '../../shared/types/briefing';

function story(over: Partial<BriefingStory> = {}): BriefingStory {
  return {
    id: 's-1',
    category: 'win',
    isHeadline: false,
    headline: 'Default headline',
    narrative: 'Default narrative.',
    metrics: [],
    drillIn: { page: 'performance' },
    sourceRefs: [],
    ...over,
  };
}

const metric = (value: string, label: string): BriefingMetric => ({ value, label });

describe('spreadItemFromStory', () => {
  describe('category-to-tone mapping', () => {
    it('maps "win" → tone "win"', () => {
      const item = spreadItemFromStory(story({ category: 'win', narrative: 'A solid week.' }), null);
      expect(item?.tone).toBe('win');
    });

    it('maps "opportunity" → tone "win"', () => {
      const item = spreadItemFromStory(story({ category: 'opportunity', narrative: 'Open lane.' }), null);
      expect(item?.tone).toBe('win');
    });

    it('maps "risk" → tone "risk"', () => {
      const item = spreadItemFromStory(story({ category: 'risk', narrative: 'Decay detected.' }), null);
      expect(item?.tone).toBe('risk');
    });

    it('maps "competitive" → tone "risk"', () => {
      const item = spreadItemFromStory(
        story({ category: 'competitive', narrative: 'Competitor move.' }),
        null,
      );
      expect(item?.tone).toBe('risk');
    });

    describe('period_change tone disambiguation', () => {
      it('infers "win" when first metric value starts with "+"', () => {
        const item = spreadItemFromStory(
          story({ category: 'period_change', metrics: [metric('+12%', 'MoM clicks')] }),
          null,
        );
        expect(item?.tone).toBe('win');
      });

      it('infers "risk" when first metric value does NOT start with "+"', () => {
        const item = spreadItemFromStory(
          story({ category: 'period_change', metrics: [metric('-8%', 'MoM clicks')] }),
          null,
        );
        expect(item?.tone).toBe('risk');
      });

      it('returns null when first metric value is unsigned (e.g., raw counts like "2")', () => {
        // Unsigned numeric metrics carry no tone signal; the helper drops
        // them from the spread rather than mis-classifying as 'risk'.
        const item = spreadItemFromStory(
          story({ category: 'period_change', metrics: [metric('2', 'new pages indexed')] }),
          null,
        );
        expect(item).toBeNull();
      });

      it('infers "risk" when first metric value uses unicode minus (U+2212)', () => {
        const item = spreadItemFromStory(
          story({ category: 'period_change', metrics: [metric('−8%', 'MoM clicks')] }),
          null,
        );
        expect(item?.tone).toBe('risk');
      });

      it('returns null when period_change has no metrics', () => {
        const item = spreadItemFromStory(
          story({ category: 'period_change', metrics: [] }),
          null,
        );
        expect(item).toBeNull();
      });
    });
  });

  describe('detail line projection', () => {
    it('uses first metric "{value} {label}" when metrics are present', () => {
      const item = spreadItemFromStory(
        story({ metrics: [metric('+12%', 'MoM clicks')], narrative: 'Ignored.' }),
        null,
      );
      expect(item?.detail).toContain('+12%');
      expect(item?.detail).toContain('MoM clicks');
    });

    it('falls back to first sentence of narrative when no metrics', () => {
      const item = spreadItemFromStory(
        story({ metrics: [], narrative: 'Strong week. Second sentence.' }),
        null,
      );
      expect(item?.detail).toBe('Strong week');
    });

    it('truncates the detail to ≤80 characters with ellipsis', () => {
      const long = 'a'.repeat(120);
      const item = spreadItemFromStory(
        story({ metrics: [metric(long, 'label')] }),
        null,
      );
      expect(item).not.toBeNull();
      expect(item!.detail.length).toBeLessThanOrEqual(80);
      expect(item!.detail.endsWith('…')).toBe(true);
    });

    it('returns null when no metrics AND narrative is empty', () => {
      const item = spreadItemFromStory(story({ metrics: [], narrative: '' }), null);
      expect(item).toBeNull();
    });

    it('returns null when no metrics AND narrative is whitespace-only', () => {
      const item = spreadItemFromStory(story({ metrics: [], narrative: '   ' }), null);
      expect(item).toBeNull();
    });
  });

  describe('drillInUrl pass-through', () => {
    it('passes the URL through when provided', () => {
      const item = spreadItemFromStory(
        story({ narrative: 'Click target.' }),
        '/client/abc/performance',
      );
      expect(item?.drillInUrl).toBe('/client/abc/performance');
    });

    it('omits drillInUrl when null is passed', () => {
      const item = spreadItemFromStory(story({ narrative: 'Static.' }), null);
      expect(item?.drillInUrl).toBeUndefined();
    });
  });

  describe('id and headline pass-through', () => {
    it('preserves the source story id', () => {
      const item = spreadItemFromStory(
        story({ id: 'unique-id-123', narrative: 'X.' }),
        null,
      );
      expect(item?.id).toBe('unique-id-123');
    });

    it('preserves the source story headline', () => {
      const item = spreadItemFromStory(
        story({ headline: 'Specific headline here', narrative: 'X.' }),
        null,
      );
      expect(item?.headline).toBe('Specific headline here');
    });
  });
});

import { describe, it, expect } from 'vitest';
import { briefingAIResponseSchema, buildBriefingInstructions } from '../../server/briefing-prompt.js';

describe('briefing-prompt', () => {
  it('builds non-empty instructions string', () => {
    const out = buildBriefingInstructions({ workspaceName: 'Acme', weekLabel: 'Week of April 27' });
    expect(out).toContain('weekly client briefing');
    expect(out).toContain('exactly one');
    expect(out).toContain('headline');
    expect(out).toContain('Acme');
  });

  it('schema accepts a valid AI response', () => {
    const valid = {
      stories: [
        {
          id: 's1',
          category: 'win',
          isHeadline: true,
          headline: 'Commercial vehicle bet pays off',
          narrative: 'Three posts drove +12% traffic.',
          metrics: [{ value: '+12%', label: 'traffic' }],
          drillIn: { page: 'performance' },
          sourceRefs: [{ type: 'analytics_insight', id: 'i1' }],
        },
        {
          id: 's2',
          category: 'risk',
          isHeadline: false,
          headline: 'Three pages slipped off page 1',
          narrative: 'Down from rank 8 → 14 over the week.',
          metrics: [],
          drillIn: { page: 'health' },
          sourceRefs: [{ type: 'analytics_insight', id: 'i2' }],
        },
        {
          id: 's3',
          category: 'opportunity',
          isHeadline: false,
          headline: 'Content gap on EV charger install',
          narrative: 'Search volume 8.6K with no current coverage.',
          metrics: [{ value: '8.6K', label: 'search volume' }],
          drillIn: { page: 'strategy' },
          sourceRefs: [{ type: 'recommendation', id: 'r1' }],
        },
      ],
    };
    const r = briefingAIResponseSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it('schema rejects missing headline field', () => {
    const bad = {
      stories: [
        { id: 's1', category: 'win', isHeadline: true, narrative: 'x', metrics: [], drillIn: { page: 'performance' }, sourceRefs: [] },
        { id: 's2', category: 'risk', isHeadline: false, headline: 'h2', narrative: 'n', metrics: [], drillIn: { page: 'health' }, sourceRefs: [] },
        { id: 's3', category: 'win', isHeadline: false, headline: 'h3', narrative: 'n', metrics: [], drillIn: { page: 'performance' }, sourceRefs: [] },
      ],
    };
    expect(briefingAIResponseSchema.safeParse(bad).success).toBe(false);
  });

  it('schema rejects fewer than 3 stories', () => {
    const bad = {
      stories: [
        { id: 's1', category: 'win', isHeadline: true, headline: 'h1', narrative: 'n', metrics: [], drillIn: { page: 'performance' }, sourceRefs: [] },
        { id: 's2', category: 'risk', isHeadline: false, headline: 'h2', narrative: 'n', metrics: [], drillIn: { page: 'health' }, sourceRefs: [] },
      ],
    };
    expect(briefingAIResponseSchema.safeParse(bad).success).toBe(false);
  });

  it('schema rejects more than 5 stories', () => {
    const bad = {
      stories: Array.from({ length: 6 }, (_, i) => ({
        id: `s${i}`,
        category: 'win',
        isHeadline: i === 0,
        headline: 'h',
        narrative: 'n',
        metrics: [],
        drillIn: { page: 'performance' },
        sourceRefs: [],
      })),
    };
    expect(briefingAIResponseSchema.safeParse(bad).success).toBe(false);
  });

  it('schema rejects zero headlines or multiple headlines', () => {
    const noHero = {
      stories: [
        { id: 's1', category: 'win', isHeadline: false, headline: 'h1', narrative: 'n', metrics: [], drillIn: { page: 'performance' }, sourceRefs: [] },
        { id: 's2', category: 'risk', isHeadline: false, headline: 'h2', narrative: 'n', metrics: [], drillIn: { page: 'health' }, sourceRefs: [] },
        { id: 's3', category: 'win', isHeadline: false, headline: 'h3', narrative: 'n', metrics: [], drillIn: { page: 'performance' }, sourceRefs: [] },
      ],
    };
    const twoHero = {
      stories: [
        { id: 's1', category: 'win', isHeadline: true, headline: 'h1', narrative: 'n', metrics: [], drillIn: { page: 'performance' }, sourceRefs: [] },
        { id: 's2', category: 'risk', isHeadline: true, headline: 'h2', narrative: 'n', metrics: [], drillIn: { page: 'health' }, sourceRefs: [] },
        { id: 's3', category: 'win', isHeadline: false, headline: 'h3', narrative: 'n', metrics: [], drillIn: { page: 'performance' }, sourceRefs: [] },
      ],
    };
    expect(briefingAIResponseSchema.safeParse(noHero).success).toBe(false);
    expect(briefingAIResponseSchema.safeParse(twoHero).success).toBe(false);
  });
});

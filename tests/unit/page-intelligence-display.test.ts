import { describe, expect, it } from 'vitest';
import {
  difficultyTextColor,
  intentColor,
  intentIcon,
  kdColor,
  kdLabel,
  opportunityScore,
  positionColor,
} from '../../src/components/page-intelligence/pageIntelligenceDisplay';
import type { PageKeywordMap } from '../../shared/types/workspace.js';

function page(overrides: Partial<PageKeywordMap>): PageKeywordMap {
  return {
    pagePath: '/services',
    pageTitle: 'Services',
    primaryKeyword: 'seo services',
    secondaryKeywords: [],
    ...overrides,
  };
}

describe('PageIntelligence display helpers', () => {
  it('preserves position color thresholds', () => {
    expect(positionColor()).toBe('text-[var(--brand-text-muted)]');
    expect(positionColor(0)).toBe('text-[var(--brand-text-muted)]');
    expect(positionColor(3)).toBe('text-accent-success');
    expect(positionColor(10)).toBe('text-accent-brand');
    expect(positionColor(20)).toBe('text-accent-warning');
    expect(positionColor(21)).toBe('text-accent-danger');
  });

  it('preserves keyword difficulty color and label thresholds', () => {
    expect(kdColor()).toBe('text-[var(--brand-text-muted)]');
    expect(kdColor(30)).toBe('text-accent-success');
    expect(kdColor(50)).toBe('text-accent-warning');
    expect(kdColor(70)).toBe('text-accent-orange');
    expect(kdColor(71)).toBe('text-accent-danger');

    expect(kdLabel()).toBe('');
    expect(kdLabel(30)).toBe('Easy');
    expect(kdLabel(50)).toBe('Medium');
    expect(kdLabel(70)).toBe('Hard');
    expect(kdLabel(71)).toBe('Very Hard');
  });

  it('preserves intent display classes and icons', () => {
    expect(intentColor('commercial')).toBe('text-accent-info bg-blue-500/10 border-blue-500/20');
    expect(intentColor('informational')).toBe('text-accent-success bg-emerald-500/10 border-emerald-500/20');
    expect(intentColor('transactional')).toBe('text-accent-warning bg-amber-500/10 border-amber-500/20');
    expect(intentColor('navigational')).toBe('text-accent-cyan bg-cyan-500/10 border-cyan-500/20');
    expect(intentColor()).toBe('text-[var(--brand-text)] bg-[var(--surface-3)]/50 border-[var(--brand-border)]');

    expect(intentIcon('informational')).toBe('i');
    expect(intentIcon('transactional')).toBe('$');
    expect(intentIcon('navigational')).toBe('\u2192');
    expect(intentIcon('commercial')).toBe('?');
  });

  it('preserves estimated difficulty text colors', () => {
    expect(difficultyTextColor('low')).toBe('text-accent-success');
    expect(difficultyTextColor('medium')).toBe('text-accent-warning');
    expect(difficultyTextColor('high')).toBe('text-accent-danger');
  });

  it('preserves opportunity scoring priority rules', () => {
    expect(opportunityScore(page({ currentPosition: 4, impressions: 100 }))).toBe(1700);
    expect(opportunityScore(page({ currentPosition: 20, impressions: 100 }))).toBe(100);
    expect(opportunityScore(page({ currentPosition: 21, impressions: 100 }))).toBe(200);
    expect(opportunityScore(page({ currentPosition: 3, impressions: 100 }))).toBe(50);
    expect(opportunityScore(page({ volume: 500 }))).toBe(500);
    expect(opportunityScore(page({}))).toBe(1);
  });
});

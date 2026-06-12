/**
 * Unit tests for Phase 4D — Content calendar intelligence integration.
 *
 * Tests suggestPublishDates() which uses analytics intelligence
 * to recommend optimal publish/refresh dates for content.
 */
import { describe, it, expect, beforeAll } from 'vitest';

describe('suggestPublishDates', () => {
  let suggestPublishDates: (opts: {
    decayInsights?: Array<{ pageId: string; deltaPercent: number; currentClicks: number }>;
    quickWins?: Array<{ pageUrl: string; query: string; estimatedTrafficGain: number }>;
    bestDays?: number[];  // 0=Sun, 1=Mon, ... 6=Sat
  }) => Array<{
    pageUrl: string;
    reason: string;
    priority: 'high' | 'medium' | 'low';
    suggestedAction: 'refresh' | 'promote' | 'create';
  }>;

  beforeAll(async () => {
    const mod = await import('../../server/content-calendar-intelligence.js');
    suggestPublishDates = mod.suggestPublishDates;
  });

  it('returns empty array when no intelligence data', () => {
    expect(suggestPublishDates({})).toHaveLength(0);
  });

  it('suggests refresh for decaying content', () => {
    const results = suggestPublishDates({
      decayInsights: [
        { pageId: 'https://example.com/blog/old-post', deltaPercent: -45, currentClicks: 50 },
      ],
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    const refresh = results.find(r => r.pageUrl === 'https://example.com/blog/old-post');
    expect(refresh).toBeDefined();
    expect(refresh!.suggestedAction).toBe('refresh');
    expect(refresh!.priority).toBe('high'); // >40% decay = high priority
  });

  it('suggests promote for quick wins', () => {
    const results = suggestPublishDates({
      quickWins: [
        { pageUrl: 'https://example.com/services', query: 'seo services', estimatedTrafficGain: 200 },
      ],
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    const promote = results.find(r => r.pageUrl === 'https://example.com/services');
    expect(promote).toBeDefined();
    expect(promote!.suggestedAction).toBe('promote');
  });

  it('prioritizes decay by severity', () => {
    const results = suggestPublishDates({
      decayInsights: [
        { pageId: 'https://example.com/mild', deltaPercent: -22, currentClicks: 30 },
        { pageId: 'https://example.com/severe', deltaPercent: -60, currentClicks: 80 },
      ],
    });
    // Severe decay should come first
    expect(results[0].pageUrl).toBe('https://example.com/severe');
    expect(results[0].priority).toBe('high');
    expect(results[1].priority).toBe('medium'); // 20-40% = medium
  });

  it('deduplicates pages appearing in both decay and quick wins', () => {
    const results = suggestPublishDates({
      decayInsights: [
        { pageId: 'https://example.com/services', deltaPercent: -30, currentClicks: 60 },
      ],
      quickWins: [
        { pageUrl: 'https://example.com/services', query: 'seo services', estimatedTrafficGain: 150 },
      ],
    });
    // Should not have duplicate entries for same page
    const servicePagesCount = results.filter(r => r.pageUrl === 'https://example.com/services').length;
    expect(servicePagesCount).toBe(1);
    // Decay takes priority as suggested action
    expect(results.find(r => r.pageUrl === 'https://example.com/services')!.suggestedAction).toBe('refresh');
  });

  it('caps results at 15', () => {
    const decayInsights = Array.from({ length: 20 }, (_, i) => ({
      pageId: `https://example.com/page-${i}`,
      deltaPercent: -25 - i,
      currentClicks: 50,
    }));
    const results = suggestPublishDates({ decayInsights });
    expect(results.length).toBeLessThanOrEqual(15);
  });
});

describe('suggestDraftSchedule', () => {
  let suggestDraftSchedule: (opts: {
    drafts: Array<{ id: string; targetKeyword?: string; pageHint?: string }>;
    startDate: Date;
    priorityPages?: Array<{ pageUrl: string; priority: 'high' | 'medium' | 'low' }>;
    spacingDays?: number;
  }) => Array<{ draftId: string; suggestedDate: string; reason: string }>;

  beforeAll(async () => {
    const mod = await import('../../server/content-calendar-intelligence.js');
    suggestDraftSchedule = mod.suggestDraftSchedule;
  });

  it('returns empty array for no drafts', () => {
    expect(suggestDraftSchedule({ drafts: [], startDate: new Date('2026-06-15T00:00:00Z') })).toHaveLength(0);
  });

  it('assigns one date per draft', () => {
    const result = suggestDraftSchedule({
      drafts: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      startDate: new Date('2026-06-15T00:00:00Z'), // Monday
    });
    expect(result).toHaveLength(3);
    expect(new Set(result.map(r => r.draftId)).size).toBe(3);
  });

  it('produces dates that are all in the future relative to startDate', () => {
    const start = new Date('2026-06-15T00:00:00Z');
    const result = suggestDraftSchedule({
      drafts: [{ id: 'a' }, { id: 'b' }],
      startDate: start,
    });
    for (const r of result) {
      expect(new Date(r.suggestedDate).getTime()).toBeGreaterThanOrEqual(start.getTime());
    }
  });

  it('spaces drafts apart (no two drafts on the same day)', () => {
    const result = suggestDraftSchedule({
      drafts: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      startDate: new Date('2026-06-15T00:00:00Z'),
    });
    const days = result.map(r => r.suggestedDate.slice(0, 10));
    expect(new Set(days).size).toBe(days.length);
  });

  it('skips weekends — no suggested date falls on Saturday or Sunday', () => {
    const result = suggestDraftSchedule({
      drafts: Array.from({ length: 6 }, (_, i) => ({ id: `d${i}` })),
      startDate: new Date('2026-06-19T00:00:00Z'), // Friday
    });
    for (const r of result) {
      const dow = new Date(r.suggestedDate).getUTCDay();
      expect(dow).not.toBe(0); // Sunday
      expect(dow).not.toBe(6); // Saturday
    }
  });

  it('orders high-priority drafts (matching priorityPages) before unprioritized ones', () => {
    const result = suggestDraftSchedule({
      drafts: [
        { id: 'low', pageHint: '/blog/quiet' },
        { id: 'high', pageHint: '/blog/urgent' },
      ],
      startDate: new Date('2026-06-15T00:00:00Z'),
      priorityPages: [{ pageUrl: '/blog/urgent', priority: 'high' }],
    });
    // The high-priority draft should get the earliest date.
    const highEntry = result.find(r => r.draftId === 'high')!;
    const lowEntry = result.find(r => r.draftId === 'low')!;
    expect(new Date(highEntry.suggestedDate).getTime())
      .toBeLessThan(new Date(lowEntry.suggestedDate).getTime());
  });
});

/**
 * Unit tests for the pure plotting logic of useContentCalendar (W6.6).
 *
 * Covers derivePostPlot — how a post is placed on the calendar and on which date:
 * published (historical) > planned (forward-looking intent) > created (fallback).
 * Also exercises future-month grouping to confirm a planned draft lands on its
 * future plannedPublishAt day, not its createdAt day.
 */
import { describe, it, expect } from 'vitest';
import { derivePostPlot } from '../../src/hooks/admin/useContentCalendar';

describe('derivePostPlot', () => {
  it('plots a published post on publishedAt with kind=published', () => {
    const result = derivePostPlot({
      publishedAt: '2026-05-01T00:00:00.000Z',
      plannedPublishAt: '2026-09-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result).toEqual({ kind: 'published', date: '2026-05-01T00:00:00.000Z' });
  });

  it('plots an unpublished post with a planned date on plannedPublishAt with kind=planned', () => {
    const result = derivePostPlot({
      plannedPublishAt: '2026-09-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result).toEqual({ kind: 'planned', date: '2026-09-01T00:00:00.000Z' });
  });

  it('falls back to createdAt with kind=created for an unscheduled draft', () => {
    const result = derivePostPlot({ createdAt: '2026-01-01T00:00:00.000Z' });
    expect(result).toEqual({ kind: 'created', date: '2026-01-01T00:00:00.000Z' });
  });

  it('published wins even when a planned date is also set', () => {
    const result = derivePostPlot({
      publishedAt: '2026-05-01T00:00:00.000Z',
      plannedPublishAt: '2026-04-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.kind).toBe('published');
  });
});

describe('future-month plotting (grouping by plotted date)', () => {
  // Mirror the component's day-key grouping to prove a planned draft created today
  // lands on its future planned day, not today.
  function dayKey(iso: string): string {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  it('a draft created in January but planned for September groups under September', () => {
    const plot = derivePostPlot({
      plannedPublishAt: '2026-09-15T12:00:00.000Z',
      createdAt: '2026-01-10T12:00:00.000Z',
    });
    expect(dayKey(plot.date).startsWith('2026-09')).toBe(true);
    expect(dayKey(plot.date).startsWith('2026-01')).toBe(false);
  });
});

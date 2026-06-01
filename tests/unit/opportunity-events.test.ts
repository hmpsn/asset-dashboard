/**
 * opportunity-events ledger tests (PR7 · Spine B).
 *
 * Covers:
 *   1. insertOpportunityEvent round-trips through the DB (rowToOpportunityEvent).
 *   2. pagePath is slug-normalised on write (leading slash + host stripped, lowercased).
 *   3. listActiveOpportunityEvents is workspace-scoped (wsA rows never leak to wsB).
 *   4. Degenerate boost/half-life are clamped to safe values.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import db from '../../server/db/index.js';
import {
  insertOpportunityEvent,
  listActiveOpportunityEvents,
  normalizeEventPagePath,
} from '../../server/opportunity-events.js';

const WS_A = 'oe-test-ws-a';
const WS_B = 'oe-test-ws-b';

function cleanup() {
  db.prepare("DELETE FROM opportunity_events WHERE workspace_id LIKE 'oe-test-%'").run();
}

beforeEach(cleanup);
afterAll(cleanup);

describe('insertOpportunityEvent / listActiveOpportunityEvents', () => {
  it('round-trips an event through the DB', () => {
    const written = insertOpportunityEvent({
      workspaceId: WS_A,
      type: 'decay',
      pagePath: 'services/hvac',
      keyword: 'hvac repair',
      boost: 0.5,
      halfLifeDays: 14,
      source: 'decay-cron',
      payload: { severity: 'critical', clickDeclinePct: -60 },
    });
    expect(written.id).toMatch(/^[0-9a-f]+$/);

    const events = listActiveOpportunityEvents(WS_A);
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.type).toBe('decay');
    expect(e.pagePath).toBe('services/hvac');
    expect(e.keyword).toBe('hvac repair');
    expect(e.boost).toBe(0.5);
    expect(e.halfLifeDays).toBe(14);
    expect(e.source).toBe('decay-cron');
    expect(e.payload).toEqual({ severity: 'critical', clickDeclinePct: -60 });
    expect(typeof e.detectedAt).toBe('string');
  });

  it('slug-normalises pagePath on write (host + leading slash stripped, lowercased)', () => {
    insertOpportunityEvent({
      workspaceId: WS_A,
      type: 'rank_drop',
      pagePath: 'https://example.com/Services/HVAC/',
      boost: 0.4,
      halfLifeDays: 10,
    });
    const events = listActiveOpportunityEvents(WS_A);
    expect(events[0].pagePath).toBe('services/hvac');
  });

  it('stores a domain-level event (null pagePath) when none is given', () => {
    insertOpportunityEvent({
      workspaceId: WS_A,
      type: 'competitor',
      keyword: 'plumbing near me',
      boost: 0.6,
      halfLifeDays: 7,
    });
    const events = listActiveOpportunityEvents(WS_A);
    expect(events[0].pagePath).toBeNull();
    expect(events[0].keyword).toBe('plumbing near me');
  });

  it('is workspace-scoped — wsA events never leak into wsB', () => {
    insertOpportunityEvent({ workspaceId: WS_A, type: 'decay', pagePath: 'a', boost: 0.5, halfLifeDays: 14 });
    insertOpportunityEvent({ workspaceId: WS_B, type: 'decay', pagePath: 'b', boost: 0.5, halfLifeDays: 14 });
    expect(listActiveOpportunityEvents(WS_A).map(e => e.pagePath)).toEqual(['a']);
    expect(listActiveOpportunityEvents(WS_B).map(e => e.pagePath)).toEqual(['b']);
  });

  it('clamps a non-positive half-life to a safe value and NaN boost to 0', () => {
    insertOpportunityEvent({ workspaceId: WS_A, type: 'publish', pagePath: 'x', boost: Number.NaN, halfLifeDays: 0 });
    const e = listActiveOpportunityEvents(WS_A)[0];
    expect(e.boost).toBe(0);
    expect(e.halfLifeDays).toBeGreaterThan(0);
  });
});

describe('normalizeEventPagePath', () => {
  it('returns null for empty / non-string input', () => {
    expect(normalizeEventPagePath(null)).toBeNull();
    expect(normalizeEventPagePath(undefined)).toBeNull();
    expect(normalizeEventPagePath('   ')).toBeNull();
  });
  it('strips host, leading/trailing slashes, lowercases', () => {
    expect(normalizeEventPagePath('/Foo/Bar/')).toBe('foo/bar');
    expect(normalizeEventPagePath('https://x.io/Foo')).toBe('foo');
  });
});

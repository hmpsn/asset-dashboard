/**
 * Integration tests for the local-visibility-shift insight bridge (W5.3).
 *
 * Verifies that runLocalVisibilityShiftBridge correctly:
 * - Mints a `risk` insight on a visible→not_visible transition (and not again on an
 *   unchanged re-run)
 * - Mints a `win` insight on a not_visible→visible transition and retires the stale risk
 * - Mints a `competitor` insight for a NEW repeat competitor (>= 2 keywords, not present
 *   in the previous state)
 * - Returns { modified: 0 } when nothing transitioned
 * - Respects bridge authoring rules (bridgeSource set, domain=search)
 *
 * Uses seedWorkspace() + cleanup() (no server) — the bridge is pure w.r.t. its snapshot
 * inputs, so prev/new states are built as plain objects.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { getInsight, getInsights } from '../../server/analytics-insights-store.js';
import { runLocalVisibilityShiftBridge } from '../../server/bridge-local-visibility-shift.js';
import {
  LOCAL_BUSINESS_MATCH_CONFIDENCE,
  LOCAL_SEO_DEVICE,
  LOCAL_VISIBILITY_STATUS,
  LOCAL_VISIBILITY_SOURCE_ENDPOINT,
  type LocalVisibilitySnapshot,
} from '../../shared/types/local-seo.js';

let ws: ReturnType<typeof seedWorkspace>;

function snap(overrides: Partial<LocalVisibilitySnapshot> & { keyword: string; visible: boolean }): LocalVisibilitySnapshot {
  const { visible, ...rest } = overrides;
  return {
    id: `snap-${overrides.keyword}-${Math.random().toString(36).slice(2)}`,
    workspaceId: ws.workspaceId,
    keyword: overrides.keyword,
    normalizedKeyword: overrides.normalizedKeyword ?? overrides.keyword,
    marketId: 'market-1',
    marketLabel: 'Austin, TX',
    capturedAt: '2026-06-10T00:00:00.000Z',
    localPackPresent: true,
    businessFound: visible,
    businessMatchConfidence: visible ? LOCAL_BUSINESS_MATCH_CONFIDENCE.VERIFIED : LOCAL_BUSINESS_MATCH_CONFIDENCE.NOT_FOUND,
    localRank: visible ? 2 : undefined,
    topCompetitors: [],
    sourceEndpoint: LOCAL_VISIBILITY_SOURCE_ENDPOINT.GOOGLE_ORGANIC_SERP,
    provider: 'dataforseo',
    device: LOCAL_SEO_DEVICE.DESKTOP,
    languageCode: 'en',
    status: LOCAL_VISIBILITY_STATUS.SUCCESS,
    ...rest,
  };
}

beforeAll(() => { ws = seedWorkspace(); });
afterAll(() => { ws.cleanup(); });

describe('bridge-local-visibility-shift', () => {
  it('returns { modified: 0 } when nothing transitioned', async () => {
    const prev = [snap({ keyword: 'dentist austin', visible: true })];
    const next = [snap({ keyword: 'dentist austin', visible: true })];
    const result = await runLocalVisibilityShiftBridge(ws.workspaceId, prev, next);
    expect(result).toEqual({ modified: 0 });
    expect(getInsights(ws.workspaceId, 'local_visibility_shift')).toHaveLength(0);
  });

  it('mints exactly one risk insight on visible→not_visible with the typed payload', async () => {
    const prev = [snap({ keyword: 'dentist austin', visible: true, localRank: 3 })];
    const next = [snap({ keyword: 'dentist austin', visible: false })];

    const result = await runLocalVisibilityShiftBridge(ws.workspaceId, prev, next);
    expect(result.modified).toBe(1);

    const all = getInsights(ws.workspaceId, 'local_visibility_shift');
    expect(all).toHaveLength(1);
    const insight = all[0];
    expect(insight.bridgeSource).toBe('bridge-local-visibility-shift');
    expect(insight.domain).toBe('search');
    expect(insight.severity).toBe('warning');
    expect(insight.impactScore).toBeGreaterThan(0);
    expect(insight.data.direction).toBe('risk');
    expect(insight.data.keyword).toBe('dentist austin');
    expect(insight.data.marketLabel).toBe('Austin, TX');
    expect(insight.data.previousRank).toBe(3);
    expect(typeof insight.data.detectedAt).toBe('string');
  });

  it('does not re-mint on an unchanged re-run (edge-triggered dedup)', async () => {
    // Both states not_visible now — no edge, so the existing risk insight persists but
    // no new row is created.
    const prev = [snap({ keyword: 'dentist austin', visible: false })];
    const next = [snap({ keyword: 'dentist austin', visible: false })];
    const result = await runLocalVisibilityShiftBridge(ws.workspaceId, prev, next);
    expect(result.modified).toBe(0);
    expect(getInsights(ws.workspaceId, 'local_visibility_shift')).toHaveLength(1);
  });

  it('mints a win insight and retires the stale risk on not_visible→visible', async () => {
    const prev = [snap({ keyword: 'dentist austin', visible: false })];
    const next = [snap({ keyword: 'dentist austin', visible: true, localRank: 1 })];

    const result = await runLocalVisibilityShiftBridge(ws.workspaceId, prev, next);
    // 1 win minted + 1 stale risk suppressed = modified 2
    expect(result.modified).toBe(2);

    const all = getInsights(ws.workspaceId, 'local_visibility_shift');
    // Only the win remains (the risk was suppressed).
    expect(all).toHaveLength(1);
    expect(all[0].data.direction).toBe('win');
    expect(all[0].severity).toBe('positive');
    expect(all[0].data.currentRank).toBe(1);
  });

  it('mints a competitor insight for a new repeat competitor (>= 2 keywords, not previously present)', async () => {
    const fresh = seedWorkspace();
    try {
      const comp = { title: 'Rival Dental', domain: 'rival.com' };
      const prev = [
        { ...snap({ keyword: 'k1', visible: true }), workspaceId: fresh.workspaceId, topCompetitors: [] },
        { ...snap({ keyword: 'k2', visible: true }), workspaceId: fresh.workspaceId, topCompetitors: [] },
      ];
      const next = [
        { ...snap({ keyword: 'k1', visible: true }), workspaceId: fresh.workspaceId, topCompetitors: [comp] },
        { ...snap({ keyword: 'k2', visible: true }), workspaceId: fresh.workspaceId, topCompetitors: [comp] },
      ];

      const result = await runLocalVisibilityShiftBridge(fresh.workspaceId, prev, next);
      expect(result.modified).toBe(1);

      const all = getInsights(fresh.workspaceId, 'local_visibility_shift');
      expect(all).toHaveLength(1);
      expect(all[0].data.direction).toBe('competitor');
      expect(all[0].data.competitorName).toBe('Rival Dental');
      expect(all[0].data.competitorAppearances).toBe(2);
      expect(all[0].severity).toBe('opportunity');
    } finally {
      fresh.cleanup();
    }
  });

  it('does not mint a competitor insight for a single-keyword appearance', async () => {
    const fresh = seedWorkspace();
    try {
      const comp = { title: 'One-Off Co', domain: 'oneoff.com' };
      const prev = [{ ...snap({ keyword: 'k1', visible: true }), workspaceId: fresh.workspaceId, topCompetitors: [] }];
      const next = [{ ...snap({ keyword: 'k1', visible: true }), workspaceId: fresh.workspaceId, topCompetitors: [comp] }];

      const result = await runLocalVisibilityShiftBridge(fresh.workspaceId, prev, next);
      expect(result.modified).toBe(0);
      expect(getInsights(fresh.workspaceId, 'local_visibility_shift')).toHaveLength(0);
    } finally {
      fresh.cleanup();
    }
  });

  it('ignores provider_failed snapshots when diffing transitions', async () => {
    const fresh = seedWorkspace();
    try {
      const prev = [snap({ keyword: 'k1', visible: true, workspaceId: fresh.workspaceId })];
      const next = [snap({ keyword: 'k1', visible: false, workspaceId: fresh.workspaceId, status: LOCAL_VISIBILITY_STATUS.PROVIDER_FAILED })];

      const result = await runLocalVisibilityShiftBridge(fresh.workspaceId, prev, next);
      expect(result.modified).toBe(0);
      expect(getInsights(fresh.workspaceId, 'local_visibility_shift')).toHaveLength(0);
    } finally {
      fresh.cleanup();
    }
  });

  it('ignores degraded snapshots when diffing transitions — success→degraded→success mints nothing', async () => {
    // Degraded snapshots carry businessFound=false regardless of actual visibility.
    // success→degraded must NOT mint a risk, and degraded→success must NOT mint a win.
    const fresh = seedWorkspace();
    try {
      // success→degraded: should mint nothing (degraded is not a usable "next" signal)
      const prevSuccess = [snap({ keyword: 'k1', visible: true, workspaceId: fresh.workspaceId })];
      const nextDegraded = [snap({ keyword: 'k1', visible: false, workspaceId: fresh.workspaceId, status: LOCAL_VISIBILITY_STATUS.DEGRADED })];

      const r1 = await runLocalVisibilityShiftBridge(fresh.workspaceId, prevSuccess, nextDegraded);
      expect(r1.modified).toBe(0);
      expect(getInsights(fresh.workspaceId, 'local_visibility_shift')).toHaveLength(0);

      // degraded→success: degraded is also not a usable "prev" signal, so no win
      const nextSuccess = [snap({ keyword: 'k1', visible: true, workspaceId: fresh.workspaceId })];
      const r2 = await runLocalVisibilityShiftBridge(fresh.workspaceId, nextDegraded, nextSuccess);
      expect(r2.modified).toBe(0);
      expect(getInsights(fresh.workspaceId, 'local_visibility_shift')).toHaveLength(0);
    } finally {
      fresh.cleanup();
    }
  });
});

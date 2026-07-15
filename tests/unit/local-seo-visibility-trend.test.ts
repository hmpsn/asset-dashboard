/**
 * Unit tests for getLocalSeoVisibilityTrend (W5.3) — the per-market visible-count trend
 * aggregate that surfaces the otherwise write-only local_visibility_snapshots series.
 *
 * Seeds raw snapshot rows across multiple days/markets and asserts the series shape:
 * one series per market, chronological points, day-bucketed counts, verified-only
 * visible counts, provider_failed rows excluded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import db from '../../server/db/index.js';
import { getLocalSeoVisibilityTrend } from '../../server/local-seo.js';
import { setBroadcast } from '../../server/broadcast.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import {
  LOCAL_BUSINESS_MATCH_CONFIDENCE,
  LOCAL_VISIBILITY_STATUS,
} from '../../shared/types/local-seo.js';
import { keywordIdentityKeyV2 } from '../../shared/keyword-normalization.js';

const insertSnapshot = db.prepare(`
  INSERT INTO local_visibility_snapshots (
    id, workspace_id, keyword, normalized_keyword, normalized_keyword_v2, market_id, market_label, captured_at,
    local_pack_present, business_found, business_match_confidence, business_match_reason,
    local_rank, top_competitors, source_endpoint, provider, device, language_code, status, degraded_reason
  ) VALUES (
    @id, @workspace_id, @keyword, @normalized_keyword, @normalized_keyword_v2, @market_id, @market_label, @captured_at,
    @local_pack_present, @business_found, @business_match_confidence, @business_match_reason,
    @local_rank, @top_competitors, @source_endpoint, @provider, @device, @language_code, @status, @degraded_reason
  )
`);

let seq = 0;
function seed(opts: {
  workspaceId: string;
  marketId: string;
  marketLabel: string;
  keyword: string;
  capturedAt: string;
  visible: boolean;
  confidence?: string;
  status?: string;
  device?: string;
  language?: string;
  legacyIdentity?: boolean;
}): void {
  insertSnapshot.run({
    id: `trend-snap-${seq++}`,
    workspace_id: opts.workspaceId,
    keyword: opts.keyword,
    normalized_keyword: opts.keyword.toLowerCase(),
    normalized_keyword_v2: opts.legacyIdentity ? null : keywordIdentityKeyV2(opts.keyword),
    market_id: opts.marketId,
    market_label: opts.marketLabel,
    captured_at: opts.capturedAt,
    local_pack_present: 1,
    business_found: opts.visible ? 1 : 0,
    business_match_confidence: opts.confidence ?? (opts.visible ? LOCAL_BUSINESS_MATCH_CONFIDENCE.VERIFIED : LOCAL_BUSINESS_MATCH_CONFIDENCE.NOT_FOUND),
    business_match_reason: null,
    local_rank: opts.visible ? 2 : null,
    top_competitors: '[]',
    source_endpoint: 'google_organic_serp',
    provider: 'fake-seo-provider',
    device: opts.device ?? 'desktop',
    language_code: opts.language ?? 'en',
    status: opts.status ?? LOCAL_VISIBILITY_STATUS.SUCCESS,
    degraded_reason: null,
  });
}

const cleanupIds = new Set<string>();
function ws(name: string): string {
  const w = createWorkspace(name);
  cleanupIds.add(w.id);
  return w.id;
}

beforeEach(() => { setBroadcast(vi.fn(), vi.fn()); });
afterEach(() => {
  for (const id of cleanupIds) deleteWorkspace(id);
  cleanupIds.clear();
});

describe('getLocalSeoVisibilityTrend', () => {
  it('returns an empty array for a workspace with no snapshots', () => {
    const id = ws('Trend Empty');
    expect(getLocalSeoVisibilityTrend(id)).toEqual([]);
  });

  it('builds one chronological series per market with day-bucketed visible/checked counts', () => {
    const id = ws('Trend Basic');
    // Day 1: 1 of 2 visible. Day 2: 2 of 2 visible.
    seed({ workspaceId: id, marketId: 'm1', marketLabel: 'Austin, TX', keyword: 'kw1', capturedAt: '2026-06-01T08:00:00.000Z', visible: true });
    seed({ workspaceId: id, marketId: 'm1', marketLabel: 'Austin, TX', keyword: 'kw2', capturedAt: '2026-06-01T09:00:00.000Z', visible: false });
    seed({ workspaceId: id, marketId: 'm1', marketLabel: 'Austin, TX', keyword: 'kw1', capturedAt: '2026-06-02T08:00:00.000Z', visible: true });
    seed({ workspaceId: id, marketId: 'm1', marketLabel: 'Austin, TX', keyword: 'kw2', capturedAt: '2026-06-02T09:00:00.000Z', visible: true });

    const series = getLocalSeoVisibilityTrend(id);
    expect(series).toHaveLength(1);
    expect(series[0].marketId).toBe('m1');
    expect(series[0].points).toEqual([
      { date: '2026-06-01', visibleCount: 1, checkedCount: 2 },
      { date: '2026-06-02', visibleCount: 2, checkedCount: 2 },
    ]);
  });

  it('only counts verified matches as visible (possible matches are not visible)', () => {
    const id = ws('Trend Verified Only');
    seed({ workspaceId: id, marketId: 'm1', marketLabel: 'Austin, TX', keyword: 'kw1', capturedAt: '2026-06-01T08:00:00.000Z', visible: true, confidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.VERIFIED });
    // business_found=1 but confidence=possible → not counted as visible.
    seed({ workspaceId: id, marketId: 'm1', marketLabel: 'Austin, TX', keyword: 'kw2', capturedAt: '2026-06-01T09:00:00.000Z', visible: true, confidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.POSSIBLE_MATCH });

    const series = getLocalSeoVisibilityTrend(id);
    expect(series[0].points[0]).toEqual({ date: '2026-06-01', visibleCount: 1, checkedCount: 2 });
  });

  it('excludes provider_failed snapshots from the trend', () => {
    const id = ws('Trend No Failed');
    seed({ workspaceId: id, marketId: 'm1', marketLabel: 'Austin, TX', keyword: 'kw1', capturedAt: '2026-06-01T08:00:00.000Z', visible: true });
    seed({ workspaceId: id, marketId: 'm1', marketLabel: 'Austin, TX', keyword: 'kw2', capturedAt: '2026-06-01T09:00:00.000Z', visible: false, status: LOCAL_VISIBILITY_STATUS.PROVIDER_FAILED });

    const series = getLocalSeoVisibilityTrend(id);
    expect(series[0].points[0]).toEqual({ date: '2026-06-01', visibleCount: 1, checkedCount: 1 });
  });

  it('counts C and C# separately under the v2 identity namespace', () => {
    const id = ws('Trend Unicode Identity');
    seed({ workspaceId: id, marketId: 'm1', marketLabel: 'Austin, TX', keyword: 'C', capturedAt: '2026-07-01T08:00:00.000Z', visible: true });
    seed({ workspaceId: id, marketId: 'm1', marketLabel: 'Austin, TX', keyword: 'C#', capturedAt: '2026-07-01T09:00:00.000Z', visible: false });

    expect(getLocalSeoVisibilityTrend(id)[0].points[0]).toEqual({
      date: '2026-07-01', visibleCount: 1, checkedCount: 2,
    });
  });

  it.each([
    ['Café', 'Cafe\u0301'],
    ['Cafe\u0301', 'Café'],
  ])('counts legacy canonical-equivalent spellings once regardless of insertion order (%s first)', (first, second) => {
    const id = ws('Trend Legacy Unicode Identity');
    seed({
      workspaceId: id, marketId: 'm1', marketLabel: 'Austin, TX', keyword: first,
      capturedAt: '2026-07-01T08:00:00.000Z', visible: true, legacyIdentity: true,
    });
    seed({
      workspaceId: id, marketId: 'm1', marketLabel: 'Austin, TX', keyword: second,
      capturedAt: '2026-07-01T09:00:00.000Z', visible: false, legacyIdentity: true,
    });

    expect(getLocalSeoVisibilityTrend(id)[0].points[0]).toEqual({
      date: '2026-07-01', visibleCount: 1, checkedCount: 1,
    });
  });

  it.each([
    ['Café', 'Cafe\u0301'],
    ['Cafe\u0301', 'Café'],
  ])('merges populated and legacy identities across a high-cardinality legacy page boundary (%s populated)', (populated, legacy) => {
    const id = ws('Trend High Cardinality Compatibility');
    const day = new Date().toISOString().slice(0, 10);
    seed({
      workspaceId: id, marketId: 'm1', marketLabel: 'Austin, TX', keyword: populated,
      capturedAt: `${day}T01:00:00.000Z`, visible: true,
    });
    for (let i = 0; i < 225; i++) {
      seed({
        workspaceId: id, marketId: 'm1', marketLabel: 'Austin, TX', keyword: `legacy filler ${i}`,
        capturedAt: `${day}T12:00:00.000Z`, visible: false, legacyIdentity: true,
      });
    }
    seed({
      workspaceId: id, marketId: 'm1', marketLabel: 'Austin, TX', keyword: legacy,
      capturedAt: `${day}T23:00:00.000Z`, visible: false, legacyIdentity: true,
    });

    expect(getLocalSeoVisibilityTrend(id)[0].points[0]).toEqual({
      date: day,
      visibleCount: 1,
      checkedCount: 226,
    });
  });

  it('returns separate series per market, ordered by most-recent activity first', () => {
    const id = ws('Trend Multi Market');
    // m1 last point on 2026-06-01; m2 last point on 2026-06-05 (more recent → first).
    seed({ workspaceId: id, marketId: 'm1', marketLabel: 'Austin, TX', keyword: 'kw1', capturedAt: '2026-06-01T08:00:00.000Z', visible: true });
    seed({ workspaceId: id, marketId: 'm2', marketLabel: 'Dallas, TX', keyword: 'kw1', capturedAt: '2026-06-05T08:00:00.000Z', visible: true });

    const series = getLocalSeoVisibilityTrend(id);
    expect(series.map(s => s.marketId)).toEqual(['m2', 'm1']);
  });

  it('counts device/language variants as distinct checked identities', () => {
    const id = ws('Trend Variants');
    seed({ workspaceId: id, marketId: 'm1', marketLabel: 'Austin, TX', keyword: 'kw1', capturedAt: '2026-06-01T08:00:00.000Z', visible: true, device: 'desktop' });
    seed({ workspaceId: id, marketId: 'm1', marketLabel: 'Austin, TX', keyword: 'kw1', capturedAt: '2026-06-01T08:30:00.000Z', visible: false, device: 'mobile' });

    const series = getLocalSeoVisibilityTrend(id);
    // Same keyword, two devices → 2 checked, 1 visible.
    expect(series[0].points[0]).toEqual({ date: '2026-06-01', visibleCount: 1, checkedCount: 2 });
  });

  it('excludes degraded snapshots from the trend (does not inflate checked_count)', () => {
    const id = ws('Trend No Degraded');
    // One success + one degraded row on the same day. Degraded must be excluded from
    // checked_count (it carries businessFound=false regardless of actual visibility).
    const today = new Date().toISOString().slice(0, 10);
    seed({ workspaceId: id, marketId: 'm1', marketLabel: 'Austin, TX', keyword: 'kw1', capturedAt: `${today}T08:00:00.000Z`, visible: true });
    seed({ workspaceId: id, marketId: 'm1', marketLabel: 'Austin, TX', keyword: 'kw2', capturedAt: `${today}T09:00:00.000Z`, visible: false, status: LOCAL_VISIBILITY_STATUS.DEGRADED });

    const series = getLocalSeoVisibilityTrend(id);
    // Only the success row should count — checkedCount: 1, not 2.
    expect(series[0].points[0]).toEqual({ date: today, visibleCount: 1, checkedCount: 1 });
  });

  it('excludes snapshots older than RETENTION_RAW_DAYS (180d) from the trend', () => {
    const id = ws('Trend Window Bound');
    const recent = new Date();
    recent.setDate(recent.getDate() - 10); // 10 days ago → within window
    const old = new Date();
    old.setDate(old.getDate() - 190); // 190 days ago → outside 180d window
    const recentDay = recent.toISOString().slice(0, 10);

    seed({ workspaceId: id, marketId: 'm1', marketLabel: 'Austin, TX', keyword: 'kw1', capturedAt: recent.toISOString(), visible: true });
    seed({ workspaceId: id, marketId: 'm1', marketLabel: 'Austin, TX', keyword: 'kw2', capturedAt: old.toISOString(), visible: true });

    const series = getLocalSeoVisibilityTrend(id);
    // Only the recent row should appear.
    expect(series).toHaveLength(1);
    expect(series[0].points).toHaveLength(1);
    expect(series[0].points[0].date).toBe(recentDay);
  });
});

/**
 * Task 2.2 — outcome-attributed-value.test.ts
 *
 * Verifies that scoreActionAtCheckpoint (via measurePendingOutcomes) populates
 * attributed_value = clicks_delta × page CPC when a page_keywords CPC row exists,
 * and leaves attributed_value NULL when there is no CPC (the inconclusive path).
 *
 * TDD: written to FAIL before the implementation (scoreActionAtCheckpoint does not
 * yet compute or pass attributedValue/valueBasis to recordOutcome).
 */

import { describe, it, expect, afterAll, vi } from 'vitest';
import db from '../../server/db/index.js';
import { recordAction } from '../../server/outcome-tracking.js';
import { upsertPageKeyword } from '../../server/page-keywords.js';

// ── workspace prefix ──────────────────────────────────────────────────────────

const WS_BASE = 'oav-test-' + Date.now();

function seedWorkspace(id: string) {
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at) VALUES (?, ?, ?, ?)`,
  ).run(id, 'Test WS OAV', 'test-folder', new Date().toISOString());
}

afterAll(() => {
  // Clean up in reverse FK order
  db.prepare(`
    DELETE FROM action_outcomes
    WHERE action_id IN (
      SELECT id FROM tracked_actions WHERE workspace_id LIKE ?
    )
  `).run(`${WS_BASE}%`);
  db.prepare(`DELETE FROM tracked_actions WHERE workspace_id LIKE ?`).run(`${WS_BASE}%`);
  db.prepare(`DELETE FROM page_keywords WHERE workspace_id LIKE ?`).run(`${WS_BASE}%`);
  db.prepare(`DELETE FROM workspaces WHERE id LIKE ?`).run(`${WS_BASE}%`);
});

// ── helpers ───────────────────────────────────────────────────────────────────

const PAGE_PATH = '/test-page-cpc';
const CPC = 2.5;
const BASELINE_CLICKS = 10;
const CURRENT_CLICKS = 20;
const CLICKS_DELTA = CURRENT_CLICKS - BASELINE_CLICKS; // 10
const EXPECTED_VALUE = CLICKS_DELTA * CPC; // 25

// ── Test 1: CPC present → attributed_value = clicks_delta × cpc ──────────────

describe('scoreActionAtCheckpoint — clicks delta × CPC → attributed_value', () => {
  it('records attributed_value=25 and value_basis="clicks_delta_x_cpc" when page has CPC=2.5 and clicks_delta=10', async () => {
    const ws = `${WS_BASE}-cpc`;
    seedWorkspace(ws);

    // Seed a page_keywords row with a known CPC for the page
    upsertPageKeyword(ws, {
      pagePath: PAGE_PATH,
      pageTitle: 'Test Page',
      primaryKeyword: 'test keyword',
      secondaryKeywords: [],
      clicks: CURRENT_CLICKS,
      impressions: 200,
      cpc: CPC,
    });

    // Create an action with a GSC baseline that has real clicks data.
    // insight_acted_on uses 'clicks' as its primary_metric — ideal for this test.
    const action = recordAction({ // recordAction-ok
      attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
      workspaceId: ws,
      actionType: 'insight_acted_on',
      sourceType: 'test-cpc',
      sourceId: crypto.randomUUID(),
      pageUrl: PAGE_PATH,
      baselineSnapshot: {
        captured_at: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
        clicks: BASELINE_CLICKS,
        impressions: 150,
        position: 5,
        ctr: 6.7,
      },
    });

    // Backdate createdAt so the 30-day checkpoint is due
    db.prepare(`UPDATE tracked_actions SET created_at = ? WHERE id = ?`) // ws-scope-ok: tracked_actions.id is a UUID globally unique per row
      .run(new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(), action.id);

    // Mock getPageTrend to return a current snapshot with CURRENT_CLICKS
    const measurementMod = await import('../../server/outcome-measurement.js'); // dynamic-import-ok
    const { measurePendingOutcomes } = measurementMod;

    // We need to mock search-console.getPageTrend so fetchCurrentMetrics returns
    // a snapshot with current_clicks = CURRENT_CLICKS (20)
    const searchConsoleMod = await import('../../server/search-console.js'); // dynamic-import-ok
    const getPageTrendSpy = vi.spyOn(searchConsoleMod, 'getPageTrend').mockResolvedValue(
      Array.from({ length: 14 }, () => ({
        date: new Date().toISOString().slice(0, 10),
        clicks: CURRENT_CLICKS,
        impressions: 200,
        ctr: 10,
        position: 4,
      })),
    );

    // Also need workspace to have GSC credentials so fetchCurrentMetrics proceeds
    db.prepare(`UPDATE workspaces SET gsc_property_url = ?, webflow_site_id = ? WHERE id = ?`)
      .run('https://example.com', 'site-123', ws);

    try {
      await measurePendingOutcomes();
    } finally {
      getPageTrendSpy.mockRestore();
    }

    // Verify the 30-day outcome was recorded with the correct attributed_value
    const row = db.prepare(`
      SELECT ao.attributed_value, ao.value_basis, ao.checkpoint_days, ao.score
      FROM action_outcomes ao
      WHERE ao.action_id = ? AND ao.checkpoint_days = 30
    `).get(action.id) as { attributed_value: number | null; value_basis: string | null; checkpoint_days: number; score: string | null } | undefined;

    expect(row).toBeDefined();
    expect(row!.attributed_value).toBe(EXPECTED_VALUE); // 25
    expect(row!.value_basis).toBe('clicks_delta_x_cpc');
  });
});

// ── Test 2: no CPC → attributed_value stays NULL (inconclusive / no CPC path) ──

describe('scoreActionAtCheckpoint — no CPC → attributed_value remains null', () => {
  it('leaves attributed_value=null when the page has no CPC in page_keywords', async () => {
    const ws = `${WS_BASE}-nocpc`;
    seedWorkspace(ws);

    // Seed a page_keywords row WITHOUT a CPC
    upsertPageKeyword(ws, {
      pagePath: '/test-page-nocpc',
      pageTitle: 'NoCPC Page',
      primaryKeyword: 'no cpc keyword',
      secondaryKeywords: [],
      clicks: 20,
      impressions: 200,
      // no cpc field
    });

    const action = recordAction({ // recordAction-ok
      attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
      workspaceId: ws,
      actionType: 'insight_acted_on',
      sourceType: 'test-nocpc',
      sourceId: crypto.randomUUID(),
      pageUrl: '/test-page-nocpc',
      baselineSnapshot: {
        captured_at: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
        clicks: 10,
        impressions: 150,
        position: 5,
        ctr: 6.7,
      },
    });

    // Backdate createdAt so the 30-day checkpoint is due
    db.prepare(`UPDATE tracked_actions SET created_at = ? WHERE id = ?`) // ws-scope-ok: tracked_actions.id is a UUID globally unique per row
      .run(new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(), action.id);

    const measurementMod = await import('../../server/outcome-measurement.js'); // dynamic-import-ok
    const { measurePendingOutcomes } = measurementMod;

    const searchConsoleMod = await import('../../server/search-console.js'); // dynamic-import-ok
    const getPageTrendSpy = vi.spyOn(searchConsoleMod, 'getPageTrend').mockResolvedValue(
      Array.from({ length: 14 }, () => ({
        date: new Date().toISOString().slice(0, 10),
        clicks: 20,
        impressions: 200,
        ctr: 10,
        position: 4,
      })),
    );

    db.prepare(`UPDATE workspaces SET gsc_property_url = ?, webflow_site_id = ? WHERE id = ?`)
      .run('https://example.com', 'site-123', ws);

    try {
      await measurePendingOutcomes();
    } finally {
      getPageTrendSpy.mockRestore();
    }

    const row = db.prepare(`
      SELECT ao.attributed_value, ao.value_basis
      FROM action_outcomes ao
      WHERE ao.action_id = ? AND ao.checkpoint_days = 30
    `).get(action.id) as { attributed_value: number | null; value_basis: string | null } | undefined;

    expect(row).toBeDefined();
    expect(row!.attributed_value).toBeNull();
    expect(row!.value_basis).toBeNull();
  });
});

// ── Test 3: content_published (primary_metric='position') with clicks data → attributed_value computed ──
//
// FIX 2: content_published uses primary_metric='position' so the old guard
// `if (primaryMetric !== 'clicks') return null` silently blocked attribution
// for this action type. After the fix, clicks delta is computed independently.

describe('scoreActionAtCheckpoint — content_published (primary_metric=position) with clicks data → attributed_value computed', () => {
  it('records attributed_value for content_published when baseline+current clicks are present and CPC is known', async () => {
    const ws = `${WS_BASE}-publish`;
    seedWorkspace(ws);

    const PUBLISH_PAGE = '/services-published';
    const PUBLISH_CPC = 3.0;
    const BASELINE_PUBLISH_CLICKS = 5;
    const CURRENT_PUBLISH_CLICKS = 20;
    const EXPECTED_PUBLISH_VALUE = (CURRENT_PUBLISH_CLICKS - BASELINE_PUBLISH_CLICKS) * PUBLISH_CPC; // 45

    upsertPageKeyword(ws, {
      pagePath: PUBLISH_PAGE,
      pageTitle: 'Services Published',
      primaryKeyword: 'services',
      secondaryKeywords: [],
      clicks: CURRENT_PUBLISH_CLICKS,
      impressions: 300,
      cpc: PUBLISH_CPC,
    });

    // content_published uses primary_metric='position' — this is the action type
    // that Task 2.6 records; previously attributed_value was always null for it.
    const action = recordAction({ // recordAction-ok
      attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
      workspaceId: ws,
      actionType: 'content_published',
      sourceType: 'test-publish',
      sourceId: crypto.randomUUID(),
      pageUrl: PUBLISH_PAGE,
      baselineSnapshot: {
        captured_at: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
        clicks: BASELINE_PUBLISH_CLICKS,
        impressions: 200,
        position: 8,
        ctr: 2.5,
      },
    });

    db.prepare(`UPDATE tracked_actions SET created_at = ? WHERE id = ?`) // ws-scope-ok
      .run(new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(), action.id);

    const measurementMod = await import('../../server/outcome-measurement.js'); // dynamic-import-ok
    const { measurePendingOutcomes } = measurementMod;

    const searchConsoleMod = await import('../../server/search-console.js'); // dynamic-import-ok
    // Return current snapshot with improved position AND more clicks
    const getPageTrendSpy = vi.spyOn(searchConsoleMod, 'getPageTrend').mockResolvedValue(
      Array.from({ length: 14 }, () => ({
        date: new Date().toISOString().slice(0, 10),
        clicks: CURRENT_PUBLISH_CLICKS,
        impressions: 300,
        ctr: 6.7,
        position: 3, // improved from 8 to 3
      })),
    );

    db.prepare(`UPDATE workspaces SET gsc_property_url = ?, webflow_site_id = ? WHERE id = ?`)
      .run('https://example.com', 'site-456', ws);

    try {
      await measurePendingOutcomes();
    } finally {
      getPageTrendSpy.mockRestore();
    }

    const row = db.prepare(`
      SELECT ao.attributed_value, ao.value_basis, ao.checkpoint_days, ao.score
      FROM action_outcomes ao
      WHERE ao.action_id = ? AND ao.checkpoint_days = 30
    `).get(action.id) as { attributed_value: number | null; value_basis: string | null; checkpoint_days: number; score: string | null } | undefined;

    expect(row).toBeDefined();
    // Pre-fix: attributed_value would be NULL because primaryMetric='position' was blocked
    // Post-fix: attributed_value = (20 - 5) × 3.0 = 45
    expect(row!.attributed_value).toBe(EXPECTED_PUBLISH_VALUE);
    expect(row!.value_basis).toBe('clicks_delta_x_cpc');
  });
});

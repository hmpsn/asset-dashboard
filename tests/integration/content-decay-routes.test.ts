/**
 * Integration tests for content decay detection routes.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/content-decay/:workspaceId           — cached analysis retrieval
 * - POST /api/content-decay/:workspaceId/analyze  — decay detection trigger
 * - POST /api/content-decay/:workspaceId/recommendations — AI refresh recommendations
 * - GET /api/public/content-decay/:workspaceId    — client-facing read
 *
 * Severity classification thresholds (from server/content-decay.ts):
 *   clickDeclinePct <= -50  → 'critical'
 *   clickDeclinePct <= -30  → 'warning'
 *   clickDeclinePct <  -10  → 'watch'
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';
import type { DecayAnalysis, DecayingPage } from '../../server/content-decay.js';

const ctx = createTestContext(13311);
const { api, postJson } = ctx;

// ── Workspace IDs ───────────────────────────────────────────────────────────
let wsWithData = '';    // workspace that has seeded decay data
let wsEmpty = '';       // workspace with no decay data at all

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Insert a decay analysis directly into the DB (mirrors saveDecayAnalysis internals). */
function seedDecayAnalysis(
  workspaceId: string,
  decayingPages: DecayingPage[],
  totalPages = 20,
): void {
  const critical = decayingPages.filter(p => p.severity === 'critical').length;
  const warning  = decayingPages.filter(p => p.severity === 'warning').length;
  const watch    = decayingPages.filter(p => p.severity === 'watch').length;
  const avgDeclinePct =
    decayingPages.length > 0
      ? Math.round(decayingPages.reduce((s, p) => s + p.clickDeclinePct, 0) / decayingPages.length)
      : 0;

  const summary = { critical, warning, watch, totalDecaying: decayingPages.length, avgDeclinePct };

  db.prepare(`
    INSERT INTO decay_analyses (workspace_id, analyzed_at, total_pages, decaying_pages, summary)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      analyzed_at    = excluded.analyzed_at,
      total_pages    = excluded.total_pages,
      decaying_pages = excluded.decaying_pages,
      summary        = excluded.summary
  `).run(
    workspaceId,
    new Date().toISOString(),
    totalPages,
    JSON.stringify(decayingPages),
    JSON.stringify(summary),
  );
}

/** Remove the decay_analyses row for a workspace (cleanup). */
function deleteDecayAnalysis(workspaceId: string): void {
  db.prepare('DELETE FROM decay_analyses WHERE workspace_id = ?').run(workspaceId);
}

// ── Fixtures — pages representing all three severity levels ─────────────────

const criticalPage: DecayingPage = {
  page: '/blog/seo-fundamentals',
  title: 'SEO Fundamentals',
  currentClicks: 40,
  previousClicks: 120,
  clickDeclinePct: -67,          // ≤ -50 → critical
  currentImpressions: 800,
  previousImpressions: 2400,
  impressionChangePct: -67,
  currentPosition: 8.2,
  previousPosition: 4.1,
  positionChange: 4.1,
  severity: 'critical',
};

const warningPage: DecayingPage = {
  page: '/services/content-writing',
  title: 'Content Writing Services',
  currentClicks: 55,
  previousClicks: 90,
  clickDeclinePct: -39,          // ≤ -30 → warning
  currentImpressions: 1100,
  previousImpressions: 1500,
  impressionChangePct: -27,
  currentPosition: 6.5,
  previousPosition: 4.8,
  positionChange: 1.7,
  severity: 'warning',
};

const watchPage: DecayingPage = {
  page: '/about',
  title: 'About Us',
  currentClicks: 72,
  previousClicks: 85,
  clickDeclinePct: -15,          // < -10 → watch
  currentImpressions: 900,
  previousImpressions: 1000,
  impressionChangePct: -10,
  currentPosition: 11.0,
  previousPosition: 10.3,
  positionChange: 0.7,
  severity: 'watch',
};

const allSeverityPages = [criticalPage, warningPage, watchPage];

// ── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  // Set a fake OpenAI key before spawning so generateBatchRecommendations
  // fails with a fast auth error (not a hang). The test asserts 500 — the
  // correct behavior when the AI call fails (not phantom success).
  // Save and restore so we don't contaminate sibling test files in this process.
  // Always override OPENAI_API_KEY with a fake value before spawning — even
  // in CI or dev environments where a real key is configured. The child
  // process inherits env at spawn time, so we must unconditionally set the
  // fake key here (not conditionally) to guarantee the 500 path in all envs.
  const savedOpenAIKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'fake-key-for-content-decay-test';
  await ctx.startServer();
  if (savedOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = savedOpenAIKey;

  const ws1 = createWorkspace('Content Decay Test WS');
  wsWithData = ws1.id;
  seedDecayAnalysis(wsWithData, allSeverityPages, 20);

  const ws2 = createWorkspace('Content Decay Empty WS');
  wsEmpty = ws2.id;
  // No decay data seeded for wsEmpty — GET should return null (no rows)
}, 25_000);

afterAll(() => {
  deleteDecayAnalysis(wsWithData);
  deleteDecayAnalysis(wsEmpty);
  deleteWorkspace(wsWithData);
  deleteWorkspace(wsEmpty);
  ctx.stopServer();
});

// ── GET /api/content-decay/:workspaceId ──────────────────────────────────────

describe('GET /api/content-decay/:workspaceId — cached analysis retrieval', () => {
  it('returns null for workspace with no cached analysis', async () => {
    const res = await api(`/api/content-decay/${wsEmpty}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('returns a DecayAnalysis object for workspace with cached data', async () => {
    const res = await api(`/api/content-decay/${wsWithData}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DecayAnalysis;

    expect(body).not.toBeNull();
    expect(body.workspaceId).toBe(wsWithData);
    expect(typeof body.analyzedAt).toBe('string');
    expect(body.totalPages).toBe(20);
  });

  it('response contains a decayingPages array', async () => {
    const res = await api(`/api/content-decay/${wsWithData}`);
    const body = (await res.json()) as DecayAnalysis;

    expect(Array.isArray(body.decayingPages)).toBe(true);
    expect(body.decayingPages.length).toBeGreaterThan(0);
  });

  it('each decaying page has required shape fields', async () => {
    const res = await api(`/api/content-decay/${wsWithData}`);
    const body = (await res.json()) as DecayAnalysis;

    const pages = body.decayingPages;
    expect(pages.length).toBeGreaterThan(0);
    for (const p of pages) {
      expect(p).toHaveProperty('page');
      expect(p).toHaveProperty('currentClicks');
      expect(p).toHaveProperty('previousClicks');
      expect(p).toHaveProperty('clickDeclinePct');
      expect(p).toHaveProperty('currentImpressions');
      expect(p).toHaveProperty('previousImpressions');
      expect(p).toHaveProperty('impressionChangePct');
      expect(p).toHaveProperty('currentPosition');
      expect(p).toHaveProperty('previousPosition');
      expect(p).toHaveProperty('positionChange');
      expect(p).toHaveProperty('severity');
    }
  });

  it('severity values are restricted to valid enum members', async () => {
    const res = await api(`/api/content-decay/${wsWithData}`);
    const body = (await res.json()) as DecayAnalysis;
    const validSeverities = new Set(['critical', 'warning', 'watch']);

    const pages = body.decayingPages;
    expect(pages.length).toBeGreaterThan(0);
    for (const p of pages) {
      expect(validSeverities.has(p.severity)).toBe(true);
    }
  });

  it('response contains a summary object with all required fields', async () => {
    const res = await api(`/api/content-decay/${wsWithData}`);
    const body = (await res.json()) as DecayAnalysis;

    const s = body.summary;
    expect(typeof s.critical).toBe('number');
    expect(typeof s.warning).toBe('number');
    expect(typeof s.watch).toBe('number');
    expect(typeof s.totalDecaying).toBe('number');
    expect(typeof s.avgDeclinePct).toBe('number');
  });

  it('summary counts match actual page severity distribution', async () => {
    const res = await api(`/api/content-decay/${wsWithData}`);
    const body = (await res.json()) as DecayAnalysis;

    const pages = body.decayingPages;
    expect(pages.length).toBeGreaterThan(0);

    const criticalCount = pages.filter((p: DecayingPage) => p.severity === 'critical').length;
    const warningCount  = pages.filter((p: DecayingPage) => p.severity === 'warning').length;
    const watchCount    = pages.filter((p: DecayingPage) => p.severity === 'watch').length;

    expect(body.summary.critical).toBe(criticalCount);
    expect(body.summary.warning).toBe(warningCount);
    expect(body.summary.watch).toBe(watchCount);
    expect(body.summary.totalDecaying).toBe(pages.length);
  });
});

// ── Severity classification correctness ──────────────────────────────────────

describe('Severity classification — all three levels present', () => {
  it('critical page is classified as critical (clickDeclinePct <= -50)', async () => {
    const res = await api(`/api/content-decay/${wsWithData}`);
    const body = (await res.json()) as DecayAnalysis;

    const critical = body.decayingPages.find(p => p.page === criticalPage.page);
    expect(critical).toBeDefined();
    expect(critical!.severity).toBe('critical');
    expect(critical!.clickDeclinePct).toBeLessThanOrEqual(-50);
  });

  it('warning page is classified as warning (clickDeclinePct <= -30)', async () => {
    const res = await api(`/api/content-decay/${wsWithData}`);
    const body = (await res.json()) as DecayAnalysis;

    const warning = body.decayingPages.find(p => p.page === warningPage.page);
    expect(warning).toBeDefined();
    expect(warning!.severity).toBe('warning');
    expect(warning!.clickDeclinePct).toBeLessThanOrEqual(-30);
    expect(warning!.clickDeclinePct).toBeGreaterThan(-50);
  });

  it('watch page is classified as watch (clickDeclinePct < -10)', async () => {
    const res = await api(`/api/content-decay/${wsWithData}`);
    const body = (await res.json()) as DecayAnalysis;

    const watch = body.decayingPages.find(p => p.page === watchPage.page);
    expect(watch).toBeDefined();
    expect(watch!.severity).toBe('watch');
    expect(watch!.clickDeclinePct).toBeLessThan(-10);
    expect(watch!.clickDeclinePct).toBeGreaterThan(-30);
  });

  it('summary.critical count equals number of critical pages', async () => {
    const res = await api(`/api/content-decay/${wsWithData}`);
    const body = (await res.json()) as DecayAnalysis;

    const pages = body.decayingPages;
    expect(pages.length).toBeGreaterThan(0);
    const critical = pages.filter((p: DecayingPage) => p.severity === 'critical');
    expect(body.summary.critical).toBe(critical.length);
    expect(body.summary.critical).toBeGreaterThanOrEqual(1);
  });

  it('summary.warning count equals number of warning pages', async () => {
    const res = await api(`/api/content-decay/${wsWithData}`);
    const body = (await res.json()) as DecayAnalysis;

    const pages = body.decayingPages;
    expect(pages.length).toBeGreaterThan(0);
    const warning = pages.filter((p: DecayingPage) => p.severity === 'warning');
    expect(body.summary.warning).toBe(warning.length);
    expect(body.summary.warning).toBeGreaterThanOrEqual(1);
  });

  it('summary.watch count equals number of watch pages', async () => {
    const res = await api(`/api/content-decay/${wsWithData}`);
    const body = (await res.json()) as DecayAnalysis;

    const pages = body.decayingPages;
    expect(pages.length).toBeGreaterThan(0);
    const watch = pages.filter((p: DecayingPage) => p.severity === 'watch');
    expect(body.summary.watch).toBe(watch.length);
    expect(body.summary.watch).toBeGreaterThanOrEqual(1);
  });
});

// ── Workspace isolation ───────────────────────────────────────────────────────

describe('Workspace isolation — decay data is scoped to workspace', () => {
  it('workspace with no data returns null, not data from another workspace', async () => {
    const res = await api(`/api/content-decay/${wsEmpty}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('workspace with data returns only its own pages', async () => {
    const res = await api(`/api/content-decay/${wsWithData}`);
    const body = (await res.json()) as DecayAnalysis;
    expect(body.workspaceId).toBe(wsWithData);
  });

  it('two separate workspaces return independent results', async () => {
    const [resWithData, resEmpty] = await Promise.all([
      api(`/api/content-decay/${wsWithData}`),
      api(`/api/content-decay/${wsEmpty}`),
    ]);

    const withData = (await resWithData.json()) as DecayAnalysis;
    const empty = await resEmpty.json();

    expect(withData).not.toBeNull();
    expect(withData.decayingPages.length).toBeGreaterThan(0);
    expect(empty).toBeNull();
  });
});

// ── POST /api/content-decay/:workspaceId/analyze ─────────────────────────────

describe('POST /api/content-decay/:workspaceId/analyze', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await postJson('/api/content-decay/ws_nonexistent_xyz/analyze', {});
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 500 when workspace has no GSC configuration', async () => {
    // wsEmpty has no gscPropertyUrl or webflowSiteId — analyzeContentDecay will throw
    const res = await postJson(`/api/content-decay/${wsEmpty}/analyze`, {});
    // The route catches the error and returns 500 with { error: string }
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
  });
});

// ── POST /api/content-decay/:workspaceId/recommendations ─────────────────────

describe('POST /api/content-decay/:workspaceId/recommendations', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await postJson('/api/content-decay/ws_nonexistent_xyz/recommendations', {});
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 404 when no cached analysis exists', async () => {
    // wsEmpty has no cached analysis, so the route returns 404
    const res = await postJson(`/api/content-decay/${wsEmpty}/recommendations`, {});
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Run decay analysis first');
  });

  it('returns 500 when AI call fails (FM-2: no phantom success from failed recommendations)', { timeout: 30_000 }, async () => {
    // generateBatchRecommendations calls OpenAI. The test server uses a fake key,
    // so the call fails with auth error. The route must return 500, not a 200 with
    // empty/garbage recommendations (phantom success).
    const res = await postJson(`/api/content-decay/${wsWithData}/recommendations`, { maxPages: 2 });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(typeof body.error).toBe('string');
    expect(body.error!.length).toBeGreaterThan(0);
  });

  // NOTE: A previous test here ("successful recommendations response preserves DecayAnalysis shape")
  // was removed because the unconditional fake OPENAI_API_KEY means the endpoint always returns 500.
  // The test's `if (res.status !== 200) return` guard made it vacuously pass in all environments.
  // Successful recommendation shape is verified by the DecayAnalysis type contract tests instead.
});

// ── GET /api/public/content-decay/:workspaceId ───────────────────────────────

describe('GET /api/public/content-decay/:workspaceId — client portal', () => {
  it('returns null for workspace with no cached analysis', async () => {
    const res = await api(`/api/public/content-decay/${wsEmpty}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('returns decay analysis for workspace with cached data', async () => {
    const res = await api(`/api/public/content-decay/${wsWithData}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DecayAnalysis;

    expect(body).not.toBeNull();
    expect(body.workspaceId).toBe(wsWithData);
    expect(Array.isArray(body.decayingPages)).toBe(true);
    expect(body.decayingPages.length).toBeGreaterThan(0);
  });

  it('public response matches admin response for the same workspace', async () => {
    const [adminRes, publicRes] = await Promise.all([
      api(`/api/content-decay/${wsWithData}`),
      api(`/api/public/content-decay/${wsWithData}`),
    ]);

    expect(adminRes.status).toBe(200);
    expect(publicRes.status).toBe(200);

    const adminBody  = (await adminRes.json()) as DecayAnalysis;
    const publicBody = (await publicRes.json()) as DecayAnalysis;

    expect(publicBody.workspaceId).toBe(adminBody.workspaceId);
    expect(publicBody.totalPages).toBe(adminBody.totalPages);
    expect(publicBody.decayingPages.length).toBe(adminBody.decayingPages.length);
    expect(publicBody.summary.totalDecaying).toBe(adminBody.summary.totalDecaying);
  });

  it('public response has same severity distribution as admin response', async () => {
    const [adminRes, publicRes] = await Promise.all([
      api(`/api/content-decay/${wsWithData}`),
      api(`/api/public/content-decay/${wsWithData}`),
    ]);

    const adminBody  = (await adminRes.json()) as DecayAnalysis;
    const publicBody = (await publicRes.json()) as DecayAnalysis;

    expect(publicBody.summary.critical).toBe(adminBody.summary.critical);
    expect(publicBody.summary.warning).toBe(adminBody.summary.warning);
    expect(publicBody.summary.watch).toBe(adminBody.summary.watch);
  });
});

// ── Edge cases and data invariants ───────────────────────────────────────────

describe('Data invariants', () => {
  it('clickDeclinePct is always negative for decaying pages', async () => {
    const res = await api(`/api/content-decay/${wsWithData}`);
    const body = (await res.json()) as DecayAnalysis;

    const pages = body.decayingPages;
    expect(pages.length).toBeGreaterThan(0);
    for (const p of pages) {
      expect(p.clickDeclinePct).toBeLessThan(0);
    }
  });

  it('summary totalDecaying equals length of decayingPages array', async () => {
    const res = await api(`/api/content-decay/${wsWithData}`);
    const body = (await res.json()) as DecayAnalysis;

    expect(body.summary.totalDecaying).toBe(body.decayingPages.length);
  });

  it('sum of severity counts equals totalDecaying', async () => {
    const res = await api(`/api/content-decay/${wsWithData}`);
    const body = (await res.json()) as DecayAnalysis;

    const { critical, warning, watch, totalDecaying } = body.summary;
    expect(critical + warning + watch).toBe(totalDecaying);
  });

  it('avgDeclinePct is negative when pages are decaying', async () => {
    const res = await api(`/api/content-decay/${wsWithData}`);
    const body = (await res.json()) as DecayAnalysis;

    if (body.summary.totalDecaying > 0) {
      expect(body.summary.avgDeclinePct).toBeLessThan(0);
    }
  });

  it('empty workspace returns null instead of an error response', async () => {
    const res = await api(`/api/content-decay/${wsEmpty}`);
    // Must not throw a 4xx/5xx — missing data is not an error condition
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('workspace with only clean pages produces empty decayingPages when stored that way', async () => {
    const wsClean = createWorkspace('Decay Clean Pages WS');
    // Seed an analysis with zero decaying pages
    seedDecayAnalysis(wsClean.id, [], 15);

    const res = await api(`/api/content-decay/${wsClean.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DecayAnalysis;

    expect(body).not.toBeNull();
    expect(body.decayingPages).toHaveLength(0);
    expect(body.summary.totalDecaying).toBe(0);
    expect(body.summary.critical).toBe(0);
    expect(body.summary.warning).toBe(0);
    expect(body.summary.watch).toBe(0);
    expect(body.summary.avgDeclinePct).toBe(0);

    deleteDecayAnalysis(wsClean.id);
    deleteWorkspace(wsClean.id);
  });
});

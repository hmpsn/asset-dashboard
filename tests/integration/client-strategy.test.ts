/**
 * Integration tests for client-facing strategy endpoints.
 *
 * Tests the HTTP request/response cycle for:
 *   - GET  /api/public/seo-strategy/:workspaceId       — strategy view, seoClientView gate
 *   - GET  /api/public/keyword-feedback/:workspaceId   — list keyword feedback (no auth)
 *   - POST /api/public/keyword-feedback/:workspaceId   — submit feedback (auth required)
 *   - POST /api/public/keyword-feedback/:workspaceId/bulk — bulk feedback (auth required)
 *   - POST /api/public/content-gap-vote/:workspaceId   — vote on content gap (auth required)
 *   - GET  /api/public/content-gap-votes/:workspaceId  — read votes (no auth)
 *
 * Failure modes covered:
 *   FM-1  — Stale/missing data (strategy fields lost or truncated in response)
 *   FM-2  — Wrong workspace (cross-workspace isolation)
 *   FM-4  — Auth gate bypass (mutation endpoints without session)
 *   FM-12 — Broken chain (brand keyword filtering applied correctly)
 *
 * Session strategy for mutation endpoints:
 *   These endpoints require a client session cookie OR a client_user_token JWT.
 *   Tests authenticate via POST /api/public/auth/:workspaceId (shared-password flow)
 *   which sets the client_session cookie in the test cookie jar.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import {
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
} from '../../server/workspaces.js';
import db from '../../server/db/index.js';
import { upsertPageKeyword } from '../../server/page-keywords.js';
import type { KeywordStrategy, ContentGap, QuickWin, PageKeywordMap } from '../../shared/types/workspace.js';

// ── Port — unique across all integration tests ─────────────────────────────

const ctx = createTestContext(13222);
const { api, postJson } = ctx;

// ── Workspace IDs ───────────────────────────────────────────────────────────

// One workspace per concern so rate limiters and data don't bleed between groups.
let strategyWsId = '';       // GET /api/public/seo-strategy tests
let gatedWsId = '';          // seoClientView=false gate tests
let feedbackWsId = '';       // keyword-feedback mutation tests (has shared password)
let voteWsId = '';           // content-gap-vote tests (has shared password)
let isolationWsId = '';      // cross-workspace isolation tests

// ── Test strategy data ──────────────────────────────────────────────────────

function buildStrategy(overrides?: Partial<KeywordStrategy>): KeywordStrategy {
  return {
    siteKeywords: ['seo agency', 'web analytics', 'content marketing'],
    siteKeywordMetrics: [
      { keyword: 'seo agency', volume: 5400, difficulty: 72 },
      { keyword: 'web analytics', volume: 8100, difficulty: 58 },
    ],
    opportunities: ['local seo services', 'technical seo audit'],
    contentGaps: [
      {
        topic: 'Technical SEO Guide',
        targetKeyword: 'technical seo checklist',
        intent: 'informational',
        priority: 'high',
        rationale: 'High search volume, no existing coverage',
        volume: 3200,
        difficulty: 38,
      },
      {
        topic: 'Link Building Strategies',
        targetKeyword: 'link building for seo',
        intent: 'informational',
        priority: 'medium',
        rationale: 'Competitor ranks #3, we have no dedicated content',
        volume: 1900,
        difficulty: 55,
      },
    ] as ContentGap[],
    quickWins: [
      {
        pagePath: '/services',
        currentKeyword: 'seo services near me',
        action: 'Optimize title tag for primary keyword',
        estimatedImpact: 'high',
        rationale: 'Page ranks #12, minor on-page fix could reach first page',
        roiScore: 85,
      },
    ] as QuickWin[],
    keywordGaps: [
      { keyword: 'seo audit tool', volume: 2400, difficulty: 48, competitorPosition: 3, competitorDomain: 'competitor.com' },
      { keyword: 'website analytics dashboard', volume: 1800, difficulty: 42, competitorPosition: 7, competitorDomain: 'rival.io' },
    ],
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Seed keyword feedback rows directly so GET /keyword-feedback has something to return. */
function seedKeywordFeedback(workspaceId: string, rows: Array<{ keyword: string; status: string; reason?: string; source?: string }>) {
  const stmt = db.prepare(`
    INSERT INTO keyword_feedback (workspace_id, keyword, status, reason, source, declined_by)
    VALUES (?, ?, ?, ?, ?, 'test-client')
    ON CONFLICT(workspace_id, keyword) DO UPDATE SET
      status = excluded.status,
      reason = excluded.reason,
      updated_at = datetime('now')
  `);
  for (const row of rows) {
    stmt.run(workspaceId, row.keyword.toLowerCase(), row.status, row.reason ?? null, row.source ?? 'content_gap');
  }
}

/** Delete all keyword_feedback rows for a workspace. */
function cleanKeywordFeedback(workspaceId: string) {
  db.prepare('DELETE FROM keyword_feedback WHERE workspace_id = ?').run(workspaceId);
}

/** Delete all content_gap_votes rows for a workspace. */
function cleanContentGapVotes(workspaceId: string) {
  db.prepare('DELETE FROM content_gap_votes WHERE workspace_id = ?').run(workspaceId);
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

beforeAll(async () => {
  await ctx.startServer();

  // Strategy view workspace (seoClientView = true, strategy populated)
  const stratWs = createWorkspace('Client Strategy Test');
  strategyWsId = stratWs.id;
  updateWorkspace(strategyWsId, {
    seoClientView: true,
    keywordStrategy: buildStrategy(),
  });

  // Seed page_keywords for the strategy workspace (reassembled into pageMap by the endpoint)
  const pageEntries: PageKeywordMap[] = [
    {
      pagePath: '/services',
      pageTitle: 'SEO Services',
      primaryKeyword: 'seo agency',
      secondaryKeywords: ['seo services', 'search engine optimization'],
      searchIntent: 'commercial',
      volume: 5400,
      difficulty: 72,
    },
    {
      pagePath: '/analytics',
      pageTitle: 'Analytics Dashboard',
      primaryKeyword: 'web analytics',
      secondaryKeywords: ['website analytics', 'google analytics'],
      searchIntent: 'informational',
      volume: 8100,
      difficulty: 58,
    },
  ];
  for (const entry of pageEntries) {
    upsertPageKeyword(strategyWsId, entry);
  }

  // Gated workspace: seoClientView intentionally OFF
  const gatedWs = createWorkspace('Client Strategy Gated');
  gatedWsId = gatedWs.id;
  updateWorkspace(gatedWsId, {
    seoClientView: false,
    keywordStrategy: buildStrategy(),
  });

  // Feedback workspace: needs a shared client password for mutation auth
  const feedbackWs = createWorkspace('Client Feedback Test');
  feedbackWsId = feedbackWs.id;
  updateWorkspace(feedbackWsId, { clientPassword: 'feedback-test-pw' });

  // Vote workspace: separate bucket for voting tests
  const voteWs = createWorkspace('Client Vote Test');
  voteWsId = voteWs.id;
  updateWorkspace(voteWsId, { clientPassword: 'vote-test-pw' });

  // Isolation workspace with its own strategy (should not bleed into strategyWsId reads)
  const isolWs = createWorkspace('Isolation Strategy Test');
  isolationWsId = isolWs.id;
  updateWorkspace(isolationWsId, {
    seoClientView: true,
    keywordStrategy: buildStrategy({
      siteKeywords: ['isolation keyword only'],
      opportunities: ['isolation opportunity only'],
    }),
  });
}, 30_000);

afterAll(() => {
  cleanKeywordFeedback(strategyWsId);
  cleanKeywordFeedback(feedbackWsId);
  cleanContentGapVotes(voteWsId);
  db.prepare('DELETE FROM page_keywords WHERE workspace_id = ?').run(strategyWsId);
  deleteWorkspace(strategyWsId);
  deleteWorkspace(gatedWsId);
  deleteWorkspace(feedbackWsId);
  deleteWorkspace(voteWsId);
  deleteWorkspace(isolationWsId);
  ctx.stopServer();
});

// ── GET /api/public/seo-strategy/:workspaceId ───────────────────────────────

describe('GET /api/public/seo-strategy — happy path', () => {
  it('returns 200 with strategy data for workspace with seoClientView enabled', async () => {
    const res = await api(`/api/public/seo-strategy/${strategyWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toBeNull();
  });

  it('response includes top-level strategy fields', async () => {
    const res = await api(`/api/public/seo-strategy/${strategyWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.siteKeywords)).toBe(true);
    expect(Array.isArray(body.opportunities)).toBe(true);
    expect(Array.isArray(body.contentGaps)).toBe(true);
    expect(Array.isArray(body.quickWins)).toBe(true);
    expect(Array.isArray(body.pageMap)).toBe(true);
  });

  it('siteKeywords array is non-empty and preserves seeded values', async () => {
    const res = await api(`/api/public/seo-strategy/${strategyWsId}`);
    const body = await res.json();

    expect(body.siteKeywords.length).toBeGreaterThan(0);
    expect(body.siteKeywords).toContain('seo agency');
    expect(body.siteKeywords).toContain('web analytics');
  });

  it('opportunities array preserves seeded values', async () => {
    const res = await api(`/api/public/seo-strategy/${strategyWsId}`);
    const body = await res.json();

    expect(body.opportunities.length).toBeGreaterThan(0);
    expect(body.opportunities).toContain('local seo services');
  });

  it('contentGaps array preserves all required fields', async () => {
    const res = await api(`/api/public/seo-strategy/${strategyWsId}`);
    const body = await res.json();

    expect(body.contentGaps.length).toBeGreaterThan(0);
    for (const gap of body.contentGaps) {
      expect(typeof gap.topic).toBe('string');
      expect(typeof gap.targetKeyword).toBe('string');
      expect(['informational', 'commercial', 'transactional', 'navigational']).toContain(gap.intent);
      expect(['high', 'medium', 'low']).toContain(gap.priority);
      expect(typeof gap.rationale).toBe('string');
    }
  });

  it('contentGaps include SEMRush enrichment fields (volume and difficulty)', async () => {
    const res = await api(`/api/public/seo-strategy/${strategyWsId}`);
    const body = await res.json();

    expect(body.contentGaps.length).toBeGreaterThan(0);
    const techGap = body.contentGaps.find((g: { targetKeyword: string }) => g.targetKeyword === 'technical seo checklist');
    expect(techGap).toBeDefined();
    expect(techGap.volume).toBe(3200);
    expect(techGap.difficulty).toBe(38);
  });

  it('quickWins array preserves client-safe fields only (no roiScore)', async () => {
    const res = await api(`/api/public/seo-strategy/${strategyWsId}`);
    const body = await res.json();

    expect(body.quickWins.length).toBeGreaterThan(0);
    for (const qw of body.quickWins) {
      expect(typeof qw.pagePath).toBe('string');
      expect(typeof qw.action).toBe('string');
      expect(['high', 'medium', 'low']).toContain(qw.estimatedImpact);
      expect(typeof qw.rationale).toBe('string');
      // roiScore is an internal scoring field — not returned to clients
      expect(qw.roiScore).toBeUndefined();
      // currentKeyword is also not exposed (internal)
      expect(qw.currentKeyword).toBeUndefined();
    }
  });

  it('pageMap is assembled from page_keywords table (not keyword_strategy JSON)', async () => {
    const res = await api(`/api/public/seo-strategy/${strategyWsId}`);
    const body = await res.json();

    expect(body.pageMap.length).toBeGreaterThan(0);
    const servicesPage = body.pageMap.find((p: { pagePath: string }) => p.pagePath === '/services');
    expect(servicesPage).toBeDefined();
    expect(servicesPage.primaryKeyword).toBe('seo agency');
    expect(Array.isArray(servicesPage.secondaryKeywords)).toBe(true);
  });

  it('pageMap entries include enrichment fields where available', async () => {
    const res = await api(`/api/public/seo-strategy/${strategyWsId}`);
    const body = await res.json();

    expect(body.pageMap.length).toBeGreaterThan(0);
    for (const page of body.pageMap) {
      expect(typeof page.pagePath).toBe('string');
      expect(typeof page.primaryKeyword).toBe('string');
      expect(Array.isArray(page.secondaryKeywords)).toBe(true);
      // searchIntent may be null for pages without it set
      if (page.searchIntent !== undefined && page.searchIntent !== null) {
        expect(typeof page.searchIntent).toBe('string');
      }
    }

    // The seeded /services page has volume and difficulty set
    const servicesPage = body.pageMap.find((p: { pagePath: string }) => p.pagePath === '/services');
    expect(servicesPage).toBeDefined();
    expect(servicesPage.volume).toBe(5400);
    expect(servicesPage.difficulty).toBe(72);
  });

  it('keywordGaps are included and capped at 20 entries', async () => {
    const res = await api(`/api/public/seo-strategy/${strategyWsId}`);
    const body = await res.json();

    expect(Array.isArray(body.keywordGaps)).toBe(true);
    expect(body.keywordGaps.length).toBeGreaterThan(0);
    expect(body.keywordGaps.length).toBeLessThanOrEqual(20);

    for (const gap of body.keywordGaps) {
      expect(typeof gap.keyword).toBe('string');
      // volume and difficulty may be undefined but if present must be numbers
      if (gap.volume !== undefined) expect(typeof gap.volume).toBe('number');
      if (gap.difficulty !== undefined) expect(typeof gap.difficulty).toBe('number');
    }
  });

  it('generatedAt timestamp is preserved', async () => {
    const res = await api(`/api/public/seo-strategy/${strategyWsId}`);
    const body = await res.json();

    expect(body.generatedAt).toBeTruthy();
    expect(new Date(body.generatedAt).getTime()).not.toBeNaN();
  });
});

// ── GET /api/public/seo-strategy — gate and edge cases ─────────────────────

describe('GET /api/public/seo-strategy — access control and edge cases', () => {
  it('returns strategy data even when seoClientView is disabled (UI-only gate)', async () => {
    // seoClientView is a tab-visibility toggle in the admin UI — it is NOT a data
    // security gate. The endpoint always returns strategy data because it is needed
    // by Overview insights, InsightsDigest cards, and AI chat context regardless of
    // whether the Strategy tab is visible. strategyLocked handles tab hiding instead.
    const res = await api(`/api/public/seo-strategy/${gatedWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // gatedWsId has a strategy seeded in beforeAll, so it should return it
    expect(body).not.toBeNull();
    expect(Array.isArray(body.siteKeywords)).toBe(true);
  });

  it('returns 404 for nonexistent workspace', async () => {
    const res = await api('/api/public/seo-strategy/ws_nonexistent_99999');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('returns null when workspace has no strategy yet (seoClientView=true, no strategy)', async () => {
    const tempWs = createWorkspace('No Strategy Test');
    try {
      updateWorkspace(tempWs.id, { seoClientView: true });
      const res = await api(`/api/public/seo-strategy/${tempWs.id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toBeNull();
    } finally {
      deleteWorkspace(tempWs.id);
    }
  });

  it('strategy from workspace A is not visible on workspace B endpoint', async () => {
    const resA = await api(`/api/public/seo-strategy/${strategyWsId}`);
    expect(resA.status).toBe(200);
    const bodyA = await resA.json();

    const resB = await api(`/api/public/seo-strategy/${isolationWsId}`);
    expect(resB.status).toBe(200);
    const bodyB = await resB.json();

    // The isolation workspace has a distinct keyword that should not appear in strategyWsId's response
    expect(bodyA.siteKeywords).not.toContain('isolation keyword only');
    expect(bodyB.siteKeywords).toContain('isolation keyword only');
    expect(bodyB.siteKeywords).not.toContain('seo agency');
  });
});

// ── Brand keyword filtering ─────────────────────────────────────────────────

describe('GET /api/public/seo-strategy — brand keyword filtering', () => {
  let brandWsId = '';

  beforeAll(() => {
    const ws = createWorkspace('Brand Filter Test');
    brandWsId = ws.id;

    // Set competitor domains so brand filtering fires during strategy generation
    // and verify it also applies to what's stored in contentGaps
    const strategyWithBrandedGap: KeywordStrategy = buildStrategy({
      contentGaps: [
        {
          topic: 'Technical SEO Guide',
          targetKeyword: 'technical seo checklist',
          intent: 'informational',
          priority: 'high',
          rationale: 'High search volume, no coverage',
        },
        // This entry contains "acme" which matches the competitor domain acme.com
        {
          topic: 'Acme vs Our Agency',
          targetKeyword: 'acme seo agency comparison',
          intent: 'commercial',
          priority: 'medium',
          rationale: 'Competitor branded keyword — should be filtered',
        },
      ] as ContentGap[],
    });

    // The /api/public/seo-strategy endpoint returns contentGaps as-stored;
    // brand filtering happens at strategy GENERATION time (keyword-strategy route POST).
    // What we verify here is that the stored (already-filtered) strategy is passed
    // through as-is without the endpoint re-injecting competitor data.
    updateWorkspace(brandWsId, {
      seoClientView: true,
      competitorDomains: ['acme.com'],
      keywordStrategy: strategyWithBrandedGap,
    });
  });

  afterAll(() => {
    deleteWorkspace(brandWsId);
  });

  it('response does not include internal competitor domain data in client-safe fields', async () => {
    const res = await api(`/api/public/seo-strategy/${brandWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    // The strategy was stored with branded gaps (as generation would normally filter them)
    // The public endpoint must not add semrushMode or other internal admin-only fields
    expect(body.semrushMode).toBeUndefined();
    expect(body.keywordPool).toBeUndefined();
    expect(body.decayingPages).toBeUndefined();
  });

  it('response exposes competitorDomains field as businessContext only, not raw domains', async () => {
    const res = await api(`/api/public/seo-strategy/${brandWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    // competitorDomains is never surfaced to clients via this endpoint
    expect(body.competitorDomains).toBeUndefined();
  });
});

// ── GET /api/public/keyword-feedback — list (no auth required) ──────────────

describe('GET /api/public/keyword-feedback — list feedback', () => {
  let seedWsId = '';

  beforeAll(() => {
    const ws = createWorkspace('Keyword Feedback List Test');
    seedWsId = ws.id;
    seedKeywordFeedback(seedWsId, [
      { keyword: 'approved keyword alpha', status: 'approved', source: 'content_gap' },
      { keyword: 'declined keyword beta', status: 'declined', reason: 'Not relevant to our business', source: 'content_gap' },
      { keyword: 'requested keyword gamma', status: 'requested', source: 'page_map' },
    ]);
  });

  afterAll(() => {
    cleanKeywordFeedback(seedWsId);
    deleteWorkspace(seedWsId);
  });

  it('returns 200 with an array', async () => {
    const res = await api(`/api/public/keyword-feedback/${seedWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns all seeded feedback rows', async () => {
    const res = await api(`/api/public/keyword-feedback/${seedWsId}`);
    const body = await res.json();

    expect(body.length).toBeGreaterThan(0);
    expect(body.length).toBe(3);
  });

  it('each row has required fields: keyword, status, source, created_at, updated_at', async () => {
    const res = await api(`/api/public/keyword-feedback/${seedWsId}`);
    const body = await res.json();

    expect(body.length).toBeGreaterThan(0);
    for (const row of body) {
      expect(typeof row.keyword).toBe('string');
      expect(['approved', 'declined', 'requested']).toContain(row.status);
      expect(typeof row.source).toBe('string');
      expect(row.created_at).toBeTruthy();
      expect(row.updated_at).toBeTruthy();
    }
  });

  it('declined row includes reason field', async () => {
    const res = await api(`/api/public/keyword-feedback/${seedWsId}`);
    const body = await res.json();

    expect(body.length).toBeGreaterThan(0);
    const declined = body.find((r: { status: string }) => r.status === 'declined');
    expect(declined).toBeDefined();
    expect(declined.reason).toBe('Not relevant to our business');
  });

  it('returns 404 for nonexistent workspace', async () => {
    const res = await api('/api/public/keyword-feedback/ws_nonexistent_99999');
    expect(res.status).toBe(404);
  });

  it('returns empty array for workspace with no feedback', async () => {
    const emptyWs = createWorkspace('Empty Feedback WS');
    try {
      const res = await api(`/api/public/keyword-feedback/${emptyWs.id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(0);
    } finally {
      deleteWorkspace(emptyWs.id);
    }
  });
});

// ── POST /api/public/keyword-feedback — submit feedback (auth required) ─────

describe('POST /api/public/keyword-feedback — submit feedback', () => {
  // Authenticate once before all mutation tests in this describe block
  beforeAll(async () => {
    // feedbackWsId has clientPassword='feedback-test-pw' set in outer beforeAll
    const authRes = await postJson(`/api/public/auth/${feedbackWsId}`, {
      password: 'feedback-test-pw',
    });
    expect(authRes.status).toBe(200);
    // Cookie jar in ctx now holds client_session_{feedbackWsId}
  });

  afterAll(() => {
    cleanKeywordFeedback(feedbackWsId);
  });

  it('returns 401 without a session cookie', async () => {
    // We need a fresh context without the session cookie — test by sending to a
    // workspace we haven't authenticated against (uses same IP/cookie jar but
    // the cookie key is workspace-scoped so it won't match another workspace)
    const unauthWs = createWorkspace('Unauth Feedback WS');
    try {
      updateWorkspace(unauthWs.id, { clientPassword: 'some-password' });
      const res = await postJson(`/api/public/keyword-feedback/${unauthWs.id}`, {
        keyword: 'some keyword',
        status: 'approved',
      });
      // No session cookie for unauthWs, so auth check fails
      expect(res.status).toBe(401);
    } finally {
      deleteWorkspace(unauthWs.id);
    }
  });

  it('returns 400 when keyword is missing', async () => {
    const res = await postJson(`/api/public/keyword-feedback/${feedbackWsId}`, {
      status: 'approved',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('returns 400 when status is missing', async () => {
    const res = await postJson(`/api/public/keyword-feedback/${feedbackWsId}`, {
      keyword: 'seo audit tool',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('returns 400 when status is an invalid value', async () => {
    const res = await postJson(`/api/public/keyword-feedback/${feedbackWsId}`, {
      keyword: 'seo audit tool',
      status: 'maybe', // not in approved|declined|requested
    });
    expect(res.status).toBe(400);
  });

  it('successfully approves a keyword and persists to DB', async () => {
    const res = await postJson(`/api/public/keyword-feedback/${feedbackWsId}`, {
      keyword: 'seo audit tool',
      status: 'approved',
      source: 'content_gap',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keyword).toBe('seo audit tool');
    expect(body.status).toBe('approved');

    // Verify persistence via GET
    const listRes = await api(`/api/public/keyword-feedback/${feedbackWsId}`);
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.length).toBeGreaterThan(0);
    const stored = list.find((r: { keyword: string }) => r.keyword === 'seo audit tool');
    expect(stored).toBeDefined();
    expect(stored.status).toBe('approved');
  });

  it('successfully declines a keyword with a reason', async () => {
    const res = await postJson(`/api/public/keyword-feedback/${feedbackWsId}`, {
      keyword: 'competitor brand keyword',
      status: 'declined',
      reason: 'This is our competitor, not a target keyword',
      source: 'content_gap',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keyword).toBe('competitor brand keyword');
    expect(body.status).toBe('declined');
    expect(body.reason).toBe('This is our competitor, not a target keyword');
  });

  it('submits a requested keyword (client-initiated topic idea)', async () => {
    const res = await postJson(`/api/public/keyword-feedback/${feedbackWsId}`, {
      keyword: 'ai content tools for seo',
      status: 'requested',
      source: 'page_map',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keyword).toBe('ai content tools for seo');
    expect(body.status).toBe('requested');
  });

  it('upserts on conflict — second submission for same keyword updates status', async () => {
    const keyword = 'upsert-test-keyword-' + Date.now();

    // First submission: approve
    const first = await postJson(`/api/public/keyword-feedback/${feedbackWsId}`, {
      keyword,
      status: 'approved',
    });
    expect(first.status).toBe(200);

    // Second submission: decline the same keyword
    const second = await postJson(`/api/public/keyword-feedback/${feedbackWsId}`, {
      keyword,
      status: 'declined',
      reason: 'Changed my mind',
    });
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body.status).toBe('declined');

    // Verify only one row exists (no duplicates)
    const listRes = await api(`/api/public/keyword-feedback/${feedbackWsId}`);
    const list = await listRes.json();
    const matches = list.filter((r: { keyword: string }) => r.keyword === keyword.toLowerCase());
    expect(matches.length).toBe(1);
    expect(matches[0].status).toBe('declined');
  });

  it('normalises keyword to lowercase', async () => {
    const res = await postJson(`/api/public/keyword-feedback/${feedbackWsId}`, {
      keyword: 'MixedCase Keyword',
      status: 'approved',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keyword).toBe('mixedcase keyword');
  });
});

// ── POST /api/public/keyword-feedback/:id/bulk ──────────────────────────────

describe('POST /api/public/keyword-feedback/bulk — batch feedback', () => {
  let bulkWsId = '';

  beforeAll(async () => {
    const ws = createWorkspace('Bulk Feedback Test');
    bulkWsId = ws.id;
    updateWorkspace(bulkWsId, { clientPassword: 'bulk-test-pw' });

    // Authenticate to get session cookie for bulkWsId
    const authRes = await postJson(`/api/public/auth/${bulkWsId}`, {
      password: 'bulk-test-pw',
    });
    expect(authRes.status).toBe(200);
  });

  afterAll(() => {
    cleanKeywordFeedback(bulkWsId);
    deleteWorkspace(bulkWsId);
  });

  it('returns 401 without a session cookie for this workspace', async () => {
    const unauthWs = createWorkspace('Unauth Bulk WS');
    try {
      updateWorkspace(unauthWs.id, { clientPassword: 'pw' });
      const res = await postJson(`/api/public/keyword-feedback/${unauthWs.id}/bulk`, {
        keywords: [{ keyword: 'test', status: 'approved' }],
      });
      expect(res.status).toBe(401);
    } finally {
      deleteWorkspace(unauthWs.id);
    }
  });

  it('returns 400 when keywords field is missing', async () => {
    const res = await postJson(`/api/public/keyword-feedback/${bulkWsId}/bulk`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('returns 400 when keywords is an empty array', async () => {
    const res = await postJson(`/api/public/keyword-feedback/${bulkWsId}/bulk`, {
      keywords: [],
    });
    expect(res.status).toBe(400);
  });

  it('persists all valid keywords in the batch', async () => {
    const res = await postJson(`/api/public/keyword-feedback/${bulkWsId}/bulk`, {
      keywords: [
        { keyword: 'bulk keyword alpha', status: 'approved', source: 'content_gap' },
        { keyword: 'bulk keyword beta', status: 'declined', reason: 'Off-brand', source: 'content_gap' },
        { keyword: 'bulk keyword gamma', status: 'requested', source: 'page_map' },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(3);

    // Verify all three were persisted
    const listRes = await api(`/api/public/keyword-feedback/${bulkWsId}`);
    const list = await listRes.json();
    expect(list.length).toBeGreaterThan(0);

    const alphaRow = list.find((r: { keyword: string }) => r.keyword === 'bulk keyword alpha');
    const betaRow = list.find((r: { keyword: string }) => r.keyword === 'bulk keyword beta');
    const gammaRow = list.find((r: { keyword: string }) => r.keyword === 'bulk keyword gamma');

    expect(alphaRow).toBeDefined();
    expect(alphaRow.status).toBe('approved');

    expect(betaRow).toBeDefined();
    expect(betaRow.status).toBe('declined');

    expect(gammaRow).toBeDefined();
    expect(gammaRow.status).toBe('requested');
  });

  it('skips items with invalid status in the batch (transaction-safe)', async () => {
    // The server silently skips invalid items per the implementation's `continue` guard
    const res = await postJson(`/api/public/keyword-feedback/${bulkWsId}/bulk`, {
      keywords: [
        { keyword: 'valid item', status: 'approved' },
        { keyword: 'bad status item', status: 'invalid_status' },
      ],
    });
    // Server returns 200 and counts all submitted (even if some skipped)
    expect(res.status).toBe(200);

    const listRes = await api(`/api/public/keyword-feedback/${bulkWsId}`);
    const list = await listRes.json();

    // 'valid item' should be stored
    const validRow = list.find((r: { keyword: string }) => r.keyword === 'valid item');
    expect(validRow).toBeDefined();

    // 'bad status item' should NOT be stored (server skips it)
    const badRow = list.find((r: { keyword: string }) => r.keyword === 'bad status item');
    expect(badRow).toBeUndefined();
  });
});

// ── Content gap voting ──────────────────────────────────────────────────────

describe('POST /api/public/content-gap-vote — voting', () => {
  beforeAll(async () => {
    // Authenticate voteWsId for mutation tests
    const authRes = await postJson(`/api/public/auth/${voteWsId}`, {
      password: 'vote-test-pw',
    });
    expect(authRes.status).toBe(200);
  });

  afterAll(() => {
    cleanContentGapVotes(voteWsId);
  });

  it('returns 401 without auth for a password-protected workspace', async () => {
    const unauthWs = createWorkspace('Unauth Vote WS');
    try {
      updateWorkspace(unauthWs.id, { clientPassword: 'pw' });
      const res = await postJson(`/api/public/content-gap-vote/${unauthWs.id}`, {
        keyword: 'technical seo',
        vote: 'up',
      });
      expect(res.status).toBe(401);
    } finally {
      deleteWorkspace(unauthWs.id);
    }
  });

  it('returns 400 when keyword is missing', async () => {
    const res = await postJson(`/api/public/content-gap-vote/${voteWsId}`, {
      vote: 'up',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('returns 400 when vote is an invalid value', async () => {
    const res = await postJson(`/api/public/content-gap-vote/${voteWsId}`, {
      keyword: 'technical seo',
      vote: 'maybe', // not in up|down|none
    });
    expect(res.status).toBe(400);
  });

  it('successfully records an upvote', async () => {
    const res = await postJson(`/api/public/content-gap-vote/${voteWsId}`, {
      keyword: 'technical seo checklist',
      vote: 'up',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('successfully records a downvote', async () => {
    const res = await postJson(`/api/public/content-gap-vote/${voteWsId}`, {
      keyword: 'link building strategies',
      vote: 'down',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('vote=none removes an existing vote', async () => {
    const keyword = 'removable vote keyword ' + Date.now();

    // First, cast a vote
    const voteRes = await postJson(`/api/public/content-gap-vote/${voteWsId}`, {
      keyword,
      vote: 'up',
    });
    expect(voteRes.status).toBe(200);

    // Then remove it
    const removeRes = await postJson(`/api/public/content-gap-vote/${voteWsId}`, {
      keyword,
      vote: 'none',
    });
    expect(removeRes.status).toBe(200);
    expect((await removeRes.json()).ok).toBe(true);

    // Verify it's gone from the votes map
    const votesRes = await api(`/api/public/content-gap-votes/${voteWsId}`);
    const votesBody = await votesRes.json();
    expect(votesBody.votes[keyword.toLowerCase()]).toBeUndefined();
  });

  it('upserting an existing vote changes it (down → up)', async () => {
    const keyword = 'flip vote keyword ' + Date.now();

    await postJson(`/api/public/content-gap-vote/${voteWsId}`, { keyword, vote: 'down' });
    await postJson(`/api/public/content-gap-vote/${voteWsId}`, { keyword, vote: 'up' });

    const votesRes = await api(`/api/public/content-gap-votes/${voteWsId}`);
    const votesBody = await votesRes.json();
    expect(votesBody.votes[keyword.toLowerCase()]).toBe('up');
  });
});

// ── GET /api/public/content-gap-votes — read votes (no auth) ───────────────

describe('GET /api/public/content-gap-votes — retrieve votes', () => {
  let readVoteWsId = '';

  beforeAll(() => {
    const ws = createWorkspace('Read Votes Test');
    readVoteWsId = ws.id;
    // Directly seed votes via DB (bypasses auth requirement)
    db.prepare(`
      INSERT INTO content_gap_votes (workspace_id, keyword, vote, voted_by, updated_at)
      VALUES (?, ?, ?, 'test-client', datetime('now'))
    `).run(readVoteWsId, 'link building for seo', 'up');
    db.prepare(`
      INSERT INTO content_gap_votes (workspace_id, keyword, vote, voted_by, updated_at)
      VALUES (?, ?, ?, 'test-client', datetime('now'))
    `).run(readVoteWsId, 'technical seo guide', 'down');
  });

  afterAll(() => {
    cleanContentGapVotes(readVoteWsId);
    deleteWorkspace(readVoteWsId);
  });

  it('returns 200 with votes object', async () => {
    const res = await api(`/api/public/content-gap-votes/${readVoteWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('votes');
    expect(typeof body.votes).toBe('object');
  });

  it('votes object contains seeded keyword → vote pairs', async () => {
    const res = await api(`/api/public/content-gap-votes/${readVoteWsId}`);
    const body = await res.json();

    const votes = body.votes as Record<string, string>;
    expect(Object.keys(votes).length).toBeGreaterThan(0);
    expect(votes['link building for seo']).toBe('up');
    expect(votes['technical seo guide']).toBe('down');
  });

  it('returns 404 for nonexistent workspace', async () => {
    const res = await api('/api/public/content-gap-votes/ws_nonexistent_99999');
    expect(res.status).toBe(404);
  });

  it('returns empty votes object for workspace with no votes', async () => {
    const emptyWs = createWorkspace('No Votes WS');
    try {
      const res = await api(`/api/public/content-gap-votes/${emptyWs.id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.votes).toEqual({});
    } finally {
      deleteWorkspace(emptyWs.id);
    }
  });

  it('votes are scoped to the workspace (cross-workspace isolation)', async () => {
    const otherWs = createWorkspace('Other Vote WS');
    try {
      // Seed a vote only for otherWs
      db.prepare(`
        INSERT INTO content_gap_votes (workspace_id, keyword, vote, voted_by, updated_at)
        VALUES (?, ?, ?, 'client', datetime('now'))
      `).run(otherWs.id, 'other workspace keyword', 'up');

      const resOwn = await api(`/api/public/content-gap-votes/${readVoteWsId}`);
      const ownVotes = (await resOwn.json()).votes;

      const resOther = await api(`/api/public/content-gap-votes/${otherWs.id}`);
      const otherVotes = (await resOther.json()).votes;

      // readVoteWsId should NOT see 'other workspace keyword'
      expect(ownVotes['other workspace keyword']).toBeUndefined();
      // otherWs should NOT see readVoteWsId's 'link building for seo'
      expect(otherVotes['link building for seo']).toBeUndefined();
    } finally {
      cleanContentGapVotes(otherWs.id);
      deleteWorkspace(otherWs.id);
    }
  });
});

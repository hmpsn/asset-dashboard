/**
 * Extended integration tests for keyword-strategy routes.
 *
 * Covers branches not exercised by the existing keyword-strategy test suite:
 *   - GET  /api/webflow/keyword-strategy/:wsId        (error paths, serialization branches)
 *   - GET  /api/webflow/keyword-strategy/:wsId/diff   (no strategy, no history, full diff)
 *   - PATCH /api/webflow/keyword-strategy/:wsId       (workspace-not-found, invalid body, blob fields)
 *   - GET  /api/webflow/keyword-feedback/:wsId        (not found, empty list)
 *   - POST /api/webflow/keyword-feedback/:wsId        (status variants, source variants, declinedBy)
 *   - POST /api/webflow/keyword-feedback/:wsId/bulk   (approve/decline mix, tracks approved)
 *   - DELETE /api/webflow/keyword-feedback/:wsId/:kw  (found, not-found, previously-declined)
 *   - GET  /api/webflow/keyword-strategy/:wsId/signals (workspace-not-found, empty insights)
 *   - Auth / workspace isolation (wrong workspace JWT is blocked)
 *
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';
import { upsertPageKeyword } from '../../server/page-keywords.js';
import { replaceAllContentGaps } from '../../server/content-gaps.js';
import { replaceAllQuickWins } from '../../server/quick-wins.js';
import { replaceAllKeywordGaps } from '../../server/keyword-gaps.js';
import { replaceAllTopicClusters } from '../../server/topic-clusters.js';
import { replaceAllCannibalizationIssues } from '../../server/cannibalization-issues.js';
import type { KeywordStrategy } from '../../shared/types/workspace.js';

const ctx = createEphemeralTestContext(import.meta.url);

// ── Workspace IDs ────────────────────────────────────────────────────────────

let mainWsId = '';      // workspace with a full keywordStrategy blob + page_keywords
let emptyWsId = '';     // workspace with nothing at all
let tableOnlyWsId = ''; // workspace with only table-backed rows (no blob)
let historyWsId = '';   // workspace with strategy + strategy_history row

const createdWsIds: string[] = [];

function freshWs(label: string): string {
  const ws = createWorkspace(label);
  createdWsIds.push(ws.id);
  return ws.id;
}

function cleanFeedback(wsId: string) {
  db.prepare('DELETE FROM keyword_feedback WHERE workspace_id = ?').run(wsId);
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await ctx.startServer();

  // Main workspace: full strategy blob + page_keywords + all table-backed data
  mainWsId = freshWs('Extended Routes — Main');
  const fullStrategy: KeywordStrategy = {
    siteKeywords: ['seo services', 'digital marketing', 'local seo'],
    opportunities: ['rank for local seo', 'expand to national market'],
    generatedAt: '2026-04-01T12:00:00.000Z',
    seoDataMode: 'full',
    seoDataStatus: {
      mode: 'full',
      provider: 'dataforseo',
      status: 'available',
      reasons: [],
      fallbackProviderAvailable: false,
    },
  };
  updateWorkspace(mainWsId, { keywordStrategy: fullStrategy });
  upsertPageKeyword(mainWsId, {
    pagePath: '/services',
    pageTitle: 'Services',
    primaryKeyword: 'seo services',
    secondaryKeywords: ['seo agency'],
    analysisGeneratedAt: '2026-04-01T11:00:00.000Z',
  });
  replaceAllContentGaps(mainWsId, [
    {
      topic: 'link building',
      targetKeyword: 'link building services',
      intent: 'commercial',
      priority: 'high',
      rationale: 'High volume, low coverage',
      suggestedPageType: 'service',
    },
  ]);
  replaceAllQuickWins(mainWsId, [
    { pagePath: '/services', action: 'Improve meta description', estimatedImpact: 'high', rationale: 'CTR boost' },
  ]);
  replaceAllKeywordGaps(mainWsId, [
    {
      keyword: 'enterprise seo',
      volume: 3200,
      difficulty: 55,
      competitorPosition: 4,
      competitorDomain: 'competitor.com',
    },
  ]);
  replaceAllTopicClusters(mainWsId, [
    {
      topic: 'seo',
      keywords: ['seo services', 'local seo'],
      ownedCount: 2,
      totalCount: 5,
      coveragePercent: 40,
      gap: ['enterprise seo', 'seo audit', 'technical seo'],
    },
  ]);
  replaceAllCannibalizationIssues(mainWsId, [
    {
      keyword: 'seo services',
      pages: [
        { path: '/services', source: 'keyword_map' },
        { path: '/seo', source: 'gsc' },
      ],
      severity: 'medium',
      recommendation: 'Merge or redirect /seo to /services',
    },
  ]);

  // Empty workspace
  emptyWsId = freshWs('Extended Routes — Empty');

  // Table-only workspace: page_keywords only, no strategy blob
  tableOnlyWsId = freshWs('Extended Routes — TableOnly');
  upsertPageKeyword(tableOnlyWsId, {
    pagePath: '/blog',
    pageTitle: 'Blog',
    primaryKeyword: 'seo tips',
    secondaryKeywords: ['search tips'],
    analysisGeneratedAt: '2026-04-01T10:00:00.000Z',
  });

  // History workspace: strategy + one history row
  historyWsId = freshWs('Extended Routes — WithHistory');
  const historyStrategy: KeywordStrategy = {
    siteKeywords: ['marketing'],
    opportunities: [],
    generatedAt: '2026-03-01T00:00:00.000Z',
  };
  updateWorkspace(historyWsId, { keywordStrategy: historyStrategy });
  db.prepare(`
    INSERT INTO strategy_history (workspace_id, strategy_json, page_map_json, generated_at)
    VALUES (?, ?, ?, ?)
  `).run(
    historyWsId,
    JSON.stringify({ siteKeywords: ['old marketing'], contentGaps: [{ targetKeyword: 'old gap', topic: 'old topic', intent: 'informational', priority: 'low', rationale: 'historical', suggestedPageType: 'blog' }] }),
    JSON.stringify([{ pagePath: '/old-page', primaryKeyword: 'old keyword' }]),
    '2026-02-01T00:00:00.000Z',
  );
}, 30_000);

afterAll(async () => {
  for (const wsId of createdWsIds) {
    cleanFeedback(wsId);
    db.prepare('DELETE FROM strategy_history WHERE workspace_id = ?').run(wsId);
    deleteWorkspace(wsId);
  }
  await ctx.stopServer();
});

// ── GET /api/webflow/keyword-strategy/:wsId ───────────────────────────────────

describe('GET /api/webflow/keyword-strategy — serialization and edge cases', () => {
  it('returns full strategy with all table-backed fields for a workspace with a blob', async () => {
    const res = await ctx.api(`/api/webflow/keyword-strategy/${mainWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).not.toBeNull();
    expect(body.siteKeywords).toEqual(['seo services', 'digital marketing', 'local seo']);
    expect(body.generatedAt).toBe('2026-04-01T12:00:00.000Z');
    expect(body.seoDataMode).toBe('full');
    // Table-backed fields merged in
    expect(Array.isArray(body.pageMap)).toBe(true);
    expect(body.pageMap.length).toBe(1);
    expect(body.pageMap[0].pagePath).toBe('/services');
    expect(Array.isArray(body.contentGaps)).toBe(true);
    expect(body.contentGaps.length).toBe(1);
    expect(body.contentGaps[0].targetKeyword).toBe('link building services');
    expect(Array.isArray(body.quickWins)).toBe(true);
    expect(body.quickWins.length).toBe(1);
    expect(Array.isArray(body.keywordGaps)).toBe(true);
    expect(body.keywordGaps.length).toBe(1);
    expect(Array.isArray(body.topicClusters)).toBe(true);
    expect(body.topicClusters.length).toBe(1);
    expect(Array.isArray(body.cannibalization)).toBe(true);
    expect(body.cannibalization.length).toBe(1);
  });

  it('serializes seoDataStatus with all fields including fallbackProviderAvailable', async () => {
    const res = await ctx.api(`/api/webflow/keyword-strategy/${mainWsId}`);
    const body = await res.json();
    expect(body.seoDataStatus).toMatchObject({
      mode: 'full',
      provider: 'dataforseo',
      status: 'available',
      reasons: [],
      fallbackProviderAvailable: false,
    });
  });

  it('strips semrushMode from serialized output without using it as seoDataMode fallback', async () => {
    // Seed a workspace whose blob contains the legacy semrushMode field but no seoDataMode.
    // Route serialization must not honor the stale alias.
    const wsId = freshWs('GET strip semrushMode field');
    const legacyStrategy = {
      siteKeywords: ['clean keyword'],
      opportunities: [],
      generatedAt: '2026-04-01T00:00:00.000Z',
      semrushMode: 'full' as const,  // stale alias — should be stripped from root output
      // seoDataMode intentionally absent to ensure no compatibility fallback occurs
    };
    updateWorkspace(wsId, { keywordStrategy: legacyStrategy as unknown as KeywordStrategy });

    const res = await ctx.api(`/api/webflow/keyword-strategy/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // semrushMode must NOT appear at root of response — serializeKeywordStrategy strips it
    expect(Object.prototype.hasOwnProperty.call(body, 'semrushMode')).toBe(false);
    // seoDataMode now derives only from canonical field; absent values normalize to none
    expect(body.seoDataMode).toBe('none');
    // siteKeywords should be intact
    expect(body.siteKeywords).toEqual(['clean keyword']);
  });

  it('serves legacy blob contentGaps when content_gaps table is empty (fallback path)', async () => {
    // The GET endpoint falls back to blob contentGaps when table rows are absent.
    // This is the documented legacy path — "contentGaps in the blob" predates table normalization.
    const wsId = freshWs('GET legacy blob contentGaps fallback');
    const strategyWithBlobGaps = {
      siteKeywords: ['blog keyword'],
      opportunities: [],
      generatedAt: '2026-04-01T00:00:00.000Z',
      contentGaps: [
        { topic: 'legacy topic', targetKeyword: 'legacy gap kw', intent: 'informational', priority: 'low', rationale: 'historical', suggestedPageType: 'blog' },
      ],
    };
    updateWorkspace(wsId, { keywordStrategy: strategyWithBlobGaps as unknown as KeywordStrategy });
    // No replaceAllContentGaps call → table is empty → blob fallback fires

    const res = await ctx.api(`/api/webflow/keyword-strategy/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Fallback serves the blob contentGaps
    expect(body.contentGaps).toHaveLength(1);
    expect(body.contentGaps[0].targetKeyword).toBe('legacy gap kw');
    // But semrushMode should NOT appear in the response
    expect(Object.prototype.hasOwnProperty.call(body, 'semrushMode')).toBe(false);
  });

  it('returns null for a completely empty workspace with no page_keywords or blob', async () => {
    const res = await ctx.api(`/api/webflow/keyword-strategy/${emptyWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('returns synthesized shell when only page_keywords rows exist (no blob)', async () => {
    const res = await ctx.api(`/api/webflow/keyword-strategy/${tableOnlyWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toBeNull();
    expect(body.generatedAt).toBeNull();
    expect(body.siteKeywords).toEqual([]);
    expect(body.opportunities).toEqual([]);
    expect(body.pageMap.length).toBe(1);
    expect(body.pageMap[0].pagePath).toBe('/blog');
  });

  it('returns 404 for a non-existent workspace', async () => {
    const res = await ctx.api('/api/webflow/keyword-strategy/ws_totally_nonexistent_999');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/workspace not found/i);
  });

  it('returns synthesized shell when workspace has only table-backed contentGaps (no blob, no pageMap)', async () => {
    const wsId = freshWs('GET contentGaps only shell');
    replaceAllContentGaps(wsId, [
      { topic: 'blog topics', targetKeyword: 'content strategy', intent: 'informational', priority: 'medium', rationale: 'low competition', suggestedPageType: 'blog' },
    ]);

    const res = await ctx.api(`/api/webflow/keyword-strategy/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toBeNull();
    expect(body.generatedAt).toBeNull();
    expect(body.contentGaps.length).toBe(1);
    expect(body.contentGaps[0].targetKeyword).toBe('content strategy');
  });
});

// ── GET /api/webflow/keyword-strategy/:wsId/diff ─────────────────────────────

describe('GET /api/webflow/keyword-strategy/:wsId/diff', () => {
  it('returns null when the workspace has no strategy blob', async () => {
    const res = await ctx.api(`/api/webflow/keyword-strategy/${emptyWsId}/diff`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('returns null when strategy exists but has no history row', async () => {
    const wsId = freshWs('DIFF no history');
    updateWorkspace(wsId, { keywordStrategy: { siteKeywords: ['fresh'], opportunities: [], generatedAt: new Date().toISOString() } });

    const res = await ctx.api(`/api/webflow/keyword-strategy/${wsId}/diff`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('returns 404 for a non-existent workspace', async () => {
    const res = await ctx.api('/api/webflow/keyword-strategy/ws_nonexistent_diff_999/diff');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/workspace not found/i);
  });

  it('returns diff shape when strategy and history both exist', async () => {
    const res = await ctx.api(`/api/webflow/keyword-strategy/${historyWsId}/diff`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).not.toBeNull();
    expect(typeof body.previousGeneratedAt).toBe('string');
    expect(typeof body.currentGeneratedAt).toBe('string');
    expect(Array.isArray(body.newKeywords)).toBe(true);
    expect(Array.isArray(body.lostKeywords)).toBe(true);
    expect(Array.isArray(body.newGaps)).toBe(true);
    expect(Array.isArray(body.resolvedGaps)).toBe(true);
    expect(Array.isArray(body.keywordChanges)).toBe(true);
    expect(typeof body.prevSiteKeywordCount).toBe('number');
    expect(typeof body.currSiteKeywordCount).toBe('number');
  });

  it('correctly computes newKeywords and lostKeywords against history', async () => {
    const res = await ctx.api(`/api/webflow/keyword-strategy/${historyWsId}/diff`);
    const body = await res.json();

    // Current blob has ['marketing'], history has ['old marketing']
    expect(body.newKeywords).toContain('marketing');
    expect(body.lostKeywords).toContain('old marketing');
    expect(body.prevSiteKeywordCount).toBe(1);
    expect(body.currSiteKeywordCount).toBe(1);
  });

  it('correctly computes resolvedGaps against history contentGaps', async () => {
    const res = await ctx.api(`/api/webflow/keyword-strategy/${historyWsId}/diff`);
    const body = await res.json();

    // History had contentGap 'old gap', current content_gaps table is empty for historyWsId
    expect(body.resolvedGaps).toContain('old gap');
    expect(body.newGaps).toEqual([]);
  });

  it('detects keyword changes in page map between history and current', async () => {
    const wsId = freshWs('DIFF pageMap changes');
    updateWorkspace(wsId, {
      keywordStrategy: {
        siteKeywords: ['local seo'],
        opportunities: [],
        generatedAt: '2026-04-15T00:00:00.000Z',
      },
    });
    // Seed page_keywords with current data
    upsertPageKeyword(wsId, {
      pagePath: '/services',
      pageTitle: 'Services',
      primaryKeyword: 'seo agency',   // was 'old seo' in history
      secondaryKeywords: [],
      analysisGeneratedAt: '2026-04-15T00:00:00.000Z',
    });
    // Insert history with different keyword for same page
    db.prepare(`
      INSERT INTO strategy_history (workspace_id, strategy_json, page_map_json, generated_at)
      VALUES (?, ?, ?, ?)
    `).run(
      wsId,
      JSON.stringify({ siteKeywords: ['old keyword'] }),
      JSON.stringify([{ pagePath: '/services', primaryKeyword: 'old seo' }]),
      '2026-03-01T00:00:00.000Z',
    );

    const res = await ctx.api(`/api/webflow/keyword-strategy/${wsId}/diff`);
    const body = await res.json();

    const change = body.keywordChanges.find((c: { pagePath: string }) => c.pagePath === '/services');
    expect(change).toBeDefined();
    expect(change.oldKeyword).toBe('old seo');
    expect(change.newKeyword).toBe('seo agency');
  });
});

// ── PATCH /api/webflow/keyword-strategy/:wsId ────────────────────────────────

describe('PATCH /api/webflow/keyword-strategy — error and success paths', () => {
  it('returns 404 for a non-existent workspace', async () => {
    const res = await ctx.patchJson('/api/webflow/keyword-strategy/ws_totally_nonexistent_patch', {
      siteKeywords: ['some keyword'],
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/workspace not found/i);
  });

  it('returns 400 for unknown fields (strict schema)', async () => {
    const wsId = freshWs('PATCH strict unknown fields');
    const res = await ctx.patchJson(`/api/webflow/keyword-strategy/${wsId}`, {
      siteKeywords: ['valid'],
      unknownExtraField: 'not allowed',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when pageMap entries have invalid shape', async () => {
    const wsId = freshWs('PATCH invalid pageMap entries');
    const res = await ctx.patchJson(`/api/webflow/keyword-strategy/${wsId}`, {
      pageMap: [{ pagePath: 123, primaryKeyword: 'bad' }],  // pagePath must be string
    });
    expect(res.status).toBe(400);
  });

  it('updates opportunities field in the blob', async () => {
    const wsId = freshWs('PATCH opportunities field');
    const res = await ctx.patchJson(`/api/webflow/keyword-strategy/${wsId}`, {
      opportunities: ['opportunity one', 'opportunity two'],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.opportunities).toEqual(['opportunity one', 'opportunity two']);
    expect(body.generatedAt).toBeTruthy();
  });

  it('PATCH with siteKeywords on existing blob merges without dropping existing opportunities', async () => {
    const wsId = freshWs('PATCH merge blob fields');
    updateWorkspace(wsId, {
      keywordStrategy: {
        siteKeywords: ['original keyword'],
        opportunities: ['original opportunity'],
        generatedAt: '2026-01-01T00:00:00.000Z',
      },
    });

    const res = await ctx.patchJson(`/api/webflow/keyword-strategy/${wsId}`, {
      siteKeywords: ['updated keyword'],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.siteKeywords).toEqual(['updated keyword']);
    // Existing opportunities preserved from merge
    expect(body.opportunities).toEqual(['original opportunity']);
  });

  it('response includes all table-backed arrays even for blob-only PATCH', async () => {
    const wsId = freshWs('PATCH response includes table arrays');
    replaceAllQuickWins(wsId, [
      { pagePath: '/test', action: 'Quick win action', estimatedImpact: 'low', rationale: 'Small gain' },
    ]);

    const res = await ctx.patchJson(`/api/webflow/keyword-strategy/${wsId}`, {
      siteKeywords: ['check response shape'],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.quickWins)).toBe(true);
    expect(body.quickWins.length).toBe(1);
    expect(body.quickWins[0].action).toBe('Quick win action');
    expect(Array.isArray(body.pageMap)).toBe(true);
    expect(Array.isArray(body.contentGaps)).toBe(true);
    expect(Array.isArray(body.keywordGaps)).toBe(true);
    expect(Array.isArray(body.topicClusters)).toBe(true);
    expect(Array.isArray(body.cannibalization)).toBe(true);
  });

  it('PATCH with only contentGaps updates the gaps table (synthesized shell response)', async () => {
    const wsId = freshWs('PATCH contentGaps only');
    const res = await ctx.patchJson(`/api/webflow/keyword-strategy/${wsId}`, {
      contentGaps: [
        { topic: 'technical seo', targetKeyword: 'technical seo guide', intent: 'informational', priority: 'medium', rationale: 'Good traffic', suggestedPageType: 'guide' },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.generatedAt).toBeNull();
    expect(body.contentGaps.length).toBe(1);
    expect(body.contentGaps[0].targetKeyword).toBe('technical seo guide');
  });

  it('PATCH with cannibalization action and canonicalUrl fields stores correctly', async () => {
    const wsId = freshWs('PATCH cannibalization action fields');
    const res = await ctx.patchJson(`/api/webflow/keyword-strategy/${wsId}`, {
      cannibalization: [
        {
          keyword: 'seo audit',
          pages: [
            { path: '/audit', position: 5, impressions: 1000, clicks: 40, source: 'gsc' },
            { path: '/seo-audit', source: 'keyword_map' },
          ],
          severity: 'low',
          recommendation: 'Keep /audit as canonical.',
          canonicalPath: '/audit',
          canonicalUrl: 'https://example.com/audit',
          action: 'redirect_301',
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const issue = body.cannibalization[0];
    expect(issue.keyword).toBe('seo audit');
    expect(issue.severity).toBe('low');
    expect(issue.action).toBe('redirect_301');
    expect(issue.canonicalUrl).toBe('https://example.com/audit');
  });

  it('PATCH with topicClusters including optional fields (avgPosition, topCompetitor) stores correctly', async () => {
    const wsId = freshWs('PATCH topicClusters optional fields');
    const res = await ctx.patchJson(`/api/webflow/keyword-strategy/${wsId}`, {
      topicClusters: [
        {
          topic: 'link building',
          keywords: ['link building', 'backlink strategy'],
          ownedCount: 1,
          totalCount: 4,
          coveragePercent: 25,
          avgPosition: 8.5,
          topCompetitor: 'competitor.io',
          topCompetitorCoverage: 80,
          gap: ['authority links', 'guest posting'],
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.topicClusters[0].avgPosition).toBe(8.5);
    expect(body.topicClusters[0].topCompetitor).toBe('competitor.io');
    expect(body.topicClusters[0].topCompetitorCoverage).toBe(80);
  });

  it('PATCH quickWins with roiScore stores and returns the numeric field', async () => {
    const wsId = freshWs('PATCH quickWins roiScore');
    const res = await ctx.patchJson(`/api/webflow/keyword-strategy/${wsId}`, {
      quickWins: [
        {
          pagePath: '/services',
          currentKeyword: 'services',
          action: 'Add structured data',
          estimatedImpact: 'medium',
          rationale: 'Rich snippets boost CTR',
          roiScore: 7.5,
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quickWins[0].roiScore).toBe(7.5);
    expect(body.quickWins[0].currentKeyword).toBe('services');
  });
});

// ── GET /api/webflow/keyword-feedback/:wsId ───────────────────────────────────

describe('GET /api/webflow/keyword-feedback — list feedback', () => {
  it('returns 404 for a non-existent workspace', async () => {
    const res = await ctx.api('/api/webflow/keyword-feedback/ws_totally_nonexistent_kf');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/workspace not found/i);
  });

  it('returns empty array when no feedback rows exist', async () => {
    const res = await ctx.api(`/api/webflow/keyword-feedback/${emptyWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it('returns feedback rows ordered by updated_at DESC after inserts', async () => {
    const wsId = freshWs('GET feedback ordered');
    db.prepare(`
      INSERT INTO keyword_feedback (workspace_id, keyword, status, reason, source, declined_by, updated_at)
      VALUES (?, ?, ?, NULL, 'content_gap', NULL, ?)
    `).run(wsId, 'older keyword', 'declined', '2026-03-01T00:00:00.000Z');
    db.prepare(`
      INSERT INTO keyword_feedback (workspace_id, keyword, status, reason, source, declined_by, updated_at)
      VALUES (?, ?, ?, NULL, 'page_map', NULL, ?)
    `).run(wsId, 'newer keyword', 'approved', '2026-04-01T00:00:00.000Z');

    const res = await ctx.api(`/api/webflow/keyword-feedback/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ keyword: string }>;
    expect(body.length).toBe(2);
    expect(body[0].keyword).toBe('newer keyword');
    expect(body[1].keyword).toBe('older keyword');
  });
});

// ── POST /api/webflow/keyword-feedback/:wsId ─────────────────────────────────

describe('POST /api/webflow/keyword-feedback — single keyword feedback', () => {
  it('returns 404 for a non-existent workspace', async () => {
    const res = await ctx.postJson('/api/webflow/keyword-feedback/ws_totally_nonexistent_post_kf', {
      keyword: 'test',
      status: 'approved',
      source: 'content_gap',
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/workspace not found/i);
  });

  it('returns 400 for missing required keyword field', async () => {
    const wsId = freshWs('POST feedback missing keyword');
    const res = await ctx.postJson(`/api/webflow/keyword-feedback/${wsId}`, {
      status: 'approved',
      source: 'content_gap',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid status value', async () => {
    const wsId = freshWs('POST feedback invalid status');
    const res = await ctx.postJson(`/api/webflow/keyword-feedback/${wsId}`, {
      keyword: 'test keyword',
      status: 'pending_review',  // not a valid enum
      source: 'content_gap',
    });
    expect(res.status).toBe(400);
  });

  it('stores "declined" status with reason and declinedBy', async () => {
    const wsId = freshWs('POST feedback declined with reason');
    const res = await ctx.postJson(`/api/webflow/keyword-feedback/${wsId}`, {
      keyword: 'irrelevant keyword',
      status: 'declined',
      reason: 'Not relevant to our niche',
      source: 'keyword_gap',
      declinedBy: 'admin@example.com',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keyword).toBe('irrelevant keyword');
    expect(body.status).toBe('declined');
    expect(body.reason).toBe('Not relevant to our niche');

    const row = db.prepare(
      'SELECT * FROM keyword_feedback WHERE workspace_id = ? AND keyword = ?'
    ).get(wsId, 'irrelevant keyword') as { status: string; declined_by: string | null } | undefined;
    expect(row?.status).toBe('declined');
    expect(row?.declined_by).toBe('admin@example.com');
  });

  it('stores "requested" status from opportunity source', async () => {
    const wsId = freshWs('POST feedback requested status');
    const res = await ctx.postJson(`/api/webflow/keyword-feedback/${wsId}`, {
      keyword: 'requested keyword',
      status: 'requested',
      source: 'opportunity',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keyword).toBe('requested keyword');
    expect(body.status).toBe('requested');
  });

  it('normalizes keyword to lowercase and trims whitespace before storing', async () => {
    const wsId = freshWs('POST feedback normalize keyword');
    const res = await ctx.postJson(`/api/webflow/keyword-feedback/${wsId}`, {
      keyword: '  SEO Services  ',
      status: 'approved',
      source: 'page_map',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keyword).toBe('seo services');

    const row = db.prepare(
      'SELECT keyword FROM keyword_feedback WHERE workspace_id = ?'
    ).get(wsId) as { keyword: string } | undefined;
    expect(row?.keyword).toBe('seo services');
  });

  it('upserts on conflict (updating status without creating a duplicate row)', async () => {
    const wsId = freshWs('POST feedback upsert on conflict');
    cleanFeedback(wsId);

    await ctx.postJson(`/api/webflow/keyword-feedback/${wsId}`, {
      keyword: 'upsert test',
      status: 'declined',
      source: 'content_gap',
    });
    const count1 = (db.prepare(
      'SELECT COUNT(*) as n FROM keyword_feedback WHERE workspace_id = ?'
    ).get(wsId) as { n: number }).n;
    expect(count1).toBe(1);

    // Submit again with different status — should upsert, not insert a duplicate
    const res2 = await ctx.postJson(`/api/webflow/keyword-feedback/${wsId}`, {
      keyword: 'upsert test',
      status: 'approved',
      source: 'content_gap',
    });
    expect(res2.status).toBe(200);
    const count2 = (db.prepare(
      'SELECT COUNT(*) as n FROM keyword_feedback WHERE workspace_id = ?'
    ).get(wsId) as { n: number }).n;
    expect(count2).toBe(1);  // still exactly 1 row, not 2

    const updated = db.prepare(
      'SELECT status FROM keyword_feedback WHERE workspace_id = ?'
    ).get(wsId) as { status: string } | undefined;
    expect(updated?.status).toBe('approved');
  });

  it('returns 400 for invalid source enum value', async () => {
    const wsId = freshWs('POST feedback invalid source');
    const res = await ctx.postJson(`/api/webflow/keyword-feedback/${wsId}`, {
      keyword: 'valid keyword',
      status: 'approved',
      source: 'unknown_source',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for unknown extra field in strict schema', async () => {
    const wsId = freshWs('POST feedback extra field strict');
    const res = await ctx.postJson(`/api/webflow/keyword-feedback/${wsId}`, {
      keyword: 'test',
      status: 'approved',
      source: 'content_gap',
      extraField: 'not allowed',
    });
    expect(res.status).toBe(400);
  });
});

// ── POST /api/webflow/keyword-feedback/:wsId/bulk ─────────────────────────────

describe('POST /api/webflow/keyword-feedback/:wsId/bulk — bulk feedback', () => {
  it('returns 404 for a non-existent workspace', async () => {
    const res = await ctx.postJson('/api/webflow/keyword-feedback/ws_totally_nonexistent_bulk/bulk', {
      keywords: [{ keyword: 'test', status: 'approved', source: 'content_gap' }],
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/workspace not found/i);
  });

  it('returns 400 for empty keywords array', async () => {
    const wsId = freshWs('BULK empty keywords array');
    const res = await ctx.postJson(`/api/webflow/keyword-feedback/${wsId}/bulk`, {
      keywords: [],
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid keyword entry shape in bulk request', async () => {
    const wsId = freshWs('BULK invalid keyword entry shape');
    const res = await ctx.postJson(`/api/webflow/keyword-feedback/${wsId}/bulk`, {
      keywords: [{ status: 'approved' }],  // missing required 'keyword' field
    });
    expect(res.status).toBe(400);
  });

  it('inserts all keywords and returns count', async () => {
    const wsId = freshWs('BULK insert all keywords');
    cleanFeedback(wsId);

    const res = await ctx.postJson(`/api/webflow/keyword-feedback/${wsId}/bulk`, {
      keywords: [
        { keyword: 'bulk keyword one', status: 'approved', source: 'content_gap' },
        { keyword: 'bulk keyword two', status: 'declined', source: 'page_map', reason: 'Low volume' },
        { keyword: 'bulk keyword three', status: 'requested', source: 'topic_cluster' },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(3);

    const count = (db.prepare(
      'SELECT COUNT(*) as n FROM keyword_feedback WHERE workspace_id = ?'
    ).get(wsId) as { n: number }).n;
    expect(count).toBe(3);
  });

  it('normalizes keywords to lowercase in bulk request', async () => {
    const wsId = freshWs('BULK normalize lowercase');
    cleanFeedback(wsId);

    await ctx.postJson(`/api/webflow/keyword-feedback/${wsId}/bulk`, {
      keywords: [
        { keyword: '  UPPER KEYWORD  ', status: 'approved', source: 'content_gap' },
      ],
    });

    const row = db.prepare(
      'SELECT keyword FROM keyword_feedback WHERE workspace_id = ?'
    ).get(wsId) as { keyword: string } | undefined;
    expect(row?.keyword).toBe('upper keyword');
  });

  it('stores declinedBy field for all bulk items when provided', async () => {
    const wsId = freshWs('BULK declinedBy field');
    cleanFeedback(wsId);

    await ctx.postJson(`/api/webflow/keyword-feedback/${wsId}/bulk`, {
      keywords: [
        { keyword: 'declined one', status: 'declined', source: 'content_gap' },
        { keyword: 'declined two', status: 'declined', source: 'keyword_gap' },
      ],
      declinedBy: 'manager@example.com',
    });

    const rows = db.prepare(
      'SELECT keyword, declined_by FROM keyword_feedback WHERE workspace_id = ? ORDER BY keyword'
    ).all(wsId) as Array<{ keyword: string; declined_by: string | null }>;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.declined_by).toBe('manager@example.com');
    }
  });

  it('returns 400 for keywords array exceeding max of 100 items', async () => {
    const wsId = freshWs('BULK exceed max items');
    const tooMany = Array.from({ length: 101 }, (_, i) => ({
      keyword: `keyword-${i}`,
      status: 'approved' as const,
      source: 'content_gap' as const,
    }));
    const res = await ctx.postJson(`/api/webflow/keyword-feedback/${wsId}/bulk`, {
      keywords: tooMany,
    });
    expect(res.status).toBe(400);
  });
});

// ── DELETE /api/webflow/keyword-feedback/:wsId/:keyword ──────────────────────

describe('DELETE /api/webflow/keyword-feedback/:wsId/:keyword', () => {
  it('deletes an existing feedback row and returns deleted keyword', async () => {
    const wsId = freshWs('DELETE existing feedback');
    cleanFeedback(wsId);
    db.prepare(`
      INSERT INTO keyword_feedback (workspace_id, keyword, status, reason, source, declined_by)
      VALUES (?, ?, ?, NULL, 'content_gap', NULL)
    `).run(wsId, 'to delete', 'declined');

    const res = await ctx.del(`/api/webflow/keyword-feedback/${wsId}/to%20delete`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe('to delete');

    const row = db.prepare(
      'SELECT * FROM keyword_feedback WHERE workspace_id = ? AND keyword = ?'
    ).get(wsId, 'to delete');
    expect(row).toBeUndefined();
  });

  it('returns 404 for a non-existent workspace on delete', async () => {
    const res = await ctx.del('/api/webflow/keyword-feedback/ws_totally_nonexistent_del/test');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/workspace not found/i);
  });

  it('still returns 200 and deleted key even when keyword does not exist (idempotent delete)', async () => {
    const wsId = freshWs('DELETE nonexistent keyword');
    cleanFeedback(wsId);

    // keyword never existed — server normalizes the URL param (hyphens → spaces)
    const res = await ctx.del(`/api/webflow/keyword-feedback/${wsId}/nonexistent-kw`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe('nonexistent kw');
  });

  it('URL-decodes keywords with special characters before deletion', async () => {
    const wsId = freshWs('DELETE url-encoded keyword');
    cleanFeedback(wsId);
    // Server normalizes via keywordComparisonKey: '&' → space, spaces collapsed → 'seo content'
    const normalizedKeyword = 'seo content';
    db.prepare(`
      INSERT INTO keyword_feedback (workspace_id, keyword, status, reason, source, declined_by)
      VALUES (?, ?, ?, NULL, 'page_map', NULL)
    `).run(wsId, normalizedKeyword, 'declined');

    const rawInput = 'seo & content';
    const encoded = encodeURIComponent(rawInput);  // 'seo%20%26%20content'
    const res = await ctx.del(`/api/webflow/keyword-feedback/${wsId}/${encoded}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(normalizedKeyword);

    const remaining = db.prepare(
      'SELECT * FROM keyword_feedback WHERE workspace_id = ? AND keyword = ?'
    ).get(wsId, normalizedKeyword);
    expect(remaining).toBeUndefined();
  });

  it('normalizes keyword to lowercase before deleting', async () => {
    const wsId = freshWs('DELETE lowercase normalize');
    cleanFeedback(wsId);
    db.prepare(`
      INSERT INTO keyword_feedback (workspace_id, keyword, status, reason, source, declined_by)
      VALUES (?, ?, ?, NULL, 'content_gap', NULL)
    `).run(wsId, 'mixed case keyword', 'approved');

    // send uppercase — should resolve to the stored lowercase row
    const res = await ctx.del(`/api/webflow/keyword-feedback/${wsId}/MIXED%20CASE%20KEYWORD`);
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe('mixed case keyword');

    const remaining = db.prepare(
      'SELECT * FROM keyword_feedback WHERE workspace_id = ? AND keyword = ?'
    ).get(wsId, 'mixed case keyword');
    expect(remaining).toBeUndefined();
  });
});

// ── GET /api/webflow/keyword-strategy/:wsId/signals ──────────────────────────

describe('GET /api/webflow/keyword-strategy/:wsId/signals', () => {
  it('returns 404 for a non-existent workspace', async () => {
    const res = await ctx.api('/api/webflow/keyword-strategy/ws_totally_nonexistent_signals/signals');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/workspace not found/i);
  });

  it('returns signals array (empty or populated) for a valid workspace', async () => {
    const res = await ctx.api(`/api/webflow/keyword-strategy/${mainWsId}/signals`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('signals');
    expect(Array.isArray(body.signals)).toBe(true);
  });

  it('returns { signals: [] } (not an error) for a workspace with no insights', async () => {
    const res = await ctx.api(`/api/webflow/keyword-strategy/${emptyWsId}/signals`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signals).toEqual([]);
  });
});

// ── Workspace isolation: cross-workspace access ───────────────────────────────

describe('workspace isolation — strategy and feedback endpoints', () => {
  it('strategy GET for workspace A does not return data from workspace B', async () => {
    const wsA = freshWs('Isolation wsA strategy');
    const wsB = freshWs('Isolation wsB strategy');

    upsertPageKeyword(wsA, {
      pagePath: '/ws-a-page',
      pageTitle: 'WS A Page',
      primaryKeyword: 'ws-a unique keyword',
      secondaryKeywords: [],
      analysisGeneratedAt: new Date().toISOString(),
    });
    upsertPageKeyword(wsB, {
      pagePath: '/ws-b-page',
      pageTitle: 'WS B Page',
      primaryKeyword: 'ws-b unique keyword',
      secondaryKeywords: [],
      analysisGeneratedAt: new Date().toISOString(),
    });

    const resA = await ctx.api(`/api/webflow/keyword-strategy/${wsA}`);
    const bodyA = await resA.json();
    const pathsA = bodyA.pageMap.map((p: { pagePath: string }) => p.pagePath);
    expect(pathsA).toContain('/ws-a-page');
    expect(pathsA).not.toContain('/ws-b-page');

    const resB = await ctx.api(`/api/webflow/keyword-strategy/${wsB}`);
    const bodyB = await resB.json();
    const pathsB = bodyB.pageMap.map((p: { pagePath: string }) => p.pagePath);
    expect(pathsB).toContain('/ws-b-page');
    expect(pathsB).not.toContain('/ws-a-page');
  });

  it('feedback GET for workspace A does not return feedback from workspace B', async () => {
    const wsA = freshWs('Isolation wsA feedback');
    const wsB = freshWs('Isolation wsB feedback');

    db.prepare(`
      INSERT INTO keyword_feedback (workspace_id, keyword, status, reason, source, declined_by)
      VALUES (?, ?, ?, NULL, 'content_gap', NULL)
    `).run(wsA, 'ws-a-keyword', 'approved');
    db.prepare(`
      INSERT INTO keyword_feedback (workspace_id, keyword, status, reason, source, declined_by)
      VALUES (?, ?, ?, NULL, 'content_gap', NULL)
    `).run(wsB, 'ws-b-keyword', 'declined');

    const resA = await ctx.api(`/api/webflow/keyword-feedback/${wsA}`);
    const bodyA = await resA.json() as Array<{ keyword: string }>;
    expect(bodyA.some(r => r.keyword === 'ws-a-keyword')).toBe(true);
    expect(bodyA.some(r => r.keyword === 'ws-b-keyword')).toBe(false);

    const resB = await ctx.api(`/api/webflow/keyword-feedback/${wsB}`);
    const bodyB = await resB.json() as Array<{ keyword: string }>;
    expect(bodyB.some(r => r.keyword === 'ws-b-keyword')).toBe(true);
    expect(bodyB.some(r => r.keyword === 'ws-a-keyword')).toBe(false);
  });

  it('diff GET for workspace A does not expose history rows from workspace B', async () => {
    const wsA = freshWs('Isolation wsA diff');
    const wsB = freshWs('Isolation wsB diff');

    // Give both workspaces a strategy
    updateWorkspace(wsA, { keywordStrategy: { siteKeywords: ['ws-a-kw'], opportunities: [], generatedAt: new Date().toISOString() } });
    updateWorkspace(wsB, { keywordStrategy: { siteKeywords: ['ws-b-kw'], opportunities: [], generatedAt: new Date().toISOString() } });

    // Seed history only for wsB
    db.prepare(`
      INSERT INTO strategy_history (workspace_id, strategy_json, page_map_json, generated_at)
      VALUES (?, ?, ?, ?)
    `).run(
      wsB,
      JSON.stringify({ siteKeywords: ['ws-b-old-kw'] }),
      JSON.stringify([]),
      '2026-01-01T00:00:00.000Z',
    );

    // wsA has no history, so diff should be null
    const resA = await ctx.api(`/api/webflow/keyword-strategy/${wsA}/diff`);
    const bodyA = await resA.json();
    expect(bodyA).toBeNull();

    // wsB has history, so diff should be non-null
    const resB = await ctx.api(`/api/webflow/keyword-strategy/${wsB}/diff`);
    const bodyB = await resB.json();
    expect(bodyB).not.toBeNull();
  });
});

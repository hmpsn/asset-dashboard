/**
 * Integration tests for the localSync field on the keyword-strategy GET response.
 *
 * Covers Task 1.1 — both branches of the GET handler:
 *   1. Real branch (workspace with a strategy blob) returns strategyUx.localSync
 *   2. Shell branch (page_keywords only, no blob) returns strategyUx.localSync
 *   3. First-generation local branch (no blob, no page keywords) returns
 *      strategyUx.localSync so the UI can prompt for local refresh first
 *
 * Also covers:
 *   - applies === true when posture is 'local' + a snapshot exists
 *   - applies === false for a default (non-local) workspace
 *
 */
import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { upsertPageKeyword } from '../../server/page-keywords.js';
import db from '../../server/db/index.js';
import type { KeywordStrategy } from '../../shared/types/workspace.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api } = ctx;

let localWsId = ''; // workspace with local posture + snapshot + strategy blob
let defaultWsId = ''; // workspace with no local posture (default/unknown)
let shellWsId = ''; // workspace with only page_keywords (no strategy blob)
let firstGenerationLocalWsId = ''; // workspace with local posture but no strategy/page keyword rows

const createdIds: string[] = [];

function freshWs(label: string): string {
  const ws = createWorkspace(label);
  createdIds.push(ws.id);
  return ws.id;
}

/**
 * Insert a local_seo_workspace_settings row to set posture directly via SQL,
 * avoiding the broadcast call in updateLocalSeoConfiguration.
 */
function seedPosture(workspaceId: string, posture: 'local' | 'non_local' | 'hybrid') {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO local_seo_workspace_settings
      (workspace_id, posture, posture_source, suggestion_reasons, updated_at)
    VALUES (?, ?, 'admin_override', '[]', ?)
  `).run(workspaceId, posture, now);
}

/**
 * Insert a local_seo_markets row directly (no FK to local_visibility_snapshots yet).
 */
function seedMarket(workspaceId: string): string {
  const marketId = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO local_seo_markets
      (id, workspace_id, label, city, country, source, status, created_at, updated_at)
    VALUES (?, ?, 'Austin, TX', 'Austin', 'US', 'admin_override', 'active', ?, ?)
  `).run(marketId, workspaceId, now, now);
  return marketId;
}

/**
 * Insert a local_visibility_snapshots row directly so we don't need a live
 * DataForSEO connection.
 */
function seedSnapshot(workspaceId: string, marketId: string, capturedAt: string) {
  db.prepare(`
    INSERT INTO local_visibility_snapshots
      (id, workspace_id, keyword, normalized_keyword, market_id, market_label,
       captured_at, local_pack_present, business_found, business_match_confidence,
       top_competitors, source_endpoint, provider, device, language_code, status)
    VALUES
      (?, ?, 'dentist', 'dentist', ?, 'Austin, TX',
       ?, 0, 0, 'unknown',
       '[]', 'test', 'dataforseo', 'desktop', 'en', 'success')
  `).run(randomUUID(), workspaceId, marketId, capturedAt);
}

const fullStrategy: KeywordStrategy = {
  siteKeywords: ['local dentist', 'Austin dentist'],
  opportunities: ['expand to suburbs'],
  generatedAt: '2025-01-01T00:00:00.000Z',
  seoDataMode: 'none',
};

beforeAll(async () => {
  // 1. Local workspace: set posture → insert market → insert snapshot → add strategy blob
  localWsId = freshWs('LocalSync Test — Local Posture');
  seedPosture(localWsId, 'local');
  const localMarketId = seedMarket(localWsId);
  // Snapshot captured AFTER the strategy generatedAt so strategyStaleVsLocal is true
  seedSnapshot(localWsId, localMarketId, new Date().toISOString());
  updateWorkspace(localWsId, { keywordStrategy: fullStrategy });

  // 2. Default workspace: no local configuration, has a strategy blob
  defaultWsId = freshWs('LocalSync Test — Default Posture');
  updateWorkspace(defaultWsId, { keywordStrategy: fullStrategy });

  // 3. Shell workspace: local posture + snapshot + page_keywords but NO strategy blob
  shellWsId = freshWs('LocalSync Test — Shell Branch');
  seedPosture(shellWsId, 'local');
  const shellMarketId = seedMarket(shellWsId);
  seedSnapshot(shellWsId, shellMarketId, new Date().toISOString());
  upsertPageKeyword(shellWsId, {
    pagePath: '/services',
    pageTitle: 'Services',
    primaryKeyword: 'Austin dentist',
    secondaryKeywords: [],
    analysisGeneratedAt: new Date().toISOString(),
  });
  // No strategy blob set — this exercises the shell-strategy branch

  // 4. First-generation local workspace: local posture, no snapshots yet, no page_keywords, no strategy blob.
  firstGenerationLocalWsId = freshWs('LocalSync Test — First Generation Local');
  seedPosture(firstGenerationLocalWsId, 'local');

  await ctx.startServer();
}, 25_000);

afterAll(async () => {
  await ctx.stopServer();
  for (const id of createdIds) {
    try { deleteWorkspace(id); } catch { /* ignore */ }
  }
});

describe('GET /api/webflow/keyword-strategy/:wsId — strategyUx.localSync', () => {
  it('real branch: local-posture workspace with snapshot returns applies === true', async () => {
    const res = await api(`/api/webflow/keyword-strategy/${localWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toBeNull();
    expect(body.strategyUx).toBeDefined();
    expect(body.strategyUx.localSync).toBeDefined();
    expect(body.strategyUx.localSync.applies).toBe(true);
    expect(typeof body.strategyUx.localSync.localNeedsRefresh).toBe('boolean');
    expect(typeof body.strategyUx.localSync.strategyStaleVsLocal).toBe('boolean');
    // Strategy was generated before current snapshot, so strategyStaleVsLocal is true
    expect(body.strategyUx.localSync.strategyStaleVsLocal).toBe(true);
    expect(body.strategyUx.localSync.lastLocalRefreshAt).not.toBeNull();
    expect(body.strategyUx.localSync.lastStrategyGeneratedAt).toBe('2025-01-01T00:00:00.000Z');
  });

  it('real branch: default (non-local) workspace returns applies === false', async () => {
    const res = await api(`/api/webflow/keyword-strategy/${defaultWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toBeNull();
    expect(body.strategyUx).toBeDefined();
    expect(body.strategyUx.localSync).toBeDefined();
    expect(body.strategyUx.localSync.applies).toBe(false);
    expect(body.strategyUx.localSync.localNeedsRefresh).toBe(false);
    expect(body.strategyUx.localSync.localNeedsRefreshReason).toBeNull();
    expect(body.strategyUx.localSync.strategyStaleVsLocal).toBe(false);
  });

  it('shell branch: page_keywords-only workspace (no blob) includes strategyUx.localSync', async () => {
    const res = await api(`/api/webflow/keyword-strategy/${shellWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toBeNull();
    expect(body.generatedAt).toBeNull();
    expect(body.strategyUx).toBeDefined();
    expect(body.strategyUx.localSync).toBeDefined();
    // Shell workspace has local posture + snapshot, so applies should be true
    expect(body.strategyUx.localSync.applies).toBe(true);
    expect(body.strategyUx.localSync.lastLocalRefreshAt).not.toBeNull();
    // No strategy blob → lastStrategyGeneratedAt is null
    expect(body.strategyUx.localSync.lastStrategyGeneratedAt).toBeNull();
  });

  it('first-generation local workspace returns strategyUx.localSync instead of null', async () => {
    const res = await api(`/api/webflow/keyword-strategy/${firstGenerationLocalWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toBeNull();
    expect(body.generatedAt).toBeNull();
    expect(body.pageMap).toEqual([]);
    expect(body.strategyUx).toBeDefined();
    expect(body.strategyUx.localSync).toBeDefined();
    expect(body.strategyUx.localSync.applies).toBe(true);
    expect(body.strategyUx.localSync.localNeedsRefresh).toBe(true);
    expect(body.strategyUx.localSync.localNeedsRefreshReason).toBe('missing');
    expect(body.strategyUx.localSync.lastLocalRefreshAt).toBeNull();
  });
});

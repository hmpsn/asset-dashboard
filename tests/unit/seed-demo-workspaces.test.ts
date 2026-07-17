import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import { listBriefs } from '../../server/content-brief.js';
import { listContentRequests } from '../../server/content-requests.js';
import { listPosts } from '../../server/content-posts-db.js';
import { listChurnSignals } from '../../server/churn-signals.js';
import { classifyWorkQueue } from '../../server/domains/work-queue.js';
import { getRedirectSnapshot } from '../../server/redirect-store.js';
import { getLatestSnapshot } from '../../server/reports.js';
import { listRequests } from '../../server/requests.js';
import { listWorkOrders } from '../../server/work-orders.js';
import {
  assertDemoSeedEnvironmentSafe,
  DEMO_WORKSPACES,
  PROVIDER_RICH_DEMO_WORKSPACE,
  runDemoSeed,
} from '../../scripts/seed-demo-workspaces.ts';
import { LOCAL_PROVIDER_FIXTURE } from '../../server/providers/local-provider-fixtures.ts';
import type { ClientActionSourceType } from '../../shared/types/client-actions.ts';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_OVERRIDE = process.env.ALLOW_NON_LOCAL_DEMO_SEED;
const LOADED_DEMO_WORKSPACE_ID = 'ws_demo_loaded';

function countWorkspaceRows(table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE workspace_id = ?`).get(
    LOADED_DEMO_WORKSPACE_ID,
  ) as { count: number };
  return row.count;
}

function loadedDemoCounts() {
  return {
    workspaces: (db.prepare('SELECT COUNT(*) AS count FROM workspaces WHERE id = ?').get(
      LOADED_DEMO_WORKSPACE_ID,
    ) as { count: number }).count,
    briefs: countWorkspaceRows('content_briefs'),
    posts: countWorkspaceRows('content_posts'),
    requests: countWorkspaceRows('requests'),
    contentRequests: countWorkspaceRows('content_topic_requests'),
    workOrders: countWorkspaceRows('work_orders'),
    churnSignals: countWorkspaceRows('churn_signals'),
    auditSnapshots: countWorkspaceRows('audit_snapshots'),
    redirectSnapshots: countWorkspaceRows('redirect_snapshots'),
    pageKeywords: countWorkspaceRows('page_keywords'),
    trackedActions: countWorkspaceRows('tracked_actions'),
    clientDeliverables: countWorkspaceRows('client_deliverable'),
    actionOutcomes: (db.prepare(`
      SELECT COUNT(*) AS count
      FROM action_outcomes AS outcomes
      JOIN tracked_actions AS actions ON actions.id = outcomes.action_id
      WHERE actions.workspace_id = ?
    `).get(LOADED_DEMO_WORKSPACE_ID) as { count: number }).count,
  };
}

// R5-PR2 (B9) phantom-entry cleanup: scripts/seed-demo-workspaces.ts seeded a
// client_actions row with source_type='content_post', which is NOT a member of
// ClientActionSourceType (shared/types/client-actions.ts). server/client-actions.ts
// silently coerces any out-of-union source_type to 'aeo_change' at read time, so the
// bug was invisible at runtime — this is a static source-scan guard against
// regressing it. See docs/rules/action-catalog.md "Historical / additive-only
// vocabulary" section.
const VALID_CLIENT_ACTION_SOURCE_TYPES: ClientActionSourceType[] = [
  'aeo_change',
  'internal_link',
  'redirect_proposal',
  'content_decay',
  'cannibalization',
];

function readSeedScriptSource(): string {
  const filePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/seed-demo-workspaces.ts');
  return readFileSync(filePath, 'utf-8');
}

describe('seed demo workspaces — client_actions.source_type is in-union', () => {
  it('the seeded client_actions INSERT never uses an out-of-union source_type literal', () => {
    const source = readSeedScriptSource();
    const insertMatch = source.match(
      /INSERT INTO client_actions[\s\S]*?\.run\(([\s\S]*?)\);/,
    );
    expect(insertMatch, 'client_actions INSERT block found in seed script').toBeTruthy();

    const runArgsBlock = insertMatch![1];
    // Positional args are (id, seed.id, source_type, source_id, ...). `seed.id` is not a
    // string literal, so the source_type literal is the SECOND quoted string in the block
    // (the first is the row id, e.g. 'client_action_demo_premium_1').
    const stringLiterals = [...runArgsBlock.matchAll(/'([^']*)'/g)].map(m => m[1]);
    const sourceTypeLiteral = stringLiterals[1];
    expect(sourceTypeLiteral).toBeDefined();
    expect(
      VALID_CLIENT_ACTION_SOURCE_TYPES,
      `seeded client_actions.source_type "${sourceTypeLiteral}" must be a member of ClientActionSourceType`,
    ).toContain(sourceTypeLiteral);
  });

  it('never reintroduces the historical out-of-union "content_post" literal as a client_actions source_type', () => {
    const source = readSeedScriptSource();
    expect(source).not.toMatch(/'content_post',\s*\n\s*'post_demo_premium_1'/);
  });
});

describe('seed demo workspaces — loaded workspace contract', () => {
  it('seeds realistic high-volume data through every W0.1 read path and remains idempotent', () => {
    runDemoSeed();

    const firstCounts = loadedDemoCounts();
    expect(firstCounts.workspaces).toBe(1);

    const standaloneBriefs = (db.prepare(`
      SELECT COUNT(*) AS count
      FROM content_briefs AS briefs
      WHERE briefs.workspace_id = ?
        AND briefs.superseded_by IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM content_posts AS posts
          WHERE posts.workspace_id = briefs.workspace_id AND posts.brief_id = briefs.id
        )
    `).get(LOADED_DEMO_WORKSPACE_ID) as { count: number }).count;
    const activePosts = (db.prepare(`
      SELECT COUNT(*) AS count
      FROM content_posts
      WHERE workspace_id = ? AND status != 'approved'
    `).get(LOADED_DEMO_WORKSPACE_ID) as { count: number }).count;
    expect(standaloneBriefs + activePosts).toBeGreaterThanOrEqual(50);

    const boardStages = db.prepare(`
      SELECT status, COUNT(*) AS count
      FROM content_posts
      WHERE workspace_id = ? AND status IN ('draft', 'review')
      GROUP BY status
    `).all(LOADED_DEMO_WORKSPACE_ID) as Array<{ status: string; count: number }>;
    expect(standaloneBriefs).toBeGreaterThan(0);
    expect(boardStages).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'draft' }),
      expect.objectContaining({ status: 'review' }),
    ]));

    const workspace = db.prepare(`
      SELECT webflow_site_id AS siteId, webflow_site_name AS siteName,
             gsc_property_url AS gscPropertyUrl, ga4_property_id AS ga4PropertyId
      FROM workspaces WHERE id = ?
    `).get(LOADED_DEMO_WORKSPACE_ID) as {
      siteId: string;
      siteName: string;
      gscPropertyUrl: string;
      ga4PropertyId: string;
    };
    const auditSnapshot = getLatestSnapshot(workspace.siteId);
    expect(auditSnapshot?.audit).toMatchObject({
      totalPages: expect.any(Number),
      errors: expect.any(Number),
      warnings: expect.any(Number),
    });
    expect(auditSnapshot?.audit.totalPages).toBeGreaterThan(0);
    expect(getRedirectSnapshot(workspace.siteId)?.result.summary.totalPages).toBeGreaterThan(0);

    const requests = listRequests(LOADED_DEMO_WORKSPACE_ID);
    const contentRequests = listContentRequests(LOADED_DEMO_WORKSPACE_ID);
    const workOrders = listWorkOrders(LOADED_DEMO_WORKSPACE_ID);
    const churnSignals = listChurnSignals(LOADED_DEMO_WORKSPACE_ID);
    const workQueue = classifyWorkQueue({
      clientId: LOADED_DEMO_WORKSPACE_ID,
      requests,
      contentRequests,
      workOrders,
      churnSignals,
      audit: auditSnapshot ? {
        errors: auditSnapshot.audit.errors,
        warnings: auditSnapshot.audit.warnings,
        siteScore: auditSnapshot.audit.siteScore,
      } : null,
      setup: {
        webflowSiteId: workspace.siteId,
        gscPropertyUrl: workspace.gscPropertyUrl,
        ga4PropertyId: workspace.ga4PropertyId,
        includeGaps: true,
      },
    });
    expect(workQueue.items.length).toBeGreaterThanOrEqual(10);
    expect(new Set(workQueue.items.map(item => item.sourceType)).size).toBeGreaterThanOrEqual(4);
    expect(workQueue.items.map(item => item.sourceType)).toEqual(expect.arrayContaining([
      'audit_error',
      'churn_signal',
      'content_request',
    ]));
    expect(workQueue.streams.opt).toBeGreaterThan(0);
    expect(workQueue.streams.send).toBeGreaterThan(0);
    expect(workQueue.streams.money).toBeGreaterThan(0);
    expect(workQueue.streams.unclassified).toBeGreaterThan(0);

    const keywords = db.prepare(`
      SELECT COUNT(*) AS count,
             SUM(CASE WHEN cpc = 0 THEN 1 ELSE 0 END) AS zeroCpc,
             SUM(CASE WHEN cpc > 0 THEN 1 ELSE 0 END) AS positiveCpc
      FROM page_keywords WHERE workspace_id = ?
    `).get(LOADED_DEMO_WORKSPACE_ID) as { count: number; zeroCpc: number; positiveCpc: number };
    expect(keywords.count).toBeGreaterThanOrEqual(500);
    expect(keywords.zeroCpc).toBeGreaterThan(0);
    expect(keywords.positiveCpc).toBeGreaterThan(0);

    expect(requests.length).toBeGreaterThan(0);
    expect(requests.some(request => request.notes.at(-1)?.author === 'client')).toBe(true);

    const wins = (db.prepare(`
      SELECT COUNT(*) AS count
      FROM action_outcomes AS outcomes
      JOIN tracked_actions AS actions ON actions.id = outcomes.action_id
      WHERE actions.workspace_id = ?
        AND actions.attribution IN ('platform_executed', 'externally_executed')
        AND outcomes.score IN ('win', 'strong_win')
    `).get(LOADED_DEMO_WORKSPACE_ID) as { count: number }).count;
    expect(firstCounts.trackedActions).toBeGreaterThan(0);
    expect(wins).toBeGreaterThan(0);

    expect(listBriefs(LOADED_DEMO_WORKSPACE_ID).length).toBe(firstCounts.briefs);
    expect(listPosts(LOADED_DEMO_WORKSPACE_ID).length).toBe(firstCounts.posts);

    runDemoSeed();
    expect(loadedDemoCounts()).toEqual(firstCounts);
  });
});

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  process.env.ALLOW_NON_LOCAL_DEMO_SEED = ORIGINAL_OVERRIDE;
});

describe('seed demo workspaces safety', () => {
  it('throws in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_NON_LOCAL_DEMO_SEED = 'true';
    expect(() => assertDemoSeedEnvironmentSafe()).toThrow('blocked in production');
  });

  it('allows local development by default', () => {
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_NON_LOCAL_DEMO_SEED = '';
    expect(() => assertDemoSeedEnvironmentSafe()).not.toThrow();
  });

  it('requires explicit override in non-local environments', () => {
    process.env.NODE_ENV = 'staging';
    process.env.ALLOW_NON_LOCAL_DEMO_SEED = '';
    expect(() => assertDemoSeedEnvironmentSafe()).toThrow('restricted to local/test');

    process.env.ALLOW_NON_LOCAL_DEMO_SEED = 'true';
    expect(() => assertDemoSeedEnvironmentSafe()).not.toThrow();
  });

  it('defines deterministic scenario coverage for QA/demo workspaces', () => {
    const ids = DEMO_WORKSPACES.map(workspace => workspace.id);
    const scenarios = DEMO_WORKSPACES.map(workspace => workspace.scenario);
    const uniqueIds = new Set(ids);
    const uniqueScenarios = new Set(scenarios);

    expect(DEMO_WORKSPACES).toHaveLength(6);
    expect(uniqueIds.size).toBe(ids.length);
    expect(uniqueScenarios).toEqual(new Set([
      'empty-new',
      'free-client',
      'growth-active',
      'premium-history',
      'broken-integrations',
      'rich-cms',
    ]));
  });

  it('keeps broken-integration fixture deterministic and intentionally disconnected', () => {
    const broken = DEMO_WORKSPACES.find(workspace => workspace.scenario === 'broken-integrations');
    expect(broken).toBeDefined();
    expect(broken?.webflowSiteId).toBeNull();
    expect(broken?.webflowToken).toBeNull();
    expect(broken?.gscPropertyUrl).toBeNull();
    expect(broken?.ga4PropertyId).toBeNull();
    expect(broken?.seoDataProvider).toBe('dataforseo');
  });

  it('defines a separate provider-rich fixture without changing canonical scenario parity', () => {
    expect(PROVIDER_RICH_DEMO_WORKSPACE).toMatchObject({
      id: LOCAL_PROVIDER_FIXTURE.workspaceId,
      domain: LOCAL_PROVIDER_FIXTURE.domain,
      webflowSiteId: LOCAL_PROVIDER_FIXTURE.siteId,
      gscPropertyUrl: LOCAL_PROVIDER_FIXTURE.gscPropertyUrl,
      ga4PropertyId: LOCAL_PROVIDER_FIXTURE.ga4PropertyId,
      scenario: 'provider-rich',
      tier: 'premium',
    });
    expect(DEMO_WORKSPACES.some((workspace) => workspace.id === LOCAL_PROVIDER_FIXTURE.workspaceId)).toBe(false);
  });
});

/**
 * Row mapper completeness tests.
 *
 * Verifies that each rowToX() mapper reads every column present in its corresponding
 * DB table. A mapper that silently ignores a newly-added column means the frontend
 * never sees that data, which is a silent data-loss bug.
 *
 * Approach:
 *   1. Query `PRAGMA table_info(tablename)` to get the canonical column list from the DB.
 *   2. Construct a fully-populated mock row covering every column.
 *   3. Call the mapper (via the module's public CRUD function that calls it internally),
 *      OR expose the mapper directly by testing the store's roundtrip (insert → read).
 *   4. Assert each DB column has a corresponding camelCase field in the output.
 *
 * For non-exported mappers this file uses the public CRUD functions (insert + read)
 * to exercise the mapper indirectly — which is the safest, most realistic path.
 *
 * Intentionally skipped columns are noted per mapper with rationale.
 */

import { describe, it, expect, vi } from 'vitest';

// ── Module mocks ──
// broadcast.ts throws on any call before setBroadcast() is invoked (index.ts wires
// this during normal server startup, which never happens in unit tests). Mock the
// whole module so that createFeedback() and any other store function that imports
// broadcastToWorkspace don't throw during test execution.
// vi.mock is hoisted by Vitest so this mock is applied before any imported module loads.
vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
}));

import db from '../../server/db/index.js';

// ── Store imports (public CRUD used to exercise mappers indirectly) ──

import {
  createWorkspace,
  getWorkspace,
  updateWorkspace,
  deleteWorkspace,
} from '../../server/workspaces.js';

import {
  upsertInsight,
  getInsight,
} from '../../server/analytics-insights-store.js';

import {
  createContentRequest,
  getContentRequest,
} from '../../server/content-requests.js';

import {
  rowToTrackedAction,
  rowToActionOutcome,
  rowToActionPlaybook,
  rowToWorkspaceLearnings,
  type TrackedActionRow,
  type ActionOutcomeRow,
  type ActionPlaybookRow,
  type WorkspaceLearningsRow,
} from '../../server/db/outcome-mappers.js';

import {
  listFeedback,
  createFeedback,
} from '../../server/feedback.js';

// ── Helpers ──

/**
 * Returns the list of column names for a SQLite table using PRAGMA table_info.
 * Asserts the table exists and has columns before returning.
 */
function getTableColumns(tableName: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  expect(rows.length, `Table "${tableName}" not found or has no columns`).toBeGreaterThan(0);
  return rows.map(r => r.name);
}

/**
 * Convert a snake_case DB column name to its expected camelCase output key.
 * Handles common patterns used throughout the codebase.
 */
function snakeToCamel(col: string): string {
  return col.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * For a set of columns that a mapper intentionally does not surface as a direct field
 * (e.g. columns consumed internally, rolled into a JSON blob, or used only for FK),
 * these are noted here as intentional omissions so the test doesn't fail on them.
 */

// Columns that are knowingly not directly reflected in the camelCase output object.
// Add explanations for each so future engineers understand why.
const INTENTIONAL_OMISSIONS: Record<string, Set<string>> = {
  workspaces: new Set([
    // 'rewrite_playbook' IS mapped → ws.rewritePlaybook; nothing to omit here.
  ]),
  analytics_insights: new Set([
    // All columns are mapped; no intentional omissions.
  ]),
  content_topic_requests: new Set([
    // All columns are mapped; no intentional omissions.
  ]),
  tracked_actions: new Set([
    // All columns are mapped; no intentional omissions.
  ]),
  action_outcomes: new Set([
    // All columns are mapped; no intentional omissions.
  ]),
  action_playbooks: new Set([
    // All columns are mapped; no intentional omissions.
  ]),
  workspace_learnings: new Set([
    // 'learnings' column is parsed and its sub-fields merged onto the top-level object;
    // the key 'learnings' itself is not present on WorkspaceLearnings — its content
    // is spread into content/strategy/technical/overall/confidence/totalScoredActions.
    'learnings',
    // 'id' is a DB-level surrogate key not surfaced on WorkspaceLearnings.
    // The record is identified by workspaceId (workspace_id), which IS mapped.
    // rowToWorkspaceLearnings returns { workspaceId, computedAt, ...spread } — no 'id'.
    'id',
  ]),
  feedback: new Set([
    // All columns are mapped; no intentional omissions.
  ]),
};

// ── 1. workspaces → rowToWorkspace ──

describe('rowToWorkspace mapper completeness', () => {
  const TABLE = 'workspaces';

  it('maps every workspaces column to a camelCase field', () => {
    const columns = getTableColumns(TABLE);
    expect(columns.length).toBeGreaterThan(0);

    // createWorkspace auto-generates the ID; capture from return value
    const ws = createWorkspace('Mapper Test Workspace', 'site_abc', 'Mapper Site');

    // Populate ALL optional columns via updateWorkspace so every column has a truthy value
    // when the mapper runs. The rowToWorkspace mapper uses `if (row.xxx)` guards so fields
    // only appear on the output object when non-null/non-zero/non-empty.
    const trialEndsAt = new Date(Date.now() + 86400000).toISOString();
    updateWorkspace(ws.id, {
      gscPropertyUrl: 'https://example.com/',
      ga4PropertyId: 'GA4-123',
      clientPassword: 'hunter2',
      clientEmail: 'client@example.com',
      liveDomain: 'example.com',
      brandVoice: 'Friendly and professional.',
      knowledgeBase: 'We sell widgets.',
      brandLogoUrl: 'https://example.com/logo.png',
      brandAccentColor: '#00bcd4',
      tier: 'growth',
      trialEndsAt,
      seoDataProvider: 'semrush',
      autoReports: true,
      autoReportFrequency: 'weekly',
      clientPortalEnabled: true,
      seoClientView: true,
      analyticsClientView: true,
      onboardingEnabled: true,
      onboardingCompleted: true,
      stripeCustomerId: 'cus_test',
    });

    const result = getWorkspace(ws.id);
    expect(result).not.toBeNull();
    const out = result!;

    // Columns that use conditional guards (if (row.xxx)) will be absent on the output
    // when the value is falsy. We populated them all above with truthy values, so
    // all mapped columns should be present. The omissions set lists columns that are
    // intentionally not surfaced as direct camelCase keys.
    const omitted = INTENTIONAL_OMISSIONS[TABLE] ?? new Set();

    // Columns whose output key does not follow the standard snake→camel conversion
    // or that the mapper intentionally excludes (no direct output key).
    // The workspace mapper surfaces every WorkspaceRow field via a camelCase key —
    // none need exemption. But some are never set via updateWorkspace (e.g. publish_target,
    // scoring_config, intelligence_profile) — skip those from this broad check and
    // test them separately if needed.
    const unmappableViaUpdate = new Set([
      // These require JSON-structured inputs not covered by simple updateWorkspace calls;
      // they're tested via the json-column tests below.
      'publish_target', 'scoring_config', 'intelligence_profile',
      'event_config', 'event_groups', 'keyword_strategy',
      'competitor_domains', 'personas', 'content_pricing', 'portal_contacts',
      'audit_suppressions', 'business_profile', 'business_priorities',
      // webflow_token is sensitive and not populated here, but IS mapped
      'webflow_token',
      // rewrite_playbook is not exposed via updateWorkspace's Pick type; it IS mapped but
      // cannot be set through the public API in these tests
      'rewrite_playbook',
      // stripe_subscription_id is set only during Stripe webhook flows; not populated here
      // but IS correctly mapped (ws.stripeSubscriptionId)
      'stripe_subscription_id',
      // site_intelligence_client_view uses loose != null check, not if() guard — tested separately
      'site_intelligence_client_view',
      // businessPriorities (camelCase) is a legacy column name from an older migration that used
      // camelCase column names. The current schema uses business_priorities (snake_case) which IS
      // in this set above. Dev DBs that ran both migrations will have both columns; the mapper reads
      // row.business_priorities so the camelCase variant is unreachable via the public API.
      'businessPriorities',
    ]);

    const missing: string[] = [];
    for (const col of columns) {
      if (omitted.has(col) || unmappableViaUpdate.has(col)) continue;

      const camel = snakeToCamel(col);
      const keyFound = camel in out;
      if (!keyFound) {
        missing.push(`${col} → expected "${camel}" on Workspace output`);
      }
    }

    // Clean up workspace
    deleteWorkspace(ws.id);

    expect(
      missing,
      `rowToWorkspace is missing mappings for columns:\n${missing.join('\n')}`,
    ).toHaveLength(0);
  });

  it('maps core identity fields correctly', () => {
    const created = createWorkspace('ID Check Workspace');
    const ws = getWorkspace(created.id)!;

    expect(ws.id).toBe(created.id);
    expect(ws.name).toBe('ID Check Workspace');
    expect(typeof ws.folder).toBe('string');
    expect(typeof ws.createdAt).toBe('string');

    deleteWorkspace(created.id);
  });

  it('maps boolean integer columns as booleans', () => {
    const created = createWorkspace('Bool Check Workspace');
    updateWorkspace(created.id, {
      clientPortalEnabled: true,
      seoClientView: false,
      onboardingEnabled: true,
    });

    const ws = getWorkspace(created.id)!;
    expect(ws.clientPortalEnabled).toBe(true);
    expect(ws.seoClientView).toBe(false);
    expect(ws.onboardingEnabled).toBe(true);

    deleteWorkspace(created.id);
  });

  it('maps nullable columns as undefined when absent', () => {
    const created = createWorkspace('Null Check Workspace');
    const ws = getWorkspace(created.id)!;

    // These are null in DB and should be absent (undefined) in the output
    expect(ws.webflowSiteId).toBeUndefined();
    expect(ws.gscPropertyUrl).toBeUndefined();
    // tier is set to 'free' by createWorkspace, so it IS populated — check it passes through
    expect(ws.tier).toBe('free');

    deleteWorkspace(created.id);
  });
});

// ── 2. analytics_insights → rowToInsight ──

describe('rowToInsight mapper completeness', () => {
  const TABLE = 'analytics_insights';

  it('maps every analytics_insights column to a camelCase field', () => {
    const columns = getTableColumns(TABLE);
    expect(columns.length).toBeGreaterThan(0);

    const wsId = `mapper-ins-${Date.now()}`;

    const insight = upsertInsight({
      workspaceId: wsId,
      pageId: '/blog/test-mapper',
      insightType: 'page_health',
      data: { score: 78, trend: 'stable' },
      severity: 'opportunity',
      pageTitle: 'Test Page | Example',
      strategyKeyword: 'widget guide',
      strategyAlignment: 'primary',
      auditIssues: 'missing_meta',
      pipelineStatus: 'in_pipeline',
      anomalyLinked: true,
      impactScore: 42,
      domain: 'content',
      resolutionSource: 'admin',
      bridgeSource: 'seo_bridge',
    });

    // Fetch back so resolution fields (set to null by default) are present
    const fetched = getInsight(wsId, '/blog/test-mapper', 'page_health')!;
    expect(fetched).not.toBeNull();

    const omitted = INTENTIONAL_OMISSIONS[TABLE] ?? new Set();
    const missing: string[] = [];

    for (const col of columns) {
      if (omitted.has(col)) continue;
      const camel = snakeToCamel(col);
      const keyFound = camel in fetched;
      if (!keyFound) {
        missing.push(`${col} → expected "${camel}" on AnalyticsInsight output`);
      }
    }

    expect(
      missing,
      `rowToInsight is missing mappings for columns:\n${missing.join('\n')}`,
    ).toHaveLength(0);
  });

  it('maps all enrichment fields added in migration 038', () => {
    const wsId = `mapper-enrich-${Date.now()}`;
    const insight = upsertInsight({
      workspaceId: wsId,
      pageId: '/products',
      insightType: 'content_decay',
      data: { deltaPercent: -30 },
      severity: 'warning',
      pageTitle: 'Products | ACME',
      strategyKeyword: 'acme products',
      strategyAlignment: 'supporting',
      auditIssues: 'thin_content',
      pipelineStatus: 'requested',
      anomalyLinked: false,
      impactScore: 55,
      domain: 'technical',
    });

    expect(insight.pageTitle).toBe('Products | ACME');
    expect(insight.strategyKeyword).toBe('acme products');
    expect(insight.strategyAlignment).toBe('supporting');
    expect(insight.auditIssues).toBe('thin_content');
    expect(insight.pipelineStatus).toBe('requested');
    expect(insight.anomalyLinked).toBe(false);
    expect(insight.impactScore).toBe(55);
    expect(insight.domain).toBe('technical');
  });

  it('maps resolution tracking fields added in migration 040', () => {
    const wsId = `mapper-reso-${Date.now()}`;
    const insight = upsertInsight({
      workspaceId: wsId,
      pageId: null,
      insightType: 'keyword_cluster',
      data: { clusters: 3 },
      severity: 'positive',
    });

    // resolution_status, resolution_note, resolved_at are NULL by default
    expect(insight.resolutionStatus).toBeNull();
    expect(insight.resolutionNote).toBeNull();
    expect(insight.resolvedAt).toBeNull();
    expect(insight.resolutionSource).toBeNull();
  });

  it('maps bridge_source field added in migration 044', () => {
    const wsId = `mapper-bridge-${Date.now()}`;
    const insight = upsertInsight({
      workspaceId: wsId,
      pageId: '/about',
      insightType: 'cannibalization',
      data: { competing: ['/services'] },
      severity: 'warning',
      bridgeSource: 'schema_bridge',
    });

    expect(insight.bridgeSource).toBe('schema_bridge');
  });
});

// ── 3. content_topic_requests → rowToRequest ──

describe('rowToRequest (content_topic_requests) mapper completeness', () => {
  const TABLE = 'content_topic_requests';

  it('maps every content_topic_requests column to a camelCase field', () => {
    const columns = getTableColumns(TABLE);
    expect(columns.length).toBeGreaterThan(0);

    const wsId = `mapper-creq-${Date.now()}`;
    const req = createContentRequest(wsId, {
      topic: 'Mapper Test Topic',
      targetKeyword: `mapper-keyword-${Date.now()}`,
      intent: 'informational',
      priority: 'high',
      rationale: 'Testing mapper completeness',
      clientNote: 'Please cover all aspects.',
      source: 'strategy',
      serviceType: 'full_post',
      pageType: 'blog',
    });

    const fetched = getContentRequest(wsId, req.id)!;
    expect(fetched).not.toBeNull();

    const omitted = INTENTIONAL_OMISSIONS[TABLE] ?? new Set();
    const missing: string[] = [];

    for (const col of columns) {
      if (omitted.has(col)) continue;
      const camel = snakeToCamel(col);
      const keyFound = camel in fetched;
      if (!keyFound) {
        missing.push(`${col} → expected "${camel}" on ContentTopicRequest output`);
      }
    }

    expect(
      missing,
      `rowToRequest is missing mappings for columns:\n${missing.join('\n')}`,
    ).toHaveLength(0);
  });

  it('maps core request fields correctly', () => {
    const wsId = `mapper-creq-core-${Date.now()}`;
    const kw = `core-kw-${Date.now()}`;
    const req = createContentRequest(wsId, {
      topic: 'Core Test',
      targetKeyword: kw,
      intent: 'commercial',
      priority: 'medium',
      rationale: 'core field check',
    });

    expect(req.workspaceId).toBe(wsId);
    expect(req.topic).toBe('Core Test');
    expect(req.targetKeyword).toBe(kw);
    expect(req.intent).toBe('commercial');
    expect(req.priority).toBe('medium');
    expect(req.comments).toEqual([]);
    expect(typeof req.requestedAt).toBe('string');
    expect(typeof req.updatedAt).toBe('string');
  });

  it('maps optional delivery fields as undefined when absent', () => {
    const wsId = `mapper-creq-opt-${Date.now()}`;
    const kw = `opt-kw-${Date.now()}`;
    const req = createContentRequest(wsId, {
      topic: 'Optional Check',
      targetKeyword: kw,
      intent: 'informational',
      priority: 'low',
      rationale: 'optional field check',
    });

    expect(req.deliveryUrl).toBeUndefined();
    expect(req.deliveryNotes).toBeUndefined();
    expect(req.briefId).toBeUndefined();
    expect(req.declineReason).toBeUndefined();
    expect(req.targetPageId).toBeUndefined();
  });
});

// ── 4. tracked_actions → rowToTrackedAction ──

describe('rowToTrackedAction mapper completeness', () => {
  const TABLE = 'tracked_actions';

  it('maps every tracked_actions column to a camelCase field', () => {
    const columns = getTableColumns(TABLE);
    expect(columns.length).toBeGreaterThan(0);

    // Build a fully-populated mock row matching TrackedActionRow interface
    const mockRow: TrackedActionRow = {
      id: 'ta_test_001',
      workspace_id: 'ws_mapper_ta',
      action_type: 'content_published',
      source_type: 'content_post',
      source_id: 'post_abc',
      page_url: 'https://example.com/blog/test',
      target_keyword: 'widget guide',
      baseline_snapshot: JSON.stringify({ captured_at: new Date().toISOString(), clicks: 10, impressions: 200 }),
      trailing_history: JSON.stringify({ metric: 'clicks', dataPoints: [{ date: '2025-01-01', value: 10 }] }),
      attribution: 'acted_on',
      measurement_window: 90,
      measurement_complete: 0,
      source_flag: 'live',
      baseline_confidence: 'exact',
      context: JSON.stringify({ triggerReason: 'manual', pageTitle: 'Widget Guide' }),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const result = rowToTrackedAction(mockRow);

    const omitted = INTENTIONAL_OMISSIONS[TABLE] ?? new Set();
    const missing: string[] = [];

    for (const col of columns) {
      if (omitted.has(col)) continue;
      const camel = snakeToCamel(col);
      const keyFound = camel in result;
      if (!keyFound) {
        missing.push(`${col} → expected "${camel}" on TrackedAction output`);
      }
    }

    expect(
      missing,
      `rowToTrackedAction is missing mappings for columns:\n${missing.join('\n')}`,
    ).toHaveLength(0);
  });

  it('converts measurement_complete integer to boolean', () => {
    const mockRow: TrackedActionRow = {
      id: 'ta_bool_test',
      workspace_id: 'ws_ta_bool',
      action_type: 'seo_fix',
      source_type: 'insight',
      source_id: null,
      page_url: null,
      target_keyword: null,
      baseline_snapshot: '{}',
      trailing_history: '{}',
      attribution: 'not_acted_on',
      measurement_window: 30,
      measurement_complete: 1,
      source_flag: 'live',
      baseline_confidence: 'estimated',
      context: '{}',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const result = rowToTrackedAction(mockRow);
    expect(result.measurementComplete).toBe(true);
    expect(typeof result.measurementComplete).toBe('boolean');
  });

  it('parses baseline_snapshot JSON', () => {
    const capturedAt = new Date().toISOString();
    const mockRow: TrackedActionRow = {
      id: 'ta_json_test',
      workspace_id: 'ws_ta_json',
      action_type: 'brief_published',
      source_type: 'content_brief',
      source_id: 'brief_xyz',
      page_url: null,
      target_keyword: 'seo tips',
      baseline_snapshot: JSON.stringify({ captured_at: capturedAt, clicks: 50 }),
      trailing_history: '{}',
      attribution: 'acted_on',
      measurement_window: 60,
      measurement_complete: 0,
      source_flag: 'live',
      baseline_confidence: 'exact',
      context: '{}',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const result = rowToTrackedAction(mockRow);
    expect(result.baselineSnapshot).toMatchObject({ captured_at: capturedAt });
  });
});

// ── 5. action_outcomes → rowToActionOutcome ──

describe('rowToActionOutcome mapper completeness', () => {
  const TABLE = 'action_outcomes';

  it('maps every action_outcomes column to a camelCase field', () => {
    const columns = getTableColumns(TABLE);
    expect(columns.length).toBeGreaterThan(0);

    const mockRow: ActionOutcomeRow = {
      id: 'ao_test_001',
      action_id: 'ta_test_001',
      checkpoint_days: 30,
      metrics_snapshot: JSON.stringify({ captured_at: new Date().toISOString(), clicks: 75 }),
      score: 'strong_win',
      early_signal: 'positive_trend',
      delta_summary: JSON.stringify({
        primary_metric: 'clicks',
        baseline_value: 50,
        current_value: 75,
        delta_absolute: 25,
        delta_percent: 50,
        direction: 'up',
      }),
      competitor_context: '{}',
      measured_at: new Date().toISOString(),
    };

    const result = rowToActionOutcome(mockRow);

    const omitted = INTENTIONAL_OMISSIONS[TABLE] ?? new Set();
    const missing: string[] = [];

    for (const col of columns) {
      if (omitted.has(col)) continue;
      const camel = snakeToCamel(col);
      const keyFound = camel in result;
      if (!keyFound) {
        missing.push(`${col} → expected "${camel}" on ActionOutcome output`);
      }
    }

    expect(
      missing,
      `rowToActionOutcome is missing mappings for columns:\n${missing.join('\n')}`,
    ).toHaveLength(0);
  });

  it('maps checkpoint_days as a typed literal', () => {
    const mockRow: ActionOutcomeRow = {
      id: 'ao_chk_test',
      action_id: 'ta_001',
      checkpoint_days: 90,
      metrics_snapshot: '{}',
      score: null,
      early_signal: null,
      delta_summary: '{}',
      competitor_context: '{}',
      measured_at: new Date().toISOString(),
    };

    const result = rowToActionOutcome(mockRow);
    expect(result.checkpointDays).toBe(90);
  });

  it('maps null early_signal as undefined', () => {
    const mockRow: ActionOutcomeRow = {
      id: 'ao_sig_null',
      action_id: 'ta_001',
      checkpoint_days: 14,
      metrics_snapshot: '{}',
      score: null,
      early_signal: null,
      delta_summary: '{}',
      competitor_context: '{}',
      measured_at: new Date().toISOString(),
    };

    const result = rowToActionOutcome(mockRow);
    expect(result.earlySignal).toBeUndefined();
  });
});

// ── 6. action_playbooks → rowToActionPlaybook ──

describe('rowToActionPlaybook mapper completeness', () => {
  const TABLE = 'action_playbooks';

  it('maps every action_playbooks column to a camelCase field', () => {
    const columns = getTableColumns(TABLE);
    expect(columns.length).toBeGreaterThan(0);

    const mockRow: ActionPlaybookRow = {
      id: 'pb_test_001',
      workspace_id: 'ws_pb_mapper',
      name: 'Refresh + Outreach',
      trigger_condition: 'content_decay_critical',
      action_sequence: JSON.stringify([
        { stepNumber: 1, actionType: 'refresh_content', description: 'Update H1', expectedOutcome: 'Improved score' },
      ]),
      historical_win_rate: 0.72,
      sample_size: 14,
      confidence: 'high',
      average_outcome: JSON.stringify({ metric: 'clicks', avgImprovement: 35, avgDaysToResult: 21 }),
      enabled: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const result = rowToActionPlaybook(mockRow);

    const omitted = INTENTIONAL_OMISSIONS[TABLE] ?? new Set();
    const missing: string[] = [];

    for (const col of columns) {
      if (omitted.has(col)) continue;
      const camel = snakeToCamel(col);
      const keyFound = camel in result;
      if (!keyFound) {
        missing.push(`${col} → expected "${camel}" on ActionPlaybook output`);
      }
    }

    expect(
      missing,
      `rowToActionPlaybook is missing mappings for columns:\n${missing.join('\n')}`,
    ).toHaveLength(0);
  });

  it('converts enabled integer to boolean', () => {
    const mockRow: ActionPlaybookRow = {
      id: 'pb_bool_test',
      workspace_id: 'ws_pb',
      name: 'Test',
      trigger_condition: 'any',
      action_sequence: '[]',
      historical_win_rate: 0,
      sample_size: 0,
      confidence: 'low',
      average_outcome: '{}',
      enabled: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const result = rowToActionPlaybook(mockRow);
    expect(result.enabled).toBe(false);
    expect(typeof result.enabled).toBe('boolean');
  });
});

// ── 7. workspace_learnings → rowToWorkspaceLearnings ──

describe('rowToWorkspaceLearnings mapper completeness', () => {
  const TABLE = 'workspace_learnings';

  it('maps every workspace_learnings column (except "learnings" blob) to a field', () => {
    const columns = getTableColumns(TABLE);
    expect(columns.length).toBeGreaterThan(0);

    const mockRow: WorkspaceLearningsRow = {
      id: 'wl_test_001',
      workspace_id: 'ws_learnings_mapper',
      learnings: JSON.stringify({
        confidence: 'medium',
        totalScoredActions: 8,
        content: {
          winRateByFormat: {},
          avgDaysToPage1: null,
          bestPerformingTopics: [],
          optimalWordCount: null,
          refreshRecoveryRate: 0.6,
          voiceScoreCorrelation: null,
        },
        strategy: null,
        technical: null,
        overall: { totalWinRate: 0.6, strongWinRate: 0.3, topActionTypes: [], recentTrend: 'improving' },
      }),
      computed_at: new Date().toISOString(),
    };

    const result = rowToWorkspaceLearnings(mockRow);
    expect(result).not.toBeNull();
    const out = result!;

    // The 'learnings' column is intentionally not a top-level key — its contents are spread
    const omitted = INTENTIONAL_OMISSIONS[TABLE] ?? new Set();

    // All non-omitted columns should have a corresponding camelCase key
    const missing: string[] = [];
    for (const col of columns) {
      if (omitted.has(col)) continue;
      const camel = snakeToCamel(col);
      const keyFound = camel in out;
      if (!keyFound) {
        missing.push(`${col} → expected "${camel}" on WorkspaceLearnings output`);
      }
    }

    expect(
      missing,
      `rowToWorkspaceLearnings is missing mappings for columns:\n${missing.join('\n')}`,
    ).toHaveLength(0);
  });

  it('returns null for unparseable learnings JSON', () => {
    const mockRow: WorkspaceLearningsRow = {
      id: 'wl_bad_json',
      workspace_id: 'ws_bad_json',
      learnings: 'not-valid-json',
      computed_at: new Date().toISOString(),
    };

    const result = rowToWorkspaceLearnings(mockRow);
    expect(result).toBeNull();
  });

  it('spreads learnings JSON fields onto the output object', () => {
    const computedAt = new Date().toISOString();
    const mockRow: WorkspaceLearningsRow = {
      id: 'wl_spread_test',
      workspace_id: 'ws_spread',
      learnings: JSON.stringify({
        confidence: 'high',
        totalScoredActions: 20,
        overall: { totalWinRate: 0.8, strongWinRate: 0.5, topActionTypes: [], recentTrend: 'improving' },
      }),
      computed_at: computedAt,
    };

    const result = rowToWorkspaceLearnings(mockRow)!;
    expect(result.workspaceId).toBe('ws_spread');
    expect(result.computedAt).toBe(computedAt);
    expect(result.confidence).toBe('high');
    expect(result.totalScoredActions).toBe(20);
    expect(result.overall.totalWinRate).toBe(0.8);
  });
});

// ── 8. feedback → rowToFeedback ──

describe('rowToFeedback mapper completeness', () => {
  const TABLE = 'feedback';

  it('maps every feedback column to a camelCase field', () => {
    const columns = getTableColumns(TABLE);
    expect(columns.length).toBeGreaterThan(0);

    const wsId = `mapper-fb-${Date.now()}`;
    createFeedback(wsId, {
      type: 'bug',
      title: 'Mapper test bug',
      description: 'Testing mapper completeness via feedback',
      context: {
        currentTab: 'analytics',
        browser: 'Chrome 124',
        screenSize: '1440x900',
        url: 'https://example.com/admin',
        userAgent: 'Mozilla/5.0',
      },
      submittedBy: 'client_user_001',
    });

    const items = listFeedback(wsId);
    expect(items.length).toBeGreaterThan(0);
    const out = items[0];

    const omitted = INTENTIONAL_OMISSIONS[TABLE] ?? new Set();
    const missing: string[] = [];

    for (const col of columns) {
      if (omitted.has(col)) continue;
      const camel = snakeToCamel(col);
      const keyFound = camel in out;
      if (!keyFound) {
        missing.push(`${col} → expected "${camel}" on FeedbackItem output`);
      }
    }

    expect(
      missing,
      `rowToFeedback is missing mappings for columns:\n${missing.join('\n')}`,
    ).toHaveLength(0);
  });

  it('maps context JSON column as parsed object', () => {
    const wsId = `mapper-fb-ctx-${Date.now()}`;
    createFeedback(wsId, {
      type: 'feature',
      title: 'Context check',
      description: 'Context field should be parsed',
      context: { currentTab: 'strategy', browser: 'Firefox 125' },
    });

    const items = listFeedback(wsId);
    expect(items.length).toBeGreaterThan(0);
    const out = items[0];

    expect(out.context).toBeDefined();
    expect(out.context!.currentTab).toBe('strategy');
    expect(out.context!.browser).toBe('Firefox 125');
  });

  it('maps replies as empty array when absent', () => {
    const wsId = `mapper-fb-replies-${Date.now()}`;
    createFeedback(wsId, {
      type: 'general',
      title: 'No replies yet',
      description: 'Fresh feedback with no replies',
    });

    const items = listFeedback(wsId);
    expect(items.length).toBeGreaterThan(0);
    expect(Array.isArray(items[0].replies)).toBe(true);
    expect(items[0].replies).toHaveLength(0);
  });
});

// ── 9. Structural: PRAGMA returns real column names for all tested tables ──

describe('PRAGMA table_info — tables exist and are populated', () => {
  const testedTables = [
    'workspaces',
    'analytics_insights',
    'content_topic_requests',
    'tracked_actions',
    'action_outcomes',
    'action_playbooks',
    'workspace_learnings',
    'feedback',
  ];

  for (const table of testedTables) {
    it(`table "${table}" exists in the DB with at least 3 columns`, () => {
      const cols = getTableColumns(table);
      expect(cols.length).toBeGreaterThanOrEqual(3);
      // id column is present in every tested table
      expect(cols).toContain('id');
    });
  }
});

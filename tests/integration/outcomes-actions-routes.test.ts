/**
 * Integration tests for outcomes action-specific paths.
 *
 * Tests:
 * - GET /api/outcomes/:workspaceId/actions/:actionId with unknown actionId → 404
 * - POST /api/outcomes/:workspaceId/actions with missing required fields → 400
 * - POST /api/outcomes/:workspaceId/actions with valid body → 200 with action object
 *
 * Complements outcome-pipeline.test.ts (port 13250) which tests full pipeline flows.
 *
 * Port: 13633 (range: 13632–13639)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

// Enable outcome tracking feature flag before server starts
process.env.FEATURE_OUTCOME_TRACKING = 'true';

const ctx = createTestContext(13633);
const { api, postJson } = ctx;

let wsId = '';
const RUN_ID = Date.now().toString(36);

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Outcomes Actions WS 13633').id;
}, 60_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

// ── Single action GET — unknown actionId ──────────────────────────────────────

describe('GET /api/outcomes/:workspaceId/actions/:actionId', () => {
  it('returns 404 for unknown actionId', async () => {
    const res = await api(`/api/outcomes/${wsId}/actions/nonexistent-action-id`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('returns 404 when actionId belongs to a different workspace', async () => {
    // Create a second workspace and record an action there
    const ws2 = createWorkspace('Other WS for cross-ws test 13633');
    try {
      const recordRes = await postJson(`/api/outcomes/${ws2.id}/actions`, {
        actionType: 'meta_updated',
        sourceType: 'cross-ws-test',
        sourceId: `cross-${RUN_ID}`,
        baselineSnapshot: { position: 5.0 },
      });
      expect(recordRes.status).toBe(200);
      const { action: ws2Action } = await recordRes.json();

      // Try to access that action under wsId — should 404 (workspace mismatch)
      const res = await api(`/api/outcomes/${wsId}/actions/${ws2Action.id}`);
      expect(res.status).toBe(404);
    } finally {
      deleteWorkspace(ws2.id);
    }
  });
});

// ── POST /api/outcomes/:workspaceId/actions — validation ──────────────────────

describe('POST /api/outcomes/:workspaceId/actions — validation', () => {
  it('returns 400 when actionType is missing', async () => {
    const res = await postJson(`/api/outcomes/${wsId}/actions`, {
      sourceType: 'test',
      baselineSnapshot: { position: 5.0 },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when sourceType is missing', async () => {
    const res = await postJson(`/api/outcomes/${wsId}/actions`, {
      actionType: 'meta_updated',
      baselineSnapshot: { position: 5.0 },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when baselineSnapshot is missing', async () => {
    const res = await postJson(`/api/outcomes/${wsId}/actions`, {
      actionType: 'meta_updated',
      sourceType: 'test',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when actionType is invalid enum value', async () => {
    const res = await postJson(`/api/outcomes/${wsId}/actions`, {
      actionType: 'invalid_action_type_xyz',
      sourceType: 'test',
      baselineSnapshot: { clicks: 10 },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when sourceType is empty string', async () => {
    const res = await postJson(`/api/outcomes/${wsId}/actions`, {
      actionType: 'meta_updated',
      sourceType: '',
      baselineSnapshot: { position: 5.0 },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when attribution is invalid enum value', async () => {
    const res = await postJson(`/api/outcomes/${wsId}/actions`, {
      actionType: 'meta_updated',
      sourceType: 'test',
      sourceId: `attr-invalid-${RUN_ID}`,
      baselineSnapshot: { position: 5.0 },
      attribution: 'not_a_valid_attribution',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when measurementWindow is below minimum (7)', async () => {
    const res = await postJson(`/api/outcomes/${wsId}/actions`, {
      actionType: 'meta_updated',
      sourceType: 'test',
      sourceId: `mw-low-${RUN_ID}`,
      baselineSnapshot: { position: 5.0 },
      measurementWindow: 3,
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when measurementWindow exceeds maximum (365)', async () => {
    const res = await postJson(`/api/outcomes/${wsId}/actions`, {
      actionType: 'meta_updated',
      sourceType: 'test',
      sourceId: `mw-high-${RUN_ID}`,
      baselineSnapshot: { position: 5.0 },
      measurementWindow: 400,
    });
    expect(res.status).toBe(400);
  });
});

// ── POST /api/outcomes/:workspaceId/actions — valid creation ──────────────────

describe('POST /api/outcomes/:workspaceId/actions — valid creation', () => {
  it('creates action with minimal required fields and returns 200', async () => {
    const res = await postJson(`/api/outcomes/${wsId}/actions`, {
      actionType: 'meta_updated',
      sourceType: 'test-minimal',
      baselineSnapshot: { position: 10.0 },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.action).toBeDefined();
  });

  it('created action has expected shape', async () => {
    const res = await postJson(`/api/outcomes/${wsId}/actions`, {
      actionType: 'content_published',
      sourceType: 'test-shape',
      sourceId: `shape-${RUN_ID}`,
      pageUrl: 'https://example.com/shape-test',
      targetKeyword: 'shape keyword',
      baselineSnapshot: { position: 8.5, clicks: 20, impressions: 300 },
      attribution: 'platform_executed',
      measurementWindow: 30,
    });
    expect(res.status).toBe(200);
    const { action } = await res.json();

    expect(typeof action.id).toBe('string');
    expect(action.id).toBeTruthy();
    expect(action.workspaceId).toBe(wsId);
    expect(action.actionType).toBe('content_published');
    expect(action.sourceType).toBe('test-shape');
    expect(action.sourceId).toBe(`shape-${RUN_ID}`);
    expect(action.pageUrl).toBe('https://example.com/shape-test');
    expect(action.targetKeyword).toBe('shape keyword');
    expect(action.attribution).toBe('platform_executed');
    expect(action.measurementWindow).toBe(30);
    expect(action.measurementComplete).toBe(false);
    expect(action.baselineSnapshot).toBeDefined();
    expect(action.baselineSnapshot.position).toBe(8.5);
    expect(action.baselineSnapshot.clicks).toBe(20);
    expect(typeof action.createdAt).toBe('string');
  });

  it('created action appears in the actions list', async () => {
    const createRes = await postJson(`/api/outcomes/${wsId}/actions`, {
      actionType: 'content_refreshed',
      sourceType: 'list-verify',
      sourceId: `list-verify-${RUN_ID}`,
      baselineSnapshot: { clicks: 5, impressions: 100 },
    });
    expect(createRes.status).toBe(200);
    const { action } = await createRes.json();
    const actionId = action.id;

    const listRes = await api(`/api/outcomes/${wsId}/actions`);
    expect(listRes.status).toBe(200);
    const actions = await listRes.json();
    const found = actions.find((a: { id: string }) => a.id === actionId);
    expect(found).toBeDefined();
  });

  it('created action is retrievable by ID', async () => {
    const createRes = await postJson(`/api/outcomes/${wsId}/actions`, {
      actionType: 'audit_fix_applied',
      sourceType: 'get-by-id',
      sourceId: `get-by-id-${RUN_ID}`,
      baselineSnapshot: { position: 15.0 },
    });
    expect(createRes.status).toBe(200);
    const { action } = await createRes.json();
    const actionId = action.id;

    const getRes = await api(`/api/outcomes/${wsId}/actions/${actionId}`);
    expect(getRes.status).toBe(200);
    const retrieved = await getRes.json();
    expect(retrieved.id).toBe(actionId);
    expect(retrieved.actionType).toBe('audit_fix_applied');
    // action detail includes outcomes array
    expect(Array.isArray(retrieved.outcomes)).toBe(true);
  });

  it('all valid actionType values are accepted', async () => {
    const validTypes = [
      'insight_acted_on',
      'content_published',
      'brief_created',
      'strategy_keyword_added',
      'schema_deployed',
      'audit_fix_applied',
      'content_refreshed',
      'internal_link_added',
      'meta_updated',
      'voice_calibrated',
    ];

    for (const actionType of validTypes) {
      const res = await postJson(`/api/outcomes/${wsId}/actions`, {
        actionType,
        sourceType: 'type-coverage',
        sourceId: `type-${actionType}-${RUN_ID}`,
        baselineSnapshot: { position: 5.0 },
      });
      expect(res.status, `actionType '${actionType}' should be accepted`).toBe(200);
    }
  });
});

// ── Feature flag gate check ───────────────────────────────────────────────────

describe('Feature flag — outcome-tracking enabled', () => {
  it('diagnostics confirms feature flag is enabled', async () => {
    const res = await api(`/api/outcomes/${wsId}/diagnostics`);
    expect(res.status).toBe(200);
    const diag = await res.json();
    expect(diag.featureEnabled).toBe(true);
  });
});

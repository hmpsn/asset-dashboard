/**
 * Integration tests: diagnostics routes feature gate.
 *
 * The 'deep-diagnostics' feature flag defaults to disabled in tests.
 * Tests verify the gate behavior:
 *   - List reports with feature disabled → 403
 *   - Get by-insight with feature disabled → 200 {report: null}
 *   - Get specific report with feature disabled → 403
 *   - Get non-existent report with feature disabled → 403 (gate fires first)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13406);
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Diagnostics Feature Gate WS').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('GET /api/workspaces/:workspaceId/diagnostics — feature gate', () => {
  it('returns 403 when deep-diagnostics feature is disabled', async () => {
    const res = await api(`/api/workspaces/${wsId}/diagnostics`);
    // Feature 'deep-diagnostics' is off by default → 403
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Feature');
  });

  it('returns 403 for unknown workspace when feature disabled', async () => {
    const res = await api('/api/workspaces/ws_does_not_exist_diag_99/diagnostics');
    // Auth guard passes (no JWT user, APP_PASSWORD=''), feature gate fires
    expect(res.status).toBe(403);
  });
});

describe('GET /api/workspaces/:workspaceId/diagnostics/by-insight/:insightId — feature gate', () => {
  it('returns 200 {report: null} when feature is disabled', async () => {
    const res = await api(`/api/workspaces/${wsId}/diagnostics/by-insight/ins_fake_001`);
    // by-insight returns 200 with null instead of 403 (intentional per implementation)
    expect(res.status).toBe(200);
    const body = await res.json() as { report: null };
    expect(body.report).toBeNull();
  });
});

describe('GET /api/workspaces/:workspaceId/diagnostics/:reportId — feature gate', () => {
  it('returns 403 when feature is disabled', async () => {
    const res = await api(`/api/workspaces/${wsId}/diagnostics/rpt_fake_report_001`);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Feature');
  });
});

/**
 * keyword-hub-actions.test.ts — P3 integration test (port 13901).
 *
 * Exercises the REAL action engine through the HTTP route:
 *   POST   /api/webflow/keyword-command-center/:workspaceId/actions       (3b lifecycle guard → 409)
 *   DELETE /api/webflow/keyword-command-center/:workspaceId/keywords/:kw   (3c hard delete → 200 / 403)
 *
 * (P1 already owns port 13900 for keyword-hub-list; the plan's "13900" drifted, so this
 * file uses the next free port, 13901.)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { addTrackedKeyword } from '../../server/rank-tracking.js';
import { TRACKED_KEYWORD_SOURCE } from '../../shared/types/rank-tracking.js';
import type { KeywordCommandCenterActionResult } from '../../shared/types/keyword-command-center.js';

const ctx = createTestContext(13901); // port-ok: next free after keyword-hub-list (13900)
const { postJson, del } = ctx;

let workspaceId = '';
const base = () => `/api/webflow/keyword-command-center/${workspaceId}`;

beforeAll(async () => {
  await ctx.startServer();
  workspaceId = createWorkspace('Keyword Hub Actions Integration').id;
});

afterAll(async () => {
  if (workspaceId) deleteWorkspace(workspaceId);
  await ctx.stopServer();
});

describe('action lifecycle guard (3b) over HTTP', () => {
  it('legal action (track then retire force) → 200 with trackedKeywords', async () => {
    await postJson(`${base()}/actions`, { action: 'track', keyword: 'legal kw' });
    const res = await postJson(`${base()}/actions`, { action: 'retire', keyword: 'legal kw', force: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as KeywordCommandCenterActionResult;
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.trackedKeywords)).toBe(true);
  });

  it('illegal transition (retire an already-deprecated keyword) → 409 with the transition message', async () => {
    // 'legal kw' is already deprecated from the prior test → retire again is deprecated→deprecated.
    const res = await postJson(`${base()}/actions`, { action: 'retire', keyword: 'legal kw', force: true });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Invalid tracked_keyword transition');
  });
});

describe('hard delete route (3c) over HTTP', () => {
  it('DELETE a MANUAL keyword → 200 + the keyword is gone from the returned list', async () => {
    addTrackedKeyword(workspaceId, 'manual del kw', { source: TRACKED_KEYWORD_SOURCE.MANUAL });
    const res = await del(`${base()}/keywords/${encodeURIComponent('manual del kw')}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; trackedKeywords: Array<{ query: string }> };
    expect(body.ok).toBe(true);
    expect(body.trackedKeywords.some(k => k.query === 'manual del kw')).toBe(false);
  });

  it('DELETE a CLIENT_REQUESTED keyword without force → 403', async () => {
    addTrackedKeyword(workspaceId, 'client del kw', { source: TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED });
    const res = await del(`${base()}/keywords/${encodeURIComponent('client del kw')}`);
    expect(res.status).toBe(403);
  });

  it('DELETE a gap-provenanced keyword without force → 403', async () => {
    addTrackedKeyword(workspaceId, 'gap del kw', { source: TRACKED_KEYWORD_SOURCE.MANUAL, sourceGapKey: 'gap:gap del kw' });
    const res = await del(`${base()}/keywords/${encodeURIComponent('gap del kw')}`);
    expect(res.status).toBe(403);
  });
});

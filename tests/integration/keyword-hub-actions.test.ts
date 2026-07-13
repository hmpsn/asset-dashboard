/**
 *
 * Exercises the REAL action engine through the HTTP route:
 *   POST   /api/webflow/keyword-command-center/:workspaceId/actions       (3b lifecycle guard → 409)
 *   DELETE /api/webflow/keyword-command-center/:workspaceId/keywords/:kw   (3c hard delete → 200 / 403)
 *
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { addTrackedKeyword } from '../../server/rank-tracking.js';
import { TRACKED_KEYWORD_SOURCE } from '../../shared/types/rank-tracking.js';
import type { KeywordCommandCenterActionResult, KeywordCommandCenterBulkActionResult } from '../../shared/types/keyword-command-center.js';

const ctx = createEphemeralTestContext(import.meta.url);
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

  it('never serializes tracked-keyword provenance metadata in an action response', async () => {
    addTrackedKeyword(workspaceId, 'private metadata kw', {
      source: TRACKED_KEYWORD_SOURCE.MANUAL,
      sourceGapKey: 'private metadata kw',
      sourceGapKeyV2: 'private metadata kw',
      strategyOwned: true,
    });
    const res = await postJson(`${base()}/actions`, { action: 'track', keyword: 'private metadata kw' });
    expect(res.status).toBe(200);
    const body = await res.json() as KeywordCommandCenterActionResult;
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('sourceGapKey');
    expect(serialized).not.toContain('sourceGapKeyV2');
    expect(serialized).not.toContain('strategyOwned');
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

  it('DELETE a v2-only gap-provenanced keyword without force → 403', async () => {
    addTrackedKeyword(workspaceId, '東京', {
      source: TRACKED_KEYWORD_SOURCE.MANUAL,
      sourceGapKeyV2: '東京',
    });
    const res = await del(`${base()}/keywords/${encodeURIComponent('東京')}`);
    expect(res.status).toBe(403);
  });
});

// Regression (#3): a bulk action over a selection that already contains a
// keyword in the target state must report a benign skip, NOT a false failure.
// The single-action route still returns 409 for the same illegal transition
// (intended/strict); only the bulk path is lenient (idempotent skip).
describe('bulk idempotent self-transition (#3) over HTTP', () => {
  it('bulk RETIRE over an already-deprecated keyword → skipped_noop, never failed', async () => {
    await postJson(`${base()}/actions`, { action: 'track', keyword: 'bulk idem' });
    await postJson(`${base()}/actions`, { action: 'retire', keyword: 'bulk idem', force: true });

    const res = await postJson(`${base()}/actions/bulk`, { action: 'retire', keywords: ['bulk idem'], force: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as KeywordCommandCenterBulkActionResult;
    expect(body.failed).toBe(0); // regression guard: P3 reported failed: 1 here
    expect(body.applied).toBe(0);
    expect(body.skipped).toBe(1);
    expect(body.items[0]?.status).toBe('skipped_noop');
  });

  it('bulk RETIRE over a mixed selection applies the active row and skips the already-retired one', async () => {
    await postJson(`${base()}/actions`, { action: 'track', keyword: 'bulk active' });
    await postJson(`${base()}/actions`, { action: 'track', keyword: 'bulk done' });
    await postJson(`${base()}/actions`, { action: 'retire', keyword: 'bulk done', force: true });

    const res = await postJson(`${base()}/actions/bulk`, { action: 'retire', keywords: ['bulk active', 'bulk done'], force: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as KeywordCommandCenterBulkActionResult;
    expect(body.applied).toBe(1);
    expect(body.skipped).toBe(1);
    expect(body.failed).toBe(0);
  });
});

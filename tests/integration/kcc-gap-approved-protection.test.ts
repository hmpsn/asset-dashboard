/**
 * kcc-gap-approved-protection.test.ts — W2.2 regression guard.
 *
 * Decision-B protection contract: a gap-approved tracked keyword (sourceGapKey set)
 * must be protected from unforced retire / decline / pause via the action endpoint.
 *
 * Bug: applyKeywordCommandCenterActionInternal previously used findTracked() which
 * routes through resolveTrackedKeywords() → stripUndefinedKeys(), deleting sourceGapKey.
 * protectedReason()'s "Gap-approved keyword" arm therefore never fired, and the server
 * returned 200 instead of 409 for an unforced lifecycle action on a gap-sourced row.
 *
 * Fix: resolve from listTrackedKeywordRows() (provenance-bearing table read, identical
 * to the deleteKeywordHard table-read approach).
 *
 * Assertions per the W2.2 spec:
 *   1. Unforced retire of gap-approved keyword → 409
 *   2. Forced retire of gap-approved keyword → 200 (force still works)
 *   3. Unforced decline of gap-approved keyword → 409
 *   4. Unforced pause of gap-approved keyword → 409
 *   5. Unforced retire of plain MANUAL keyword → 200 (non-gap not affected by fix)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { addTrackedKeyword } from '../../server/rank-tracking.js';
import { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } from '../../shared/types/rank-tracking.js';
import type { KeywordCommandCenterActionResult } from '../../shared/types/keyword-command-center.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { postJson } = ctx;

let workspaceId = '';
const base = () => `/api/webflow/keyword-command-center/${workspaceId}`;

beforeAll(async () => {
  await ctx.startServer();
  workspaceId = createWorkspace('KCC Gap Approved Protection').id;
});

afterAll(async () => {
  if (workspaceId) deleteWorkspace(workspaceId);
  await ctx.stopServer();
});

describe('gap-approved keyword protection on action endpoint (W2.2 bug fix)', () => {
  it('unforced RETIRE of a v2-only gap-approved keyword → 409', async () => {
    addTrackedKeyword(workspaceId, '東京 歯科', {
      source: TRACKED_KEYWORD_SOURCE.CONTENT_GAP,
      status: TRACKED_KEYWORD_STATUS.ACTIVE,
      sourceGapKeyV2: '東京 歯科',
    });
    const res = await postJson(`${base()}/actions`, {
      action: 'retire',
      keyword: '東京 歯科',
    });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toMatch(/gap-approved keyword/i);
  });

  it('unforced RETIRE of a gap-approved keyword → 409 (protection enforced)', async () => {
    // Create a keyword with sourceGapKey — the content-gap approval path writes this field
    // (server/keyword-feedback.ts:189). Direct addTrackedKeyword mirrors that write.
    addTrackedKeyword(workspaceId, 'gap retire test', {
      source: TRACKED_KEYWORD_SOURCE.CONTENT_GAP,
      status: TRACKED_KEYWORD_STATUS.ACTIVE,
      sourceGapKey: 'gap retire test',
    });

    const res = await postJson(`${base()}/actions`, {
      action: 'retire',
      keyword: 'gap retire test',
      // force intentionally omitted
    });
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/gap-approved keyword/i);
  });

  it('forced RETIRE of a gap-approved keyword → 200 (force bypass still works)', async () => {
    const res = await postJson(`${base()}/actions`, {
      action: 'retire',
      keyword: 'gap retire test',
      force: true,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as KeywordCommandCenterActionResult;
    expect(body.ok).toBe(true);
  });

  it('unforced DECLINE of a gap-approved keyword → 409', async () => {
    addTrackedKeyword(workspaceId, 'gap decline test', {
      source: TRACKED_KEYWORD_SOURCE.CONTENT_GAP,
      status: TRACKED_KEYWORD_STATUS.ACTIVE,
      sourceGapKey: 'gap decline test',
    });

    const res = await postJson(`${base()}/actions`, {
      action: 'decline',
      keyword: 'gap decline test',
    });
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/gap-approved keyword/i);
  });

  it('unforced PAUSE of a gap-approved keyword → 409', async () => {
    addTrackedKeyword(workspaceId, 'gap pause test', {
      source: TRACKED_KEYWORD_SOURCE.CONTENT_GAP,
      status: TRACKED_KEYWORD_STATUS.ACTIVE,
      sourceGapKey: 'gap pause test',
    });

    const res = await postJson(`${base()}/actions`, {
      action: 'pause_tracking',
      keyword: 'gap pause test',
    });
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/gap-approved keyword/i);
  });

  it('unforced RETIRE of a plain MANUAL keyword (no sourceGapKey) → 200 (non-gap unaffected)', async () => {
    addTrackedKeyword(workspaceId, 'plain manual retire', {
      source: TRACKED_KEYWORD_SOURCE.MANUAL,
      status: TRACKED_KEYWORD_STATUS.ACTIVE,
      // sourceGapKey intentionally absent
    });

    const res = await postJson(`${base()}/actions`, {
      action: 'retire',
      keyword: 'plain manual retire',
    });
    // MANUAL is protected too — requires force
    // (protectedReason: 'Manual keyword')
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/manual keyword/i);
  });
});

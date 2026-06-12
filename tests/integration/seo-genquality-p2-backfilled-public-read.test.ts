/**
 * SEO Generation Quality P2 — public read-path test for the `backfilled` honesty
 * flag (REQUIRED by the plan §5.4 DoD: the PUBLIC endpoint, not the admin route).
 *
 * Asserts a content gap persisted with `backfilled = true` survives the explicit
 * public field whitelist in server/routes/public-content.ts and renders with the
 * tag through GET /api/public/seo-strategy/:workspaceId — and that a normal
 * (organic) gap does NOT carry the flag. This catches a regression in the
 * whitelist that would silently drop the field (the lockstep gap P2 closes).
 *
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { upsertContentGap } from '../../server/content-gaps.js';
import type { ContentGap } from '../../shared/types/workspace.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace(`P2 Backfilled Read ${ctx.PORT}`).id;

  const organic: ContentGap = {
    topic: 'Organic strong idea',
    targetKeyword: 'organic strong keyword',
    intent: 'informational',
    priority: 'high',
    rationale: 'Organically surfaced — high opportunity.',
    volume: 5000,
    difficulty: 20,
    opportunityScore: 88,
    // backfilled intentionally omitted → should read back falsy
  };
  const backfilled: ContentGap = {
    topic: 'Expanded pick idea',
    targetKeyword: 'backfilled long tail keyword',
    intent: 'informational',
    priority: 'low',
    rationale: 'Re-admitted by the deterministic floor to keep the list populated.',
    volume: 120,
    difficulty: 5,
    opportunityScore: 30,
    backfilled: true,
  };
  upsertContentGap(wsId, organic);
  upsertContentGap(wsId, backfilled);
}, 25_000);

afterAll(async () => {
  if (wsId) deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('GET /api/public/seo-strategy/:workspaceId — backfilled flag through the whitelist', () => {
  it('renders the backfilled tag for a re-admitted gap and omits it for an organic gap', async () => {
    const res = await api(`/api/public/seo-strategy/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { contentGaps: Array<{ targetKeyword: string; backfilled?: boolean }> };
    expect(Array.isArray(body.contentGaps)).toBe(true);

    const organicGap = body.contentGaps.find(g => g.targetKeyword === 'organic strong keyword');
    const backfilledGap = body.contentGaps.find(g => g.targetKeyword === 'backfilled long tail keyword');

    expect(organicGap).toBeTruthy();
    expect(backfilledGap).toBeTruthy();

    // The honesty flag survives the explicit public whitelist for the backfilled gap…
    expect(backfilledGap!.backfilled).toBe(true);
    // …and is absent/falsy for the organically-surfaced gap.
    expect(organicGap!.backfilled).toBeFalsy();
  });
});

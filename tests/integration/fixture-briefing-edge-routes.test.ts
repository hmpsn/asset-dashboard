process.env.FEATURE_CLIENT_BRIEFING_V2 = 'true';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { upsertBriefingDraft } from '../../server/briefing-store.js';
import { randomUUID } from 'crypto';

const ctx = createTestContext(13757);
const { api, postJson, patchJson } = ctx;

let wsId = '';
let cleanup: (() => void) | undefined;

function makeStories(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: randomUUID(),
    category: 'win' as const,
    isHeadline: i === 0,
    headline: `Story ${i}`,
    narrative: 'Narrative',
    metrics: [{ value: '+1', label: 'metric' }],
    drillIn: { page: 'performance' as const },
    sourceRefs: [{ type: 'analytics_insight' as const, id: randomUUID() }],
  }));
}

beforeAll(async () => {
  await ctx.startServer();
  const ws = seedWorkspace({ tier: 'growth' });
  wsId = ws.workspaceId;
  cleanup = ws.cleanup;
});

afterAll(async () => {
  cleanup?.();
  await ctx.stopServer();
});

describe('Fixture briefing edge routes', () => {
  it('returns drafts list contract', async () => {
    const res = await api(`/api/briefing/${wsId}/drafts`);
    expect(res.status).toBe(200);
    const body = await res.json() as { drafts: unknown[] };
    expect(Array.isArray(body.drafts)).toBe(true);
  });

  it('rejects invalid stories patch payload', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: wsId,
      weekOf: '2026-05-01',
      stories: makeStories(2),
      sourceMetadata: null,
    });

    const res = await patchJson(`/api/briefing/${wsId}/drafts/${draft.id}/stories`, { stories: [] });
    expect(res.status).toBe(400);
  });

  it('returns 404 for approve on missing draft', async () => {
    const res = await postJson(`/api/briefing/${wsId}/drafts/draft_fixture_missing/approve`, {});
    expect(res.status).toBe(404);
  });
});

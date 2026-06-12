import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { createEphemeralTestContext } from './helpers.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api } = ctx;

let freeWorkspace: SeededFullWorkspace | null = null;
let growthWorkspace: SeededFullWorkspace | null = null;
let premiumWorkspace: SeededFullWorkspace | null = null;

beforeAll(async () => {
  await ctx.startServer();
  freeWorkspace = seedWorkspace({ tier: 'free', clientPassword: '' });
  growthWorkspace = seedWorkspace({ tier: 'growth', clientPassword: '' });
  premiumWorkspace = seedWorkspace({ tier: 'premium', clientPassword: '' });
}, 25_000);

afterAll(async () => {
  freeWorkspace?.cleanup();
  growthWorkspace?.cleanup();
  premiumWorkspace?.cleanup();
  await ctx.stopServer();
});

describe('fixture public tier route', () => {
  it('returns tier/baseTier free for free seeded workspace', async () => {
    expect(freeWorkspace).toBeTruthy();
    if (!freeWorkspace) return;

    const res = await api(`/api/public/tier/${freeWorkspace.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { tier: string; baseTier: string };
    expect(body.tier).toBe('free');
    expect(body.baseTier).toBe('free');
  });

  it('returns tier/baseTier growth for growth seeded workspace', async () => {
    expect(growthWorkspace).toBeTruthy();
    if (!growthWorkspace) return;

    const res = await api(`/api/public/tier/${growthWorkspace.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { tier: string; baseTier: string };
    expect(body.tier).toBe('growth');
    expect(body.baseTier).toBe('growth');
  });

  it('returns tier/baseTier premium for premium seeded workspace', async () => {
    expect(premiumWorkspace).toBeTruthy();
    if (!premiumWorkspace) return;

    const res = await api(`/api/public/tier/${premiumWorkspace.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { tier: string; baseTier: string };
    expect(body.tier).toBe('premium');
    expect(body.baseTier).toBe('premium');
  });

  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/public/tier/ws_fixture_public_tier_missing');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Workspace not found');
  });
});

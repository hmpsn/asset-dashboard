import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13359); // port-ok: next free after 13358

let workspaceId = '';

beforeAll(async () => {
  await ctx.startServer();
  const workspace = createWorkspace('Public Pricing Route Test Workspace');
  workspaceId = workspace.id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(workspaceId);
  await ctx.stopServer();
});

describe('GET /api/public/pricing/:id', () => {
  it('returns 404 for missing workspace', async () => {
    const res = await ctx.api('/api/public/pricing/ws_missing_public_pricing');
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Workspace not found' });
  });

  it('returns default pricing payload shape', async () => {
    const res = await ctx.api(`/api/public/pricing/${workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toEqual(expect.objectContaining({
      currency: 'USD',
      stripeEnabled: expect.any(Boolean),
      products: expect.any(Object),
      bundles: expect.any(Array),
    }));

    expect(body.products).toEqual(expect.objectContaining({
      brief_blog: expect.objectContaining({ price: expect.any(Number), category: 'brief' }),
      post_polished: expect.objectContaining({ price: expect.any(Number), category: 'content' }),
    }));
  });

  it('applies zero-dollar workspace overrides for brief and full-post prices', async () => {
    updateWorkspace(workspaceId, {
      contentPricing: {
        briefPrice: 0,
        fullPostPrice: 0,
        currency: 'USD',
      },
    });

    const res = await ctx.api(`/api/public/pricing/${workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.products.brief_blog.price).toBe(0);
    expect(body.products.brief_landing.price).toBe(0);
    expect(body.products.post_polished.price).toBe(0);
  });
});

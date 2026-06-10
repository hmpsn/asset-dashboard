/**
 * Cross-workspace scoping for admin routes deriving workspaceId from query/body
 * (2026-06-09 audit, confirmed finding #2 — PR 3 Task 1).
 *
 * The global admin gate accepts ANY valid internal JWT with no workspace check, and
 * the per-route guards for query/body-derived workspaceIds were never wired
 * (requireWorkspaceAccessFromQuery had zero callers). A JWT scoped to workspace A
 * could read workspace B's AI intelligence, activity, usage, and debug prompts.
 *
 * These tests pin: workspace-scoped JWT → cross-workspace = 403, own workspace = 2xx,
 * and the HMAC/no-JWT pass-through is unchanged (legacy APP_PASSWORD auth owns access).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedAuthData, type SeededAuth } from '../fixtures/auth-seed.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';

const ctx = createEphemeralTestContext(import.meta.url);

let scopedAuth: SeededAuth | null = null;
let otherWorkspace: SeededFullWorkspace | null = null;

beforeAll(async () => {
  await ctx.startServer();
  // JWT user scoped to workspace A only.
  scopedAuth = await seedAuthData();
  // Workspace B — the cross-tenant target.
  otherWorkspace = seedWorkspace();
}, 60_000);

afterAll(async () => {
  scopedAuth?.cleanup();
  otherWorkspace?.cleanup();
  await ctx.stopServer();
});

function asScopedUser(): Record<string, string> {
  return { Authorization: `Bearer ${scopedAuth!.adminToken}` };
}

describe('query/body workspaceId guards — cross-workspace JWT denial', () => {
  it('GET /api/activity?workspaceId=<other> → 403 for a JWT scoped elsewhere', async () => {
    const res = await ctx.api(`/api/activity?workspaceId=${otherWorkspace!.workspaceId}`, {
      headers: asScopedUser(),
    });
    expect(res.status).toBe(403);
  });

  it('GET /api/activity?workspaceId=<own> → 200 for the scoped JWT', async () => {
    const res = await ctx.api(`/api/activity?workspaceId=${scopedAuth!.workspaceId}`, {
      headers: asScopedUser(),
    });
    expect(res.status).toBe(200);
  });

  it('GET /api/ai/usage?workspaceId=<other> → 403 for a JWT scoped elsewhere', async () => {
    const res = await ctx.api(`/api/ai/usage?workspaceId=${otherWorkspace!.workspaceId}`, {
      headers: asScopedUser(),
    });
    expect(res.status).toBe(403);
  });

  it('GET /api/ai/time-saved?workspaceId=<other> → 403 for a JWT scoped elsewhere', async () => {
    const res = await ctx.api(`/api/ai/time-saved?workspaceId=${otherWorkspace!.workspaceId}`, {
      headers: asScopedUser(),
    });
    expect(res.status).toBe(403);
  });

  it('GET /api/ai/usage?workspaceId=<own> → not 403 (positive path; guards the right query key)', async () => {
    const res = await ctx.api(`/api/ai/usage?workspaceId=${scopedAuth!.workspaceId}`, {
      headers: asScopedUser(),
    });
    expect(res.status).not.toBe(403);
  });

  it('POST /api/webflow/seo-rewrite with body workspaceId=<other> → 403 (destructured read, surfaced in review)', async () => {
    const res = await ctx.api('/api/webflow/seo-rewrite', {
      method: 'POST',
      headers: { ...asScopedUser(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: otherWorkspace!.workspaceId, pageTitle: 'x', field: 'seoTitle' }),
    });
    expect(res.status).toBe(403);
  });

  it('POST /api/stripe/create-checkout with body workspaceId=<other> → 403', async () => {
    const res = await ctx.api('/api/stripe/create-checkout', {
      method: 'POST',
      headers: { ...asScopedUser(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: otherWorkspace!.workspaceId, productType: 'content' }),
    });
    expect(res.status).toBe(403);
  });

  it('POST /api/admin-chat with body workspaceId=<other> → 403 (guard fires before any AI call)', async () => {
    const res = await ctx.api('/api/admin-chat', {
      method: 'POST',
      headers: { ...asScopedUser(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: otherWorkspace!.workspaceId, message: 'hi' }),
    });
    expect(res.status).toBe(403);
  });

  it('GET /api/debug/prompt?workspaceId=<other> → 403 for a JWT scoped elsewhere', async () => {
    const res = await ctx.api(`/api/debug/prompt?workspaceId=${otherWorkspace!.workspaceId}`, {
      headers: asScopedUser(),
    });
    expect(res.status).toBe(403);
  });

  it('GET /api/requests?workspaceId=<other> → 403 for a JWT scoped elsewhere', async () => {
    const res = await ctx.api(`/api/requests?workspaceId=${otherWorkspace!.workspaceId}`, {
      headers: asScopedUser(),
    });
    expect(res.status).toBe(403);
  });

  it('no-JWT request (legacy HMAC/APP_PASSWORD path) passes through unchanged', async () => {
    // requestUserCanAccessWorkspace passes when req.user is unset — the legacy admin
    // auth model owns access. Pin it so the guard rollout can't lock out HMAC admins.
    const res = await ctx.api(`/api/activity?workspaceId=${otherWorkspace!.workspaceId}`);
    expect(res.status).toBe(200);
  });
});

/**
 * Integration tests for the public client-facing briefing endpoint.
 *
 * GET /api/public/briefing/:workspaceId
 *   - 404 when workspace doesn't exist
 *   - 403 when clientPortalEnabled === false
 *   - 402 when effective tier === 'free' (no trial)
 *   - 200 + briefing summary when paid tier with a published briefing
 *   - 200 + { briefing: null } when paid tier with no published briefing
 *   - 200 with admin-only fields stripped (no sourceMetadata, no adminNote)
 *   - 200 with trial-active free workspace (computeEffectiveTier promotes to growth)
 *
 * Port: 13330 (verified free as of 2026-04-29; extends range to 13330)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import {
  upsertBriefingDraft,
  markPublished,
  markSkipped,
} from '../../server/briefing-store.js';
import { updateWorkspace } from '../../server/workspaces.js';
import { randomUUID } from 'crypto';
import type { BriefingStory, BriefingSourceMetadata } from '../../shared/types/briefing.js';

const ctx = createTestContext(13330); // port-ok: verified free; extends range to 13330
const { api } = ctx;

// Workspace IDs — assigned in beforeAll
let paidWsId = '';
let freeWsId = '';
let trialWsId = '';
let disabledPortalWsId = '';
const cleanups: Array<() => void> = [];

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStory(isHeadline: boolean): BriefingStory {
  return {
    id: randomUUID(),
    category: 'win',
    isHeadline,
    headline: 'Traffic rose 12% this week',
    narrative: 'Your top pages drove a sustained increase in organic visits.',
    metrics: [{ value: '+12%', label: 'organic traffic' }],
    drillIn: { page: 'performance' },
    sourceRefs: [{ type: 'analytics_insight', id: randomUUID() }],
  };
}

function makeStories(n: number): BriefingStory[] {
  return Array.from({ length: n }, (_, i) => makeStory(i === 0));
}

function adminMetadata(): BriefingSourceMetadata {
  return {
    candidateCount: 8,
    model: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    generationMs: 4_321,
  };
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await ctx.startServer();

  const paid = seedWorkspace({ tier: 'growth', clientPassword: '' });
  paidWsId = paid.workspaceId;
  cleanups.push(paid.cleanup);

  const free = seedWorkspace({ tier: 'free', clientPassword: '' });
  freeWsId = free.workspaceId;
  cleanups.push(free.cleanup);

  // Free tier WITH active trial — should be promoted to growth via computeEffectiveTier
  const trial = seedWorkspace({ tier: 'free', clientPassword: '' });
  trialWsId = trial.workspaceId;
  cleanups.push(trial.cleanup);
  const futureDate = new Date(Date.now() + 7 * 86_400_000).toISOString();
  updateWorkspace(trialWsId, { trialEndsAt: futureDate });

  // Paid tier with portal disabled
  const disabled = seedWorkspace({ tier: 'growth', clientPassword: '' });
  disabledPortalWsId = disabled.workspaceId;
  cleanups.push(disabled.cleanup);
  updateWorkspace(disabledPortalWsId, { clientPortalEnabled: false });
}, 30_000);

afterAll(() => {
  ctx.stopServer();
  for (const c of cleanups) c();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/public/briefing/:workspaceId — error paths', () => {
  it('returns 404 for an unknown workspace', async () => {
    const res = await api('/api/public/briefing/ws-does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns 403 when clientPortalEnabled is false', async () => {
    const res = await api(`/api/public/briefing/${disabledPortalWsId}`);
    expect(res.status).toBe(403);
  });

  it('returns 402 for a free-tier workspace with no active trial', async () => {
    const res = await api(`/api/public/briefing/${freeWsId}`);
    expect(res.status).toBe(402);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Growth|Premium|tier/i);
  });
});

describe('GET /api/public/briefing/:workspaceId — paid tier, no published briefing', () => {
  it('returns 200 with briefing: null when no briefing has been published', async () => {
    const res = await api(`/api/public/briefing/${paidWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { briefing: unknown };
    expect(body.briefing).toBeNull();
  });

  it('still returns null when the only briefing is in draft status', async () => {
    upsertBriefingDraft({
      workspaceId: paidWsId,
      weekOf: '2026-04-13',
      stories: makeStories(3),
      sourceMetadata: adminMetadata(),
    });
    const res = await api(`/api/public/briefing/${paidWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { briefing: unknown };
    expect(body.briefing).toBeNull();
  });

  it('still returns null when the only briefing was skipped', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: paidWsId,
      weekOf: '2026-04-06',
      stories: makeStories(3),
      sourceMetadata: adminMetadata(),
    });
    markSkipped(paidWsId, draft.id, 'No material activity this week');
    const res = await api(`/api/public/briefing/${paidWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { briefing: unknown };
    expect(body.briefing).toBeNull();
  });
});

describe('GET /api/public/briefing/:workspaceId — paid tier, published briefing', () => {
  it('returns the latest published briefing with weekOf, publishedAt, and stories', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: paidWsId,
      weekOf: '2026-04-20',
      stories: makeStories(4),
      sourceMetadata: adminMetadata(),
    });
    markPublished(paidWsId, draft.id, { autoPublished: false });

    const res = await api(`/api/public/briefing/${paidWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { briefing: { weekOf: string; publishedAt: number; stories: unknown[] } | null };
    expect(body.briefing).not.toBeNull();
    expect(body.briefing!.weekOf).toBe('2026-04-20');
    expect(typeof body.briefing!.publishedAt).toBe('number');
    expect(body.briefing!.publishedAt).toBeGreaterThan(0);
    expect(Array.isArray(body.briefing!.stories)).toBe(true);
    expect(body.briefing!.stories.length).toBe(4);
  });

  it('strips admin-only fields (sourceMetadata, adminNote, status, id, workspaceId) from response', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: paidWsId,
      weekOf: '2026-04-27',
      stories: makeStories(3),
      sourceMetadata: adminMetadata(), // admin-only telemetry
    });
    markPublished(paidWsId, draft.id, {
      autoPublished: false,
      adminNote: 'Internal admin context — should NOT reach client',
    });

    const res = await api(`/api/public/briefing/${paidWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { briefing: Record<string, unknown> | null };
    expect(body.briefing).not.toBeNull();

    // Whitelist: response should ONLY contain weekOf, publishedAt, stories
    const keys = Object.keys(body.briefing!).sort();
    expect(keys).toEqual(['publishedAt', 'stories', 'weekOf']);

    // Explicit blacklist (defense in depth)
    expect(body.briefing).not.toHaveProperty('sourceMetadata');
    expect(body.briefing).not.toHaveProperty('adminNote');
    expect(body.briefing).not.toHaveProperty('id');
    expect(body.briefing).not.toHaveProperty('workspaceId');
    expect(body.briefing).not.toHaveProperty('status');
    expect(body.briefing).not.toHaveProperty('autoPublished');
    expect(body.briefing).not.toHaveProperty('createdAt');
    expect(body.briefing).not.toHaveProperty('updatedAt');
  });

  it('returns the most recently published briefing when multiple are published', async () => {
    // 2026-04-20 was published earlier in the suite; publish 2026-04-27 too.
    // Latest should win.
    const res = await api(`/api/public/briefing/${paidWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { briefing: { weekOf: string } | null };
    expect(body.briefing).not.toBeNull();
    expect(body.briefing!.weekOf).toBe('2026-04-27');
  });
});

describe('GET /api/public/briefing/:workspaceId — trial promotion', () => {
  it('treats free-tier workspaces with active trials as growth (returns briefing instead of 402)', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: trialWsId,
      weekOf: '2026-04-13',
      stories: makeStories(3),
      sourceMetadata: adminMetadata(),
    });
    markPublished(trialWsId, draft.id, { autoPublished: false });

    const res = await api(`/api/public/briefing/${trialWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { briefing: { weekOf: string } | null };
    expect(body.briefing).not.toBeNull();
    expect(body.briefing!.weekOf).toBe('2026-04-13');
  });

  it('reverts to 402 when the trial has expired', async () => {
    // Set the trial end to the past
    const pastDate = new Date(Date.now() - 86_400_000).toISOString();
    updateWorkspace(trialWsId, { trialEndsAt: pastDate });

    const res = await api(`/api/public/briefing/${trialWsId}`);
    expect(res.status).toBe(402);
  });
});

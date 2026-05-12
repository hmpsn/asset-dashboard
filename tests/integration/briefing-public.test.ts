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
import { replaceAllContentGaps, deleteAllContentGaps } from '../../server/content-gaps.js';
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
    model: 'claude-sonnet-4-6',
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

afterAll(async () => {
  await ctx.stopServer();
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

    // Whitelist: response should ONLY contain the public-shape fields.
    // Phase 2.5b added issueSummary, issueNumber, and recommendations
    // (all derived at serve time from existing data — no admin fields leak).
    const keys = Object.keys(body.briefing!).sort();
    expect(keys).toEqual([
      'issueNumber',
      'issueSummary',
      'publishedAt',
      'recommendations',
      'stories',
      'weekOf',
    ]);

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

  // Phase 2.5e weeklyOpener tests live in their own describe block below
  // so they can use a dedicated workspace — otherwise their weekOf values
  // (later than 2026-04-27) would win the "most recently published" query
  // and break the assertion at line 282.

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

// ── Phase 2.5b — issueSummary, issueNumber, recommendations ───────────────
//
// The endpoint computes these three fields at serve time from existing data
// (no DB schema change). Verifies that:
//   - issueSummary is a non-empty string composed deterministically from the
//     story composition (lead + risk count + recommendation count).
//   - issueNumber is 1-indexed and reflects the count of published briefings
//     ≤ this one's published_at — so older briefings don't accidentally show
//     a higher number than newer ones.
//   - recommendations is an array (possibly empty) of BriefingRecommendation
//     shape, sorted by opportunityScore desc, capped at 5.
describe('GET /api/public/briefing/:workspaceId — Phase 2.5b serve-time fields', () => {
  let summaryWsId = '';
  const localCleanups: Array<() => void> = [];

  beforeAll(() => {
    const ws = seedWorkspace({ tier: 'growth', clientPassword: '' });
    summaryWsId = ws.workspaceId;
    localCleanups.push(ws.cleanup);
  });

  afterAll(() => {
    for (const c of localCleanups) c();
  });

  it('populates issueSummary as a non-empty string ending in a period', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: summaryWsId,
      weekOf: '2026-04-06',
      stories: makeStories(3), // 1 headline win + 2 secondary wins
      sourceMetadata: adminMetadata(),
    });
    markPublished(summaryWsId, draft.id, { autoPublished: false });

    const res = await api(`/api/public/briefing/${summaryWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      briefing: { issueSummary?: string } | null;
    };
    expect(body.briefing).not.toBeNull();
    expect(typeof body.briefing!.issueSummary).toBe('string');
    expect(body.briefing!.issueSummary!.length).toBeGreaterThan(0);
    expect(body.briefing!.issueSummary!.endsWith('.')).toBe(true);
    // Lead phrase keys off the headline story's category (win).
    expect(body.briefing!.issueSummary).toContain('A win at the top');
  });

  it('issueNumber is 1 for the first published briefing in a workspace', async () => {
    // summaryWsId published one briefing in the previous test → issueNumber=1
    const res = await api(`/api/public/briefing/${summaryWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { briefing: { issueNumber?: number } | null };
    expect(body.briefing!.issueNumber).toBe(1);
  });

  it('issueNumber increments for each subsequent published briefing', async () => {
    // Publish a second briefing (more recent weekOf wins by default)
    const draft = upsertBriefingDraft({
      workspaceId: summaryWsId,
      weekOf: '2026-04-13',
      stories: makeStories(2),
      sourceMetadata: adminMetadata(),
    });
    markPublished(summaryWsId, draft.id, { autoPublished: false });

    const res = await api(`/api/public/briefing/${summaryWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { briefing: { issueNumber?: number; weekOf: string } | null };
    expect(body.briefing!.weekOf).toBe('2026-04-13');
    expect(body.briefing!.issueNumber).toBe(2);
  });

  it('recommendations is an empty array when the workspace has no contentGaps', async () => {
    const res = await api(`/api/public/briefing/${summaryWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      briefing: { recommendations?: unknown[] } | null;
    };
    expect(Array.isArray(body.briefing!.recommendations)).toBe(true);
    expect(body.briefing!.recommendations!.length).toBe(0);
  });

  it('recommendations is sorted by opportunityScore desc and capped at 5', async () => {
    // Inject 7 content gaps; 2 should be dropped from the response.
    // contentGaps live in the content_gaps table (post-#365 normalization).
    replaceAllContentGaps(summaryWsId, [
      { topic: 'Topic A', targetKeyword: 'kw a', intent: 'informational', priority: 'high', rationale: 'r', opportunityScore: 10 },
      { topic: 'Topic B', targetKeyword: 'kw b', intent: 'informational', priority: 'high', rationale: 'r', opportunityScore: 90 },
      { topic: 'Topic C', targetKeyword: 'kw c', intent: 'informational', priority: 'high', rationale: 'r', opportunityScore: 50 },
      { topic: 'Topic D', targetKeyword: 'kw d', intent: 'informational', priority: 'high', rationale: 'r', opportunityScore: 70 },
      { topic: 'Topic E', targetKeyword: 'kw e', intent: 'informational', priority: 'high', rationale: 'r', opportunityScore: 30 },
      { topic: 'Topic F', targetKeyword: 'kw f', intent: 'informational', priority: 'high', rationale: 'r', opportunityScore: 80 },
      { topic: 'Topic G', targetKeyword: 'kw g', intent: 'informational', priority: 'high', rationale: 'r', opportunityScore: 20 },
    ]);

    const res = await api(`/api/public/briefing/${summaryWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      briefing: { recommendations?: { topic: string; opportunityScore?: number }[] } | null;
    };
    const recs = body.briefing!.recommendations!;
    expect(recs.length).toBe(5);
    // Verify sort order: B(90), F(80), D(70), C(50), E(30)
    expect(recs.map((r) => r.topic)).toEqual([
      'Topic B', 'Topic F', 'Topic D', 'Topic C', 'Topic E',
    ]);
  });

  it('issueSummary reflects the FULL recommendation pool, not the post-cap render set', async () => {
    // Previous test injected 7 gaps. The recommendations array is capped at 5
    // for rendering, but the summary's "N opportunities" must still reflect
    // the full pool (otherwise it understates what's available). 7 gaps were
    // injected in the prior test case.
    const res = await api(`/api/public/briefing/${summaryWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { briefing: { issueSummary?: string } | null };
    expect(body.briefing!.issueSummary).toContain('7 opportunities to consider');
  });

  it('computes opportunityScore on-the-fly when the stored value is null', async () => {
    // Replace gaps with one that has data but no precomputed opportunityScore.
    updateWorkspace(summaryWsId, {
      keywordStrategy: {
        siteKeywords: [],
        opportunities: [],
        contentGaps: [
          {
            topic: 'Live-scored topic',
            targetKeyword: 'kw live',
            intent: 'informational',
            priority: 'high',
            rationale: 'r',
            volume: 5000,
            difficulty: 30,
            // opportunityScore intentionally omitted
          },
        ],
      },
    });

    const res = await api(`/api/public/briefing/${summaryWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      briefing: { recommendations?: { opportunityScore?: number }[] } | null;
    };
    const score = body.briefing!.recommendations![0]?.opportunityScore;
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ── Phase 2.5e — weeklyOpener serialization ────────────────────────────────

describe('GET /api/public/briefing/:workspaceId — Phase 2.5e weeklyOpener', () => {
  let aiWsId = '';
  const localCleanups: Array<() => void> = [];

  beforeAll(() => {
    const ws = seedWorkspace({ tier: 'premium', clientPassword: '' });
    aiWsId = ws.workspaceId;
    localCleanups.push(ws.cleanup);
  });

  afterAll(() => {
    for (const c of localCleanups) c();
  });

  it('exposes weeklyOpener but strips originalHeroHeadline + aiMs from sourceMetadata.aiPolish', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: aiWsId,
      weekOf: '2026-04-20',
      stories: makeStories(3),
      sourceMetadata: {
        ...adminMetadata(),
        // Full aiPolish blob — only `weeklyOpener` should cross the public boundary.
        aiPolish: {
          weeklyOpener: 'A consolidation week with 945 monthly impressions in play.',
          originalHeroHeadline: 'Pre-punch deterministic headline that should NOT reach client',
          aiMs: 1234,
        },
      },
    });
    markPublished(aiWsId, draft.id, { autoPublished: false });

    const res = await api(`/api/public/briefing/${aiWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { briefing: Record<string, unknown> | null };
    expect(body.briefing).not.toBeNull();

    // Whitelist: weeklyOpener appears alongside the existing public fields.
    const keys = Object.keys(body.briefing!).sort();
    expect(keys).toEqual([
      'issueNumber',
      'issueSummary',
      'publishedAt',
      'recommendations',
      'stories',
      'weekOf',
      'weeklyOpener',
    ]);
    expect(body.briefing!.weeklyOpener).toBe('A consolidation week with 945 monthly impressions in play.');

    // Admin-only aiPolish sub-fields must NOT leak.
    const briefingStr = JSON.stringify(body.briefing);
    expect(briefingStr).not.toContain('Pre-punch deterministic headline');
    expect(briefingStr).not.toContain('originalHeroHeadline');
    expect(briefingStr).not.toContain('aiMs');
    expect(briefingStr).not.toContain('aiPolish');
  });

  it('omits weeklyOpener key entirely when sourceMetadata.aiPolish is absent (pre-2.5e drafts)', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: aiWsId,
      weekOf: '2026-04-27',
      stories: makeStories(2),
      sourceMetadata: adminMetadata(), // no aiPolish field
    });
    markPublished(aiWsId, draft.id, { autoPublished: false });

    const res = await api(`/api/public/briefing/${aiWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { briefing: Record<string, unknown> | null };
    expect(body.briefing).not.toBeNull();
    expect(body.briefing).not.toHaveProperty('weeklyOpener');
  });
});

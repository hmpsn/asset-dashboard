// tests/integration/briefing-client-preview.test.ts
// Verifies admin briefing preview returns the same payload as the public
// briefing endpoint (excluding auth/tier gates).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { upsertBriefingDraft, markPublished } from '../../server/briefing-store.js';
import { upsertContentGapsBatch } from '../../server/content-gaps.js';
import type { BriefingStory } from '../../shared/types/briefing.js';
import type { ContentGap } from '../../shared/types/workspace.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });

let ws: SeededFullWorkspace | null = null;

const testStories: BriefingStory[] = [
  {
    id: 'story-1',
    category: 'win',
    isHeadline: true,
    headline: 'Traffic up 12% this week',
    narrative: 'Organic traffic increased significantly across key landing pages.',
    metrics: [{ value: '+12%', label: 'traffic' }],
    drillIn: { page: 'performance' },
    sourceRefs: [{ type: 'analytics_insight', id: 'ins-1' }],
  },
  {
    id: 'story-2',
    category: 'opportunity',
    isHeadline: false,
    headline: 'New keyword opportunity found',
    narrative: 'A rising keyword in your niche has low competition.',
    metrics: [],
    drillIn: { page: 'strategy' },
    sourceRefs: [{ type: 'recommendation', id: 'rec-1' }],
  },
  {
    id: 'story-3',
    category: 'risk',
    isHeadline: false,
    headline: 'Core Web Vitals dip on mobile',
    narrative: 'LCP regressed on 3 pages after the latest deploy.',
    metrics: [{ value: '3.2s', label: 'LCP' }],
    drillIn: { page: 'health' },
    sourceRefs: [{ type: 'audit_delta', id: 'delta-1' }],
  },
];

const testGaps: ContentGap[] = [
  {
    topic: 'Local SEO',
    targetKeyword: 'local seo services',
    intent: 'commercial',
    priority: 'high',
    rationale: 'High local demand',
    volume: 500,
    difficulty: 30,
  },
  {
    topic: 'Technical SEO',
    targetKeyword: 'technical seo audit',
    intent: 'informational',
    priority: 'medium',
    rationale: 'Rising interest',
    volume: 200,
    difficulty: 45,
  },
];

beforeAll(async () => {
  await ctx.startServer();
  // Need a paid workspace since the public endpoint is tier-gated.
  // clientPassword must be empty so /api/public/ routes bypass session enforcement.
  ws = seedWorkspace({ tier: 'growth', clientPassword: '' });

  // Seed a published briefing
  const draft = upsertBriefingDraft({
    workspaceId: ws.workspaceId,
    weekOf: '2026-05-25',
    stories: testStories,
    sourceMetadata: {
      candidateCount: 5,
      model: 'test-model',
      provider: 'openai',
      generationMs: 100,
      aiPolish: { weeklyOpener: 'A strong week for organic growth.' },
    },
  });
  markPublished(ws.workspaceId, draft.id, { autoPublished: false });

  // Seed content gaps for recommendations
  upsertContentGapsBatch(ws.workspaceId, testGaps);
});

afterAll(async () => {
  ws?.cleanup();
  await ctx.stopServer();
});

describe('Briefing client preview parity', () => {
  it('admin preview returns the same payload as the public endpoint', async () => {
    const [adminRes, publicRes] = await Promise.all([
      ctx.api(`/api/briefing/${ws!.workspaceId}/preview`),
      ctx.api(`/api/public/briefing/${ws!.workspaceId}`),
    ]);

    expect(adminRes.status).toBe(200);
    expect(publicRes.status).toBe(200);

    const adminBody = await adminRes.json();
    const publicBody = await publicRes.json();

    // Both should have a non-null briefing
    expect(adminBody.briefing).not.toBeNull();
    expect(publicBody.briefing).not.toBeNull();

    // Core fields must match exactly
    expect(adminBody.briefing.weekOf).toBe(publicBody.briefing.weekOf);
    expect(adminBody.briefing.issueNumber).toBe(publicBody.briefing.issueNumber);
    expect(adminBody.briefing.issueSummary).toBe(publicBody.briefing.issueSummary);
    expect(adminBody.briefing.weeklyOpener).toBe(publicBody.briefing.weeklyOpener);
    expect(adminBody.briefing.stories).toEqual(publicBody.briefing.stories);
    expect(adminBody.briefing.recommendations).toEqual(publicBody.briefing.recommendations);

    // publishedAt — both present, may differ by a few ms if read at slightly
    // different times but in practice should be identical (same DB row).
    expect(adminBody.briefing.publishedAt).toBe(publicBody.briefing.publishedAt);
  });

  it('admin preview returns null when no briefing is published', async () => {
    const emptyWs = seedWorkspace({ tier: 'growth' });
    try {
      const res = await ctx.api(`/api/briefing/${emptyWs.workspaceId}/preview`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.briefing).toBeNull();
    } finally {
      emptyWs.cleanup();
    }
  });

  it('admin preview includes recommendations from content gaps', async () => {
    const res = await ctx.api(`/api/briefing/${ws!.workspaceId}/preview`);
    const body = await res.json();

    expect(body.briefing.recommendations.length).toBeGreaterThanOrEqual(1);
    expect(body.briefing.recommendations.length).toBeLessThanOrEqual(5);

    // Verify the seeded gaps show up
    const keywords = body.briefing.recommendations.map((r: { targetKeyword: string }) => r.targetKeyword);
    expect(keywords).toContain('local seo services');
  });

  it('public endpoint returns 402 for free tier', async () => {
    const freeWs = seedWorkspace({ tier: 'free', clientPassword: '' });
    try {
      const res = await ctx.api(`/api/public/briefing/${freeWs.workspaceId}`);
      expect(res.status).toBe(402);
    } finally {
      freeWs.cleanup();
    }
  });

  it('admin preview has no tier gate (works for free tier workspace)', async () => {
    const freeWs = seedWorkspace({ tier: 'free', clientPassword: '' });
    try {
      const res = await ctx.api(`/api/briefing/${freeWs.workspaceId}/preview`);
      // Should succeed (200), not 402 — admin preview is not tier-gated
      expect(res.status).toBe(200);
      const body = await res.json();
      // No published briefing for this ws, so null
      expect(body.briefing).toBeNull();
    } finally {
      freeWs.cleanup();
    }
  });
});

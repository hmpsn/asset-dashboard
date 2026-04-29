/**
 * Integration test for the briefing-slice integration in workspace intelligence.
 *
 * Verifies T2.1: assembleClientSignals reads getLatestPublishedBriefing and
 * surfaces the most recent published briefing as a BriefingSummary on
 * ClientSignalsSlice.latestBriefing. Three states covered:
 *   1. Workspace with no drafts → latestBriefing === null
 *   2. Workspace with only draft (un-published) → latestBriefing === null
 *   3. Workspace with one published briefing → latestBriefing matches the publish
 *
 * Port: 13331 (verified free as of 2026-04-29 — extends range past 13330)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { upsertBriefingDraft, markPublished, markSkipped } from '../../server/briefing-store.js';
import type { BriefingStory } from '../../shared/types/briefing.js';

const ctx = createTestContext(13331); // port-ok: verified free; extends range to 13331

function story(id: string, isHeadline = false): BriefingStory {
  return {
    id,
    category: 'win',
    isHeadline,
    headline: `Test headline ${id}`,
    narrative: 'Narrative.',
    metrics: [],
    drillIn: { page: 'performance' },
    sourceRefs: [],
  };
}

describe('assembleClientSignals — latestBriefing field', () => {
  let cleanupFns: Array<() => void> = [];

  beforeAll(async () => {
    await ctx.startServer();
  });

  afterAll(() => {
    // Wrap each cleanup so an early throw can't orphan the spawned test
    // server (same orphan-server feedback loop fixed in PR #374).
    for (const fn of cleanupFns) {
      try { fn(); } catch (err) { console.error('cleanup failed', err); }
    }
    ctx.stopServer();
  });

  it('returns latestBriefing=null when workspace has no briefings', async () => {
    const ws = seedWorkspace({ tier: 'growth' });
    cleanupFns.push(ws.cleanup);

    const { buildWorkspaceIntelligence } = await import('../../server/workspace-intelligence.js');
    const intel = await buildWorkspaceIntelligence(ws.workspaceId, {
      slices: ['clientSignals'] as const,
    });
    expect(intel.clientSignals?.latestBriefing).toBeNull();
  });

  it('returns latestBriefing=null when only a draft exists (un-published)', async () => {
    const ws = seedWorkspace({ tier: 'growth' });
    cleanupFns.push(ws.cleanup);

    upsertBriefingDraft({
      workspaceId: ws.workspaceId,
      weekOf: '2026-04-27',
      stories: [story('s1', true), story('s2'), story('s3')],
      sourceMetadata: { candidateCount: 3, model: 'test', provider: 'anthropic', generationMs: 0 },
    });

    const { buildWorkspaceIntelligence } = await import('../../server/workspace-intelligence.js');
    const intel = await buildWorkspaceIntelligence(ws.workspaceId, {
      slices: ['clientSignals'] as const,
    });
    expect(intel.clientSignals?.latestBriefing).toBeNull();
  });

  it('returns BriefingSummary matching the latest published briefing', async () => {
    const ws = seedWorkspace({ tier: 'growth' });
    cleanupFns.push(ws.cleanup);

    const draft = upsertBriefingDraft({
      workspaceId: ws.workspaceId,
      weekOf: '2026-04-27',
      stories: [story('s1', true), story('s2'), story('s3'), story('s4')],
      sourceMetadata: { candidateCount: 4, model: 'test', provider: 'anthropic', generationMs: 0 },
    });
    const published = markPublished(ws.workspaceId, draft.id, { autoPublished: false });
    expect(published).not.toBeNull();

    const { buildWorkspaceIntelligence } = await import('../../server/workspace-intelligence.js');
    const intel = await buildWorkspaceIntelligence(ws.workspaceId, {
      slices: ['clientSignals'] as const,
    });
    expect(intel.clientSignals?.latestBriefing).toEqual({
      weekOf: '2026-04-27',
      publishedAt: published!.publishedAt,
      storyCount: 4,
      hasHero: true,
    });
  });

  it('treats `skipped` status as not published — latestBriefing stays null', async () => {
    const ws = seedWorkspace({ tier: 'growth' });
    cleanupFns.push(ws.cleanup);

    const draft = upsertBriefingDraft({
      workspaceId: ws.workspaceId,
      weekOf: '2026-04-27',
      stories: [story('s1', true), story('s2'), story('s3')],
      sourceMetadata: { candidateCount: 3, model: 'test', provider: 'anthropic', generationMs: 0 },
    });
    const skipped = markSkipped(ws.workspaceId, draft.id, 'no material this week');
    expect(skipped?.status).toBe('skipped');

    const { buildWorkspaceIntelligence } = await import('../../server/workspace-intelligence.js');
    const intel = await buildWorkspaceIntelligence(ws.workspaceId, {
      slices: ['clientSignals'] as const,
    });
    expect(intel.clientSignals?.latestBriefing).toBeNull();
  });

  it('returns the most recent published briefing when multiple exist', async () => {
    const ws = seedWorkspace({ tier: 'growth' });
    cleanupFns.push(ws.cleanup);

    // Older briefing
    const older = upsertBriefingDraft({
      workspaceId: ws.workspaceId,
      weekOf: '2026-04-20',
      stories: [story('s1', true), story('s2'), story('s3')],
      sourceMetadata: { candidateCount: 3, model: 'test', provider: 'anthropic', generationMs: 0 },
    });
    markPublished(ws.workspaceId, older.id, { autoPublished: false });

    // Tiny delay to ensure a strictly-greater publishedAt timestamp.
    await new Promise((r) => setTimeout(r, 5));

    // Newer briefing
    const newer = upsertBriefingDraft({
      workspaceId: ws.workspaceId,
      weekOf: '2026-04-27',
      stories: [story('s1', true), story('s2'), story('s3'), story('s4')],
      sourceMetadata: { candidateCount: 4, model: 'test', provider: 'anthropic', generationMs: 0 },
    });
    const newerPublished = markPublished(ws.workspaceId, newer.id, { autoPublished: false });

    const { buildWorkspaceIntelligence } = await import('../../server/workspace-intelligence.js');
    const intel = await buildWorkspaceIntelligence(ws.workspaceId, {
      slices: ['clientSignals'] as const,
    });
    expect(intel.clientSignals?.latestBriefing?.weekOf).toBe('2026-04-27');
    expect(intel.clientSignals?.latestBriefing?.publishedAt).toBe(newerPublished!.publishedAt);
    expect(intel.clientSignals?.latestBriefing?.storyCount).toBe(4);
  });

  it('does not leak briefings across workspaces', async () => {
    const wsA = seedWorkspace({ tier: 'growth' });
    const wsB = seedWorkspace({ tier: 'growth' });
    cleanupFns.push(wsA.cleanup, wsB.cleanup);

    // Only wsA has a published briefing.
    const draft = upsertBriefingDraft({
      workspaceId: wsA.workspaceId,
      weekOf: '2026-04-27',
      stories: [story('s1', true), story('s2'), story('s3')],
      sourceMetadata: { candidateCount: 3, model: 'test', provider: 'anthropic', generationMs: 0 },
    });
    markPublished(wsA.workspaceId, draft.id, { autoPublished: false });

    const { buildWorkspaceIntelligence } = await import('../../server/workspace-intelligence.js');
    const intelA = await buildWorkspaceIntelligence(wsA.workspaceId, { slices: ['clientSignals'] as const });
    const intelB = await buildWorkspaceIntelligence(wsB.workspaceId, { slices: ['clientSignals'] as const });

    expect(intelA.clientSignals?.latestBriefing).not.toBeNull();
    expect(intelB.clientSignals?.latestBriefing).toBeNull();
  });
});

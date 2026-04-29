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
import { upsertBriefingDraft, markPublished } from '../../server/briefing-store.js';
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
    for (const fn of cleanupFns) fn();
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
});

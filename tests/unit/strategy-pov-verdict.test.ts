import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import db from '../../server/db/index.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { computeRecommendationSummary, saveRecommendations } from '../../server/recommendations.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

const mocks = vi.hoisted(() => ({
  broadcastToWorkspace: vi.fn(),
  buildSystemPrompt: vi.fn(),
  buildWorkspaceIntelligence: vi.fn(),
  callNarrativeAI: vi.fn(),
  getCustomPromptNotes: vi.fn(),
  withActiveLocalSeoSlice: vi.fn(),
}));

vi.mock('../../server/broadcast.js', () => ({
  broadcast: vi.fn(),
  broadcastToWorkspace: mocks.broadcastToWorkspace,
  setBroadcast: vi.fn(),
}));

vi.mock('../../server/intelligence/generation-context-builders.js', () => ({
  withActiveLocalSeoSlice: mocks.withActiveLocalSeoSlice,
}));

vi.mock('../../server/narrative-ai.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/narrative-ai.js')>();
  return {
    ...actual,
    callNarrativeAI: mocks.callNarrativeAI,
  };
});

vi.mock('../../server/prompt-assembly.js', () => ({
  buildSystemPrompt: mocks.buildSystemPrompt,
  getCustomPromptNotes: mocks.getCustomPromptNotes,
}));

vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: mocks.buildWorkspaceIntelligence,
}));

import { generateStrategyPov } from '../../server/strategy-pov-generator.js';
import { getStrategyPov } from '../../server/strategy-pov-store.js';

const GENERATED_AT = '2026-07-01T00:00:00.000Z';

function makeRecommendation(workspaceId: string, overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: 'rec-verdict',
    workspaceId,
    priority: 'fix_now',
    type: 'content',
    title: 'Publish the pricing comparison page',
    description: 'Create a pricing page for high-intent searches.',
    insight: 'Searchers are reaching comparison queries without a page that can convert them.',
    impact: 'high',
    effort: 'low',
    impactScore: 88,
    source: 'test',
    affectedPages: ['/pricing'],
    trafficAtRisk: 0,
    impressionsAtRisk: 0,
    estimatedGain: 'More qualified pricing traffic',
    actionType: 'manual',
    status: 'pending',
    clientStatus: 'curated',
    lifecycle: 'active',
    targetKeyword: 'emergency dentist pricing',
    createdAt: GENERATED_AT,
    updatedAt: GENERATED_AT,
    ...overrides,
  };
}

function saveRecSet(workspaceId: string): void {
  const recommendations = [makeRecommendation(workspaceId)];
  const set: RecommendationSet = {
    workspaceId,
    generatedAt: GENERATED_AT,
    recommendations,
    summary: computeRecommendationSummary(recommendations),
  };
  saveRecommendations(set);
}

describe('strategy POV verdict headline', () => {
  let seeded: SeededFullWorkspace | undefined;

  beforeEach(() => {
    seeded = seedWorkspace();
    vi.clearAllMocks();

    mocks.withActiveLocalSeoSlice.mockResolvedValue(['seoContext']);
    mocks.buildWorkspaceIntelligence.mockResolvedValue({
      version: 1,
      workspaceId: seeded.workspaceId,
      assembledAt: GENERATED_AT,
    });
    mocks.getCustomPromptNotes.mockReturnValue('');
    mocks.buildSystemPrompt.mockImplementation((_workspaceId: string, basePrompt: string) => basePrompt);
    mocks.callNarrativeAI.mockResolvedValue({
      situation: 'The site has a clear pricing-search opportunity.',
      leadSentence: 'Bring the pricing comparison page because it can capture qualified demand.',
      wins: ['Pricing queries already show demand.'],
      flags: ['The current path does not answer pricing intent directly.'],
      verdictHeadline: 'Pricing intent is ready to convert',
    });
  });

  afterEach(() => {
    if (!seeded) return;
    db.prepare('DELETE FROM strategy_pov WHERE workspace_id = ?').run(seeded.workspaceId);
    db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(seeded.workspaceId);
    seeded.cleanup();
    seeded = undefined;
  });

  it('drafts, stores, and reads back verdictHeadline from the parsed AI output', async () => {
    if (!seeded) throw new Error('missing seeded workspace');
    saveRecSet(seeded.workspaceId);

    const generated = await generateStrategyPov(seeded.workspaceId, {
      variant: 'admin',
      regenerateNonce: 'verdict-headline-test',
    });
    const persisted = getStrategyPov(seeded.workspaceId);
    const aiOptions = mocks.callNarrativeAI.mock.calls[0]?.[0] as { systemPrompt: string; prompt: string };

    expect(generated.verdictHeadline).toBe('Pricing intent is ready to convert');
    expect(persisted?.verdictHeadline).toBe('Pricing intent is ready to convert');
    expect(aiOptions.systemPrompt).toContain('draft a short admin verdict headline');
    expect(aiOptions.prompt).toContain('"verdictHeadline"');
    expect(mocks.callNarrativeAI).toHaveBeenCalledTimes(1);
  });

  it('reads legacy pov_json without verdictHeadline as an honest absent field', () => {
    if (!seeded) throw new Error('missing seeded workspace');
    const legacyPov = {
      situation: 'Legacy situation.',
      leadMoveRecId: null,
      leadSentence: 'Legacy lead sentence.',
      wins: ['Legacy win'],
      flags: ['Legacy flag'],
      version: 4,
      generatedAt: GENERATED_AT,
      editedAt: null,
    };

    db.prepare(`
      INSERT INTO strategy_pov
        (workspace_id, pov_json, prompt_hash, version, generated_at, edited_at)
      VALUES
        (?, ?, ?, ?, ?, ?)
    `).run(
      seeded.workspaceId,
      JSON.stringify(legacyPov),
      'legacy-hash',
      4,
      GENERATED_AT,
      null,
    );

    const persisted = getStrategyPov(seeded.workspaceId);

    expect(persisted).toMatchObject({
      situation: 'Legacy situation.',
      leadSentence: 'Legacy lead sentence.',
      version: 4,
      generatedAt: GENERATED_AT,
      editedAt: null,
    });
    expect(persisted?.verdictHeadline).toBeUndefined();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import db from '../../server/db/index.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { computeRecommendationSummary, saveRecommendations } from '../../server/recommendations.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';
import type { Attribution, TopWin } from '../../shared/types/outcome-tracking.js';

const mocks = vi.hoisted(() => ({
  broadcastToWorkspace: vi.fn(),
  buildSystemPrompt: vi.fn(),
  buildWorkspaceIntelligence: vi.fn(),
  callNarrativeAI: vi.fn(),
  getCustomPromptNotes: vi.fn(),
}));

vi.mock('../../server/broadcast.js', () => ({
  broadcast: vi.fn(),
  broadcastToWorkspace: mocks.broadcastToWorkspace,
  setBroadcast: vi.fn(),
}));

vi.mock('../../server/narrative-ai.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/narrative-ai.js')>();
  return { ...actual, callNarrativeAI: mocks.callNarrativeAI };
});

vi.mock('../../server/prompt-assembly.js', () => ({
  buildSystemPrompt: mocks.buildSystemPrompt,
  getCustomPromptNotes: mocks.getCustomPromptNotes,
}));

vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: mocks.buildWorkspaceIntelligence,
}));

import {
  buildStrategyPovHash,
  generateStrategyPov,
  getStrategyPovRefreshAvailable,
  POV_REFRESH_AVAILABLE,
  POV_UNCHANGED,
} from '../../server/strategy-pov-generator.js';
import {
  bumpStrategyPovVersion,
  getStrategyPov,
  getStrategyPovHash,
} from '../../server/strategy-pov-store.js';

const GENERATED_AT = '2026-07-01T00:00:00.000Z';
const EFFECTIVE_VOICE = 'BRAND VOICE PROFILE: write with calm, concrete confidence.';

const AI_OUTPUT = {
  situation: 'The site has a clear pricing-search opportunity.',
  leadSentence: 'Bring the pricing comparison page because it can capture qualified demand.',
  wins: ['Pricing queries already show demand.'],
  flags: ['The current path does not answer pricing intent directly.'],
  verdictHeadline: 'Pricing intent is ready to convert',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function topWin(
  actionId: string,
  attribution: Attribution,
  pageUrl: string,
  targetKeyword: string,
): TopWin {
  return {
    actionId,
    actionType: 'content_published',
    sourceType: 'post',
    sourceId: actionId,
    sourceLabel: `Source ${actionId}`,
    pageUrl,
    targetKeyword,
    delta: {
      primary_metric: 'clicks',
      baseline_value: 10,
      current_value: 20,
      delta_absolute: 10,
      delta_percent: 100,
      direction: 'improved',
    },
    score: 'win',
    attributedValue: 400,
    attribution,
    createdAt: GENERATED_AT,
    scoredAt: GENERATED_AT,
  };
}

function intelligence(siteScore = 81) {
  return {
    version: 1,
    workspaceId: 'unused-by-prompt',
    assembledAt: GENERATED_AT,
    seoContext: {
      strategy: { siteKeywords: ['emergency dentist pricing'] },
      brandVoice: '',
      effectiveBrandVoiceBlock: EFFECTIVE_VOICE,
      businessContext: '',
      personas: [],
      knowledgeBase: '',
      effectiveLocalSeoBlock: '',
      latestSnapshotAt: null,
    },
    siteHealth: { auditScore: siteScore },
    learnings: {
      availability: 'ready' as const,
      overallWinRate: 0.65,
      topWins: [topWin('action-platform', 'platform_executed', '/pricing', 'pricing')],
    },
    clientSignals: { effectiveBusinessPriorities: ['Grow qualified pricing traffic'] },
  };
}

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

describe('strategy POV effective-input freshness and edit safety', () => {
  let seeded: SeededFullWorkspace | undefined;

  beforeEach(() => {
    seeded = seedWorkspace();
    vi.clearAllMocks();
    mocks.buildWorkspaceIntelligence.mockResolvedValue(intelligence());
    mocks.getCustomPromptNotes.mockReturnValue('Prefer evidence over adjectives.');
    mocks.buildSystemPrompt.mockImplementation((_workspaceId: string, basePrompt: string, notes: string) => (
      `${basePrompt}\nCALIBRATED DNA: short declarative sentences.\nCUSTOM: ${notes}`
    ));
    mocks.callNarrativeAI.mockResolvedValue(AI_OUTPUT);
  });

  afterEach(() => {
    if (!seeded) return;
    db.prepare('DELETE FROM strategy_pov WHERE workspace_id = ?').run(seeded.workspaceId);
    db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(seeded.workspaceId);
    seeded.cleanup();
    seeded = undefined;
  });

  it('uses exactly four evidence slices, injects effective voice once, and persists the exact canonical prompt hash', async () => {
    if (!seeded) throw new Error('missing seeded workspace');
    saveRecSet(seeded.workspaceId);

    const generated = await generateStrategyPov(seeded.workspaceId, {
      variant: 'admin',
      regenerateNonce: 'force-only-not-hash-input',
    });
    const aiOptions = mocks.callNarrativeAI.mock.calls[0]?.[0] as { systemPrompt: string; prompt: string };

    expect(generated.verdictHeadline).toBe('Pricing intent is ready to convert');
    expect(mocks.buildWorkspaceIntelligence).toHaveBeenCalledWith(seeded.workspaceId, {
      slices: ['seoContext', 'learnings', 'siteHealth', 'clientSignals'],
    });
    expect(aiOptions.prompt.split(EFFECTIVE_VOICE)).toHaveLength(2);
    expect(aiOptions.systemPrompt).not.toContain(EFFECTIVE_VOICE);
    expect(aiOptions.systemPrompt).toContain('CUSTOM: Prefer evidence over adjectives.');
    expect(aiOptions.prompt).toContain('Site health score: 81');
    expect(aiOptions.prompt).toContain('Overall win rate: 65%');
    expect(aiOptions.prompt).toContain('Strategy focus: emergency dentist pricing');
    expect(aiOptions.prompt).toContain('Client priorities: Grow qualified pricing traffic');
    expect(aiOptions.prompt).toContain('content_published on /pricing (pricing)');
    expect(aiOptions.prompt).toContain('Publish the pricing comparison page');
    expect(getStrategyPovHash(seeded.workspaceId)).toBe(
      buildStrategyPovHash(aiOptions.systemPrompt, aiOptions.prompt, 'admin'),
    );
  });

  it('stores a canonical nonce-free hash so a normal generate after forced regeneration is unchanged', async () => {
    if (!seeded) throw new Error('missing seeded workspace');
    saveRecSet(seeded.workspaceId);

    await generateStrategyPov(seeded.workspaceId, { variant: 'admin', regenerateNonce: 'nonce-a' });
    await expect(generateStrategyPov(seeded.workspaceId, { variant: 'admin' }))
      .rejects.toThrow(POV_UNCHANGED);
    expect(mocks.callNarrativeAI).toHaveBeenCalledTimes(1);
    expect(await getStrategyPovRefreshAvailable(seeded.workspaceId, 'admin')).toBe(false);
  });

  it('treats unavailable learnings as unavailable, exposes no workspace wins, and cannot persist invented wins', async () => {
    if (!seeded) throw new Error('missing seeded workspace');
    saveRecSet(seeded.workspaceId);
    mocks.buildWorkspaceIntelligence.mockResolvedValue({
      ...intelligence(),
      learnings: {
        availability: 'no_data',
        overallWinRate: 0,
        topWins: [topWin('unverified-sentinel', 'not_acted_on', '/unverified', 'unverified query')],
      },
    });

    const generated = await generateStrategyPov(seeded.workspaceId, {
      variant: 'admin',
      regenerateNonce: 'no-data',
    });
    const prompt = (mocks.callNarrativeAI.mock.calls[0]?.[0] as { prompt: string }).prompt;

    expect(prompt).toContain('Overall win rate: unavailable');
    expect(prompt).not.toContain('Overall win rate: 0%');
    expect(prompt).toContain('TRACKED OUTCOMES:');
    expect(prompt).not.toContain('RECENT WINS:');
    expect(prompt).not.toContain('unverified-sentinel');
    expect(prompt).toMatch(/wins.*may be empty/i);
    expect(prompt).toMatch(/never invent/i);
    expect(generated.wins).toEqual([]);
  });

  it('preserves execution attribution in tracked outcomes and defensively removes not-acted-on proposals', async () => {
    if (!seeded) throw new Error('missing seeded workspace');
    saveRecSet(seeded.workspaceId);
    mocks.buildWorkspaceIntelligence.mockResolvedValue({
      ...intelligence(),
      learnings: {
        availability: 'ready',
        overallWinRate: 0.5,
        topWins: [
          topWin('platform-sentinel', 'platform_executed', '/platform-win', 'platform query'),
          topWin('external-sentinel', 'externally_executed', '/external-win', 'external query'),
          topWin('proposal-sentinel', 'not_acted_on', '/proposal', 'proposal query'),
        ],
      },
    });

    await generateStrategyPov(seeded.workspaceId, {
      variant: 'admin',
      regenerateNonce: 'attribution',
    });
    const prompt = (mocks.callNarrativeAI.mock.calls[0]?.[0] as { prompt: string }).prompt;

    expect(prompt).toContain('TRACKED OUTCOMES:');
    expect(prompt).not.toContain('RECENT WINS:');
    expect(prompt).toContain('Platform executed:');
    expect(prompt).toContain('/platform-win');
    expect(prompt).toContain('Externally executed by the client or another team');
    expect(prompt).toContain('/external-win');
    expect(prompt).toMatch(/do not claim we shipped/i);
    expect(prompt).not.toContain('proposal-sentinel');
    expect(prompt).not.toContain('/proposal');
  });

  it('shares one in-flight normal generation for the same workspace and variant', async () => {
    if (!seeded) throw new Error('missing seeded workspace');
    saveRecSet(seeded.workspaceId);
    const ai = deferred<typeof AI_OUTPUT>();
    mocks.callNarrativeAI.mockReset();
    mocks.callNarrativeAI.mockImplementation(() => ai.promise);

    const first = generateStrategyPov(seeded.workspaceId, { variant: 'admin' });
    await vi.waitFor(() => expect(mocks.callNarrativeAI).toHaveBeenCalledTimes(1));
    const second = generateStrategyPov(seeded.workspaceId, { variant: 'admin' });
    ai.resolve(AI_OUTPUT);
    const results = await Promise.allSettled([first, second]);

    expect(mocks.callNarrativeAI).toHaveBeenCalledTimes(1);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
    if (results[0].status === 'fulfilled' && results[1].status === 'fulfilled') {
      expect(results[1].value).toEqual(results[0].value);
    }
  });

  it('shares one in-flight force generation for the same workspace and variant', async () => {
    if (!seeded) throw new Error('missing seeded workspace');
    saveRecSet(seeded.workspaceId);
    await generateStrategyPov(seeded.workspaceId, { variant: 'admin', regenerateNonce: 'initial' });
    const ai = deferred<typeof AI_OUTPUT>();
    mocks.callNarrativeAI.mockReset();
    mocks.callNarrativeAI.mockImplementation(() => ai.promise);

    const first = generateStrategyPov(seeded.workspaceId, { variant: 'admin', regenerateNonce: 'force-a' });
    await vi.waitFor(() => expect(mocks.callNarrativeAI).toHaveBeenCalledTimes(1));
    const second = generateStrategyPov(seeded.workspaceId, { variant: 'admin', regenerateNonce: 'force-b' });
    ai.resolve(AI_OUTPUT);
    const results = await Promise.allSettled([first, second]);

    expect(mocks.callNarrativeAI).toHaveBeenCalledTimes(1);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
    if (results[0].status === 'fulfilled' && results[1].status === 'fulfilled') {
      expect(results[1].value).toEqual(results[0].value);
    }
  });

  it('queues a force request behind a normal generation and preserves force replacement authority', async () => {
    if (!seeded) throw new Error('missing seeded workspace');
    saveRecSet(seeded.workspaceId);
    const normalAi = deferred<typeof AI_OUTPUT>();
    const forcedOutput = { ...AI_OUTPUT, situation: 'Forced result must be the final authority.' };
    mocks.callNarrativeAI.mockReset();
    mocks.callNarrativeAI
      .mockImplementationOnce(() => normalAi.promise)
      .mockResolvedValueOnce(forcedOutput);

    const normal = generateStrategyPov(seeded.workspaceId, { variant: 'admin' });
    await vi.waitFor(() => expect(mocks.callNarrativeAI).toHaveBeenCalledTimes(1));
    const force = generateStrategyPov(seeded.workspaceId, { variant: 'admin', regenerateNonce: 'force-behind-normal' });
    normalAi.resolve(AI_OUTPUT);
    const results = await Promise.allSettled([normal, force]);

    expect(mocks.callNarrativeAI).toHaveBeenCalledTimes(2);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
    if (results[1].status === 'fulfilled') {
      expect(results[1].value.situation).toBe(forcedOutput.situation);
    }
    expect(getStrategyPov(seeded.workspaceId)?.situation).toBe(forcedOutput.situation);
  });

  it('marks changed evidence as refresh-available and normal generation preserves an operator edit without calling AI', async () => {
    if (!seeded) throw new Error('missing seeded workspace');
    saveRecSet(seeded.workspaceId);
    await generateStrategyPov(seeded.workspaceId, { variant: 'admin', regenerateNonce: 'initial' });
    bumpStrategyPovVersion(seeded.workspaceId, { situation: 'Operator-authored situation.' });
    mocks.callNarrativeAI.mockClear();
    mocks.buildWorkspaceIntelligence.mockResolvedValue(intelligence(42));

    expect(await getStrategyPovRefreshAvailable(seeded.workspaceId, 'admin')).toBe(true);
    await expect(generateStrategyPov(seeded.workspaceId, { variant: 'admin' }))
      .rejects.toThrow(POV_REFRESH_AVAILABLE);
    expect(mocks.callNarrativeAI).not.toHaveBeenCalled();
    expect(getStrategyPov(seeded.workspaceId)?.situation).toBe('Operator-authored situation.');
  });

  it('marks effective voice and custom prompt changes as refresh-available', async () => {
    if (!seeded) throw new Error('missing seeded workspace');
    saveRecSet(seeded.workspaceId);
    await generateStrategyPov(seeded.workspaceId, { variant: 'admin', regenerateNonce: 'initial' });

    mocks.buildWorkspaceIntelligence.mockResolvedValue({
      ...intelligence(),
      seoContext: {
        ...intelligence().seoContext,
        effectiveBrandVoiceBlock: 'BRAND VOICE PROFILE: warmer and more conversational.',
      },
    });
    expect(await getStrategyPovRefreshAvailable(seeded.workspaceId, 'admin')).toBe(true);

    mocks.buildWorkspaceIntelligence.mockResolvedValue(intelligence());
    mocks.getCustomPromptNotes.mockReturnValue('Use board-ready language.');
    expect(await getStrategyPovRefreshAvailable(seeded.workspaceId, 'admin')).toBe(true);
  });

  it('conditionally rejects an in-flight AI result when an operator edit bumps the version', async () => {
    if (!seeded) throw new Error('missing seeded workspace');
    saveRecSet(seeded.workspaceId);
    await generateStrategyPov(seeded.workspaceId, { variant: 'admin', regenerateNonce: 'initial' });

    mocks.callNarrativeAI.mockImplementationOnce(async () => {
      bumpStrategyPovVersion(seeded!.workspaceId, { leadSentence: 'Operator edit landed during generation.' });
      return { ...AI_OUTPUT, leadSentence: 'Late AI result that must be discarded.' };
    });

    await expect(generateStrategyPov(seeded.workspaceId, { variant: 'admin', regenerateNonce: 'explicit' }))
      .rejects.toThrow(POV_REFRESH_AVAILABLE);
    expect(getStrategyPov(seeded.workspaceId)?.leadSentence).toBe('Operator edit landed during generation.');
  });

  it('explicit regeneration is the authority that replaces a previously edited stale draft', async () => {
    if (!seeded) throw new Error('missing seeded workspace');
    saveRecSet(seeded.workspaceId);
    await generateStrategyPov(seeded.workspaceId, { variant: 'admin', regenerateNonce: 'initial' });
    bumpStrategyPovVersion(seeded.workspaceId, { situation: 'Operator-authored situation.' });
    mocks.buildWorkspaceIntelligence.mockResolvedValue(intelligence(42));

    const regenerated = await generateStrategyPov(seeded.workspaceId, {
      variant: 'admin',
      regenerateNonce: 'explicit-regeneration',
    });

    expect(regenerated.situation).toBe(AI_OUTPUT.situation);
    expect(regenerated.editedAt).toBeNull();
    expect(await getStrategyPovRefreshAvailable(seeded.workspaceId, 'admin')).toBe(false);
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

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ responses: [] as string[], call: 0 }));
const mocks = vi.hoisted(() => ({
  snapshotCopyEntryGeneration: vi.fn(),
  commitGeneratedEntryCopy: vi.fn(),
  addSteeringEntry: vi.fn(),
  saveGeneratedCopy: vi.fn(),
  getSectionsForEntry: vi.fn(),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../../server/page-strategy.js', () => ({
  getBlueprint: vi.fn(() => ({ id: 'bp-1', name: 'Blueprint' })),
  getEntry: vi.fn(() => ({
    id: 'entry-1',
    name: 'Service page',
    pageType: 'service',
    sectionPlan: [
      { id: 'plan-hero', sectionType: 'hero', narrativeRole: 'hook', wordCountTarget: 100, order: 0 },
      { id: 'plan-proof', sectionType: 'proof', narrativeRole: 'proof', wordCountTarget: 100, order: 1 },
    ],
  })),
  listBlueprints: vi.fn(() => []),
}));
vi.mock('../../server/voice-calibration.js', () => ({
  getVoiceProfile: vi.fn(() => null),
  buildVoiceCalibrationContext: vi.fn(() => ({})),
}));
vi.mock('../../server/brand-identity.js', () => ({ listDeliverables: vi.fn(() => []) }));
vi.mock('../../server/brandscript.js', () => ({ listBrandscripts: vi.fn(() => []) }));
vi.mock('../../server/content-brief.js', () => ({
  generateBrief: vi.fn(),
  getBrief: vi.fn(() => null),
  getPageTypeConfig: vi.fn(() => ({ wordCountRange: '500-800', contentStyle: 'Direct', prompt: 'Service page' })),
}));
vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn(async () => ({ seoContext: null })),
}));
vi.mock('../../server/intelligence/generation-context-builders.js', () => ({
  buildSeoPromptBlocks: vi.fn(() => []),
}));
vi.mock('../../server/copy-intelligence.js', () => ({ getActivePatterns: vi.fn(() => []) }));
vi.mock('../../server/writing-quality.js', () => ({ CREATIVE_WRITING_RULES: '' }));
vi.mock('../../server/page-type-copy-contract.js', () => ({
  BRAND_CONTEXT_HIERARCHY: '',
  getPageTypeCopyContract: vi.fn(() => null),
}));
vi.mock('../../server/prompt-assembly.js', () => ({ buildSystemPrompt: vi.fn((_ws: string, prompt: string) => prompt) }));
vi.mock('../../server/ai.js', () => ({
  renderAIProviderInput: vi.fn((input: unknown) => input),
  callAI: vi.fn(async (options: { executionChainId?: string; operation?: string }) => {
    state.call += 1;
    return {
      text: state.responses.shift() ?? '{}',
      tokens: { prompt: 1, completion: 1, total: 2 },
      execution: {
        runId: `run-${state.call}`,
        executionChainId: options.executionChainId,
        operation: options.operation ?? 'copy-generation',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        attempts: 1,
        cacheOutcome: 'miss',
        startedAt: '2026-07-14T00:00:00.000Z',
        completedAt: '2026-07-14T00:00:01.000Z',
        durationMs: 1000,
      },
    };
  }),
}));
vi.mock('../../server/copy-review.js', () => ({
  snapshotCopyEntryGeneration: mocks.snapshotCopyEntryGeneration,
  commitGeneratedEntryCopy: mocks.commitGeneratedEntryCopy,
  saveGeneratedCopy: mocks.saveGeneratedCopy,
  addSteeringEntry: mocks.addSteeringEntry,
  getSectionsForEntry: mocks.getSectionsForEntry,
}));
vi.mock('../../server/errors.js', () => ({ isProgrammingError: vi.fn(() => false) }));

import { callAI } from '../../server/ai.js';
import { generateCopyForEntry, regenerateSection } from '../../server/copy-generation.js';

function pageCopy(sectionIds: string[]): string {
  return JSON.stringify({
    sections: sectionIds.map(id => ({
      sectionPlanItemId: id,
      copy: `${id} copy`,
      annotation: 'Approach',
      reasoning: 'Reason',
    })),
    seoTitle: 'SEO title',
    metaDescription: 'Meta description',
    ogTitle: 'OG title',
    ogDescription: 'OG description',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.responses = [];
  state.call = 0;
  mocks.snapshotCopyEntryGeneration.mockReturnValue({
    workspaceId: 'ws-1',
    entryId: 'entry-1',
    sectionPlanJson: '[]',
    entryUpdatedAt: '2026-07-14T00:00:00.000Z',
    plannedSections: [{ id: 'plan-hero', order: 0 }, { id: 'plan-proof', order: 1 }],
    sections: [],
  });
  mocks.commitGeneratedEntryCopy.mockImplementation((_snapshot, sections) => ({
    sections: sections.map((section: { sectionPlanItemId: string }) => ({
      id: `section-${section.sectionPlanItemId.replace('plan-', '')}`,
      sectionPlanItemId: section.sectionPlanItemId,
    })),
    metadata: { seoTitle: 'SEO title' },
  }));
  mocks.getSectionsForEntry.mockReturnValue([]);
  mocks.addSteeringEntry.mockReturnValue(null);
  mocks.saveGeneratedCopy.mockReturnValue(null);
});

describe('regenerateSection edit safety', () => {
  it('carries the post-steering revision through the provider call and final CAS', async () => {
    state.responses = [JSON.stringify({ copy: 'Revised copy', annotation: 'Sharper', reasoning: 'Steered' })];
    mocks.getSectionsForEntry.mockReturnValue([{
      id: 'section-hero',
      sectionPlanItemId: 'plan-hero',
      status: 'draft',
      generatedCopy: 'Current copy',
      version: 1,
      generationRevision: 4,
    }]);
    mocks.addSteeringEntry.mockReturnValue({
      id: 'section-hero',
      sectionPlanItemId: 'plan-hero',
      status: 'draft',
      generatedCopy: 'Current copy',
      version: 1,
      generationRevision: 5,
    });
    mocks.saveGeneratedCopy.mockReturnValue({ id: 'section-hero', generationRevision: 6 });

    const result = await regenerateSection(
      'ws-1', 'bp-1', 'entry-1', 'section-hero', 'Make it sharper', undefined,
      { expectedRevision: 4, executionChainId: 'regen-chain' },
    );

    expect(result).toMatchObject({ generationRevision: 6 });
    expect(mocks.addSteeringEntry).toHaveBeenCalledWith(
      'section-hero', 'ws-1', expect.any(Object), 4,
    );
    expect(mocks.saveGeneratedCopy).toHaveBeenCalledWith(
      'section-hero',
      'ws-1',
      expect.objectContaining({
        expectedRevision: 5,
        generationProvenance: expect.objectContaining({
          runId: 'run-1',
          executionChainId: 'regen-chain',
        }),
      }),
    );
  });
});

describe('generateCopyForEntry exact section census repair', () => {
  it('performs exactly one bounded repair before any durable mutation', async () => {
    state.responses = [pageCopy(['plan-hero']), pageCopy(['plan-proof', 'plan-hero'])];

    const result = await generateCopyForEntry('ws-1', 'bp-1', 'entry-1');

    expect(callAI).toHaveBeenCalledTimes(2);
    expect(mocks.snapshotCopyEntryGeneration).toHaveBeenCalledTimes(1);
    expect(mocks.commitGeneratedEntryCopy).toHaveBeenCalledTimes(1);
    expect(mocks.commitGeneratedEntryCopy.mock.calls[0][1].map((section: { sectionPlanItemId: string }) => section.sectionPlanItemId))
      .toEqual(['plan-hero', 'plan-proof']);
    expect(mocks.commitGeneratedEntryCopy.mock.calls[0][3]).toMatchObject({
      runId: 'run-2',
      executions: [{ runId: 'run-2' }],
    });
    expect(JSON.stringify(mocks.commitGeneratedEntryCopy.mock.calls[0][3])).not.toContain('run-1');
    expect(result.sections).toHaveLength(2);
  });

  it('fails after one repair and preserves existing copy when the census remains invalid', async () => {
    state.responses = [pageCopy(['plan-hero']), pageCopy(['plan-proof'])];

    await expect(generateCopyForEntry('ws-1', 'bp-1', 'entry-1')).rejects.toThrow(/after one repair/i);

    expect(callAI).toHaveBeenCalledTimes(2);
    expect(mocks.snapshotCopyEntryGeneration).toHaveBeenCalledTimes(1);
    expect(mocks.commitGeneratedEntryCopy).not.toHaveBeenCalled();
  });
});

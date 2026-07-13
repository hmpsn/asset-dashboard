import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ responses: [] as string[] }));
const mocks = vi.hoisted(() => ({
  initializeSections: vi.fn(),
  saveGeneratedCopy: vi.fn(),
  saveMetadata: vi.fn(),
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
  callAI: vi.fn(async () => ({ text: state.responses.shift() ?? '{}' })),
}));
vi.mock('../../server/db/index.js', () => ({
  default: { transaction: vi.fn((fn: () => unknown) => fn) },
}));
vi.mock('../../server/copy-review.js', () => ({
  initializeSections: mocks.initializeSections,
  saveGeneratedCopy: mocks.saveGeneratedCopy,
  saveMetadata: mocks.saveMetadata,
  addSteeringEntry: vi.fn(),
  getSectionsForEntry: vi.fn(() => []),
}));
vi.mock('../../server/errors.js', () => ({ isProgrammingError: vi.fn(() => false) }));

import { callAI } from '../../server/ai.js';
import { generateCopyForEntry } from '../../server/copy-generation.js';

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
  mocks.initializeSections.mockReturnValue([
    { id: 'section-hero', sectionPlanItemId: 'plan-hero' },
    { id: 'section-proof', sectionPlanItemId: 'plan-proof' },
  ]);
  mocks.saveGeneratedCopy.mockImplementation((id: string) => ({ id }));
  mocks.saveMetadata.mockReturnValue({ seoTitle: 'SEO title' });
});

describe('generateCopyForEntry exact section census repair', () => {
  it('performs exactly one bounded repair before any durable mutation', async () => {
    state.responses = [pageCopy(['plan-hero']), pageCopy(['plan-proof', 'plan-hero'])];

    const result = await generateCopyForEntry('ws-1', 'bp-1', 'entry-1');

    expect(callAI).toHaveBeenCalledTimes(2);
    expect(mocks.initializeSections).toHaveBeenCalledTimes(1);
    expect(mocks.saveGeneratedCopy.mock.calls.map(call => call[0])).toEqual(['section-hero', 'section-proof']);
    expect(result.sections).toHaveLength(2);
  });

  it('fails after one repair and preserves existing copy when the census remains invalid', async () => {
    state.responses = [pageCopy(['plan-hero']), pageCopy(['plan-proof'])];

    await expect(generateCopyForEntry('ws-1', 'bp-1', 'entry-1')).rejects.toThrow(/after one repair/i);

    expect(callAI).toHaveBeenCalledTimes(2);
    expect(mocks.initializeSections).not.toHaveBeenCalled();
    expect(mocks.saveGeneratedCopy).not.toHaveBeenCalled();
    expect(mocks.saveMetadata).not.toHaveBeenCalled();
  });
});

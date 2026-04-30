import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAiBudget } from '../../../../server/schema/extractors/page-elements/ai-budget.js';
import type { PageImage } from '../../../../shared/types/page-elements.js';

// We mock the OpenAI client + image-fetch + feature-flag at the boundary the
// classifier uses. The classifier imports a `getOpenAIClient` lazy accessor
// (defined in image-ai-classifier.ts) so the test can swap in a fake.
vi.mock('../../../../server/feature-flags.js', () => ({
  isFeatureEnabled: vi.fn(),
}));
vi.mock('../../../../server/schema/extractors/page-elements/image-fetch.js', () => ({
  fetchImageAsBase64: vi.fn(),
}));

const mockCreate = vi.fn();
vi.mock('../../../../server/schema/extractors/page-elements/image-ai-classifier.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../server/schema/extractors/page-elements/image-ai-classifier.js')>(
    '../../../../server/schema/extractors/page-elements/image-ai-classifier.js',
  );
  return {
    ...actual,
    // Override the internal openai client accessor so the test can intercept calls.
    __setOpenAIClientForTest: (client: { chat: { completions: { create: typeof mockCreate } } }) => actual.__setOpenAIClientForTest(client),
  };
});

import { isFeatureEnabled } from '../../../../server/feature-flags.js';
import { fetchImageAsBase64 } from '../../../../server/schema/extractors/page-elements/image-fetch.js';
import { aiClassifyImages, __setOpenAIClientForTest } from '../../../../server/schema/extractors/page-elements/image-ai-classifier.js';

// Inject a fake OpenAI client into the classifier module
__setOpenAIClientForTest({ chat: { completions: { create: mockCreate } } });

const ambiguousImage: PageImage = {
  src: 'https://example.com/img.jpg',
  alt: 'photo',
  role: 'informative',
  roleSource: 'fallback',
  width: 600,
  height: 400,
};

function fakeChatResponse(text: string) {
  return {
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 },
    model: 'gpt-4.1-mini',
  };
}

describe('aiClassifyImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockReset();
  });

  it('returns unchanged when feature flag is OFF (no AI calls)', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(false);
    const budget = createAiBudget(100);
    const result = await aiClassifyImages([ambiguousImage], { budget, workspaceId: 'ws-1' });
    expect(result).toEqual([ambiguousImage]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns unchanged when budget is 0', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    const budget = createAiBudget(0);
    const result = await aiClassifyImages([ambiguousImage], { budget, workspaceId: 'ws-1' });
    expect(result).toEqual([ambiguousImage]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('skips images that are not ambiguous (roleSource !== "fallback")', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    const ruleClassified: PageImage = { ...ambiguousImage, roleSource: 'rule', role: 'hero' };
    const budget = createAiBudget(100);
    const result = await aiClassifyImages([ruleClassified], { budget, workspaceId: 'ws-1' });
    expect(result).toEqual([ruleClassified]);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(budget.used).toBe(0);
  });

  it('upgrades roleSource to "ai" + uses returned role on successful call', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(fetchImageAsBase64).mockResolvedValue('data:image/jpeg;base64,abc');
    mockCreate.mockResolvedValue(fakeChatResponse('{"role":"informative"}'));
    const budget = createAiBudget(100);
    const result = await aiClassifyImages([ambiguousImage], { budget, workspaceId: 'ws-1' });
    expect(result[0].role).toBe('informative');
    expect(result[0].roleSource).toBe('ai');
    expect(budget.used).toBe(1);
  });

  it('reclassifies decorative based on AI response', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(fetchImageAsBase64).mockResolvedValue('data:image/jpeg;base64,abc');
    mockCreate.mockResolvedValue(fakeChatResponse('{"role":"decorative"}'));
    const budget = createAiBudget(100);
    const result = await aiClassifyImages([ambiguousImage], { budget, workspaceId: 'ws-1' });
    expect(result[0].role).toBe('decorative');
    expect(result[0].roleSource).toBe('ai');
  });

  it('leaves image unchanged on AI parse error (invalid JSON)', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(fetchImageAsBase64).mockResolvedValue('data:image/jpeg;base64,abc');
    mockCreate.mockResolvedValue(fakeChatResponse('not json'));
    const budget = createAiBudget(100);
    const result = await aiClassifyImages([ambiguousImage], { budget, workspaceId: 'ws-1' });
    expect(result[0]).toEqual(ambiguousImage);
    // Budget WAS consumed (the call happened) — even on parse failure
    expect(budget.used).toBe(1);
  });

  it('leaves image unchanged on invalid role label', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(fetchImageAsBase64).mockResolvedValue('data:image/jpeg;base64,abc');
    mockCreate.mockResolvedValue(fakeChatResponse('{"role":"nonsense"}'));
    const budget = createAiBudget(100);
    const result = await aiClassifyImages([ambiguousImage], { budget, workspaceId: 'ws-1' });
    expect(result[0]).toEqual(ambiguousImage);
  });

  it('falls through (no AI call) when fetchImageAsBase64 returns null', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(fetchImageAsBase64).mockResolvedValue(null);
    const budget = createAiBudget(100);
    const result = await aiClassifyImages([ambiguousImage], { budget, workspaceId: 'ws-1' });
    expect(result[0]).toEqual(ambiguousImage);
    expect(mockCreate).not.toHaveBeenCalled();
    // Budget NOT consumed — fetch failed before AI call
    expect(budget.used).toBe(0);
  });

  it('stops calling AI once budget exhausts mid-loop', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(fetchImageAsBase64).mockResolvedValue('data:image/jpeg;base64,abc');
    mockCreate.mockResolvedValue(fakeChatResponse('{"role":"informative"}'));
    const budget = createAiBudget(2);
    const inputs = [ambiguousImage, ambiguousImage, ambiguousImage, ambiguousImage];
    const result = await aiClassifyImages(inputs, { budget, workspaceId: 'ws-1' });
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.filter(i => i.roleSource === 'ai').length).toBe(2);
    expect(result.filter(i => i.roleSource === 'fallback').length).toBe(2);
    expect(budget.exhausted).toBe(true);
  });
});

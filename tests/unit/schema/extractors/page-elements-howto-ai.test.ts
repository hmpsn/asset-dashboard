import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAiBudget } from '../../../../server/schema/extractors/page-elements/ai-budget.js';
import type { PageList } from '../../../../shared/types/page-elements.js';

vi.mock('../../../../server/feature-flags.js', () => ({
  isFeatureEnabled: vi.fn(),
}));
vi.mock('../../../../server/ai.js', () => ({
  callAI: vi.fn(),
}));

import { isFeatureEnabled } from '../../../../server/feature-flags.js';
import { callAI } from '../../../../server/ai.js';
import { aiDisambiguateHowTo } from '../../../../server/schema/extractors/page-elements/howto-ai-fallback.js';

const ambiguousOrderedList: PageList = {
  kind: 'ordered',
  itemCount: 4,
  isHowToLike: false,
  // Steps not yet populated (rule-based extractor only sets steps when isHowToLike=true)
};

const orderedItemsRaw: string[] = [
  'Open the Webflow Designer.',
  'Click the Pages icon in the left sidebar.',
  'Right-click the page you want to duplicate.',
  'Select Duplicate from the menu.',
];

describe('aiDisambiguateHowTo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns unchanged when feature flag is OFF', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(false);
    const budget = createAiBudget(20);
    const result = await aiDisambiguateHowTo([ambiguousOrderedList], orderedItemsRaw, { budget, workspaceId: 'ws-1' });
    expect(result).toEqual([ambiguousOrderedList]);
    expect(callAI).not.toHaveBeenCalled();
  });

  it('returns unchanged when budget is 0', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    const budget = createAiBudget(0);
    const result = await aiDisambiguateHowTo([ambiguousOrderedList], orderedItemsRaw, { budget, workspaceId: 'ws-1' });
    expect(result).toEqual([ambiguousOrderedList]);
    expect(callAI).not.toHaveBeenCalled();
  });

  it('skips lists already flagged isHowToLike=true', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    const already: PageList = { ...ambiguousOrderedList, isHowToLike: true, steps: [] };
    const budget = createAiBudget(20);
    const result = await aiDisambiguateHowTo([already], orderedItemsRaw, { budget, workspaceId: 'ws-1' });
    expect(callAI).not.toHaveBeenCalled();
    expect(result[0].isHowToLike).toBe(true);
  });

  it('skips unordered lists', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    const unordered: PageList = { ...ambiguousOrderedList, kind: 'unordered' };
    const budget = createAiBudget(20);
    const result = await aiDisambiguateHowTo([unordered], orderedItemsRaw, { budget, workspaceId: 'ws-1' });
    expect(callAI).not.toHaveBeenCalled();
    expect(result[0].isHowToLike).toBe(false);
  });

  it('skips lists with fewer than 3 items', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    const tiny: PageList = { ...ambiguousOrderedList, itemCount: 2 };
    const budget = createAiBudget(20);
    const result = await aiDisambiguateHowTo([tiny], orderedItemsRaw.slice(0, 2), { budget, workspaceId: 'ws-1' });
    expect(callAI).not.toHaveBeenCalled();
  });

  it('flips isHowToLike + populates steps when AI returns howTo:true', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(callAI).mockResolvedValue({
      text: '{"howTo":true}',
      tokens: { prompt: 100, completion: 5, total: 105 },
    });
    const budget = createAiBudget(20);
    const result = await aiDisambiguateHowTo([ambiguousOrderedList], orderedItemsRaw, { budget, workspaceId: 'ws-1' });
    expect(result[0].isHowToLike).toBe(true);
    expect(result[0].steps).toHaveLength(4);
    expect(result[0].steps?.[0]).toEqual({
      name: 'Open the Webflow Designer.',
      text: 'Open the Webflow Designer.',
      position: 1,
    });
    expect(budget.used).toBe(1);
  });

  it('leaves list unchanged when AI returns howTo:false', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(callAI).mockResolvedValue({
      text: '{"howTo":false}',
      tokens: { prompt: 100, completion: 5, total: 105 },
    });
    const budget = createAiBudget(20);
    const result = await aiDisambiguateHowTo([ambiguousOrderedList], orderedItemsRaw, { budget, workspaceId: 'ws-1' });
    expect(result[0]).toEqual(ambiguousOrderedList);
    expect(budget.used).toBe(1);
  });

  it('leaves list unchanged on AI parse error', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(callAI).mockResolvedValue({ text: 'not json', tokens: { prompt: 100, completion: 5, total: 105 } });
    const budget = createAiBudget(20);
    const result = await aiDisambiguateHowTo([ambiguousOrderedList], orderedItemsRaw, { budget, workspaceId: 'ws-1' });
    expect(result[0]).toEqual(ambiguousOrderedList);
  });
});

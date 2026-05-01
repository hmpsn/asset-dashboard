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

// itemsByList is a parallel array aligned to lists by index (one inner array
// per list element). For single-list test cases this is a length-1 outer array.
const itemsByList: string[][] = [[
  'Open the Webflow Designer.',
  'Click the Pages icon in the left sidebar.',
  'Right-click the page you want to duplicate.',
  'Select Duplicate from the menu.',
]];

describe('aiDisambiguateHowTo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns unchanged when feature flag is OFF', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(false);
    const budget = createAiBudget(20);
    const result = await aiDisambiguateHowTo([ambiguousOrderedList], itemsByList, { budget, workspaceId: 'ws-1' });
    expect(result).toEqual([ambiguousOrderedList]);
    expect(callAI).not.toHaveBeenCalled();
  });

  it('returns unchanged when budget is 0', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    const budget = createAiBudget(0);
    const result = await aiDisambiguateHowTo([ambiguousOrderedList], itemsByList, { budget, workspaceId: 'ws-1' });
    expect(result).toEqual([ambiguousOrderedList]);
    expect(callAI).not.toHaveBeenCalled();
  });

  it('skips lists already flagged isHowToLike=true', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    const already: PageList = { ...ambiguousOrderedList, isHowToLike: true, steps: [] };
    const budget = createAiBudget(20);
    const result = await aiDisambiguateHowTo([already], itemsByList, { budget, workspaceId: 'ws-1' });
    expect(callAI).not.toHaveBeenCalled();
    expect(result[0].isHowToLike).toBe(true);
  });

  it('skips unordered lists', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    const unordered: PageList = { ...ambiguousOrderedList, kind: 'unordered' };
    const budget = createAiBudget(20);
    const result = await aiDisambiguateHowTo([unordered], itemsByList, { budget, workspaceId: 'ws-1' });
    expect(callAI).not.toHaveBeenCalled();
    expect(result[0].isHowToLike).toBe(false);
  });

  it('skips lists with fewer than 3 items', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    const tiny: PageList = { ...ambiguousOrderedList, itemCount: 2 };
    const budget = createAiBudget(20);
    const result = await aiDisambiguateHowTo([tiny], [itemsByList[0].slice(0, 2)], { budget, workspaceId: 'ws-1' });
    expect(callAI).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });

  it('flips isHowToLike + populates steps when AI returns howTo:true', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(callAI).mockResolvedValue({
      text: '{"howTo":true}',
      tokens: { prompt: 100, completion: 5, total: 105 },
    });
    const budget = createAiBudget(20);
    const result = await aiDisambiguateHowTo([ambiguousOrderedList], itemsByList, { budget, workspaceId: 'ws-1' });
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
    const result = await aiDisambiguateHowTo([ambiguousOrderedList], itemsByList, { budget, workspaceId: 'ws-1' });
    expect(result[0]).toEqual(ambiguousOrderedList);
    expect(budget.used).toBe(1);
  });

  it('leaves list unchanged on AI parse error', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(callAI).mockResolvedValue({ text: 'not json', tokens: { prompt: 100, completion: 5, total: 105 } });
    const budget = createAiBudget(20);
    const result = await aiDisambiguateHowTo([ambiguousOrderedList], itemsByList, { budget, workspaceId: 'ws-1' });
    expect(result[0]).toEqual(ambiguousOrderedList);
  });

  it('multi-list: each list sees its OWN items in the prompt (regression guard)', async () => {
    // Review-caught bug: a flat orderedItemsRaw[] would send list 0's items as
    // the prompt for list 1 too. The string[][] shape pins one entry per list.
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    const aiCalls: string[] = [];
    vi.mocked(callAI).mockImplementation(async (opts) => {
      const content = (opts.messages[0]?.content as string) ?? '';
      aiCalls.push(content);
      return { text: '{"howTo":false}', tokens: { prompt: 100, completion: 5, total: 105 } };
    });
    const budget = createAiBudget(20);
    const lists: PageList[] = [
      { kind: 'ordered', itemCount: 3, isHowToLike: false },
      { kind: 'unordered', itemCount: 3, isHowToLike: false }, // skipped
      { kind: 'ordered', itemCount: 3, isHowToLike: false },
    ];
    const itemsByListMulti: string[][] = [
      ['List-A item 1', 'List-A item 2', 'List-A item 3'],
      ['Unordered item 1', 'Unordered item 2', 'Unordered item 3'],
      ['List-B item 1', 'List-B item 2', 'List-B item 3'],
    ];
    await aiDisambiguateHowTo(lists, itemsByListMulti, { budget, workspaceId: 'ws-1' });

    expect(aiCalls).toHaveLength(2); // unordered list skipped
    expect(aiCalls[0]).toContain('List-A item 1');
    expect(aiCalls[0]).not.toContain('List-B');
    expect(aiCalls[1]).toContain('List-B item 1');
    expect(aiCalls[1]).not.toContain('List-A');
  });

  it('skips list when its parallel items array is empty (caller missing extraction)', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    const budget = createAiBudget(20);
    const result = await aiDisambiguateHowTo([ambiguousOrderedList], [[]], { budget, workspaceId: 'ws-1' });
    expect(callAI).not.toHaveBeenCalled();
    expect(result[0]).toEqual(ambiguousOrderedList);
  });

  it('treats empty AI content as no-op (does not crash on JSON.parse(""))', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(callAI).mockResolvedValue({ text: '', tokens: { prompt: 100, completion: 0, total: 100 } });
    const budget = createAiBudget(20);
    const result = await aiDisambiguateHowTo([ambiguousOrderedList], itemsByList, { budget, workspaceId: 'ws-1' });
    expect(result[0]).toEqual(ambiguousOrderedList);
    expect(budget.used).toBe(1); // call did happen — empty content guard fires after consume
  });
});

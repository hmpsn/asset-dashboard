/**
 * Unit tests for Phase 2.5e AI polish helpers in server/briefing-prompt.ts.
 *
 * Both `punchHeroHeadline` and `writeWeeklyOpener` are FAIL-SOFT — every
 * error path returns the original / null without throwing. These tests
 * cover the failure-mode catalog explicitly so any regression that drops
 * a guard surfaces here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock callAI BEFORE importing the helpers so the hoisted vi.mock takes effect.
const callAI = vi.fn();
vi.mock('../../server/ai.js', () => ({
  callAI: (...args: unknown[]) => callAI(...args),
}));

import { punchHeroHeadline, writeWeeklyOpener } from '../../server/briefing-prompt.js';
import type { BriefingStory } from '../../shared/types/briefing.js';

const ORIGINAL_HEADLINE = 'Your fleet maintenance page just cracked the top 5.';
const HINT = 'ranking_mover: /services/fleet #11 → #4';
const WORKSPACE_ID = 'ws_test';

function aiResponse(text: string) {
  return { text, tokens: { prompt: 10, completion: 8, total: 18 } };
}

function story(over: Partial<BriefingStory> = {}): BriefingStory {
  return {
    id: 'story-test',
    category: 'win',
    isHeadline: true,
    headline: 'Default headline cited 12 numbers.',
    narrative: 'Default narrative.',
    metrics: [{ value: '+12%', label: 'clicks' }],
    drillIn: { page: 'performance' },
    sourceRefs: [],
    ...over,
  };
}

describe('punchHeroHeadline (Phase 2.5e)', () => {
  beforeEach(() => {
    callAI.mockReset();
  });

  it('returns the AI rewrite when guards pass (5-12 words, no hedges)', async () => {
    callAI.mockResolvedValue(aiResponse('Fleet maintenance page broke into the top five.'));
    const out = await punchHeroHeadline(ORIGINAL_HEADLINE, HINT, WORKSPACE_ID);
    expect(out).toBe('Fleet maintenance page broke into the top five.');
  });

  it('strips wrapping quotes from the AI response', async () => {
    callAI.mockResolvedValue(aiResponse('"Fleet maintenance page broke into the top five."'));
    const out = await punchHeroHeadline(ORIGINAL_HEADLINE, HINT, WORKSPACE_ID);
    expect(out).toBe('Fleet maintenance page broke into the top five.');
  });

  it('falls back to original when AI returns < 5 words', async () => {
    callAI.mockResolvedValue(aiResponse('Top five.'));
    const out = await punchHeroHeadline(ORIGINAL_HEADLINE, HINT, WORKSPACE_ID);
    expect(out).toBe(ORIGINAL_HEADLINE);
  });

  it('falls back to original when AI returns > 12 words', async () => {
    callAI.mockResolvedValue(aiResponse(
      'Your fleet maintenance page just cracked the top five with significant growth across multiple keywords this week.',
    ));
    const out = await punchHeroHeadline(ORIGINAL_HEADLINE, HINT, WORKSPACE_ID);
    expect(out).toBe(ORIGINAL_HEADLINE);
  });

  it('falls back to original when AI response contains a banned hedge word', async () => {
    callAI.mockResolvedValue(aiResponse('Fleet page potentially broke into the top five.'));
    const out = await punchHeroHeadline(ORIGINAL_HEADLINE, HINT, WORKSPACE_ID);
    expect(out).toBe(ORIGINAL_HEADLINE);
  });

  it('falls back to original when AI response is multiline', async () => {
    callAI.mockResolvedValue(aiResponse('Fleet maintenance page broke top five.\nAlternate: Top 5 reached.'));
    const out = await punchHeroHeadline(ORIGINAL_HEADLINE, HINT, WORKSPACE_ID);
    expect(out).toBe(ORIGINAL_HEADLINE);
  });

  it('falls back to original when AI throws (timeout/rate-limit)', async () => {
    callAI.mockRejectedValue(new Error('rate limited'));
    const out = await punchHeroHeadline(ORIGINAL_HEADLINE, HINT, WORKSPACE_ID);
    expect(out).toBe(ORIGINAL_HEADLINE);
  });

  it('returns original unchanged when input headline is empty (no AI call made)', async () => {
    const out = await punchHeroHeadline('', HINT, WORKSPACE_ID);
    expect(out).toBe('');
    expect(callAI).not.toHaveBeenCalled();
  });

  it('passes the insightHint into the user message when provided', async () => {
    callAI.mockResolvedValue(aiResponse('Fleet page broke into top five.'));
    await punchHeroHeadline(ORIGINAL_HEADLINE, HINT, WORKSPACE_ID);
    const call = callAI.mock.calls[0][0];
    expect(call.messages[0].content).toContain('Underlying data: ' + HINT);
  });

  it('omits insightHint from prompt when null', async () => {
    callAI.mockResolvedValue(aiResponse('Fleet page broke into top five.'));
    await punchHeroHeadline(ORIGINAL_HEADLINE, null, WORKSPACE_ID);
    const call = callAI.mock.calls[0][0];
    expect(call.messages[0].content).not.toContain('Underlying data:');
  });
});

describe('writeWeeklyOpener (Phase 2.5e)', () => {
  beforeEach(() => {
    callAI.mockReset();
  });

  const ctx = { workspaceName: 'Swish', weekOf: '2026-04-27', workspaceId: WORKSPACE_ID };
  const stories = [
    story({ headline: '3 pages competing for "dentist austin" — splitting impressions.', metrics: [{ value: '945', label: 'impressions' }] }),
    story({ id: 's2', isHeadline: false, headline: 'Strong portfolio engagement.', metrics: [{ value: '+12%', label: 'sessions' }] }),
  ];

  it('returns the opener when guards pass (≤25 words, period, number, no hedges, no quotes)', async () => {
    // Internal quotes are rejected by the no-quotes guard, so the happy-path
    // copy uses none. Model output that wraps this same line in outer quotes
    // gets unwrapped by `unquote()` and still passes (covered by the
    // "strips wrapping quotes" test below).
    callAI.mockResolvedValue(aiResponse(
      'Three pages compete for the same query — consolidate to capture all 945 monthly impressions.',
    ));
    const out = await writeWeeklyOpener(stories, ctx);
    expect(out).toContain('945');
    expect(out!.endsWith('.')).toBe(true);
  });

  it('strips wrapping quotes', async () => {
    callAI.mockResolvedValue(aiResponse('"Three pages compete for 945 monthly impressions; consolidating wins this week."'));
    const out = await writeWeeklyOpener(stories, ctx);
    expect(out).not.toBeNull();
    expect(out!.startsWith('"')).toBe(false);
  });

  it('returns null when stories array is empty (no AI call made)', async () => {
    const out = await writeWeeklyOpener([], ctx);
    expect(out).toBeNull();
    expect(callAI).not.toHaveBeenCalled();
  });

  it('returns null when AI response contains internal quotation marks', async () => {
    // Devin-flagged contract: opener can't carry inline quote characters
    // because they'd clash with the magazine's editorial chrome.
    callAI.mockResolvedValue(aiResponse('A "consolidation week" reaching 945 impressions.'));
    const out = await writeWeeklyOpener(stories, ctx);
    expect(out).toBeNull();
  });

  it('returns null when AI response contains a banned hedge word', async () => {
    callAI.mockResolvedValue(aiResponse('Consolidation could reach 945 impressions this week.'));
    const out = await writeWeeklyOpener(stories, ctx);
    expect(out).toBeNull();
  });

  it('returns null when AI response exceeds 25 words', async () => {
    const longLine = 'Consolidating three competing dentist austin pages this week to capture all 945 monthly impressions in one URL — definitely the right move and a clear win for the brand voice.';
    callAI.mockResolvedValue(aiResponse(longLine));
    const out = await writeWeeklyOpener(stories, ctx);
    expect(out).toBeNull();
  });

  it('returns null when AI response is not period-terminated', async () => {
    callAI.mockResolvedValue(aiResponse('Three pages compete for 945 impressions this week'));
    const out = await writeWeeklyOpener(stories, ctx);
    expect(out).toBeNull();
  });

  it('returns null when AI response cites no numbers', async () => {
    callAI.mockResolvedValue(aiResponse('Three pages compete for the same query, consolidating wins this week.'));
    const out = await writeWeeklyOpener(stories, ctx);
    expect(out).toBeNull();
  });

  it('returns null when AI throws', async () => {
    callAI.mockRejectedValue(new Error('connection reset'));
    const out = await writeWeeklyOpener(stories, ctx);
    expect(out).toBeNull();
  });

  it('passes story headlines + first-metric values into the prompt', async () => {
    callAI.mockResolvedValue(aiResponse('945 impressions split across 3 dentist austin pages this week.'));
    await writeWeeklyOpener(stories, ctx);
    const call = callAI.mock.calls[0][0];
    expect(call.messages[0].content).toContain('3 pages competing for "dentist austin"');
    expect(call.messages[0].content).toContain('[945]');
  });
});

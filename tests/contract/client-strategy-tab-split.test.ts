import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('client StrategyTab split', () => {
  it('keeps keyword workflow API calls behind focused StrategyTab hooks', () => {
    const strategyTabSrc = readFileSync('src/components/client/StrategyTab.tsx', 'utf-8'); // readFile-ok - migration guard: StrategyTab workflow API calls should stay in focused hooks while sections are split incrementally.
    const keywordFeedbackHook = readFileSync('src/components/client/strategy/useStrategyKeywordFeedback.ts', 'utf-8'); // readFile-ok - migration guard: keyword feedback state/API ownership lives in this hook.
    const trackedKeywordsHook = readFileSync('src/components/client/strategy/useStrategyTrackedKeywords.ts', 'utf-8'); // readFile-ok - migration guard: tracked keyword state/API ownership lives in this hook.
    const businessPrioritiesHook = readFileSync('src/components/client/strategy/useStrategyBusinessPriorities.ts', 'utf-8'); // readFile-ok - migration guard: business priority state/API ownership lives in this hook.

    expect(strategyTabSrc).toContain("from './strategy/useStrategyKeywordFeedback'");
    expect(strategyTabSrc).toContain("from './strategy/useStrategyTrackedKeywords'");
    expect(strategyTabSrc).toContain("from './strategy/useStrategyBusinessPriorities'");
    expect(strategyTabSrc).not.toContain('keywordFeedback as');
    expect(strategyTabSrc).not.toContain('trackedKeywords as');
    expect(strategyTabSrc).not.toContain('businessPriorities as');

    expect(keywordFeedbackHook).toContain('keywordFeedback as kwFeedbackApi');
    expect(keywordFeedbackHook).toContain('kwFeedbackApi.submit');
    expect(keywordFeedbackHook).toContain('kwFeedbackApi.remove');
    expect(trackedKeywordsHook).toContain('trackedKeywords as trackedKwApi');
    expect(trackedKeywordsHook).toContain('trackedKwApi.add');
    expect(trackedKeywordsHook).toContain('trackedKwApi.remove');
    expect(businessPrioritiesHook).toContain('businessPriorities as bizPrioritiesApi');
    expect(businessPrioritiesHook).toContain('/api/public/business-priorities/');
  });
});

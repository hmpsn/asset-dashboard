import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('client StrategyTab shell section split', () => {
  it('keeps snapshot, next steps, and page keyword map rendering behind focused components', () => {
    const strategyTabSrc = readFileSync('src/components/client/StrategyTab.tsx', 'utf-8'); // readFile-ok - migration guard: StrategyTab should orchestrate shell state while delegating remaining rendered sections.
    const snapshotSrc = readFileSync('src/components/client/strategy/StrategySnapshotSection.tsx', 'utf-8'); // readFile-ok - migration guard: strategy snapshot markup lives in the extracted section component.
    const nextStepsSrc = readFileSync('src/components/client/strategy/StrategyNextStepsSection.tsx', 'utf-8'); // readFile-ok - migration guard: recommended next-step cards live in the extracted section component.
    const pageMapSrc = readFileSync('src/components/client/strategy/StrategyPageKeywordMapSection.tsx', 'utf-8'); // readFile-ok - migration guard: page keyword map accordion and gate live in the extracted section component.

    expect(strategyTabSrc).toContain("from './strategy/StrategySnapshotSection'");
    expect(strategyTabSrc).toContain("from './strategy/StrategyNextStepsSection'");
    expect(strategyTabSrc).toContain("from './strategy/StrategyPageKeywordMapSection'");
    expect(strategyTabSrc).toContain('<StrategySnapshotSection');
    expect(strategyTabSrc).toContain('<StrategyNextStepsSection');
    expect(strategyTabSrc).toContain('<StrategyPageKeywordMapSection');
    expect(strategyTabSrc).not.toContain('<PageKeywordMapContent');
    expect(strategyTabSrc).not.toContain('Recommended Next Steps');
    expect(strategyTabSrc).not.toContain('planning-readiness score');

    expect(snapshotSrc).toContain('export function StrategySnapshotSection');
    expect(snapshotSrc).toContain('Strategy Snapshot');
    expect(snapshotSrc).toContain('planning-readiness score');
    expect(snapshotSrc).toContain('score-color-deviation-ok');

    expect(nextStepsSrc).toContain('export function StrategyNextStepsSection');
    expect(nextStepsSrc).toContain('Recommended Next Steps');
    expect(nextStepsSrc).toContain('onReviewIdeas');
    expect(nextStepsSrc).toContain('onReviewPages');
    expect(nextStepsSrc).toContain('onManageKeywords');

    expect(pageMapSrc).toContain('export function StrategyPageKeywordMapSection');
    expect(pageMapSrc).toContain('feature="Keyword Map"');
    expect(pageMapSrc).toContain('<PageKeywordMapContent');
    expect(pageMapSrc).toContain("submitFeedback(kw, 'approved', source)");
    expect(pageMapSrc).toContain('onDeclineKeyword={onDeclineKeyword}');
  });
});

import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('client StrategyTab request-flow split', () => {
  it('keeps strategy keyword request and feedback rendering behind focused components', () => {
    const strategyTabSrc = readFileSync('src/components/client/StrategyTab.tsx', 'utf-8'); // readFile-ok - migration guard: StrategyTab should assemble keyword rows and delegate request/feedback rendering.
    const keywordsSectionSrc = readFileSync('src/components/client/strategy/StrategyKeywordsSection.tsx', 'utf-8'); // readFile-ok - migration guard: strategy keyword add/remove/suggestion controls live in the extracted section component.
    const declinedSectionSrc = readFileSync('src/components/client/strategy/StrategyDeclinedKeywordsSection.tsx', 'utf-8'); // readFile-ok - migration guard: declined keyword restore UI lives in the extracted section component.
    const declineModalSrc = readFileSync('src/components/client/strategy/StrategyDeclineKeywordModal.tsx', 'utf-8'); // readFile-ok - migration guard: decline reason form UI lives in the extracted modal component.

    expect(strategyTabSrc).toContain("from './strategy/StrategyKeywordsSection'");
    expect(strategyTabSrc).toContain("from './strategy/StrategyDeclinedKeywordsSection'");
    expect(strategyTabSrc).toContain("from './strategy/StrategyDeclineKeywordModal'");
    expect(strategyTabSrc).toContain('<StrategyKeywordsSection');
    expect(strategyTabSrc).toContain('<StrategyDeclinedKeywordsSection');
    expect(strategyTabSrc).toContain('<StrategyDeclineKeywordModal');
    expect(strategyTabSrc).not.toContain('const priorityKeywordsPanel = (');
    expect(strategyTabSrc).not.toContain('No suggestions right now');
    expect(strategyTabSrc).not.toContain("These keywords won't appear in future strategy recommendations");
    expect(strategyTabSrc).not.toContain("Why isn't this keyword relevant?");

    expect(keywordsSectionSrc).toContain('export function StrategyKeywordsSection');
    expect(keywordsSectionSrc).toContain('ROLE_DISPLAY_LABELS');
    expect(keywordsSectionSrc).toContain('await addStrategyKeyword(newTrackedKeyword, { clearInput: true })');
    expect(keywordsSectionSrc).toContain('void addStrategyKeyword(row.label)');
    expect(keywordsSectionSrc).toContain("void submitFeedback(row.label, 'declined', 'suggestion')");
    expect(keywordsSectionSrc).toContain('Remove ${row.label} from strategy');

    expect(declinedSectionSrc).toContain('export function StrategyDeclinedKeywordsSection');
    expect(declinedSectionSrc).toContain("status === 'declined'");
    expect(declinedSectionSrc).toContain('Not Relevant Keywords');
    expect(declinedSectionSrc).toContain('undoFeedback(kw)');

    expect(declineModalSrc).toContain('export function StrategyDeclineKeywordModal');
    expect(declineModalSrc).toContain('Decline keyword');
    expect(declineModalSrc).toContain('onConfirm');
    expect(declineModalSrc).toContain('Decline Keyword');
  });
});

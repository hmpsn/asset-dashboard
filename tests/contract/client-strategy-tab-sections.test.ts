import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('client StrategyTab section split', () => {
  it('keeps the keyword detail drawer behind a focused strategy component', () => {
    const strategyTabSrc = readFileSync('src/components/client/StrategyTab.tsx', 'utf-8'); // readFile-ok - migration guard: StrategyTab should orchestrate the keyword drawer without owning its full rendered body.
    const drawerSrc = readFileSync('src/components/client/strategy/StrategyKeywordDrawer.tsx', 'utf-8'); // readFile-ok - migration guard: keyword drawer markup and actions live in the extracted section component.
    const displaySrc = readFileSync('src/components/client/strategy/strategyKeywordDisplay.ts', 'utf-8'); // readFile-ok - migration guard: shared keyword row labels/helpers stay out of the monolithic StrategyTab file.

    expect(strategyTabSrc).toContain("from './strategy/StrategyKeywordDrawer'");
    expect(strategyTabSrc).toContain("from './strategy/strategyKeywordDisplay'");
    expect(strategyTabSrc).toContain('<StrategyKeywordDrawer');
    expect(strategyTabSrc).toContain('ROLE_DISPLAY_LABELS');
    expect(strategyTabSrc).toContain('kdColor');
    expect(strategyTabSrc).not.toContain('aria-label={`Keyword details:');
    expect(strategyTabSrc).not.toContain('See the numbers');

    expect(drawerSrc).toContain('aria-label={`Keyword details:');
    expect(drawerSrc).toContain('See the numbers');
    expect(drawerSrc).toContain('removePriorityKeyword(drawerRow)');
    expect(drawerSrc).toContain("submitFeedback(drawerRow.label, 'declined', 'suggestion')");

    expect(displaySrc).toContain('export interface StrategyKeywordTableRow');
    expect(displaySrc).toContain('export const ROLE_DISPLAY_LABELS');
    expect(displaySrc).toContain('export const SIGNAL_LABELS');
    expect(displaySrc).toContain('export const fmtNum');
    expect(displaySrc).toContain('export const intentColor');
    expect(displaySrc).toContain('export const kdColor');
    expect(displaySrc).toContain('export function fmtAudience');
    expect(displaySrc).toContain('export function fmtMomentum');
    expect(displaySrc).toContain('export function confidenceStatement');
    expect(displaySrc).toContain('export function confidenceColor');
    expect(displaySrc).toContain('export const roleBadgeClass');
  });
});

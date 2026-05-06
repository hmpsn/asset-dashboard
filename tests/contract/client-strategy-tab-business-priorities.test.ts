import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('client StrategyTab business priorities split', () => {
  it('keeps business-priority rendering behind a focused strategy component', () => {
    const strategyTabSrc = readFileSync('src/components/client/StrategyTab.tsx', 'utf-8'); // readFile-ok - migration guard: StrategyTab should pass business-priority hook state into the extracted section instead of owning its rendered form UI.
    const sectionSrc = readFileSync('src/components/client/strategy/StrategyBusinessPrioritiesSection.tsx', 'utf-8'); // readFile-ok - migration guard: business-priority accordion rendering and input controls live in the extracted section component.

    expect(strategyTabSrc).toContain("from './strategy/StrategyBusinessPrioritiesSection'");
    expect(strategyTabSrc).toContain('<StrategyBusinessPrioritiesSection');
    expect(strategyTabSrc).toContain('const businessPrioritiesRef = useRef<HTMLDivElement>(null)');
    expect(strategyTabSrc).toContain("'business-priorities': businessPrioritiesRef");
    expect(strategyTabSrc).not.toContain('Share business goals and priorities that should shape future strategy recommendations');
    expect(strategyTabSrc).not.toContain('Maximum 10 priorities reached');

    expect(sectionSrc).toContain('export function StrategyBusinessPrioritiesSection');
    expect(sectionSrc).toContain('Guide This Strategy');
    expect(sectionSrc).toContain('priorityCategoryClass');
    expect(sectionSrc).toContain('savePriorities([...priorities');
    expect(sectionSrc).toContain('priorities.length >= 10) return');
    expect(sectionSrc).toContain('addPriority();');
    expect(sectionSrc).toContain('Maximum 10 priorities reached');
  });
});

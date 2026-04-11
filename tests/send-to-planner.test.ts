import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('Send to Planner navigation fix', () => {
  // readFile-ok — migration guard: asserts the deprecated plannerKeyword prop was replaced by fixContext.primaryKeyword and the correct useEffect is present in both components.
  const contentGapsSrc = readFileSync('src/components/strategy/ContentGaps.tsx', 'utf-8'); // readFile-ok
  // readFile-ok — migration guard: asserts the deprecated plannerKeyword prop was replaced by fixContext.primaryKeyword and the correct useEffect is present in both components.
  const pipelineSrc = readFileSync('src/components/ContentPipeline.tsx', 'utf-8'); // readFile-ok

  it('ContentGaps navigates with fixContext.primaryKeyword (not old plannerKeyword)', () => {
    expect(contentGapsSrc).toMatch(/fixContext/);
    expect(contentGapsSrc).toMatch(/primaryKeyword/);
    expect(contentGapsSrc).not.toMatch(/plannerKeyword/);
  });

  it('ContentPipeline has useEffect that switches to briefs tab when fixContext arrives', () => {
    expect(pipelineSrc).toMatch(/useEffect/);
    expect(pipelineSrc).toMatch(/fixContext/);
    expect(pipelineSrc).toMatch(/setActiveTab\s*\(\s*['"]briefs['"]\s*\)/);
  });
});

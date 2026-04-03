import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('Send to Planner navigation fix', () => {
  const contentGapsSrc = readFileSync('src/components/strategy/ContentGaps.tsx', 'utf-8');
  const pipelineSrc = readFileSync('src/components/ContentPipeline.tsx', 'utf-8');

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

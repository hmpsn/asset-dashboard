import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('AI operation registry usage contracts', () => {
  it('keeps representative callAI paths wired to explicit operation ids', () => {
    const expectations: Array<{ path: string; operation: string }> = [
      { path: 'server/content-brief.ts', operation: "operation: 'content-brief-regenerate'" },
      { path: 'server/schema-plan.ts', operation: "operation: 'schema-plan'" },
      { path: 'server/routes/public-analytics.ts', operation: "operation: 'client-search-chat'" },
      { path: 'server/content-decay.ts', operation: "operation: 'content-decay'" },
      { path: 'server/keyword-strategy-ai-synthesis.ts', operation: "operation: 'keyword-strategy'" },
      { path: 'server/workspace-context-generation-job.ts', operation: "operation: 'knowledge-base-gen'" },
      { path: 'server/workspace-context-generation-job.ts', operation: "operation: 'brand-voice-gen'" },
      { path: 'server/workspace-context-generation-job.ts', operation: "operation: 'personas-gen'" },
    ];

    for (const item of expectations) {
      const source = readFileSync(item.path, 'utf-8'); // readFile-ok — operation registry wiring contract for representative callAI paths
      expect(source, item.path).toContain(item.operation);
    }
  });
});


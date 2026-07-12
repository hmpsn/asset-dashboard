import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('AI operation registry usage contracts', () => {
  it('keeps callAI wired to runtime defaults instead of descriptive policy metadata', () => {
    const source = readFileSync('server/ai.ts', 'utf-8'); // readFile-ok — operation registry boundary contract
    expect(source).toContain('getAIOperationRuntimeDefaults');
    expect(source).not.toContain('getAIOperationContract');
    expect(source).not.toContain('getAIOperationPolicyMetadata');
    expect(source).not.toMatch(/operation\w*\?\.(providerIntent|outputMode|executionMode|researchMode|retryPolicy|timeoutProfile)/);
    expect(source).not.toMatch(/\bpolicy(?:Metadata)?\.(providerIntent|outputMode|executionMode|researchMode|retryPolicy|timeoutProfile)/);
  });

  it('keeps representative callAI paths wired to explicit operation ids', () => {
    const expectations: Array<{ path: string; operation: string }> = [
      { path: 'server/brandscript.ts', operation: "operation: 'brandscript-import'" },
      { path: 'server/brandscript.ts', operation: "operation: 'brandscript-complete'" },
      { path: 'server/voice-calibration.ts', operation: "operation: 'voice-calibration'" },
      { path: 'server/voice-calibration.ts', operation: "operation: 'voice-refinement'" },
      { path: 'server/discovery-ingestion.ts', operation: "operation: 'discovery-extraction'" },
      { path: 'server/monthly-digest.ts', operation: "operation: 'monthly-digest'" },
      { path: 'server/content-brief.ts', operation: "operation: 'content-brief-regenerate'" },
      { path: 'server/schema-plan.ts', operation: "operation: 'schema-plan-generate'" },
      { path: 'server/routes/public-analytics.ts', operation: "operation: 'client-search-chat'" },
      { path: 'server/content-decay.ts', operation: "operation: 'content-decay'" },
      { path: 'server/keyword-strategy-synthesis/ai-callers.ts', operation: "operation: 'keyword-strategy'" },
      { path: 'server/workspace-context-generation-job.ts', operation: "operation: 'knowledge-base-gen'" },
      { path: 'server/workspace-context-generation-job.ts', operation: "operation: 'brand-voice-gen'" },
      { path: 'server/workspace-context-generation-job.ts', operation: "operation: 'personas-gen'" },
    ];

    for (const item of expectations) {
      const source = readFileSync(item.path, 'utf-8'); // readFile-ok — operation registry wiring contract for representative callAI paths
      expect(source, item.path).toContain(item.operation);
    }
  });

  it('keeps Monthly Digest on the closed-world structured selection boundary', () => {
    const source = readFileSync('server/monthly-digest.ts', 'utf-8'); // readFile-ok — monthly digest AI trust-boundary contract
    expect(source).toContain('parseMonthlyDigestClauseSelection');
    expect(source).toContain('renderDigestClauses(selectedClauseIds, clauseMap)');
    expect(source).not.toContain('validateDigestSummary');
    expect(source).not.toContain('return candidate');
  });
});

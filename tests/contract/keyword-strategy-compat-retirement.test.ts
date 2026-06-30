import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('keyword strategy compatibility retirement', () => {
  it('keeps strategy generation on background jobs and removes direct client wrappers', () => {
    // Strategy generation moved out of KeywordStrategy.tsx into the useStrategyGeneration
    // hook during the Phase 0 decomposition; the job-orchestration guard follows the code.
    const generationHook = readFileSync('src/components/strategy/hooks/useStrategyGeneration.ts', 'utf-8'); // readFile-ok: compatibility-retirement guard for job orchestration
    const seoApi = readFileSync('src/api/seo.ts', 'utf-8'); // readFile-ok: compatibility-retirement guard for removed direct wrappers
    const streamUtils = readFileSync('src/api/streamUtils.ts', 'utf-8'); // readFile-ok: compatibility-retirement guard for removed SSE helper
    const route = readFileSync('server/routes/keyword-strategy.ts', 'utf-8'); // readFile-ok: compatibility-retirement guard for legacy route deprecation
    const deprecations = readFileSync('scripts/deprecation-lifecycle.ts', 'utf-8'); // readFile-ok: compatibility-retirement guard for lifecycle registry

    expect(generationHook).toContain('startJob(BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY');
    expect(seoApi).not.toContain('generateStrategy:');
    expect(seoApi).not.toContain('streamKeywordStrategy(');
    expect(streamUtils).not.toContain('readSseStream');
    expect(route).toContain('X-Deprecated-Route');
    expect(route).toContain('BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY via /api/jobs');
    expect(deprecations).toContain('keyword-strategy-legacy-sse-route');
    expect(deprecations).toContain('POST /api/webflow/keyword-strategy/:workspaceId');
  });
});

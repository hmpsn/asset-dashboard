import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('keyword strategy compatibility retirement', () => {
  it('keeps strategy generation on background jobs and removes direct client wrappers', () => {
    const panel = readFileSync('src/components/KeywordStrategy.tsx', 'utf-8'); // readFile-ok: compatibility-retirement guard for job orchestration
    const seoApi = readFileSync('src/api/seo.ts', 'utf-8'); // readFile-ok: compatibility-retirement guard for removed direct wrappers
    const streamUtils = readFileSync('src/api/streamUtils.ts', 'utf-8'); // readFile-ok: compatibility-retirement guard for removed SSE helper

    expect(panel).toContain('startJob(BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY');
    expect(seoApi).not.toContain('generateStrategy:');
    expect(seoApi).not.toContain('streamKeywordStrategy(');
    expect(streamUtils).not.toContain('readSseStream');
  });
});

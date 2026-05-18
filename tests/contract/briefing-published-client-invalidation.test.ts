import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');

describe('briefing publish invalidation contract', () => {
  it('BRIEFING_PUBLISHED invalidates client briefing cache key', () => {
    const wsInvalidationPath = join(__dirname, '../../src/hooks/useWsInvalidation.ts');
    const source = readFileSync(wsInvalidationPath, 'utf-8');

    const publishedHandlerMatch = source.match(
      /\[WS_EVENTS\.BRIEFING_PUBLISHED\]:\s*\(\)\s*=>\s*\{([\s\S]*?)\},?\s*\}\);/
    );
    expect(publishedHandlerMatch).toBeTruthy();
    expect(publishedHandlerMatch![1]).toContain('queryKeys.client.briefing(workspaceId)');
  });
});

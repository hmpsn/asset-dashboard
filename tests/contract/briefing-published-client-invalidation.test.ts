import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import { queryKeys } from '../../src/lib/queryKeys';
import { getWorkspaceInvalidationKeys } from '../../src/lib/wsInvalidation';
import { WS_EVENTS } from '../../src/lib/wsEvents';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');

describe('briefing publish invalidation contract', () => {
  it('BRIEFING_PUBLISHED invalidates client briefing cache key', () => {
    const wsInvalidationPath = join(__dirname, '../../src/hooks/useWsInvalidation.ts');
    const source = readFileSync(wsInvalidationPath, 'utf-8');
    const keys = getWorkspaceInvalidationKeys(WS_EVENTS.BRIEFING_PUBLISHED, 'ws-briefing', undefined, 'admin');

    expect(source).toContain('[WS_EVENTS.BRIEFING_PUBLISHED]: () => invalidateRegistry(WS_EVENTS.BRIEFING_PUBLISHED)');
    expect(keys).toContainEqual(queryKeys.client.briefing('ws-briefing'));
  });
});

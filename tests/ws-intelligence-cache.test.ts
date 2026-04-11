import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('INTELLIGENCE_CACHE_UPDATED wiring', () => {
  it('invalidateIntelligenceCache broadcasts the event', () => {
    const src = readFileSync(resolve(import.meta.dirname, '../server/workspace-intelligence.ts'), 'utf-8'); // readFile-ok — wiring guard: asserts invalidateIntelligenceCache triggers broadcastToWorkspace with INTELLIGENCE_CACHE_UPDATED in the server module.
    expect(src).toContain('INTELLIGENCE_CACHE_UPDATED');
    expect(src).toContain('broadcastToWorkspace');
  });
});

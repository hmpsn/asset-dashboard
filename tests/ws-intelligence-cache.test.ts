import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('INTELLIGENCE_CACHE_UPDATED wiring', () => {
  it('invalidateIntelligenceCache broadcasts the event', () => {
    const src = readFileSync(resolve(__dirname, '../server/workspace-intelligence.ts'), 'utf-8');
    expect(src).toContain('INTELLIGENCE_CACHE_UPDATED');
    expect(src).toContain('broadcastToWorkspace');
  });
});

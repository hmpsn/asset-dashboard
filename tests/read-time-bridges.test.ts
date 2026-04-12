import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const serverDir = resolve(import.meta.dirname ?? '.', '..', 'server');

describe('Bridge #8: content decay → repeat decay tagging', () => {
  it('content-decay.ts contains repeat decay check using outcome-tracking', () => {
    const src = readFileSync(resolve(serverDir, 'content-decay.ts'), 'utf-8'); // readFile-ok — bridge wiring guard: asserts Bridge #8 wires content-decay to outcome-tracking for repeat decay tagging via getActionsByPage.
    expect(src).toContain('getActionsByPage');
    expect(src).toContain('repeat_decay');
  });
});

describe('Bridge #9: keyword recommendations → learnings weighting', () => {
  it('keyword-recommendations.ts imports workspace-learnings for KD weighting', () => {
    const src = readFileSync(resolve(serverDir, 'keyword-recommendations.ts'), 'utf-8'); // readFile-ok — bridge wiring guard: asserts Bridge #9 imports workspace-learnings for KD weighting via getWorkspaceLearnings.
    expect(src).toContain('getWorkspaceLearnings');
  });
});

describe('Bridge #14: outcome crons → intelligence cache invalidation', () => {
  it('outcome-crons.ts calls invalidateIntelligenceCache', () => {
    const src = readFileSync(resolve(serverDir, 'outcome-crons.ts'), 'utf-8'); // readFile-ok — bridge wiring guard: asserts Bridge #14 wires outcome crons to cache invalidation via invalidateIntelligenceCache.
    expect(src).toContain('invalidateIntelligenceCache');
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Scheduler intelligence cache invalidation', () => {
  it('scheduled-audits.ts calls invalidateIntelligenceCache', () => {
    const src = readFileSync(resolve(import.meta.dirname, '../server/scheduled-audits.ts'), 'utf-8');
    expect(src).toContain('invalidateIntelligenceCache');
  });

  it('churn-signals.ts calls invalidateIntelligenceCache', () => {
    const src = readFileSync(resolve(import.meta.dirname, '../server/churn-signals.ts'), 'utf-8');
    expect(src).toContain('invalidateIntelligenceCache');
  });

  it('anomaly-detection.ts calls invalidateIntelligenceCache', () => {
    const src = readFileSync(resolve(import.meta.dirname, '../server/anomaly-detection.ts'), 'utf-8');
    expect(src).toContain('invalidateIntelligenceCache');
  });

  it('outcome-crons.ts calls invalidateIntelligenceCache', () => {
    const src = readFileSync(resolve(import.meta.dirname, '../server/outcome-crons.ts'), 'utf-8');
    expect(src).toContain('invalidateIntelligenceCache');
  });
});

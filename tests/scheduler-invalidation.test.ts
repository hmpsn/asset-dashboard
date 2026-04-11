import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Scheduler intelligence cache invalidation', () => {
  it('scheduled-audits.ts calls invalidateIntelligenceCache', () => {
    const src = readFileSync(resolve(import.meta.dirname, '../server/scheduled-audits.ts'), 'utf-8'); // readFile-ok — wiring guard: asserts scheduled-audits.ts calls invalidateIntelligenceCache so AI context stays fresh after each audit run.
    expect(src).toContain('invalidateIntelligenceCache');
  });

  it('churn-signals.ts calls invalidateIntelligenceCache', () => {
    const src = readFileSync(resolve(import.meta.dirname, '../server/churn-signals.ts'), 'utf-8'); // readFile-ok — wiring guard: asserts churn-signals.ts calls invalidateIntelligenceCache so AI context reflects current churn signal state.
    expect(src).toContain('invalidateIntelligenceCache');
  });

  it('anomaly-detection.ts calls invalidateIntelligenceCache', () => {
    const src = readFileSync(resolve(import.meta.dirname, '../server/anomaly-detection.ts'), 'utf-8'); // readFile-ok — wiring guard: asserts anomaly-detection.ts calls invalidateIntelligenceCache so AI context reflects current anomaly state.
    expect(src).toContain('invalidateIntelligenceCache');
  });

  it('outcome-crons.ts calls invalidateIntelligenceCache', () => {
    const src = readFileSync(resolve(import.meta.dirname, '../server/outcome-crons.ts'), 'utf-8'); // readFile-ok — wiring guard: asserts outcome-crons.ts calls invalidateIntelligenceCache so AI context reflects current outcome data.
    expect(src).toContain('invalidateIntelligenceCache');
  });
});

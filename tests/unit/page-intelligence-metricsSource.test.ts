import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

/**
 * Source-level assertions: verifies PageIntelligence.tsx uses the shared
 * MetricsSource type and does NOT contain the old string literal union.
 */
describe('PageIntelligence metricsSource — type contract', () => {
  it('imports MetricsSource from shared/types/keywords', () => {
    const src = readFileSync('src/components/PageIntelligence.tsx', 'utf-8'); // readFile-ok — intentional type contract guard
    expect(src).toContain("from '../../shared/types/keywords");
    expect(src).toContain('MetricsSource');
  });

  it('does NOT contain the old string literal union for metricsSource', () => {
    const src = readFileSync('src/components/PageIntelligence.tsx', 'utf-8'); // readFile-ok — intentional type contract guard
    expect(src).not.toContain("'exact' | 'partial_match' | 'ai_estimate'");
  });
});

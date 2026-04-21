/**
 * Unit tests for the applyBulkKeywordGuards helper in server/helpers.ts.
 * Verifies that AI-hallucinated keyword metrics are zeroed out when SEMRush
 * data was not available during bulk page analysis.
 */
import { describe, it, expect } from 'vitest';
import { applyBulkKeywordGuards } from '../../server/helpers.js';

describe('applyBulkKeywordGuards', () => {
  it('zeros out keywordDifficulty and monthlyVolume when semrushBlock is empty string', () => {
    const analysis: Record<string, unknown> = {
      primaryKeyword: 'seo tips',
      keywordDifficulty: 45,
      monthlyVolume: 1200,
      intent: 'informational',
    };
    applyBulkKeywordGuards(analysis, '');
    expect(analysis.keywordDifficulty).toBe(0);
    expect(analysis.monthlyVolume).toBe(0);
  });

  it('preserves non-metric fields when semrushBlock is empty', () => {
    const analysis: Record<string, unknown> = {
      primaryKeyword: 'seo tips',
      keywordDifficulty: 45,
      monthlyVolume: 1200,
      intent: 'informational',
    };
    applyBulkKeywordGuards(analysis, '');
    expect(analysis.primaryKeyword).toBe('seo tips');
    expect(analysis.intent).toBe('informational');
  });

  it('does NOT zero out metrics when semrushBlock is present', () => {
    const analysis: Record<string, unknown> = {
      primaryKeyword: 'seo tips',
      keywordDifficulty: 45,
      monthlyVolume: 1200,
    };
    applyBulkKeywordGuards(analysis, 'SEMRush data: KD=45, volume=1200');
    expect(analysis.keywordDifficulty).toBe(45);
    expect(analysis.monthlyVolume).toBe(1200);
  });

  it('handles analysis object that already has zero metrics gracefully', () => {
    const analysis: Record<string, unknown> = {
      keywordDifficulty: 0,
      monthlyVolume: 0,
    };
    applyBulkKeywordGuards(analysis, '');
    expect(analysis.keywordDifficulty).toBe(0);
    expect(analysis.monthlyVolume).toBe(0);
  });

  it('handles analysis object missing keyword metric fields', () => {
    const analysis: Record<string, unknown> = { primaryKeyword: 'test' };
    expect(() => applyBulkKeywordGuards(analysis, '')).not.toThrow();
    expect(analysis.keywordDifficulty).toBe(0);
    expect(analysis.monthlyVolume).toBe(0);
  });
});

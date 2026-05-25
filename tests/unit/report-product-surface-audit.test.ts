import { describe, expect, it } from 'vitest';
import { countFeatureAuditHeadlines } from '../../scripts/report-product-surface-audit';

describe('countFeatureAuditHeadlines', () => {
  it('prefers the explicit top numbered headline when present', () => {
    const source = [
      '# Audit',
      '',
      '### 369. Wave 6 Product Surface Audit Artifact',
      '',
      '### 368. Shared Demo Scenario Contract',
      '',
      '### Section Notes',
    ].join('\n');

    expect(countFeatureAuditHeadlines(source)).toBe(369);
  });

  it('falls back to counting numbered entries when no top headline is present', () => {
    const source = [
      '# Audit',
      '',
      '### 3. Third',
      '### 2. Second',
      '### Notes',
      '### 1. First',
    ].join('\n');

    expect(countFeatureAuditHeadlines(source)).toBe(3);
  });
});

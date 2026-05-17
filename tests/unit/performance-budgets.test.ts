import { describe, expect, it } from 'vitest';
import {
  PERFORMANCE_BUDGET_REGISTRY,
  PERFORMANCE_CACHE_EXPECTATIONS,
  PERFORMANCE_ESCALATION_LEVELS,
  buildPerformanceBudgetReport,
  findPerformanceBudgetPolicyGaps,
  formatPerformanceBudgetReportMarkdown,
  parseCliArgs,
} from '../../scripts/performance-budgets.js';

describe('performance budget audit', () => {
  it('builds a valid report with no policy gaps', () => {
    const report = buildPerformanceBudgetReport();

    expect(report.generatedBy).toBe('scripts/performance-budgets.ts');
    expect(report.totalEntries).toBe(PERFORMANCE_BUDGET_REGISTRY.length);
    expect(report.policyGaps).toEqual([]);
  });

  it('keeps cache expectation coverage aligned with the taxonomy', () => {
    const report = buildPerformanceBudgetReport();
    const total = PERFORMANCE_CACHE_EXPECTATIONS.reduce(
      (sum, key) => sum + report.counts.cacheExpectations[key],
      0,
    );
    expect(total).toBe(PERFORMANCE_BUDGET_REGISTRY.length);
  });

  it('keeps escalation coverage aligned with the taxonomy', () => {
    const report = buildPerformanceBudgetReport();
    const total = PERFORMANCE_ESCALATION_LEVELS.reduce(
      (sum, key) => sum + report.counts.escalationLevels[key],
      0,
    );
    expect(total).toBe(PERFORMANCE_BUDGET_REGISTRY.length);
  });

  it('formats markdown with required report sections', () => {
    const markdown = formatPerformanceBudgetReportMarkdown();

    expect(markdown).toContain('# Platform Performance Budget Report');
    expect(markdown).toContain('## Cache Expectation Coverage');
    expect(markdown).toContain('## Escalation Coverage');
    expect(markdown).toContain('## Policy Gaps');
    expect(markdown).toContain('## Budget Registry');
  });

  it('detects duplicate ids and missing escalation details', () => {
    const [first] = PERFORMANCE_BUDGET_REGISTRY;
    const bad = [
      first,
      {
        ...first,
        escalation: {
          ...first.escalation,
          trigger: '',
        },
      },
    ];

    const gaps = findPerformanceBudgetPolicyGaps(bad);
    expect(gaps.some(gap => gap.includes('duplicate id'))).toBe(true);
    expect(gaps.some(gap => gap.includes('escalation trigger is required'))).toBe(true);
  });

  it('parses CLI flags and rejects incompatible combinations', () => {
    expect(parseCliArgs(['--json'])).toEqual({ json: true, markdown: false, help: false });
    expect(parseCliArgs(['--markdown'])).toEqual({ json: false, markdown: true, help: false });
    expect(parseCliArgs(['--help'])).toEqual({ json: false, markdown: false, help: true });
    expect(parseCliArgs(['--json', '--markdown'])).toBeNull();
    expect(parseCliArgs(['--wat'])).toBeNull();
  });
});

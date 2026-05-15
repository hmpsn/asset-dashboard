import { describe, expect, it } from 'vitest';
import {
  buildAdrLogReport,
  findAdrPolicyGaps,
  formatAdrLogReportMarkdown,
  runCli,
} from '../../scripts/adr-log.js';

describe('adr log audit', () => {
  it('builds a report with required topic coverage', () => {
    const report = buildAdrLogReport();
    const issues = findAdrPolicyGaps(report);

    expect(report.generatedBy).toBe('scripts/adr-log.ts');
    expect(report.adrCount).toBeGreaterThanOrEqual(6);
    expect(report.missingTopics).toEqual([]);
    expect(issues).toEqual([]);
  });

  it('detects missing headers', () => {
    const report = buildAdrLogReport();
    const mutated = {
      ...report,
      files: [{ ...report.files[0], missingHeaders: ['## Consequences'] }],
    };

    const issues = findAdrPolicyGaps(mutated);
    expect(issues.some(issue => issue.includes('missing headers'))).toBe(true);
  });

  it('formats markdown with required sections', () => {
    const report = buildAdrLogReport();
    const issues = findAdrPolicyGaps(report);
    const markdown = formatAdrLogReportMarkdown(report, issues);

    expect(markdown).toContain('# ADR Log Report');
    expect(markdown).toContain('## ADR Files');
    expect(markdown).toContain('## Policy Gaps');
  });

  it('cli rejects unknown args and accepts help/json', () => {
    expect(runCli(['--help'])).toBe(0);
    expect(runCli(['--json'])).toBe(0);
    expect(runCli(['--wat'])).toBe(1);
  });
});

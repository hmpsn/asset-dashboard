import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildPlatformHealthCadenceReport,
  findCadencePolicyGaps,
  formatPlatformHealthCadenceMarkdown,
  parseCliArgs,
} from '../../scripts/platform-health-cadence.js';

const roadmap = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'data/roadmap.json'), 'utf8'),
) as {
  sprints: Array<{ id: string; items: Array<{ id: string }> }>;
};
const cadence = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'data/platform-health-cadence.json'), 'utf8'),
) as {
  checkpoints: Array<{
    roadmapSprintId: string;
    roadmapItemIds: string[];
    metrics: { oversizedModulesBefore: number; oversizedModulesAfter: number };
  }>;
};

describe('platform health cadence audit', () => {
  it('builds a valid report for the seeded cadence contract', () => {
    const report = buildPlatformHealthCadenceReport(cadence, roadmap, '2026-05-15');
    expect(report.generatedBy).toBe('scripts/platform-health-cadence.ts');
    expect(report.checkpointsTracked).toBeGreaterThan(0);
    expect(report.issues).toEqual([]);
  });

  it('detects roadmap-link and metric policy gaps', () => {
    const broken = {
      ...cadence,
      checkpoints: [
        {
          ...cadence.checkpoints[0],
          roadmapSprintId: 'missing-sprint',
          roadmapItemIds: ['missing-item'],
          metrics: {
            ...cadence.checkpoints[0].metrics,
            oversizedModulesAfter: cadence.checkpoints[0].metrics.oversizedModulesBefore + 1,
          },
        },
      ],
    };
    const gaps = findCadencePolicyGaps(broken, roadmap, '2026-05-15');
    expect(gaps.issues.some(issue => issue.includes('unknown roadmap sprint id'))).toBe(true);
    expect(gaps.issues.some(issue => issue.includes('unknown roadmap item id'))).toBe(true);
    expect(gaps.issues.some(issue => issue.includes('oversizedModulesAfter'))).toBe(true);
  });

  it('detects missing/invalid metric fields', () => {
    const broken = {
      ...cadence,
      checkpoints: [
        {
          ...cadence.checkpoints[0],
          metrics: {
            ...cadence.checkpoints[0].metrics,
            docsUpdated: Number.NaN,
          },
        },
      ],
    };
    const gaps = findCadencePolicyGaps(broken, roadmap, '2026-05-15');
    expect(gaps.issues.some(issue => issue.includes('docsUpdated must be a finite integer'))).toBe(true);
  });

  it('detects non-existent evidence paths', () => {
    const broken = {
      ...cadence,
      checkpoints: [
        {
          ...cadence.checkpoints[0],
          evidencePaths: ['docs/does-not-exist.md'],
        },
      ],
    };
    const gaps = findCadencePolicyGaps(broken, roadmap, '2026-05-15');
    expect(gaps.issues.some(issue => issue.includes('evidence path does not exist'))).toBe(true);
  });

  it('renders markdown report sections', () => {
    const report = buildPlatformHealthCadenceReport(cadence, roadmap, '2026-05-15');
    const markdown = formatPlatformHealthCadenceMarkdown(report);
    expect(markdown).toContain('# Platform Health Cadence Report');
    expect(markdown).toContain('## Cadence Contract');
    expect(markdown).toContain('## Next Checkpoint Window');
    expect(markdown).toContain('## Policy Gaps');
  });

  it('parses CLI options with validation', () => {
    expect(parseCliArgs(['--help'])).toEqual(
      expect.objectContaining({ help: true, json: false }),
    );
    expect(parseCliArgs(['--json', '--as-of', '2026-05-15'])).toEqual(
      expect.objectContaining({ json: true, asOf: '2026-05-15' }),
    );
    expect(parseCliArgs(['--as-of', '2026-05-99'])).toBeNull();
    expect(parseCliArgs(['--cadence'])).toBeNull();
  });
});

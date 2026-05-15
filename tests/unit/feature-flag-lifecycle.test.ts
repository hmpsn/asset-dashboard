import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FEATURE_FLAG_CATALOG,
  FEATURE_FLAG_AUDIT_CADENCES,
  FEATURE_FLAG_GROUPS,
  FEATURE_FLAG_KEYS,
  LEGACY_FEATURE_FLAG_ROADMAP_IDS,
} from '../../shared/types/feature-flags.js';
import {
  buildFeatureFlagLifecycleReport,
  collectRoadmapItemIds,
  formatFeatureFlagLifecycleReportMarkdown,
  isLegacyRoadmapLink,
  parseCliArgs,
  parseIsoDateUtc,
} from '../../scripts/feature-flag-lifecycle.js';
import type { RoadmapData } from '../../shared/types/roadmap.js';

const ROADMAP_PATH = path.resolve(process.cwd(), 'data/roadmap.json');

function loadRoadmap(): RoadmapData {
  const raw = fs.readFileSync(ROADMAP_PATH, 'utf8');
  return JSON.parse(raw) as RoadmapData;
}

describe('feature-flag lifecycle audit', () => {
  it('covers every feature flag and keeps lifecycle contract complete', () => {
    const roadmap = loadRoadmap();
    const report = buildFeatureFlagLifecycleReport(roadmap, '2026-05-15');

    expect(report.generatedBy).toBe('scripts/feature-flag-lifecycle.ts');
    expect(report.totalFlags).toBe(FEATURE_FLAG_KEYS.length);
    expect(report.rows.length).toBe(FEATURE_FLAG_KEYS.length);
    expect(report.invalidLifecycle).toEqual([]);
    expect(report.missingRoadmapLinks).toEqual([]);
  });

  it('keeps cadence accounting aligned with the available cadence set', () => {
    const roadmap = loadRoadmap();
    const report = buildFeatureFlagLifecycleReport(roadmap, '2026-05-15');

    const cadenceTotal = FEATURE_FLAG_AUDIT_CADENCES.reduce((sum, cadence) => sum + report.cadenceCounts[cadence], 0);
    expect(cadenceTotal).toBe(FEATURE_FLAG_KEYS.length);
  });

  it('builds stable markdown output with contract sections', () => {
    const roadmap = loadRoadmap();
    const report = buildFeatureFlagLifecycleReport(roadmap, '2026-05-15');
    const markdown = formatFeatureFlagLifecycleReportMarkdown(report);

    expect(markdown).toContain('# Feature Flag Lifecycle Report');
    expect(markdown).toContain('## Contract Gaps');
    expect(markdown).toContain('## Review Queue');
    expect(markdown).toContain('Linked Roadmap References');
  });

  it('parses CLI args with explicit as-of and json mode', () => {
    const parsed = parseCliArgs(['--as-of', '2026-05-15', '--json']);
    expect(parsed).not.toBeNull();
    expect(parsed?.asOf).toBe('2026-05-15');
    expect(parsed?.json).toBe(true);
  });

  it('recognizes legacy roadmap links explicitly', () => {
    for (const legacyId of LEGACY_FEATURE_FLAG_ROADMAP_IDS) {
      expect(isLegacyRoadmapLink(legacyId)).toBe(true);
    }
    expect(isLegacyRoadmapLink('legacy-outcome-inteligence')).toBe(false);
  });

  it('keeps roadmap id discovery non-empty for validation checks', () => {
    const roadmap = loadRoadmap();
    const ids = collectRoadmapItemIds(roadmap);

    expect(ids.has('platform-confidence-feature-flag-lifecycle')).toBe(true);
    expect(ids.size).toBeGreaterThan(20);
  });

  it('validates ISO date parsing for strict YYYY-MM-DD input', () => {
    expect(parseIsoDateUtc('2026-05-15')).not.toBeNull();
    expect(parseIsoDateUtc('2026-13-01')).toBeNull();
    expect(parseIsoDateUtc('2026/05/15')).toBeNull();
  });

  it('rejects missing values for --as-of and --roadmap', () => {
    expect(parseCliArgs(['--as-of'])).toBeNull();
    expect(parseCliArgs(['--roadmap'])).toBeNull();
  });

  it('keeps grouping list and catalog groups in lockstep', () => {
    const seen = new Set<string>();

    for (const group of FEATURE_FLAG_GROUPS) {
      for (const key of group.keys) {
        expect(FEATURE_FLAG_CATALOG[key].group).toBe(group.label);
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }

    expect(seen.size).toBe(FEATURE_FLAG_KEYS.length);
    for (const key of FEATURE_FLAG_KEYS) {
      expect(seen.has(key)).toBe(true);
    }
  });
});

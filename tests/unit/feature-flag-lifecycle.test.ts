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
  addDaysToIsoDate,
  buildFeatureFlagLifecycleReport,
  collectRoadmapItemIds,
  formatFeatureFlagLifecycleReportMarkdown,
  isLegacyRoadmapLink,
  parseCliArgs,
  parseIsoDateUtc,
  PERMANENTLY_EXEMPT_FLAGS,
} from '../../scripts/feature-flag-lifecycle.js';
import type { RoadmapData } from '../../shared/types/roadmap.js';

const ROADMAP_PATH = path.resolve(process.cwd(), 'data/roadmap.json');
const ROADMAP_ARCHIVE_PATH = path.resolve(process.cwd(), 'data/roadmap.archive.json');
const CURRENT_AUDIT_AS_OF = '2026-07-13';

// Shipped roadmap items move to roadmap.archive.json; a flag's linkedRoadmapItemId still
// references its archived item until the flag is retired, so resolve links against BOTH
// files (mirrors the archive-aware merge in feature-flag-lifecycle.ts main()).
function loadRoadmap(): RoadmapData {
  const roadmap = JSON.parse(fs.readFileSync(ROADMAP_PATH, 'utf8')) as RoadmapData;
  const archivedSprints = fs.existsSync(ROADMAP_ARCHIVE_PATH)
    ? ((JSON.parse(fs.readFileSync(ROADMAP_ARCHIVE_PATH, 'utf8')) as RoadmapData).sprints ?? [])
    : [];
  return { sprints: [...roadmap.sprints, ...archivedSprints] };
}

describe('feature-flag lifecycle audit', () => {
  it('covers every feature flag and keeps lifecycle contract complete', () => {
    const roadmap = loadRoadmap();
    const report = buildFeatureFlagLifecycleReport(roadmap, CURRENT_AUDIT_AS_OF);

    expect(report.generatedBy).toBe('scripts/feature-flag-lifecycle.ts');
    expect(report.totalFlags).toBe(FEATURE_FLAG_KEYS.length);
    expect(report.rows.length).toBe(FEATURE_FLAG_KEYS.length);
    expect(report.invalidLifecycle).toEqual([]);
    expect(report.missingRoadmapLinks).toEqual([]);
  });

  it('keeps cadence accounting aligned with the available cadence set', () => {
    const roadmap = loadRoadmap();
    const report = buildFeatureFlagLifecycleReport(roadmap, CURRENT_AUDIT_AS_OF);

    const cadenceTotal = FEATURE_FLAG_AUDIT_CADENCES.reduce((sum, cadence) => sum + report.cadenceCounts[cadence], 0);
    expect(cadenceTotal).toBe(FEATURE_FLAG_KEYS.length);
  });

  it('builds stable markdown output with contract sections', () => {
    const roadmap = loadRoadmap();
    const report = buildFeatureFlagLifecycleReport(roadmap, CURRENT_AUDIT_AS_OF);
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

  describe('R12b — dated burn-down done-targets', () => {
    it('computes a doneTarget of lastReviewedAt + 3x cadence for a normal active flag', () => {
      const roadmap = loadRoadmap();
      const report = buildFeatureFlagLifecycleReport(roadmap, CURRENT_AUDIT_AS_OF);

      const row = report.rows.find(r => r.key === 'national-serp-tracking');
      expect(row).toBeDefined();
      // national-serp-tracking: weekly cadence (7 days), lastReviewedAt 2026-06-24.
      expect(row?.staleAuditCadence).toBe('weekly');
      expect(row?.doneTarget).toBe(addDaysToIsoDate('2026-06-24', 7 * 3));
      expect(typeof row?.pastDoneTarget).toBe('boolean');
    });

    it('flags pastDoneTarget=true once asOf passes the computed done-target', () => {
      const roadmap = loadRoadmap();
      // national-serp-tracking: weekly cadence, reviewed 2026-06-24 → doneTarget = 2026-07-15.
      const before = buildFeatureFlagLifecycleReport(roadmap, '2026-07-14');
      const after = buildFeatureFlagLifecycleReport(roadmap, '2026-07-16');

      const rowBefore = before.rows.find(r => r.key === 'national-serp-tracking');
      const rowAfter = after.rows.find(r => r.key === 'national-serp-tracking');
      expect(rowBefore?.pastDoneTarget).toBe(false);
      expect(rowAfter?.pastDoneTarget).toBe(true);
      expect(after.pastDoneTargetCount).toBeGreaterThan(0);
    });

    it('keeps the two P0 generation flags reserved and outside lifecycle burn-down queues', () => {
      const roadmap = loadRoadmap();
      const report = buildFeatureFlagLifecycleReport(roadmap, CURRENT_AUDIT_AS_OF);

      const reservedRows = report.rows.filter(
        r => FEATURE_FLAG_CATALOG[r.key].lifecycle.status === 'reserved',
      );
      expect(reservedRows.map(row => row.key).sort()).toEqual([
        'brand-deliverable-generation',
        'content-matrix-generation',
      ]);

      for (const row of reservedRows) {
        expect(row.doneTarget).toBeNull();
        expect(row.pastDoneTarget).toBe(false);
        expect(row.reviewDue).toBe(false);
        expect(row.staleCandidate).toBe(false);
      }
    });

    it('includes a Burn-Down Done Targets section in the markdown report', () => {
      const roadmap = loadRoadmap();
      const report = buildFeatureFlagLifecycleReport(roadmap, CURRENT_AUDIT_AS_OF);
      const markdown = formatFeatureFlagLifecycleReportMarkdown(report);

      expect(markdown).toContain('## Burn-Down Done Targets');
      expect(markdown).toContain('done-target');
    });

    it('addDaysToIsoDate is pure/deterministic and UTC-safe', () => {
      expect(addDaysToIsoDate('2026-06-02', 21)).toBe('2026-06-23');
      expect(addDaysToIsoDate('2026-01-01', 0)).toBe('2026-01-01');
      expect(addDaysToIsoDate('not-a-date', 7)).toBeNull();
    });
  });

  describe('R12b — permanent retirement exemption', () => {
    it('keeps strategy-trust-ladder-autosend in the catalog', () => {
      expect(FEATURE_FLAG_CATALOG['strategy-trust-ladder-autosend']).toBeDefined();
    });

    it('lists strategy-trust-ladder-autosend in PERMANENTLY_EXEMPT_FLAGS', () => {
      expect(PERMANENTLY_EXEMPT_FLAGS.has('strategy-trust-ladder-autosend')).toBe(true);
    });

    it('never marks strategy-trust-ladder-autosend reviewDue, staleCandidate, or with a doneTarget — at any as-of date, however far in the future', () => {
      const roadmap = loadRoadmap();
      // Push `asOf` far past every cadence threshold to prove the exemption holds
      // indefinitely, not just at the current audit anchor.
      const farFuture = '2099-01-01';
      const report = buildFeatureFlagLifecycleReport(roadmap, farFuture);

      const row = report.rows.find(r => r.key === 'strategy-trust-ladder-autosend');
      expect(row).toBeDefined();
      expect(row?.permanentlyExempt).toBe(true);
      expect(row?.reviewDue).toBe(false);
      expect(row?.staleCandidate).toBe(false);
      expect(row?.doneTarget).toBeNull();
      expect(row?.pastDoneTarget).toBe(false);
    });

    it('never appears in the Review Queue or Burn-Down Done Targets sections of the markdown report', () => {
      const roadmap = loadRoadmap();
      const report = buildFeatureFlagLifecycleReport(roadmap, '2099-01-01');
      const markdown = formatFeatureFlagLifecycleReportMarkdown(report);

      // Extract just the Review Queue and Burn-Down Done Targets sections.
      const reviewQueueSection = markdown.split('## Review Queue')[1]?.split('## ')[0] ?? '';
      const doneTargetsSection = markdown.split('## Burn-Down Done Targets')[1]?.split('## ')[0] ?? '';
      expect(reviewQueueSection).not.toContain('strategy-trust-ladder-autosend');
      expect(doneTargetsSection).not.toContain('strategy-trust-ladder-autosend');

      // It DOES appear in the dedicated exemption section.
      const exemptSection = markdown.split('## Permanently Exempt')[1] ?? '';
      expect(exemptSection).toContain('strategy-trust-ladder-autosend');
    });

    it('is counted in permanentlyExemptCount', () => {
      const roadmap = loadRoadmap();
      const report = buildFeatureFlagLifecycleReport(roadmap, CURRENT_AUDIT_AS_OF);
      expect(report.permanentlyExemptCount).toBe(PERMANENTLY_EXEMPT_FLAGS.size);
    });
  });
});

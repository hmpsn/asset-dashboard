#!/usr/bin/env tsx

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  FEATURE_FLAGS,
  FEATURE_FLAG_AUDIT_CADENCES,
  FEATURE_FLAG_CATALOG,
  FEATURE_FLAG_KEYS,
  LEGACY_FEATURE_FLAG_ROADMAP_IDS,
  type FeatureFlagAuditCadence,
  type FeatureFlagKey,
} from '../shared/types/feature-flags.js';
import type { RoadmapData } from '../shared/types/roadmap.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROADMAP_PATH = path.resolve(__dirname, '../data/roadmap.json');

const CADENCE_DAYS: Record<FeatureFlagAuditCadence, number> = {
  weekly: 7,
  monthly: 30,
  quarterly: 90,
};

/**
 * Burn-down multiplier applied to a flag's stale-audit cadence to derive its
 * dated done-target (`doneTarget`). Mirrors the existing `staleCandidate`
 * "3x cadence" horizon (see `buildFeatureFlagLifecycleReport` below) so the
 * dated target and the stale-candidate flag agree on what "overdue" means:
 * a flag is expected to reach a removal decision within 3 audit cycles of
 * its last review, not linger indefinitely.
 */
const DONE_TARGET_CADENCE_MULTIPLIER = 3;

/**
 * Flags that are PERMANENTLY EXEMPT from the burn-down / retirement queue.
 * These are deliberate, indefinite safety gates — not rollout scaffolding —
 * so they never get a dated done-target and must never appear in the
 * "ready to retire" or stale-candidate queue regardless of age.
 *
 * 'strategy-trust-ladder-autosend': auto-send is intentionally never-on until
 * a decoupled-tick + operator-veto review window ships (see the flag's
 * removalCondition in shared/types/feature-flags.ts). Do not remove this
 * entry without a signed-off replacement safety mechanism.
 */
export const PERMANENTLY_EXEMPT_FLAGS: ReadonlySet<FeatureFlagKey> = new Set([
  'strategy-trust-ladder-autosend',
]);

export interface FeatureFlagLifecycleAuditRow {
  key: FeatureFlagKey;
  label: string;
  group: string;
  owner: string;
  createdAt: string;
  lastReviewedAt: string;
  staleAuditCadence: FeatureFlagAuditCadence;
  reviewDue: boolean;
  staleCandidate: boolean;
  daysSinceCreated: number | null;
  daysSinceReview: number | null;
  linkedRoadmapItemId: string;
  roadmapLinkValid: boolean;
  rolloutTarget: string;
  removalCondition: string;
  /** True for flags in `PERMANENTLY_EXEMPT_FLAGS` — never review-due, never stale,
   *  never assigned a `doneTarget`. Institutionalizes intentional indefinite gates
   *  (e.g. safety kill-switches) so the burn-down queue never nags them or lists
   *  them as ready to retire. */
  permanentlyExempt: boolean;
  /**
   * Dated done-target (`YYYY-MM-DD`) by which this flag should reach a removal
   * decision — `lastReviewedAt + (cadenceDays * DONE_TARGET_CADENCE_MULTIPLIER)`.
   * `null` for permanently-exempt flags (no target — see `permanentlyExempt`) and
   * for reserved flags (status: 'reserved' — gating code isn't wired yet, so a
   * burn-down date would be meaningless until the feature ships).
   */
  doneTarget: string | null;
  /** True when `asOf` is past `doneTarget`. Always false when `doneTarget` is null. */
  pastDoneTarget: boolean;
}

export interface FeatureFlagLifecycleReport {
  generatedBy: 'scripts/feature-flag-lifecycle.ts';
  generatedAt: string;
  asOf: string;
  totalFlags: number;
  reviewDueCount: number;
  staleCandidateCount: number;
  /** Count of rows with a non-null `doneTarget` that is <= `asOf`. */
  pastDoneTargetCount: number;
  /** Count of rows in `PERMANENTLY_EXEMPT_FLAGS`. */
  permanentlyExemptCount: number;
  invalidLifecycle: string[];
  missingRoadmapLinks: string[];
  cadenceCounts: Record<FeatureFlagAuditCadence, number>;
  rows: FeatureFlagLifecycleAuditRow[];
}

export function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function parseIsoDateUtc(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.getUTCFullYear() !== year) return null;
  if (parsed.getUTCMonth() + 1 !== month) return null;
  if (parsed.getUTCDate() !== day) return null;

  return parsed;
}

export function daysBetween(fromIso: string, toIso: string): number | null {
  const from = parseIsoDateUtc(fromIso);
  const to = parseIsoDateUtc(toIso);
  if (!from || !to) return null;

  const diffMs = to.getTime() - from.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

/** Adds `days` (may be 0) to an ISO `YYYY-MM-DD` date and returns the result as
 *  an ISO date string. Pure/deterministic (UTC-based, no `Date.now()`) so callers
 *  in tests can pass a fixed `asOf` anchor and get a stable result. Returns null
 *  if `fromIso` fails strict YYYY-MM-DD parsing. */
export function addDaysToIsoDate(fromIso: string, days: number): string | null {
  const from = parseIsoDateUtc(fromIso);
  if (!from) return null;

  const result = new Date(from.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return toIsoDate(result);
}

export function collectRoadmapItemIds(roadmap: RoadmapData): Set<string> {
  const ids = new Set<string>();
  for (const sprint of roadmap.sprints) {
    for (const item of sprint.items) {
      ids.add(String(item.id));
    }
  }
  return ids;
}

export function isLegacyRoadmapLink(linkedRoadmapItemId: string): boolean {
  return LEGACY_FEATURE_FLAG_ROADMAP_IDS.includes(linkedRoadmapItemId);
}

export function buildFeatureFlagLifecycleReport(
  roadmap: RoadmapData,
  asOfIso: string,
): FeatureFlagLifecycleReport {
  const roadmapIds = collectRoadmapItemIds(roadmap);
  const invalidLifecycle: string[] = [];
  const missingRoadmapLinks: string[] = [];

  const cadenceCounts = FEATURE_FLAG_AUDIT_CADENCES.reduce((acc, cadence) => {
    acc[cadence] = 0;
    return acc;
  }, {} as Record<FeatureFlagAuditCadence, number>);

  const rows = FEATURE_FLAG_KEYS.map((key): FeatureFlagLifecycleAuditRow => {
    const meta = FEATURE_FLAG_CATALOG[key];
    const lifecycle = meta.lifecycle;

    cadenceCounts[lifecycle.staleAuditCadence] += 1;

    const daysSinceCreated = daysBetween(lifecycle.createdAt, asOfIso);
    const daysSinceReview = daysBetween(lifecycle.lastReviewedAt, asOfIso);
    const cadenceThreshold = CADENCE_DAYS[lifecycle.staleAuditCadence];

    const createdDateValid = parseIsoDateUtc(lifecycle.createdAt) != null;
    const reviewDateValid = parseIsoDateUtc(lifecycle.lastReviewedAt) != null;

    if (!createdDateValid) {
      invalidLifecycle.push(`${key}: invalid createdAt (${lifecycle.createdAt})`);
    }
    if (!reviewDateValid) {
      invalidLifecycle.push(`${key}: invalid lastReviewedAt (${lifecycle.lastReviewedAt})`);
    }
    if (daysSinceCreated != null && daysSinceCreated < 0) {
      invalidLifecycle.push(`${key}: createdAt is in the future (${lifecycle.createdAt})`);
    }
    if (daysSinceReview != null && daysSinceReview < 0) {
      invalidLifecycle.push(`${key}: lastReviewedAt is in the future (${lifecycle.lastReviewedAt})`);
    }

    // Reserved flags (catalog pre-registered for an in-progress/deferred feature whose gating code
    // isn't wired yet) are intentionally unwired — exempt them from the review-due/stale nag so
    // genuine phantom flags stay distinguishable. They flip to active/omit when the gating ships.
    const reserved = lifecycle.status === 'reserved';
    // Permanently-exempt flags (PERMANENTLY_EXEMPT_FLAGS — deliberate indefinite safety gates,
    // not rollout scaffolding) never enter the review-due/stale-candidate queue regardless of age.
    const permanentlyExempt = PERMANENTLY_EXEMPT_FLAGS.has(key);
    const reviewDue = !reserved && !permanentlyExempt && daysSinceReview != null && daysSinceReview > cadenceThreshold;
    const staleCandidate =
      reviewDue &&
      daysSinceCreated != null &&
      daysSinceCreated > cadenceThreshold * 3 &&
      FEATURE_FLAGS[key] === false;

    // Dated done-target: the burn-down date by which this flag should reach a removal decision.
    // Permanently-exempt and reserved flags get no target — a burn-down date is meaningless for a
    // deliberate indefinite gate (exempt) or a feature whose gating code isn't wired yet (reserved).
    const doneTarget =
      permanentlyExempt || reserved
        ? null
        : addDaysToIsoDate(lifecycle.lastReviewedAt, cadenceThreshold * DONE_TARGET_CADENCE_MULTIPLIER);
    const daysPastDoneTarget = doneTarget != null ? daysBetween(doneTarget, asOfIso) : null;
    const pastDoneTarget = daysPastDoneTarget != null && daysPastDoneTarget >= 0;

    const roadmapLinkValid =
      isLegacyRoadmapLink(lifecycle.linkedRoadmapItemId) || roadmapIds.has(lifecycle.linkedRoadmapItemId);

    if (!roadmapLinkValid) {
      missingRoadmapLinks.push(`${key}: ${lifecycle.linkedRoadmapItemId}`);
    }

    return {
      key,
      label: meta.label,
      group: meta.group,
      owner: lifecycle.owner,
      createdAt: lifecycle.createdAt,
      lastReviewedAt: lifecycle.lastReviewedAt,
      staleAuditCadence: lifecycle.staleAuditCadence,
      reviewDue,
      staleCandidate,
      daysSinceCreated,
      daysSinceReview,
      permanentlyExempt,
      doneTarget,
      pastDoneTarget,
      linkedRoadmapItemId: lifecycle.linkedRoadmapItemId,
      roadmapLinkValid,
      rolloutTarget: lifecycle.rolloutTarget,
      removalCondition: lifecycle.removalCondition,
    };
  });

  rows.sort((a, b) => {
    if (a.reviewDue !== b.reviewDue) return a.reviewDue ? -1 : 1;
    if (a.staleCandidate !== b.staleCandidate) return a.staleCandidate ? -1 : 1;
    return a.key.localeCompare(b.key);
  });

  return {
    generatedBy: 'scripts/feature-flag-lifecycle.ts',
    generatedAt: new Date().toISOString(),
    asOf: asOfIso,
    totalFlags: rows.length,
    reviewDueCount: rows.filter(row => row.reviewDue).length,
    staleCandidateCount: rows.filter(row => row.staleCandidate).length,
    pastDoneTargetCount: rows.filter(row => row.pastDoneTarget).length,
    permanentlyExemptCount: rows.filter(row => row.permanentlyExempt).length,
    invalidLifecycle,
    missingRoadmapLinks,
    cadenceCounts,
    rows,
  };
}

export function formatFeatureFlagLifecycleReportMarkdown(report: FeatureFlagLifecycleReport): string {
  const lines: string[] = [];
  lines.push('# Feature Flag Lifecycle Report');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- As of: ${report.asOf}`);
  lines.push(`- Total flags: ${report.totalFlags}`);
  lines.push(`- Review due: ${report.reviewDueCount}`);
  lines.push(`- Stale candidates: ${report.staleCandidateCount}`);
  lines.push(`- Past done-target: ${report.pastDoneTargetCount}`);
  lines.push(`- Permanently exempt: ${report.permanentlyExemptCount}`);
  lines.push('');

  lines.push('## Cadence Coverage');
  for (const cadence of FEATURE_FLAG_AUDIT_CADENCES) {
    lines.push(`- ${cadence}: ${report.cadenceCounts[cadence]}`);
  }
  lines.push('');

  lines.push('## Contract Gaps');
  if (report.invalidLifecycle.length === 0 && report.missingRoadmapLinks.length === 0) {
    lines.push('- none');
  } else {
    for (const issue of report.invalidLifecycle) lines.push(`- ${issue}`);
    for (const issue of report.missingRoadmapLinks) lines.push(`- ${issue}`);
  }
  lines.push('');

  lines.push('## Review Queue');
  const dueRows = report.rows.filter(row => row.reviewDue || row.staleCandidate);
  if (dueRows.length === 0) {
    lines.push('- No flags are review-due on the selected date.');
  } else {
    for (const row of dueRows) {
      const staleMarker = row.staleCandidate ? ' · stale-candidate' : '';
      const targetNote = row.doneTarget
        ? ` · done-target ${row.doneTarget}${row.pastDoneTarget ? ' (PAST DUE)' : ''}`
        : '';
      lines.push(
        `- ${row.key} (${row.group}) — owner ${row.owner}, reviewed ${row.lastReviewedAt}, cadence ${row.staleAuditCadence}${staleMarker}${targetNote}`,
      );
    }
  }
  lines.push('');

  lines.push('## Burn-Down Done Targets');
  lines.push('Every non-exempt, non-reserved flag gets a dated done-target — the date by which it');
  lines.push('should reach a removal decision (promote to default + delete flag, or explicitly');
  lines.push('re-scope) — so the burn-down is trackable instead of open-ended.');
  lines.push('');
  const targetRows = report.rows
    .filter(row => !row.permanentlyExempt)
    .slice()
    .sort((a, b) => {
      if (a.doneTarget == null && b.doneTarget == null) return a.key.localeCompare(b.key);
      if (a.doneTarget == null) return 1;
      if (b.doneTarget == null) return -1;
      return a.doneTarget.localeCompare(b.doneTarget) || a.key.localeCompare(b.key);
    });
  for (const row of targetRows) {
    if (row.doneTarget == null) {
      lines.push(`- ${row.key} (${row.group}) — reserved, no done-target yet`);
    } else {
      lines.push(`- ${row.key} (${row.group}) — done-target ${row.doneTarget}${row.pastDoneTarget ? ' (PAST DUE)' : ''}`);
    }
  }
  lines.push('');

  lines.push('## Permanently Exempt (never review-due, never a retirement target)');
  const exemptRows = report.rows.filter(row => row.permanentlyExempt);
  if (exemptRows.length === 0) {
    lines.push('- none');
  } else {
    for (const row of exemptRows) {
      lines.push(`- ${row.key} (${row.group}) — owner ${row.owner}`);
    }
  }
  lines.push('');

  lines.push('## Linked Roadmap References');
  const uniqueLinks = new Set(report.rows.map(row => row.linkedRoadmapItemId));
  for (const link of Array.from(uniqueLinks).sort()) {
    lines.push(`- ${link}`);
  }

  return `${lines.join('\n')}\n`;
}

function printUsage(): void {
  console.error('Usage: npm run verify:feature-flags -- [--as-of YYYY-MM-DD] [--json] [--roadmap path]');
}

interface CliOptions {
  roadmapPath: string;
  asOf: string;
  json: boolean;
  help: boolean;
}

export function parseCliArgs(args: string[]): CliOptions | null {
  let roadmapPath = DEFAULT_ROADMAP_PATH;
  let asOf = toIsoDate(new Date());
  let json = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--as-of') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        console.error('Missing value for --as-of.');
        return null;
      }
      asOf = value;
      index += 1;
      continue;
    }
    if (arg === '--roadmap') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        console.error('Missing value for --roadmap.');
        return null;
      }
      roadmapPath = path.resolve(process.cwd(), value);
      index += 1;
      continue;
    }

    console.error(`Unknown argument: ${arg}`);
    return null;
  }

  if (parseIsoDateUtc(asOf) == null) {
    console.error(`Invalid --as-of value: ${asOf}. Expected YYYY-MM-DD.`);
    return null;
  }

  return {
    roadmapPath,
    asOf,
    json,
    help,
  };
}

export function loadRoadmap(roadmapPath: string): RoadmapData {
  const raw = fs.readFileSync(roadmapPath, 'utf8');
  return JSON.parse(raw) as RoadmapData;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseCliArgs(argv);
  if (!options || options.help) {
    printUsage();
    process.exit(options?.help ? 0 : 1);
    return;
  }

  const roadmap = loadRoadmap(options.roadmapPath);
  // Shipped roadmap items are moved out to roadmap.archive.json. A feature flag's
  // linkedRoadmapItemId legitimately references its now-archived (shipped) item until the
  // flag itself is retired, so resolve links against BOTH the active roadmap and the archive.
  const archivePath = path.resolve(path.dirname(options.roadmapPath), 'roadmap.archive.json');
  const archivedSprints = fs.existsSync(archivePath)
    ? ((JSON.parse(fs.readFileSync(archivePath, 'utf8')) as RoadmapData).sprints ?? [])
    : [];
  const combined: RoadmapData = { sprints: [...roadmap.sprints, ...archivedSprints] };
  const report = buildFeatureFlagLifecycleReport(combined, options.asOf);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatFeatureFlagLifecycleReportMarkdown(report));
  }

  if (report.invalidLifecycle.length > 0 || report.missingRoadmapLinks.length > 0) {
    process.exit(1);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  void main();
}

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
}

export interface FeatureFlagLifecycleReport {
  generatedBy: 'scripts/feature-flag-lifecycle.ts';
  generatedAt: string;
  asOf: string;
  totalFlags: number;
  reviewDueCount: number;
  staleCandidateCount: number;
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

    const reviewDue = daysSinceReview != null && daysSinceReview > cadenceThreshold;
    const staleCandidate =
      reviewDue &&
      daysSinceCreated != null &&
      daysSinceCreated > cadenceThreshold * 3 &&
      FEATURE_FLAGS[key] === false;

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
      lines.push(
        `- ${row.key} (${row.group}) — owner ${row.owner}, reviewed ${row.lastReviewedAt}, cadence ${row.staleAuditCadence}${staleMarker}`,
      );
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
  const report = buildFeatureFlagLifecycleReport(roadmap, options.asOf);

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

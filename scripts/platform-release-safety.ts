#!/usr/bin/env tsx

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { RoadmapData, RoadmapItem } from '../shared/types/roadmap.js';

export type ReleaseSafetyDeployNote = {
  sprintId: string;
  sprintName: string;
  itemId: string;
  title: string;
  priority: RoadmapItem['priority'] | null;
  shippedAt: string;
  summary: string;
};

export type ReleaseSafetyChecklist = {
  featureClassReleaseChecklist: string[];
  stagingSmokeSuite: string[];
  rollbackChecklist: string[];
  featureFlagRolloutChecklist: string[];
  postReleaseMonitoringWindow: string[];
};

export type ReleaseSafetyReport = {
  generatedBy: 'scripts/platform-release-safety.ts';
  generatedAt: string;
  window: {
    since: string;
    until: string;
    days: number;
  };
  sprintFilter: string | null;
  deployNotes: ReleaseSafetyDeployNote[];
  checklist: ReleaseSafetyChecklist;
};

export type BuildReleaseSafetyOptions = {
  since: string;
  until: string;
  days: number;
  sprintFilter?: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROADMAP_PATH = path.resolve(__dirname, '../data/roadmap.json');
const DEFAULT_WINDOW_DAYS = 14;

const FEATURE_CLASS_RELEASE_CHECKLIST = [
  'Confirm applicable feature classes in docs/workflows/feature-class-definition-of-done.md.',
  'Complete docs/workflows/pr-readiness-checklist.md ownership, read-path, broadcasts, and verification gates.',
  'Confirm all required validation commands passed (typecheck, build, tests, pr-check).',
  'Document owning bounded context and integration surfaces in PR notes.',
];

const STAGING_SMOKE_SUITE = [
  'Verify staging health endpoint: curl https://<STAGING_URL>/api/health.',
  'Run fast platform verification pack: npx tsx scripts/verify-platform.ts --quick.',
  'Run domain smoke matrix report for fast context coverage: npx tsx scripts/platform-domain-smoke-matrix.ts.',
  'Exercise at least one critical admin path and one critical client/public path touched by the PR.',
  'For integration-heavy changes, run integration health + observability checks on a real staging workspace.',
];

const ROLLBACK_CHECKLIST = [
  'Capture rollback trigger conditions before release (error budget, data integrity signals, user-impact threshold).',
  'Prepare revert path (revert PR commit(s) in staging first, then promote to main if required).',
  'Confirm any migration rollback constraints and data-preservation requirements before merge.',
  'Validate fallback behavior if external providers degrade or fail (no phantom success states).',
  'Record operator owner and communication path for rollback execution.',
];

const FEATURE_FLAG_ROLLOUT_CHECKLIST = [
  'List all flags touched and their default state in shared/types/feature-flags.ts.',
  'Define staged rollout plan (staging enable date, production enable criteria, owner).',
  'Confirm kill-switch path (how to disable rapidly without redeploy).',
  'Document cleanup/removal condition for each new or changed flag.',
  'Verify any gated UI/route path has safe behavior when the flag is disabled.',
];

const POST_RELEASE_MONITORING_WINDOW = [
  'Monitor first 30-60 minutes after production release for errors, degraded job runs, and integration failures.',
  'Check platform observability report for affected workspace(s): npm run verify:observability -- --workspace <id> --days 1.',
  'Check data integrity report if release touched persistence/migrations: npm run verify:data-integrity.',
  'Review key user journeys in production (admin + client/public) for regression signals.',
  'Log follow-up actions/bugs immediately and link to the release PR.',
];

function isIsoDate(value: string): boolean {
  return parseIsoDateUtc(value) != null;
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseIsoDateUtc(value: string): Date | null {
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

function parseDays(value: string | undefined): number | null {
  if (!value) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric <= 0) return null;
  return Math.floor(numeric);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function summarizeRoadmapNote(note?: string): string {
  const normalized = normalizeWhitespace(note ?? '');
  if (!normalized) return 'Shipped with no summary note recorded.';

  const shippedPrefix = normalized.match(/Shipped[^:]*:\s*(.+)$/i);
  const candidate = shippedPrefix?.[1] ? normalizeWhitespace(shippedPrefix[1]) : normalized;

  const sentenceSplit = candidate.split(/(?<=[.!?])\s+/);
  const firstSentence = normalizeWhitespace(sentenceSplit[0] ?? candidate);
  if (firstSentence.length <= 220) return firstSentence;
  return `${firstSentence.slice(0, 217).trimEnd()}...`;
}

function isWithinWindow(dateIso: string, sinceIso: string, untilIso: string): boolean {
  return dateIso >= sinceIso && dateIso <= untilIso;
}

export function collectReleaseSafetyDeployNotes(
  roadmap: RoadmapData,
  options: BuildReleaseSafetyOptions,
): ReleaseSafetyDeployNote[] {
  const notes: ReleaseSafetyDeployNote[] = [];

  for (const sprint of roadmap.sprints) {
    if (options.sprintFilter && sprint.id !== options.sprintFilter) continue;

    for (const item of sprint.items) {
      if (item.status !== 'done') continue;
      if (!item.shippedAt || !isIsoDate(item.shippedAt)) continue;
      if (!isWithinWindow(item.shippedAt, options.since, options.until)) continue;

      notes.push({
        sprintId: sprint.id,
        sprintName: sprint.name,
        itemId: String(item.id),
        title: item.title,
        priority: item.priority ?? null,
        shippedAt: item.shippedAt,
        summary: summarizeRoadmapNote(item.notes),
      });
    }
  }

  return notes.sort((a, b) => {
    if (a.shippedAt !== b.shippedAt) return a.shippedAt.localeCompare(b.shippedAt);
    if (a.sprintId !== b.sprintId) return a.sprintId.localeCompare(b.sprintId);
    return a.itemId.localeCompare(b.itemId);
  });
}

export function buildReleaseSafetyChecklist(): ReleaseSafetyChecklist {
  return {
    featureClassReleaseChecklist: [...FEATURE_CLASS_RELEASE_CHECKLIST],
    stagingSmokeSuite: [...STAGING_SMOKE_SUITE],
    rollbackChecklist: [...ROLLBACK_CHECKLIST],
    featureFlagRolloutChecklist: [...FEATURE_FLAG_ROLLOUT_CHECKLIST],
    postReleaseMonitoringWindow: [...POST_RELEASE_MONITORING_WINDOW],
  };
}

export function buildReleaseSafetyReport(
  roadmap: RoadmapData,
  options: BuildReleaseSafetyOptions,
): ReleaseSafetyReport {
  return {
    generatedBy: 'scripts/platform-release-safety.ts',
    generatedAt: new Date().toISOString(),
    window: {
      since: options.since,
      until: options.until,
      days: options.days,
    },
    sprintFilter: options.sprintFilter ?? null,
    deployNotes: collectReleaseSafetyDeployNotes(roadmap, options),
    checklist: buildReleaseSafetyChecklist(),
  };
}

function renderChecklist(title: string, items: string[]): string {
  const lines = [`## ${title}`];
  for (const item of items) {
    lines.push(`- [ ] ${item}`);
  }
  return lines.join('\n');
}

export function formatReleaseSafetyReportMarkdown(report: ReleaseSafetyReport): string {
  const lines: string[] = [];
  lines.push('# Release Safety Report');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Window: ${report.window.since} → ${report.window.until} (${report.window.days} day window)`);
  lines.push(`- Sprint filter: ${report.sprintFilter ?? 'all'}`);
  lines.push('');

  lines.push('## Deploy Notes (Roadmap-derived)');
  if (report.deployNotes.length === 0) {
    lines.push('- No shipped roadmap items found in the selected window.');
  } else {
    for (const note of report.deployNotes) {
      const priority = note.priority ? ` · ${note.priority}` : '';
      lines.push(`- ${note.shippedAt} — ${note.title} (${note.sprintId}#${note.itemId}${priority})`);
      lines.push(`  - ${note.summary}`);
    }
  }
  lines.push('');

  lines.push(renderChecklist('Feature-Class Release Checklist', report.checklist.featureClassReleaseChecklist));
  lines.push('');
  lines.push(renderChecklist('Staging Smoke Suite', report.checklist.stagingSmokeSuite));
  lines.push('');
  lines.push(renderChecklist('Rollback Checklist', report.checklist.rollbackChecklist));
  lines.push('');
  lines.push(renderChecklist('Feature-Flag Rollout Checklist', report.checklist.featureFlagRolloutChecklist));
  lines.push('');
  lines.push(renderChecklist('Post-Release Monitoring Window', report.checklist.postReleaseMonitoringWindow));

  return `${lines.join('\n')}\n`;
}

type CliOptions = {
  roadmapPath: string;
  since: string;
  until: string;
  days: number;
  sprintFilter?: string;
  json: boolean;
  help: boolean;
};

function printUsage(): void {
  console.error('Usage: npm run verify:release-safety -- [--days 14] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--sprint <sprintId>] [--json] [--roadmap path]');
}

function parseCliArgs(args: string[]): CliOptions | null {
  let roadmapPath = DEFAULT_ROADMAP_PATH;
  let days = DEFAULT_WINDOW_DAYS;
  let json = false;
  let sprintFilter: string | undefined;
  let sinceOverride: string | undefined;
  let untilOverride: string | undefined;
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
    if (arg === '--days') {
      const parsed = parseDays(args[index + 1]);
      if (parsed == null) {
        console.error('Invalid --days value. Expected positive integer.');
        return null;
      }
      days = parsed;
      index += 1;
      continue;
    }
    if (arg === '--since') {
      sinceOverride = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--until') {
      untilOverride = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--sprint') {
      sprintFilter = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--roadmap') {
      roadmapPath = path.resolve(process.cwd(), args[index + 1] ?? DEFAULT_ROADMAP_PATH);
      index += 1;
      continue;
    }
  }

  const today = new Date();
  const until = untilOverride ?? toIsoDate(today);
  if (!isIsoDate(until)) {
    console.error(`Invalid --until value: ${until}. Expected YYYY-MM-DD.`);
    return null;
  }

  const since = sinceOverride ?? (() => {
    const d = new Date(today);
    d.setDate(d.getDate() - days);
    return toIsoDate(d);
  })();
  if (!isIsoDate(since)) {
    console.error(`Invalid --since value: ${since}. Expected YYYY-MM-DD.`);
    return null;
  }
  if (since > until) {
    console.error(`Invalid date window: --since (${since}) cannot be after --until (${until}).`);
    return null;
  }

  return {
    roadmapPath,
    since,
    until,
    days,
    sprintFilter,
    json,
    help,
  };
}

function loadRoadmapFromDisk(roadmapPath: string): RoadmapData {
  const raw = fs.readFileSync(roadmapPath, 'utf8');
  return JSON.parse(raw) as RoadmapData;
}

export function runReleaseSafetyReport(args: string[]): number {
  const parsed = parseCliArgs(args);
  if (!parsed) {
    printUsage();
    return 1;
  }

  if (parsed.help) {
    printUsage();
    return 0;
  }

  if (!fs.existsSync(parsed.roadmapPath)) {
    console.error(`Roadmap file not found: ${parsed.roadmapPath}`);
    return 1;
  }

  const roadmap = loadRoadmapFromDisk(parsed.roadmapPath);
  const report = buildReleaseSafetyReport(roadmap, {
    since: parsed.since,
    until: parsed.until,
    days: parsed.days,
    sprintFilter: parsed.sprintFilter,
  });

  if (parsed.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReleaseSafetyReportMarkdown(report));
  }

  return 0;
}

function runCli(): void {
  process.exit(runReleaseSafetyReport(process.argv.slice(2)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}

#!/usr/bin/env tsx

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { RoadmapData } from '../shared/types/roadmap.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const DEFAULT_CADENCE_PATH = path.resolve(__dirname, '../data/platform-health-cadence.json');
const DEFAULT_ROADMAP_PATH = path.resolve(__dirname, '../data/roadmap.json');

interface CadenceCheckpointMetrics {
  oversizedModulesBefore: number;
  oversizedModulesAfter: number;
  ownershipGapsBefore: number;
  ownershipGapsAfter: number;
  docsUpdated: number;
  contractTestsAdded: number;
  duplicationFixes: number;
  prCheckWarningsClosed: number;
}

interface CadenceCheckpoint {
  id: string;
  label: string;
  completedAt: string;
  owner: string;
  roadmapSprintId: string;
  roadmapItemIds: string[];
  metrics: CadenceCheckpointMetrics;
  evidencePaths: string[];
  notes?: string;
}

interface CadenceConfig {
  sprintIntervalMin: number;
  sprintIntervalMax: number;
  defaultSprintLengthDays: number;
}

interface PlatformHealthCadenceData {
  generatedBy: string;
  cadence: CadenceConfig;
  dimensions: Record<string, string>;
  checkpoints: CadenceCheckpoint[];
}

interface WindowStatus {
  nextWindowOpensOn: string;
  nextWindowClosesOn: string;
  dueNow: boolean;
  overdue: boolean;
  daysUntilOpen: number;
  daysUntilClose: number;
}

export interface PlatformHealthCadenceReport {
  generatedBy: 'scripts/platform-health-cadence.ts';
  generatedAt: string;
  asOf: string;
  cadence: CadenceConfig;
  checkpointsTracked: number;
  latestCheckpointId: string | null;
  latestCheckpointAt: string | null;
  windowStatus: WindowStatus | null;
  issues: string[];
}

interface CliOptions {
  cadencePath: string;
  roadmapPath: string;
  asOf: string;
  json: boolean;
  help: boolean;
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

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string | null {
  const parsed = parseIsoDateUtc(isoDate);
  if (!parsed) return null;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return toIsoDate(parsed);
}

function daysBetween(fromIso: string, toIso: string): number | null {
  const from = parseIsoDateUtc(fromIso);
  const to = parseIsoDateUtc(toIso);
  if (!from || !to) return null;
  const diffMs = to.getTime() - from.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

function loadJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function collectRoadmapReferences(roadmap: RoadmapData): { sprintIds: Set<string>; itemIds: Set<string> } {
  const sprintIds = new Set<string>();
  const itemIds = new Set<string>();

  for (const sprint of roadmap.sprints) {
    sprintIds.add(String(sprint.id));
    for (const item of sprint.items) itemIds.add(String(item.id));
  }

  return { sprintIds, itemIds };
}

export function findCadencePolicyGaps(
  cadenceData: PlatformHealthCadenceData,
  roadmap: RoadmapData,
  asOf: string,
): { issues: string[]; windowStatus: WindowStatus | null; latest: CadenceCheckpoint | null } {
  const issues: string[] = [];
  const cadence = cadenceData.cadence;
  const { sprintIds, itemIds } = collectRoadmapReferences(roadmap);

  if (cadence.sprintIntervalMin < 1) issues.push('cadence.sprintIntervalMin must be >= 1');
  if (cadence.sprintIntervalMax < cadence.sprintIntervalMin) {
    issues.push('cadence.sprintIntervalMax must be >= cadence.sprintIntervalMin');
  }
  if (cadence.defaultSprintLengthDays < 1) issues.push('cadence.defaultSprintLengthDays must be >= 1');

  const seenCheckpointIds = new Set<string>();
  for (const checkpoint of cadenceData.checkpoints) {
    if (seenCheckpointIds.has(checkpoint.id)) issues.push(`duplicate checkpoint id: ${checkpoint.id}`);
    seenCheckpointIds.add(checkpoint.id);

    if (!parseIsoDateUtc(checkpoint.completedAt)) {
      issues.push(`${checkpoint.id}: invalid completedAt (${checkpoint.completedAt})`);
    }
    if (!checkpoint.owner.trim()) issues.push(`${checkpoint.id}: owner is required`);
    if (!checkpoint.roadmapSprintId.trim()) issues.push(`${checkpoint.id}: roadmapSprintId is required`);
    if (!sprintIds.has(checkpoint.roadmapSprintId)) {
      issues.push(`${checkpoint.id}: unknown roadmap sprint id (${checkpoint.roadmapSprintId})`);
    }

    if (checkpoint.roadmapItemIds.length === 0) {
      issues.push(`${checkpoint.id}: at least one roadmap item link is required`);
    }
    for (const linkedItemId of checkpoint.roadmapItemIds) {
      if (!itemIds.has(linkedItemId)) {
        issues.push(`${checkpoint.id}: unknown roadmap item id (${linkedItemId})`);
      }
    }
    if (checkpoint.evidencePaths.length === 0) {
      issues.push(`${checkpoint.id}: at least one evidence path is required`);
    }
    for (const evidencePath of checkpoint.evidencePaths) {
      if (!evidencePath.trim()) {
        issues.push(`${checkpoint.id}: evidence path cannot be empty`);
        continue;
      }
      const absoluteEvidencePath = path.resolve(ROOT, evidencePath);
      if (!fs.existsSync(absoluteEvidencePath)) {
        issues.push(`${checkpoint.id}: evidence path does not exist (${evidencePath})`);
      }
    }

    const metrics = checkpoint.metrics;
    const metricFields: Array<[keyof CadenceCheckpointMetrics, number]> = [
      ['oversizedModulesBefore', metrics.oversizedModulesBefore],
      ['oversizedModulesAfter', metrics.oversizedModulesAfter],
      ['ownershipGapsBefore', metrics.ownershipGapsBefore],
      ['ownershipGapsAfter', metrics.ownershipGapsAfter],
      ['docsUpdated', metrics.docsUpdated],
      ['contractTestsAdded', metrics.contractTestsAdded],
      ['duplicationFixes', metrics.duplicationFixes],
      ['prCheckWarningsClosed', metrics.prCheckWarningsClosed],
    ];
    let metricsAreValid = true;
    for (const [field, value] of metricFields) {
      if (!Number.isFinite(value) || !Number.isInteger(value)) {
        issues.push(`${checkpoint.id}: ${field} must be a finite integer`);
        metricsAreValid = false;
      } else if (value < 0) {
        issues.push(`${checkpoint.id}: ${field} must be >= 0`);
        metricsAreValid = false;
      }
    }

    if (!metricsAreValid) continue;

    if (metrics.oversizedModulesAfter > metrics.oversizedModulesBefore) {
      issues.push(`${checkpoint.id}: oversizedModulesAfter cannot exceed oversizedModulesBefore`);
    }
    if (metrics.ownershipGapsAfter > metrics.ownershipGapsBefore) {
      issues.push(`${checkpoint.id}: ownershipGapsAfter cannot exceed ownershipGapsBefore`);
    }
  }

  const sorted = [...cadenceData.checkpoints].sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  const latest = sorted.length > 0 ? sorted[sorted.length - 1] : null;
  if (!latest) return { issues, windowStatus: null, latest: null };

  const minDays = cadence.sprintIntervalMin * cadence.defaultSprintLengthDays;
  const maxDays = cadence.sprintIntervalMax * cadence.defaultSprintLengthDays;

  const nextWindowOpensOn = addDays(latest.completedAt, minDays);
  const nextWindowClosesOn = addDays(latest.completedAt, maxDays);
  if (!nextWindowOpensOn || !nextWindowClosesOn) {
    issues.push('could not compute cadence window from latest checkpoint date');
    return { issues, windowStatus: null, latest };
  }

  const daysUntilOpen = daysBetween(asOf, nextWindowOpensOn);
  const daysUntilClose = daysBetween(asOf, nextWindowClosesOn);
  if (daysUntilOpen == null || daysUntilClose == null) {
    issues.push('could not compute cadence window day deltas');
    return { issues, windowStatus: null, latest };
  }

  const dueNow = daysUntilOpen <= 0 && daysUntilClose >= 0;
  const overdue = daysUntilClose < 0;

  return {
    issues,
    windowStatus: {
      nextWindowOpensOn,
      nextWindowClosesOn,
      dueNow,
      overdue,
      daysUntilOpen,
      daysUntilClose,
    },
    latest,
  };
}

export function buildPlatformHealthCadenceReport(
  cadenceData: PlatformHealthCadenceData,
  roadmap: RoadmapData,
  asOf: string,
): PlatformHealthCadenceReport {
  const { issues, windowStatus, latest } = findCadencePolicyGaps(cadenceData, roadmap, asOf);
  return {
    generatedBy: 'scripts/platform-health-cadence.ts',
    generatedAt: new Date().toISOString(),
    asOf,
    cadence: cadenceData.cadence,
    checkpointsTracked: cadenceData.checkpoints.length,
    latestCheckpointId: latest?.id ?? null,
    latestCheckpointAt: latest?.completedAt ?? null,
    windowStatus,
    issues,
  };
}

export function formatPlatformHealthCadenceMarkdown(report: PlatformHealthCadenceReport): string {
  const lines: string[] = [];
  lines.push('# Platform Health Cadence Report');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- As of: ${report.asOf}`);
  lines.push(`- Checkpoints tracked: ${report.checkpointsTracked}`);
  lines.push(`- Latest checkpoint: ${report.latestCheckpointId ?? 'none'} (${report.latestCheckpointAt ?? 'n/a'})`);
  lines.push('');
  lines.push('## Cadence Contract');
  lines.push(`- Sprint interval: ${report.cadence.sprintIntervalMin}-${report.cadence.sprintIntervalMax} sprints`);
  lines.push(`- Sprint length baseline: ${report.cadence.defaultSprintLengthDays} days`);
  lines.push('');
  lines.push('## Next Checkpoint Window');
  if (!report.windowStatus) {
    lines.push('- unavailable');
  } else {
    lines.push(`- Opens: ${report.windowStatus.nextWindowOpensOn}`);
    lines.push(`- Closes: ${report.windowStatus.nextWindowClosesOn}`);
    lines.push(`- Due now: ${report.windowStatus.dueNow ? 'yes' : 'no'}`);
    lines.push(`- Overdue: ${report.windowStatus.overdue ? 'yes' : 'no'}`);
  }
  lines.push('');
  lines.push('## Policy Gaps');
  if (report.issues.length === 0) {
    lines.push('- none');
  } else {
    for (const issue of report.issues) lines.push(`- ${issue}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function printUsage(): void {
  console.error(
    'Usage: npm run verify:platform-health-cadence -- [--as-of YYYY-MM-DD] [--json] [--cadence path] [--roadmap path]',
  );
}

export function parseCliArgs(args: string[]): CliOptions | null {
  let cadencePath = DEFAULT_CADENCE_PATH;
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
      if (!value || value.startsWith('--')) return null;
      asOf = value;
      index += 1;
      continue;
    }
    if (arg === '--cadence') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) return null;
      cadencePath = path.resolve(process.cwd(), value);
      index += 1;
      continue;
    }
    if (arg === '--roadmap') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) return null;
      roadmapPath = path.resolve(process.cwd(), value);
      index += 1;
      continue;
    }
    return null;
  }

  if (!parseIsoDateUtc(asOf)) return null;
  return { cadencePath, roadmapPath, asOf, json, help };
}

export function runCli(argv: string[]): number {
  const opts = parseCliArgs(argv);
  if (!opts) {
    printUsage();
    return 1;
  }
  if (opts.help) {
    printUsage();
    return 0;
  }

  const cadenceData = loadJson<PlatformHealthCadenceData>(opts.cadencePath);
  const roadmap = loadJson<RoadmapData>(opts.roadmapPath);
  const report = buildPlatformHealthCadenceReport(cadenceData, roadmap, opts.asOf);

  if (opts.json) console.log(JSON.stringify(report, null, 2));
  else console.log(formatPlatformHealthCadenceMarkdown(report));

  return report.issues.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runCli(process.argv.slice(2)));
}

#!/usr/bin/env tsx

import { buildWorkspaceObservabilityReport, formatWorkspaceObservabilityReportMarkdown } from '../server/platform-observability-report.js';
import { getWorkspace } from '../server/workspaces.js';

type CliOptions = {
  workspaceId: string | null;
  days: number;
  json: boolean;
};

function parseArgs(args: string[]): CliOptions {
  let workspaceId: string | null = null;
  let days = 14;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--workspace' || arg === '--workspace-id') {
      workspaceId = args[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--days') {
      const parsed = Number(args[index + 1]);
      if (Number.isFinite(parsed) && parsed > 0) days = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (arg === '--json') {
      json = true;
    }
  }

  return { workspaceId, days, json };
}

function printUsage(): void {
  console.error('Usage: npm run verify:observability -- --workspace <workspaceId> [--days 14] [--json]');
}

export function runWorkspaceObservabilityReportCli(args: string[]): number {
  const opts = parseArgs(args);
  if (!opts.workspaceId) {
    printUsage();
    return 1;
  }

  if (!getWorkspace(opts.workspaceId)) {
    console.error(`[observability] workspace not found: ${opts.workspaceId}`);
    return 1;
  }

  const report = buildWorkspaceObservabilityReport(opts.workspaceId, { days: opts.days });
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatWorkspaceObservabilityReportMarkdown(report));
  }
  return 0;
}

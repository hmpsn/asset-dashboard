#!/usr/bin/env tsx

import { pathToFileURL } from 'node:url';

import { KEYWORD_IDENTITY_BACKFILL_MODES, type RunKeywordIdentityBackfillOptions } from '../shared/types/keyword-identity.js';
import { runKeywordIdentityV2Backfill } from '../server/keyword-identity-v2-backfill.js';

function argValue(args: string[], key: string): string | undefined {
  const inline = args.find(arg => arg.startsWith(`${key}=`));
  if (inline) {
    const value = inline.slice(key.length + 1);
    if (!value || value.startsWith('--')) throw new Error(`${key} requires a value`);
    return value;
  }
  const index = args.indexOf(key);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${key} requires a value`);
  return value;
}

export function parseKeywordIdentityBackfillOptions(args: string[]): RunKeywordIdentityBackfillOptions {
  const apply = args.includes('--apply');
  const dryRun = args.includes('--dry-run');
  if (apply && dryRun) throw new Error('Choose either --apply or --dry-run, not both');
  const workspaceId = argValue(args, '--workspace-id') ?? argValue(args, '--workspace');
  return {
    mode: apply ? KEYWORD_IDENTITY_BACKFILL_MODES.APPLY : KEYWORD_IDENTITY_BACKFILL_MODES.DRY_RUN,
    ...(workspaceId ? { workspaceId } : {}),
  };
}

function runCli(): void {
  try {
    const options = parseKeywordIdentityBackfillOptions(process.argv.slice(2));
    const report = runKeywordIdentityV2Backfill(options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.totals.errors > 0 ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Keyword identity backfill failed';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runCli();

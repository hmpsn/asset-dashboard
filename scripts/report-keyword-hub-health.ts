#!/usr/bin/env tsx

import { pathToFileURL } from 'node:url';

import {
  buildKeywordCommandCenterInitialView,
  buildKeywordCommandCenterRows,
  buildKeywordCommandCenterSummary,
} from '../server/keyword-command-center.js';
import { getWorkspace, listWorkspaces } from '../server/workspaces.js';
import {
  KEYWORD_COMMAND_CENTER_FILTERS,
  type KeywordCommandCenterRowsQuery,
} from '../shared/types/keyword-command-center.js';

interface TimedResult {
  label: string;
  totalMs: number;
  heapMb: number;
  rows?: number;
  totalRows?: number;
  summaryTotal?: number;
}

function argValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = process.argv.slice(2).find(arg => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function heapMb(): number {
  return Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
}

async function timed<T>(label: string, run: () => Promise<T>, summarize: (result: T) => Partial<TimedResult>): Promise<TimedResult> {
  const startedAt = performance.now();
  const result = await run();
  return {
    label,
    totalMs: Math.round(performance.now() - startedAt),
    heapMb: heapMb(),
    ...summarize(result),
  };
}

function printTable(rows: TimedResult[]): void {
  console.log('| path | totalMs | heapMb | rows | totalRows | summaryTotal |');
  console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const row of rows) {
    console.log([
      `| ${row.label}`,
      row.totalMs,
      row.heapMb,
      row.rows ?? '',
      row.totalRows ?? '',
      `${row.summaryTotal ?? ''} |`,
    ].join(' | '));
  }
}

export async function runKeywordHubHealthReport(): Promise<number> {
  const explicitWorkspaceId = argValue('--workspace-id') ?? argValue('--workspace');
  const workspaceId = explicitWorkspaceId ?? listWorkspaces()[0]?.id;
  if (!workspaceId) {
    console.error('No workspace found. Pass --workspace-id=<id> or seed a local workspace first.');
    return 1;
  }
  if (!getWorkspace(workspaceId)) {
    console.error(`Workspace not found: ${workspaceId}`);
    return 1;
  }

  const firstRowsQuery: KeywordCommandCenterRowsQuery = {
    filter: KEYWORD_COMMAND_CENTER_FILTERS.ALL,
    sort: 'opportunity',
    direction: 'desc',
    page: 1,
    pageSize: 50,
  };
  const localCandidateQuery: KeywordCommandCenterRowsQuery = {
    filter: KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES,
    sort: 'opportunity',
    direction: 'desc',
    page: 1,
    pageSize: 100,
  };

  console.log(`# Keyword Hub Health Report`);
  console.log('');
  console.log(`workspaceId: \`${workspaceId}\``);
  console.log(`startedAt: \`${new Date().toISOString()}\``);
  console.log('');

  const results: TimedResult[] = [];
  results.push(await timed('initial(summary+rows)', () => buildKeywordCommandCenterInitialView(workspaceId, firstRowsQuery, { includeLocalSeo: true }), result => ({
      rows: result?.rows.rows.length ?? 0,
      totalRows: result?.rows.pageInfo.totalRows ?? 0,
      summaryTotal: result?.summary.counts.total ?? 0,
    })));
  results.push(await timed('summary', () => buildKeywordCommandCenterSummary(workspaceId, { includeLocalSeo: true }), result => ({
      summaryTotal: result?.counts.total ?? 0,
    })));
  results.push(await timed('rows(all)', () => buildKeywordCommandCenterRows(workspaceId, firstRowsQuery, { includeLocalSeo: true }), result => ({
      rows: result?.rows.length ?? 0,
      totalRows: result?.pageInfo.totalRows ?? 0,
    })));
  results.push(await timed('rows(local_candidates)', () => buildKeywordCommandCenterRows(workspaceId, localCandidateQuery, { includeLocalSeo: true }), result => ({
      rows: result?.rows.length ?? 0,
      totalRows: result?.pageInfo.totalRows ?? 0,
    })));

  printTable(results);
  console.log('');
  console.log('Use this advisory report in PR notes when changing Keyword Hub first-paint or local-candidate read paths.');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runKeywordHubHealthReport()
    .then(code => {
      process.exitCode = code;
    })
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}

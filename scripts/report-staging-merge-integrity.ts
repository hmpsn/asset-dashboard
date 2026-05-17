#!/usr/bin/env tsx
/**
 * report-staging-merge-integrity.ts
 *
 * Detect merged PRs that may have bypassed staging in stacked-branch flows.
 *
 * Checks:
 * 1) PRs merged into `staging` must have merge commits reachable from origin/staging.
 * 2) PRs merged into non-staging/non-main branches (stacked PRs) must have each commit
 *    patch-equivalent in origin/staging (`git cherry -v origin/staging <commit>` => '-').
 *
 * Known historical exceptions can be tracked in:
 *   data/staging-merge-integrity-exceptions.json
 *
 * Usage:
 *   npx tsx scripts/report-staging-merge-integrity.ts
 *   npx tsx scripts/report-staging-merge-integrity.ts --since-days 180 --limit 300
 *   npx tsx scripts/report-staging-merge-integrity.ts --soft-gate
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type MergedPr = {
  number: number;
  title: string;
  url: string;
  baseRefName: string;
  headRefName: string;
  mergedAt: string;
  mergeCommit?: { oid: string } | null;
};

type PrViewCommits = {
  commits: Array<{ oid: string; messageHeadline: string }>;
};

type ExceptionRecord = {
  pr: number;
  reason: string;
  addedAt: string;
  expiresAt?: string;
};

type ExceptionFile = {
  exceptions: ExceptionRecord[];
};

type Issue = {
  pr: number;
  title: string;
  url: string;
  base: string;
  head: string;
  mergedAt: string;
  kind: 'missing-staging-merge-commit' | 'missing-staging-equivalent-commit';
  commit?: string;
  message: string;
  excepted: boolean;
  exceptionReason?: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EXCEPTIONS_PATH = path.join(ROOT, 'data', 'staging-merge-integrity-exceptions.json');

function parseArgs(argv: string[]) {
  const args = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [key, inlineValue] = arg.split('=');
    if (inlineValue !== undefined) {
      args.set(key, inlineValue);
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args.set(key, next);
      i += 1;
    } else {
      args.set(key, true);
    }
  }
  return args;
}

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
}

function isShallowRepository(): boolean {
  try {
    return run('git', ['rev-parse', '--is-shallow-repository']).trim() === 'true';
  } catch {
    return false;
  }
}

function ensureFullHistoryForIntegrityChecks(): void {
  // CI commonly checks out with fetch-depth=1. Without unshallowing, older
  // merged PR commits may appear "missing" locally and false-fail integrity checks.
  if (isShallowRepository()) {
    run('git', ['fetch', 'origin', '--quiet', '--unshallow']);
  } else {
    run('git', ['fetch', 'origin', '--quiet']);
  }
}

function gitMergeBaseIsAncestor(commit: string, targetRef: string): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, targetRef], {
      cwd: ROOT,
      stdio: 'ignore',
      env: process.env,
    });
    return true;
  } catch {
    return false;
  }
}

function gitCherryStatus(commit: string, againstRef: string): '+' | '-' | '?' {
  try {
    const out = run('git', ['cherry', '-v', againstRef, commit]).trim();
    if (!out) return '?';
    const marker = out[0];
    return marker === '+' || marker === '-' ? marker : '?';
  } catch {
    return '?';
  }
}

function loadExceptions(): Map<number, ExceptionRecord> {
  if (!existsSync(EXCEPTIONS_PATH)) return new Map();
  const parsed = JSON.parse(readFileSync(EXCEPTIONS_PATH, 'utf8')) as ExceptionFile;
  const map = new Map<number, ExceptionRecord>();
  for (const ex of parsed.exceptions ?? []) {
    map.set(ex.pr, ex);
  }
  return map;
}

function isExceptionActive(ex: ExceptionRecord | undefined): boolean {
  if (!ex) return false;
  if (!ex.expiresAt) return true;
  return new Date(ex.expiresAt).getTime() >= Date.now();
}

function isReleasePr(base: string, head: string): boolean {
  return base === 'main' && head === 'staging';
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const limit = Number(args.get('--limit') ?? 250);
  const sinceDays = Number(args.get('--since-days') ?? 180);
  const softGate = Boolean(args.get('--soft-gate'));
  const jsonOut = Boolean(args.get('--json'));

  if (Number.isNaN(limit) || limit < 1) {
    throw new Error(`Invalid --limit: ${String(args.get('--limit'))}`);
  }
  if (Number.isNaN(sinceDays) || sinceDays < 1) {
    throw new Error(`Invalid --since-days: ${String(args.get('--since-days'))}`);
  }

  // Ensure we have enough history locally for ancestry checks.
  ensureFullHistoryForIntegrityChecks();

  const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  const prList = JSON.parse(
    run('gh', [
      'pr',
      'list',
      '--state',
      'merged',
      '--limit',
      String(limit),
      '--json',
      'number,title,url,baseRefName,headRefName,mergedAt,mergeCommit',
    ]),
  ) as MergedPr[];

  const considered = prList.filter(pr => new Date(pr.mergedAt).getTime() >= cutoff);
  const exceptions = loadExceptions();

  const issues: Issue[] = [];
  let stagingBased = 0;
  let stackedBased = 0;
  let releaseBased = 0;

  for (const pr of considered) {
    const ex = exceptions.get(pr.number);
    const excepted = isExceptionActive(ex);

    if (pr.baseRefName === 'staging') {
      stagingBased += 1;
      const mergeOid = pr.mergeCommit?.oid;
      if (!mergeOid || !gitMergeBaseIsAncestor(mergeOid, 'origin/staging')) {
        issues.push({
          pr: pr.number,
          title: pr.title,
          url: pr.url,
          base: pr.baseRefName,
          head: pr.headRefName,
          mergedAt: pr.mergedAt,
          kind: 'missing-staging-merge-commit',
          commit: mergeOid,
          message: 'PR merged to staging but merge commit is not reachable from origin/staging.',
          excepted,
          exceptionReason: ex?.reason,
        });
      }
      continue;
    }

    if (isReleasePr(pr.baseRefName, pr.headRefName)) {
      releaseBased += 1;
      continue;
    }

    if (pr.baseRefName === 'main') continue;

    // Stacked/branch-local merge: ensure code landed in staging via equivalent patches.
    stackedBased += 1;
    const view = JSON.parse(
      run('gh', ['pr', 'view', String(pr.number), '--json', 'commits']),
    ) as PrViewCommits;

    for (const commit of view.commits ?? []) {
      const status = gitCherryStatus(commit.oid, 'origin/staging');
      if (status === '+') {
        issues.push({
          pr: pr.number,
          title: pr.title,
          url: pr.url,
          base: pr.baseRefName,
          head: pr.headRefName,
          mergedAt: pr.mergedAt,
          kind: 'missing-staging-equivalent-commit',
          commit: commit.oid,
          message: `Stacked PR commit is not patch-equivalent in origin/staging: ${commit.messageHeadline}`,
          excepted,
          exceptionReason: ex?.reason,
        });
      }
    }
  }

  const blocking = issues.filter(issue => !issue.excepted);
  const exceptedIssues = issues.filter(issue => issue.excepted);

  const summary = {
    scannedMergedPrs: prList.length,
    consideredByDate: considered.length,
    sinceDays,
    stagingBased,
    stackedBased,
    releaseBased,
    issueCount: issues.length,
    blockingIssueCount: blocking.length,
    exceptedIssueCount: exceptedIssues.length,
  };

  if (jsonOut) {
    console.log(
      JSON.stringify(
        {
          summary,
          blocking,
          excepted: exceptedIssues,
        },
        null,
        2,
      ),
    );
  } else {
    console.log('# Staging Merge Integrity Report');
    console.log('');
    console.log(`Scanned merged PRs: ${summary.scannedMergedPrs}`);
    console.log(`Considered (last ${sinceDays} days): ${summary.consideredByDate}`);
    console.log(`- base=staging PRs: ${summary.stagingBased}`);
    console.log(`- stacked base PRs: ${summary.stackedBased}`);
    console.log(`- staging->main release PRs: ${summary.releaseBased}`);
    console.log('');

    if (blocking.length === 0 && exceptedIssues.length === 0) {
      console.log('✓ No integrity issues detected.');
    } else {
      if (blocking.length > 0) {
        console.log('## Blocking Issues');
        for (const issue of blocking) {
          console.log(
            `- #${issue.pr} (${issue.base} <- ${issue.head}) ${issue.commit?.slice(0, 12) ?? 'no-merge-commit'} :: ${issue.message}`,
          );
          console.log(`  ${issue.url}`);
        }
        console.log('');
      }
      if (exceptedIssues.length > 0) {
        console.log('## Excepted Issues (tracked)');
        for (const issue of exceptedIssues) {
          console.log(
            `- #${issue.pr} (${issue.base} <- ${issue.head}) ${issue.commit?.slice(0, 12) ?? 'no-merge-commit'} :: ${issue.message}`,
          );
          if (issue.exceptionReason) {
            console.log(`  exception: ${issue.exceptionReason}`);
          }
          console.log(`  ${issue.url}`);
        }
        console.log('');
      }
    }
  }

  if (blocking.length > 0 && !softGate) {
    process.exit(1);
  }
}

main();

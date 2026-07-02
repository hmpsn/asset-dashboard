import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const repoRoot = new URL('../../', import.meta.url);

function readRepoFile(relativePath: string): string {
  return readFileSync(new URL(relativePath, repoRoot), 'utf8');
}

describe('CI workflow speed contract', () => {
  it('uses project-aware PR test lanes instead of the legacy mixed shard pool', () => {
    const ciWorkflow = readRepoFile('.github/workflows/ci.yml');

    expect(ciWorkflow).toContain('name: pr-test (${{ matrix.lane.name }})');
    expect(ciWorkflow).toContain('npm run test:component -- --reporter=dot');
    expect(ciWorkflow).toContain('npm run test:contract -- --reporter=dot');
    expect(ciWorkflow).toContain('npm run test:unit -- --reporter=dot --shard=1/2');
    expect(ciWorkflow).toContain('npm run test:unit -- --reporter=dot --shard=2/2');
    expect(ciWorkflow).toContain('npm run test:integration -- --reporter=dot --shard=1/3');
    expect(ciWorkflow).toContain('npm run test:integration -- --reporter=dot --shard=2/3');
    expect(ciWorkflow).toContain('npm run test:integration -- --reporter=dot --shard=3/3');
    expect(ciWorkflow).not.toContain('npm run test -- --reporter=dot --shard=${{ matrix.shard }}/6');
    expect(ciWorkflow).toMatch(/test:\n(?:\s+- '.*'\n)*\s+- '\.github\/workflows\/\*\*'/);
    expect(ciWorkflow).toMatch(/coverage:\n(?:\s+- '.*'\n)*\s+- '\.github\/workflows\/\*\*'/);
  });

  it('caches node_modules so every npm ci in ci.yml is skipped on a cache hit', () => {
    const ci = readRepoFile('.github/workflows/ci.yml');

    // The actual install (better-sqlite3 / sharp are native, so the tree is
    // expensive to rebuild). Restoring it skips npm ci on a hit.
    expect(ci).toContain('path: node_modules');

    // Key must pin OS+arch+node-major+lockfile so a restored tree never carries
    // native binaries built for a different platform. The v1 token is a manual
    // bust lever if a runner-image change ever breaks native ABI compatibility.
    expect(ci).toContain(
      "key: node-modules-v1-${{ runner.os }}-${{ runner.arch }}-node24-${{ hashFiles('package-lock.json') }}",
    );

    // Every `npm ci` must be guarded by a cache-miss check — otherwise the
    // cache is restored AND npm ci reinstalls on top, defeating the point.
    const installs = ci.match(/run: npm ci\b/g) ?? [];
    const guards = ci.match(/if: steps\.node-modules-cache\.outputs\.cache-hit != 'true'/g) ?? [];
    expect(installs.length).toBeGreaterThanOrEqual(3); // quality + test-lane + coverage
    expect(guards.length).toBe(installs.length);
  });

  it('disables Husky installation in every workflow that runs npm ci', () => {
    for (const workflowPath of [
      '.github/workflows/ci.yml',
      '.github/workflows/e2e.yml',
      '.github/workflows/security.yml',
      '.github/workflows/pr-check-nightly.yml',
    ]) {
      const workflow = readRepoFile(workflowPath);

      expect(workflow, `${workflowPath} sets HUSKY=0`).toContain('HUSKY: 0');
      expect(workflow, `${workflowPath} still installs dependencies`).toContain('npm ci');
    }
  });
});

describe('CI spend guardrails', () => {
  const ci = readRepoFile('.github/workflows/ci.yml');
  const e2e = readRepoFile('.github/workflows/e2e.yml');

  it('draft-gates the heavy test matrix so WIP draft PRs run only the fast quality gate', () => {
    // The test matrix must require a NON-draft PR: iterate in a draft PR (only the
    // ~2-min quality gate runs), mark it ready to run the full matrix. Dropping this
    // gate re-bills ~55 runner-min on every WIP push.
    expect(ci).toContain('github.event.pull_request.draft == false');
    // `ready_for_review` must be a PR trigger or marking a draft ready won't start a run.
    expect(ci).toContain('ready_for_review');
  });

  it('keeps e2e PR-only + draft-gated and caches its node_modules (mirrors ci.yml)', () => {
    expect(e2e).toContain('github.event.pull_request.draft == false');
    // e2e shares ci.yml's EXACT node_modules cache key so it hits the same cache.
    expect(e2e).toContain(
      "key: node-modules-v1-${{ runner.os }}-${{ runner.arch }}-node24-${{ hashFiles('package-lock.json') }}",
    );
    // Every npm ci in e2e.yml must be cache-miss-guarded (else cache + reinstall = waste).
    const installs = e2e.match(/run: npm ci\b/g) ?? [];
    const guards = e2e.match(/if: steps\.node-modules-cache\.outputs\.cache-hit != 'true'/g) ?? [];
    expect(installs.length).toBeGreaterThanOrEqual(3); // build + 2 shards + merge-report
    expect(guards.length).toBe(installs.length);
  });

  it('caps every job with timeout-minutes so a hung/OOM job cannot bill to the 6h default', () => {
    // One timeout-minutes per job: ci.yml has 6 jobs, e2e.yml has 5.
    expect((ci.match(/timeout-minutes:/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect((e2e.match(/timeout-minutes:/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});

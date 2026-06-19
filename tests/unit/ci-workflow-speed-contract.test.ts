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

/**
 * Meta-test: every `createTestContext(<port>)` call across the test tree
 * must use a unique port number.
 *
 * Round 2 Task P3.1 of the 2026-04-10 pr-check audit. CLAUDE.md requires
 * each integration test file using `createTestContext()` to allocate a
 * unique port in the 13201+ range. Today the rule is enforced by a
 * `grep -r 'createTestContext('` convention before every PR. When two
 * authors collide on a port number, the second test to run binds to an
 * already-listening socket and either fails with EADDRINUSE (loud) or,
 * worse, succeeds and produces cross-contaminated state (silent). This
 * meta-test converts the convention into a mechanical gate.
 *
 * The regex deliberately only matches literal integer ports. A future
 * `createTestContext(PORTS.FOO)` indirection would need this test
 * updated to walk the constant table.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, lstatSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function repoRoot(): string {
  try {
    const here = fileURLToPath(import.meta.url);
    const candidate = path.resolve(path.dirname(here), '..');
    if (!candidate.includes('@fs') && candidate.startsWith('/')) return candidate;
  } catch {
    // fall through
  }
  return process.cwd();
}

function walkTestFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    // Use `lstatSync` (not `statSync`) so symlinks are not followed —
    // prevents infinite recursion if a symlink inside tests/ ever points
    // upward (e.g. an accidental `tests/self -> ../`). Symlinked test
    // files are intentionally skipped: fixtures are real files.
    const s = lstatSync(full);
    if (s.isSymbolicLink()) continue;
    if (s.isDirectory()) {
      // Skip node_modules / fixtures / snapshots — tests only.
      if (entry === 'node_modules' || entry === '__snapshots__') continue;
      results.push(...walkTestFiles(full));
    } else if (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) {
      results.push(full);
    }
  }
  return results;
}

describe('Meta: createTestContext() port uniqueness', () => {
  it('every literal port passed to createTestContext() is unique across the test tree', () => {
    const root = repoRoot();
    const testDir = path.join(root, 'tests');
    const files = walkTestFiles(testDir);

    // Map port → list of files that claim it. Duplicates produce a
    // list longer than one.
    const portClaims = new Map<number, string[]>();
    // Track files that call createTestContext with a non-literal first
    // argument — they bypass this gate but we report them so a future
    // change can decide whether to tighten the regex.
    const nonLiteralCallers: string[] = [];

    // Literal match: createTestContext( \s* <digits>
    const literalRe = /createTestContext\s*\(\s*(\d+)/g;
    // Any match — if present but literalRe yielded nothing, the caller
    // is using an indirection we don't parse.
    const anyRe = /createTestContext\s*\(/g;

    for (const file of files) {
      const src = readFileSync(file, 'utf-8');
      const rel = path.relative(root, file);
      let literalCount = 0;
      let m: RegExpExecArray | null;
      literalRe.lastIndex = 0;
      while ((m = literalRe.exec(src)) !== null) {
        literalCount += 1;
        const port = Number.parseInt(m[1], 10);
        if (!Number.isFinite(port)) continue;
        if (!portClaims.has(port)) portClaims.set(port, []);
        portClaims.get(port)!.push(rel);
      }
      // If the file calls createTestContext at all but no literal was
      // parsed, note it. This is informational, not a hard failure.
      anyRe.lastIndex = 0;
      const totalCalls = (src.match(anyRe) ?? []).length;
      if (totalCalls > literalCount) {
        nonLiteralCallers.push(rel);
      }
    }

    // Fail loudly on any port claimed by more than one file.
    const collisions = [...portClaims.entries()].filter(([, claimants]) => claimants.length > 1);
    if (collisions.length > 0) {
      const report = collisions
        .map(([port, claimants]) => {
          const unique = [...new Set(claimants)].sort();
          return `  port ${port}:\n` + unique.map((f) => `    - ${f}`).join('\n');
        })
        .join('\n\n');
      throw new Error(
        `createTestContext() port collisions detected:\n\n${report}\n\n` +
        `Each integration test file must bind to a unique port. Check the ` +
        `current range with \`grep -r 'createTestContext(' tests/\` and pick ` +
        `the next free integer.`,
      );
    }

    // Sanity: at least one port must have been parsed, otherwise the
    // regex probably drifted from the actual call sites (e.g. someone
    // introduced a factory indirection without updating this test).
    expect(portClaims.size).toBeGreaterThan(0);

    // Optional informational output on non-literal callers. Do not fail —
    // they might be legitimately using a shared constant.
    if (nonLiteralCallers.length > 0 && process.env.DEBUG_PORT_META) {
      // eslint-disable-next-line no-console
      console.log(
        `[meta-port-uniqueness] ${nonLiteralCallers.length} file(s) call ` +
        `createTestContext() with a non-literal argument:\n  - ` +
        nonLiteralCallers.join('\n  - '),
      );
    }
  });
});

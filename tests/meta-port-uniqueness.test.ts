/**
 * Meta-test: every integration server port strategy across the test tree must be valid.
 *
 * Round 2 Task P3.1 of the 2026-04-10 pr-check audit. CLAUDE.md requires
 * each integration test file using `createTestContext()` to allocate a
 * unique port in the 13201+ range. `createEphemeralTestContext(import.meta.url)`
 * is the behavior-preserving migration path for new or opportunistically
 * simplified tests. Today the literal-path rule is enforced by a
 * `grep -r 'createTestContext('` convention before every PR. When two
 * authors collide on a port number, the second test to run binds to an
 * already-listening socket and either fails with EADDRINUSE (loud) or,
 * worse, succeeds and produces cross-contaminated state (silent). This
 * meta-test converts the convention into a mechanical gate.
 *
 * The literal-port regex deliberately only matches integer ports. Files using
 * `createEphemeralTestContext(import.meta.url)` are treated as a separate
 * valid ownership strategy. Any other call shape is a test bug.
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

describe('Meta: integration server port uniqueness', () => {
  it('every literal integration server port is unique across the test tree', () => {
    const root = repoRoot();
    const testDir = path.join(root, 'tests');
    const files = walkTestFiles(testDir);

    // Map port → list of files that claim it. Duplicates produce a
    // list longer than one. Claims include createTestContext(...) ports and
    // raw server/index.ts spawn helpers that bind their own PORT constants.
    const portClaims = new Map<number, string[]>();
    // Track files that call createTestContext with a first argument we
    // cannot resolve to a number. Local numeric consts like `const PORT = 13322`
    // are resolved so those files stay covered by the uniqueness gate.
    const nonLiteralCallers: string[] = [];

    const numericConstRe = /const\s+([A-Za-z_$][\w$]*)\s*=\s*(\d+)\s*;/g;
    const callRe = /createTestContext\s*\(\s*([A-Za-z_$][\w$]*|\d+)/g;
    // Any match — if present but callRe yielded no resolved port, the caller
    // is using an indirection we don't parse.
    const anyRe = /createTestContext\s*\(/g;
    const ephemeralRe = /createEphemeralTestContext\s*\(/g;
    const validEphemeralRe = /createEphemeralTestContext\s*\(\s*import\.meta\.url\b/g;
    const invalidEphemeralCallers: string[] = [];
    const duplicateEphemeralCallers: string[] = [];

    for (const file of files) {
      const src = readFileSync(file, 'utf-8');
      const rel = path.relative(root, file);
      const isHarness =
        rel === 'tests/meta-port-uniqueness.test.ts'
        || rel === 'tests/unit/test-ports.test.ts';
      const numericConsts = new Map<string, number>();
      let resolvedCount = 0;
      let m: RegExpExecArray | null;

      numericConstRe.lastIndex = 0;
      while ((m = numericConstRe.exec(src)) !== null) {
        numericConsts.set(m[1], Number.parseInt(m[2], 10));
      }

      callRe.lastIndex = 0;
      while ((m = callRe.exec(src)) !== null) {
        const arg = m[1];
        const port = /^\d+$/.test(arg)
          ? Number.parseInt(arg, 10)
          : numericConsts.get(arg);
        if (port === undefined) continue;
        resolvedCount += 1;
        if (!Number.isFinite(port)) continue;
        if (!portClaims.has(port)) portClaims.set(port, []);
        portClaims.get(port)!.push(`${rel}:createTestContext`);
      }

      if (src.includes('server/index.ts')) {
        for (const [name, port] of numericConsts) {
          if (!/PORT/i.test(name)) continue;
          if (!Number.isFinite(port)) continue;
          if (!portClaims.has(port)) portClaims.set(port, []);
          portClaims.get(port)!.push(`${rel}:${name}`);
        }
      }
      // If the file calls createTestContext at all but no literal was
      // parsed, note it. This is informational, not a hard failure.
      anyRe.lastIndex = 0;
      const totalCalls = (src.match(anyRe) ?? []).length;
      const ephemeralCalls = (src.match(ephemeralRe) ?? []).length;
      const validEphemeralCalls = (src.match(validEphemeralRe) ?? []).length;
      if (totalCalls > resolvedCount) {
        const unresolvedLiteralCalls = totalCalls - resolvedCount - ephemeralCalls;
        if (unresolvedLiteralCalls > 0) {
          nonLiteralCallers.push(rel);
        }
      }
      if (!isHarness && ephemeralCalls > validEphemeralCalls) {
        invalidEphemeralCallers.push(rel);
      }
      if (!isHarness && validEphemeralCalls > 1) {
        duplicateEphemeralCallers.push(rel);
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
        `Integration server port collisions detected:\n\n${report}\n\n` +
        `Each integration test file must bind to a unique port. Check both ` +
        `createTestContext(...) calls and raw server/index.ts PORT constants ` +
        `before picking the next free integer.`,
      );
    }

    // Sanity: at least one port must have been parsed, otherwise the
    // regex probably drifted from the actual call sites (e.g. someone
    // introduced a factory indirection without updating this test).
    expect(portClaims.size).toBeGreaterThan(0);

    if (invalidEphemeralCallers.length > 0) {
      throw new Error(
        `createEphemeralTestContext() must be called as createEphemeralTestContext(import.meta.url):\n  - ${
          invalidEphemeralCallers.join('\n  - ')
        }`,
      );
    }
    if (duplicateEphemeralCallers.length > 0) {
      throw new Error(
        `Each test file may call createEphemeralTestContext(import.meta.url) at most once:\n  - ${
          duplicateEphemeralCallers.join('\n  - ')
        }`,
      );
    }

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

  it('createTestContext() server cleanup is awaited', () => {
    const root = repoRoot();
    const files = walkTestFiles(path.join(root, 'tests'));
    const unawaited: string[] = [];

    for (const file of files) {
      const src = readFileSync(file, 'utf-8');
      const rel = path.relative(root, file);
      if (rel === 'tests/meta-port-uniqueness.test.ts' || !src.includes('ctx.stopServer();')) continue;
      src.split('\n').forEach((line, idx) => {
        const code = line.replace(/\/\/.*$/, '');
        if (code.includes('ctx.stopServer();') && !code.includes('await ctx.stopServer();')) {
          unawaited.push(`${rel}:${idx + 1}`);
        }
      });
    }

    if (unawaited.length > 0) {
      throw new Error(
        `createTestContext().stopServer() must be awaited so test server ports ` +
        `are released before the next file starts:\n  - ${unawaited.join('\n  - ')}`,
      );
    }
  });
});

/**
 * Meta-test: integration server ports must use the lock-backed ephemeral
 * allocator. Fixed literal ports are forbidden in normal test files because
 * parallel local agents and CI workers can collide on the same process-global
 * port even when each file chose a unique integer.
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
  if (!lstatSync(dir).isDirectory()) return [];
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

function collectCallExpressions(src: string, callee: string): string[] {
  const calls: string[] = [];
  let searchFrom = 0;
  const needle = `${callee}(`;

  while (searchFrom < src.length) {
    const start = src.indexOf(needle, searchFrom);
    if (start === -1) break;

    let depth = 0;
    let quote: '"' | "'" | '`' | undefined;
    let escaped = false;

    for (let i = start + callee.length; i < src.length; i += 1) {
      const ch = src[i];
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === quote) {
          quote = undefined;
        }
        continue;
      }

      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
      } else if (ch === '(') {
        depth += 1;
      } else if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          calls.push(src.slice(start, i + 1));
          searchFrom = i + 1;
          break;
        }
      }
    }

    if (searchFrom <= start) searchFrom = start + needle.length;
  }

  return calls;
}

function stripLineComment(line: string): string {
  const idx = line.indexOf('//');
  return idx === -1 ? line : line.slice(0, idx);
}

describe('Meta: integration server port strategy', () => {
  it('normal test files use ephemeral test ports', () => {
    const root = repoRoot();
    const files = [
      ...walkTestFiles(path.join(root, 'tests')),
      ...walkTestFiles(path.join(root, 'server/__tests__')),
    ];

    const directFixedContextCallers: string[] = [];
    const fixedListenCallers: string[] = [];
    const invalidEphemeralCallers: string[] = [];
    const duplicateEphemeralContextNames: string[] = [];

    for (const file of files) {
      const src = readFileSync(file, 'utf-8');
      const rel = path.relative(root, file);
      const isHarness =
        rel === 'tests/meta-port-uniqueness.test.ts'
        || rel === 'tests/unit/test-ports.test.ts'
        || rel === 'tests/pr-check.test.ts'
        || rel === 'tests/integration/helpers.ts';
      if (isHarness) continue;

      src.split('\n').forEach((line, idx) => {
        const code = stripLineComment(line);
        if (/\bcreateTestContext\s*\(/.test(code)) {
          directFixedContextCallers.push(`${rel}:${idx + 1}`);
        }
        if (/\blisten\s*\(\s*(?:[1-9][0-9]{3,}|13[0-9]{3})\b/.test(code)) {
          fixedListenCallers.push(`${rel}:${idx + 1}`);
        }
      });

      const fixedPortConstNames = src
        .split('\n')
        .map(line => stripLineComment(line))
        .map(line => /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:13[0-9]{3}|[1-9][0-9]{3,})\b/.exec(line)?.[1])
        .filter((name): name is string => !!name && /PORT/i.test(name));
      if (fixedPortConstNames.length > 0) {
        src.split('\n').forEach((line, idx) => {
          const code = stripLineComment(line);
          for (const name of fixedPortConstNames) {
            if (new RegExp(`\\blisten\\s*\\(\\s*${name}\\b`).test(code)) {
              fixedListenCallers.push(`${rel}:${idx + 1}`);
              break;
            }
          }
        });
      }

      const sourceForCalls = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter(line => !line.trim().startsWith('//'))
        .join('\n');
      const seenContextNames = new Map<string, number>();
      for (const call of collectCallExpressions(sourceForCalls, 'createEphemeralTestContext')) {
        if (!/createEphemeralTestContext\s*\(\s*import\.meta\.url\b/.test(call)) {
          const line = src.slice(0, src.indexOf(call)).split('\n').length;
          invalidEphemeralCallers.push(`${rel}:${line}`);
          continue;
        }
        const contextName = /contextName\s*:\s*['"]([^'"]+)['"]/.exec(call)?.[1] ?? 'default';
        const count = seenContextNames.get(contextName) ?? 0;
        seenContextNames.set(contextName, count + 1);
      }

      for (const [contextName, count] of seenContextNames) {
        if (count > 1) {
          duplicateEphemeralContextNames.push(`${rel}:${contextName}`);
        }
      }
    }

    if (directFixedContextCallers.length > 0) {
      throw new Error(
        `Normal test files must use createEphemeralTestContext(import.meta.url), not createTestContext(port):\n  - ${
          directFixedContextCallers.join('\n  - ')
        }`,
      );
    }

    if (fixedListenCallers.length > 0) {
      throw new Error(
        `Test servers must bind with listen(0, '127.0.0.1') and derive baseUrl from server.address().port:\n  - ${
          fixedListenCallers.join('\n  - ')
        }`,
      );
    }

    if (invalidEphemeralCallers.length > 0) {
      throw new Error(
        `createEphemeralTestContext() must be called as createEphemeralTestContext(import.meta.url):\n  - ${
          invalidEphemeralCallers.join('\n  - ')
        }`,
      );
    }
    if (duplicateEphemeralContextNames.length > 0) {
      throw new Error(
        `Multiple createEphemeralTestContext() calls in one file must use unique contextName values:\n  - ${
          duplicateEphemeralContextNames.join('\n  - ')
        }`,
      );
    }

    expect(files.length).toBeGreaterThan(0);
  });

  it('test context server cleanup is awaited', () => {
    const root = repoRoot();
    const files = walkTestFiles(path.join(root, 'tests'));
    const unawaited: string[] = [];

    for (const file of files) {
      const src = readFileSync(file, 'utf-8');
      const rel = path.relative(root, file);
      if (rel === 'tests/meta-port-uniqueness.test.ts' || !src.includes('.stopServer();')) continue;
      src.split('\n').forEach((line, idx) => {
        const code = line.replace(/\/\/.*$/, '');
        if (code.includes('.stopServer();') && !code.includes('await ')) {
          unawaited.push(`${rel}:${idx + 1}`);
        }
      });
    }

    if (unawaited.length > 0) {
      throw new Error(
        `Test context stopServer() must be awaited so ephemeral ports ` +
        `are released before the next file starts:\n  - ${unawaited.join('\n  - ')}`,
      );
    }
  });
});

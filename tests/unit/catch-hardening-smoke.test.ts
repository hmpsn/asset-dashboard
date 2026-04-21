// tests/unit/catch-hardening-smoke.test.ts
// Smoke test verifying the isProgrammingError pattern is applied in Tier 1 files
// (the highest-risk server files where silent catch blocks would hide wrong AI
// answers or missing client data).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs'; // readFile-ok — structural smoke test reads server source to verify catch-hardening pattern
import { resolve } from 'path';

const SERVER_DIR = resolve(__dirname, '../../server');

/** Read a server file and return its content. */
function readServer(relPath: string): string {
  return readFileSync(resolve(SERVER_DIR, relPath), 'utf-8');
}

/** Count occurrences of a pattern in a string. */
function countMatches(content: string, pattern: RegExp): number {
  return (content.match(pattern) || []).length;
}

describe('Catch hardening — Tier 1 smoke tests', () => {
  // Tier 1 = files where a silent catch would hide wrong AI answers or missing client data.
  // Add a file here if it is a direct dependency of an admin-AI or public-portal response.
  const tier1Files = [
    'admin-chat-context.ts',
    'routes/public-analytics.ts',
    'routes/public-portal.ts',
    'routes/public-content.ts',
    'routes/public-auth.ts',
  ];

  for (const file of tier1Files) {
    describe(file, () => {
      it('has no bare `} catch {` blocks (without // catch-ok)', () => {
        const content = readServer(file);
        const lines = content.split('\n');
        const bareCatches = lines.filter(
          (l) => /}\s*catch\s*\{/.test(l) && !/catch-ok/.test(l),
        );
        expect(bareCatches).toEqual([]);
      });

      it('imports isProgrammingError from errors.js', () => {
        const content = readServer(file);
        expect(content).toMatch(/isProgrammingError/);
      });

      it('has at least one isProgrammingError(err) call', () => {
        const content = readServer(file);
        expect(countMatches(content, /isProgrammingError\(err\)/g)).toBeGreaterThan(0);
      });
    });
  }

  it('pr-check rule covers all server/ files (not just workspace-intelligence.ts)', () => {
    const prCheck = readFileSync(resolve(__dirname, '../../scripts/pr-check.ts'), 'utf-8'); // readFile-ok — verifies pr-check pathFilter expansion
    // Find the "Silent bare catch" rule and verify pathFilter is 'server/'
    const ruleMatch = prCheck.match(/name:\s*'Silent bare catch in server files'[\s\S]*?pathFilter:\s*'([^']+)'/);
    expect(ruleMatch).not.toBeNull();
    expect(ruleMatch![1]).toBe('server/');
  });
});

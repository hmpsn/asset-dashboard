import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';

/**
 * Contract: every createJob(...) call in server/mcp/tools/job-actions.ts
 * must use a BACKGROUND_JOB_TYPES value.
 *
 * This is vacuous until Phase 2 lands job-actions.ts.
 */
describe('mcp-tool-job-name-lockstep', () => {
  const jobActionsPath = path.join(__dirname, '..', '..', 'server', 'mcp', 'tools', 'job-actions.ts');

  it('every createJob(...) job type in job-actions.ts exists in BACKGROUND_JOB_TYPES', () => {
    if (!existsSync(jobActionsPath)) {
      expect(existsSync(jobActionsPath)).toBe(false);
      return;
    }

    const source = readFileSync(jobActionsPath, 'utf8');
    const calls = [
      ...source.matchAll(/createJob\(\s*(?:BACKGROUND_JOB_TYPES\.([A-Z0-9_]+)|['"]([\w-]+)['"])/g),
    ];

    expect(calls.length).toBeGreaterThan(0);

    const validJobTypes = new Set<string>(Object.values(BACKGROUND_JOB_TYPES));
    const validKeys = new Set<string>(Object.keys(BACKGROUND_JOB_TYPES));

    for (const call of calls) {
      const keyRef = call[1];
      const rawLiteral = call[2];
      if (keyRef) {
        expect(validKeys, `job-actions.ts references unknown BACKGROUND_JOB_TYPES key '${keyRef}'`).toContain(keyRef);
        const resolved = BACKGROUND_JOB_TYPES[keyRef as keyof typeof BACKGROUND_JOB_TYPES];
        expect(validJobTypes, `job-actions.ts resolves invalid job type '${resolved}' from key '${keyRef}'`).toContain(resolved);
        continue;
      }

      const literal = rawLiteral as string | undefined;
      expect(typeof literal).toBe('string');
      if (literal) {
        expect(validJobTypes, `job-actions.ts uses job type '${literal}' which is not in BACKGROUND_JOB_TYPES`).toContain(literal);
      }
    }
  });
});

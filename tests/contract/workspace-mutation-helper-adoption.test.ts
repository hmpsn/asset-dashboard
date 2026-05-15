import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readRoute(relativePath: string): string {
  return readFileSync(path.resolve(ROOT, relativePath), 'utf8');
}

describe('workspace mutation helper adoption contract', () => {
  it('keeps high-churn workspace mutation routes on runWorkspaceMutation()', () => {
    const routeFiles: Array<{ file: string; minCalls: number }> = [
      { file: 'server/routes/content-templates.ts', minCalls: 4 },
      { file: 'server/routes/content-matrices.ts', minCalls: 4 },
      { file: 'server/routes/client-actions.ts', minCalls: 3 },
    ];
    for (const { file, minCalls } of routeFiles) {
      const source = readRoute(file);
      const callCount = (source.match(/runWorkspaceMutation\(/g) || []).length;
      expect(
        callCount,
        `${file} should keep lifecycle writes on runWorkspaceMutation`,
      ).toBeGreaterThanOrEqual(minCalls);
      expect(
        source.includes('mutationError('),
        `${file} should retain explicit mutation error mapping for route-specific statuses`,
      ).toBe(true);
    }
  });
});

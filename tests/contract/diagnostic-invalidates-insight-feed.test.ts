import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import { queryKeys } from '../../src/lib/queryKeys';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');

/**
 * Regression guard for the diagnostic:complete → insight feed invalidation bug.
 *
 * The dead `['admin-insights', wsId]` key silently missed the real feed cache
 * entry, so users saw stale insights after a diagnostic finished. This test
 * pins the correct factory prefix so any future rename stays wired correctly.
 */
describe('diagnostic completion invalidates the insight feed', () => {
  it('queryKeys.admin.insightFeed prefix is what the WS handler invalidates', () => {
    const ws = 'ws-1';
    expect(queryKeys.admin.insightFeed(ws)).toEqual(['admin-insight-feed', ws]);
  });

  it('diagnosticForInsightAll is a strict prefix of diagnosticForInsight', () => {
    const ws = 'ws-1';
    const insight = 'insight-1';
    expect(queryKeys.admin.diagnosticForInsight(ws, insight).slice(0, 2))
      .toEqual(queryKeys.admin.diagnosticForInsightAll(ws));
  });

  it('diagnostics list prefix is shared by diagnosticDetail so invalidating list clears details', () => {
    const ws = 'ws-1';
    const report = 'rpt-1';
    expect(queryKeys.admin.diagnosticDetail(ws, report).slice(0, 2))
      .toEqual(queryKeys.admin.diagnostics(ws));
  });

  it('DIAGNOSTIC_COMPLETE handler in useWsInvalidation.ts calls invalidateQueries with insightFeed key', () => {
    // Static analysis: verify that the WS handler actually calls invalidateQueries
    // with queryKeys.admin.insightFeed() to prevent regression of the "dead key" bug.
    const wsInvalidationPath = join(__dirname, '../../src/hooks/useWsInvalidation.ts');
    const source = readFileSync(wsInvalidationPath, 'utf-8');

    // Find the DIAGNOSTIC_COMPLETE handler block using multiline regex
    // Match from the handler declaration up to the next handler or closing brace
    const diagnosticHandlerMatch = source.match(
      /\[WS_EVENTS\.DIAGNOSTIC_COMPLETE\]:\s*\(\)\s*=>\s*\{([\s\S]*?)\},?\s*\[WS_EVENTS\./
    );
    expect(diagnosticHandlerMatch).toBeTruthy();

    const handlerBody = diagnosticHandlerMatch![1];

    // Assert that the handler contains a call to insightFeed invalidation
    expect(handlerBody).toContain('queryKeys.admin.insightFeed(workspaceId)');
  });
});

import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { queryKeys } from '../../src/lib/queryKeys';
import { getWorkspaceInvalidationKeys } from '../../src/lib/wsInvalidation';
import { WS_EVENTS } from '../../src/lib/wsEvents';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');

function readRepoFile(path: string): string {
  return readFileSync(join(__dirname, '../..', path), 'utf-8');
}

describe('client diagnostics contracts', () => {
  it('public diagnostics route uses client portal auth and the safe projection', () => {
    const source = readRepoFile('server/routes/diagnostics.ts');

    expect(source).toContain("'/api/public/diagnostics/:workspaceId'");
    expect(source).toContain("requireClientPortalAuth('workspaceId')");
    expect(source).toContain('listClientDiagnosticSummaries');
  });

  it('client diagnostics UI does not render from the full admin report contract', () => {
    const source = readRepoFile('src/components/client/DiagnosticRootCauseCards.tsx');

    expect(source).toContain('ClientDiagnosticSummary');
    expect(source).not.toContain('DiagnosticReport');
    expect(source).not.toContain('adminReport');
    expect(source).not.toContain('diagnosticContext');
  });

  it('diagnostic terminal events invalidate the client diagnostics query', () => {
    const ws = 'ws-1';

    expect(getWorkspaceInvalidationKeys(WS_EVENTS.DIAGNOSTIC_COMPLETE, ws, undefined, 'client-dashboard'))
      .toContainEqual(queryKeys.client.diagnostics(ws));
    expect(getWorkspaceInvalidationKeys(WS_EVENTS.DIAGNOSTIC_FAILED, ws, undefined, 'client-dashboard'))
      .toContainEqual(queryKeys.client.diagnostics(ws));
  });

  it('mounted client dashboard subscribes to diagnostic terminal events', () => {
    const source = readRepoFile('src/components/ClientDashboard.tsx');

    expect(source).toContain('[WS_EVENTS.DIAGNOSTIC_COMPLETE]');
    expect(source).toContain('[WS_EVENTS.DIAGNOSTIC_FAILED]');
    expect(source).toContain('invalidateClientEvent(WS_EVENTS.DIAGNOSTIC_COMPLETE)');
    expect(source).toContain('invalidateClientEvent(WS_EVENTS.DIAGNOSTIC_FAILED)');
  });
});

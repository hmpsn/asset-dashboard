// CONTRACT: high-value public/client/admin read surfaces must use centralized
// serializer helpers instead of route-local inline field picking.
//
// readFile-ok — this is static contract coverage by design.

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');

function readServer(path: string): string {
  return readFileSync(join(ROOT, 'server', path), 'utf8');
}

describe('client-safe serializer route wiring contract', () => {
  it('keeps serializer exports for workspace, inbox, and schema surfaces', () => {
    const serializer = readServer('serializers/client-safe.ts');
    expect(serializer).toContain('export function toPublicWorkspaceView');
    expect(serializer).toContain('export function toClientInboxItem');
    expect(serializer).toContain('export function toClientInboxApprovalBatch');
    expect(serializer).toContain('export function toClientSchemaSnapshotView');
    expect(serializer).toContain('export function toClientSchemaView');
    expect(serializer).toContain('export function toAdminSchemaSnapshotView');
    expect(serializer).toContain('export function toAdminSchemaView');
  });

  it('uses toPublicWorkspaceView in public workspace bootstrap route', () => {
    const route = readServer('routes/public-portal.ts');
    expect(route).toContain("from '../serializers/client-safe.js'");
    expect(route).toContain('toPublicWorkspaceView(ws, {');
    expect(route).not.toContain('requiresPassword: !!ws.clientPassword');
    expect(route).not.toContain('trialDaysRemaining: ws.trialEndsAt');
  });

  it('uses inbox serializers in approvals and client-actions routes', () => {
    const approvals = readServer('routes/approvals.ts');
    expect(approvals).toContain('toClientInboxApprovalBatches');
    expect(approvals).toContain('toClientInboxApprovalBatch');
    expect(approvals).toContain('res.json(toClientInboxApprovalBatches(listBatches(req.params.workspaceId)))');

    const actions = readServer('routes/client-actions.ts');
    expect(actions).toContain('toClientInboxItems');
    expect(actions).toContain('toClientInboxItem');
    expect(actions).toContain('res.json(toClientInboxItems(listClientActions(req.params.workspaceId)))');
  });

  it('uses schema serializers for admin/public schema read views', () => {
    const schemaRoute = readServer('routes/webflow-schema.ts');
    expect(schemaRoute).toContain('toAdminSchemaSnapshotView');
    expect(schemaRoute).toContain('toAdminSchemaView');
    expect(schemaRoute).toContain('toClientSchemaSnapshotView');
    expect(schemaRoute).toContain('toClientSchemaView');
    expect(schemaRoute).not.toContain('const pages = snapshot.results.map(r => ({');
  });
});

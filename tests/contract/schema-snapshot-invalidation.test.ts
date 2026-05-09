import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');

function readProjectFile(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8'); // readFile-ok - contract test inspects source wiring.
}

describe('schema snapshot invalidation contract', () => {
  it('defines the schema snapshot websocket event in both server and client registries', () => {
    expect(readProjectFile('server/ws-events.ts')).toContain("SCHEMA_SNAPSHOT_UPDATED: 'schema:snapshot_updated'");
    expect(readProjectFile('src/lib/wsEvents.ts')).toContain("SCHEMA_SNAPSHOT_UPDATED: 'schema:snapshot_updated'");
  });

  it('broadcasts snapshot updates from every route path that mutates persisted schema snapshots', () => {
    const source = readProjectFile('server/routes/webflow-schema.ts');
    const calls = source.match(/broadcastSchemaSnapshotUpdated\([^;]+;/g) ?? [];

    expect(source).toContain('function broadcastSchemaSnapshotUpdated');
    expect(calls.some(call => call.includes('cmsWs?.id') && call.includes("'published'"))).toBe(true);
    expect(calls.some(call => call.includes('pubWsForHistory?.id') && call.includes("'published'"))).toBe(true);
    expect(calls.some(call => call.includes('plan.workspaceId') && call.includes("'deleted'"))).toBe(true);
    expect(calls.some(call => call.includes('ws?.id') && call.includes("'retracted'"))).toBe(true);
    expect(calls.some(call => call.includes('ws?.id') && call.includes("'rolled_back'"))).toBe(true);
  });

  it('invalidates admin and client React Query caches for schema snapshot and plan events', () => {
    const adminSource = readProjectFile('src/hooks/useWsInvalidation.ts');
    const clientSource = readProjectFile('src/components/ClientDashboard.tsx');

    expect(adminSource).toContain('[WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED]');
    expect(adminSource).toContain('queryKeys.admin.schemaSnapshot(siteId, workspaceId)');
    expect(clientSource).toContain('[WS_EVENTS.SCHEMA_PLAN_SENT]');
    expect(clientSource).toContain('queryKeys.client.schemaPlan(workspaceId)');
    expect(clientSource).toContain('[WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED]');
    expect(clientSource).toContain('queryKeys.client.schemaSnapshot(workspaceId)');
  });

  it('keeps the client schema review tab on React Query keys instead of local effect-fetch state', () => {
    // NOTE: SchemaReviewTab is route-orphaned as of feat/client-inbox-redesign — the
    // 'schema-review' ClientTab now redirects to 'inbox' and the component is never
    // rendered via real navigation. This test only verifies the component renders in
    // isolation (source-level contract), NOT via a real user navigation path.
    const source = readProjectFile('src/components/client/SchemaReviewTab.tsx');

    expect(source).toContain('useQuery');
    expect(source).toContain('queryKeys.client.schemaPlan(workspaceId)');
    expect(source).toContain('queryKeys.client.schemaSnapshot(workspaceId)');
    expect(source).not.toContain('setPlan');
    expect(source).not.toContain('setSnapshot');
  });
});

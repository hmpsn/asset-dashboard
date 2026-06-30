import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { queryKeys } from '../../src/lib/queryKeys';
import { getWorkspaceInvalidationKeys } from '../../src/lib/wsInvalidation';
import { WS_EVENTS } from '../../src/lib/wsEvents';

const ROOT = join(__dirname, '../..');

function readProjectFile(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8'); // readFile-ok - contract test inspects source wiring.
}

describe('schema snapshot invalidation contract', () => {
  it('defines the schema snapshot websocket event in both server and client registries', () => {
    expect(readProjectFile('server/ws-events.ts')).toContain("SCHEMA_SNAPSHOT_UPDATED: 'schema:snapshot_updated'");
    expect(readProjectFile('src/lib/wsEvents.ts')).toContain("SCHEMA_SNAPSHOT_UPDATED: 'schema:snapshot_updated'");
    expect(readProjectFile('server/ws-events.ts')).toContain("SCHEMA_PLAN_UPDATED: 'schema:plan_updated'");
    expect(readProjectFile('src/lib/wsEvents.ts')).toContain("SCHEMA_PLAN_UPDATED: 'schema:plan_updated'");
  });

  it('guards against invalid legacy websocket event literals', () => {
    const serverEvents = readProjectFile('server/ws-events.ts');
    const clientEvents = readProjectFile('src/lib/wsEvents.ts');

    expect(serverEvents).not.toContain('schema:snapshot-update');
    expect(clientEvents).not.toContain('schema:snapshot-update');
  });

  it('broadcasts snapshot updates from every route path that mutates persisted schema snapshots', () => {
    const routeSource = readProjectFile('server/routes/webflow-schema.ts');
    const adminMutationSource = readProjectFile('server/domains/schema/schema-plan-admin-mutations.ts');
    const publishService = readProjectFile('server/domains/schema/publish-schema-to-live.ts');
    const routeCalls = routeSource.match(/broadcastSchemaSnapshotUpdated\([^;]+;/g) ?? [];
    const adminCalls = adminMutationSource.match(/broadcastSchemaSnapshotDeleted\([^;]+;/g) ?? [];

    expect(routeSource).toContain('function broadcastSchemaSnapshotUpdated');
    expect(adminMutationSource).toContain('function broadcastSchemaSnapshotDeleted');
    // C2: the publish ('published') snapshot broadcast moved into the shared
    // publishSchemaToLive service so both the admin route and the MCP publish_schema
    // tool emit it from one place (the route keeps retract/rollback/generate).
    expect(publishService).toContain('WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED');
    expect(publishService).toContain("action: 'published'");
    expect(adminCalls.some(call => call.includes('plan.workspaceId'))).toBe(true);
    expect(routeCalls.some(call => call.includes('ws?.id') && call.includes("'retracted'"))).toBe(true);
    expect(routeCalls.some(call => call.includes('ws?.id') && call.includes("'rolled_back'"))).toBe(true);
  });

  it('invalidates admin and client React Query caches for schema snapshot and plan events', () => {
    const clientSource = readProjectFile('src/components/ClientDashboard.tsx');
    const adminPlanKeys = getWorkspaceInvalidationKeys(
      WS_EVENTS.SCHEMA_PLAN_UPDATED,
      'ws-schema',
      { siteId: 'site-11' },
      'admin',
    );
    const adminSnapshotKeys = getWorkspaceInvalidationKeys(
      WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED,
      'ws-schema',
      { siteId: 'site-11' },
      'admin',
    );
    const clientPlanKeys = getWorkspaceInvalidationKeys(
      WS_EVENTS.SCHEMA_PLAN_UPDATED,
      'ws-schema',
      undefined,
      'client-dashboard',
    );
    const clientSnapshotKeys = getWorkspaceInvalidationKeys(
      WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED,
      'ws-schema',
      undefined,
      'client-dashboard',
    );

    expect(adminPlanKeys).toContainEqual(queryKeys.admin.schemaPlan('site-11', 'ws-schema'));
    expect(adminPlanKeys).toContainEqual(queryKeys.admin.schemaGraphValidation('site-11', 'ws-schema'));
    expect(adminSnapshotKeys).toContainEqual(queryKeys.admin.schemaSnapshot('site-11', 'ws-schema'));
    expect(adminSnapshotKeys).toContainEqual(queryKeys.admin.schemaGraphValidation('site-11', 'ws-schema'));
    expect(clientSource).toContain('[WS_EVENTS.SCHEMA_PLAN_SENT]');
    expect(clientSource).toContain('invalidateClientEvent(WS_EVENTS.SCHEMA_PLAN_UPDATED)');
    expect(clientSource).toContain('[WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED]');
    expect(clientPlanKeys).toEqual([queryKeys.client.schemaPlan('ws-schema')]);
    expect(clientSnapshotKeys).toEqual([
      queryKeys.client.schemaPlan('ws-schema'),
      queryKeys.client.schemaSnapshot('ws-schema'),
    ]);
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

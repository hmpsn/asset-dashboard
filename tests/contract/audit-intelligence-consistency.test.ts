import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { queryKeys } from '../../src/lib/queryKeys';
import { getWorkspaceInvalidationKeys } from '../../src/lib/wsInvalidation';
import { WS_EVENTS } from '../../src/lib/wsEvents';

describe('audit intelligence consistency contracts', () => {
  it('AUDIT_COMPLETE invalidates full audit detail and intelligence readers', () => {
    const src = readFileSync('src/hooks/useWsInvalidation.ts', 'utf-8'); // readFile-ok — source contract for audit cache freshness
    const keys = getWorkspaceInvalidationKeys(WS_EVENTS.AUDIT_COMPLETE, 'ws-audit', undefined, 'admin');

    expect(src).toContain('[WS_EVENTS.AUDIT_COMPLETE]: () => invalidateRegistry(WS_EVENTS.AUDIT_COMPLETE)');
    expect(keys).toContainEqual(queryKeys.client.auditSummary('ws-audit'));
    expect(keys).toContainEqual(queryKeys.client.auditDetail('ws-audit'));
    expect(keys).toContainEqual(queryKeys.admin.auditAll());
    expect(keys).toContainEqual(queryKeys.admin.intelligenceAll('ws-audit'));
    expect(keys).toContainEqual(queryKeys.client.intelligence('ws-audit'));
    expect(keys).toContainEqual(queryKeys.admin.workspaceOverview());
  });

  it('WORKSPACE_UPDATED refreshes workspace overview and audit suppression readers', () => {
    const src = readFileSync('src/hooks/useWsInvalidation.ts', 'utf-8'); // readFile-ok — source contract for suppression cache freshness
    const keys = getWorkspaceInvalidationKeys(WS_EVENTS.WORKSPACE_UPDATED, 'ws-audit', undefined, 'admin');

    expect(src).toContain('[WS_EVENTS.WORKSPACE_UPDATED]: (data: unknown) => invalidateRegistry(WS_EVENTS.WORKSPACE_UPDATED, data)');
    expect(keys).toContainEqual(queryKeys.admin.workspaceHome('ws-audit'));
    expect(keys).toContainEqual(queryKeys.admin.workspaceDetail('ws-audit'));
    expect(keys).toContainEqual(queryKeys.admin.workspaceOverview());
    expect(keys).toContainEqual(queryKeys.admin.auditSuppressions('ws-audit'));
  });

  it('audit suppression mutations broadcast and invalidate audit intelligence slices', () => {
    const src = readFileSync('server/routes/workspaces.ts', 'utf-8'); // readFile-ok — source contract for suppression mutation data flow

    expect(src).toContain('function publishAuditSuppressionChange');
    expect(src).toContain("invalidateSubCachePrefix(workspace.id, 'slice:siteHealth')");
    expect(src).toContain("invalidateSubCachePrefix(workspace.id, 'slice:pageProfile')");
    expect(src).toContain("addActivity(\n    workspace.id,\n    'audit_suppression_updated'");
    expect(src).toContain('broadcastToWorkspace(workspace.id, WS_EVENTS.AUDIT_COMPLETE');
    expect(src).toContain('broadcastToWorkspace(workspace.id, WS_EVENTS.WORKSPACE_UPDATED');
  });

  it('siteHealth and pageProfile consume suppression-adjusted audit snapshots', () => {
    const siteHealthSrc = readFileSync('server/intelligence/site-health-slice.ts', 'utf-8'); // readFile-ok — source contract for siteHealth audit read
    const pageProfileSrc = readFileSync('server/intelligence/page-profile-slice.ts', 'utf-8'); // readFile-ok — source contract for pageProfile audit read

    expect(siteHealthSrc).toContain('getLatestEffectiveSnapshot(siteId, workspace?.auditSuppressions)');
    expect(siteHealthSrc).toContain('listEffectiveSnapshotSummaries(siteId, workspace?.auditSuppressions)');
    expect(pageProfileSrc).toContain('getLatestEffectiveSnapshot(ws.webflowSiteId, ws.auditSuppressions)');
  });

  it('report read paths use suppression-adjusted snapshots and summaries', () => {
    const reportsSrc = readFileSync('server/routes/reports.ts', 'utf-8'); // readFile-ok — source contract for audit report consistency
    const publicPortalSrc = readFileSync('server/routes/public-portal.ts', 'utf-8'); // readFile-ok — source contract for public audit consistency

    expect(reportsSrc).toContain('listEffectiveSnapshotSummaries(req.params.siteId');
    expect(reportsSrc).toContain('getEffectiveSnapshotForRead(snapshot)');
    expect(reportsSrc).toContain('getLatestEffectiveSnapshot(req.params.siteId');
    expect(publicPortalSrc).toContain('getLatestEffectiveSnapshot(ws.webflowSiteId');
    expect(publicPortalSrc).toContain('listEffectiveSnapshotSummaries(ws.webflowSiteId');
    expect(publicPortalSrc).toContain('getEffectiveAudit(prev.audit');
  });

  it('prevents invalid regressions to unsuppressed snapshot readers in public portal routes', () => {
    const publicPortalSrc = readFileSync('server/routes/public-portal.ts', 'utf-8'); // readFile-ok - invalid regression guard for suppression-aware reads.

    expect(publicPortalSrc).not.toContain('getLatestSnapshot(ws.webflowSiteId');
    expect(publicPortalSrc).not.toContain('listSnapshotSummaries(ws.webflowSiteId');
  });
});

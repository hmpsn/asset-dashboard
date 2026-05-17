import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('audit intelligence consistency contracts', () => {
  function eventHandlerSource(src: string, eventName: string): string {
    const marker = `[WS_EVENTS.${eventName}]: () => {`;
    const start = src.indexOf(marker);
    expect(start).toBeGreaterThanOrEqual(0);
    const afterMarker = start + marker.length;
    const nextEvent = src.indexOf('\n    [WS_EVENTS.', afterMarker);
    return nextEvent === -1 ? src.slice(afterMarker) : src.slice(afterMarker, nextEvent);
  }

  it('AUDIT_COMPLETE invalidates full audit detail and intelligence readers', () => {
    const src = readFileSync('src/hooks/useWsInvalidation.ts', 'utf-8'); // readFile-ok — source contract for audit cache freshness
    const handler = eventHandlerSource(src, 'AUDIT_COMPLETE');

    expect(handler).toContain('queryKeys.client.auditSummary(workspaceId)');
    expect(handler).toContain('queryKeys.client.auditDetail(workspaceId)');
    expect(handler).toContain('queryKeys.admin.auditAll()');
    expect(handler).toContain('queryKeys.admin.intelligenceAll(workspaceId)');
    expect(handler).toContain('queryKeys.client.intelligence(workspaceId)');
    expect(handler).toContain('queryKeys.admin.workspaceOverview()');
  });

  it('WORKSPACE_UPDATED refreshes workspace overview and audit suppression readers', () => {
    const src = readFileSync('src/hooks/useWsInvalidation.ts', 'utf-8'); // readFile-ok — source contract for suppression cache freshness
    const handler = eventHandlerSource(src, 'WORKSPACE_UPDATED');

    expect(handler).toContain('queryKeys.admin.workspaceHome(workspaceId)');
    expect(handler).toContain('queryKeys.admin.workspaceDetail(workspaceId)');
    expect(handler).toContain('queryKeys.admin.workspaceOverview()');
    expect(handler).toContain('queryKeys.admin.auditSuppressions(workspaceId)');
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
});

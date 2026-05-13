import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('audit intelligence consistency contracts', () => {
  it('AUDIT_COMPLETE invalidates full audit detail and intelligence readers', () => {
    const src = readFileSync('src/hooks/useWsInvalidation.ts', 'utf-8'); // readFile-ok — source contract for audit cache freshness
    const handler = src.match(/\[WS_EVENTS\.AUDIT_COMPLETE\]:\s*\(\)\s*=>\s*\{([\s\S]*?)\},\s*\[WS_EVENTS\./)?.[1] ?? '';

    expect(handler).toContain('queryKeys.client.auditSummary(workspaceId)');
    expect(handler).toContain('queryKeys.client.auditDetail(workspaceId)');
    expect(handler).toContain('queryKeys.admin.auditAll()');
    expect(handler).toContain('queryKeys.admin.intelligenceAll(workspaceId)');
    expect(handler).toContain('queryKeys.client.intelligence(workspaceId)');
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
});

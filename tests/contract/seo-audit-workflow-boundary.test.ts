import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { queryKeys } from '../../src/lib/queryKeys';
import { getWorkspaceInvalidationKeys } from '../../src/lib/wsInvalidation';
import { WS_EVENTS } from '../../src/lib/wsEvents';

describe('SeoAudit workflow extraction boundaries', () => {
  it('keeps latest/history fetching and background-job orchestration out of the component', () => {
    const componentSrc = readFileSync('src/components/SeoAudit.tsx', 'utf-8'); // readFile-ok — source boundary contract.
    const workflowSrc = readFileSync('src/hooks/admin/useSeoAuditWorkflow.ts', 'utf-8'); // readFile-ok — source boundary contract.

    expect(componentSrc).not.toContain('getOptional');
    expect(componentSrc).not.toContain('getSafe');
    expect(componentSrc).not.toContain('useBackgroundTasks');
    expect(componentSrc).not.toContain('/api/reports/${siteId}/latest');
    expect(componentSrc).not.toContain('/api/reports/${siteId}/history');
    expect(workflowSrc).toContain('useBackgroundTasks');
    expect(workflowSrc).toContain('useQuery');
    expect(workflowSrc).toContain('/api/reports/${siteId}/latest');
    expect(workflowSrc).toContain('/api/reports/${siteId}/history');
  });

  it('uses admin-audit query key hierarchy for latest/history audit snapshots', () => {
    expect(queryKeys.admin.auditLatest('site-a', 'ws-a')).toEqual(['admin-audit', 'latest', 'site-a', 'ws-a']);
    expect(queryKeys.admin.auditHistory('site-a', 'ws-a')).toEqual(['admin-audit', 'history', 'site-a', 'ws-a']);
    expect(queryKeys.admin.auditLatest('site-a')).toEqual(['admin-audit', 'latest', 'site-a']);
    expect(queryKeys.admin.auditHistory('site-a')).toEqual(['admin-audit', 'history', 'site-a']);
  });

  it('AUDIT_COMPLETE invalidates the admin-audit prefix that covers latest/history readers', () => {
    const keys = getWorkspaceInvalidationKeys(WS_EVENTS.AUDIT_COMPLETE, 'ws-audit', undefined, 'admin');

    expect(keys).toContainEqual(queryKeys.admin.auditAll());
  });
});

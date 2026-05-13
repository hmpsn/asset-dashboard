import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createWorkspace,
  deleteWorkspace,
  updateWorkspace,
} from '../../server/workspaces.js';
import { clearCompletedJobs } from '../../server/jobs.js';
import * as workspacesModule from '../../server/workspaces.js';
import * as seoAuditModule from '../../server/seo-audit.js';
import * as reportsModule from '../../server/reports.js';
import * as activityModule from '../../server/activity-log.js';
import * as bridgesModule from '../../server/webflow-seo-audit-bridges.js';
import * as broadcastModule from '../../server/broadcast.js';
import * as recommendationsModule from '../../server/recommendations.js';
import { WS_EVENTS } from '../../server/ws-events.js';

const SITE_ID = 'wf-site-seo-audit-contract';

const seoAuditResult = {
  siteScore: 83,
  totalPages: 1,
  errors: 0,
  warnings: 1,
  infos: 0,
  pages: [{
    pageId: 'page-1',
    page: 'Home',
    slug: '/',
    url: 'https://example.com/',
    score: 83,
    issues: [{
      check: 'meta-description',
      severity: 'warning',
      message: 'Missing description',
      recommendation: 'Add a meta description.',
      suggestedFix: 'Add a concise meta description.',
    }],
  }],
  siteWideIssues: [],
};

describe('SEO audit background job contract', () => {
  let workspaceId = '';
  let baseUrl = '';
  let server: Server | null = null;
  let addActivitySpy: ReturnType<typeof vi.spyOn>;
  let bridgeSpy: ReturnType<typeof vi.spyOn>;
  let broadcastSpy: ReturnType<typeof vi.spyOn>;
  let saveSnapshotSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    clearCompletedJobs();
    const ws = createWorkspace('SEO Audit Contract Workspace', SITE_ID, 'Contract Test Site');
    workspaceId = ws.id;
    updateWorkspace(workspaceId, { tier: 'growth' });

    vi.spyOn(workspacesModule, 'getTokenForSite').mockReturnValue('wf-token-test');
    vi.spyOn(seoAuditModule, 'runSeoAudit').mockResolvedValue(seoAuditResult as never);
    vi.spyOn(recommendationsModule, 'generateRecommendations').mockResolvedValue(undefined);

    addActivitySpy = vi.spyOn(activityModule, 'addActivity').mockImplementation(() => {});
    bridgeSpy = vi.spyOn(bridgesModule, 'handleOnDemandSeoAuditResult').mockImplementation(() => undefined);
    broadcastSpy = vi.spyOn(broadcastModule, 'broadcastToWorkspace').mockImplementation(() => undefined);
    saveSnapshotSpy = vi.spyOn(reportsModule, 'saveSnapshot').mockReturnValue({
      id: 'snap_contract_1',
      siteId: SITE_ID,
      createdAt: new Date().toISOString(),
      previousScore: 79,
      audit: seoAuditResult as never,
      score: seoAuditResult.siteScore,
    } as never);

    const { default: jobsRouter } = await import('../../server/routes/jobs.js');
    const app = express();
    app.use(express.json());
    app.use(jobsRouter);
    server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected ephemeral port');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close(err => (err ? reject(err) : resolve()));
      });
    }
    clearCompletedJobs();
    if (workspaceId) deleteWorkspace(workspaceId);
    vi.restoreAllMocks();
  });

  it('runs audit side effects after the background snapshot is saved', async () => {
    const startRes = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'seo-audit',
        params: { siteId: SITE_ID, workspaceId },
      }),
    });

    expect(startRes.status).toBe(200);
    const startBody = await startRes.json() as { jobId: string };
    expect(typeof startBody.jobId).toBe('string');

    let terminalStatus: string | null = null;
    for (let i = 0; i < 80; i++) {
      const jobRes = await fetch(`${baseUrl}/api/jobs/${startBody.jobId}`);
      const job = await jobRes.json() as { status: string; result?: { previousScore?: number; snapshotId?: string } };
      terminalStatus = job.status;
      if (terminalStatus === 'done' || terminalStatus === 'error' || terminalStatus === 'cancelled') {
        if (terminalStatus === 'done') {
          expect(job.result).toEqual(expect.objectContaining({
            previousScore: 79,
            snapshotId: 'snap_contract_1',
          }));
        }
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }

    expect(terminalStatus).toBe('done');
    expect(saveSnapshotSpy).toHaveBeenCalledWith(SITE_ID, expect.any(String), seoAuditResult);
    expect(addActivitySpy).toHaveBeenCalledWith(
      workspaceId,
      'audit_completed',
      expect.stringContaining('Site audit completed'),
      expect.stringContaining('pages scanned'),
      expect.objectContaining({ score: seoAuditResult.siteScore }),
    );
    expect(bridgeSpy).toHaveBeenCalledWith(expect.objectContaining({ id: workspaceId }), seoAuditResult);
    expect(broadcastSpy).toHaveBeenCalledWith(
      workspaceId,
      WS_EVENTS.AUDIT_COMPLETE,
      expect.objectContaining({ score: seoAuditResult.siteScore }),
    );
  });
});

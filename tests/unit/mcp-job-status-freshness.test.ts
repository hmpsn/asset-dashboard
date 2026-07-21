import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import db from '../../server/db/index.js';
import {
  clearCompletedJobs,
  createJob,
  getJob,
  getJobAuthoritative,
  updateJob,
} from '../../server/jobs.js';
import { handleJobActionTool } from '../../server/mcp/tools/job-actions.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const workspaceIds = new Set<string>();

afterEach(() => {
  for (const workspaceId of workspaceIds) {
    for (const row of db.prepare('SELECT id, status FROM jobs WHERE workspace_id = ?')
      .all(workspaceId) as Array<{ id: string; status: string }>) {
      getJobAuthoritative(row.id);
      if (row.status === 'pending' || row.status === 'running') {
        updateJob(row.id, { status: 'error', error: 'test cleanup' });
      }
    }
    clearCompletedJobs({ workspaceId });
    deleteWorkspace(workspaceId);
  }
  workspaceIds.clear();
});

describe('MCP job status durable freshness', () => {
  it('authorizes and projects the same DB-fresh job while refreshing stale cache state', async () => {
    const staleWorkspaceId = createWorkspace(`Stale job owner ${randomUUID()}`).id;
    const durableWorkspaceId = createWorkspace(`Durable job owner ${randomUUID()}`).id;
    workspaceIds.add(staleWorkspaceId);
    workspaceIds.add(durableWorkspaceId);

    const job = createJob('mcp-job-freshness-test', {
      workspaceId: staleWorkspaceId,
      message: 'Cached pending state',
      total: 100,
    });
    expect(getJob(job.id)).toMatchObject({
      workspaceId: staleWorkspaceId,
      status: 'pending',
      progress: 0,
      message: 'Cached pending state',
    });

    const durableCreatedAt = '2026-07-20T12:00:00.000Z';
    const durableUpdatedAt = '2026-07-20T12:05:00.000Z';
    db.prepare(`
      UPDATE jobs
      SET workspace_id = ?, status = 'error', progress = 73, total = 90,
        message = ?, result = ?, error = ?, created_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      durableWorkspaceId,
      'Durable terminal state',
      JSON.stringify({ run_id: 'run-durable', completed: 7 }),
      'Durable provider failure',
      durableCreatedAt,
      durableUpdatedAt,
      job.id,
    );

    // The ordinary cache-fast read intentionally remains stale.
    expect(getJob(job.id)).toMatchObject({
      workspaceId: staleWorkspaceId,
      status: 'pending',
      progress: 0,
    });

    const staleOwnerRead = await handleJobActionTool('get_job_status', {
      workspace_id: staleWorkspaceId,
      job_id: job.id,
    });
    expect(staleOwnerRead.isError).toBe(true);
    expect(JSON.parse(staleOwnerRead.content[0].text)).toMatchObject({
      code: 'not_found',
      details: { resource_type: 'job' },
    });

    const durableOwnerRead = await handleJobActionTool('get_job_status', {
      workspace_id: durableWorkspaceId,
      job_id: job.id,
    });
    expect(durableOwnerRead.isError).toBeUndefined();
    expect(JSON.parse(durableOwnerRead.content[0].text)).toMatchObject({
      job: {
        id: job.id,
        workspaceId: durableWorkspaceId,
        status: 'error',
        progress: 73,
        total: 90,
        message: 'Durable terminal state',
        result: { run_id: 'run-durable', completed: 7 },
        error: 'Durable provider failure',
        createdAt: durableCreatedAt,
        updatedAt: durableUpdatedAt,
      },
    });

    // The authoritative boundary refreshes the shared process cache too.
    expect(getJob(job.id)).toEqual(getJobAuthoritative(job.id));
    expect(getJob(job.id)).toMatchObject({
      workspaceId: durableWorkspaceId,
      status: 'error',
      updatedAt: durableUpdatedAt,
    });
  });
});

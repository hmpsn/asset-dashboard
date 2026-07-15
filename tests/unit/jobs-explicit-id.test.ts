import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import { clearCompletedJobs, createJob, getJob, updateJob } from '../../server/jobs.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const workspaceIds: string[] = [];

afterEach(() => {
  for (const workspaceId of workspaceIds.splice(0)) {
    clearCompletedJobs({ workspaceId });
    deleteWorkspace(workspaceId);
  }
});

describe('background job explicit internal identity', () => {
  it('persists one trusted domain-owned id and refuses a duplicate', () => {
    const id = `job_explicit_${randomUUID()}`;
    const workspaceId = createWorkspace(`Explicit job ${randomUUID()}`).id;
    workspaceIds.push(workspaceId);
    const created = createJob('explicit-id-test', {
      id,
      workspaceId,
      message: 'Accepted durable command',
    });

    expect(created.id).toBe(id);
    expect(getJob(id)).toMatchObject({ id, status: 'pending' });
    expect(() => createJob('explicit-id-test', { id, workspaceId })).toThrow();
    expect(getJob(id)).toMatchObject({
      id,
      message: 'Accepted durable command',
      status: 'pending',
    });

    updateJob(id, { status: 'cancelled', message: 'Test cleanup' });
  });

  it('rejects malformed explicit ids before persistence', () => {
    expect(() => createJob('explicit-id-test', { id: ' job-with-space' })).toThrow(/job id/i);
    expect(() => createJob('explicit-id-test', { id: '' })).toThrow(/job id/i);
    expect(() => createJob('explicit-id-test', { id: 'x'.repeat(201) })).toThrow(/job id/i);
  });
});

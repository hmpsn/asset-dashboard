import { afterEach, describe, expect, it } from 'vitest';
import {
  clearCompletedJobs,
  createJob,
  getJob,
  updateJob,
} from '../../server/jobs.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';

const workspaceIds = new Set<string>();

describe('background job status transition guards', () => {
  afterEach(() => {
    for (const workspaceId of workspaceIds) clearCompletedJobs({ workspaceId });
    workspaceIds.clear();
  });

  it('allows forward lifecycle transitions pending → running → done', () => {
    const workspaceId = `ws_job_status_${Date.now()}`;
    workspaceIds.add(workspaceId);
    const job = createJob(BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR, { workspaceId });

    updateJob(job.id, { status: 'running', message: 'Working...' });
    updateJob(job.id, { status: 'done', message: 'Complete', result: { ok: true } });

    expect(getJob(job.id)).toMatchObject({
      status: 'done',
      message: 'Complete',
      result: { ok: true },
    });
  });

  it('ignores invalid terminal demotion transitions', () => {
    const workspaceId = `ws_job_status_terminal_${Date.now()}`;
    workspaceIds.add(workspaceId);
    const job = createJob(BACKGROUND_JOB_TYPES.PAGE_ANALYSIS, { workspaceId });
    updateJob(job.id, { status: 'running', message: 'Running' });
    updateJob(job.id, { status: 'done', message: 'Done' });

    updateJob(job.id, { status: 'running', message: 'Should not reopen', progress: 1 });
    const persisted = getJob(job.id);

    expect(persisted).toMatchObject({
      status: 'done',
      message: 'Done',
    });
    expect(persisted?.progress).not.toBe(1);
  });

  it('allows same-status progress updates while running', () => {
    const workspaceId = `ws_job_status_progress_${Date.now()}`;
    workspaceIds.add(workspaceId);
    const job = createJob(BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY, { workspaceId, total: 5 });
    updateJob(job.id, { status: 'running', progress: 1, total: 5, message: 'Analyzed page 1/5' });
    updateJob(job.id, { status: 'running', progress: 2, total: 5, message: 'Analyzed page 2/5' });

    expect(getJob(job.id)).toMatchObject({
      status: 'running',
      progress: 2,
      total: 5,
      message: 'Analyzed page 2/5',
    });
  });
});

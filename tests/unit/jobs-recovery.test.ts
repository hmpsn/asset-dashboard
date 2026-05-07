import { afterEach, describe, expect, it } from 'vitest';
import db from '../../server/db/index';
import {
  clearCompletedJobs,
  createJob,
  getJob,
  markRunningJobsInterrupted,
  recoverInterruptedJobsAfterRestart,
  updateJob,
} from '../../server/jobs';

afterEach(() => {
  clearCompletedJobs();
});

describe('background job interruption recovery', () => {
  it('marks persisted pending and running jobs errored after restart with a visible message', () => {
    clearCompletedJobs();
    const pending = createJob('recovery-test-pending', { message: 'Queued forever' });
    const running = createJob('recovery-test-running', { message: 'Working forever' });
    const done = createJob('recovery-test-done', { message: 'Already done' });
    const cancelled = createJob('recovery-test-cancelled', { message: 'Already cancelled' });

    updateJob(running.id, { status: 'running', message: 'Still working' });
    updateJob(done.id, { status: 'done', message: 'Already done' });
    updateJob(cancelled.id, { status: 'cancelled', message: 'Already cancelled' });

    expect(recoverInterruptedJobsAfterRestart()).toBe(2);

    expect(getJob(pending.id)).toMatchObject({
      status: 'error',
      message: 'Interrupted by server restart',
      error: 'Server restarted — job interrupted',
    });
    expect(getJob(running.id)).toMatchObject({
      status: 'error',
      message: 'Interrupted by server restart',
      error: 'Server restarted — job interrupted',
    });
    expect(getJob(done.id)).toMatchObject({ status: 'done', message: 'Already done' });
    expect(getJob(cancelled.id)).toMatchObject({ status: 'cancelled', message: 'Already cancelled' });

    const row = db.prepare('SELECT status, message, error FROM jobs WHERE id = ?').get(pending.id) as {
      status: string;
      message: string;
      error: string;
    };
    expect(row).toMatchObject({
      status: 'error',
      message: 'Interrupted by server restart',
      error: 'Server restarted — job interrupted',
    });
  });

  it('uses the same visible-message convention during graceful shutdown interruption', () => {
    clearCompletedJobs();
    const job = createJob('shutdown-test-running', { message: 'Still running' });
    updateJob(job.id, { status: 'running', message: 'Still running' });

    markRunningJobsInterrupted();

    expect(getJob(job.id)).toMatchObject({
      status: 'error',
      message: 'Interrupted by server shutdown',
      error: 'Server shutting down — job interrupted',
    });
  });
});

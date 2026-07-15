import { afterEach, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import {
  ActiveJobResourceConflict,
  cancelJob,
  clearCompletedJobs,
  createResourceScopedJob,
  finalizeJobResourceClaims,
  getJob,
  getJobResourceClaims,
  initJobs,
  listJobs,
  recoverInterruptedJobsAfterRestart,
  registerAbort,
  runResourceScopedJobWorker,
  unregisterAbort,
  updateJob,
} from '../../server/jobs.js';
import {
  BACKGROUND_JOB_TYPES,
  JOB_RESOURCE_TYPES,
  type JobResourceRef,
} from '../../shared/types/background-jobs.js';

const workspaceIds = new Set<string>();

function workspaceId(label: string): string {
  const id = `ws_claim_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  workspaceIds.add(id);
  return id;
}

function copyEntry(resourceId: string): JobResourceRef {
  return { resourceType: JOB_RESOURCE_TYPES.COPY_ENTRY, resourceId };
}

afterEach(() => {
  for (const wsId of workspaceIds) {
    for (const job of listJobs(wsId)) {
      if (job.status === 'pending' || job.status === 'running') {
        updateJob(job.id, { status: 'error', error: 'test cleanup' });
      }
      if (job.status === 'cancelled') finalizeJobResourceClaims(job.id);
    }
    clearCompletedJobs({ workspaceId: wsId });
  }
  workspaceIds.clear();
});

describe('resource-scoped job acceptance', () => {
  it('deduplicates the same resource across job types but permits independent resources', () => {
    const wsId = workspaceId('same');
    const first = createResourceScopedJob(BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION, {
      workspaceId: wsId,
      resources: [copyEntry('entry_a')],
    });
    const independent = createResourceScopedJob(BACKGROUND_JOB_TYPES.COPY_BATCH_GENERATION, {
      workspaceId: wsId,
      resources: [copyEntry('entry_b')],
    });

    expect(first.job.id).not.toBe(independent.job.id);
    expect(() => createResourceScopedJob(BACKGROUND_JOB_TYPES.COPY_BATCH_GENERATION, {
      workspaceId: wsId,
      resources: [copyEntry('entry_a')],
    })).toThrowError(ActiveJobResourceConflict);
  });

  it('atomically rejects overlapping multi-resource batches', () => {
    const wsId = workspaceId('batch');
    const first = createResourceScopedJob(BACKGROUND_JOB_TYPES.COPY_BATCH_GENERATION, {
      workspaceId: wsId,
      resources: [copyEntry('entry_b'), copyEntry('entry_a'), copyEntry('entry_a')],
    });
    expect(getJobResourceClaims(first.job.id).map(claim => claim.resourceId))
      .toEqual(['entry_a', 'entry_b']);

    const losingId = `job_loser_${Date.now()}`;
    expect(() => createResourceScopedJob(BACKGROUND_JOB_TYPES.COPY_BATCH_GENERATION, {
      id: losingId,
      workspaceId: wsId,
      resources: [copyEntry('entry_b'), copyEntry('entry_c')],
    })).toThrowError(ActiveJobResourceConflict);
    expect(getJob(losingId)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS count FROM job_resource_claims WHERE job_id = ?')
      .get(losingId)).toEqual({ count: 0 });
  });

  it('reports every active owner when a batch overlaps multiple jobs', () => {
    const wsId = workspaceId('multi_owner');
    const first = createResourceScopedJob(BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION, {
      workspaceId: wsId,
      resources: [copyEntry('entry_a')],
    });
    const second = createResourceScopedJob(BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION, {
      workspaceId: wsId,
      resources: [copyEntry('entry_b')],
    });
    let conflict: ActiveJobResourceConflict | undefined;
    try {
      createResourceScopedJob(BACKGROUND_JOB_TYPES.COPY_BATCH_GENERATION, {
        workspaceId: wsId,
        resources: [copyEntry('entry_a'), copyEntry('entry_b')],
      });
    } catch (err) {
      if (err instanceof ActiveJobResourceConflict) conflict = err;
    }
    expect(conflict?.owners).toEqual([
      { jobId: first.job.id, resource: copyEntry('entry_a') },
      { jobId: second.job.id, resource: copyEntry('entry_b') },
    ]);
  });

  it('rolls back the job and claims when domain acceptance fails', () => {
    const wsId = workspaceId('rollback');
    const jobId = `job_accept_${Date.now()}`;
    db.exec('CREATE TEMP TABLE IF NOT EXISTS job_claim_acceptance_test (job_id TEXT PRIMARY KEY)');

    expect(() => createResourceScopedJob(BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION, {
      id: jobId,
      workspaceId: wsId,
      resources: [{
        resourceType: JOB_RESOURCE_TYPES.CONTENT_POST_FOR_BRIEF,
        resourceId: 'brief_1',
      }],
      accept: job => {
        db.prepare('INSERT INTO job_claim_acceptance_test (job_id) VALUES (?)').run(job.id);
        throw new Error('domain acceptance failed');
      },
    })).toThrow('domain acceptance failed');

    expect(getJob(jobId)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS count FROM job_claim_acceptance_test WHERE job_id = ?')
      .get(jobId)).toEqual({ count: 0 });
  });

  it('rejects async acceptance before any callback work runs', () => {
    const wsId = workspaceId('async');
    let invoked = false;
    const asyncAcceptance = (async () => {
      invoked = true;
      return 'unsafe';
    }) as unknown as () => never;

    expect(() => createResourceScopedJob(BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION, {
      workspaceId: wsId,
      resources: [{
        resourceType: JOB_RESOURCE_TYPES.CONTENT_POST_FOR_BRIEF,
        resourceId: 'brief_async',
      }],
      accept: asyncAcceptance,
    })).toThrow('must be synchronous');
    expect(invoked).toBe(false);
  });

  it('does not misclassify a domain unique violation as a resource conflict', () => {
    const wsId = workspaceId('domain_unique');
    db.exec('CREATE TEMP TABLE IF NOT EXISTS job_claim_domain_unique_test (id TEXT PRIMARY KEY)');
    db.prepare('INSERT OR IGNORE INTO job_claim_domain_unique_test (id) VALUES (?)').run('duplicate');
    let caught: unknown;
    try {
      createResourceScopedJob(BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION, {
        workspaceId: wsId,
        resources: [{
          resourceType: JOB_RESOURCE_TYPES.CONTENT_POST_FOR_BRIEF,
          resourceId: 'brief_domain_unique',
        }],
        accept: () => {
          db.prepare('INSERT INTO job_claim_domain_unique_test (id) VALUES (?)').run('duplicate');
        },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(ActiveJobResourceConflict);
  });

  it('releases claims on completion and allows a retry', () => {
    const wsId = workspaceId('retry');
    const resource = copyEntry('entry_retry');
    const first = createResourceScopedJob(BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION, {
      workspaceId: wsId,
      resources: [resource],
    });
    updateJob(first.job.id, { status: 'done', message: 'Complete' });
    expect(getJobResourceClaims(first.job.id)[0].active).toBe(false);

    const retry = createResourceScopedJob(BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION, {
      workspaceId: wsId,
      resources: [resource],
    });
    expect(retry.job.id).not.toBe(first.job.id);
  });

  it('retains cancellation claims until the worker drains', () => {
    const wsId = workspaceId('cancel');
    const resource = copyEntry('entry_cancel');
    const first = createResourceScopedJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH, {
      workspaceId: wsId,
      resources: [resource],
    });
    updateJob(first.job.id, { status: 'running' });
    registerAbort(first.job.id);
    cancelJob(first.job.id);

    expect(getJobResourceClaims(first.job.id)[0].active).toBe(true);
    expect(() => createResourceScopedJob(BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION, {
      workspaceId: wsId,
      resources: [resource],
    })).toThrowError(ActiveJobResourceConflict);

    unregisterAbort(first.job.id);
    expect(getJobResourceClaims(first.job.id)[0].active).toBe(false);
    expect(createResourceScopedJob(BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION, {
      workspaceId: wsId,
      resources: [resource],
    }).job.status).toBe('pending');
  });

  it('releases claims while recovering unreachable jobs after restart', () => {
    const wsId = workspaceId('restart');
    const resource = copyEntry('entry_restart');
    const interrupted = createResourceScopedJob(BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION, {
      workspaceId: wsId,
      resources: [resource],
    });

    expect(recoverInterruptedJobsAfterRestart()).toBeGreaterThanOrEqual(1);
    expect(getJob(interrupted.job.id)?.status).toBe('error');
    expect(getJobResourceClaims(interrupted.job.id)[0].active).toBe(false);
    expect(createResourceScopedJob(BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION, {
      workspaceId: wsId,
      resources: [resource],
    }).job.status).toBe('pending');
  });

  it('releases a cancelled worker claim after a process restart', () => {
    const wsId = workspaceId('cancel_restart');
    const resource = copyEntry('entry_cancel_restart');
    const interrupted = createResourceScopedJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH, {
      workspaceId: wsId,
      resources: [resource],
    });
    updateJob(interrupted.job.id, { status: 'running' });
    registerAbort(interrupted.job.id);
    cancelJob(interrupted.job.id);
    expect(getJobResourceClaims(interrupted.job.id)[0].active).toBe(true);

    recoverInterruptedJobsAfterRestart();
    expect(getJobResourceClaims(interrupted.job.id)[0].active).toBe(false);
    unregisterAbort(interrupted.job.id);
  });

  it('does not fail accepted work when a post-commit broadcaster throws', () => {
    const wsId = workspaceId('broadcast');
    initJobs(() => { throw new Error('socket unavailable'); });
    const started = createResourceScopedJob(BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION, {
      workspaceId: wsId,
      resources: [copyEntry('entry_broadcast')],
    });
    expect(getJob(started.job.id)?.status).toBe('pending');
    expect(getJobResourceClaims(started.job.id)[0].active).toBe(true);
    initJobs(() => undefined);
  });

  it('marks an early-return worker errored and releases its claim', async () => {
    const wsId = workspaceId('early_return');
    const started = createResourceScopedJob(BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION, {
      workspaceId: wsId,
      resources: [copyEntry('entry_early_return')],
    });
    await runResourceScopedJobWorker(started.job.id, async signal => {
      expect(signal.aborted).toBe(false);
      return 'returned too early';
    });
    expect(getJob(started.job.id)?.status).toBe('error');
    expect(getJobResourceClaims(started.job.id)[0].active).toBe(false);
  });

  it('releases a drained worker claim even when its fallback terminal write fails', async () => {
    const wsId = workspaceId('terminal_write_failure');
    const resource = copyEntry('entry_terminal_write_failure');
    const jobId = `job_claim_terminal_write_failure_${Date.now()}`;
    const started = createResourceScopedJob(BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION, {
      id: jobId,
      workspaceId: wsId,
      resources: [resource],
    });
    db.exec(`
      CREATE TEMP TRIGGER fail_claim_terminal_write
      BEFORE UPDATE ON jobs
      WHEN OLD.id = '${jobId}' AND NEW.status = 'error'
      BEGIN
        SELECT RAISE(FAIL, 'injected terminal write failure');
      END
    `);

    try {
      await expect(runResourceScopedJobWorker(started.job.id, async () => (
        'returned before terminalizing'
      ))).rejects.toThrow('injected terminal write failure');
    } finally {
      db.exec('DROP TRIGGER IF EXISTS fail_claim_terminal_write');
    }

    expect(getJob(started.job.id)?.status).toBe('pending');
    expect(getJobResourceClaims(started.job.id)[0].active).toBe(false);
    expect(createResourceScopedJob(BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION, {
      workspaceId: wsId,
      resources: [resource],
    }).job.status).toBe('pending');
  });
});

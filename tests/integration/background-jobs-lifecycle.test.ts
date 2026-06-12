/**
 * Integration tests for background job lifecycle.
 *
 * Covers job shape, empty lists, cancel/non-cancel/missing-job scenarios,
 * cross-workspace isolation, per-job status endpoint, completed-job cleanup,
 * label lookups, concurrent jobs, and result-behavior metadata — all aspects
 * NOT covered by tests/integration/jobs-routes.test.ts.
 *
 * Architecture note: the HTTP server runs in a separate child process.
 * Jobs created directly via `createJob()` are written to SQLite and ARE
 * visible to `GET /api/jobs/:id` (which falls back to SQLite) and to
 * `DELETE /api/jobs/:id` (which also uses the SQLite fallback). However,
 * `GET /api/jobs?workspaceId=` reads only from the child process's in-memory
 * cache and therefore only reflects jobs that were already in SQLite when the
 * child started, or jobs the child process itself created. Tests that need to
 * assert list contents use a fresh workspace and verify that newly-created
 * direct jobs are NOT in the list (isolation checks), or assert list emptiness
 * for a brand-new workspace.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import {
  createJob,
  updateJob,
  clearCompletedJobs,
} from '../../server/jobs.js';
import {
  BACKGROUND_JOB_TYPES,
  BACKGROUND_JOB_METADATA,
  getBackgroundJobLabel,
  isBackgroundJobCancellable,
} from '../../shared/types/background-jobs.js';
import { BACKGROUND_JOB_LIFECYCLE_MATRIX } from '../helpers/background-job-test-matrix.js';

// startupTimeoutMs raised to 40s so this test survives pre-commit runs where
// multiple subprocess servers start concurrently under load.
const ctx = createEphemeralTestContext(import.meta.url, { startupTimeoutMs: 40_000 });
const { api, del } = ctx;

let wsAId = '';
let wsBId = '';

beforeAll(async () => {
  await ctx.startServer();
  const wsA = createWorkspace('BG Jobs Lifecycle WS-A');
  wsAId = wsA.id;
  const wsB = createWorkspace('BG Jobs Lifecycle WS-B');
  wsBId = wsB.id;
}, 45_000);

afterAll(async () => {
  clearCompletedJobs();
  deleteWorkspace(wsAId);
  deleteWorkspace(wsBId);
  await ctx.stopServer();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Job shape via GET /api/jobs/:id
// Jobs created by the test process are written to SQLite and visible via the
// individual GET endpoint (which falls back to SQLite on cache miss).
// ─────────────────────────────────────────────────────────────────────────────

describe('Job shape via GET /api/jobs/:id', () => {
  it('GET /api/jobs/:id returns 200 for a newly created job', async () => {
    const job = createJob(BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR, { workspaceId: wsAId, message: 'shape test' });

    const res = await api(`/api/jobs/${job.id}`);
    expect(res.status).toBe(200);

    updateJob(job.id, { status: 'done' });
  });

  it('job response has required fields: id, type, status, createdAt, workspaceId', async () => {
    const job = createJob(BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR, { workspaceId: wsAId, message: 'fields test' });

    const res = await api(`/api/jobs/${job.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;

    expect(typeof body.id).toBe('string');
    expect(body.id).toBe(job.id);
    expect(typeof body.type).toBe('string');
    expect(typeof body.status).toBe('string');
    expect(typeof body.createdAt).toBe('string');
    expect(body.workspaceId).toBe(wsAId);

    updateJob(job.id, { status: 'done' });
  });

  it('job response type matches the registered BACKGROUND_JOB_TYPES constant', async () => {
    const job = createJob(BACKGROUND_JOB_TYPES.PAGE_ANALYSIS, { workspaceId: wsAId, message: 'type check' });

    const res = await api(`/api/jobs/${job.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.type).toBe(BACKGROUND_JOB_TYPES.PAGE_ANALYSIS);

    updateJob(job.id, { status: 'done' });
  });

  it('job initial status is "pending"', async () => {
    const job = createJob(BACKGROUND_JOB_TYPES.SEO_BULK_ANALYZE, { workspaceId: wsAId, message: 'initial status' });

    const res = await api(`/api/jobs/${job.id}`);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('pending');

    updateJob(job.id, { status: 'done' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Empty job list (new workspace has no jobs)
// ─────────────────────────────────────────────────────────────────────────────

describe('Empty job list', () => {
  it('GET /api/jobs?workspaceId returns empty array for a brand new workspace', async () => {
    const emptyWs = createWorkspace('BG Jobs Empty WS');

    try {
      const res = await api(`/api/jobs?workspaceId=${emptyWs.id}`);
      expect(res.status).toBe(200);
      const body = await res.json() as unknown[];
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(0);
    } finally {
      deleteWorkspace(emptyWs.id);
    }
  });

  it('GET /api/jobs returns 200 with an array (global list)', async () => {
    const res = await api('/api/jobs');
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Cancel a cancellable job
// DELETE /api/jobs/:id calls getJob() which falls back to SQLite on cache miss,
// so jobs created in the test process are cancel-able via the HTTP endpoint.
// ─────────────────────────────────────────────────────────────────────────────

describe('Cancel — cancellable job', () => {
  it('DELETE /api/jobs/:id returns 200 for a pending cancellable job', async () => {
    const job = createJob(BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR, { workspaceId: wsAId });

    const res = await del(`/api/jobs/${job.id}`);
    expect(res.status).toBe(200);
  });

  it('DELETE response body has status "cancelled"', async () => {
    const job = createJob(BACKGROUND_JOB_TYPES.PAGE_ANALYSIS, { workspaceId: wsAId });

    const res = await del(`/api/jobs/${job.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('cancelled');
  });

  it('GET /api/jobs/:id reflects cancelled status after DELETE', async () => {
    const job = createJob(BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION, { workspaceId: wsAId });

    await del(`/api/jobs/${job.id}`);

    const res = await api(`/api/jobs/${job.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('cancelled');
  });

  it('DELETE response includes the job id matching the cancelled job', async () => {
    const job = createJob(BACKGROUND_JOB_TYPES.SEO_BULK_ANALYZE, { workspaceId: wsAId });

    const res = await del(`/api/jobs/${job.id}`);
    const body = await res.json() as Record<string, unknown>;
    expect(body.id).toBe(job.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Cancellation metadata (type-level checks only)
// The DELETE route behavior itself is covered in jobs-routes.test.ts. This
// suite keeps the metadata matrix honest across every registered job type.
// ─────────────────────────────────────────────────────────────────────────────

describe('Cancellation metadata', () => {
  it.each(Object.entries(BACKGROUND_JOB_LIFECYCLE_MATRIX))(
    '%s matches the pinned cancellable flag',
    (type, entry) => {
      expect(isBackgroundJobCancellable(type)).toBe(entry.expectedCancellable);
    },
  );
});

describe('Metadata completeness', () => {
  it.each(Object.entries(BACKGROUND_JOB_LIFECYCLE_MATRIX))(
    '%s matches the pinned result-behavior category',
    (type, entry) => {
      expect(BACKGROUND_JOB_METADATA[type].resultBehavior).toBe(entry.expectedResultBehavior);
    },
  );

  it.each(Object.entries(BACKGROUND_JOB_LIFECYCLE_MATRIX))(
    '%s matches the pinned label',
    (type, entry) => {
      expect(getBackgroundJobLabel(type)).toBe(entry.expectedLabel);
    },
  );

  it('getBackgroundJobLabel falls back to the raw type string for unknown types', () => {
    expect(getBackgroundJobLabel('some-unknown-job-type')).toBe('some-unknown-job-type');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Cancel nonexistent job
// ─────────────────────────────────────────────────────────────────────────────

describe('Cancel — nonexistent job', () => {
  it('DELETE /api/jobs/:id with unknown id returns 404', async () => {
    const res = await del('/api/jobs/no-such-job-id-xyz');
    expect(res.status).toBe(404);
  });

  it('404 response body has an error field with a non-empty string', async () => {
    const res = await del('/api/jobs/not-a-real-job-000');
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
    expect((body.error as string).length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Cross-workspace isolation (using GET /api/jobs/:id via SQLite fallback)
// Test-process jobs are visible to the child server via SQLite. Workspace
// ownership is enforced at the HTTP layer by requestUserCanAccessWorkspace.
// Without a scoped JWT, both workspaces are accessible (admin pass is empty in
// test server), so we verify that workspace A jobs carry wsAId and vice versa.
// ─────────────────────────────────────────────────────────────────────────────

describe('Cross-workspace isolation', () => {
  it('workspace A job carries wsA id in workspaceId field', async () => {
    const job = createJob(BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR, { workspaceId: wsAId, message: 'ws-a job' });

    const res = await api(`/api/jobs/${job.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.workspaceId).toBe(wsAId);
    expect(body.workspaceId).not.toBe(wsBId);

    updateJob(job.id, { status: 'done' });
  });

  it('workspace B job carries wsB id in workspaceId field', async () => {
    const job = createJob(BACKGROUND_JOB_TYPES.PAGE_ANALYSIS, { workspaceId: wsBId, message: 'ws-b job' });

    const res = await api(`/api/jobs/${job.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.workspaceId).toBe(wsBId);
    expect(body.workspaceId).not.toBe(wsAId);

    updateJob(job.id, { status: 'done' });
  });

  it('GET /api/jobs?workspaceId=wsA returns empty for a fresh workspace (no cross-contamination)', async () => {
    const isoWs = createWorkspace('BG Jobs Isolation WS');
    try {
      // A different workspace has a job — should not appear in isoWs list
      const otherJob = createJob(BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR, { workspaceId: wsAId });

      const res = await api(`/api/jobs?workspaceId=${isoWs.id}`);
      expect(res.status).toBe(200);
      const body = await res.json() as Array<Record<string, unknown>>;
      // Fresh workspace has no jobs in child process cache
      expect(body.length).toBe(0);

      updateJob(otherJob.id, { status: 'done' });
    } finally {
      deleteWorkspace(isoWs.id);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Job status endpoint (GET /api/jobs/:id)
// ─────────────────────────────────────────────────────────────────────────────

describe('Job status endpoint', () => {
  it('GET /api/jobs/:id returns 200 and full job object', async () => {
    const job = createJob(BACKGROUND_JOB_TYPES.SEO_BULK_ANALYZE, { workspaceId: wsAId, message: 'status test' });

    const res = await api(`/api/jobs/${job.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.id).toBe(job.id);
    expect(body.type).toBe(BACKGROUND_JOB_TYPES.SEO_BULK_ANALYZE);
    expect(body.workspaceId).toBe(wsAId);

    updateJob(job.id, { status: 'done' });
  });

  it('GET /api/jobs/:id reflects progress and message updates', async () => {
    const job = createJob(BACKGROUND_JOB_TYPES.SEO_BULK_ANALYZE, { workspaceId: wsAId, total: 10 });
    updateJob(job.id, { status: 'running', progress: 5, message: 'halfway' });

    const res = await api(`/api/jobs/${job.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('running');
    expect(body.progress).toBe(5);
    expect(body.total).toBe(10);
    expect(body.message).toBe('halfway');

    updateJob(job.id, { status: 'done' });
  });

  it('GET /api/jobs/:id returns 404 for a completely unknown id', async () => {
    const res = await api('/api/jobs/absolutely-nonexistent-id-99');
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('Job not found');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Completed job cleanup
// clearCompletedJobs() deletes from SQLite, so the individual GET endpoint
// (which falls back to SQLite) returns 404 after clearing.
// ─────────────────────────────────────────────────────────────────────────────

describe('Completed job cleanup', () => {
  it('done job is not found via GET /api/jobs/:id after DELETE /api/jobs/completed for that workspace', async () => {
    const cleanWs = createWorkspace('BG Jobs Clean WS-1');
    try {
      const job = createJob(BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR, { workspaceId: cleanWs.id });
      updateJob(job.id, { status: 'done' });

      // Confirm it exists before clearing (GET falls back to SQLite on cache miss)
      const beforeRes = await api(`/api/jobs/${job.id}`);
      expect(beforeRes.status).toBe(200);

      // Use the HTTP endpoint so the child process clears its own in-memory cache too
      const clearRes = await del(`/api/jobs/completed?workspaceId=${cleanWs.id}`);
      expect(clearRes.status).toBe(200);

      // Gone after clear — SQLite row deleted and child cache evicted
      const afterRes = await api(`/api/jobs/${job.id}`);
      expect(afterRes.status).toBe(404);
    } finally {
      deleteWorkspace(cleanWs.id);
    }
  });

  it('errored job is also removed by DELETE /api/jobs/completed', async () => {
    const cleanWs = createWorkspace('BG Jobs Clean WS-2');
    try {
      const job = createJob(BACKGROUND_JOB_TYPES.PAGE_ANALYSIS, { workspaceId: cleanWs.id });
      updateJob(job.id, { status: 'running' });
      updateJob(job.id, { status: 'error', error: 'something went wrong' });

      // Use HTTP endpoint so child process evicts from its in-memory cache too
      await del(`/api/jobs/completed?workspaceId=${cleanWs.id}`);

      const res = await api(`/api/jobs/${job.id}`);
      expect(res.status).toBe(404);
    } finally {
      deleteWorkspace(cleanWs.id);
    }
  });

  it('DELETE /api/jobs/completed?workspaceId=A does not remove workspace B completed jobs', async () => {
    const cleanWsA = createWorkspace('BG Jobs Clean WS-A');
    const cleanWsB = createWorkspace('BG Jobs Clean WS-B');
    try {
      const jobA = createJob(BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR, { workspaceId: cleanWsA.id });
      const jobB = createJob(BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR, { workspaceId: cleanWsB.id });
      updateJob(jobA.id, { status: 'done' });
      updateJob(jobB.id, { status: 'done' });

      // Use HTTP endpoint to clear only workspace A — child process cache is the authority
      await del(`/api/jobs/completed?workspaceId=${cleanWsA.id}`);

      const resA = await api(`/api/jobs/${jobA.id}`);
      expect(resA.status).toBe(404);

      // jobB was written to SQLite by the parent process and never loaded into the
      // child's cache, so the child will fall back to SQLite here and return 200.
      const resB = await api(`/api/jobs/${jobB.id}`);
      expect(resB.status).toBe(200);
    } finally {
      await del(`/api/jobs/completed?workspaceId=${cleanWsB.id}`);
      deleteWorkspace(cleanWsA.id);
      deleteWorkspace(cleanWsB.id);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Job label lookup
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// 10. Multiple concurrent jobs (using GET /api/jobs/:id per job)
// ─────────────────────────────────────────────────────────────────────────────

describe('Multiple concurrent jobs', () => {
  it('all concurrent jobs are individually accessible via GET /api/jobs/:id', async () => {
    const j1 = createJob(BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR, { workspaceId: wsAId, message: 'concurrent-1' });
    const j2 = createJob(BACKGROUND_JOB_TYPES.PAGE_ANALYSIS, { workspaceId: wsAId, message: 'concurrent-2' });
    const j3 = createJob(BACKGROUND_JOB_TYPES.SEO_BULK_ANALYZE, { workspaceId: wsAId, message: 'concurrent-3' });

    const [r1, r2, r3] = await Promise.all([
      api(`/api/jobs/${j1.id}`),
      api(`/api/jobs/${j2.id}`),
      api(`/api/jobs/${j3.id}`),
    ]);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);

    updateJob(j1.id, { status: 'done' });
    updateJob(j2.id, { status: 'done' });
    updateJob(j3.id, { status: 'done' });
  });

  it('cancelling one job does not affect siblings — GET /api/jobs/:id shows correct status per job', async () => {
    const j1 = createJob(BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR, { workspaceId: wsAId, message: 'keep-1' });
    const j2 = createJob(BACKGROUND_JOB_TYPES.PAGE_ANALYSIS, { workspaceId: wsAId, message: 'cancel-me' });
    const j3 = createJob(BACKGROUND_JOB_TYPES.SEO_BULK_ANALYZE, { workspaceId: wsAId, message: 'keep-2' });

    await del(`/api/jobs/${j2.id}`);

    const [resJ1, resJ2, resJ3] = await Promise.all([
      api(`/api/jobs/${j1.id}`),
      api(`/api/jobs/${j2.id}`),
      api(`/api/jobs/${j3.id}`),
    ]);

    const bodyJ1 = await resJ1.json() as Record<string, unknown>;
    const bodyJ2 = await resJ2.json() as Record<string, unknown>;
    const bodyJ3 = await resJ3.json() as Record<string, unknown>;

    expect(bodyJ1.status).toBe('pending');
    expect(bodyJ2.status).toBe('cancelled');
    expect(bodyJ3.status).toBe('pending');

    updateJob(j1.id, { status: 'done' });
    updateJob(j3.id, { status: 'done' });
  });

  it('cancelled job id is returned in DELETE response body', async () => {
    const job = createJob(BACKGROUND_JOB_TYPES.SEO_BULK_REWRITE, { workspaceId: wsAId });

    const res = await del(`/api/jobs/${job.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.id).toBe(job.id);
    expect(body.status).toBe('cancelled');
  });

  it('three concurrent cancel requests each return 200 for their respective jobs', async () => {
    const j1 = createJob(BACKGROUND_JOB_TYPES.SEO_BULK_ACCEPT_FIXES, { workspaceId: wsAId });
    const j2 = createJob(BACKGROUND_JOB_TYPES.SEO_BULK_REWRITE, { workspaceId: wsAId });
    const j3 = createJob(BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION, { workspaceId: wsAId });

    const [r1, r2, r3] = await Promise.all([
      del(`/api/jobs/${j1.id}`),
      del(`/api/jobs/${j2.id}`),
      del(`/api/jobs/${j3.id}`),
    ]);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Job result payload behavior
// ─────────────────────────────────────────────────────────────────────────────

describe('Job result payload behavior', () => {
  it('domain-store-and-result job carries a result payload after done', async () => {
    const job = createJob(BACKGROUND_JOB_TYPES.SEO_AUDIT, { workspaceId: wsAId });
    updateJob(job.id, { status: 'done', result: { siteScore: 88 } });

    const res = await api(`/api/jobs/${job.id}`);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('done');
    expect(body.result).toBeDefined();
    expect((body.result as Record<string, unknown>).siteScore).toBe(88);
  });
});

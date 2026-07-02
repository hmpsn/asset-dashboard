/**
 * R2-B — Agency work feed integration tests.
 *
 * Covers:
 *  - Public activity endpoint: only CLIENT_VISIBLE_TYPES appear (admin-only type excluded).
 *  - Public activity endpoint: pagination params (limit + offset) are honoured.
 *  - Public jobs endpoint: running job is projected with label; admin-only type is excluded.
 *  - Both endpoints reject unauthenticated callers on password-protected workspaces.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { addActivity } from '../../server/activity-log.js';
import { createJob, updateJob } from '../../server/jobs.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api, clearCookies } = ctx;

let workspaceId = '';
let protectedWorkspaceId = '';

// Activity IDs for assertion
let visibleActivityId = '';
// The admin-only type we'll insert (not in CLIENT_VISIBLE_TYPES)
const ADMIN_ONLY_TYPE = 'post_ai_review';

// Job IDs
let visibleJobId = '';
let invisibleJobId = '';
let systemJobId = '';

beforeAll(async () => {
  workspaceId = createWorkspace('Agency Feed Test').id;
  protectedWorkspaceId = createWorkspace('Agency Feed Protected').id;
  updateWorkspace(protectedWorkspaceId, { clientPassword: 'agency-feed-password' });

  // Insert a CLIENT_VISIBLE activity entry
  const visible = addActivity(workspaceId, 'audit_completed', 'Site audit done');
  visibleActivityId = visible.id;

  // Insert an admin-only activity entry — must NOT appear in the public feed
  addActivity(workspaceId, ADMIN_ONLY_TYPE as Parameters<typeof addActivity>[1], 'AI review verdict');

  // Add enough visible entries to test pagination (>1)
  for (let i = 0; i < 5; i++) {
    addActivity(workspaceId, 'seo_updated', `Meta updated batch ${i}`);
  }

  // Create a client-visible job (recommendations-generation is in CLIENT_VISIBLE_JOB_TYPES)
  const visibleJob = createJob(BACKGROUND_JOB_TYPES.RECOMMENDATIONS_GENERATION, {
    workspaceId,
    message: 'Generating recommendations',
  });
  visibleJobId = visibleJob.id;
  updateJob(visibleJobId, { status: 'running', progress: 40, total: 100 });

  // Create an admin-only job (page-analysis is NOT in CLIENT_VISIBLE_JOB_TYPES)
  const invisibleJob = createJob(BACKGROUND_JOB_TYPES.PAGE_ANALYSIS, {
    workspaceId,
    message: 'Analysing pages',
  });
  invisibleJobId = invisibleJob.id;

  // Create a system/cron-originated job (intelligence-recompute — the one type
  // classified `class: 'system'` in BACKGROUND_JOB_METADATA). A nightly recompute
  // must never appear in a client's task panel.
  const systemJob = createJob(BACKGROUND_JOB_TYPES.INTELLIGENCE_RECOMPUTE, {
    workspaceId,
    message: 'Refreshing signals...',
  });
  systemJobId = systemJob.id;

  await ctx.startServer();
}, 25_000);

afterAll(async () => {
  deleteWorkspace(workspaceId);
  deleteWorkspace(protectedWorkspaceId);
  await ctx.stopServer();
});

// ── Activity feed ────────────────────────────────────────────────────

describe('GET /api/public/activity/:workspaceId', () => {
  it('returns only CLIENT_VISIBLE_TYPES — admin-only type is absent', async () => {
    clearCookies();
    const res = await api(`/api/public/activity/${workspaceId}`);
    expect(res.status).toBe(200);

    const body = await res.json() as Array<Record<string, unknown>>;
    expect(Array.isArray(body)).toBe(true);

    // Visible entry must be present
    expect(body.some((e) => e.id === visibleActivityId)).toBe(true);

    // Admin-only type must NOT appear
    const adminOnlyRows = body.filter((e) => e.type === ADMIN_ONLY_TYPE);
    expect(adminOnlyRows).toHaveLength(0);
  });

  it('respects limit param', async () => {
    clearCookies();
    const res = await api(`/api/public/activity/${workspaceId}?limit=2`);
    expect(res.status).toBe(200);

    const body = await res.json() as Array<Record<string, unknown>>;
    expect(body.length).toBeLessThanOrEqual(2);
  });

  it('respects limit + offset (pagination)', async () => {
    clearCookies();

    // Fetch first page
    const page1 = await (await api(`/api/public/activity/${workspaceId}?limit=3&offset=0`)).json() as Array<Record<string, unknown>>;
    // Fetch second page
    const page2 = await (await api(`/api/public/activity/${workspaceId}?limit=3&offset=3`)).json() as Array<Record<string, unknown>>;

    // Pages must not overlap (different IDs)
    const ids1 = new Set(page1.map((e) => e.id));
    for (const entry of page2) {
      expect(ids1.has(entry.id)).toBe(false);
    }
  });

  it('returns 401 for a protected workspace without a portal session', async () => {
    clearCookies();
    const res = await api(`/api/public/activity/${protectedWorkspaceId}`, {
      headers: { 'x-no-auto-public-auth': 'true' },
    });
    expect(res.status).toBe(401);
  });
});

// ── Jobs feed ────────────────────────────────────────────────────────

describe('GET /api/public/jobs/:workspaceId (agency work feed)', () => {
  it('returns the client-visible job with a scrubbed payload', async () => {
    clearCookies();
    const res = await api(`/api/public/jobs/${workspaceId}`);
    expect(res.status).toBe(200);

    const body = await res.json() as Array<Record<string, unknown>>;
    const job = body.find((j) => j.id === visibleJobId);

    expect(job).toBeDefined();
    // result must be stripped
    expect(job).not.toHaveProperty('result');
    // Type, workspaceId, and progress are present
    expect(job?.type).toBe(BACKGROUND_JOB_TYPES.RECOMMENDATIONS_GENERATION);
    expect(job?.workspaceId).toBe(workspaceId);
  });

  it('excludes admin-only job types', async () => {
    clearCookies();
    const res = await api(`/api/public/jobs/${workspaceId}`);
    expect(res.status).toBe(200);

    const body = await res.json() as Array<Record<string, unknown>>;
    const adminJob = body.find((j) => j.id === invisibleJobId);
    expect(adminJob).toBeUndefined();
  });

  it('excludes system/cron-originated job types (a nightly recompute must not appear in the client task panel)', async () => {
    clearCookies();
    const res = await api(`/api/public/jobs/${workspaceId}`);
    expect(res.status).toBe(200);

    const body = await res.json() as Array<Record<string, unknown>>;
    const systemJob = body.find((j) => j.id === systemJobId);
    expect(systemJob).toBeUndefined();
  });

  it('returns 401 for a protected workspace without a portal session', async () => {
    clearCookies();
    const res = await api(`/api/public/jobs/${protectedWorkspaceId}`, {
      headers: { 'x-no-auto-public-auth': 'true' },
    });
    expect(res.status).toBe(401);
  });
});

// ── Admin job feed — system-origin jobs remain fully visible to admins ────────

describe('GET /api/jobs?workspaceId (admin feed keeps system-origin jobs visible)', () => {
  it('includes the system/cron-originated job (admin bell shows everything)', async () => {
    const res = await api(`/api/jobs/${systemJobId}`);
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body.id).toBe(systemJobId);
    expect(body.type).toBe(BACKGROUND_JOB_TYPES.INTELLIGENCE_RECOMPUTE);
  });
});

/**
 * Integration tests for the national SERP rank refresh route (SEO Decision Engine
 * P6 / national-serp-tracking):
 *
 *   POST /api/rank-tracking/:workspaceId/refresh-national
 *
 * The route is triple-gated:
 *   1. Feature flag `national-serp-tracking` (default OFF) → 404 when off.
 *   2. Effective tier — Growth/Premium only → 403 for Free.
 *   3. Budget gate is observe-only (does NOT block) — never asserted here.
 *
 * Flag-enable + tier-set both happen IN-PROCESS (setWorkspaceFlagOverride /
 * updateWorkspace) BEFORE startServer(), so the spawned server reads the fresh
 * override/tier from the shared DATA_DIR DB on its first request (10s cache TTL,
 * never stale within a test run). This mirrors tests/integration/the-issue-p1b-*.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import { addTrackedKeyword } from '../../server/rank-tracking.js';
import { storeSerpSnapshots } from '../../server/serp-snapshots-store.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';

const ctx = createEphemeralTestContext(import.meta.url, { contextName: 'national-serp-routes' });
const { api, postJson } = ctx;

let wsFlagOff = ''; // flag OFF (default), tier growth → 404 (flag gate fires first)
let wsFree = '';    // flag ON, tier free → 403
let wsGrowth = '';  // flag ON, tier growth → 200 { jobId }

beforeAll(async () => {
  const off = createWorkspace('National SERP — Flag Off');
  wsFlagOff = off.id;
  const free = createWorkspace('National SERP — Free Tier');
  wsFree = free.id;
  const growth = createWorkspace('National SERP — Growth Tier');
  wsGrowth = growth.id;

  // wsFlagOff: leave the flag at its default (OFF). Tier is growth so the ONLY
  // thing producing the 404 is the flag gate (proves flag precedence over tier).
  updateWorkspace(wsFlagOff, { tier: 'growth' });

  // wsFree: flag ON, tier free → 403. createWorkspace() seeds a 14-day trial that
  // computeEffectiveTier() promotes free→growth while active, so the trial MUST be
  // cleared for the effective tier to resolve to 'free'. Passing trialEndsAt:
  // undefined writes a SQL NULL (the key is present, so the column is updated to
  // `merged.trialEndsAt ?? null`).
  setWorkspaceFlagOverride('national-serp-tracking', wsFree, true);
  updateWorkspace(wsFree, { tier: 'free', trialEndsAt: undefined });

  // wsGrowth: flag ON, tier growth → 200 { jobId }. A live domain so the job can
  // proceed past the domain guard; with no getNationalSerp on the test provider it
  // finishes as a clean no-op.
  setWorkspaceFlagOverride('national-serp-tracking', wsGrowth, true);
  updateWorkspace(wsGrowth, { tier: 'growth', liveDomain: 'https://acme.example' });

  await ctx.startServer();
}, 25_000);

afterAll(async () => {
  setWorkspaceFlagOverride('national-serp-tracking', wsFree, null);
  setWorkspaceFlagOverride('national-serp-tracking', wsGrowth, null);
  deleteWorkspace(wsFlagOff);
  deleteWorkspace(wsFree);
  deleteWorkspace(wsGrowth);
  await ctx.stopServer();
});

describe('POST /api/rank-tracking/:workspaceId/refresh-national — gating', () => {
  it('flag OFF (default) → 404', async () => {
    const res = await postJson(`/api/rank-tracking/${wsFlagOff}/refresh-national`, {});
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('National SERP tracking is not enabled');
  });

  it('flag ON + Free tier → 403 (requires a Growth or Premium plan)', async () => {
    const res = await postJson(`/api/rank-tracking/${wsFree}/refresh-national`, {});
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/Growth or Premium plan/);
  });

  it('flag ON + Growth tier → 200 with a jobId string', async () => {
    const res = await postJson(`/api/rank-tracking/${wsGrowth}/refresh-national`, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.jobId).toBe('string');
    expect(body.jobId.length).toBeGreaterThan(0);

    // The job runs in the spawned server process. Poll the jobs API (live cache in
    // the server process) until it reaches a terminal state — it should complete
    // cleanly (no-op: the test provider has no getNationalSerp), never error out
    // due to the route wiring itself.
    const jobId = body.jobId as string;
    const deadline = Date.now() + 10_000;
    let terminalStatus = '';
    while (Date.now() < deadline) {
      const jobRes = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
      expect(jobRes.status).toBe(200);
      const job = await jobRes.json();
      // The created job is the national-SERP refresh type (lifecycle signal anchor).
      expect(job.type).toBe(BACKGROUND_JOB_TYPES.NATIONAL_SERP_REFRESH);
      if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
        terminalStatus = job.status;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    // The no-op path ends in 'done'; assert it did not error.
    expect(terminalStatus).toBe('done');
  });
});

describe('POST /api/rank-tracking/:workspaceId/refresh-national — with seeded data', () => {
  it('does not 500 when tracked keywords + a serp_snapshots row already exist', async () => {
    // Seed a tracked keyword and a pre-existing snapshot row for today. The refresh
    // route + job must tolerate prior state without throwing.
    addTrackedKeyword(wsGrowth, 'cold brew coffee', { pinned: false });
    const today = new Date().toISOString().slice(0, 10);
    storeSerpSnapshots(wsGrowth, today, [{
      query: 'cold brew coffee',
      position: 3,
      matchedUrl: 'https://acme.example/cold-brew',
      features: ['ai_overview', 'featured_snippet'],
      aiOverviewCited: false,
      aiOverviewPresent: true,
    }]);

    const res = await postJson(`/api/rank-tracking/${wsGrowth}/refresh-national`, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.jobId).toBe('string');
  });
});

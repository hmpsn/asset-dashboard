/**
 * Integration tests for the GBP + reviews refresh route (SEO Decision Engine
 * P7 / local-gbp):
 *
 *   POST /api/local-seo/:workspaceId/refresh-gbp
 *   GET  /api/local-seo/:workspaceId/gbp-reviews
 *
 * The refresh route is triple-gated, mirroring the P6 national-SERP refresh:
 *   1. Feature flag `local-gbp` (default OFF) → 404 when off.
 *   2. Effective tier — Growth/Premium only → 403 for Free.
 *   3. Budget gate is observe-only (does NOT block) — never asserted here.
 *
 * Flag-enable + tier-set both happen IN-PROCESS (setWorkspaceFlagOverride /
 * updateWorkspace) BEFORE startServer(), so the spawned server reads the fresh
 * override/tier from the shared DATA_DIR DB on its first request (10s cache TTL,
 * never stale within a test run). This mirrors tests/integration/national-serp-routes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import { storeBusinessListingSnapshots } from '../../server/business-listings-store.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';

const ctx = createEphemeralTestContext(import.meta.url, { contextName: 'local-gbp-routes' });
const { api, postJson } = ctx;

let wsFlagOff = ''; // flag OFF (default), tier growth → 404 (flag gate fires first)
let wsFree = '';    // flag ON, tier free → 403
let wsGrowth = '';  // flag ON, tier growth → 200 { jobId }

beforeAll(async () => {
  const off = createWorkspace('Local GBP — Flag Off');
  wsFlagOff = off.id;
  const free = createWorkspace('Local GBP — Free Tier');
  wsFree = free.id;
  const growth = createWorkspace('Local GBP — Growth Tier');
  wsGrowth = growth.id;

  // wsFlagOff: leave the flag at its default (OFF). Tier is growth so the ONLY
  // thing producing the 404 is the flag gate (proves flag precedence over tier).
  updateWorkspace(wsFlagOff, { tier: 'growth' });

  // wsFree: flag ON, tier free → 403. createWorkspace() seeds a 14-day trial that
  // computeEffectiveTier() promotes free→growth while active, so the trial MUST be
  // cleared for the effective tier to resolve to 'free'. Passing trialEndsAt:
  // undefined writes a SQL NULL (the key is present, so the column is updated to
  // `merged.trialEndsAt ?? null`).
  setWorkspaceFlagOverride('local-gbp', wsFree, true);
  updateWorkspace(wsFree, { tier: 'free', trialEndsAt: undefined });

  // wsGrowth: flag ON, tier growth → 200 { jobId }. A live domain so the job can
  // proceed past the domain guard; with no active markets the job finishes as a
  // clean no-op ("No active markets with coordinates").
  setWorkspaceFlagOverride('local-gbp', wsGrowth, true);
  updateWorkspace(wsGrowth, { tier: 'growth', liveDomain: 'https://acme.example' });

  await ctx.startServer();
}, 25_000);

afterAll(async () => {
  setWorkspaceFlagOverride('local-gbp', wsFree, null);
  setWorkspaceFlagOverride('local-gbp', wsGrowth, null);
  deleteWorkspace(wsFlagOff);
  deleteWorkspace(wsFree);
  deleteWorkspace(wsGrowth);
  await ctx.stopServer();
});

describe('POST /api/local-seo/:workspaceId/refresh-gbp — gating', () => {
  it('flag OFF (default) → 404', async () => {
    const res = await postJson(`/api/local-seo/${wsFlagOff}/refresh-gbp`, {});
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('GBP + reviews tracking is not enabled');
  });

  it('flag ON + Free tier → 403 (requires a Growth or Premium plan)', async () => {
    const res = await postJson(`/api/local-seo/${wsFree}/refresh-gbp`, {});
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/Growth or Premium plan/);
  });

  it('flag ON + Growth tier → 200 with a jobId string', async () => {
    const res = await postJson(`/api/local-seo/${wsGrowth}/refresh-gbp`, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.jobId).toBe('string');
    expect(body.jobId.length).toBeGreaterThan(0);

    // The job runs in the spawned server process. Poll the jobs API (live cache in
    // the server process) until it reaches a terminal state — with no active markets
    // it should complete cleanly (no-op), never error out due to the route wiring.
    const jobId = body.jobId as string;
    const deadline = Date.now() + 10_000;
    let terminalStatus = '';
    while (Date.now() < deadline) {
      const jobRes = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
      expect(jobRes.status).toBe(200);
      const job = await jobRes.json();
      // The created job is the local-GBP refresh type (lifecycle-matrix signal anchor).
      expect(job.type).toBe(BACKGROUND_JOB_TYPES.LOCAL_GBP_REFRESH);
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

describe('GET /api/local-seo/:workspaceId/gbp-reviews — owned aggregate', () => {
  it('returns the owned listing + completeness score without a 500', async () => {
    // Seed an owned listing snapshot for today so the read path resolves a non-null
    // `owned` aggregate + a derived completeness score.
    const today = new Date().toISOString().slice(0, 10);
    storeBusinessListingSnapshots(wsGrowth, today, [
      {
        placeId: 'place-owner-1',
        isOwned: true,
        title: 'Acme Coffee Roasters',
        domain: 'acme.example',
        category: 'Coffee shop',
        rating: 4.6,
        reviewCount: 42,
        attributes: ['wheelchair_accessible', 'wifi', 'outdoor_seating'],
        totalPhotos: 18,
        claimed: true,
      },
      {
        placeId: 'place-comp-1',
        isOwned: false,
        title: 'Rival Brews',
        category: 'Coffee shop',
        rating: 4.3,
        reviewCount: 120,
        attributes: [],
      },
    ]);

    const res = await api(`/api/local-seo/${wsGrowth}/gbp-reviews`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.owned).not.toBeNull();
    expect(body.owned.placeId).toBe('place-owner-1');
    expect(body.owned.reviewCount).toBe(42);
    expect(Array.isArray(body.competitors)).toBe(true);
    expect(typeof body.completenessScore).toBe('number');
  });
});

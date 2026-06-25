/**
 * Integration tests for the AI-visibility (LLM-mentions) routes (SEO Decision
 * Engine P8 / ai-visibility):
 *
 *   POST /api/rank-tracking/:workspaceId/refresh-ai-visibility
 *   GET  /api/rank-tracking/:workspaceId/ai-visibility
 *
 * The refresh route is triple-gated, mirroring the P7 local-GBP refresh:
 *   1. Feature flag `ai-visibility` (default OFF) → 404 when off.
 *   2. Effective tier — Growth/Premium only → 403 for Free.
 *   3. Budget gate is observe-only (does NOT block) — never asserted here.
 *
 * Flag-enable + tier-set both happen IN-PROCESS (setWorkspaceFlagOverride /
 * updateWorkspace) BEFORE startServer(), so the spawned server reads the fresh
 * override/tier from the shared DATA_DIR DB on its first request (10s cache TTL,
 * never stale within a test run). This mirrors tests/integration/local-gbp-routes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import { storeLlmMentionSnapshot } from '../../server/llm-mentions-store.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';

const ctx = createEphemeralTestContext(import.meta.url, { contextName: 'ai-visibility-routes' });
const { api, postJson } = ctx;

let wsFlagOff = ''; // flag OFF (default), tier growth → 404 (flag gate fires first)
let wsFree = '';    // flag ON, tier free → 403
let wsGrowth = '';  // flag ON, tier growth → 200 { jobId }

beforeAll(async () => {
  const off = createWorkspace('AI Visibility — Flag Off');
  wsFlagOff = off.id;
  const free = createWorkspace('AI Visibility — Free Tier');
  wsFree = free.id;
  const growth = createWorkspace('AI Visibility — Growth Tier');
  wsGrowth = growth.id;

  // wsFlagOff: leave the flag at its default (OFF). Tier is growth so the ONLY
  // thing producing the 404 is the flag gate (proves flag precedence over tier).
  updateWorkspace(wsFlagOff, { tier: 'growth' });

  // wsFree: flag ON, tier free → 403. createWorkspace() seeds a 14-day trial that
  // computeEffectiveTier() promotes free→growth while active, so the trial MUST be
  // cleared for the effective tier to resolve to 'free'. Passing trialEndsAt:
  // undefined writes a SQL NULL (the key is present, so the column is updated to
  // `merged.trialEndsAt ?? null`).
  setWorkspaceFlagOverride('ai-visibility', wsFree, true);
  updateWorkspace(wsFree, { tier: 'free', trialEndsAt: undefined });

  // wsGrowth: flag ON, tier growth → 200 { jobId }. A live domain so the job can
  // proceed past the domain guard; with no configured LLM-mentions provider the job
  // finishes as a clean no-op ("Configured SEO provider does not support ...").
  setWorkspaceFlagOverride('ai-visibility', wsGrowth, true);
  updateWorkspace(wsGrowth, { tier: 'growth', liveDomain: 'https://acme.example' });

  await ctx.startServer();
}, 25_000);

afterAll(async () => {
  setWorkspaceFlagOverride('ai-visibility', wsFree, null);
  setWorkspaceFlagOverride('ai-visibility', wsGrowth, null);
  deleteWorkspace(wsFlagOff);
  deleteWorkspace(wsFree);
  deleteWorkspace(wsGrowth);
  await ctx.stopServer();
});

describe('POST /api/rank-tracking/:workspaceId/refresh-ai-visibility — gating', () => {
  it('flag OFF (default) → 404', async () => {
    const res = await postJson(`/api/rank-tracking/${wsFlagOff}/refresh-ai-visibility`, {});
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('AI visibility tracking is not enabled');
  });

  it('flag ON + Free tier → 403 (requires a Growth or Premium plan)', async () => {
    const res = await postJson(`/api/rank-tracking/${wsFree}/refresh-ai-visibility`, {});
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/Growth or Premium plan/);
  });

  it('flag ON + Growth tier → 200 with a jobId string', async () => {
    const res = await postJson(`/api/rank-tracking/${wsGrowth}/refresh-ai-visibility`, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.jobId).toBe('string');
    expect(body.jobId.length).toBeGreaterThan(0);

    // The job runs in the spawned server process. Poll the jobs API (live cache in
    // the server process) until it reaches a terminal state — with no configured
    // LLM-mentions provider it should complete cleanly (no-op), never error out due
    // to the route wiring.
    const jobId = body.jobId as string;
    const deadline = Date.now() + 10_000;
    let terminalStatus = '';
    while (Date.now() < deadline) {
      const jobRes = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
      expect(jobRes.status).toBe(200);
      const job = await jobRes.json();
      // The created job is the LLM-mentions refresh type (lifecycle-matrix signal anchor).
      expect(job.type).toBe(BACKGROUND_JOB_TYPES.LLM_MENTIONS_REFRESH);
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

describe('GET /api/rank-tracking/:workspaceId/ai-visibility — KPI readout', () => {
  it('flag OFF → 200 with an empty payload (renders nothing)', async () => {
    const res = await api(`/api/rank-tracking/${wsFlagOff}/ai-visibility`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.latest).toBeNull();
    expect(Array.isArray(body.trend)).toBe(true);
    expect(body.trend.length).toBe(0);
    expect(Array.isArray(body.competitors)).toBe(true);
    expect(Array.isArray(body.sourceDomains)).toBe(true);
  });

  it('flag ON + a seeded snapshot → 200 with latest populated (no 500)', async () => {
    // Seed a chat_gpt snapshot for today so the read path resolves a non-null
    // `latest` aggregate + a non-empty trend.
    const today = new Date().toISOString().slice(0, 10);
    storeLlmMentionSnapshot(wsGrowth, today, 'chat_gpt', {
      domain: 'acme.example',
      mentions: 12,
      aiSearchVolume: 480,
      shareOfVoice: 0.34,
      competitors: [
        { name: 'Rival Brews', mentions: 20, aiSearchVolume: 900 },
        { name: 'Third Wave Co', mentions: 8 },
      ],
      sourceDomains: [
        { domain: 'wikipedia.org', mentions: 5 },
        { domain: 'reddit.com', mentions: 3 },
      ],
    });

    const res = await api(`/api/rank-tracking/${wsGrowth}/ai-visibility`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.latest).not.toBeNull();
    expect(body.latest.platform).toBe('chat_gpt');
    expect(body.latest.mentions).toBe(12);
    expect(body.latest.shareOfVoice).toBeCloseTo(0.34);
    expect(Array.isArray(body.trend)).toBe(true);
    expect(body.trend.length).toBeGreaterThan(0);
    expect(body.trend[0].date).toBe(today);
    expect(Array.isArray(body.competitors)).toBe(true);
    expect(body.competitors.length).toBe(2);
    expect(Array.isArray(body.sourceDomains)).toBe(true);
    expect(body.sourceDomains.length).toBe(2);
  });
});

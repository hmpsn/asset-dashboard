/**
 * Integration tests for the AI-visibility (LLM-mentions) routes (SEO Decision
 * Engine P8 / ai-visibility):
 *
 *   POST /api/rank-tracking/:workspaceId/refresh-ai-visibility
 *   GET  /api/rank-tracking/:workspaceId/ai-visibility
 *
 * The `ai-visibility` feature flag was retired (flag-sunset W2b — it was globally
 * ON in prod; the feature is now unconditional). The refresh route is now
 * double-gated:
 *   1. Effective tier — Growth/Premium only → 403 for Free.
 *   2. Budget gate is observe-only (does NOT block) — never asserted here.
 *
 * Tier-set happens IN-PROCESS (updateWorkspace) BEFORE startServer(), so the
 * spawned server reads the fresh tier from the shared DATA_DIR DB on its first
 * request (10s cache TTL, never stale within a test run). This mirrors
 * tests/integration/local-gbp-routes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { storeLlmMentionSnapshot } from '../../server/llm-mentions-store.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';

const ctx = createEphemeralTestContext(import.meta.url, { contextName: 'ai-visibility-routes' });
const { api, postJson } = ctx;

let wsNoSnapshot = ''; // tier growth, no snapshot → GET returns an empty payload
let wsFree = '';       // tier free → 403
let wsGrowth = '';     // tier growth → 200 { jobId }

beforeAll(async () => {
  const noSnap = createWorkspace('AI Visibility — No Snapshot');
  wsNoSnapshot = noSnap.id;
  const free = createWorkspace('AI Visibility — Free Tier');
  wsFree = free.id;
  const growth = createWorkspace('AI Visibility — Growth Tier');
  wsGrowth = growth.id;

  // wsNoSnapshot: tier growth, but no snapshot seeded → the GET readout resolves an
  // empty payload (latest null, empty trend).
  updateWorkspace(wsNoSnapshot, { tier: 'growth' });

  // wsFree: tier free → 403. createWorkspace() seeds a 14-day trial that
  // computeEffectiveTier() promotes free→growth while active, so the trial MUST be
  // cleared for the effective tier to resolve to 'free'. Passing trialEndsAt:
  // undefined writes a SQL NULL (the key is present, so the column is updated to
  // `merged.trialEndsAt ?? null`).
  updateWorkspace(wsFree, { tier: 'free', trialEndsAt: undefined });

  // wsGrowth: tier growth → 200 { jobId }. A live domain so the job can proceed past
  // the domain guard; with no configured LLM-mentions provider (the test process
  // registers no DataForSEO credentials) the provider-unsupported precondition fires
  // and the job fails as a user-actionable error.
  updateWorkspace(wsGrowth, { tier: 'growth', liveDomain: 'https://acme.example' });

  await ctx.startServer();
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsNoSnapshot);
  deleteWorkspace(wsFree);
  deleteWorkspace(wsGrowth);
  await ctx.stopServer();
});

describe('POST /api/rank-tracking/:workspaceId/refresh-ai-visibility — gating', () => {
  it('Free tier → 403 (requires a Growth or Premium plan)', async () => {
    const res = await postJson(`/api/rank-tracking/${wsFree}/refresh-ai-visibility`, {});
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/Growth or Premium plan/);
  });

  it('Growth tier → 200 with a jobId string', async () => {
    const res = await postJson(`/api/rank-tracking/${wsGrowth}/refresh-ai-visibility`, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.jobId).toBe('string');
    expect(body.jobId.length).toBeGreaterThan(0);

    // The job runs in the spawned server process. Poll the jobs API (live cache in
    // the server process) until it reaches a terminal state — with no configured
    // LLM-mentions provider it should surface a user-actionable precondition FAILURE
    // the admin will notice.
    const jobId = body.jobId as string;
    const deadline = Date.now() + 10_000;
    let terminalJob: { status: string; error?: string; message?: string } | null = null;
    while (Date.now() < deadline) {
      const jobRes = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
      expect(jobRes.status).toBe(200);
      const job = await jobRes.json();
      // The created job is the LLM-mentions refresh type (lifecycle-matrix signal anchor).
      expect(job.type).toBe(BACKGROUND_JOB_TYPES.LLM_MENTIONS_REFRESH);
      if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
        terminalJob = job;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    // The provider-unsupported precondition path ends in 'error' with the actionable message.
    expect(terminalJob?.status).toBe('error');
    expect(terminalJob?.error).toBe('AI visibility tracking requires the DataForSEO provider (not configured)');
  });
});

describe('GET /api/rank-tracking/:workspaceId/ai-visibility — KPI readout', () => {
  it('no snapshot → 200 with an empty payload (renders nothing)', async () => {
    const res = await api(`/api/rank-tracking/${wsNoSnapshot}/ai-visibility`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.latest).toBeNull();
    expect(Array.isArray(body.trend)).toBe(true);
    expect(body.trend.length).toBe(0);
    expect(Array.isArray(body.competitors)).toBe(true);
    expect(Array.isArray(body.sourceDomains)).toBe(true);
  });

  it('a seeded snapshot → 200 with latest populated (no 500)', async () => {
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

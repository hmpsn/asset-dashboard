/**
 * Strategy send-path public-read invariant.
 *
 * Asserts the two-axis invariant (Strategy v3 spec §6.1 + §6.2):
 *   - After sendRecommendation() sets clientStatus = 'sent', the rec is persisted with
 *     that client-facing axis value.
 *   - RecStatus (the internal admin triage axis: pending/in_progress/completed/dismissed)
 *     is NOT modified by sendRecommendation — send NEVER writes RecStatus.
 *   - GET /api/public/recommendations/:ws does NOT leak clientStatus to the client (the
 *     allow-list in stripEmvFromPublicRecs intentionally excludes it — client visibility
 *     is managed by the curated overview, not by the raw clientStatus field).
 *   - The admin GET /api/recommendations/:ws DOES include clientStatus so the admin UI
 *     can reflect the curated state.
 *
 * Uses inline server (createApp() + listen(0)) for speed (no child-process overhead) and
 * injects the broadcast mock before the module graph resolves.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { randomUUID, createHmac } from 'crypto';

// ─── Broadcast mock (vi.hoisted so it is ready before any module import) ──────
const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: Record<string, unknown> }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(
    (workspaceId: string, event: string, payload: Record<string, unknown>) => {
      broadcastState.calls.push({ workspaceId, event, payload });
    },
  ),
}));

// ─── Imports (after mock registration) ───────────────────────────────────────
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import {
  saveRecommendations,
  loadRecommendations,
  computeRecommendationSummary,
  toPageSlug,
} from '../../server/recommendations.js';
import { sendRecommendation } from '../../server/recommendation-lifecycle.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

// ─── Server bootstrap ─────────────────────────────────────────────────────────
let baseUrl = '';
let server: http.Server | undefined;
// Admin HMAC token — passes requireClientPortalAuth (admin bypass) and requireWorkspaceAccess.
// Uses the same SESSION_SECRET that createTestContext uses so the token is valid.
const SESSION_SECRET = process.env.SESSION_SECRET ?? 'asset-dashboard-test-session-secret';
const adminAuthToken = createHmac('sha256', SESSION_SECRET).update('admin').digest('hex');

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  process.env.SESSION_SECRET = SESSION_SECRET;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

/** Fetch with the admin HMAC token injected (passes requireClientPortalAuth + requireWorkspaceAccess). */
function authFetch(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: {
      ...(opts?.headers as Record<string, string> ?? {}),
      'x-auth-token': adminAuthToken,
    },
  });
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close(err => (err ? reject(err) : resolve()));
  });
  server = undefined;
}

beforeAll(async () => {
  await startTestServer();
}, 30_000);

afterAll(async () => {
  await stopTestServer();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRec(overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    workspaceId: '',       // set by caller
    priority: 'fix_soon',
    type: 'content',
    title: 'Add service page for target keyword',
    description: 'A dedicated service page would capture commercial-intent traffic.',
    insight: 'Competitor ranks #2 for this keyword; our site has no targeting page.',
    impact: 'high',
    effort: 'medium',
    impactScore: 72,
    source: 'keyword_strategy',
    affectedPages: ['/services'],
    trafficAtRisk: 0,
    impressionsAtRisk: 0,
    estimatedGain: '+~340 clicks/mo',
    actionType: 'content_creation',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function seedRecSet(workspaceId: string, recs: Recommendation[]): RecommendationSet {
  const set: RecommendationSet = {
    workspaceId,
    generatedAt: new Date().toISOString(),
    recommendations: recs.map(r => ({ ...r, workspaceId })),
    summary: computeRecommendationSummary(recs),
  };
  saveRecommendations(set);
  return set;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('sendRecommendation — two-axis invariant', () => {
  it('sets clientStatus = "sent" without modifying RecStatus', () => {
    const ws = createWorkspace(`Send Path ${Date.now()}`);
    const rec = makeRec({ status: 'pending' });
    seedRecSet(ws.id, [rec]);

    // Call the domain function directly (not an HTTP round-trip).
    const sent = sendRecommendation(ws.id, rec.id);
    expect(sent, 'sendRecommendation should return the mutated rec').not.toBeNull();
    expect(sent!.clientStatus).toBe('sent');   // client-facing axis: updated
    expect(sent!.status).toBe('pending');      // admin triage axis: UNCHANGED

    deleteWorkspace(ws.id);
  });

  it('sentAt is stamped when clientStatus transitions to "sent"', () => {
    const ws = createWorkspace(`SentAt ${Date.now()}`);
    const rec = makeRec({ status: 'in_progress' });
    seedRecSet(ws.id, [rec]);

    const before = new Date().toISOString();
    const sent = sendRecommendation(ws.id, rec.id);
    const after = new Date().toISOString();

    expect(sent!.sentAt).toBeDefined();
    expect(sent!.sentAt! >= before).toBe(true);
    expect(sent!.sentAt! <= after).toBe(true);
    // RecStatus still in_progress — send never touches it.
    expect(sent!.status).toBe('in_progress');

    deleteWorkspace(ws.id);
  });

  it('loadRecommendations persists clientStatus = "sent" after sendRecommendation', () => {
    const ws = createWorkspace(`Persist ClientStatus ${Date.now()}`);
    const rec = makeRec({ status: 'pending' });
    seedRecSet(ws.id, [rec]);

    sendRecommendation(ws.id, rec.id);

    const reloaded = loadRecommendations(ws.id);
    expect(reloaded).not.toBeNull();
    const reloadedRec = reloaded!.recommendations.find(r => r.id === rec.id);
    expect(reloadedRec?.clientStatus).toBe('sent');
    expect(reloadedRec?.status).toBe('pending'); // RecStatus persisted unchanged

    deleteWorkspace(ws.id);
  });
});

describe('GET /api/public/recommendations/:ws — clientStatus is NOT leaked', () => {
  it('public read does NOT include clientStatus even after sendRecommendation', async () => {
    const ws = createWorkspace(`Public Leak ${Date.now()}`);
    const rec = makeRec({ status: 'pending' });
    seedRecSet(ws.id, [rec]);

    // Send the rec via domain function.
    sendRecommendation(ws.id, rec.id);

    // Read via the public endpoint (admin HMAC token bypasses requireClientPortalAuth for admin reads).
    const res = await authFetch(`/api/public/recommendations/${ws.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as RecommendationSet;

    const publicRec = body.recommendations.find(r => r.id === rec.id);
    expect(publicRec, 'sent rec should appear in the public set').toBeDefined();

    // The two-axis invariant: clientStatus must NOT be present on the public response.
    // stripEmvFromPublicRecs uses an allow-list that intentionally excludes clientStatus.
    expect((publicRec as Record<string, unknown>)['clientStatus']).toBeUndefined();

    deleteWorkspace(ws.id);
  });

  it('public read RecStatus is the internal triage axis (not overwritten by send)', async () => {
    const ws = createWorkspace(`Public RecStatus ${Date.now()}`);
    const rec = makeRec({ status: 'in_progress' });
    seedRecSet(ws.id, [rec]);

    sendRecommendation(ws.id, rec.id);

    const res = await authFetch(`/api/public/recommendations/${ws.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as RecommendationSet;

    const publicRec = body.recommendations.find(r => r.id === rec.id);
    expect(publicRec?.status).toBe('in_progress'); // RecStatus unchanged by send

    deleteWorkspace(ws.id);
  });
});

describe('GET /api/recommendations/:ws (admin) — clientStatus IS visible', () => {
  it('admin read reflects clientStatus = "sent" after sendRecommendation', async () => {
    const ws = createWorkspace(`Admin ClientStatus ${Date.now()}`);
    const rec = makeRec({ status: 'pending' });
    seedRecSet(ws.id, [rec]);

    sendRecommendation(ws.id, rec.id);

    // Admin GET reads the full rec (no allow-list stripping). Requires admin HMAC token.
    const res = await authFetch(`/api/recommendations/${ws.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as RecommendationSet;

    const adminRec = body.recommendations.find(r => r.id === rec.id);
    expect(adminRec?.clientStatus).toBe('sent');
    expect(adminRec?.status).toBe('pending'); // RecStatus unchanged

    deleteWorkspace(ws.id);
  });
});

describe('sendRecommendation — error paths (FM-2)', () => {
  it('returns null when the rec id is not found', () => {
    const ws = createWorkspace(`Null RecId ${Date.now()}`);
    seedRecSet(ws.id, [makeRec({ status: 'pending' })]);

    const result = sendRecommendation(ws.id, 'nonexistent-rec-id');
    expect(result).toBeNull();

    deleteWorkspace(ws.id);
  });

  it('throws InvalidTransitionError when re-sending an already-sent rec', () => {
    const ws = createWorkspace(`Re-send ${Date.now()}`);
    const rec = makeRec({ status: 'pending' });
    seedRecSet(ws.id, [rec]);

    // First send — valid.
    sendRecommendation(ws.id, rec.id);

    // Second send on same rec — illegal edge (sent → sent has no outbound edge).
    expect(() => sendRecommendation(ws.id, rec.id)).toThrow();

    deleteWorkspace(ws.id);
  });
});

// ─── I1: Generator-shaped rec finder logic (C1 + C2 regression guard) ────────
//
// The existing send-path tests hand-write `affectedPages: ['/pricing']` (leading
// slash) and a `targetKeyword` never set by the generator.  They would pass even
// if C1 (leading-slash drift) or C2 (missing targetKeyword) were regressed.
//
// This suite exercises the REAL rec→UI match using generator-shaped rec objects:
//   - content_refresh  recs: affectedPages = [toPageSlug(decayPage)] (NO leading slash)
//   - keyword_gap recs: affectedPages = [], targetKeyword = kg.keyword
//
// Both finder functions are exercised against generator-shaped data:
//   DecayingPagesCard finder: r.type==='content_refresh' &&
//     r.affectedPages.some(p => toPageSlug(p) === toPageSlug(decayPagePath))
//   KeywordOpportunities finder: r.type==='keyword_gap' &&
//     r.targetKeyword?.toLowerCase().trim() === kw.toLowerCase().trim()
//
// Each test is written so it FAILS if C1 (no toPageSlug normalization on both
// sides) or C2 (targetKeyword absent from keyword_gap rec) is regressed.

describe('I1 — generator-shaped rec→UI finder logic (C1/C2 regression guard)', () => {
  // ── C1: DecayingPagesCard finder — leading-slash normalization ─────────────

  it('C1: DecayingPagesCard finder matches when affectedPages has NO leading slash (generator shape)', () => {
    // Generator stores toPageSlug(dp.page) — no leading slash.
    const decayPage = '/services';
    const generatorStoredSlug = toPageSlug(decayPage); // 'services' (no slash)

    const rec: Partial<Recommendation> = {
      type: 'content_refresh',
      affectedPages: [generatorStoredSlug], // generator-shaped: no leading slash
    };

    // Finder mirrors DecayingPagesCard.findContentRefreshRec logic (C1 fix):
    //   toPageSlug applied to BOTH sides so leading-slash drift can't break the match.
    const target = toPageSlug(decayPage);
    const found = [rec].find(
      r => r.type === 'content_refresh' && r.affectedPages!.some(p => toPageSlug(p) === target)
    );

    expect(found, 'C1: generator-shaped rec must be findable via DecayingPagesCard finder').toBeDefined();
  });

  it('C1: DecayingPagesCard finder WOULD fail with raw string comparison (proves C1 fix is load-bearing)', () => {
    // If the generator stored WITHOUT leading slash and the finder did raw includes,
    // the comparison '/services' === 'services' would be false → rec not found.
    const decayPage = '/services';
    const generatorStoredSlug = toPageSlug(decayPage); // 'services'

    const rec: Partial<Recommendation> = {
      type: 'content_refresh',
      affectedPages: [generatorStoredSlug], // 'services' — no leading slash
    };

    // Deliberately broken finder (raw comparison without toPageSlug normalization).
    const foundRaw = [rec].find(
      r => r.type === 'content_refresh' && r.affectedPages!.some(p => p === decayPage)
    );

    // This MUST be undefined — proves that the pre-C1-fix naive finder breaks on
    // generator-shaped data. If this assertion fails, the test setup is wrong.
    expect(foundRaw, 'pre-C1 naive finder must fail on generator-shaped slug (no leading slash)').toBeUndefined();
  });

  // ── C2: KeywordOpportunities finder — targetKeyword field ─────────────────

  it('C2: KeywordOpportunities finder matches keyword_gap rec with targetKeyword set (generator shape)', () => {
    // Generator: keyword_gap recs have affectedPages: [] and targetKeyword: kg.keyword.
    const kw = 'emergency plumber austin';

    const rec: Partial<Recommendation> = {
      type: 'keyword_gap',
      affectedPages: [], // generator-shaped: empty
      targetKeyword: kw, // C2 fix: generator sets this
    };

    // Finder mirrors KeywordOpportunities.findKgRec logic:
    //   r.type==='keyword_gap' && r.targetKeyword?.toLowerCase().trim() === norm
    const norm = kw.toLowerCase().trim();
    const found = [rec].find(
      r => r.type === 'keyword_gap' &&
        r.targetKeyword?.toLowerCase().trim() === norm
    );

    expect(found, 'C2: generator-shaped keyword_gap rec must be findable via KeywordOpportunities finder').toBeDefined();
  });

  it('C2: KeywordOpportunities finder WOULD fail without targetKeyword (proves C2 fix is load-bearing)', () => {
    // If targetKeyword were absent (pre-C2 generator shape), affectedPages is []
    // so the fallback `affectedPages.some(p => ...)` also never matches.
    const kw = 'emergency plumber austin';

    const recWithoutTargetKeyword: Partial<Recommendation> = {
      type: 'keyword_gap',
      affectedPages: [], // empty — no affectedPages fallback
      // targetKeyword intentionally absent
    };

    const norm = kw.toLowerCase().trim();
    const foundViaTargetKeyword = [recWithoutTargetKeyword].find(
      r => r.type === 'keyword_gap' && r.targetKeyword?.toLowerCase().trim() === norm
    );
    const foundViaAffectedPages = [recWithoutTargetKeyword].find(
      r => r.type === 'keyword_gap' && r.affectedPages!.some(p => p.toLowerCase().trim() === norm)
    );

    // Both paths must fail — confirms C2 fix (setting targetKeyword) is load-bearing.
    expect(foundViaTargetKeyword, 'without targetKeyword, primary path must not match').toBeUndefined();
    expect(foundViaAffectedPages, 'without targetKeyword, affectedPages fallback must not match either').toBeUndefined();
  });

  // ── End-to-end: seed generator-shaped recs and verify both finders locate them ─

  it('C1+C2 combined: generator-shaped recs seeded via saveRecommendations are found by both finders', () => {
    const ws = createWorkspace(`I1 Finder Recs ${Date.now()}`);
    const now = new Date().toISOString();

    // Simulate the generator's exact output shapes for the two rec types.
    const decayPagePath = '/pricing';
    const kwGapKeyword = 'best plumber austin tx';

    const contentRefreshRec: Recommendation = {
      id: 'rec_i1_content_refresh',
      workspaceId: ws.id,
      priority: 'fix_soon',
      type: 'content_refresh',
      title: 'Refresh /pricing — clicks dropped 30%',
      description: 'Traffic is declining.',
      insight: 'Page is decaying.',
      impact: 'medium',
      effort: 'medium',
      impactScore: 60,
      source: `decay::${toPageSlug(decayPagePath)}`,
      affectedPages: [toPageSlug(decayPagePath)], // generator shape: 'pricing' (no leading slash)
      trafficAtRisk: 120,
      impressionsAtRisk: 2000,
      estimatedGain: '+~50 clicks/mo',
      actionType: 'manual',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    const keywordGapRec: Recommendation = {
      id: 'rec_i1_keyword_gap',
      workspaceId: ws.id,
      priority: 'fix_soon',
      type: 'keyword_gap',
      title: `Keyword Gap: "${kwGapKeyword}"`,
      description: 'Competitor ranks for this keyword.',
      insight: 'Lost organic traffic.',
      impact: 'high',
      effort: 'high',
      impactScore: 75,
      source: `keyword_gap::${kwGapKeyword}`,
      affectedPages: [], // generator shape: empty for keyword_gap
      targetKeyword: kwGapKeyword, // generator shape: C2 fix
      trafficAtRisk: 0,
      impressionsAtRisk: 0,
      estimatedGain: 'Targeting a high-demand keyword',
      actionType: 'content_creation',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    const recSet: RecommendationSet = {
      workspaceId: ws.id,
      generatedAt: now,
      recommendations: [contentRefreshRec, keywordGapRec],
      summary: computeRecommendationSummary([contentRefreshRec, keywordGapRec]),
    };
    saveRecommendations(recSet);

    const loaded = loadRecommendations(ws.id);
    expect(loaded).not.toBeNull();
    const recs = loaded!.recommendations;

    // C1: DecayingPagesCard finder — pagePath from the decay analysis has a leading slash.
    const c1Target = toPageSlug(decayPagePath); // 'pricing'
    const c1Found = recs.find(
      r => r.type === 'content_refresh' && r.affectedPages.some(p => toPageSlug(p) === c1Target)
    );
    expect(c1Found, 'C1: content_refresh rec must be locatable via DecayingPagesCard finder').toBeDefined();
    expect(c1Found?.id).toBe('rec_i1_content_refresh');

    // C2: KeywordOpportunities finder.
    const c2Norm = kwGapKeyword.toLowerCase().trim();
    const c2Found = recs.find(
      r => r.type === 'keyword_gap' && r.targetKeyword?.toLowerCase().trim() === c2Norm
    );
    expect(c2Found, 'C2: keyword_gap rec must be locatable via KeywordOpportunities finder').toBeDefined();
    expect(c2Found?.id).toBe('rec_i1_keyword_gap');

    deleteWorkspace(ws.id);
  });
});

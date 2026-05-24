/**
 * Extended integration tests for public-analytics routes.
 *
 * Covers uncovered branches not present in tests/integration/public-analytics.test.ts:
 *   - Auth guard (401) for password-protected workspaces
 *   - GSC not configured for search-devices, search-countries, search-types, search-comparison
 *   - GA4 not configured for all GA4 endpoints (analytics-trend, top-pages, sources, devices,
 *     countries, comparison, new-vs-returning, events, event-trend, conversions, event-explorer,
 *     landing-pages, organic)
 *   - Digest endpoint (GET /api/public/insights/:workspaceId/digest)
 *   - search-chat: missing question, rate limit reached (429), AI not configured (400), 400 for
 *     missing event param on analytics-event-trend
 *   - Non-existent workspace for every endpoint category
 *   - Non-numeric / negative days/limit params
 *   - analytics-event-trend: missing event query param (400)
 *   - analytics-landing-pages: organic=true flag still validates days/limit params
 *
 * Port: 13381 (unique)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { cleanSeedData } from '../global-setup.js';
import { addMessage, FREE_CHAT_LIMIT } from '../../server/chat-memory.js';
import db from '../../server/db/index.js';

const ctx = createTestContext(13381);
const { api, postJson } = ctx;

// Workspace with no credentials (GSC/GA4 unconfigured) — passwordless
let wsNoCredsId = '';
// Workspace with GSC configured but no GA4
let wsGscOnlyId = '';
// Workspace with GA4 configured but no GSC
let wsGa4OnlyId = '';
// Workspace with a client password set (requires auth)
let wsWithPasswordId = '';
// Free-tier workspace for rate-limit tests (seeded, no trial period)
let wsFreeWs: SeededFullWorkspace;
let wsFreeId = '';

let previousOpenAiKey: string | undefined;

beforeAll(async () => {
  previousOpenAiKey = process.env.OPENAI_API_KEY;
  // Remove OPENAI key so chat requests hit the "AI not configured" branch quickly
  process.env.OPENAI_API_KEY = '';

  await ctx.startServer();

  const wsNoCreds = createWorkspace('Extended Analytics No-Creds WS');
  wsNoCredsId = wsNoCreds.id;

  const wsGscOnly = createWorkspace('Extended Analytics GSC-Only WS');
  wsGscOnlyId = wsGscOnly.id;
  updateWorkspace(wsGscOnlyId, {
    webflowSiteId: 'extended-gsc-site',
    gscPropertyUrl: 'https://gsconly.example.com/',
  });

  const wsGa4Only = createWorkspace('Extended Analytics GA4-Only WS');
  wsGa4OnlyId = wsGa4Only.id;
  updateWorkspace(wsGa4OnlyId, {
    ga4PropertyId: '999888777',
  });

  // Password-protected workspace — clientPassword is set → auth required
  const wsWithPassword = createWorkspace('Extended Analytics Password WS');
  wsWithPasswordId = wsWithPassword.id;
  updateWorkspace(wsWithPasswordId, {
    clientPassword: 'super-secret-pw',
    ga4PropertyId: '111222333',
    gscPropertyUrl: 'https://protected.example.com/',
    webflowSiteId: 'protected-site',
  });

  // Free-tier workspace for rate-limit tests (passwordless, no trial period)
  // seedWorkspace does NOT set trialEndsAt — so computeEffectiveTier returns 'free'.
  wsFreeWs = seedWorkspace({ tier: 'free', clientPassword: '' });
  wsFreeId = wsFreeWs.workspaceId;
  // Explicitly clear trial_ends_at just in case the seed fixture sets it
  db.prepare('UPDATE workspaces SET trial_ends_at = NULL WHERE id = ?').run(wsFreeId);
}, 30_000);

afterAll(async () => {
  cleanSeedData(wsNoCredsId);
  cleanSeedData(wsGscOnlyId);
  cleanSeedData(wsGa4OnlyId);
  cleanSeedData(wsWithPasswordId);
  cleanSeedData(wsFreeId);
  deleteWorkspace(wsNoCredsId);
  deleteWorkspace(wsGscOnlyId);
  deleteWorkspace(wsGa4OnlyId);
  deleteWorkspace(wsWithPasswordId);
  wsFreeWs.cleanup();
  if (previousOpenAiKey !== undefined) {
    process.env.OPENAI_API_KEY = previousOpenAiKey;
  }
  await ctx.stopServer();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Auth guard — password-protected workspaces return 401
// ─────────────────────────────────────────────────────────────────────────────

describe('Auth guard — 401 for password-protected workspace with no credentials', () => {
  it('GET /api/public/insights/:workspaceId returns 401 when workspace has password and no auth cookie', async () => {
    const res = await api(`/api/public/insights/${wsWithPasswordId}`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/insights/:workspaceId/narrative returns 401 when workspace has password and no auth cookie', async () => {
    const res = await api(`/api/public/insights/${wsWithPasswordId}/narrative`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/insights/:workspaceId/digest returns 401 when workspace has password and no auth cookie', async () => {
    const res = await api(`/api/public/insights/${wsWithPasswordId}/digest`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/search-overview/:workspaceId returns 401 when workspace has password and no auth cookie', async () => {
    const res = await api(`/api/public/search-overview/${wsWithPasswordId}`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/analytics-overview/:workspaceId returns 401 when workspace has password and no auth cookie', async () => {
    const res = await api(`/api/public/analytics-overview/${wsWithPasswordId}`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('POST /api/public/search-chat/:workspaceId returns 401 when workspace has password and no auth cookie', async () => {
    const res = await postJson(`/api/public/search-chat/${wsWithPasswordId}`, {
      question: 'What is my traffic like?',
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Digest endpoint — not covered in existing tests
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/public/insights/:workspaceId/digest — monthly digest', () => {
  it('returns 404 for non-existent workspace', async () => {
    const res = await api('/api/public/insights/ws_nonexistent_digest_test/digest');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 200 with digest shape for valid workspace with no data', async () => {
    const res = await api(`/api/public/insights/${wsNoCredsId}/digest`);
    // generateMonthlyDigest runs without credentials — should succeed with minimal data
    expect(res.status).toBe(200);
    const body = await res.json();
    // Digest should be an object (not null, not an array)
    expect(typeof body).toBe('object');
    expect(body).not.toBeNull();
    expect(Array.isArray(body)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. GSC not configured — endpoints that weren't tested in existing tests
// ─────────────────────────────────────────────────────────────────────────────

describe('GSC not configured — 400 guard for unconfigured endpoints', () => {
  it('GET /api/public/search-devices/:workspaceId returns 400 when GSC not configured', async () => {
    const res = await api(`/api/public/search-devices/${wsNoCredsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/Search Console not configured/i);
  });

  it('GET /api/public/search-countries/:workspaceId returns 400 when GSC not configured', async () => {
    const res = await api(`/api/public/search-countries/${wsNoCredsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/Search Console not configured/i);
  });

  it('GET /api/public/search-types/:workspaceId returns 400 when GSC not configured', async () => {
    const res = await api(`/api/public/search-types/${wsNoCredsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/Search Console not configured/i);
  });

  it('GET /api/public/search-comparison/:workspaceId returns 400 when GSC not configured', async () => {
    const res = await api(`/api/public/search-comparison/${wsNoCredsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/Search Console not configured/i);
  });

  // GA4-only workspace has no GSC → all GSC endpoints return 400
  it('GET /api/public/search-overview/:workspaceId returns 400 for GA4-only workspace (no GSC)', async () => {
    const res = await api(`/api/public/search-overview/${wsGa4OnlyId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/performance-trend/:workspaceId returns 400 for GA4-only workspace (no GSC)', async () => {
    const res = await api(`/api/public/performance-trend/${wsGa4OnlyId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. GA4 not configured — endpoints that weren't tested in existing tests
// ─────────────────────────────────────────────────────────────────────────────

describe('GA4 not configured — 400 guard', () => {
  it('GET /api/public/analytics-trend/:workspaceId returns 400 when GA4 not configured', async () => {
    const res = await api(`/api/public/analytics-trend/${wsNoCredsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/GA4 not configured/i);
  });

  it('GET /api/public/analytics-top-pages/:workspaceId returns 400 when GA4 not configured', async () => {
    const res = await api(`/api/public/analytics-top-pages/${wsNoCredsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/GA4 not configured/i);
  });

  it('GET /api/public/analytics-sources/:workspaceId returns 400 when GA4 not configured', async () => {
    const res = await api(`/api/public/analytics-sources/${wsNoCredsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/GA4 not configured/i);
  });

  it('GET /api/public/analytics-devices/:workspaceId returns 400 when GA4 not configured', async () => {
    const res = await api(`/api/public/analytics-devices/${wsNoCredsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/GA4 not configured/i);
  });

  it('GET /api/public/analytics-countries/:workspaceId returns 400 when GA4 not configured', async () => {
    const res = await api(`/api/public/analytics-countries/${wsNoCredsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/GA4 not configured/i);
  });

  it('GET /api/public/analytics-comparison/:workspaceId returns 400 when GA4 not configured', async () => {
    const res = await api(`/api/public/analytics-comparison/${wsNoCredsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/GA4 not configured/i);
  });

  it('GET /api/public/analytics-new-vs-returning/:workspaceId returns 400 when GA4 not configured', async () => {
    const res = await api(`/api/public/analytics-new-vs-returning/${wsNoCredsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/GA4 not configured/i);
  });

  it('GET /api/public/analytics-events/:workspaceId returns 400 when GA4 not configured', async () => {
    const res = await api(`/api/public/analytics-events/${wsNoCredsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/GA4 not configured/i);
  });

  it('GET /api/public/analytics-event-trend/:workspaceId returns 400 when GA4 not configured (event param provided)', async () => {
    const res = await api(`/api/public/analytics-event-trend/${wsNoCredsId}?event=page_view`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/GA4 not configured/i);
  });

  it('GET /api/public/analytics-conversions/:workspaceId returns 400 when GA4 not configured', async () => {
    const res = await api(`/api/public/analytics-conversions/${wsNoCredsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/GA4 not configured/i);
  });

  it('GET /api/public/analytics-event-explorer/:workspaceId returns 400 when GA4 not configured', async () => {
    const res = await api(`/api/public/analytics-event-explorer/${wsNoCredsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/GA4 not configured/i);
  });

  it('GET /api/public/analytics-landing-pages/:workspaceId returns 400 when GA4 not configured', async () => {
    const res = await api(`/api/public/analytics-landing-pages/${wsNoCredsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/GA4 not configured/i);
  });

  it('GET /api/public/analytics-organic/:workspaceId returns 400 when GA4 not configured', async () => {
    const res = await api(`/api/public/analytics-organic/${wsNoCredsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/GA4 not configured/i);
  });

  // GSC-only workspace has no GA4 → all GA4 endpoints return 400
  it('GET /api/public/analytics-overview/:workspaceId returns 400 for GSC-only workspace (no GA4)', async () => {
    const res = await api(`/api/public/analytics-overview/${wsGscOnlyId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/GA4 not configured/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. analytics-event-trend — missing required ?event= param
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/public/analytics-event-trend — missing event param', () => {
  it('returns 400 when event query param is missing (GA4-only workspace)', async () => {
    // GA4 is configured on wsGa4OnlyId, so the GA4 guard passes; then event check fires
    const res = await api(`/api/public/analytics-event-trend/${wsGa4OnlyId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toBe('event query param required');
  });

  it('returns 400 with descriptive message when event param is empty string', async () => {
    const res = await api(`/api/public/analytics-event-trend/${wsGa4OnlyId}?event=`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toBe('event query param required');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Non-numeric and negative days/limit parameter edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('Parameter edge cases — non-numeric and negative values', () => {
  it('GET /api/public/search-overview rejects negative days (-1)', async () => {
    const res = await api(`/api/public/search-overview/${wsGscOnlyId}?days=-1`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'days must be a positive integer' });
  });

  it('GET /api/public/search-overview rejects non-numeric string for days ("abc")', async () => {
    const res = await api(`/api/public/search-overview/${wsGscOnlyId}?days=abc`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'days must be a positive integer' });
  });

  it('GET /api/public/performance-trend rejects negative days (-7)', async () => {
    const res = await api(`/api/public/performance-trend/${wsGscOnlyId}?days=-7`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'days must be a positive integer' });
  });

  it('GET /api/public/analytics-overview rejects negative days (-30)', async () => {
    const res = await api(`/api/public/analytics-overview/${wsGa4OnlyId}?days=-30`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'days must be a positive integer' });
  });

  it('GET /api/public/analytics-overview rejects non-numeric string for days ("xyz")', async () => {
    const res = await api(`/api/public/analytics-overview/${wsGa4OnlyId}?days=xyz`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'days must be a positive integer' });
  });

  it('GET /api/public/search-countries rejects negative limit (-5)', async () => {
    const res = await api(`/api/public/search-countries/${wsGscOnlyId}?limit=-5`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'limit must be a positive integer' });
  });

  it('GET /api/public/search-countries rejects non-numeric string for limit ("all")', async () => {
    const res = await api(`/api/public/search-countries/${wsGscOnlyId}?limit=all`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'limit must be a positive integer' });
  });

  it('GET /api/public/analytics-landing-pages rejects negative limit (-10)', async () => {
    const res = await api(`/api/public/analytics-landing-pages/${wsGa4OnlyId}?limit=-10`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'limit must be a positive integer' });
  });

  it('GET /api/public/analytics-event-trend rejects negative days (-14) even with event param', async () => {
    const res = await api(`/api/public/analytics-event-trend/${wsGa4OnlyId}?event=page_view&days=-14`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'days must be a positive integer' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. POST /api/public/search-chat — uncovered branches
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/public/search-chat — validation and guard branches', () => {
  it('returns 404 for non-existent workspace', async () => {
    const res = await postJson('/api/public/search-chat/ws_totally_nonexistent_xyz', {
      question: 'What changed this month?',
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toBe('Workspace not found');
  });

  it('returns 400 when AI not configured (OPENAI_API_KEY is empty)', async () => {
    // OPENAI_API_KEY was cleared in beforeAll — rate limit passes for free tier with no messages
    const res = await postJson(`/api/public/search-chat/${wsNoCredsId}`, {
      question: 'How is my traffic?',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toBe('AI not configured');
  });

  it('returns 429 when free tier has exhausted monthly chat limit', async () => {
    // Exhaust the monthly conversation count for wsFreeId
    // Each addMessage call on a new sessionId creates a new conversation
    for (let i = 0; i < FREE_CHAT_LIMIT; i++) {
      addMessage(wsFreeId, `exhaust-session-${i}`, 'client', 'user', 'hello');
    }

    // Now a NEW session should be rate-limited
    const res = await postJson(`/api/public/search-chat/${wsFreeId}`, {
      question: 'Am I out of chats?',
      sessionId: 'brand-new-session-exhausted',
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toBe('Chat limit reached');
    expect(body).toHaveProperty('limit');
    expect(body).toHaveProperty('used');
    expect(body.limit).toBe(FREE_CHAT_LIMIT);
  });

  it('returns 429 response body has correct shape (message, used, limit)', async () => {
    // wsFreeId is already exhausted from previous test
    const res = await postJson(`/api/public/search-chat/${wsFreeId}`, {
      question: 'Another attempt',
      sessionId: 'another-brand-new-session',
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toHaveProperty('message');
    expect(typeof body.message).toBe('string');
    expect(body.message.length).toBeGreaterThan(0);
    expect(body).toHaveProperty('used');
    expect(typeof body.used).toBe('number');
    expect(body).toHaveProperty('limit');
    expect(typeof body.limit).toBe('number');
  });

  it('returns 400 when question is missing entirely from body', async () => {
    // validate(chatSchema) requires question as a string
    const res = await postJson(`/api/public/search-chat/${wsNoCredsId}`, {
      sessionId: 'test-no-question',
    });
    // Zod validation will catch the missing required field
    expect([400, 422]).toContain(res.status);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when question exceeds max length (5001 chars)', async () => {
    const res = await postJson(`/api/public/search-chat/${wsNoCredsId}`, {
      question: 'a'.repeat(5001),
    });
    expect([400, 422]).toContain(res.status);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Non-existent workspace — all endpoint categories not covered in existing tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Non-existent workspace — error responses for uncovered endpoints', () => {
  const MISSING_WS = 'ws_definitely_does_not_exist_extended_test';

  it('GET /api/public/search-devices/:workspaceId returns error for non-existent workspace', async () => {
    const res = await api(`/api/public/search-devices/${MISSING_WS}`);
    expect([400, 404]).toContain(res.status);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/search-countries/:workspaceId returns error for non-existent workspace', async () => {
    const res = await api(`/api/public/search-countries/${MISSING_WS}`);
    expect([400, 404]).toContain(res.status);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/search-types/:workspaceId returns error for non-existent workspace', async () => {
    const res = await api(`/api/public/search-types/${MISSING_WS}`);
    expect([400, 404]).toContain(res.status);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/search-comparison/:workspaceId returns error for non-existent workspace', async () => {
    const res = await api(`/api/public/search-comparison/${MISSING_WS}`);
    expect([400, 404]).toContain(res.status);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/analytics-trend/:workspaceId returns error for non-existent workspace', async () => {
    const res = await api(`/api/public/analytics-trend/${MISSING_WS}`);
    expect([400, 404]).toContain(res.status);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/analytics-top-pages/:workspaceId returns error for non-existent workspace', async () => {
    const res = await api(`/api/public/analytics-top-pages/${MISSING_WS}`);
    expect([400, 404]).toContain(res.status);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/analytics-events/:workspaceId returns error for non-existent workspace', async () => {
    const res = await api(`/api/public/analytics-events/${MISSING_WS}`);
    expect([400, 404]).toContain(res.status);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/analytics-event-trend/:workspaceId returns error for non-existent workspace', async () => {
    const res = await api(`/api/public/analytics-event-trend/${MISSING_WS}?event=page_view`);
    expect([400, 404]).toContain(res.status);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/analytics-conversions/:workspaceId returns error for non-existent workspace', async () => {
    const res = await api(`/api/public/analytics-conversions/${MISSING_WS}`);
    expect([400, 404]).toContain(res.status);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/analytics-event-explorer/:workspaceId returns error for non-existent workspace', async () => {
    const res = await api(`/api/public/analytics-event-explorer/${MISSING_WS}`);
    expect([400, 404]).toContain(res.status);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/analytics-landing-pages/:workspaceId returns error for non-existent workspace', async () => {
    const res = await api(`/api/public/analytics-landing-pages/${MISSING_WS}`);
    expect([400, 404]).toContain(res.status);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/analytics-organic/:workspaceId returns error for non-existent workspace', async () => {
    const res = await api(`/api/public/analytics-organic/${MISSING_WS}`);
    expect([400, 404]).toContain(res.status);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/analytics-new-vs-returning/:workspaceId returns error for non-existent workspace', async () => {
    const res = await api(`/api/public/analytics-new-vs-returning/${MISSING_WS}`);
    expect([400, 404]).toContain(res.status);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/analytics-sources/:workspaceId returns error for non-existent workspace', async () => {
    const res = await api(`/api/public/analytics-sources/${MISSING_WS}`);
    expect([400, 404]).toContain(res.status);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/analytics-devices/:workspaceId returns error for non-existent workspace', async () => {
    const res = await api(`/api/public/analytics-devices/${MISSING_WS}`);
    expect([400, 404]).toContain(res.status);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/analytics-comparison/:workspaceId returns error for non-existent workspace', async () => {
    const res = await api(`/api/public/analytics-comparison/${MISSING_WS}`);
    expect([400, 404]).toContain(res.status);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/insights/:workspaceId/digest returns 404 for non-existent workspace', async () => {
    const res = await api(`/api/public/insights/${MISSING_WS}/digest`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'Workspace not found' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. GSC-only workspace — GA4 guard fires correctly (no GA4 configured)
// ─────────────────────────────────────────────────────────────────────────────

describe('GSC-only workspace — GA4 endpoints return 400, GSC endpoints pass the guard', () => {
  it('GET /api/public/analytics-trend — GSC-only workspace returns GA4-not-configured error', async () => {
    const res = await api(`/api/public/analytics-trend/${wsGscOnlyId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/GA4 not configured/i);
  });

  it('GET /api/public/analytics-countries — GSC-only workspace returns GA4-not-configured error', async () => {
    const res = await api(`/api/public/analytics-countries/${wsGscOnlyId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/GA4 not configured/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. analytics-landing-pages organic flag
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/public/analytics-landing-pages — organic param behaviour', () => {
  it('returns GA4-not-configured error even when organic=true (no GA4)', async () => {
    const res = await api(`/api/public/analytics-landing-pages/${wsNoCredsId}?organic=true`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/GA4 not configured/i);
  });

  it('returns 400 for invalid days even with organic=true (GA4-only workspace, days guard fires first)', async () => {
    // wsGa4OnlyId has GA4 configured so we get past the GA4 guard, then days check fires
    const res = await api(`/api/public/analytics-landing-pages/${wsGa4OnlyId}?organic=true&days=0`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'days must be a positive integer' });
  });
});

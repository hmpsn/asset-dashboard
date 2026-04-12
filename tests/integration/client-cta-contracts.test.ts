/**
 * Contract tests for the client CTA circuit (Group 1 PR 3).
 *
 * These tests define the server-side contracts the ServiceInterestCTA component
 * and ChatPanel integration must satisfy. They test the current API behavior
 * so that PR3 implementation has a verified, executable spec to code against.
 *
 * Run these BEFORE writing PR3 code to establish baseline, and again after
 * to verify all contracts are honored.
 *
 * Key contracts documented here:
 *   - POST /api/public/signal/:workspaceId accepts service_interest and content_interest
 *   - The endpoint returns { ok: true } and nothing else (no signalId)
 *   - publicWriteLimiter (10 req/60s per IP:path) gates the endpoint — CTA must handle 429
 *   - Unknown workspaceId returns 400 — CTA must validate workspace before sending
 *   - Explicit CTA clicks are NOT server-side deduped — dedup is the UI's responsibility
 *   - The Zod schema is strict: missing or wrong-typed fields return 400
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { listClientSignals } from '../../server/client-signals-store.js';

const ctx = createTestContext(13301);
const { postJson, api } = ctx;

// One workspace per describe block that sends POST requests.
// The publicWriteLimiter keys on `ip:req.path` which includes the workspace ID,
// so each unique workspace path gets its own independent 10 req/min bucket.
let baseWsId = '';      // signal endpoint contract tests (~7 requests)
let rateLimitWsId = ''; // rate limit tests (needs a fresh bucket — exhausted intentionally)
let dedupWsId = '';     // dedup contract tests (2 requests)
let schemaWsId = '';    // Zod schema tests (~6 requests, fresh bucket after baseWsId is full)
let validationWsId = ''; // workspace validation tests (2 requests)

beforeAll(async () => {
  await ctx.startServer();
  baseWsId = createWorkspace('CTA Contract Base WS').id;
  rateLimitWsId = createWorkspace('CTA Rate Limit WS').id;
  dedupWsId = createWorkspace('CTA Dedup WS').id;
  schemaWsId = createWorkspace('CTA Schema WS').id;
  validationWsId = createWorkspace('CTA Validation WS').id;
}, 25_000);

afterAll(() => {
  deleteWorkspace(baseWsId);
  deleteWorkspace(rateLimitWsId);
  deleteWorkspace(dedupWsId);
  deleteWorkspace(schemaWsId);
  deleteWorkspace(validationWsId);
  ctx.stopServer();
});

// ── Signal endpoint contract ──────────────────────────────────────────────────

describe('Signal endpoint contract — what CTA clicks must call', () => {
  it('POST /api/public/signal accepts service_interest type', async () => {
    const res = await postJson(`/api/public/signal/${baseWsId}`, {
      type: 'service_interest',
      triggerMessage: 'I would like to work with your team',
      chatContext: [{ role: 'user', content: 'I would like to work with your team' }],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('POST /api/public/signal accepts content_interest type', async () => {
    const res = await postJson(`/api/public/signal/${baseWsId}`, {
      type: 'content_interest',
      triggerMessage: 'What content strategy would work for us?',
      chatContext: [{ role: 'user', content: 'What content strategy would work for us?' }],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('POST /api/public/signal with empty chatContext is valid', async () => {
    // The CTA may fire before a full conversation exists.
    // An empty chatContext array is schema-valid (no .min(1) constraint).
    const res = await postJson(`/api/public/signal/${baseWsId}`, {
      type: 'service_interest',
      triggerMessage: 'Contact us clicked',
      chatContext: [],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('created signal is immediately retrievable via admin list', async () => {
    const triggerMsg = `retrievable-test-${Date.now()}`;
    const res = await postJson(`/api/public/signal/${baseWsId}`, {
      type: 'service_interest',
      triggerMessage: triggerMsg,
      chatContext: [{ role: 'user', content: triggerMsg }],
    });
    expect(res.status).toBe(200);

    // Signal must be synchronously persisted — no async gap between POST and list
    const signals = listClientSignals(baseWsId);
    expect(signals.length).toBeGreaterThan(0);
    const found = signals.find((s) => s.triggerMessage === triggerMsg);
    expect(found).toBeDefined();
  });

  it('created signal has status new by default', async () => {
    const triggerMsg = `status-default-test-${Date.now()}`;
    const res = await postJson(`/api/public/signal/${baseWsId}`, {
      type: 'service_interest',
      triggerMessage: triggerMsg,
      chatContext: [],
    });
    expect(res.status).toBe(200);

    const signals = listClientSignals(baseWsId);
    const found = signals.find((s) => s.triggerMessage === triggerMsg);
    expect(found).toBeDefined();
    expect(found!.status).toBe('new');
  });

  it('signal triggerMessage is stored correctly', async () => {
    const triggerMsg = 'Exact string preservation — special chars: &<>"\'';
    const res = await postJson(`/api/public/signal/${baseWsId}`, {
      type: 'content_interest',
      triggerMessage: triggerMsg,
      chatContext: [],
    });
    expect(res.status).toBe(200);

    const signals = listClientSignals(baseWsId);
    const found = signals.find((s) => s.triggerMessage === triggerMsg);
    expect(found).toBeDefined();
    // Exact round-trip: no truncation, no HTML-escaping, no mutation
    expect(found!.triggerMessage).toBe(triggerMsg);
  });

  it('POST returns { ok: true } — no signalId in response', async () => {
    // This contract prevents a future regression where signalId is added back.
    // The CTA must NOT depend on a signalId in the response — the public endpoint
    // intentionally omits it to avoid leaking internal IDs to unauthenticated callers.
    const res = await postJson(`/api/public/signal/${baseWsId}`, {
      type: 'service_interest',
      triggerMessage: 'no signalId check',
      chatContext: [],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.signalId).toBeUndefined();
    // Verify there are no extra keys beyond "ok"
    expect(Object.keys(body)).toEqual(['ok']);
  });
});

// ── Rate limiting contract ────────────────────────────────────────────────────

describe('Rate limiting contract — CTA must handle 429 gracefully', () => {
  // publicWriteLimiter: 10 requests per 60-second window, keyed on `ip:req.path`.
  // Since req.path includes the workspaceId, rateLimitWsId gets its own fresh bucket
  // that is not shared with any other describe block.

  it('first 10 CTA clicks within 60s are accepted (returns 200)', async () => {
    const results: number[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await postJson(`/api/public/signal/${rateLimitWsId}`, {
        type: 'service_interest',
        triggerMessage: `click ${i + 1}`,
        chatContext: [],
      });
      results.push(res.status);
    }
    expect(results.length).toBe(10);
    // Every one of the 10 must be 200 — a vacuous pass on empty array is ruled out by the length check
    expect(results.length > 0 && results.every((s) => s === 200)).toBe(true);
  });

  it('11th click returns 429 with Retry-After header', async () => {
    // rateLimitWsId bucket already has 10 hits from the previous test.
    // The publicWriteLimiter triggers when bucket.count > maxRequests (i.e., count > 10).
    const res = await postJson(`/api/public/signal/${rateLimitWsId}`, {
      type: 'service_interest',
      triggerMessage: 'over the limit',
      chatContext: [],
    });
    expect(res.status).toBe(429);
    // Retry-After is set by the rate limiter middleware — CTA must read this to show
    // a meaningful "try again in X seconds" message rather than a generic error
    expect(res.headers.get('Retry-After')).not.toBeNull();
    const retryAfter = parseInt(res.headers.get('Retry-After') || '0', 10);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });
});

// ── Workspace validation contract ─────────────────────────────────────────────

describe('Workspace validation contract — CTA must validate workspace before sending', () => {
  it('unknown workspaceId returns 400', async () => {
    // CTA must check that the workspace exists before rendering the button,
    // but also handle the case where a stale/invalid workspace is passed.
    const res = await postJson('/api/public/signal/ws-does-not-exist-cta-contract', {
      type: 'service_interest',
      triggerMessage: 'should not land',
      chatContext: [],
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('valid workspaceId returns 200', async () => {
    const res = await postJson(`/api/public/signal/${validationWsId}`, {
      type: 'service_interest',
      triggerMessage: 'valid workspace check',
      chatContext: [],
    });
    expect(res.status).toBe(200);
  });
});

// ── Intent detection dedup contract ───────────────────────────────────────────

describe('Intent detection dedup contract — auto-detect vs explicit CTA interaction', () => {
  /**
   * Auto-detected signals (from public-analytics.ts keyword matching) are deduped
   * via hasRecentSignal before insertion. This prevents the server from flooding the
   * admin inbox with repeated detections during a single active chat session.
   *
   * But explicit CTA clicks POST directly to /api/public/signal which does NOT call
   * hasRecentSignal. This is intentional — explicit user intent should ALWAYS create
   * a signal even if one was recently auto-detected. If the user clicked the CTA
   * twice, both clicks represent genuine signals worth reviewing.
   *
   * Dedup for explicit CTA clicks is the UI's responsibility:
   *   - Disable the button after click (prevent double-tap)
   *   - Show a "Thanks, we'll be in touch" state
   *   - Do NOT suppress based on sessionStorage or local state alone — the admin
   *     inbox should reflect real user actions
   */

  it('explicit CTA signal creation is not subject to server-side dedup', async () => {
    const beforeSignals = listClientSignals(dedupWsId);
    const beforeCount = beforeSignals.length;

    // Post two signals in quick succession for the same workspace + type.
    // Both must succeed (200) because the public endpoint has no hasRecentSignal guard.
    const res1 = await postJson(`/api/public/signal/${dedupWsId}`, {
      type: 'service_interest',
      triggerMessage: 'I want to get started',
      chatContext: [{ role: 'user', content: 'I want to get started' }],
    });
    expect(res1.status).toBe(200);
    expect((await res1.json()).ok).toBe(true);

    const res2 = await postJson(`/api/public/signal/${dedupWsId}`, {
      type: 'service_interest',
      triggerMessage: 'I want to get started',
      chatContext: [{ role: 'user', content: 'I want to get started' }],
    });
    expect(res2.status).toBe(200);
    expect((await res2.json()).ok).toBe(true);

    // Both signals must appear in the admin list — server did not dedup either one
    const afterSignals = listClientSignals(dedupWsId);
    expect(afterSignals.length).toBe(beforeCount + 2);

    // Verify both have unique IDs (they are distinct records, not an upsert)
    const newSignals = afterSignals.filter(
      (s) => !beforeSignals.some((b) => b.id === s.id),
    );
    expect(newSignals.length).toBe(2);
    expect(newSignals[0].id).not.toBe(newSignals[1].id);
  });
});

// ── Zod schema contract ───────────────────────────────────────────────────────

describe('Zod schema contract — CTA must send correctly shaped body', () => {
  it('missing type field returns 400', async () => {
    const res = await postJson(`/api/public/signal/${schemaWsId}`, {
      triggerMessage: 'missing type',
      chatContext: [],
    });
    expect(res.status).toBe(400);
  });

  it('missing triggerMessage field returns 400', async () => {
    const res = await postJson(`/api/public/signal/${schemaWsId}`, {
      type: 'service_interest',
      chatContext: [],
    });
    expect(res.status).toBe(400);
  });

  it('missing chatContext field returns 400', async () => {
    const res = await postJson(`/api/public/signal/${schemaWsId}`, {
      type: 'service_interest',
      triggerMessage: 'missing chatContext',
    });
    expect(res.status).toBe(400);
  });

  it('triggerMessage at exactly 500 chars is valid', async () => {
    // Max boundary: the CTA should truncate or enforce this on the client side as well
    const exactly500 = 'A'.repeat(500);
    const res = await postJson(`/api/public/signal/${schemaWsId}`, {
      type: 'service_interest',
      triggerMessage: exactly500,
      chatContext: [],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('triggerMessage at 501 chars is rejected', async () => {
    // One over max: client-side validation should prevent this, but the server
    // is the authoritative guard. CTA implementation must match this constraint.
    const over500 = 'A'.repeat(501);
    const res = await postJson(`/api/public/signal/${schemaWsId}`, {
      type: 'service_interest',
      triggerMessage: over500,
      chatContext: [],
    });
    expect(res.status).toBe(400);
  });

  it('chatContext with invalid role is rejected', async () => {
    // Only 'user' and 'assistant' are valid roles in chatContext items.
    // The CTA/ChatPanel must never pass roles like 'system' or 'tool'.
    const res = await postJson(`/api/public/signal/${schemaWsId}`, {
      type: 'service_interest',
      triggerMessage: 'role test',
      chatContext: [{ role: 'system', content: 'You are a helpful assistant.' }],
    });
    expect(res.status).toBe(400);
  });
});

// ── Admin list endpoint contract ──────────────────────────────────────────────
// These verify the shape of signal objects returned by the admin API,
// which the admin signals inbox component (also being unified in PR3) depends on.

describe('Admin list endpoint contract — signal shape for admin inbox', () => {
  it('GET /api/client-signals/:workspaceId returns signals with all required fields', async () => {
    // Ensure at least one signal exists for baseWsId (created by earlier tests)
    const res = await api(`/api/client-signals/${baseWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThan(0);

    const signal = body[0];
    // These are the fields the admin SignalsInbox component accesses.
    // Adding a new field here documents a new dependency between PR3 UI and this API.
    expect(signal).toHaveProperty('id');
    expect(signal).toHaveProperty('workspaceId');
    expect(signal).toHaveProperty('type');
    expect(signal).toHaveProperty('status');
    expect(signal).toHaveProperty('triggerMessage');
    expect(signal).toHaveProperty('chatContext');
    expect(signal).toHaveProperty('createdAt');
    expect(signal).toHaveProperty('updatedAt');
    expect(Array.isArray(signal.chatContext)).toBe(true);
  });

  it('signal type is one of the two valid enum values', async () => {
    const res = await api(`/api/client-signals/${baseWsId}`);
    const body = await res.json();
    expect(body.length).toBeGreaterThan(0);
    const validTypes = new Set(['service_interest', 'content_interest']);
    expect(body.length > 0 && body.every((s: { type: string }) => validTypes.has(s.type))).toBe(true);
  });

  it('signal status is one of the three valid enum values', async () => {
    const res = await api(`/api/client-signals/${baseWsId}`);
    const body = await res.json();
    expect(body.length).toBeGreaterThan(0);
    const validStatuses = new Set(['new', 'reviewed', 'actioned']);
    expect(body.length > 0 && body.every((s: { status: string }) => validStatuses.has(s.status))).toBe(true);
  });
});

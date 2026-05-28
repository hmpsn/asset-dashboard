/**
 * Integration tests for the public-endpoint auth fix shipped under
 * sprint-platform-health-wave8-audit-drift-closure (Plan A Task 1).
 *
 * Four sensitive public data endpoints previously relied solely on the
 * global app-level gate (server/app.ts), which silently allowed access to
 * workspaces that had no clientPassword set — leaking data during the
 * pre-setup window. This PR adds `requireAuthenticatedClientPortalAuth`
 * per-route so passwordless / unconfigured workspaces also require real
 * auth before serving rank, audit-traffic, or anomaly data:
 *   - GET /api/public/rank-tracking/:workspaceId/history
 *   - GET /api/public/rank-tracking/:workspaceId/latest
 *   - GET /api/public/audit-traffic/:workspaceId
 *   - GET /api/public/anomalies/:workspaceId
 *
 * Auth gate semantics (per server/middleware.ts:requireAuthenticatedClientPortalAuth):
 *   - Workspaces with NO clientPassword are blocked (unlike
 *     `requireClientPortalAuth`, which lets them through). Sensitive data
 *     should not leak during the setup window.
 *   - Authenticated clients pass via shared-password session cookie
 *     (`client_session_<wsId>`), per-workspace JWT cookie
 *     (`client_user_token_<wsId>`), or admin HMAC `x-auth-token`.
 *   - A session/JWT scoped to workspace A is rejected on workspace B's
 *     endpoints (cookie names are workspace-namespaced).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13871);
const { api, postJson, clearCookies } = ctx;

let wsAId = '';
let wsBId = '';
let wsCId = '';
let wsPasswordlessId = '';
const wsAPassword = 'test-password-A';
const wsBPassword = 'test-password-B';
const wsCPassword = 'test-password-C';

beforeAll(async () => {
  await ctx.startServer();
  const wsA = createWorkspace('Public Auth Test WS A');
  wsAId = wsA.id;
  updateWorkspace(wsAId, { clientPassword: wsAPassword });

  const wsB = createWorkspace('Public Auth Test WS B');
  wsBId = wsB.id;
  updateWorkspace(wsBId, { clientPassword: wsBPassword });

  // wsC is used by the soft-gated auth tests to avoid rate-limiter
  // bucket collision with wsA (2 hard-gate auth calls) and wsB (1 validation call).
  const wsC = createWorkspace('Public Auth Test WS C');
  wsCId = wsC.id;
  updateWorkspace(wsCId, { clientPassword: wsCPassword });

  const wsPasswordless = createWorkspace('Public Auth Test WS Passwordless');
  wsPasswordlessId = wsPasswordless.id;
  // Intentionally no clientPassword set — simulates a freshly-created
  // workspace whose dashboard hasn't been configured yet.
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsAId);
  deleteWorkspace(wsBId);
  deleteWorkspace(wsCId);
  deleteWorkspace(wsPasswordlessId);
  await ctx.stopServer();
});

// requireAuthenticatedClientPortalAuth — hard gate; passwordless workspaces are also blocked.
// Use for actual business intelligence that should not leak during the workspace setup window
// (rank tracking, anomalies, traffic analytics).
const hardProtectedEndpoints = (wsId: string) => [
  { label: 'rank-tracking history', path: `/api/public/rank-tracking/${wsId}/history` },
  { label: 'rank-tracking latest', path: `/api/public/rank-tracking/${wsId}/latest` },
  { label: 'audit-traffic', path: `/api/public/audit-traffic/${wsId}` },
  { label: 'anomalies', path: `/api/public/anomalies/${wsId}` },
];

// requireClientPortalAuth — soft gate; passwordless workspaces pass through (workspace ID is the credential).
// Use for content explicitly published for the client (audit detail, briefings, copy, orders).
const softProtectedEndpoints = (wsId: string) => [
  { label: 'audit-detail', path: `/api/public/audit-detail/${wsId}` },
  { label: 'copy entries', path: `/api/public/copy/${wsId}/entries` },
  { label: 'copy sections', path: `/api/public/copy/${wsId}/entry/fake-entry-id/sections` },
  { label: 'briefing', path: `/api/public/briefing/${wsId}` },
  { label: 'fix-orders', path: `/api/public/fix-orders/${wsId}` },
  { label: 'work-orders public', path: `/api/public/work-orders/${wsId}` },
];

// Keep legacy name for the existing describe-blocks (all hard-protected)
const protectedEndpoints = hardProtectedEndpoints;

describe('Public endpoint auth — unauthenticated callers on password-set workspace blocked', () => {
  for (const { label, path } of protectedEndpoints('PLACEHOLDER')) {
    it(`GET ${label} without any auth returns 401`, async () => {
      clearCookies();
      const realPath = path.replace('PLACEHOLDER', wsAId);
      const res = await api(realPath);
      expect(res.status).toBe(401);
      const body = await res.json().catch(() => ({}));
      expect(body).toHaveProperty('error');
    });
  }
});

describe('Public endpoint auth — unauthenticated callers on passwordless workspace ALSO blocked', () => {
  // Regression-locks the pre-setup data-leak fix. Without
  // requireAuthenticatedClientPortalAuth, the global gate at
  // server/app.ts:262 would short-circuit to next() because
  // !ws.clientPassword, exposing every workspaceId's data.
  for (const { label, path } of protectedEndpoints('PLACEHOLDER')) {
    it(`GET ${label} on passwordless workspace without auth returns 401`, async () => {
      clearCookies();
      const realPath = path.replace('PLACEHOLDER', wsPasswordlessId);
      const res = await api(realPath);
      expect(res.status).toBe(401);
    });
  }
});

describe('Public endpoint auth — authenticated clients allowed', () => {
  beforeAll(async () => {
    clearCookies();
    const authRes = await postJson(`/api/public/auth/${wsAId}`, { password: wsAPassword });
    expect(authRes.status).toBe(200);
  });

  for (const { label, path } of protectedEndpoints('PLACEHOLDER')) {
    it(`GET ${label} with valid workspace session is not rejected with 401`, async () => {
      const realPath = path.replace('PLACEHOLDER', wsAId);
      const res = await api(realPath);
      // Auth gate passed — business logic may return 200, 400, 402, or 404
      // depending on workspace data state, but must NOT return 401.
      expect(res.status).not.toBe(401);
    });
  }
});

describe('Public endpoint auth — cross-workspace session rejected', () => {
  beforeAll(async () => {
    clearCookies();
    // Authenticate as workspace A.
    const authRes = await postJson(`/api/public/auth/${wsAId}`, { password: wsAPassword });
    expect(authRes.status).toBe(200);
  });

  for (const { label, path } of protectedEndpoints('PLACEHOLDER')) {
    it(`GET ${label} on workspace B with workspace A session returns 401`, async () => {
      const realPath = path.replace('PLACEHOLDER', wsBId);
      const res = await api(realPath);
      // Session cookie is workspace-namespaced (`client_session_<wsId>`),
      // so neither the global gate nor the per-route middleware sees a
      // usable credential for ws B.
      expect(res.status).toBe(401);
    });
  }
});

describe('Anomaly admin-mutation — nonexistent ID returns 404', () => {
  // These confirm the handlers are reachable in the test environment and
  // that the first guard (`getAnomalyById`) fires. They do NOT prove the
  // cross-workspace `requestUserCanAccessWorkspace` guard works — that
  // would require seeding a real anomaly in a different workspace.
  it('POST /api/anomalies/:anomalyId/dismiss with bogus id returns 404', async () => {
    clearCookies();
    const res = await postJson('/api/anomalies/anom_nonexistent_999/dismiss', {});
    expect(res.status).toBe(404);
  });

  it('POST /api/anomalies/:anomalyId/acknowledge with bogus id returns 404', async () => {
    clearCookies();
    const res = await postJson('/api/anomalies/anom_nonexistent_999/acknowledge', {});
    expect(res.status).toBe(404);
  });
});

describe('Public endpoint auth — input validation on authenticated requests', () => {
  it('GET rank-tracking history with invalid limit returns 400', async () => {
    // Authenticate as wsB (unused in prior describes, avoids rate limiter
    // bucket collision with wsA which already hit 3+ calls).
    clearCookies();
    const authRes = await postJson(`/api/public/auth/${wsBId}`, { password: wsBPassword });
    expect(authRes.status).toBe(200);
    const res = await api(`/api/public/rank-tracking/${wsBId}/history?limit=-1`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

// ── Soft-gated routes (requireClientPortalAuth) ──────────────────────────────
// These are gated for password-set workspaces but allow passwordless workspaces
// through — the workspace ID in the URL is the credential for passwordless portals.

describe('Soft-gated endpoint auth — unauthenticated callers on password-set workspace blocked', () => {
  for (const { label, path } of softProtectedEndpoints('PLACEHOLDER')) {
    it(`GET ${label} without auth on password-set workspace returns 401`, async () => {
      clearCookies();
      const realPath = path.replace('PLACEHOLDER', wsAId);
      const res = await api(realPath);
      expect(res.status).toBe(401);
    });
  }
});

describe('Soft-gated endpoint auth — passwordless workspace passes through', () => {
  for (const { label, path } of softProtectedEndpoints('PLACEHOLDER')) {
    it(`GET ${label} on passwordless workspace without auth is not 401`, async () => {
      clearCookies();
      const realPath = path.replace('PLACEHOLDER', wsPasswordlessId);
      const res = await api(realPath);
      // requireClientPortalAuth lets passwordless workspaces through; handler
      // may return 200, 402, 403, or 404 depending on data state.
      expect(res.status).not.toBe(401);
    });
  }
});

describe('Soft-gated endpoint auth — authenticated clients on password-set workspace allowed', () => {
  // Use wsC (fresh bucket) to avoid rate-limiter collision with wsA (2 hard-gate calls) + wsB (1 validation call).
  beforeAll(async () => {
    clearCookies();
    const authRes = await postJson(`/api/public/auth/${wsCId}`, { password: wsCPassword });
    expect(authRes.status).toBe(200);
  });

  for (const { label, path } of softProtectedEndpoints('PLACEHOLDER')) {
    it(`GET ${label} with valid workspace session is not rejected with 401`, async () => {
      const realPath = path.replace('PLACEHOLDER', wsCId);
      const res = await api(realPath);
      expect(res.status).not.toBe(401);
    });
  }
});

describe('Soft-gated endpoint auth — cross-workspace session rejected', () => {
  // wsC session on wsA routes. wsC bucket has only 1 call from the preceding describe.
  beforeAll(async () => {
    clearCookies();
    const authRes = await postJson(`/api/public/auth/${wsCId}`, { password: wsCPassword });
    expect(authRes.status).toBe(200);
  });

  for (const { label, path } of softProtectedEndpoints('PLACEHOLDER')) {
    it(`GET ${label} on workspace A with workspace C session returns 401`, async () => {
      const realPath = path.replace('PLACEHOLDER', wsAId);
      const res = await api(realPath);
      expect(res.status).toBe(401);
    });
  }
});

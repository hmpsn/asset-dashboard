/**
 * E1 — Guard the four public-portal GETs (audit #2)
 *
 * Pins the auth matrix for:
 *   GET /api/public/audit-summary/:workspaceId
 *   GET /api/public/keyword-feedback/:workspaceId
 *   GET /api/public/business-priorities/:workspaceId
 *   GET /api/public/content-gap-votes/:workspaceId
 *
 * Matrix (a–e) asserted for EACH of the four endpoints:
 *   (a) no credential + password-configured workspace → 401
 *   (b) admin HMAC x-auth-token                      → 200
 *   (c) client JWT cookie for workspace A             → 200
 *   (d) passwordless workspace + no credential        → 401 (E3: closed until configured)
 *   (e) client JWT for workspace B against workspace A → 401 (cross-workspace)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { createClientUser, deleteClientUser, signClientToken } from '../../server/client-users.js';
import { deleteWorkspace } from '../../server/workspaces.js';
import crypto from 'crypto';

const ctx = createEphemeralTestContext(import.meta.url);

// Workspace A: has a client password set (default from seedWorkspace)
let wsA = { workspaceId: '' };
// Workspace B: second password-protected workspace (for cross-workspace isolation case)
let wsB = { workspaceId: '' };
// Passwordless workspace
let wsNoPass = { workspaceId: '' };

let clientUserIdA = '';
let clientTokenA = '';
let clientTokenB = '';

// Compute the admin HMAC token the same way the test context does internally.
// createEphemeralTestContext spawns the server with SESSION_SECRET from process.env
// or a fixed test default. We use the same derivation so the token is valid.
const SESSION_SECRET =
  process.env.SESSION_SECRET ?? 'asset-dashboard-test-session-secret';
const adminHmacToken = crypto
  .createHmac('sha256', SESSION_SECRET)
  .update('admin')
  .digest('hex');

// The four guarded GET endpoints under test.
const ENDPOINTS = [
  (wsId: string) => `/api/public/audit-summary/${wsId}`,
  (wsId: string) => `/api/public/keyword-feedback/${wsId}`,
  (wsId: string) => `/api/public/business-priorities/${wsId}`,
  (wsId: string) => `/api/public/content-gap-votes/${wsId}`,
] as const;

// Convenience: GET with an explicit Cookie header (bypasses cookieJar).
// clearCookies first — ctx.api overwrites the Cookie header with jar contents
// whenever the jar is non-empty, which would make these assertions vacuous.
async function getWithCookie(path: string, cookieValue: string): Promise<Response> {
  ctx.clearCookies();
  return ctx.api(path, {
    headers: { Cookie: cookieValue, 'x-no-auto-public-auth': 'true' },
  });
}

// Convenience: GET with no credentials.
async function getUnauthenticated(path: string): Promise<Response> {
  ctx.clearCookies();
  return ctx.api(path, {
    headers: { 'x-no-auto-public-auth': 'true' },
  });
}

// Convenience: GET with admin HMAC token.
async function getAsAdmin(path: string): Promise<Response> {
  ctx.clearCookies();
  return ctx.api(path, {
    headers: { 'x-auth-token': adminHmacToken, 'x-no-auto-public-auth': 'true' },
  });
}

beforeAll(async () => {
  await ctx.startServer();

  // Workspace A: password set (default seedWorkspace sets clientPassword='test-password')
  const seedA = seedWorkspace();
  wsA = { workspaceId: seedA.workspaceId };

  // Workspace B: another password-protected workspace (for cross-ws test)
  const seedBResult = seedWorkspace();
  wsB = { workspaceId: seedBResult.workspaceId };

  // Passwordless workspace (no clientPassword)
  const seedNoPass = seedWorkspace({ clientPassword: '' });
  wsNoPass = { workspaceId: seedNoPass.workspaceId };

  // Create a client user for workspace A
  const userA = await createClientUser(
    'client-e1-a@test.local',
    'test-password-a',
    'E1 Client A',
    wsA.workspaceId,
    'client_member',
  );
  clientUserIdA = userA.id;
  clientTokenA = signClientToken(userA);

  // Create a client user for workspace B (token used against workspace A)
  const userB = await createClientUser(
    'client-e1-b@test.local',
    'test-password-b',
    'E1 Client B',
    wsB.workspaceId,
    'client_member',
  );
  clientTokenB = signClientToken(userB);
}, 40_000);

afterAll(async () => {
  if (clientUserIdA) deleteClientUser(clientUserIdA, wsA.workspaceId);
  if (wsA.workspaceId) deleteWorkspace(wsA.workspaceId);
  if (wsB.workspaceId) deleteWorkspace(wsB.workspaceId);
  if (wsNoPass.workspaceId) deleteWorkspace(wsNoPass.workspaceId);
  await ctx.stopServer();
});

// ─── Matrix tests ────────────────────────────────────────────────────────────
// NOTE: wsA.workspaceId / wsNoPass.workspaceId are set in beforeAll.
// The URL must be computed INSIDE each `it` callback so it reads the
// post-seed value — not the empty-string initial value captured at describe
// registration time (which fires before beforeAll).

describe('public-portal GET auth guards — case (a): no credential, password-configured workspace → 401', () => {
  for (const endpointFn of ENDPOINTS) {
    it(`GET ${endpointFn('{wsA}')} → 401`, async () => {
      const res = await getUnauthenticated(endpointFn(wsA.workspaceId));
      expect(res.status).toBe(401);
    });
  }
});

describe('public-portal GET auth guards — case (b): admin HMAC token → 200', () => {
  for (const endpointFn of ENDPOINTS) {
    it(`GET ${endpointFn('{wsA}')} with admin HMAC → 200`, async () => {
      const res = await getAsAdmin(endpointFn(wsA.workspaceId));
      expect(res.status).toBe(200);
    });
  }
});

describe('public-portal GET auth guards — case (c): client JWT for workspace A → 200', () => {
  for (const endpointFn of ENDPOINTS) {
    it(`GET ${endpointFn('{wsA}')} with client JWT → 200`, async () => {
      const res = await getWithCookie(
        endpointFn(wsA.workspaceId),
        `client_user_token_${wsA.workspaceId}=${clientTokenA}`,
      );
      expect(res.status).toBe(200);
    });
  }
});

// E3: passwordless workspaces are now closed until configured — no longer pass through.
describe('public-portal GET auth guards — case (d): passwordless workspace + no credential → 401', () => {
  for (const endpointFn of ENDPOINTS) {
    it(`GET ${endpointFn('{wsNoPass}')} → 401 (E3: closed until configured)`, async () => {
      const res = await getUnauthenticated(endpointFn(wsNoPass.workspaceId));
      expect(res.status).toBe(401);
    });
  }
});

describe('public-portal GET auth guards — case (d2): admin HMAC on a PASSWORDLESS workspace → 200', () => {
  // The one path E3 must NOT break: admins must still preview unconfigured
  // (passwordless) portals. The admin HMAC check precedes the removed
  // passwordless pass-through in the guard, so this must stay 200 even though
  // an unauthenticated request to the same workspace now gets 401 (case d).
  for (const endpointFn of ENDPOINTS) {
    it(`GET ${endpointFn('{wsNoPass}')} with admin HMAC → 200`, async () => {
      const res = await getAsAdmin(endpointFn(wsNoPass.workspaceId));
      expect(res.status).toBe(200);
    });
  }
});

describe('public-portal GET auth guards — case (e): client JWT for workspace B against workspace A → 401', () => {
  for (const endpointFn of ENDPOINTS) {
    it(`GET ${endpointFn('{wsA}')} with forged workspace-A cookie carrying workspace-B token → 401`, async () => {
      // Forgery: the cookie NAME claims workspace A (so the middleware reads
      // it), but the token inside belongs to workspace B's user. This pins the
      // payload.workspaceId check in verifyClientUserTokenForWorkspace — the
      // strongest cross-workspace defense, not just the cookie-name scoping.
      const res = await getWithCookie(
        endpointFn(wsA.workspaceId),
        `client_user_token_${wsA.workspaceId}=${clientTokenB}`,
      );
      expect(res.status).toBe(401);
    });

    it(`GET ${endpointFn('{wsA}')} with workspace-B-named cookie → 401`, async () => {
      // Weaker variant: cookie scoped to workspace B against a workspace-A URL
      // (middleware never reads this cookie name).
      const res = await getWithCookie(
        endpointFn(wsA.workspaceId),
        `client_user_token_${wsB.workspaceId}=${clientTokenB}`,
      );
      expect(res.status).toBe(401);
    });
  }
});

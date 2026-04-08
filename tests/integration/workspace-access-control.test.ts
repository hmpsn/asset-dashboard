/**
 * Unit-style tests for the `requireWorkspaceAccess` middleware.
 *
 * Tests all role paths by constructing mock req/res/next objects and
 * calling the middleware directly — no HTTP server needed.
 *
 * Role coverage:
 *  - owner               → always passes through (bypasses workspace check)
 *  - admin with access   → passes through when workspaceId is in workspaceIds
 *  - member with access  → passes through when workspaceId is in workspaceIds
 *  - admin without access → rejected with 403
 *  - member without access → rejected with 403
 *  - client user (no req.user) → passes through (HMAC / client JWT path)
 *  - no JWT present (HMAC admin panel) → passes through
 *  - missing :workspaceId param → passes through (route handles the missing param)
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type { SafeInternalUser } from '../../shared/types/users.js';
import { requireWorkspaceAccess } from '../../server/auth.js';

// ── Mock helpers ───────────────────────────────────────────────────────────

/**
 * Build a minimal Express Request mock.
 * @param user - SafeInternalUser to attach as req.user, or undefined for unauthenticated
 * @param params - Route params (e.g. { id: 'ws_123' })
 */
function mockReq(user: SafeInternalUser | undefined, params: Record<string, string> = {}): Request {
  return { user, params } as unknown as Request;
}

/**
 * Build a mock Response that captures status + json calls.
 * Returns an object with the mock and recorded values.
 */
function mockRes() {
  const recorded: { status?: number; body?: unknown } = {};
  const res = {
    status: vi.fn().mockImplementation((code: number) => {
      recorded.status = code;
      return res; // chainable
    }),
    json: vi.fn().mockImplementation((body: unknown) => {
      recorded.body = body;
      return res;
    }),
  } as unknown as Response;
  return { res, recorded };
}

/**
 * Run the middleware and return whether next() was called.
 */
function runMiddleware(
  user: SafeInternalUser | undefined,
  params: Record<string, string>,
  paramName?: string,
): { nextCalled: boolean; status?: number; body?: unknown } {
  const req = mockReq(user, params);
  const { res, recorded } = mockRes();
  const next = vi.fn() as NextFunction;

  const middleware = paramName ? requireWorkspaceAccess(paramName) : requireWorkspaceAccess();
  middleware(req, res, next);

  return {
    nextCalled: (next as ReturnType<typeof vi.fn>).mock.calls.length > 0,
    status: recorded.status,
    body: recorded.body,
  };
}

// ── Fixture helpers ────────────────────────────────────────────────────────

const WORKSPACE_A = 'ws_test_alpha';
const WORKSPACE_B = 'ws_test_beta';

function makeUser(role: SafeInternalUser['role'], workspaceIds: string[]): SafeInternalUser {
  return {
    id: `usr_${role}_test`,
    email: `${role}@test.local`,
    name: `Test ${role}`,
    role,
    workspaceIds,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('requireWorkspaceAccess — owner role', () => {
  it('owner with matching workspace passes through', () => {
    const user = makeUser('owner', [WORKSPACE_A]);
    const result = runMiddleware(user, { id: WORKSPACE_A });
    expect(result.nextCalled).toBe(true);
    expect(result.status).toBeUndefined();
  });

  it('owner with no assigned workspaces still passes through (owners bypass the check)', () => {
    const user = makeUser('owner', []);
    const result = runMiddleware(user, { id: WORKSPACE_B });
    expect(result.nextCalled).toBe(true);
    expect(result.status).toBeUndefined();
  });

  it('owner accessing a completely different workspace still passes through', () => {
    const user = makeUser('owner', [WORKSPACE_A]);
    const result = runMiddleware(user, { id: WORKSPACE_B });
    expect(result.nextCalled).toBe(true);
    expect(result.status).toBeUndefined();
  });
});

describe('requireWorkspaceAccess — admin role', () => {
  it('admin with workspace assignment passes through', () => {
    const user = makeUser('admin', [WORKSPACE_A]);
    const result = runMiddleware(user, { id: WORKSPACE_A });
    expect(result.nextCalled).toBe(true);
    expect(result.status).toBeUndefined();
  });

  it('admin assigned to multiple workspaces passes through for each', () => {
    const user = makeUser('admin', [WORKSPACE_A, WORKSPACE_B]);

    const resultA = runMiddleware(user, { id: WORKSPACE_A });
    expect(resultA.nextCalled).toBe(true);

    const resultB = runMiddleware(user, { id: WORKSPACE_B });
    expect(resultB.nextCalled).toBe(true);
  });

  it('admin from a different workspace is rejected with 403', () => {
    const user = makeUser('admin', [WORKSPACE_B]);
    const result = runMiddleware(user, { id: WORKSPACE_A });
    expect(result.nextCalled).toBe(false);
    expect(result.status).toBe(403);
    expect((result.body as { error: string }).error).toContain('access');
  });

  it('admin with no workspace assignments is rejected with 403', () => {
    const user = makeUser('admin', []);
    const result = runMiddleware(user, { id: WORKSPACE_A });
    expect(result.nextCalled).toBe(false);
    expect(result.status).toBe(403);
  });
});

describe('requireWorkspaceAccess — member role', () => {
  it('member with workspace assignment passes through', () => {
    const user = makeUser('member', [WORKSPACE_A]);
    const result = runMiddleware(user, { id: WORKSPACE_A });
    expect(result.nextCalled).toBe(true);
    expect(result.status).toBeUndefined();
  });

  it('member from a different workspace is rejected with 403', () => {
    const user = makeUser('member', [WORKSPACE_B]);
    const result = runMiddleware(user, { id: WORKSPACE_A });
    expect(result.nextCalled).toBe(false);
    expect(result.status).toBe(403);
    expect((result.body as { error: string }).error).toContain('access');
  });

  it('member with no workspace assignments is rejected with 403', () => {
    const user = makeUser('member', []);
    const result = runMiddleware(user, { id: WORKSPACE_A });
    expect(result.nextCalled).toBe(false);
    expect(result.status).toBe(403);
  });
});

describe('requireWorkspaceAccess — unauthenticated / client user path', () => {
  /**
   * When req.user is undefined, the middleware passes through.
   * This covers two scenarios:
   *   1. HMAC admin panel auth (x-auth-token) — the global APP_PASSWORD gate
   *      already validated the request before this middleware runs.
   *   2. Client portal users — they authenticate via a separate client JWT
   *      that sets a client-specific cookie, never populating req.user.
   *      The client routes handle their own auth; requireWorkspaceAccess
   *      gracefully passes through so the admin panel flow is not broken.
   */
  it('no JWT user present (HMAC admin panel) passes through', () => {
    const result = runMiddleware(undefined, { id: WORKSPACE_A });
    expect(result.nextCalled).toBe(true);
    expect(result.status).toBeUndefined();
  });

  it('client user path (no req.user) passes through regardless of workspace param', () => {
    // Client users don't set req.user — they use a separate cookie-based JWT.
    // The middleware must not block them; their own route handlers verify access.
    const result = runMiddleware(undefined, { id: WORKSPACE_B });
    expect(result.nextCalled).toBe(true);
    expect(result.status).toBeUndefined();
  });

  it('completely unauthenticated request (no params, no user) passes through', () => {
    const result = runMiddleware(undefined, {});
    expect(result.nextCalled).toBe(true);
    expect(result.status).toBeUndefined();
  });
});

describe('requireWorkspaceAccess — missing workspaceId param', () => {
  it('authenticated user with missing param passes through (no param to check against)', () => {
    // When the route does not have the expected param (e.g. middleware applied
    // on a route without :id), the middleware passes through rather than
    // blocking all requests. The route handler is responsible for 404s.
    const user = makeUser('member', [WORKSPACE_A]);
    const result = runMiddleware(user, {});
    expect(result.nextCalled).toBe(true);
    expect(result.status).toBeUndefined();
  });

  it('admin with missing param passes through', () => {
    const user = makeUser('admin', [WORKSPACE_A]);
    const result = runMiddleware(user, {});
    expect(result.nextCalled).toBe(true);
    expect(result.status).toBeUndefined();
  });
});

describe('requireWorkspaceAccess — custom param name', () => {
  it('reads from the specified param name when provided', () => {
    const user = makeUser('member', [WORKSPACE_A]);
    // Route has :workspaceId instead of :id
    const result = runMiddleware(user, { workspaceId: WORKSPACE_A }, 'workspaceId');
    expect(result.nextCalled).toBe(true);
    expect(result.status).toBeUndefined();
  });

  it('rejects when custom param workspace does not match user assignments', () => {
    const user = makeUser('member', [WORKSPACE_B]);
    const result = runMiddleware(user, { workspaceId: WORKSPACE_A }, 'workspaceId');
    expect(result.nextCalled).toBe(false);
    expect(result.status).toBe(403);
  });

  it('passes through when custom param is absent even for restricted user', () => {
    const user = makeUser('member', [WORKSPACE_A]);
    // Param key is 'workspaceId' but route params have no 'workspaceId' key
    const result = runMiddleware(user, { id: WORKSPACE_A }, 'workspaceId');
    expect(result.nextCalled).toBe(true);
    expect(result.status).toBeUndefined();
  });
});

describe('requireWorkspaceAccess — cross-workspace isolation', () => {
  it('user A cannot access workspace B even if both workspaces exist', () => {
    const userA = makeUser('member', [WORKSPACE_A]);
    const result = runMiddleware(userA, { id: WORKSPACE_B });
    expect(result.nextCalled).toBe(false);
    expect(result.status).toBe(403);
  });

  it('user B cannot access workspace A', () => {
    const userB = makeUser('admin', [WORKSPACE_B]);
    const result = runMiddleware(userB, { id: WORKSPACE_A });
    expect(result.nextCalled).toBe(false);
    expect(result.status).toBe(403);
  });

  it('user with both workspaces can access either', () => {
    const user = makeUser('member', [WORKSPACE_A, WORKSPACE_B]);

    const resultA = runMiddleware(user, { id: WORKSPACE_A });
    expect(resultA.nextCalled).toBe(true);

    const resultB = runMiddleware(user, { id: WORKSPACE_B });
    expect(resultB.nextCalled).toBe(true);
  });
});

describe('requireWorkspaceAccess — response shape on rejection', () => {
  it('403 response body has an `error` string field', () => {
    const user = makeUser('member', [WORKSPACE_B]);
    const result = runMiddleware(user, { id: WORKSPACE_A });
    expect(result.nextCalled).toBe(false);
    expect(result.status).toBe(403);
    const body = result.body as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  it('admin rejection also returns 403 with an error string', () => {
    const user = makeUser('admin', []);
    const result = runMiddleware(user, { id: WORKSPACE_A });
    expect(result.nextCalled).toBe(false);
    expect(result.status).toBe(403);
    const body = result.body as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
  });
});

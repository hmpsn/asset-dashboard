/**
 * Integration tests — client user management lifecycle.
 *
 * Covers the admin-side client user CRUD endpoints:
 *   GET    /api/workspaces/:id/client-users
 *   POST   /api/workspaces/:id/client-users
 *   PATCH  /api/workspaces/:id/client-users/:userId
 *   POST   /api/workspaces/:id/client-users/:userId/password
 *   DELETE /api/workspaces/:id/client-users/:userId
 *
 * Note: basic create/read/update/delete and cross-workspace isolation for
 * client users are also covered in workspaces-routes-extended.test.ts (port
 * 13370). This file focuses on the full lifecycle story, response-shape
 * contracts, field-level update coverage, and the delete-then-verify pattern.
 * Each describe block manages its own users so failures are isolated.
 */
import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { deleteClientUser } from '../../server/client-users.js';
const ctx = createEphemeralTestContext(import.meta.url);
const { api, postJson, patchJson, del } = ctx;

let wsA = '';
let wsB = '';

// Cleanup registry — every user created across all describes is tracked here.
const cleanup: Array<{ userId: string; workspaceId: string }> = [];

function uniq(prefix = 'cu') {
  return `${prefix}-${randomUUID()}@test.local`;
}

async function createUser(
  workspaceId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; email: string; name: string; role: string; workspaceId: string }> {
  const email = uniq();
  const res = await postJson(`/api/workspaces/${workspaceId}/client-users`, {
    email,
    password: 'ValidPass1234!',
    name: 'Test Client',
    role: 'client_member',
    ...overrides,
  });
  if (res.status !== 200) {
    throw new Error(`createUser failed with ${res.status}: ${await res.text()}`);
  }
  const body = await res.json();
  cleanup.push({ userId: body.id, workspaceId });
  return body;
}

beforeAll(async () => {
  await ctx.startServer();
  wsA = createWorkspace('CU Lifecycle WS A').id;
  wsB = createWorkspace('CU Lifecycle WS B').id;
}, 30_000);

afterAll(async () => {
  for (const { userId, workspaceId } of cleanup) {
    try { deleteClientUser(userId, workspaceId); } catch { /* already deleted */ }
  }
  deleteWorkspace(wsA);
  deleteWorkspace(wsB);
  await ctx.stopServer();
});

// ---------------------------------------------------------------------------
// GET /api/workspaces/:id/client-users
// ---------------------------------------------------------------------------
describe('GET /api/workspaces/:id/client-users', () => {
  it('returns an empty array when workspace has no client users', async () => {
    const res = await api(`/api/workspaces/${wsA}/client-users`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns newly created user with expected fields', async () => {
    const user = await createUser(wsA, { name: 'List Test User', role: 'client_owner' });

    const res = await api(`/api/workspaces/${wsA}/client-users`);
    expect(res.status).toBe(200);
    const body: Array<Record<string, unknown>> = await res.json();

    const found = body.find(u => u['id'] === user.id);
    expect(found).toBeDefined();
    expect(found!['email']).toBe(user.email);
    expect(found!['name']).toBe('List Test User');
    expect(found!['role']).toBe('client_owner');
    expect(found!['workspaceId']).toBe(wsA);
    // Sensitive field must be stripped
    expect(found!['passwordHash']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// POST /api/workspaces/:id/client-users
// ---------------------------------------------------------------------------
describe('POST /api/workspaces/:id/client-users', () => {
  it('creates a client user and returns 200 with expected shape', async () => {
    const email = uniq('create');
    const res = await postJson(`/api/workspaces/${wsA}/client-users`, {
      email,
      password: 'StrongPass9876!',
      name: 'Shape Test',
      role: 'client_member',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.email).toBe(email.toLowerCase());
    expect(body.name).toBe('Shape Test');
    expect(body.role).toBe('client_member');
    expect(body.workspaceId).toBe(wsA);
    expect(body.passwordHash).toBeUndefined();
    cleanup.push({ userId: body.id, workspaceId: wsA });
  });

  it('created user appears in subsequent GET list', async () => {
    const user = await createUser(wsA, { name: 'Appears In List' });

    const res = await api(`/api/workspaces/${wsA}/client-users`);
    expect(res.status).toBe(200);
    const list: Array<{ id: string }> = await res.json();
    expect(list.some(u => u.id === user.id)).toBe(true);
  });

  it('defaults role to client_member when not provided', async () => {
    const email = uniq('default-role');
    const res = await postJson(`/api/workspaces/${wsA}/client-users`, {
      email,
      password: 'StrongPass9876!',
      name: 'Default Role',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('client_member');
    cleanup.push({ userId: body.id, workspaceId: wsA });
  });

  it('accepts client_owner as role', async () => {
    const user = await createUser(wsA, { role: 'client_owner', name: 'Owner User' });
    expect(user.role).toBe('client_owner');
  });

  it('returns 400 for missing email', async () => {
    const res = await postJson(`/api/workspaces/${wsA}/client-users`, {
      password: 'StrongPass9876!',
      name: 'No Email',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing password', async () => {
    const res = await postJson(`/api/workspaces/${wsA}/client-users`, {
      email: uniq('no-pw'),
      name: 'No Password',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for password shorter than 8 characters', async () => {
    const res = await postJson(`/api/workspaces/${wsA}/client-users`, {
      email: uniq('short-pw'),
      password: 'abc123',
      name: 'Short PW',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid email format', async () => {
    const res = await postJson(`/api/workspaces/${wsA}/client-users`, {
      email: 'not-an-email',
      password: 'StrongPass9876!',
      name: 'Bad Email',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for duplicate email within the same workspace', async () => {
    const user = await createUser(wsA, { name: 'Dup Source' });

    const res = await postJson(`/api/workspaces/${wsA}/client-users`, {
      email: user.email,
      password: 'StrongPass9876!',
      name: 'Duplicate',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it('allows same email in a different workspace', async () => {
    const user = await createUser(wsA, { name: 'Cross WS Original' });

    // Same email, different workspace — should succeed
    const res = await postJson(`/api/workspaces/${wsB}/client-users`, {
      email: user.email,
      password: 'StrongPass9876!',
      name: 'Cross WS Copy',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    cleanup.push({ userId: body.id, workspaceId: wsB });
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/workspaces/:id/client-users/:userId
// ---------------------------------------------------------------------------
describe('PATCH /api/workspaces/:id/client-users/:userId', () => {
  it('updates the name field', async () => {
    const user = await createUser(wsA, { name: 'Before Name Update' });

    const res = await patchJson(`/api/workspaces/${wsA}/client-users/${user.id}`, {
      name: 'After Name Update',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('After Name Update');
    // Other fields unchanged
    expect(body.email).toBe(user.email);
    expect(body.role).toBe('client_member');
  });

  it('updates role from client_member to client_owner', async () => {
    const user = await createUser(wsA, { name: 'Role Upgrade', role: 'client_member' });

    const res = await patchJson(`/api/workspaces/${wsA}/client-users/${user.id}`, {
      role: 'client_owner',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('client_owner');
  });

  it('updates role from client_owner back to client_member', async () => {
    const user = await createUser(wsA, { name: 'Role Downgrade', role: 'client_owner' });

    const res = await patchJson(`/api/workspaces/${wsA}/client-users/${user.id}`, {
      role: 'client_member',
    });
    expect(res.status).toBe(200);
    expect((await res.json()).role).toBe('client_member');
  });

  it('updates avatarUrl field', async () => {
    const user = await createUser(wsA, { name: 'Avatar Test' });
    const avatarUrl = 'https://example.com/avatar.png';

    const res = await patchJson(`/api/workspaces/${wsA}/client-users/${user.id}`, {
      avatarUrl,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.avatarUrl).toBe(avatarUrl);
  });

  it('clears avatarUrl with empty string', async () => {
    const user = await createUser(wsA, { name: 'Clear Avatar' });
    // First set one
    await patchJson(`/api/workspaces/${wsA}/client-users/${user.id}`, {
      avatarUrl: 'https://example.com/avatar.png',
    });
    // Then clear it
    const res = await patchJson(`/api/workspaces/${wsA}/client-users/${user.id}`, {
      avatarUrl: '',
    });
    expect(res.status).toBe(200);
  });

  it('updates email to a new unique value', async () => {
    const user = await createUser(wsA, { name: 'Email Update' });
    const newEmail = uniq('updated-email');

    const res = await patchJson(`/api/workspaces/${wsA}/client-users/${user.id}`, {
      email: newEmail,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).email).toBe(newEmail.toLowerCase());
  });

  it('returns 400 when new email is invalid', async () => {
    const user = await createUser(wsA, { name: 'Bad Email Update' });

    const res = await patchJson(`/api/workspaces/${wsA}/client-users/${user.id}`, {
      email: 'not-valid',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid role value', async () => {
    const user = await createUser(wsA, { name: 'Bad Role Update' });

    const res = await patchJson(`/api/workspaces/${wsA}/client-users/${user.id}`, {
      role: 'superadmin',
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown userId', async () => {
    const res = await patchJson(`/api/workspaces/${wsA}/client-users/cu_nonexistent_lifecycle`, {
      name: 'Ghost',
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/workspaces/:id/client-users/:userId/password
// ---------------------------------------------------------------------------
describe('POST /api/workspaces/:id/client-users/:userId/password', () => {
  it('changes password and returns { ok: true }', async () => {
    const user = await createUser(wsA, { name: 'PW Change' });

    const res = await postJson(
      `/api/workspaces/${wsA}/client-users/${user.id}/password`,
      { password: 'NewValidPass9876!' },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 400 for password shorter than 8 characters', async () => {
    const user = await createUser(wsA, { name: 'PW Too Short' });

    const res = await postJson(
      `/api/workspaces/${wsA}/client-users/${user.id}/password`,
      { password: 'short' },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/8 characters/i);
  });

  it('returns 400 when password is missing from body', async () => {
    const user = await createUser(wsA, { name: 'PW Missing' });

    const res = await postJson(
      `/api/workspaces/${wsA}/client-users/${user.id}/password`,
      {},
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown userId', async () => {
    const res = await postJson(
      `/api/workspaces/${wsA}/client-users/cu_ghost_lifecycle_99/password`,
      { password: 'LongEnoughPass123' },
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/workspaces/:id/client-users/:userId
// ---------------------------------------------------------------------------
describe('DELETE /api/workspaces/:id/client-users/:userId', () => {
  it('deletes a user and returns { ok: true }', async () => {
    const user = await createUser(wsA, { name: 'To Be Deleted' });

    const res = await del(`/api/workspaces/${wsA}/client-users/${user.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Remove from cleanup since we already deleted it
    const idx = cleanup.findIndex(e => e.userId === user.id);
    if (idx !== -1) cleanup.splice(idx, 1);
  });

  it('deleted user no longer appears in the GET list', async () => {
    const user = await createUser(wsA, { name: 'Verify Delete Lifecycle' });

    // Confirm user appears in the list
    const beforeRes = await api(`/api/workspaces/${wsA}/client-users`);
    const beforeList: Array<{ id: string }> = await beforeRes.json();
    expect(beforeList.some(u => u.id === user.id)).toBe(true);

    // Delete
    await del(`/api/workspaces/${wsA}/client-users/${user.id}`);

    // Remove from cleanup registry since already deleted
    const idx = cleanup.findIndex(e => e.userId === user.id);
    if (idx !== -1) cleanup.splice(idx, 1);

    // Confirm user no longer in list
    const afterRes = await api(`/api/workspaces/${wsA}/client-users`);
    expect(afterRes.status).toBe(200);
    const afterList: Array<{ id: string }> = await afterRes.json();
    expect(afterList.some(u => u.id === user.id)).toBe(false);
  });

  it('returns 404 for an unknown userId', async () => {
    const res = await del(`/api/workspaces/${wsA}/client-users/cu_nonexistent_delete`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Workspace isolation — cross-workspace authz enforcement
// ---------------------------------------------------------------------------
describe('Workspace isolation', () => {
  it('PATCH via wrong workspace returns 404', async () => {
    // Create user in wsA, attempt to mutate via wsB path
    const user = await createUser(wsA, { name: 'Isolation PATCH Target' });

    const res = await patchJson(`/api/workspaces/${wsB}/client-users/${user.id}`, {
      name: 'Cross-Workspace Hack',
    });
    expect(res.status).toBe(404);
  });

  it('DELETE via wrong workspace returns 404', async () => {
    const user = await createUser(wsA, { name: 'Isolation DELETE Target' });

    const res = await del(`/api/workspaces/${wsB}/client-users/${user.id}`);
    expect(res.status).toBe(404);

    // User should still exist — verify via correct workspace GET
    const getRes = await api(`/api/workspaces/${wsA}/client-users`);
    const list: Array<{ id: string }> = await getRes.json();
    expect(list.some(u => u.id === user.id)).toBe(true);
  });

  it('password change via wrong workspace returns 404', async () => {
    const user = await createUser(wsA, { name: 'Isolation PW Target' });

    const res = await postJson(
      `/api/workspaces/${wsB}/client-users/${user.id}/password`,
      { password: 'CrossWorkspaceHack123!' },
    );
    expect(res.status).toBe(404);
  });

  it('GET list for wsB does not include users created in wsA', async () => {
    const userA = await createUser(wsA, { name: 'WS A Isolation User' });

    const res = await api(`/api/workspaces/${wsB}/client-users`);
    expect(res.status).toBe(200);
    const list: Array<{ id: string }> = await res.json();
    expect(list.some(u => u.id === userA.id)).toBe(false);
  });
});

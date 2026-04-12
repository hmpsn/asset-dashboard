/**
 * Unit tests for server/client-users.ts — client user CRUD, JWT, password reset.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createClientUser,
  getClientUserById,
  getClientUserByEmail,
  getSafeClientUser,
  listClientUsers,
  updateClientUser,
  changeClientPassword,
  deleteClientUser,
  recordClientLogin,
  verifyClientPassword,
  signClientToken,
  verifyClientToken,
  clientUserCount,
  hasClientUsers,
  createResetToken,
  resetPasswordWithToken,
} from '../../server/client-users.js';

const WS_ID = 'ws_test_client_users';
const createdIds: string[] = [];

// Fixed workspace IDs (not Date.now()-suffixed) can accumulate residual rows when a
// prior run crashes before afterAll fires. Wipe them clean before each run.
const FIXED_TEST_WORKSPACES = [
  WS_ID,
  WS_ID + '_upper',
  WS_ID + '_a',
  WS_ID + '_b',
  WS_ID + '_inv',
  WS_ID + '_read',
  WS_ID + '_upd',
  WS_ID + '_verify',
  WS_ID + '_changepw',
  WS_ID + '_jwt',
  WS_ID + '_del',
  WS_ID + '_login',
];

/**
 * Test-only cleanup helper: deletes a client user by id, looking up the
 * workspace from the user row itself. Required because `deleteClientUser`
 * now enforces cross-workspace authorization (PR #168 staging-hardening
 * flag) by requiring the caller to pass the expected workspace id.
 * Sweep paths like `afterAll` only have the id in hand, so we fetch the
 * user first and pass its own workspace id. Returns silently on missing
 * user (already cleaned up).
 */
function cleanupUser(id: string): void {
  const user = getClientUserById(id);
  if (!user) return;
  try { deleteClientUser(id, user.workspaceId); } catch { /* skip */ }
}

beforeAll(() => {
  for (const ws of FIXED_TEST_WORKSPACES) {
    const users = listClientUsers(ws);
    for (const u of users) {
      try { deleteClientUser(u.id, ws); } catch { /* skip */ }
    }
  }
});

afterAll(() => {
  for (const id of createdIds) {
    cleanupUser(id);
  }
});

// ── createClientUser ──

describe('createClientUser', () => {
  it('creates a client user with correct fields', async () => {
    const user = await createClientUser('client1@example.com', 'pass123', 'Client One', WS_ID);
    createdIds.push(user.id);

    expect(user.id).toMatch(/^cu_/);
    expect(user.email).toBe('client1@example.com');
    expect(user.name).toBe('Client One');
    expect(user.role).toBe('client_member');
    expect(user.workspaceId).toBe(WS_ID);
    expect('passwordHash' in user).toBe(false);
  });

  it('normalizes email to lowercase', async () => {
    const user = await createClientUser('UPPER@EXAMPLE.COM', 'pass123', 'Upper', WS_ID + '_upper');
    createdIds.push(user.id);
    expect(user.email).toBe('upper@example.com');
  });

  it('throws on duplicate email within same workspace', async () => {
    const user = await createClientUser('dup-client@example.com', 'pass123', 'Dup', WS_ID);
    createdIds.push(user.id);

    await expect(
      createClientUser('DUP-CLIENT@EXAMPLE.COM', 'pass456', 'Dup2', WS_ID)
    ).rejects.toThrow('A client with this email already exists in this workspace');
  });

  it('allows same email in different workspaces', async () => {
    const user = await createClientUser('cross-ws@example.com', 'pass123', 'Cross', WS_ID + '_a');
    createdIds.push(user.id);

    const user2 = await createClientUser('cross-ws@example.com', 'pass123', 'Cross', WS_ID + '_b');
    createdIds.push(user2.id);

    expect(user.id).not.toBe(user2.id);
  });

  it('stores invitedBy when provided', async () => {
    const user = await createClientUser('invited@example.com', 'pass123', 'Invited', WS_ID + '_inv', 'client_member', 'usr_admin_1');
    createdIds.push(user.id);
    expect(user.invitedBy).toBe('usr_admin_1');
  });
});

// ── Read operations ──

describe('client user read operations', () => {
  let userId: string;

  it('getClientUserById returns full user', async () => {
    const created = await createClientUser('read-client@example.com', 'pass123', 'Read Client', WS_ID + '_read');
    createdIds.push(created.id);
    userId = created.id;

    const user = getClientUserById(userId);
    expect(user).not.toBeNull();
    expect(user!.passwordHash).toBeDefined();
  });

  it('getClientUserById returns null for non-existent id', () => {
    expect(getClientUserById('cu_nonexistent')).toBeNull();
  });

  it('getClientUserByEmail scopes to workspace', async () => {
    const user = getClientUserByEmail('read-client@example.com', WS_ID + '_read');
    expect(user).not.toBeNull();

    const wrong = getClientUserByEmail('read-client@example.com', 'ws_wrong');
    expect(wrong).toBeNull();
  });

  it('getSafeClientUser strips password', () => {
    const safe = getSafeClientUser(userId);
    expect(safe).not.toBeNull();
    expect('passwordHash' in safe!).toBe(false);
  });

  it('listClientUsers filters by workspace', async () => {
    const wsId = WS_ID + '_list_' + Date.now();
    const u1 = await createClientUser('list1@example.com', 'pass', 'L1', wsId);
    const u2 = await createClientUser('list2@example.com', 'pass', 'L2', wsId);
    createdIds.push(u1.id, u2.id);

    const list = listClientUsers(wsId);
    expect(list).toHaveLength(2);
    expect(list.length > 0 && list.every(u => u.workspaceId === wsId)).toBe(true);
    expect(list.length > 0 && list.every(u => !('passwordHash' in u))).toBe(true);
  });
});

// ── updateClientUser ──

describe('updateClientUser', () => {
  it('updates name and role', async () => {
    const user = await createClientUser('update-client@example.com', 'pass123', 'Original', WS_ID + '_upd');
    createdIds.push(user.id);

    const updated = await updateClientUser(user.id, WS_ID + '_upd', { name: 'Updated', role: 'client_owner' });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('Updated');
    expect(updated!.role).toBe('client_owner');
  });

  it('returns null for non-existent id', async () => {
    expect(await updateClientUser('cu_nonexistent', WS_ID, { name: 'X' })).toBeNull();
  });

  it('returns null when the user belongs to a different workspace', async () => {
    // Cross-workspace authz regression test: PR #168 staging-hardening flag.
    // A caller authenticated for workspace A must not be able to mutate a user
    // in workspace B even if they know the user id. Returns null (not false)
    // so callers can't distinguish "doesn't exist" from "belongs to another
    // workspace" — avoids a workspace-enumeration oracle.
    const user = await createClientUser('cross-ws-authz@example.com', 'pass123', 'CrossWs', WS_ID + '_a');
    createdIds.push(user.id);

    const result = await updateClientUser(user.id, WS_ID + '_b', { name: 'Hacked' });
    expect(result).toBeNull();

    // Confirm the name did NOT change
    const unchanged = getClientUserById(user.id);
    expect(unchanged!.name).toBe('CrossWs');
  });
});

// ── Password & Auth ──

describe('client password operations', () => {
  it('verifyClientPassword returns user for correct password', async () => {
    const wsId = WS_ID + '_verify';
    const created = await createClientUser('verify-client@example.com', 'correctpass', 'Verify', wsId);
    createdIds.push(created.id);

    const user = await verifyClientPassword('verify-client@example.com', wsId, 'correctpass');
    expect(user).not.toBeNull();
    expect(user!.id).toBe(created.id);
  });

  it('verifyClientPassword returns null for wrong password', async () => {
    const wsId = WS_ID + '_verify';
    expect(await verifyClientPassword('verify-client@example.com', wsId, 'wrong')).toBeNull();
  });

  it('changeClientPassword updates the password', async () => {
    const wsId = WS_ID + '_changepw';
    const created = await createClientUser('changepw-client@example.com', 'oldpass', 'Change', wsId);
    createdIds.push(created.id);

    expect(await changeClientPassword(created.id, wsId, 'newpass')).toBe(true);
    expect(await verifyClientPassword('changepw-client@example.com', wsId, 'newpass')).not.toBeNull();
    expect(await verifyClientPassword('changepw-client@example.com', wsId, 'oldpass')).toBeNull();
  });

  it('changeClientPassword returns false when user belongs to a different workspace', async () => {
    // Cross-workspace authz regression test: PR #168 staging-hardening flag.
    const created = await createClientUser('cross-ws-pw@example.com', 'oldpass', 'CrossWsPw', WS_ID + '_a');
    createdIds.push(created.id);

    const result = await changeClientPassword(created.id, WS_ID + '_b', 'newpass');
    expect(result).toBe(false);

    // Confirm the original password still works
    expect(await verifyClientPassword('cross-ws-pw@example.com', WS_ID + '_a', 'oldpass')).not.toBeNull();
  });
});

// ── Client JWT ──

describe('signClientToken / verifyClientToken', () => {
  it('round-trips client token correctly', async () => {
    const created = await createClientUser('jwt-client@example.com', 'pass', 'JWT Client', WS_ID + '_jwt');
    createdIds.push(created.id);

    const token = signClientToken(created);
    const payload = verifyClientToken(token);

    expect(payload).not.toBeNull();
    expect(payload!.clientUserId).toBe(created.id);
    expect(payload!.email).toBe('jwt-client@example.com');
    expect(payload!.workspaceId).toBe(WS_ID + '_jwt');
  });

  it('returns null for invalid token', () => {
    expect(verifyClientToken('invalid.token')).toBeNull();
  });

  it('returns null for empty token', () => {
    expect(verifyClientToken('')).toBeNull();
  });
});

// ── Counting ──

describe('clientUserCount / hasClientUsers', () => {
  it('clientUserCount returns correct count', async () => {
    const wsId = WS_ID + '_count_' + Date.now();
    expect(clientUserCount(wsId)).toBe(0);

    const u = await createClientUser('count@example.com', 'pass', 'Count', wsId);
    createdIds.push(u.id);
    expect(clientUserCount(wsId)).toBe(1);
  });

  it('hasClientUsers returns correct boolean', async () => {
    const wsId = WS_ID + '_has_' + Date.now();
    expect(hasClientUsers(wsId)).toBe(false);

    const u = await createClientUser('has@example.com', 'pass', 'Has', wsId);
    createdIds.push(u.id);
    expect(hasClientUsers(wsId)).toBe(true);
  });
});

// ── Password Reset Tokens ──

describe('createResetToken / resetPasswordWithToken', () => {
  it('creates a reset token for existing user', async () => {
    const wsId = WS_ID + '_reset_' + Date.now();
    const user = await createClientUser('reset@example.com', 'pass123', 'Reset User', wsId);
    createdIds.push(user.id);

    const result = createResetToken('reset@example.com', wsId);
    expect(result).not.toBeNull();
    expect(result!.token).toBeDefined();
    expect(result!.token.length).toBeGreaterThan(0);
    expect(result!.user.id).toBe(user.id);
  });

  it('returns null for non-existent user', () => {
    expect(createResetToken('nonexistent@example.com', 'ws_none')).toBeNull();
  });

  it('resets password with valid token', async () => {
    const wsId = WS_ID + '_reset2_' + Date.now();
    const user = await createClientUser('reset2@example.com', 'oldpass', 'Reset2', wsId);
    createdIds.push(user.id);

    const resetResult = createResetToken('reset2@example.com', wsId);
    const result = await resetPasswordWithToken(resetResult!.token, 'newpassword123');
    expect(result.success).toBe(true);

    // Verify new password works
    expect(await verifyClientPassword('reset2@example.com', wsId, 'newpassword123')).not.toBeNull();
  });

  it('rejects invalid reset token', async () => {
    const result = await resetPasswordWithToken('invalid_token', 'newpass123');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid');
  });

  it('rejects password shorter than 8 characters', async () => {
    const wsId = WS_ID + '_reset3_' + Date.now();
    const user = await createClientUser('reset3@example.com', 'oldpass123', 'Reset3', wsId);
    createdIds.push(user.id);

    const resetResult = createResetToken('reset3@example.com', wsId);
    const result = await resetPasswordWithToken(resetResult!.token, 'short');
    expect(result.success).toBe(false);
    expect(result.error).toContain('8 characters');
  });
});

// ── deleteClientUser ──

describe('deleteClientUser', () => {
  it('removes the user', async () => {
    const user = await createClientUser('delete-client@example.com', 'pass', 'Del', WS_ID + '_del');
    expect(deleteClientUser(user.id, WS_ID + '_del')).toBe(true);
    expect(getClientUserById(user.id)).toBeNull();
  });

  it('returns false for non-existent id', () => {
    expect(deleteClientUser('cu_nonexistent', WS_ID)).toBe(false);
  });

  it('returns false when the user belongs to a different workspace', async () => {
    // Cross-workspace authz regression test: PR #168 staging-hardening flag.
    // An admin authenticated for workspace B who knows a user id from
    // workspace A must NOT be able to delete it.
    const user = await createClientUser('cross-ws-del@example.com', 'pass', 'CrossWsDel', WS_ID + '_a');
    createdIds.push(user.id);

    const result = deleteClientUser(user.id, WS_ID + '_b');
    expect(result).toBe(false);

    // Confirm the user still exists
    expect(getClientUserById(user.id)).not.toBeNull();
  });
});

// ── recordClientLogin ──

describe('recordClientLogin', () => {
  it('updates lastLoginAt', async () => {
    const user = await createClientUser('login-client@example.com', 'pass', 'Login', WS_ID + '_login');
    createdIds.push(user.id);

    recordClientLogin(user.id);
    const fetched = getClientUserById(user.id);
    expect(fetched!.lastLoginAt).toBeDefined();
  });
});

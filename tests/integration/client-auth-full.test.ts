/**
 * Full lifecycle tests for client authentication.
 *
 * Tests module functions directly (in-process imports) rather than
 * starting an HTTP server. Covers:
 *   - createClientUser: success, duplicate rejection
 *   - verifyClientPassword: correct, wrong password, non-existent user
 *   - signClientToken / verifyClientToken: JWT format, payload fields,
 *     cross-workspace isolation, malformed/expired token rejection
 *   - Role enforcement: client_member vs client_owner
 *   - changeClientPassword: updates hash, old password rejected after change
 *   - recordClientLogin: stamps lastLoginAt
 *   - createResetToken / resetPasswordWithToken: full password reset flow,
 *     expired token rejection, invalid token rejection
 *   - deleteClientUser: removes user, subsequent lookup returns null
 *   - listClientUsers: returns only users for the queried workspace
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';

import { seedAuthData, type SeededAuth } from '../fixtures/auth-seed.js';
import { cleanSeedData } from '../global-setup.js';
import db from '../../server/db/index.js';
import {
  createClientUser,
  verifyClientPassword,
  signClientToken,
  verifyClientToken,
  changeClientPassword,
  recordClientLogin,
  getClientUserById,
  getClientUserByEmail,
  listClientUsers,
  deleteClientUser,
  createResetToken,
  resetPasswordWithToken,
  type ClientJwtPayload,
} from '../../server/client-users.js';
import { JWT_SECRET } from '../../server/jwt-config.js';

// ── Fixture setup ──────────────────────────────────────────────────────────────

let seeded: SeededAuth;

beforeAll(async () => {
  seeded = await seedAuthData();
});

afterAll(() => {
  seeded.cleanup();
  cleanSeedData(seeded.workspaceId);
});

// ── createClientUser ───────────────────────────────────────────────────────────

describe('createClientUser', () => {
  it('creates a user and returns a SafeClientUser without passwordHash', async () => {
    const suffix = randomUUID().slice(0, 6);
    const user = await createClientUser(
      `new-${suffix}@test.local`,
      'SomePass123!',
      `New User ${suffix}`,
      seeded.workspaceId,
      'client_member',
    );

    expect(user.id).toMatch(/^cu_/);
    expect(user.email).toBe(`new-${suffix}@test.local`);
    expect(user.name).toBe(`New User ${suffix}`);
    expect(user.role).toBe('client_member');
    expect(user.workspaceId).toBe(seeded.workspaceId);
    expect((user as Record<string, unknown>).passwordHash).toBeUndefined();

    // Cleanup
    deleteClientUser(user.id);
  });

  it('creates a client_owner role user', async () => {
    const suffix = randomUUID().slice(0, 6);
    const user = await createClientUser(
      `owner-${suffix}@test.local`,
      'OwnerPass1!',
      `Owner ${suffix}`,
      seeded.workspaceId,
      'client_owner',
    );

    expect(user.role).toBe('client_owner');
    deleteClientUser(user.id);
  });

  it('rejects duplicate email within the same workspace', async () => {
    const suffix = randomUUID().slice(0, 6);
    const email = `dup-${suffix}@test.local`;

    const first = await createClientUser(email, 'Pass1234!', 'First', seeded.workspaceId);

    await expect(
      createClientUser(email, 'Pass5678!', 'Second', seeded.workspaceId),
    ).rejects.toThrow('already exists');

    deleteClientUser(first.id);
  });

  it('allows the same email in a different workspace', async () => {
    const suffix = randomUUID().slice(0, 6);
    const email = `shared-${suffix}@test.local`;

    // Create a second workspace for isolation
    const wsB = `test-ws-b-${suffix}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO workspaces (id, name, folder, tier, created_at) VALUES (?, ?, ?, 'free', ?)`,
    ).run(wsB, `WS-B ${suffix}`, `ws-b-${suffix}`, now);

    const userA = await createClientUser(email, 'PassA1!', 'A', seeded.workspaceId);
    const userB = await createClientUser(email, 'PassB1!', 'B', wsB);

    expect(userA.id).not.toBe(userB.id);

    deleteClientUser(userA.id);
    deleteClientUser(userB.id);
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(wsB);
  });

  it('lowercases and trims the email', async () => {
    const suffix = randomUUID().slice(0, 6);
    const user = await createClientUser(
      `  UPPER-${suffix}@Test.Local  `,
      'Trimmed1!',
      'Trim User',
      seeded.workspaceId,
    );

    expect(user.email).toBe(`upper-${suffix}@test.local`);
    deleteClientUser(user.id);
  });
});

// ── verifyClientPassword ───────────────────────────────────────────────────────

describe('verifyClientPassword', () => {
  it('returns the ClientUser when correct email+password+workspace are given', async () => {
    const suffix = randomUUID().slice(0, 6);
    const email = `verify-${suffix}@test.local`;
    const password = 'CorrectP@ss1';

    const created = await createClientUser(email, password, 'Verify User', seeded.workspaceId);

    const result = await verifyClientPassword(email, seeded.workspaceId, password);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(created.id);
    expect(result!.email).toBe(email);
    // verifyClientPassword returns a ClientUser (with passwordHash), not SafeClientUser
    expect(result!.passwordHash).toBeDefined();

    deleteClientUser(created.id);
  });

  it('returns null on wrong password', async () => {
    const suffix = randomUUID().slice(0, 6);
    const email = `wrongpw-${suffix}@test.local`;

    const created = await createClientUser(email, 'RightPassword1!', 'WP User', seeded.workspaceId);

    const result = await verifyClientPassword(email, seeded.workspaceId, 'WrongPassword1!');
    expect(result).toBeNull();

    deleteClientUser(created.id);
  });

  it('returns null for a non-existent email', async () => {
    const result = await verifyClientPassword(
      'nobody-does-not-exist@test.local',
      seeded.workspaceId,
      'anypassword',
    );
    expect(result).toBeNull();
  });

  it('returns null when email exists in a different workspace', async () => {
    const suffix = randomUUID().slice(0, 6);
    const email = `ws-iso-${suffix}@test.local`;
    const wsB = `test-ws-iso-${suffix}`;
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO workspaces (id, name, folder, tier, created_at) VALUES (?, ?, ?, 'free', ?)`,
    ).run(wsB, `WS-Iso ${suffix}`, `ws-iso-${suffix}`, now);

    const created = await createClientUser(email, 'IsoPass1!', 'Iso User', wsB);

    // Attempt login against seeded workspace — should not find the user
    const result = await verifyClientPassword(email, seeded.workspaceId, 'IsoPass1!');
    expect(result).toBeNull();

    deleteClientUser(created.id);
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(wsB);
  });
});

// ── signClientToken / verifyClientToken ────────────────────────────────────────

describe('signClientToken / verifyClientToken', () => {
  it('signClientToken returns a string JWT', () => {
    const token = seeded.clientToken;
    expect(typeof token).toBe('string');
    // JWT has three dot-separated segments
    expect(token.split('.')).toHaveLength(3);
  });

  it('verifyClientToken returns payload with required fields', () => {
    const payload = verifyClientToken(seeded.clientToken);

    expect(payload).not.toBeNull();
    expect(payload!.clientUserId).toBe(seeded.clientUserId);
    expect(payload!.workspaceId).toBe(seeded.workspaceId);
    expect(typeof payload!.email).toBe('string');
    expect(payload!.email.length).toBeGreaterThan(0);
    expect(typeof payload!.role).toBe('string');
  });

  it('JWT payload contains clientUserId (not userId) to distinguish from admin tokens', () => {
    // Decode without verifying to inspect the raw claims
    const decoded = jwt.decode(seeded.clientToken) as Record<string, unknown>;
    expect(decoded.clientUserId).toBeDefined();
    expect(decoded.userId).toBeUndefined();
  });

  it('verifyClientToken returns null for a token signed with the wrong secret', () => {
    const badToken = jwt.sign(
      { clientUserId: 'cu_fake', email: 'x@x.com', role: 'client_member', workspaceId: 'ws' },
      'wrong-secret',
      { expiresIn: '1h' },
    );
    const result = verifyClientToken(badToken);
    expect(result).toBeNull();
  });

  it('verifyClientToken returns null for a malformed (non-JWT) string', () => {
    expect(verifyClientToken('not.a.token')).toBeNull();
    expect(verifyClientToken('')).toBeNull();
    expect(verifyClientToken('Bearer abc123')).toBeNull();
  });

  it('verifyClientToken returns null for a token missing clientUserId claim', () => {
    // An admin-style token has userId, not clientUserId
    const adminStyleToken = jwt.sign(
      { userId: 'usr_admin', email: 'admin@test.local', role: 'admin' },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
    const result = verifyClientToken(adminStyleToken);
    expect(result).toBeNull();
  });

  it('verifyClientToken returns null for an expired token', () => {
    const expiredToken = jwt.sign(
      {
        clientUserId: seeded.clientUserId,
        email: 'expired@test.local',
        role: 'client_member',
        workspaceId: seeded.workspaceId,
      },
      JWT_SECRET,
      { expiresIn: -1 }, // already expired
    );
    const result = verifyClientToken(expiredToken);
    expect(result).toBeNull();
  });

  it('signClientToken encodes role correctly for client_owner', async () => {
    const suffix = randomUUID().slice(0, 6);
    const ownerUser = await createClientUser(
      `owner-tok-${suffix}@test.local`,
      'OwnerTok1!',
      'Owner Token',
      seeded.workspaceId,
      'client_owner',
    );

    const token = signClientToken(ownerUser);
    const payload = verifyClientToken(token) as ClientJwtPayload;

    expect(payload).not.toBeNull();
    expect(payload.role).toBe('client_owner');

    deleteClientUser(ownerUser.id);
  });

  it('signClientToken encodes role correctly for client_member', async () => {
    const suffix = randomUUID().slice(0, 6);
    const memberUser = await createClientUser(
      `member-tok-${suffix}@test.local`,
      'MemberTok1!',
      'Member Token',
      seeded.workspaceId,
      'client_member',
    );

    const token = signClientToken(memberUser);
    const payload = verifyClientToken(token) as ClientJwtPayload;

    expect(payload).not.toBeNull();
    expect(payload.role).toBe('client_member');

    deleteClientUser(memberUser.id);
  });
});

// ── changeClientPassword ───────────────────────────────────────────────────────

describe('changeClientPassword', () => {
  it('returns true and makes the new password valid', async () => {
    const suffix = randomUUID().slice(0, 6);
    const email = `changepw-${suffix}@test.local`;
    const oldPassword = 'OldPassword1!';
    const newPassword = 'NewPassword1!';

    const created = await createClientUser(email, oldPassword, 'Change PW', seeded.workspaceId);

    const changed = await changeClientPassword(created.id, newPassword);
    expect(changed).toBe(true);

    // Old password must now be rejected
    const withOld = await verifyClientPassword(email, seeded.workspaceId, oldPassword);
    expect(withOld).toBeNull();

    // New password must now be accepted
    const withNew = await verifyClientPassword(email, seeded.workspaceId, newPassword);
    expect(withNew).not.toBeNull();

    deleteClientUser(created.id);
  });

  it('returns false for a non-existent user id', async () => {
    const result = await changeClientPassword('cu_nonexistent_999', 'NewPassword1!');
    expect(result).toBe(false);
  });
});

// ── recordClientLogin ──────────────────────────────────────────────────────────

describe('recordClientLogin', () => {
  it('stamps lastLoginAt on the user record', async () => {
    const suffix = randomUUID().slice(0, 6);
    const email = `login-stamp-${suffix}@test.local`;

    const created = await createClientUser(email, 'LoginPass1!', 'Login Stamp', seeded.workspaceId);

    // Confirm lastLoginAt starts as undefined/null
    const before = getClientUserById(created.id);
    expect(before).not.toBeNull();
    expect(before!.lastLoginAt).toBeUndefined();

    const beforeTime = Date.now();
    recordClientLogin(created.id);
    const afterTime = Date.now();

    const after = getClientUserById(created.id);
    expect(after).not.toBeNull();
    expect(after!.lastLoginAt).toBeDefined();

    const stampMs = new Date(after!.lastLoginAt!).getTime();
    expect(stampMs).toBeGreaterThanOrEqual(beforeTime - 1000); // 1s tolerance
    expect(stampMs).toBeLessThanOrEqual(afterTime + 1000);

    deleteClientUser(created.id);
  });

  it('is a no-op for a non-existent user id (does not throw)', () => {
    expect(() => recordClientLogin('cu_nonexistent_000')).not.toThrow();
  });
});

// ── getClientUserById / getClientUserByEmail ───────────────────────────────────

describe('getClientUserById / getClientUserByEmail', () => {
  it('getClientUserById returns the user with passwordHash', async () => {
    const suffix = randomUUID().slice(0, 6);
    const created = await createClientUser(
      `byid-${suffix}@test.local`,
      'ByIdPass1!',
      'ById User',
      seeded.workspaceId,
    );

    const found = getClientUserById(created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    // Full ClientUser — includes passwordHash
    expect(found!.passwordHash).toBeDefined();
    expect(found!.passwordHash.length).toBeGreaterThan(0);

    deleteClientUser(created.id);
  });

  it('getClientUserById returns null for a non-existent id', () => {
    expect(getClientUserById('cu_nonexistent_xyz')).toBeNull();
  });

  it('getClientUserByEmail is case-insensitive within a workspace', async () => {
    const suffix = randomUUID().slice(0, 6);
    const email = `casecheck-${suffix}@test.local`;

    const created = await createClientUser(email, 'CasePass1!', 'Case User', seeded.workspaceId);

    const foundLower = getClientUserByEmail(email.toLowerCase(), seeded.workspaceId);
    const foundUpper = getClientUserByEmail(email.toUpperCase(), seeded.workspaceId);

    expect(foundLower).not.toBeNull();
    expect(foundUpper).not.toBeNull();
    expect(foundLower!.id).toBe(created.id);
    expect(foundUpper!.id).toBe(created.id);

    deleteClientUser(created.id);
  });

  it('getClientUserByEmail returns null for a different workspace', async () => {
    const suffix = randomUUID().slice(0, 6);
    const email = `ws-check-${suffix}@test.local`;

    const created = await createClientUser(email, 'WsCheckPass1!', 'Ws Check', seeded.workspaceId);

    const result = getClientUserByEmail(email, 'completely-different-workspace-id');
    expect(result).toBeNull();

    deleteClientUser(created.id);
  });
});

// ── listClientUsers ────────────────────────────────────────────────────────────

describe('listClientUsers', () => {
  it('returns all users for the workspace (without passwordHash)', async () => {
    const suffix = randomUUID().slice(0, 6);
    const wsId = `test-list-${suffix}`;
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO workspaces (id, name, folder, tier, created_at) VALUES (?, ?, ?, 'free', ?)`,
    ).run(wsId, `List WS ${suffix}`, `list-ws-${suffix}`, now);

    const a = await createClientUser(`a-${suffix}@test.local`, 'ListPassA1!', 'User A', wsId);
    const b = await createClientUser(`b-${suffix}@test.local`, 'ListPassB1!', 'User B', wsId);

    const users = listClientUsers(wsId);

    expect(users.length).toBeGreaterThan(0);
    expect(users.length).toBe(2);

    const ids = users.map(u => u.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);

    // SafeClientUser — no passwordHash
    expect(users.every(u => (u as Record<string, unknown>).passwordHash === undefined)).toBe(true);

    // Cleanup
    deleteClientUser(a.id);
    deleteClientUser(b.id);
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(wsId);
  });

  it('returns only users belonging to the queried workspace', async () => {
    const suffix = randomUUID().slice(0, 6);
    const wsA = `test-isolation-a-${suffix}`;
    const wsB = `test-isolation-b-${suffix}`;
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO workspaces (id, name, folder, tier, created_at) VALUES (?, ?, ?, 'free', ?)`,
    ).run(wsA, `Iso WS A ${suffix}`, `iso-a-${suffix}`, now);
    db.prepare(
      `INSERT INTO workspaces (id, name, folder, tier, created_at) VALUES (?, ?, ?, 'free', ?)`,
    ).run(wsB, `Iso WS B ${suffix}`, `iso-b-${suffix}`, now);

    const userA = await createClientUser(`only-a-${suffix}@test.local`, 'IsoPassA1!', 'Only A', wsA);
    const userB = await createClientUser(`only-b-${suffix}@test.local`, 'IsoPassB1!', 'Only B', wsB);

    const usersA = listClientUsers(wsA);
    const usersB = listClientUsers(wsB);

    expect(usersA.length).toBeGreaterThan(0);
    expect(usersB.length).toBeGreaterThan(0);

    expect(usersA.every(u => u.workspaceId === wsA)).toBe(true);
    expect(usersB.every(u => u.workspaceId === wsB)).toBe(true);

    expect(usersA.find(u => u.id === userB.id)).toBeUndefined();
    expect(usersB.find(u => u.id === userA.id)).toBeUndefined();

    deleteClientUser(userA.id);
    deleteClientUser(userB.id);
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(wsA);
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(wsB);
  });

  it('returns an empty array for a workspace with no client users', () => {
    const users = listClientUsers('ws-with-no-users-definitely-nonexistent');
    expect(Array.isArray(users)).toBe(true);
    expect(users.length).toBe(0);
  });
});

// ── deleteClientUser ───────────────────────────────────────────────────────────

describe('deleteClientUser', () => {
  it('removes the user and returns true', async () => {
    const suffix = randomUUID().slice(0, 6);
    const created = await createClientUser(
      `delete-me-${suffix}@test.local`,
      'DeletePass1!',
      'Delete Me',
      seeded.workspaceId,
    );

    const result = deleteClientUser(created.id);
    expect(result).toBe(true);

    const lookup = getClientUserById(created.id);
    expect(lookup).toBeNull();
  });

  it('returns false for a non-existent user id', () => {
    expect(deleteClientUser('cu_already_gone_999')).toBe(false);
  });
});

// ── createResetToken / resetPasswordWithToken ──────────────────────────────────

describe('createResetToken / resetPasswordWithToken', () => {
  it('createResetToken returns a token and safe user for an existing email', async () => {
    const suffix = randomUUID().slice(0, 6);
    const email = `reset-${suffix}@test.local`;

    const created = await createClientUser(email, 'ResetOld1!', 'Reset User', seeded.workspaceId);

    const result = createResetToken(email, seeded.workspaceId);
    expect(result).not.toBeNull();
    expect(typeof result!.token).toBe('string');
    expect(result!.token.length).toBeGreaterThan(0);
    expect(result!.user.id).toBe(created.id);
    expect((result!.user as Record<string, unknown>).passwordHash).toBeUndefined();

    deleteClientUser(created.id);
  });

  it('createResetToken returns null for a non-existent email', () => {
    const result = createResetToken('nobody-nonexistent@test.local', seeded.workspaceId);
    expect(result).toBeNull();
  });

  it('resetPasswordWithToken succeeds with a valid token and new password', async () => {
    const suffix = randomUUID().slice(0, 6);
    const email = `full-reset-${suffix}@test.local`;
    const oldPassword = 'OldReset1!';
    const newPassword = 'NewReset1!';

    const created = await createClientUser(email, oldPassword, 'Full Reset', seeded.workspaceId);

    const tokenResult = createResetToken(email, seeded.workspaceId);
    expect(tokenResult).not.toBeNull();

    const resetResult = await resetPasswordWithToken(tokenResult!.token, newPassword);
    expect(resetResult.success).toBe(true);
    expect(resetResult.error).toBeUndefined();

    // Old password now rejected
    const withOld = await verifyClientPassword(email, seeded.workspaceId, oldPassword);
    expect(withOld).toBeNull();

    // New password accepted
    const withNew = await verifyClientPassword(email, seeded.workspaceId, newPassword);
    expect(withNew).not.toBeNull();

    deleteClientUser(created.id);
  });

  it('resetPasswordWithToken fails for an invalid token', async () => {
    const result = await resetPasswordWithToken('definitely-not-a-real-token-xyz', 'NewPassword1!');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!.length).toBeGreaterThan(0);
  });

  it('resetPasswordWithToken rejects a password shorter than 8 characters', async () => {
    const suffix = randomUUID().slice(0, 6);
    const email = `short-pw-${suffix}@test.local`;

    const created = await createClientUser(email, 'LongEnough1!', 'Short PW', seeded.workspaceId);
    const tokenResult = createResetToken(email, seeded.workspaceId);
    expect(tokenResult).not.toBeNull();

    const result = await resetPasswordWithToken(tokenResult!.token, 'short');
    expect(result.success).toBe(false);
    expect(result.error).toContain('8 characters');

    deleteClientUser(created.id);
  });

  it('resetPasswordWithToken rejects the token after a successful reset (single-use)', async () => {
    const suffix = randomUUID().slice(0, 6);
    const email = `single-use-${suffix}@test.local`;

    const created = await createClientUser(email, 'SingleUse1!', 'Single Use', seeded.workspaceId);
    const tokenResult = createResetToken(email, seeded.workspaceId);
    expect(tokenResult).not.toBeNull();

    // First use — should succeed
    const first = await resetPasswordWithToken(tokenResult!.token, 'NewSingle1!');
    expect(first.success).toBe(true);

    // Second use — token consumed, must fail
    const second = await resetPasswordWithToken(tokenResult!.token, 'AnotherNew1!');
    expect(second.success).toBe(false);

    deleteClientUser(created.id);
  });

  it('resetPasswordWithToken rejects an expired token', async () => {
    const suffix = randomUUID().slice(0, 6);
    const email = `expired-tok-${suffix}@test.local`;

    const created = await createClientUser(email, 'ExpiredTok1!', 'Expired Tok', seeded.workspaceId);
    const tokenResult = createResetToken(email, seeded.workspaceId);
    expect(tokenResult).not.toBeNull();

    // Manually backdate the token's expiry to simulate expiration
    db.prepare('UPDATE reset_tokens SET expires_at = ? WHERE token = ?').run(
      Date.now() - 1000,
      tokenResult!.token,
    );

    const result = await resetPasswordWithToken(tokenResult!.token, 'NewExpired1!');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    // Original password still works (reset did not apply)
    const stillValid = await verifyClientPassword(email, seeded.workspaceId, 'ExpiredTok1!');
    expect(stillValid).not.toBeNull();

    deleteClientUser(created.id);
  });
});

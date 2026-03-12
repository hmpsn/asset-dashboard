/**
 * Unit tests for server/users.ts — user CRUD, password hashing, verification.
 */
import { describe, it, expect, afterAll } from 'vitest';
import {
  createUser,
  getUserById,
  getUserByEmail,
  getSafeUser,
  listUsers,
  updateUser,
  changePassword,
  deleteUser,
  recordLogin,
  verifyPassword,
  userCount,
} from '../../server/users.js';

// Track users we create so we can clean up
const createdUserIds: string[] = [];

afterAll(() => {
  for (const id of createdUserIds) {
    try { deleteUser(id); } catch { /* skip */ }
  }
});

// ── createUser ──

describe('createUser', () => {
  it('creates a user with correct fields', async () => {
    const user = await createUser('test-create@example.com', 'password123', 'Test User');
    createdUserIds.push(user.id);

    expect(user.id).toMatch(/^usr_/);
    expect(user.email).toBe('test-create@example.com');
    expect(user.name).toBe('Test User');
    expect(user.role).toBe('member'); // default role
    expect(user.workspaceIds).toEqual([]);
    expect(user.createdAt).toBeDefined();
    expect(user.updatedAt).toBeDefined();
    // SafeUser should NOT have passwordHash
    expect('passwordHash' in user).toBe(false);
  });

  it('normalizes email to lowercase and trims name', async () => {
    const user = await createUser('  UPPER@EXAMPLE.COM  ', 'pass123', '  Trimmed Name  ');
    createdUserIds.push(user.id);

    expect(user.email).toBe('upper@example.com');
    expect(user.name).toBe('Trimmed Name');
  });

  it('throws on duplicate email', async () => {
    const user = await createUser('dup-test@example.com', 'pass123', 'Dup User');
    createdUserIds.push(user.id);

    await expect(
      createUser('DUP-TEST@example.com', 'pass456', 'Another User')
    ).rejects.toThrow('A user with this email already exists');
  });

  it('respects custom role and workspaceIds', async () => {
    const user = await createUser('admin-test@example.com', 'pass123', 'Admin', 'admin', ['ws_1', 'ws_2']);
    createdUserIds.push(user.id);

    expect(user.role).toBe('admin');
    expect(user.workspaceIds).toEqual(['ws_1', 'ws_2']);
  });
});

// ── Read operations ──

describe('getUserById / getUserByEmail / getSafeUser', () => {
  let userId: string;

  it('getUserById returns full user (with passwordHash)', async () => {
    const created = await createUser('getbyid@example.com', 'pass123', 'GetById');
    createdUserIds.push(created.id);
    userId = created.id;

    const user = getUserById(userId);
    expect(user).not.toBeNull();
    expect(user!.email).toBe('getbyid@example.com');
    expect(user!.passwordHash).toBeDefined();
  });

  it('getUserById returns null for non-existent id', () => {
    expect(getUserById('usr_nonexistent_999')).toBeNull();
  });

  it('getUserByEmail is case-insensitive', () => {
    const user = getUserByEmail('GETBYID@EXAMPLE.COM');
    expect(user).not.toBeNull();
    expect(user!.email).toBe('getbyid@example.com');
  });

  it('getUserByEmail returns null for non-existent email', () => {
    expect(getUserByEmail('nonexistent@example.com')).toBeNull();
  });

  it('getSafeUser strips passwordHash', () => {
    const safe = getSafeUser(userId);
    expect(safe).not.toBeNull();
    expect('passwordHash' in safe!).toBe(false);
  });

  it('getSafeUser returns null for non-existent id', () => {
    expect(getSafeUser('usr_nonexistent_999')).toBeNull();
  });
});

// ── listUsers ──

describe('listUsers', () => {
  it('returns an array of SafeUser objects', () => {
    const users = listUsers();
    expect(Array.isArray(users)).toBe(true);
    for (const u of users) {
      expect('passwordHash' in u).toBe(false);
    }
  });
});

// ── updateUser ──

describe('updateUser', () => {
  it('updates name and role', async () => {
    const user = await createUser('update-user@example.com', 'pass123', 'Original');
    createdUserIds.push(user.id);

    const updated = await updateUser(user.id, { name: 'Updated', role: 'admin' });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('Updated');
    expect(updated!.role).toBe('admin');
  });

  it('returns null for non-existent id', async () => {
    expect(await updateUser('usr_nonexistent_999', { name: 'Nope' })).toBeNull();
  });

  it('throws on duplicate email when updating', async () => {
    const u1 = await createUser('update-dup-a@example.com', 'pass123', 'User A');
    const u2 = await createUser('update-dup-b@example.com', 'pass123', 'User B');
    createdUserIds.push(u1.id, u2.id);

    await expect(
      updateUser(u2.id, { email: 'UPDATE-DUP-A@example.com' })
    ).rejects.toThrow('A user with this email already exists');
  });
});

// ── changePassword ──

describe('changePassword', () => {
  it('changes the password successfully', async () => {
    const user = await createUser('change-pw@example.com', 'oldpass123', 'PW User');
    createdUserIds.push(user.id);

    const changed = await changePassword(user.id, 'newpass456');
    expect(changed).toBe(true);

    // Verify new password works
    const verified = await verifyPassword('change-pw@example.com', 'newpass456');
    expect(verified).not.toBeNull();

    // Verify old password no longer works
    const oldVerified = await verifyPassword('change-pw@example.com', 'oldpass123');
    expect(oldVerified).toBeNull();
  });

  it('returns false for non-existent user', async () => {
    expect(await changePassword('usr_nonexistent_999', 'newpass')).toBe(false);
  });
});

// ── verifyPassword ──

describe('verifyPassword', () => {
  it('returns user for correct password', async () => {
    const created = await createUser('verify-pw@example.com', 'correctpass', 'Verify User');
    createdUserIds.push(created.id);

    const user = await verifyPassword('verify-pw@example.com', 'correctpass');
    expect(user).not.toBeNull();
    expect(user!.id).toBe(created.id);
  });

  it('returns null for incorrect password', async () => {
    expect(await verifyPassword('verify-pw@example.com', 'wrongpass')).toBeNull();
  });

  it('returns null for non-existent email', async () => {
    expect(await verifyPassword('nonexistent-verify@example.com', 'pass')).toBeNull();
  });
});

// ── deleteUser ──

describe('deleteUser', () => {
  it('removes the user', async () => {
    const user = await createUser('delete-test@example.com', 'pass123', 'Delete Me');
    expect(deleteUser(user.id)).toBe(true);
    expect(getUserById(user.id)).toBeNull();
  });

  it('returns false for non-existent id', () => {
    expect(deleteUser('usr_nonexistent_999')).toBe(false);
  });
});

// ── recordLogin ──

describe('recordLogin', () => {
  it('updates lastLoginAt field', async () => {
    const user = await createUser('login-record@example.com', 'pass123', 'Login User');
    createdUserIds.push(user.id);

    recordLogin(user.id);
    const fetched = getUserById(user.id);
    expect(fetched!.lastLoginAt).toBeDefined();
  });
});

// ── userCount ──

describe('userCount', () => {
  it('returns a non-negative number', () => {
    expect(userCount()).toBeGreaterThanOrEqual(0);
  });
});

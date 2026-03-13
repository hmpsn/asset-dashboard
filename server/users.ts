/**
 * Internal User Accounts — SQLite-persisted user model with bcrypt passwords.
 * Supports roles: 'owner' | 'admin' | 'member'
 */

import bcrypt from 'bcryptjs';
import db from './db/index.js';

export type { UserRole, InternalUser as User, SafeInternalUser as SafeUser } from '../shared/types/users.ts';
import type { UserRole, InternalUser as User, SafeInternalUser as SafeUser } from '../shared/types/users.ts';

const SALT_ROUNDS = 12;

// --- SQLite row shape ---

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: string;
  workspace_ids: string;
  avatar_url: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
    role: row.role as UserRole,
    workspaceIds: JSON.parse(row.workspace_ids),
    avatarUrl: row.avatar_url ?? undefined,
    lastLoginAt: row.last_login_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- Prepared statements (lazily initialized after migrations run) ---

interface Stmts {
  selectAll: ReturnType<typeof db.prepare>;
  selectById: ReturnType<typeof db.prepare>;
  selectByEmail: ReturnType<typeof db.prepare>;
  insert: ReturnType<typeof db.prepare>;
  update: ReturnType<typeof db.prepare>;
  deleteById: ReturnType<typeof db.prepare>;
  count: ReturnType<typeof db.prepare>;
}

let _stmts: Stmts | null = null;

function stmts(): Stmts {
  if (!_stmts) {
    _stmts = {
      selectAll: db.prepare('SELECT * FROM users'),
      selectById: db.prepare('SELECT * FROM users WHERE id = ?'),
      selectByEmail: db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)'),
      insert: db.prepare(`
        INSERT INTO users (id, email, name, password_hash, role, workspace_ids,
          avatar_url, last_login_at, created_at, updated_at)
        VALUES (@id, @email, @name, @password_hash, @role, @workspace_ids,
          @avatar_url, @last_login_at, @created_at, @updated_at)
      `),
      update: db.prepare(`
        UPDATE users SET email = @email, name = @name, password_hash = @password_hash,
          role = @role, workspace_ids = @workspace_ids, avatar_url = @avatar_url,
          last_login_at = @last_login_at, updated_at = @updated_at
        WHERE id = @id
      `),
      deleteById: db.prepare('DELETE FROM users WHERE id = ?'),
      count: db.prepare('SELECT COUNT(*) as count FROM users'),
    };
  }
  return _stmts;
}

// ── CRUD ──

export function listUsers(): SafeUser[] {
  const rows = stmts().selectAll.all() as UserRow[];
  return rows.map(r => stripPassword(rowToUser(r)));
}

export function getUserById(id: string): User | null {
  const row = stmts().selectById.get(id) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

export function getUserByEmail(email: string): User | null {
  const row = stmts().selectByEmail.get(email) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

export function getSafeUser(id: string): SafeUser | null {
  const u = getUserById(id);
  return u ? stripPassword(u) : null;
}

export async function createUser(
  email: string,
  password: string,
  name: string,
  role: UserRole = 'member',
  workspaceIds: string[] = [],
): Promise<SafeUser> {
  // Duplicate check
  if (getUserByEmail(email)) {
    throw new Error('A user with this email already exists');
  }

  const now = new Date().toISOString();
  const user: User = {
    id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    email: email.toLowerCase().trim(),
    name: name.trim(),
    passwordHash: await bcrypt.hash(password, SALT_ROUNDS),
    role,
    workspaceIds,
    createdAt: now,
    updatedAt: now,
  };

  stmts().insert.run({
    id: user.id,
    email: user.email,
    name: user.name,
    password_hash: user.passwordHash,
    role: user.role,
    workspace_ids: JSON.stringify(user.workspaceIds),
    avatar_url: user.avatarUrl ?? null,
    last_login_at: user.lastLoginAt ?? null,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
  });

  return stripPassword(user);
}

export async function updateUser(
  id: string,
  updates: Partial<Pick<User, 'name' | 'email' | 'role' | 'workspaceIds' | 'avatarUrl'>>,
): Promise<SafeUser | null> {
  const existing = getUserById(id);
  if (!existing) return null;

  // If updating email, check for duplicates
  if (updates.email && updates.email.toLowerCase() !== existing.email) {
    const dup = getUserByEmail(updates.email);
    if (dup && dup.id !== id) {
      throw new Error('A user with this email already exists');
    }
    updates.email = updates.email.toLowerCase().trim();
  }

  const merged = { ...existing, ...updates, updatedAt: new Date().toISOString() };

  stmts().update.run({
    id: merged.id,
    email: merged.email,
    name: merged.name,
    password_hash: merged.passwordHash,
    role: merged.role,
    workspace_ids: JSON.stringify(merged.workspaceIds),
    avatar_url: merged.avatarUrl ?? null,
    last_login_at: merged.lastLoginAt ?? null,
    updated_at: merged.updatedAt,
  });

  return stripPassword(merged);
}

export async function changePassword(id: string, newPassword: string): Promise<boolean> {
  const existing = getUserById(id);
  if (!existing) return false;

  const merged = {
    ...existing,
    passwordHash: await bcrypt.hash(newPassword, SALT_ROUNDS),
    updatedAt: new Date().toISOString(),
  };

  stmts().update.run({
    id: merged.id,
    email: merged.email,
    name: merged.name,
    password_hash: merged.passwordHash,
    role: merged.role,
    workspace_ids: JSON.stringify(merged.workspaceIds),
    avatar_url: merged.avatarUrl ?? null,
    last_login_at: merged.lastLoginAt ?? null,
    updated_at: merged.updatedAt,
  });

  return true;
}

export function deleteUser(id: string): boolean {
  const info = stmts().deleteById.run(id);
  return info.changes > 0;
}

export function recordLogin(id: string): void {
  const existing = getUserById(id);
  if (!existing) return;

  const merged = { ...existing, lastLoginAt: new Date().toISOString() };

  stmts().update.run({
    id: merged.id,
    email: merged.email,
    name: merged.name,
    password_hash: merged.passwordHash,
    role: merged.role,
    workspace_ids: JSON.stringify(merged.workspaceIds),
    avatar_url: merged.avatarUrl ?? null,
    last_login_at: merged.lastLoginAt ?? null,
    updated_at: merged.updatedAt,
  });
}

// ── Auth ──

export async function verifyPassword(email: string, password: string): Promise<User | null> {
  const user = getUserByEmail(email);
  if (!user) return null;
  const valid = await bcrypt.compare(password, user.passwordHash);
  return valid ? user : null;
}

export function userCount(): number {
  const row = stmts().count.get() as { count: number };
  return row.count;
}

// ── Helpers ──

function stripPassword(u: User): SafeUser {
  const { passwordHash: _pw, ...safe } = u;
  void _pw;
  return safe;
}

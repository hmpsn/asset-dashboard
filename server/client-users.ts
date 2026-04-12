/**
 * Client User Accounts — individual logins for client dashboard access.
 * Separate from internal (admin) users. Each client user belongs to a workspace.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { JWT_SECRET } from './jwt-config.js';

export type { ClientRole, ClientUser, SafeClientUser } from '../shared/types/users.ts';
import type { ClientRole, ClientUser, SafeClientUser } from '../shared/types/users.ts';

const SALT_ROUNDS = 12;
const CLIENT_JWT_EXPIRES = '24h';

// --- SQLite row shapes ---

interface ClientUserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: string;
  workspace_id: string;
  avatar_url: string | null;
  invited_by: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ResetTokenRow {
  token: string;
  user_id: string;
  workspace_id: string;
  email: string;
  expires_at: number;
}

function rowToClientUser(row: ClientUserRow): ClientUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
    role: row.role as ClientRole,
    workspaceId: row.workspace_id,
    avatarUrl: row.avatar_url ?? undefined,
    invitedBy: row.invited_by ?? undefined,
    lastLoginAt: row.last_login_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- Prepared statements (lazily initialized after migrations run) ---

const stmts = createStmtCache(() => ({
  selectById: db.prepare('SELECT * FROM client_users WHERE id = ?'),
  selectByEmailWs: db.prepare('SELECT * FROM client_users WHERE LOWER(email) = LOWER(?) AND workspace_id = ?'),
  selectByWorkspace: db.prepare('SELECT * FROM client_users WHERE workspace_id = ?'),
  countByWorkspace: db.prepare('SELECT COUNT(*) as count FROM client_users WHERE workspace_id = ?'),
  existsByWorkspace: db.prepare('SELECT 1 FROM client_users WHERE workspace_id = ? LIMIT 1'),
  insert: db.prepare(`
        INSERT INTO client_users (id, email, name, password_hash, role, workspace_id,
          avatar_url, invited_by, last_login_at, created_at, updated_at)
        VALUES (@id, @email, @name, @password_hash, @role, @workspace_id,
          @avatar_url, @invited_by, @last_login_at, @created_at, @updated_at)
      `),
  update: db.prepare(`
        UPDATE client_users SET email = @email, name = @name, password_hash = @password_hash,
          role = @role, avatar_url = @avatar_url, last_login_at = @last_login_at,
          updated_at = @updated_at
        WHERE id = @id AND workspace_id = @workspace_id
      `),
  deleteById: db.prepare('DELETE FROM client_users WHERE id = ? AND workspace_id = ?'),
  selectToken: db.prepare('SELECT * FROM reset_tokens WHERE token = ?'),
  insertToken: db.prepare(`
        INSERT INTO reset_tokens (token, user_id, workspace_id, email, expires_at)
        VALUES (@token, @user_id, @workspace_id, @email, @expires_at)
      `),
  // reset_tokens.token is crypto.randomBytes(32).toString('hex') (256-bit entropy);
  // globally unique by construction, so single-row delete by token cannot collide.
  // ws-scope-ok
  deleteToken: db.prepare('DELETE FROM reset_tokens WHERE token = ?'),
  deleteTokensByUserWs: db.prepare('DELETE FROM reset_tokens WHERE user_id = ? AND workspace_id = ?'),
  // Global retention sweep: prune expired reset_tokens across all workspaces.
  // ws-scope-ok
  deleteExpiredTokens: db.prepare('DELETE FROM reset_tokens WHERE expires_at <= ?'),
}));

// ── CRUD ──

export function listClientUsers(workspaceId: string): SafeClientUser[] {
  const rows = stmts().selectByWorkspace.all(workspaceId) as ClientUserRow[];
  return rows.map(r => stripPassword(rowToClientUser(r)));
}

export function getClientUserById(id: string): ClientUser | null {
  const row = stmts().selectById.get(id) as ClientUserRow | undefined;
  return row ? rowToClientUser(row) : null;
}

export function getClientUserByEmail(email: string, workspaceId: string): ClientUser | null {
  const row = stmts().selectByEmailWs.get(email, workspaceId) as ClientUserRow | undefined;
  return row ? rowToClientUser(row) : null;
}

export function getSafeClientUser(id: string): SafeClientUser | null {
  const u = getClientUserById(id);
  return u ? stripPassword(u) : null;
}

export async function createClientUser(
  email: string,
  password: string,
  name: string,
  workspaceId: string,
  role: ClientRole = 'client_member',
  invitedBy?: string,
): Promise<SafeClientUser> {
  // Duplicate check within the same workspace
  if (getClientUserByEmail(email, workspaceId)) {
    throw new Error('A client with this email already exists in this workspace');
  }

  const now = new Date().toISOString();
  const user: ClientUser = {
    id: `cu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    email: email.toLowerCase().trim(),
    name: name.trim(),
    passwordHash: await bcrypt.hash(password, SALT_ROUNDS),
    role,
    workspaceId,
    invitedBy,
    createdAt: now,
    updatedAt: now,
  };

  stmts().insert.run({
    id: user.id,
    email: user.email,
    name: user.name,
    password_hash: user.passwordHash,
    role: user.role,
    workspace_id: user.workspaceId,
    avatar_url: user.avatarUrl ?? null,
    invited_by: user.invitedBy ?? null,
    last_login_at: user.lastLoginAt ?? null,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
  });

  return stripPassword(user);
}

/**
 * Cross-workspace authorization guard. Every admin-mutating function below
 * takes an `expectedWorkspaceId` and enforces that the target user actually
 * belongs to that workspace. Without this guard, an admin authenticated for
 * workspace A could call `PATCH/DELETE/password-change` on a user from
 * workspace B simply by knowing the UUID (the route handler only verifies
 * the caller's access to the `:id` workspace, not that `:userId` belongs
 * to it). Returns `null` (not `false`) so callers can't distinguish
 * "doesn't exist" from "belongs to another workspace" — avoiding a
 * workspace-enumeration oracle.
 */
function assertUserInWorkspace(id: string, expectedWorkspaceId: string): ClientUser | null {
  const existing = getClientUserById(id);
  if (!existing) return null;
  if (existing.workspaceId !== expectedWorkspaceId) return null;
  return existing;
}

export async function updateClientUser(
  id: string,
  expectedWorkspaceId: string,
  updates: Partial<Pick<ClientUser, 'name' | 'email' | 'role' | 'avatarUrl'>>,
): Promise<SafeClientUser | null> {
  const existing = assertUserInWorkspace(id, expectedWorkspaceId);
  if (!existing) return null;

  if (updates.email && updates.email.toLowerCase() !== existing.email) {
    const dup = getClientUserByEmail(updates.email, existing.workspaceId);
    if (dup && dup.id !== id) {
      throw new Error('A client with this email already exists in this workspace');
    }
    updates.email = updates.email.toLowerCase().trim();
  }

  const merged = { ...existing, ...updates, updatedAt: new Date().toISOString() };

  stmts().update.run({
    id: merged.id,
    workspace_id: merged.workspaceId,
    email: merged.email,
    name: merged.name,
    password_hash: merged.passwordHash,
    role: merged.role,
    avatar_url: merged.avatarUrl ?? null,
    last_login_at: merged.lastLoginAt ?? null,
    updated_at: merged.updatedAt,
  });

  return stripPassword(merged);
}

export async function changeClientPassword(id: string, expectedWorkspaceId: string, newPassword: string): Promise<boolean> {
  const existing = assertUserInWorkspace(id, expectedWorkspaceId);
  if (!existing) return false;

  const merged = {
    ...existing,
    passwordHash: await bcrypt.hash(newPassword, SALT_ROUNDS),
    updatedAt: new Date().toISOString(),
  };

  stmts().update.run({
    id: merged.id,
    workspace_id: merged.workspaceId,
    email: merged.email,
    name: merged.name,
    password_hash: merged.passwordHash,
    role: merged.role,
    avatar_url: merged.avatarUrl ?? null,
    last_login_at: merged.lastLoginAt ?? null,
    updated_at: merged.updatedAt,
  });

  return true;
}

export function deleteClientUser(id: string, expectedWorkspaceId: string): boolean {
  const existing = assertUserInWorkspace(id, expectedWorkspaceId);
  if (!existing) return false;
  const info = stmts().deleteById.run(id, existing.workspaceId);
  return info.changes > 0;
}

export function recordClientLogin(id: string): void {
  const existing = getClientUserById(id);
  if (!existing) return;

  const merged = { ...existing, lastLoginAt: new Date().toISOString() };

  stmts().update.run({
    id: merged.id,
    workspace_id: merged.workspaceId,
    email: merged.email,
    name: merged.name,
    password_hash: merged.passwordHash,
    role: merged.role,
    avatar_url: merged.avatarUrl ?? null,
    last_login_at: merged.lastLoginAt ?? null,
    updated_at: merged.updatedAt,
  });
}

// ── Auth ──

export async function verifyClientPassword(email: string, workspaceId: string, password: string): Promise<ClientUser | null> {
  const user = getClientUserByEmail(email, workspaceId);
  if (!user) return null;
  const valid = await bcrypt.compare(password, user.passwordHash);
  return valid ? user : null;
}

export function signClientToken(user: SafeClientUser): string {
  return jwt.sign(
    { clientUserId: user.id, email: user.email, role: user.role, workspaceId: user.workspaceId },
    JWT_SECRET,
    { expiresIn: CLIENT_JWT_EXPIRES },
  );
}

export interface ClientJwtPayload {
  clientUserId: string;
  email: string;
  role: string;
  workspaceId: string;
}

export function verifyClientToken(token: string): ClientJwtPayload | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as ClientJwtPayload;
    // Must have clientUserId to distinguish from internal user tokens
    if (!payload.clientUserId) return null;
    return payload;
  } catch {
    return null;
  }
}

export function clientUserCount(workspaceId: string): number {
  const row = stmts().countByWorkspace.get(workspaceId) as { count: number };
  return row.count;
}

export function hasClientUsers(workspaceId: string): boolean {
  return stmts().existsByWorkspace.get(workspaceId) != null;
}

// ── Password Reset ──

export function createResetToken(email: string, workspaceId: string): { token: string; user: SafeClientUser } | null {
  const user = getClientUserByEmail(email, workspaceId);
  if (!user) return null;

  const token = crypto.randomBytes(32).toString('hex');

  // Prune expired tokens
  stmts().deleteExpiredTokens.run(Date.now());
  // Remove any existing tokens for this user in this workspace
  stmts().deleteTokensByUserWs.run(user.id, workspaceId);

  stmts().insertToken.run({
    token,
    user_id: user.id,
    workspace_id: workspaceId,
    email: user.email,
    expires_at: Date.now() + 60 * 60 * 1000, // 1 hour
  });

  return { token, user: stripPassword(user) };
}

export async function resetPasswordWithToken(token: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
  const row = stmts().selectToken.get(token) as ResetTokenRow | undefined;
  if (!row) return { success: false, error: 'Invalid or expired reset link' };

  if (row.expires_at < Date.now()) {
    stmts().deleteToken.run(token);
    return { success: false, error: 'Reset link has expired. Please request a new one.' };
  }

  if (newPassword.length < 8) return { success: false, error: 'Password must be at least 8 characters' };

  // The reset token row carries the workspace_id it was created against
  // (see `createResetToken` — that's `getClientUserByEmail(email, workspaceId)`
  // scoped), so `row.workspace_id` IS the authoritative expected workspace
  // for `row.user_id`. No separate lookup needed.
  const changed = await changeClientPassword(row.user_id, row.workspace_id, newPassword);
  if (!changed) return { success: false, error: 'User not found' };

  // Remove used token
  stmts().deleteToken.run(token);
  return { success: true };
}

// ── Helpers ──

function stripPassword(u: ClientUser): SafeClientUser {
  const { passwordHash: _pw, ...safe } = u;
  void _pw;
  return safe;
}

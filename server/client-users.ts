/**
 * Client User Accounts — individual logins for client dashboard access.
 * Separate from internal (admin) users. Each client user belongs to a workspace.
 */

import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getDataDir } from './data-dir.js';

export type ClientRole = 'client_owner' | 'client_member';

export interface ClientUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: ClientRole;
  workspaceId: string;
  avatarUrl?: string;
  invitedBy?: string;          // internal user ID who invited this client
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type SafeClientUser = Omit<ClientUser, 'passwordHash'>;

const SALT_ROUNDS = 12;
const JWT_SECRET = process.env.JWT_SECRET || 'hmpsn-studio-dev-secret-change-in-prod';
const CLIENT_JWT_EXPIRES = '24h';

function usersFile(): string {
  return path.join(getDataDir('auth'), 'client-users.json');
}

function readUsers(): ClientUser[] {
  const fp = usersFile();
  try {
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch { /* corrupt file */ }
  return [];
}

function writeUsers(users: ClientUser[]): void {
  const dir = path.dirname(usersFile());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(usersFile(), JSON.stringify(users, null, 2));
}

// ── CRUD ──

export function listClientUsers(workspaceId: string): SafeClientUser[] {
  return readUsers()
    .filter(u => u.workspaceId === workspaceId)
    .map(stripPassword);
}

export function getClientUserById(id: string): ClientUser | null {
  return readUsers().find(u => u.id === id) || null;
}

export function getClientUserByEmail(email: string, workspaceId: string): ClientUser | null {
  return readUsers().find(
    u => u.email.toLowerCase() === email.toLowerCase() && u.workspaceId === workspaceId
  ) || null;
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
  const users = readUsers();

  // Duplicate check within the same workspace
  if (users.some(u => u.email.toLowerCase() === email.toLowerCase() && u.workspaceId === workspaceId)) {
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

  users.push(user);
  writeUsers(users);
  return stripPassword(user);
}

export async function updateClientUser(
  id: string,
  updates: Partial<Pick<ClientUser, 'name' | 'email' | 'role' | 'avatarUrl'>>,
): Promise<SafeClientUser | null> {
  const users = readUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return null;

  if (updates.email && updates.email.toLowerCase() !== users[idx].email) {
    if (users.some(u => u.id !== id && u.email.toLowerCase() === updates.email!.toLowerCase() && u.workspaceId === users[idx].workspaceId)) {
      throw new Error('A client with this email already exists in this workspace');
    }
    updates.email = updates.email.toLowerCase().trim();
  }

  Object.assign(users[idx], updates, { updatedAt: new Date().toISOString() });
  writeUsers(users);
  return stripPassword(users[idx]);
}

export async function changeClientPassword(id: string, newPassword: string): Promise<boolean> {
  const users = readUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return false;
  users[idx].passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  users[idx].updatedAt = new Date().toISOString();
  writeUsers(users);
  return true;
}

export function deleteClientUser(id: string): boolean {
  const users = readUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return false;
  users.splice(idx, 1);
  writeUsers(users);
  return true;
}

export function recordClientLogin(id: string): void {
  const users = readUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return;
  users[idx].lastLoginAt = new Date().toISOString();
  writeUsers(users);
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
  return readUsers().filter(u => u.workspaceId === workspaceId).length;
}

export function hasClientUsers(workspaceId: string): boolean {
  return readUsers().some(u => u.workspaceId === workspaceId);
}

// ── Helpers ──

function stripPassword(u: ClientUser): SafeClientUser {
  const { passwordHash: _pw, ...safe } = u;
  void _pw;
  return safe;
}

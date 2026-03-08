/**
 * Internal User Accounts — JSON-file persisted user model with bcrypt passwords.
 * Supports roles: 'owner' | 'admin' | 'member'
 */

import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { getDataDir } from './data-dir.js';

export type UserRole = 'owner' | 'admin' | 'member';

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  workspaceIds: string[];       // workspaces this user can access
  avatarUrl?: string;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type SafeUser = Omit<User, 'passwordHash'>;

const SALT_ROUNDS = 12;

function usersFile(): string {
  return path.join(getDataDir('auth'), 'users.json');
}

function readUsers(): User[] {
  const fp = usersFile();
  try {
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch { /* corrupt file */ }
  return [];
}

function writeUsers(users: User[]): void {
  const dir = path.dirname(usersFile());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(usersFile(), JSON.stringify(users, null, 2));
}

// ── CRUD ──

export function listUsers(): SafeUser[] {
  return readUsers().map(stripPassword);
}

export function getUserById(id: string): User | null {
  return readUsers().find(u => u.id === id) || null;
}

export function getUserByEmail(email: string): User | null {
  return readUsers().find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
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
  const users = readUsers();

  // Duplicate check
  if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
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

  users.push(user);
  writeUsers(users);
  return stripPassword(user);
}

export async function updateUser(
  id: string,
  updates: Partial<Pick<User, 'name' | 'email' | 'role' | 'workspaceIds' | 'avatarUrl'>>,
): Promise<SafeUser | null> {
  const users = readUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return null;

  // If updating email, check for duplicates
  if (updates.email && updates.email.toLowerCase() !== users[idx].email) {
    if (users.some(u => u.id !== id && u.email.toLowerCase() === updates.email!.toLowerCase())) {
      throw new Error('A user with this email already exists');
    }
    updates.email = updates.email.toLowerCase().trim();
  }

  Object.assign(users[idx], updates, { updatedAt: new Date().toISOString() });
  writeUsers(users);
  return stripPassword(users[idx]);
}

export async function changePassword(id: string, newPassword: string): Promise<boolean> {
  const users = readUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return false;

  users[idx].passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  users[idx].updatedAt = new Date().toISOString();
  writeUsers(users);
  return true;
}

export function deleteUser(id: string): boolean {
  const users = readUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return false;
  users.splice(idx, 1);
  writeUsers(users);
  return true;
}

export function recordLogin(id: string): void {
  const users = readUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return;
  users[idx].lastLoginAt = new Date().toISOString();
  writeUsers(users);
}

// ── Auth ──

export async function verifyPassword(email: string, password: string): Promise<User | null> {
  const user = getUserByEmail(email);
  if (!user) return null;
  const valid = await bcrypt.compare(password, user.passwordHash);
  return valid ? user : null;
}

export function userCount(): number {
  return readUsers().length;
}

// ── Helpers ──

function stripPassword(u: User): SafeUser {
  const { passwordHash: _pw, ...safe } = u;
  void _pw;
  return safe;
}

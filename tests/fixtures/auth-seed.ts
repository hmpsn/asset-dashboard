// tests/fixtures/auth-seed.ts
// Shared auth fixture for integration tests.
// Creates admin + client users with JWT tokens for authenticated request testing.

import { randomUUID } from 'crypto';
import db from '../../server/db/index.js';
import { createUser } from '../../server/users.js';
import { signToken } from '../../server/auth.js';
import { createClientUser, signClientToken } from '../../server/client-users.js';

export interface SeededAuth {
  workspaceId: string;
  adminUserId: string;
  clientUserId: string;
  adminToken: string;
  clientToken: string;
  cleanup: () => void;
}

/**
 * Creates a workspace, an admin user, and a client user with valid JWT tokens.
 * Async because user creation uses bcrypt for password hashing.
 */
export async function seedAuthData(): Promise<SeededAuth> {
  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `test-auth-${suffix}`;
  const now = new Date().toISOString();

  // Insert workspace
  db.prepare(`
    INSERT INTO workspaces (id, name, folder, tier, created_at)
    VALUES (?, ?, ?, 'free', ?)
  `).run(workspaceId, `Auth Test ${suffix}`, `auth-test-${suffix}`, now);

  // Create admin user via the users module (handles bcrypt hashing)
  const adminUser = await createUser(
    `admin-${suffix}@test.local`,
    'test-admin-password',
    `Test Admin ${suffix}`,
    'admin',
    [workspaceId],
  );

  // Create client user via the client-users module (handles bcrypt hashing)
  const clientUser = await createClientUser(
    `client-${suffix}@test.local`,
    'test-client-password',
    `Test Client ${suffix}`,
    workspaceId,
    'client_member',
  );

  // Generate JWT tokens
  const adminToken = signToken({
    userId: adminUser.id,
    email: adminUser.email,
    role: adminUser.role,
  });

  const clientToken = signClientToken(clientUser);

  const cleanup = () => {
    db.prepare('DELETE FROM client_users WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM users WHERE id = ?').run(adminUser.id);
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);
  };

  return {
    workspaceId,
    adminUserId: adminUser.id,
    clientUserId: clientUser.id,
    adminToken,
    clientToken,
    cleanup,
  };
}

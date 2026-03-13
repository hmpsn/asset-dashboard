// ── User domain types ───────────────────────────────────────────

// Client users (per-workspace)
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

// Internal users (platform-wide)
export type UserRole = 'owner' | 'admin' | 'member';

export interface InternalUser {
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

export type SafeInternalUser = Omit<InternalUser, 'passwordHash'>;

---
description: How the auth system works and how to extend it. Reference when building login UI, adding protected routes, or managing users.
---

# Auth System Reference

The platform has a dual auth system for backward compatibility. Both internal (admin) and client users are supported.

## Architecture

### Internal Users (`server/users.ts` + `server/auth.ts`)

| Item | Detail |
|------|--------|
| **Model** | `User { id, email, name, passwordHash, role, workspaceIds, lastLoginAt, createdAt, updatedAt }` |
| **Roles** | `owner` (full access, bypasses workspace checks), `admin` (manages assigned workspaces), `member` (read + execute in assigned workspaces) |
| **Storage** | `auth/users.json` via `getDataDir('auth')` |
| **Password** | bcrypt, 12 rounds |
| **Token** | JWT, 7-day expiry, signed with `JWT_SECRET` env or fallback |
| **Cookie** | `token` (httpOnly, sameSite: lax, secure in prod) |

### Client Users (`server/client-users.ts`)

| Item | Detail |
|------|--------|
| **Model** | `ClientUser { id, email, name, passwordHash, role, workspaceId, invitedBy, lastLoginAt, createdAt, updatedAt }` |
| **Roles** | `client_owner`, `client_member` |
| **Storage** | `auth/client-users.json` via `getDataDir('auth')` |
| **Password** | bcrypt, 12 rounds |
| **Token** | JWT, 24h expiry, contains `clientUserId` + `workspaceId` |
| **Cookie** | `client_user_token_<workspaceId>` (httpOnly, per-workspace) |

### Legacy Auth (still active)

| System | How it works |
|--------|-------------|
| **Admin (APP_PASSWORD)** | Shared password → HMAC token in `auth_token` cookie. Global middleware in `server/index.ts` checks this first. |
| **Client (shared password)** | Per-workspace `clientPassword` → HMAC session in `client_session_<wsId>` cookie. |

## Middleware Stack

Applied in this order:

1. **`optionalAuth`** (global) — Reads JWT from cookie/header, populates `req.user` if valid. Never rejects.
2. **Global admin gate** — If `APP_PASSWORD` is set, checks `APP_PASSWORD` OR HMAC token OR JWT. Allows auth endpoints through.
3. **`requireAuth`** — Rejects 401 if `req.user` is not set. Use on routes that need a logged-in internal user.
4. **`requireRole(...roles)`** — Rejects 403 if `req.user.role` not in allowed roles. Use after `requireAuth`.
5. **`requireWorkspaceAccess(paramName)`** — Checks `req.user.workspaceIds` includes the route param. Owners bypass. Passes through if no `req.user` (legacy compat). Use on workspace-specific routes.

### How to protect a new admin route

```typescript
// Requires any logged-in internal user
app.get('/api/my-route', requireAuth, (req, res) => { ... });

// Requires admin or owner role
app.post('/api/my-route', requireAuth, requireRole('admin', 'owner'), (req, res) => { ... });

// Requires workspace access
app.get('/api/workspaces/:id/my-data', requireWorkspaceAccess(), (req, res) => { ... });
```

### How client session enforcement works

The `/api/public/*` middleware in `server/index.ts` checks (in order):
1. Is the route an auth endpoint? (`auth`, `client-login`, `client-me`, `auth-mode`, `workspace`) → pass through
2. Does the workspace have `clientPassword` set? If not → pass through (open access)
3. Is there a valid `client_session_<wsId>` cookie? (legacy shared password) → pass through
4. Is there a valid `client_user_token_<wsId>` cookie? (client user JWT) → pass through
5. Otherwise → 401

## API Endpoints

### Internal Auth
| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/auth/setup` | POST | none | Create first owner account |
| `/api/auth/setup-status` | GET | none | Check if setup needed |
| `/api/auth/user-login` | POST | none | Email + password login |
| `/api/auth/user-logout` | POST | any | Clear JWT cookie |
| `/api/auth/me` | GET | JWT | Current user profile |

### Internal User Management
| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/users` | GET | admin+ | List all users |
| `/api/users` | POST | admin+ | Create user |
| `/api/users/:id` | GET | admin+ | Get user |
| `/api/users/:id` | PATCH | admin+ | Update user |
| `/api/users/:id/password` | POST | self or admin | Change password |
| `/api/users/:id` | DELETE | owner | Delete user |

### Client Auth (public)
| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/public/client-login/:id` | POST | none | Client email + password login |
| `/api/public/client-me/:id` | GET | cookie | Get current client user |
| `/api/public/client-logout/:id` | POST | any | Clear client cookies |
| `/api/public/auth-mode/:id` | GET | none | Check shared password vs individual accounts |

### Client User Management (admin)
| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/workspaces/:id/client-users` | GET | workspace | List client users |
| `/api/workspaces/:id/client-users` | POST | workspace | Create/invite client user |
| `/api/workspaces/:id/client-users/:userId` | PATCH | workspace | Update client user |
| `/api/workspaces/:id/client-users/:userId/password` | POST | workspace | Change password |
| `/api/workspaces/:id/client-users/:userId` | DELETE | workspace | Remove client user |

## Common Tasks

### Adding a new internal role
1. Add to `UserRole` type in `server/users.ts`
2. Update `requireRole` usage where the new role should have access
3. Update role validation in the create/update user endpoints in `server/index.ts`

### Building the frontend login UI
1. Call `GET /api/auth/setup-status` — if `{ needsSetup: true }`, show setup form
2. Setup: `POST /api/auth/setup` with `{ email, password, name }`
3. Login: `POST /api/auth/user-login` with `{ email, password }` — sets cookie automatically
4. Check auth: `GET /api/auth/me` — returns `{ user }` or 401
5. Store user in React context (`useCurrentUser()` hook)
6. Logout: `POST /api/auth/user-logout`

### Building the client login UI
1. Call `GET /api/public/auth-mode/:workspaceId` to check auth mode
2. If `hasClientUsers: true`, show email + password form
3. Login: `POST /api/public/client-login/:workspaceId` with `{ email, password }`
4. Check auth: `GET /api/public/client-me/:workspaceId`
5. If `hasSharedPassword: true` and no client users, fall back to existing shared password UI
6. Support both modes simultaneously during migration

### Wiring user identity into activity logs
1. Check `req.user` in the endpoint handler
2. Pass `userId` and `userName` to `addActivity()` as metadata
3. Update `addActivity` signature to accept optional `userId`/`userName`
4. Display attributed names in activity feed UI

## Next Steps (from AUTH_ROADMAP.md)

- **Frontend login UI** — Admin login screen, user context provider, route protection
- **Frontend client login** — Client email login, team management section
- **Phase 3**: Internal team management UI (invite flow, user list, workspace assignments)
- **Phase 5**: Permission-based feature access (client_member restrictions, admin role limits)
- **Phase 6**: Notification preferences (per-user email settings, digest frequency)

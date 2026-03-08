# Authentication & Authorization Roadmap

A comprehensive plan for adding user accounts, roles, and team management to the platform — covering both the internal (admin) side and the client-facing portal.

---

## Current State

### What exists today

| Layer | Mechanism | Limitations |
|-------|-----------|-------------|
| **Admin auth** | Single shared password (`APP_PASSWORD` env var) → HMAC token cookie (30-day expiry) | No individual accounts. Anyone with the password has full access to everything. No audit trail of *who* did what. |
| **Client auth** | Per-workspace password (`clientPassword`) → HMAC session cookie (24-hour expiry) | Shared password for all client team members. No way to know *who* logged in. Can't revoke access for one person without changing the password for everyone. |
| **Google OAuth** | OAuth2 flow for GSC/GA4 API tokens, stored per-site | Only used for Google API access — not for user identity. |
| **Activity log** | Logs all major operations with timestamps | No user attribution — logs say *what* happened, never *who* did it. |
| **Client requests** | `submittedBy` is a freeform text field | Client types their name manually each time. No verification. |
| **Approval workflow** | `author: 'client' | 'team'` on comments/notes | No individual identity — just "client" or "team". |
| **Email notifications** | Single `clientEmail` per workspace | Only one person gets notified. No way to notify specific team members. |

### Key pain points

1. **No accountability** — Can't tell who approved a change, submitted a request, or made an edit.
2. **No access control** — Every admin sees every workspace. Every client sees everything in their portal.
3. **No team management** — Adding/removing people means sharing or changing a password.
4. **No user preferences** — No saved settings, notification preferences, or personalized views.
5. **Password sharing is insecure** — One leaked password exposes the entire admin or client portal.

---

## Proposed Architecture

### User Model

```
User {
  id: string               // uuid
  email: string            // primary identifier, unique
  name: string
  passwordHash: string     // bcrypt
  role: 'superadmin' | 'admin' | 'member' | 'client_admin' | 'client_member'
  workspaceAccess: [{
    workspaceId: string
    role: 'owner' | 'editor' | 'viewer'
  }]
  lastLoginAt: string
  createdAt: string
  invitedBy?: string       // userId of who invited them
  status: 'active' | 'invited' | 'disabled'
}
```

### Role Definitions

#### Internal (Admin Side)

| Role | Description | Access |
|------|-------------|--------|
| **Superadmin** | You (Joshua). Full platform control. | Everything. Create/delete workspaces, manage all users, all tools, global settings. |
| **Admin** | Senior team member | All workspaces assigned to them. All tools within those workspaces. Can invite client users. Cannot manage internal team or global settings. |
| **Member** | Junior team member / contractor | Assigned workspaces only. Read + execute tools (run audits, generate briefs). Cannot change workspace settings or manage users. |

#### Client Side

| Role | Description | Access |
|------|-------------|--------|
| **Client Admin** | Primary client contact | Full client portal for their workspace. Can add/remove client team members. Approvals, requests, content, analytics. Manages notification preferences. |
| **Client Member** | Client team member | View-only on analytics/search/health. Can review approvals, submit requests, and leave comments. Cannot add/remove team members. Cannot approve content or changes (view only on approvals unless granted). |

---

## Implementation Phases

### ~~Phase 1: Internal User Accounts~~ ✅ SHIPPED
**Shipped: March 7, 2026**

#### What was built
- [x] `server/users.ts` — User model (id, email, name, passwordHash, role, workspaceIds), bcrypt (12 rounds), CRUD, JSON persistence in `auth/users.json`
- [x] `server/auth.ts` — JWT sign/verify (7-day expiry), `requireAuth`, `requireRole`, `optionalAuth` middleware, Express Request augmentation
- [x] `POST /api/auth/setup` — first user creation (becomes owner with all workspaces)
- [x] `GET /api/auth/setup-status` — detect first-run
- [x] `POST /api/auth/user-login` — email + password → JWT + httpOnly cookie
- [x] `GET /api/auth/me` — current authenticated user
- [x] `POST /api/auth/user-logout` — clear JWT cookie
- [x] `GET/POST /api/users` — list/create users (admin+)
- [x] `GET/PATCH /api/users/:id` — get/update user (admin+)
- [x] `POST /api/users/:id/password` — change password (self or admin)
- [x] `DELETE /api/users/:id` — delete user (owner only)
- [x] Global admin middleware accepts both legacy `APP_PASSWORD` and JWT tokens
- [x] Roles: owner, admin, member

#### Still TODO (frontend)
- [ ] Login screen with email/password (replaces single password field)
- [ ] User context provider — `useCurrentUser()` hook
- [ ] Display current user name in sidebar/header
- [ ] Protect routes by role
- [ ] Activity log enrichment (userId/userName on every entry)

---

### ~~Phase 2: Workspace Access Control~~ ✅ SHIPPED
**Shipped: March 7, 2026**

#### What was built
- [x] `requireWorkspaceAccess(paramName)` middleware in `server/auth.ts`
- [x] Checks `user.workspaceIds` against route param; owners bypass all checks
- [x] Applied to GET/PATCH/DELETE `/api/workspaces/:id`
- [x] Soft enforcement: passes through for legacy `APP_PASSWORD` auth, enforces for JWT users
- [x] `optionalAuth` runs globally to populate `req.user` from JWT

#### Still TODO (frontend)
- [ ] Sidebar only shows workspaces the user has access to
- [ ] Workspace settings restricted to `owner` role
- [ ] Visual indicator of role (e.g., "Editor" badge next to workspace name)

---

### Phase 3: Internal Team Management (Priority: MEDIUM)
**Estimated effort: 4-5 hours**

#### Backend
- [ ] `/api/admin/users` — CRUD for internal users (superadmin only)
- [ ] `/api/admin/users/:id/workspaces` — assign/remove workspace access
- [ ] Email invite flow: generate invite token → send email → user sets password
- [ ] Disable/re-enable accounts (soft delete, preserve activity history)

#### Frontend
- [ ] Team management page in global settings
- [ ] Invite form: email, name, role, workspace assignments
- [ ] User list with status badges (active, invited, disabled)
- [ ] Per-user workspace access editor

**Why this is medium:** You're the only admin today. This becomes critical when you hire or bring on contractors, but it's not blocking anything right now.

---

### ~~Phase 4: Client User Accounts~~ ✅ SHIPPED
**Shipped: March 7, 2026**

#### What was built
- [x] `server/client-users.ts` — separate model from internal users (client_owner/client_member roles)
- [x] Per-workspace email uniqueness, bcrypt (12 rounds), JWT (24h expiry)
- [x] `POST /api/public/client-login/:id` — email + password → JWT + legacy session cookie
- [x] `GET /api/public/client-me/:id` — current client user from token
- [x] `POST /api/public/client-logout/:id` — clear cookies
- [x] `GET /api/public/auth-mode/:id` — check shared password vs individual accounts
- [x] Admin CRUD: `GET/POST /api/workspaces/:id/client-users`, `PATCH/:userId`, `DELETE/:userId`, password change
- [x] Client session middleware updated to accept client user JWT alongside shared-password sessions
- [x] Public workspace info includes `hasClientUsers` flag
- [x] Backward compatibility: shared password still works as fallback

#### Still TODO (frontend)
- [ ] Client login page: email + password (replaces single password field)
- [ ] "Forgot password" flow
- [ ] Team management section for client_admin (invite, list, remove)
- [ ] User profile: name, email, notification preferences
- [ ] `submittedBy` auto-populated from logged-in user

---

### Phase 5: Permission-Based Feature Access (Priority: MEDIUM)
**Estimated effort: 3-4 hours**

#### Client member restrictions
- [ ] Approvals: `client_member` can view but not approve/reject (configurable by client_admin)
- [ ] Requests: all client users can submit and comment
- [ ] Content: view briefs, but only `client_admin` can confirm pricing/orders
- [ ] Analytics/Search/Health: all client users can view (read-only)
- [ ] Strategy: all can view; only `client_admin` can request content topics

#### Admin role restrictions
- [ ] `member` role: cannot delete workspaces, cannot change Google OAuth, cannot modify global settings
- [ ] `admin` role: full tool access within assigned workspaces
- [ ] Workspace settings lock for non-owner roles

**Why this is medium:** The broad strokes of access control (Phase 2 + Phase 4) handle 90% of use cases. Fine-grained permissions are a polish step.

---

### Phase 6: Notification Preferences (Priority: LOW)
**Estimated effort: 2-3 hours**

- [ ] Per-user email notification settings:
  - New request submitted (team)
  - Request status changed (client)
  - Approval ready for review (client)
  - Team response on request (client)
  - Audit score drop (team)
  - Content brief ready (client)
- [ ] In-app notification bell (unread count)
- [ ] Email digest frequency: instant, daily, weekly, off
- [ ] Replace single `clientEmail` with per-user notification routing

**Why this is low:** Current batched email system works fine for now. This is a UX improvement, not a blocker.

---

## How Auth Feeds Into Existing Features

This is where the real value multiplier lives. Every existing feature gets meaningfully better with user identity:

### HIGH impact integrations

| Feature | What changes | Grade |
|---------|-------------|:-----:|
| **Activity Log** | Every entry attributed to a named user. "Josh ran SEO audit" not "Audit ran." Filterable by user. | **A+** |
| **Client Requests** | `submittedBy` is a real user, not freeform text. Request history per user. Response notifications go to the right person. | **A+** |
| **Approval Workflow** | "Sarah (Marketing Director) approved" vs "Client approved." Audit trail for compliance. Only authorized roles can approve. | **A** |
| **Content Pipeline** | Who requested, who approved, who delivered. Full chain of custody. Client admin signs off on spending; team members can browse but not commit budget. | **A** |
| **Email Notifications** | Route to the right person. "New request from Sarah" → goes to assigned team member, not a generic inbox. | **A** |

### MEDIUM impact integrations

| Feature | What changes | Grade |
|---------|-------------|:-----:|
| **SEO Strategy** | Track who generated, who reviewed. Client admin can "lock" strategy from member edits. | **B+** |
| **AI Chat** | Conversation history per user. Personalized context ("You asked about mobile rankings last week"). | **B+** |
| **Search Console / Analytics** | No data change, but user identity enables saved views, bookmarked queries, personal dashboards later. | **B** |
| **Schema Generator** | Track who generated and who published each schema. "Published by Josh on March 5." | **B** |
| **Monthly Reports** | Auto-attribute: "Report prepared by Josh Hampson" in the header. | **B** |

### LOWER impact (future value)

| Feature | What changes | Grade |
|---------|-------------|:-----:|
| **Workspace Overview** | Filter by "my workspaces" vs "all." Personal task queue. | **C+** |
| **Asset Manager** | "Compressed by Josh" attribution on optimized images. | **C** |
| **Annotations** | "Added by Josh" on timeline markers. | **C** |
| **Sales Reports** | Attribution only — "Report by Josh" in prospect exports. | **C** |

---

## Suggestions & Priorities

### Do first (blocks everything)
1. **Phase 1: Internal user accounts** — Without this, no other phase works. Start here.
2. **Phase 4: Client user accounts** — The client-facing value is enormous. This is the feature that makes the platform feel "real" to clients.

### Do second (high ROI)
3. **Phase 2: Workspace access control** — Required before any team member onboarding.
4. **Activity log enrichment** (part of Phase 1) — Immediate visible value with minimal extra work.

### Do when needed
5. **Phase 3: Internal team management** — When you actually hire/contract someone.
6. **Phase 5: Permission-based access** — When a client asks "can my intern see but not approve?"

### Do last (polish)
7. **Phase 6: Notification preferences** — Nice to have, not blocking anything.

---

## Technical Decisions to Make Before Starting

These don't need answers today, but should be decided before Phase 1 implementation:

1. **Storage**: Continue with JSON files (consistent with current workspace model) or move to SQLite/Postgres? JSON is fine for <100 users. SQLite is better for queries (e.g., "find all users with access to workspace X").

2. **Session strategy**: JWT (stateless, easy to scale) vs server-side sessions (easier to revoke, simpler)? Current HMAC approach is closest to JWT.

3. **Magic links vs passwords**: Clients might prefer "click this link to log in" over remembering a password. Could offer both.

4. **OAuth identity**: Could allow "Sign in with Google" since you already have Google OAuth configured. Lower friction for clients who use Google Workspace.

5. **Migration path**: How to transition existing workspaces from shared passwords to individual accounts without breaking active client portals. Recommend: keep shared password as a fallback for 30 days, prompt users to create accounts.

---

## Estimated Total Effort

| Phase | Hours | Priority |
|-------|:-----:|:--------:|
| Phase 1: Internal accounts | 6-8 | HIGH |
| Phase 2: Workspace access | 3-4 | HIGH |
| Phase 3: Team management | 4-5 | MEDIUM |
| Phase 4: Client accounts | 6-8 | HIGH |
| Phase 5: Permissions | 3-4 | MEDIUM |
| Phase 6: Notifications | 2-3 | LOW |
| **Total** | **24-32** | |

Realistically, Phases 1 + 2 + 4 (the critical path) = **15-20 hours** of focused work.

---

*Created: March 7, 2026*
*Last updated: March 7, 2026*
*Status: Phases 1, 2, 4 backend shipped. Frontend integration + Phases 3, 5, 6 pending.*

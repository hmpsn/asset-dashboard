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

### Phase 1: Internal User Accounts (Priority: HIGH)
**Estimated effort: 6-8 hours**

The foundation. Everything else depends on individual identity.

#### Backend
- [ ] Create `users.ts` data module (JSON file storage, like workspaces)
- [ ] `bcrypt` password hashing for stored credentials
- [ ] JWT or session-based auth replacing the single shared password
- [ ] Auth middleware rewrite: validate JWT/session → attach `req.user`
- [ ] `/api/auth/login` — email + password → JWT + httpOnly cookie
- [ ] `/api/auth/me` — return current user profile
- [ ] `/api/auth/logout` — clear session
- [ ] Seed the initial superadmin account (you) on first boot from env vars
- [ ] Migrate existing `APP_PASSWORD` users to a transitional login flow

#### Frontend
- [ ] Login screen with email/password (replaces single password field)
- [ ] User context provider — `useCurrentUser()` hook
- [ ] Display current user name in sidebar/header
- [ ] Protect routes by role

#### Activity log enrichment
- [ ] Every activity log entry includes `userId` and `userName`
- [ ] "Josh ran an audit on ClientX" instead of "Audit ran on ClientX"

**Why this is #1:** Every subsequent feature depends on knowing *who* is performing actions. Without this, nothing else works.

---

### Phase 2: Workspace Access Control (Priority: HIGH)
**Estimated effort: 3-4 hours**

#### Backend
- [ ] Workspace access check middleware: `requireWorkspaceAccess(workspaceId, minRole)`
- [ ] API endpoints enforce workspace membership — no more "any admin sees everything"
- [ ] Superadmin bypasses all workspace checks

#### Frontend
- [ ] Sidebar only shows workspaces the user has access to
- [ ] Workspace settings restricted to `owner` role
- [ ] Visual indicator of role (e.g., "Editor" badge next to workspace name)

**Why this is #2:** Necessary before onboarding any team member. You don't want a contractor seeing all client data.

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

### Phase 4: Client User Accounts (Priority: HIGH)
**Estimated effort: 6-8 hours**

Replace the shared workspace password with individual client accounts.

#### Backend
- [ ] Client user model (same `users.ts` module, `client_admin` / `client_member` roles)
- [ ] `/api/public/auth/login` — client email + password → session cookie scoped to workspace
- [ ] `/api/public/auth/register` — invite-only registration (token from email)
- [ ] `/api/public/users/:workspaceId` — list team members (client_admin only)
- [ ] `/api/public/users/:workspaceId/invite` — invite team member (client_admin only)
- [ ] `/api/public/users/:workspaceId/:userId` — remove team member (client_admin only)
- [ ] Backward compatibility: keep shared password as a fallback during migration

#### Frontend (Client Portal)
- [ ] Client login page: email + password (replaces single password field)
- [ ] "Forgot password" flow
- [ ] Team management section for client_admin:
  - Invite member by email
  - View team list
  - Remove member
  - See last login dates
- [ ] User profile: name, email, notification preferences
- [ ] `submittedBy` auto-populated from logged-in user (no more freeform text)

**Why this is high:** Unlocks the entire team collaboration value prop for clients.

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
*Status: Planning — not yet started*

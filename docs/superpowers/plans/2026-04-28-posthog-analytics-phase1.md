# PostHog Analytics Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instrument the admin and client portal with PostHog analytics to track pageviews, user identity, workspace cohorts, and upgrade gate interactions.

**Architecture:** A thin `src/lib/posthog.ts` module owns all `posthog-js` imports and is the single point of contact for every tracking call. The name `posthog.ts` is intentional — `src/api/analytics.ts` already exists (API fetch wrappers for the analytics endpoint), so naming this file `analytics.ts` would create a confusing collision. `main.tsx` calls `setupAnalytics()` once. Admin identity and pageviews are tracked in `App.tsx`; client identity, workspace groups, and pageviews are tracked in `useClientAuth.ts`, `ClientDashboard.tsx`, and `ClientRoutes` respectively. Session recording is enabled for admin routes and explicitly disabled for `/client/*` routes to avoid PostHog capturing client SEO data.

**Tech Stack:** `posthog-js` (npm), Vitest for unit tests, React `useEffect` + `useLocation` for pageview hooks.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/lib/posthog.ts` | Single point of contact for all PostHog calls |
| Create | `tests/unit/lib/posthog.test.ts` | Unit tests for PostHog wrapper |
| Modify | `src/main.tsx` | PostHog init + dev suppression + `tier-upgrade` listener |
| Modify | `src/App.tsx` | Admin identity (`AdminApp`) + admin pageview (`Dashboard`) + client pageview + recording disable (`ClientRoutes`) |
| Modify | `src/hooks/useClientAuth.ts` | Client identity on login, `tracker.reset()` on logout |
| Modify | `src/components/ClientDashboard.tsx` | Workspace group call after workspace data loads |
| Modify | `.env.example` | Document `VITE_POSTHOG_KEY` and `VITE_POSTHOG_HOST` |
| Modify | `FEATURE_AUDIT.md` | Add PostHog analytics entry |

---

## Task 1: Install PostHog and create the wrapper

**Files:**
- Create: `src/lib/posthog.ts`
- Create: `tests/unit/lib/posthog.test.ts`

- [ ] **Step 1: Install posthog-js**

```bash
npm install posthog-js
```

Expected: `posthog-js` added to `package.json` dependencies, no peer-dependency warnings.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/lib/posthog.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import posthog from 'posthog-js';

// vi.mock is hoisted before imports by vitest — define mock inline with vi.fn()
vi.mock('posthog-js', () => ({
  default: {
    identify: vi.fn(),
    group: vi.fn(),
    capture: vi.fn(),
    reset: vi.fn(),
    init: vi.fn(),
    opt_out_capturing: vi.fn(),
    stopSessionRecording: vi.fn(),
    startSessionRecording: vi.fn(),
  },
}));

import { tracker, setupAnalytics } from '../../../src/lib/posthog';

// Call once at module level — setupAnalytics is idempotent after first call
setupAnalytics('phc_test', 'https://us.i.posthog.com');

describe('tracker', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('tracker.identify calls posthog.identify', () => {
    tracker.identify('user-123', { plan: 'growth' });
    expect(vi.mocked(posthog.identify)).toHaveBeenCalledWith('user-123', { plan: 'growth' });
  });

  it('tracker.group calls posthog.group with workspace type', () => {
    tracker.group('ws-abc', { name: 'Acme', tier: 'growth' });
    expect(vi.mocked(posthog.group)).toHaveBeenCalledWith('workspace', 'ws-abc', { name: 'Acme', tier: 'growth' });
  });

  it('tracker.capture passes event and props', () => {
    tracker.capture('upgrade_cta_clicked', { feature: 'ContentBriefs', required_tier: 'premium' });
    expect(vi.mocked(posthog.capture)).toHaveBeenCalledWith('upgrade_cta_clicked', { feature: 'ContentBriefs', required_tier: 'premium' });
  });

  it('tracker.page calls posthog.capture with $pageview', () => {
    tracker.page('/ws/abc/seo-audit', { tab: 'seo-audit', workspace_id: 'abc' });
    expect(vi.mocked(posthog.capture)).toHaveBeenCalledWith('$pageview', {
      $current_url: '/ws/abc/seo-audit',
      tab: 'seo-audit',
      workspace_id: 'abc',
    });
  });

  it('tracker.reset calls posthog.reset', () => {
    tracker.reset();
    expect(vi.mocked(posthog.reset)).toHaveBeenCalled();
  });

  it('tracker.disableRecording calls posthog.stopSessionRecording', () => {
    tracker.disableRecording();
    expect(vi.mocked(posthog.stopSessionRecording)).toHaveBeenCalled();
  });

  it('tracker.enableRecording calls posthog.startSessionRecording', () => {
    tracker.enableRecording();
    expect(vi.mocked(posthog.startSessionRecording)).toHaveBeenCalled();
  });
});

describe('setupAnalytics', () => {
  it('called posthog.init with correct config', () => {
    // init was called at module level above — assert against that call
    expect(vi.mocked(posthog.init)).toHaveBeenCalledWith('phc_test', expect.objectContaining({
      api_host: 'https://us.i.posthog.com',
      autocapture: false,
      capture_pageview: false,
    }));
  });

  it('tier-upgrade DOM event triggers tracker.capture', () => {
    vi.clearAllMocks(); // clear init/other calls from module-level setup
    window.dispatchEvent(new CustomEvent('tier-upgrade', {
      detail: { feature: 'RankTracker', required: 'premium' },
    }));
    expect(vi.mocked(posthog.capture)).toHaveBeenCalledWith('upgrade_cta_clicked', {
      feature: 'RankTracker',
      required_tier: 'premium',
    });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run tests/unit/lib/posthog.test.ts
```

Expected: FAIL — `Cannot find module '../../../src/lib/posthog'`

- [ ] **Step 4: Create `src/lib/posthog.ts`**

```ts
import posthog from 'posthog-js';

// Guard prevents double-registration if setupAnalytics is accidentally called twice
let _initialized = false;

export function setupAnalytics(key: string, host: string): void {
  if (_initialized) return;
  _initialized = true;

  posthog.init(key, {
    api_host: host,
    autocapture: false,
    capture_pageview: false,
    session_recording: { maskAllInputs: true },
    loaded: (ph) => {
      if (import.meta.env.DEV) ph.opt_out_capturing();
    },
  });

  window.addEventListener('tier-upgrade', ((e: CustomEvent<{ feature: string; required: string }>) => {
    tracker.capture('upgrade_cta_clicked', {
      feature: e.detail.feature,
      required_tier: e.detail.required,
    });
  }) as EventListener);
}

export const tracker = {
  identify(id: string, props?: Record<string, unknown>): void {
    posthog.identify(id, props);
  },
  group(workspaceId: string, props?: Record<string, unknown>): void {
    posthog.group('workspace', workspaceId, props);
  },
  capture(event: string, props?: Record<string, unknown>): void {
    posthog.capture(event, props);
  },
  page(path: string, props?: Record<string, unknown>): void {
    posthog.capture('$pageview', { $current_url: path, ...props });
  },
  reset(): void {
    posthog.reset();
  },
  disableRecording(): void {
    posthog.stopSessionRecording();
  },
  enableRecording(): void {
    posthog.startSessionRecording();
  },
};
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run tests/unit/lib/posthog.test.ts
```

Expected: All 9 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/posthog.ts tests/unit/lib/posthog.test.ts package.json package-lock.json
git commit -m "feat: add PostHog tracker wrapper + unit tests"
```

---

## Task 2: Initialize PostHog in main.tsx + env vars

**Files:**
- Modify: `src/main.tsx`
- Modify: `.env.example`

- [ ] **Step 1: Add PostHog init to `src/main.tsx`**

Add the import at the top of the file, after the existing `import * as Sentry from '@sentry/react'` line:

```ts
import { setupAnalytics } from './lib/posthog';
```

Then add the init block after the closing brace of the `if (SENTRY_DSN) { ... }` block (currently ends around line 18):

```ts
const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
if (POSTHOG_KEY) {
  setupAnalytics(POSTHOG_KEY, (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://us.i.posthog.com');
}
```

- [ ] **Step 2: Update `.env.example`**

Add these two lines immediately **before** the `# ── Bot protection` / `VITE_TURNSTILE_SITE_KEY` section (after the Sentry DSN lines):

```
# ── Analytics — PostHog (optional — leave blank to disable) ──
VITE_POSTHOG_KEY=                # PostHog project API key (phc_...) — enables frontend analytics tracking
VITE_POSTHOG_HOST=               # PostHog ingestion host (default: https://us.i.posthog.com)
```

- [ ] **Step 3: Verify typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/main.tsx .env.example
git commit -m "feat: initialise PostHog in main.tsx with dev suppression"
```

---

## Task 3: Admin identity + pageview tracking

**Files:**
- Modify: `src/App.tsx`

This task touches two functions in `src/App.tsx`: `AdminApp` (identity on auth) and `Dashboard` (pageview on route change). The import goes at the top of the file with existing imports.

- [ ] **Step 1: Add `tracker` import to `src/App.tsx`**

Add after the last existing import line at the top of `src/App.tsx`:

```ts
import { tracker } from './lib/posthog';
```

- [ ] **Step 2: Add admin identity to `AdminApp`**

`AdminApp` starts around line 134. It currently uses `useState` but no `useEffect`. `useEffect` is already imported at line 1 of the file. Add this block after the `toggleTheme` function definition, before the first `if (auth.checking)` conditional return:

```ts
// Identify the admin user once after authentication resolves
useEffect(() => {
  if (auth.authenticated) tracker.identify('admin');
}, [auth.authenticated]);
```

- [ ] **Step 3: Add admin pageview to `Dashboard`**

`Dashboard` starts around line 155. `location` is already declared via `const location = useLocation()` at line 156. Add a `useEffect` immediately after that declaration:

```ts
// Track admin pageviews on route change; tab/urlWorkspaceId are derived from
// pathname so they are intentionally omitted from deps to avoid double-fire
// eslint-disable-next-line react-hooks/exhaustive-deps
useEffect(() => {
  tracker.page(location.pathname, { tab, workspace_id: urlWorkspaceId });
}, [location.pathname]);
```

Note: the `// eslint-disable-next-line` comment must be on the line immediately before `useEffect`, matching the project convention (see `ClientDashboard.tsx` line 313).

- [ ] **Step 4: Verify typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add admin identity + pageview tracking via PostHog"
```

---

## Task 4: Client identity, workspace group, pageview, and recording disable

**Files:**
- Modify: `src/hooks/useClientAuth.ts`
- Modify: `src/components/ClientDashboard.tsx`
- Modify: `src/App.tsx` (the `ClientRoutes` function)

### 4a — Client identity + reset in useClientAuth

- [ ] **Step 1: Add `tracker` import to `src/hooks/useClientAuth.ts`**

After the existing imports at the top of the file:

```ts
import { tracker } from '../lib/posthog';
```

- [ ] **Step 2: Call `tracker.identify` on successful named-user login**

In `handleClientUserLogin` (around line 93), the success block currently reads:

```ts
const data = await post<{ user: ClientUser }>(...);
setClientUser(data.user);         // line 101
setAuthenticated(true);           // line 102
sessionStorage.setItem(...);      // line 103
if (ws) loadDashboardData(ws);
```

Add `tracker.identify` immediately after `sessionStorage.setItem`:

```ts
const data = await post<{ user: ClientUser }>(`/api/public/client-login/${workspaceId}`, { email: loginEmail.trim(), password: loginPassword.trim(), turnstileToken });
setClientUser(data.user);
setAuthenticated(true);
sessionStorage.setItem(`dash_auth_${workspaceId}`, 'true');
tracker.identify(data.user.email, { name: data.user.name, role: data.user.role, workspace_id: workspaceId });
if (ws) loadDashboardData(ws);
```

- [ ] **Step 3: Call `tracker.identify` on successful shared-password auth**

In `handlePasswordSubmit` (around line 77), the success block currently reads:

```ts
await post(`/api/public/auth/${workspaceId}`, { password: passwordInput });
setAuthenticated(true);           // line 84
sessionStorage.setItem(...);      // line 85
if (ws) loadDashboardData(ws);    // line 86
```

Add `tracker.identify` after `sessionStorage.setItem`:

```ts
await post(`/api/public/auth/${workspaceId}`, { password: passwordInput });
setAuthenticated(true);
sessionStorage.setItem(`dash_auth_${workspaceId}`, 'true');
tracker.identify(`shared:${workspaceId}`);
if (ws) loadDashboardData(ws);
```

- [ ] **Step 4: Call `tracker.reset` on logout**

In `handleClientLogout` (around line 112), the current body is:

```ts
setClientUser(null);                                      // line 116
setAuthenticated(false);                                  // line 117
sessionStorage.removeItem(`dash_auth_${workspaceId}`);   // line 118
```

Add `tracker.reset()` as the final line:

```ts
const handleClientLogout = useCallback(async () => {
  try {
    await post(`/api/public/client-logout/${workspaceId}`);
  } catch (err) { console.error('useClientAuth operation failed:', err); }
  setClientUser(null);
  setAuthenticated(false);
  sessionStorage.removeItem(`dash_auth_${workspaceId}`);
  tracker.reset();
}, [workspaceId]);
```

### 4b — Workspace group in ClientDashboard

- [ ] **Step 5: Add `tracker` import to `src/components/ClientDashboard.tsx`**

After the existing imports at the top of the file:

```ts
import { tracker } from '../lib/posthog';
```

- [ ] **Step 6: Add workspace group call**

`ws` is destructured from `useClientData(workspaceId)` (lines 67–85). `useEffect` is already imported from React (line 1). The `useWorkspaceEvents` call is at line 180.

Add a new `useEffect` immediately before the `useWorkspaceEvents` call (before line 180):

```ts
// Register workspace group properties with PostHog when auth + workspace data are ready
useEffect(() => {
  if (!authenticated || !ws) return;
  tracker.group(workspaceId, {
    name: ws.name,
    tier: ws.tier ?? 'free',
    is_trial: ws.isTrial ?? false,
    has_gsc: !!ws.gscPropertyUrl,
    has_ga4: !!ws.ga4PropertyId,
    has_webflow: !!ws.webflowSiteId,
  });
}, [authenticated, ws, workspaceId]);
```

### 4c — Client pageview + session recording disable in ClientRoutes

- [ ] **Step 7: Update `ClientRoutes` in `src/App.tsx`**

`ClientRoutes` spans lines 104–118. It currently uses `useParams` and `useSearchParams` but not `useLocation`. `useLocation` is already imported from `react-router-dom` at line 4 of `App.tsx`, so no new import is needed.

Replace the entire `ClientRoutes` function with:

```ts
function ClientRoutes({ betaMode = false }: { betaMode?: boolean }) {
  const params = useParams<{ workspaceId: string; '*': string }>();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const workspaceId = params.workspaceId!;

  // Disable session recording for client portal — PostHog must not capture client SEO data
  useEffect(() => {
    tracker.disableRecording();
    return () => { tracker.enableRecording(); };
  }, []);

  // Track client pageviews on route change; workspaceId/betaMode are stable
  // for the lifetime of a client session and intentionally omitted from deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    tracker.page(location.pathname, { workspace_id: workspaceId, beta: betaMode });
  }, [location.pathname]);

  // Backward-compat: redirect old ?tab=X URLs to path-based
  const queryTab = searchParams.get('tab');
  if (queryTab && workspaceId) {
    const remaining = new URLSearchParams(searchParams);
    remaining.delete('tab');
    const qs = remaining.toString();
    return <Navigate to={clientPath(workspaceId, queryTab, betaMode) + (qs ? '?' + qs : '')} replace />;
  }
  const splatTab = params['*'] || undefined;
  return <ClientDashboard workspaceId={workspaceId} initialTab={splatTab} betaMode={betaMode} />;
}
```

- [ ] **Step 8: Verify typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useClientAuth.ts src/components/ClientDashboard.tsx src/App.tsx
git commit -m "feat: add client identity, workspace group, pageview tracking + recording disable"
```

---

## Task 5: Quality gates and docs

- [ ] **Step 1: Run full typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 2: Run production build**

```bash
npx vite build
```

Expected: builds successfully. PostHog adds ~50–80 KB gzipped to the admin bundle.

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass including the new `posthog.test.ts`. If pre-existing failures exist, confirm with `git stash && npx vitest run` that they were present before this change.

- [ ] **Step 4: Run pr-check**

```bash
npx tsx scripts/pr-check.ts
```

Expected: zero errors.

- [ ] **Step 5: Update `FEATURE_AUDIT.md`**

Find the last numbered entry and add the next sequential entry. The format must match the existing structure exactly (`##` section heading, `### N. Title`, bold `**Field:**` labels, backticked file paths, `---` separator). Add:

```markdown
## PostHog Analytics — Phase 1 (2026-04-28)

### [N]. PostHog Frontend Analytics
**What it does:** Instruments admin and client portal with PostHog via a thin `src/lib/posthog.ts` wrapper (`tracker` export). Tracks admin pageviews and identity on auth, client pageviews, user identity (email for named users, `shared:<workspaceId>` for shared-password sessions), workspace group properties (tier, trial status, GSC/GA4/Webflow integrations), and upgrade CTA clicks via the existing `tier-upgrade` DOM event from `TierGate`. Session recording is enabled for admin routes and explicitly disabled for `/client/*` routes so PostHog never captures client SEO data.

**Agency value:** Visibility into which workspaces are actively engaged vs dormant, which features clients actually use, and which upgrade gates are hit most frequently — all without manual instrumentation per feature.

**Client value:** No direct client-facing impact. Session recording is disabled for the client portal.

**Config:** `VITE_POSTHOG_KEY` (phc_...) and `VITE_POSTHOG_HOST` env vars. If `VITE_POSTHOG_KEY` is absent, `setupAnalytics` is never called and the module is a no-op. Dev tracking is suppressed via `posthog.opt_out_capturing()`.

**Files:** `src/lib/posthog.ts`, `src/main.tsx`, `src/App.tsx`, `src/hooks/useClientAuth.ts`, `src/components/ClientDashboard.tsx`

**Tests:** `tests/unit/lib/posthog.test.ts`

**Phase 2 note:** The intelligence engine's `ClientSignalsSlice` already computes `churnRisk` from login frequency and activity log events. PostHog data lives in PostHog's cloud and should NOT be queried in the assembler. The path to richer tab-visit churn signals is a lightweight `client_tab_visit` activity type written server-side — not PostHog coupling.

---
```

- [ ] **Step 6: Final commit**

```bash
git add FEATURE_AUDIT.md
git commit -m "docs: add PostHog analytics Phase 1 to FEATURE_AUDIT"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] PostHog init with dev suppression → Task 2
- [x] `tracker` wrapper with idempotent init guard → Task 1
- [x] Admin identity → Task 3
- [x] Admin pageview tracking → Task 3
- [x] Client identity (named user login) → Task 4a Step 2
- [x] Client identity (shared-password login) → Task 4a Step 3
- [x] Client logout / reset → Task 4a Step 4
- [x] Workspace group with tier + integrations properties → Task 4b
- [x] Client pageview tracking → Task 4c
- [x] Session recording disabled for `/client/*` → Task 4c
- [x] `tier-upgrade` DOM event → Task 1 (`setupAnalytics` wires the listener)
- [x] Both client route paths (`/client/*` and `/client/beta/*`) → `ClientRoutes` handles both, both render via the same function
- [x] Env vars documented in correct location → Task 2 (before Turnstile section)
- [x] FEATURE_AUDIT updated with correct format → Task 5

**Audit fixes applied:**
- [x] File named `posthog.ts` not `analytics.ts` — avoids collision with `src/api/analytics.ts`
- [x] `vi.mock` factory uses inline `vi.fn()` — not a variable reference (which would be out of scope after hoisting)
- [x] `vi.mocked(posthog.method)` for assertions — correct vitest pattern
- [x] `_initialized` guard prevents double listener registration in tests and production
- [x] `// eslint-disable-next-line` on preceding line — not `// eslint-disable-line` at end of line
- [x] `.env.example` placement before Turnstile section, not after it
- [x] `FEATURE_AUDIT.md` entry uses `## → ### N.` format with bold `**Field:**` labels and `---` separator
- [x] `ws` description corrected — comes from `useClientData()` hook destructuring, not local `useState`

**Type consistency:**
- `tracker.identify(id, props?)` — used identically in Tasks 3 and 4a
- `tracker.group(workspaceId, props?)` — used in Task 4b with matching signature
- `tracker.page(path, props?)` — used in Tasks 3 and 4c with matching signature
- `tracker.capture(event, props?)` — used in `setupAnalytics` tier-upgrade listener, consistent with wrapper definition
- `WorkspaceInfo` fields (`gscPropertyUrl`, `ga4PropertyId`, `webflowSiteId`, `tier`, `isTrial`, `name`) — all verified present in `src/components/client/types.ts` line 29
- `ClientUser` fields (`email`, `name`, `role`) — verified in `src/hooks/useClientAuth.ts` lines 5–10

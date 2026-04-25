# Phase 2 Visual Baseline

Reference suite for Gate 4 of the Phase 2 kickoff plan
([`docs/superpowers/plans/2026-04-24-phase-2-kickoff.md`](../../../docs/superpowers/plans/2026-04-24-phase-2-kickoff.md#phase-2-visual-baseline)).

> **Status (2026-04-24):** Harness shipped, **baselines not yet captured**.
> The PNG baselines under `phase2-baseline/` need to be generated against the
> staging deploy before any Phase 2 worker PR opens. See
> [§ One-time: capture the baseline against staging](#one-time-capture-the-baseline-against-staging)
> below — operator will run this from a Claude Desktop terminal session with
> staging credentials, then commit the resulting PNGs as a follow-up.
> Phase 2 dispatch is gated on this completing.

## What this is

Playwright visual-regression suite that captures full-page screenshots of the
11 key pages Phase 2 migrations touch. Every Phase 2 worker PR runs the same
suite against its branch preview deploy and asserts zero pixel diff against
the committed baseline. Any diff > 0 fails the run.

The gate is how we catch visual regressions that typecheck + tests can't see
— button styles, layout gaps, icon sizes, etc.

## One-time: capture the baseline against staging

Run this exactly once, from `staging` after PR B merges but BEFORE any Phase 2
worker PR opens. The PNGs it produces get committed to
`tests/playwright/visual/phase2-baseline/` on staging.

```bash
# 1. Get an admin auth token for staging. (Admin UI → DevTools →
#    Application → Local Storage → copy `x-auth-token` value.)
export PHASE2_ADMIN_TOKEN='...'

# 2. Get a workspace UUID with reasonable data (real-ish analytics, content,
#    etc.). Do NOT use an empty workspace — empty states have different
#    layouts than populated states and the baseline won't match real pages.
export PHASE2_ADMIN_WS_ID='...'

# 3. Get a client-portal workspace UUID + shared password.
export PHASE2_CLIENT_WS_ID='...'
export PHASE2_CLIENT_PASSWORD='...'

# 4. Point at staging.
export BASE_URL='https://asset-dashboard-staging.onrender.com'

# 5. Capture baselines. The `--update-snapshots` flag writes new PNGs;
#    subsequent runs without the flag assert against these.
npm run phase2:baseline:update
```

Commit the resulting PNGs:

```bash
git add tests/playwright/visual/phase2-baseline/
git commit -m "test(visual): capture Phase 2 baseline against staging"
```

## Each Phase 2 worker PR: run the diff

Workers run the same suite against their branch preview deploy. Zero diff is
the gate. Any page with a diff fails; inspect the generated image (Playwright
reports list actual + expected + diff) to decide if it's an intentional
improvement or a regression to fix.

```bash
export BASE_URL='https://<worker-branch-preview>.onrender.com'
export PHASE2_ADMIN_TOKEN='...'
export PHASE2_ADMIN_WS_ID='...'
export PHASE2_CLIENT_WS_ID='...'
export PHASE2_CLIENT_PASSWORD='...'

npm run phase2:baseline
```

If a worker PR intentionally changes a page's appearance (rare — the Phase 2
migration goal is behavior-preserving), the PR description must explicitly
justify each diff and the PR author re-runs with `:update` to refresh the
committed baseline in that PR.

## Pages covered

| # | Route | Auth | Notes |
|---|---|---|---|
| 01 | `/` | none | Login page |
| 02 | `/ws/:id/overview` | admin | WorkspaceOverview |
| 03 | `/ws/:id/analytics` | admin | AnalyticsHub |
| 04 | `/ws/:id/pages` | admin | PageIntelligence |
| 05 | `/ws/:id/strategy` | admin | KeywordStrategy |
| 06 | `/ws/:id/content` | admin | ContentBriefs |
| 07 | `/ws/:id/audit` | admin | SeoAudit |
| 08 | `/ws/:id/brand` | admin | BrandHub |
| 09 | `/client/:id/overview` | client | ClientDashboard |
| 10 | `/client/:id/inbox` | client | InboxTab |
| 11 | `/styleguide.html` | none | Styleguide demo |

## Configuration

- **Config file:** [`playwright.visual.config.ts`](../../../playwright.visual.config.ts)
- **Viewport:** 1440×900 (desktop)
- **Diff threshold:** `maxDiffPixelRatio: 0.001` (0.1%) — near-zero tolerance
  for font/antialiasing noise, fails on any real styling change
- **Animations:** disabled during capture so screenshots are deterministic
- **Network idle:** enforced + 1200ms settle for React Query data to resolve
- **No webServer:** baseline suite only runs against deployed URLs, never
  local dev (rationale in the config file header)

## When to regenerate the baseline

- After each Phase 2 PR merges to staging — the baseline tracks the
  post-migration state so the NEXT Phase 2 PR diffs against the accumulated
  migrations, not the pre-Phase-2 starting point.
- When an intentional visual improvement ships outside Phase 2 (e.g. new
  illustration, updated styleguide spec) — in that PR, re-run `:update` and
  commit the new PNGs.
- Never "just to make tests pass" — if a diff shows up unexpectedly, inspect
  before regenerating. An unexpected diff is the signal the whole suite
  exists to surface.

## Troubleshooting

**Test skips with "PHASE2_ADMIN_TOKEN + PHASE2_ADMIN_WS_ID required"**
One or both env vars are unset. Admin-route captures need both.

**Test times out waiting for `networkidle`**
The target deploy is slow or down. Verify `BASE_URL` is reachable and the
workspace has data loaded. The 60s default timeout is usually sufficient.

**Large diffs with no code change**
Check for: transient data (timestamps, "X minutes ago" labels), chart
animations that didn't finish, empty-state placeholders on a workspace that
was seeded mid-run. The 1200ms settle + `animations: 'disabled'` handles
most of this; if a page has unavoidable dynamic data, mark it `.skip` with
a TODO and capture a stabilized version later.

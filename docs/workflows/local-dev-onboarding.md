---
description: First-hour local onboarding for humans and agents
---

# Local Dev & Agent Onboarding

Wave 5 item: `platform-reliability-local-dev-onboarding`

## First-Hour Checklist

1. `cp .env.example .env`
2. `npm install`
3. Set `DATA_DIR` to an absolute directory unique to this checkout or worktree.
4. Keep the default `PROVIDER_ENV_PROFILE=local-fake`, `NODE_ENV=development`, and `LOCAL_FAKE_PROVIDERS=true` for synthetic AI + SEO provider responses.
5. `npm run verify:env`
6. `npm run seed:demo`
7. `npm run dev:all`
8. `npm run smoke:core`

## One-Command Routines

- Seed fixture workspaces: `npm run seed:demo`
- Run core smoke coverage: `npm run smoke:core`
- Safety guard: `seed:demo` is blocked in `production`; non-local environments require `ALLOW_NON_LOCAL_DEMO_SEED=true`.

## Local database location (read before configuring/seeding via a script)

The SQLite DB is `$DATA_DIR/dashboard.db`; in dev with `DATA_DIR` unset it defaults to `~/.asset-dashboard/dashboard.db` (resolved in `server/data-dir.js` → `server/db/index.ts`). Migrations apply automatically on **server boot** (tracked in the `_migrations` table) — there is no separate migrate step (`npm run db:migrate` is a legacy JSON-data script, not the `.sql` runner; and `db:sync-staging` syncs **prod → staging**, never down to local).

**Worktree gotcha (cost a real debugging detour):** a separate git worktree/checkout should set its own `DATA_DIR` in `.env` (e.g. `DATA_DIR=$HOME/.asset-dashboard-<suffix>`) to isolate its DB from the main checkout. Two consequences to remember:

- The server reads **`DATA_DIR`**, not `DATA_BASE` — a `DATA_BASE=...` env (e.g. in a `.claude/launch.json` runner) is **ignored**, so the DB path silently falls back to the `DATA_DIR` default.
- A standalone `tsx scripts/...` that configures or seeds a workspace must run with the **same `DATA_DIR`** the server uses (`DATA_DIR=$HOME/.asset-dashboard-<suffix> npx tsx scripts/...`), or it writes to a *different* `dashboard.db` than the running server reads — the config appears to "not take effect." Confirm which file the server actually has open with `lsof -p <server-pid> | grep dashboard.db`.

## Fixture Workspaces

`npm run seed:demo` creates or updates:

- `ws_demo_empty` (tier: free, scenario: empty/new)
- `ws_demo_free` (tier: free, scenario: free-tier client)
- `ws_demo_growth` (tier: growth, scenario: active client workflow)
- `ws_demo_premium` (tier: premium, scenario: content/schema/inbox history)
- `ws_demo_broken_integrations` (tier: growth, scenario: missing/broken integrations)
- `ws_demo_rich_cms` (tier: premium, scenario: rich CMS/Webflow workflow state)
- `ws_demo_loaded` (tier: premium, scenario: high-volume admin UX and under-load smoke testing)

Use `ws_demo_loaded` when validating collection containment, fold depth, queue density, and other admin UX behavior under realistic volume. It includes 50+ active Content Pipeline board cards across brief/draft/review stages, 10+ Cockpit queue items across risk/send/money/audit producers, persisted audit and redirect scans, 500+ page-keyword rows with zero and positive CPC values, client requests with unanswered replies, and recorded wins.

Client password for all demo workspaces: `demo-client`

Admin URLs:

- `/ws/ws_demo_growth`
- `/ws/ws_demo_premium`
- `/ws/ws_demo_free`
- `/ws/ws_demo_empty`
- `/ws/ws_demo_broken_integrations`
- `/ws/ws_demo_rich_cms`
- `/ws/ws_demo_provider_rich` (provider-backed populated visual fixture; requires `LOCAL_FAKE_PROVIDERS=true`)
- `/ws/ws_demo_loaded` (high-volume admin UX fixture; no live crawl required)

Client URLs:

- `/client/ws_demo_growth`
- `/client/ws_demo_premium`
- `/client/ws_demo_free`
- `/client/ws_demo_empty`
- `/client/ws_demo_broken_integrations`
- `/client/ws_demo_rich_cms`
- `/client/ws_demo_provider_rich`
- `/client/ws_demo_loaded`

## Provider environment profiles

`PROVIDER_ENV_PROFILE` is a verification profile, not a feature flag. Run `npm run verify:env` before starting provider-dependent work; it checks that required keys and callback URLs are structurally valid without printing their values or making provider calls.

| Profile | Intended use | Required mode |
|---------|--------------|---------------|
| `local-fake` | Deterministic, non-billable UI development and onboarding | `NODE_ENV=development`, `LOCAL_FAKE_PROVIDERS=true`, isolated absolute `DATA_DIR` |
| `local-live` | Explicit local testing against live DataForSEO, Google OAuth/GBP, and PageSpeed | `NODE_ENV=development`, `LOCAL_FAKE_PROVIDERS=false`, isolated absolute `DATA_DIR`, all live-provider variables below |
| `staging` | Provider-connected release smoke on the isolated staging service | `NODE_ENV=production`, `LOCAL_FAKE_PROVIDERS=false`, HTTPS callbacks and dedicated staging credentials |

For `local-live`, configure all of the following in the uncommitted `.env` file:

- `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD`
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI=http://localhost:3001/api/google/callback`
- `GOOGLE_BUSINESS_PROFILE_REDIRECT_URI=http://localhost:3001/api/google-business-profile/callback`
- independent 32+ character `GOOGLE_OAUTH_ENCRYPTION_KEY` and `GOOGLE_OAUTH_STATE_SECRET` values
- `GOOGLE_PSI_KEY`

Register both local callback URLs on the non-production Google OAuth client. Then run:

```bash
npm run verify:env -- --profile=local-live
```

The verifier is offline and does not prove provider access. Live calls can consume DataForSEO credits or Google quota, so the canonical credentialed end-to-end check remains the read-only, cost-capped staging smoke described in `docs/workflows/staging-environment.md`.

SEMrush is retired as a runtime provider. Do not add `SEMRUSH_API_KEY`; DataForSEO is the canonical SEO provider.

## Environment tiers

### Tier 1: Fast Local (no external creds)

- Required: `PROVIDER_ENV_PROFILE=local-fake`, `NODE_ENV=development`, `LOCAL_FAKE_PROVIDERS=true`, and an isolated `DATA_DIR`
- External keys optional
- Best for: onboarding, UI development, local flow checks

### Tier 2: Core Integrations

- Add: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `WEBFLOW_API_TOKEN`
- Keep Google and DataForSEO optional unless deliberately switching to `local-live`
- Best for: AI + CMS flow development

### Tier 3: Full Production-Like

- Use the `local-live` profile and add its provider variables plus the billing and email keys needed for the flow under test
- Best for: end-to-end integration validation

## Fake Provider Mode

`LOCAL_FAKE_PROVIDERS=true` enables synthetic provider behavior in local dev only (`NODE_ENV=development`):

- AI helper calls return deterministic synthetic responses.
- SEO provider registry uses a fake provider with deterministic keyword/domain/backlink data.
- Non-local environments (for example staging/test/prod) ignore this flag by design.

Use this mode when you need predictable, non-billable local onboarding and smoke execution.

Fake mode validates workflow composition, not live provider contracts. The explicit `ws_demo_provider_rich` fixture covers deterministic GSC, GA4, PageSpeed, local visibility, and advanced DataForSEO read shapes. Real Google OAuth, authenticated GBP reviews/replies, provider quotas, and credential validity still require the credentialed staging smoke.

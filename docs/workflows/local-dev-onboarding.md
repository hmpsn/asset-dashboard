---
description: First-hour local onboarding for humans and agents
---

# Local Dev & Agent Onboarding

Wave 5 item: `platform-reliability-local-dev-onboarding`

## First-Hour Checklist

1. `cp .env.example .env`
2. `npm install`
3. Set `LOCAL_FAKE_PROVIDERS=true` in `.env` for synthetic AI + SEO provider responses.
4. `npm run seed:demo`
5. `npm run dev:all`
6. `npm run smoke:core`

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

Client password for all demo workspaces: `demo-client`

Admin URLs:

- `/ws/ws_demo_growth`
- `/ws/ws_demo_premium`
- `/ws/ws_demo_free`
- `/ws/ws_demo_empty`
- `/ws/ws_demo_broken_integrations`
- `/ws/ws_demo_rich_cms`

Client URLs:

- `/client/ws_demo_growth`
- `/client/ws_demo_premium`
- `/client/ws_demo_free`
- `/client/ws_demo_empty`
- `/client/ws_demo_broken_integrations`
- `/client/ws_demo_rich_cms`

## Environment Tiers

### Tier 1: Fast Local (no external creds)

- Required: `APP_PASSWORD` (optional in dev), `LOCAL_FAKE_PROVIDERS=true`
- External keys optional
- Best for: onboarding, UI development, local flow checks

### Tier 2: Core Integrations

- Add: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `WEBFLOW_API_TOKEN`
- Keep Google/SEMRush/DataForSEO optional
- Best for: AI + CMS flow development

### Tier 3: Full Production-Like

- Add all provider + billing + email keys from `.env.example`
- Best for: end-to-end integration validation

## Fake Provider Mode

`LOCAL_FAKE_PROVIDERS=true` enables synthetic provider behavior in local dev only (`NODE_ENV=development`):

- AI helper calls return deterministic synthetic responses.
- SEO provider registry uses a fake provider with deterministic keyword/domain/backlink data.
- Non-local environments (for example staging/test/prod) ignore this flag by design.

Use this mode when you need predictable, non-billable local onboarding and smoke execution.

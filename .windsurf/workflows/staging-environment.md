---
description: How to set up and manage the Render staging environment
---

# Staging Environment on Render

## Overview

The platform runs two Render Web Services from the same repo:
- **Production**: `asset-dashboard` → `main` branch
- **Staging**: `asset-dashboard-staging` → `staging` branch

Both share the same external API data (Webflow CMS, GSC, GA4) via identical tokens.

## Environment Variables

**Duplicate from production** (identical values):
- `WEBFLOW_API_TOKEN`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `JWT_SECRET`
- `NODE_ENV=production`
- `DATA_DIR=/var/data/asset-dashboard`

**Must differ on staging**:
- `APP_URL` — staging URL (e.g. `https://asset-dashboard-staging.onrender.com`), used in email links
- `STRIPE_SECRET_KEY` — use `sk_test_...` so no real charges
- `STRIPE_WEBHOOK_SECRET` — different endpoint = different signing secret
- `APP_PASSWORD` — optional, different so you know which env you're on
- `GOOGLE_REDIRECT_URI` — must match staging URL for OAuth callbacks

## File-Based Data (DATA_DIR)

Each Render service has its own 1GB persistent disk at `/var/data/asset-dashboard`. A new staging service starts empty.

**To seed staging with production data:**
```bash
./scripts/sync-staging-data.sh
```

Or manually via Render Dashboard Shell:
1. Production Shell: `tar czf /tmp/data-export.tar.gz -C /var/data/asset-dashboard .`
2. Download the file
3. Staging Shell: upload and `tar xzf /tmp/data-export.tar.gz -C /var/data/asset-dashboard`

## Workflow

1. Create `staging` branch from `main`: `git checkout -b staging`
2. Push feature/test changes to `staging` branch
3. Render auto-deploys staging service
4. Test on staging URL
5. When ready, merge `staging` → `main` for production deploy

## Blueprint

The `render.yaml` at repo root defines both services. To use it:
1. Render Dashboard → Blueprints → New Blueprint Instance
2. Select the repo
3. Fill in env var values

## Key Files

- `render.yaml` — Render blueprint (both services + env var groups)
- `scripts/sync-staging-data.sh` — Data sync helper (requires Render CLI)
- `server/data-dir.ts` — DATA_DIR resolution logic
- `.env.example` — All available env vars

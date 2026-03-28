---
description: How to use the Render staging environment
---

# Staging Environment

## URLs

| Environment | URL | Branch |
|------------|-----|--------|
| **Production** | `https://insights.hmpsn.studio` | `main` |
| **Staging** | `https://asset-dashboard-staging.onrender.com` | `staging` |

Render dashboard:
- Production: `https://dashboard.render.com/web/srv-d6jrvrkr85hc73bn3vlg`
- Staging: `https://dashboard.render.com/web/srv-d73ot97fte5s73b5ljt0`

Both auto-deploy on push to their respective branches.

## Branch model

```
feature/branch  →  PR to staging  →  verify  →  merge staging → main
```

See `.windsurf/workflows/deploy.md` for the full deploy workflow.

## Syncing production data to staging

Staging has its own 1GB disk and starts empty. To copy the production database:

```bash
APP_PASSWORD=<your-password> npm run db:sync-staging
```

This:
1. Checkpoints the production WAL
2. Downloads the SQLite database from production (`/api/admin/db-export`)
3. Uploads it to staging (`/api/admin/db-import`)
4. Staging restarts with the new database

**Safety:** The import endpoint only works when `ALLOW_DB_IMPORT=true` (set on staging, never on production).

## Environment variables

Staging has all the same env vars as production, with these differences:

| Var | Staging value |
|-----|--------------|
| `APP_URL` | `https://asset-dashboard-staging.onrender.com` |
| `ALLOWED_ORIGINS` | `https://asset-dashboard-staging.onrender.com` |
| `GOOGLE_REDIRECT_URI` | `https://asset-dashboard-staging.onrender.com/api/google/callback` |
| `ALLOW_DB_IMPORT` | `true` |

**Google OAuth note:** The staging redirect URI must be added to your Google Cloud Console OAuth app as an authorized redirect URI for GSC/GA4 connections to work on staging.

**Render API gotcha:** `PUT /v1/services/{id}/env-vars` is a full replace, not a patch. Always send the complete list of env vars.

## Feature flags

Use feature flags to dark-launch incomplete features on staging before enabling in production:

```bash
# Enable on staging only (in Render env vars)
FEATURE_COPY_ENGINE=true

# Check which flags are active
curl https://asset-dashboard-staging.onrender.com/api/feature-flags
```

See `shared/types/feature-flags.ts` for all available flags.

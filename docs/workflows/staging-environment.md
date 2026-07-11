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

See `docs/workflows/deploy.md` for the full deploy workflow.

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

**Backup/restore drill:** before a destructive migration wave lands on staging, run
`npm run backup:restore-drill` against a freshly-synced staging database — see
`docs/workflows/data-integrity-recovery.md` and the contract in
`docs/rules/destructive-migrations.md`.

## Environment variables

Staging has all the same env vars as production, with these differences:

| Var | Staging value |
|-----|--------------|
| `APP_URL` | `https://asset-dashboard-staging.onrender.com` |
| `ALLOWED_ORIGINS` | `https://asset-dashboard-staging.onrender.com` |
| `PROVIDER_ENV_PROFILE` | `staging` |
| `LOCAL_FAKE_PROVIDERS` | `false` |
| `GOOGLE_REDIRECT_URI` | `https://asset-dashboard-staging.onrender.com/api/google/callback` |
| `GOOGLE_BUSINESS_PROFILE_REDIRECT_URI` | `https://asset-dashboard-staging.onrender.com/api/google-business-profile/callback` |
| `ALLOW_DB_IMPORT` | `true` |

Staging provider credentials must be dedicated to staging:

- Use a separate DataForSEO account or sub-account with a small credit ceiling.
- Use a non-production Google Cloud project/OAuth client for GSC, GA4, and GBP. Add both staging callback URLs above as authorized redirect URIs.
- Use the staging Google project’s `GOOGLE_PSI_KEY` with a conservative quota limit.
- Keep `GOOGLE_OAUTH_ENCRYPTION_KEY` and `GOOGLE_OAUTH_STATE_SECRET` unique to staging and stable. Rotating the encryption key makes previously stored GBP tokens unreadable and requires reconnecting the integration.
- Never place staging or production credentials in the repository, command output, screenshots, or task notes.

The Render Blueprint intentionally separates `production-provider-credentials` from `staging-provider-credentials`. Do not collapse them into a shared group. The staging persistent disk is also isolated from production even though both services mount their own disk at `/var/data/asset-dashboard`.

Before applying the renamed Blueprint groups, populate `production-provider-credentials` with the existing production values and populate `staging-provider-credentials` with separate staging values. For an existing production GBP installation that encrypted tokens through `INTEGRATION_CONFIG_KEY`, set `GOOGLE_OAUTH_ENCRYPTION_KEY` to that same stable value before switching names; a different value makes existing ciphertext unreadable. Apply the Blueprint only after both groups and both callback variables are present, then verify integration health in each environment independently.

Validate the deployed environment from a Render staging shell before a provider smoke:

```bash
npm run verify:env -- --profile=staging
```

The verifier checks presence, mode, secret length, callback paths, HTTPS, and origin alignment without printing values or contacting providers.

## Provider-connected staging smoke

Run the provider smoke only against an explicitly designated staging workspace and only after `verify:env` passes:

| Input | Purpose |
|-------|---------|
| `STAGING_BASE_URL` | Staging origin; the smoke refuses a production target |
| `STAGING_WORKSPACE_ID` | Explicit staging-only workspace to inspect |
| `APP_PASSWORD` | Existing staging admin gate credential; consumed but never printed |
| `PROVIDER_SMOKE_MAX_PAID_CALLS` | Hard paid-call ceiling; defaults to `1` |
| `PROVIDER_SMOKE_PAGESPEED_URL` | Public non-sensitive URL for the single PageSpeed probe |
| `PROVIDER_SMOKE_OUTPUT` | Optional sanitized report path |

Set these through the staging service environment or your secret manager. CLI overrides are available as `--base-url`, `--workspace-id`, `--max-paid-calls`, `--pagespeed-url`, and `--output`; never place `APP_PASSWORD` on the command line.

```bash
npm run smoke:providers:staging
```

The staging smoke is a release-confidence check, not a seed or mutation workflow. It must remain:

- read-only against workspace and provider data;
- cost-capped to the script’s fixed minimal request set;
- isolated to dedicated staging credentials and the staging `DATA_DIR`;
- explicit about `verified`, `failed`, or `unsupported` capabilities;
- safe to rerun without publishing, refreshing a paid bulk job, changing OAuth connections, or writing production data.

Local fixtures remain the default for visual development. A green fixture test does not replace this credentialed smoke, and a provider response does not authorize fabricated UI data.

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

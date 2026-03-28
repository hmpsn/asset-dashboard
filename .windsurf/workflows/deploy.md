---
description: How to commit, push, and verify a deploy to Render
---

# Deploy

## Branch model

```
feature/branch  →  staging  →  main (production)
```

- **`staging`** — all PRs merge here first. Render deploys staging to a preview URL automatically.
- **`main`** — production. Only receives merges from `staging` after manual verification.
- **Never** merge an unverified feature branch directly to `main`.

---

## Shipping a feature

### 1. Pre-flight
1. Run `npx tsx scripts/pr-check.ts` — must pass with zero errors
2. Run `npx tsc --noEmit --skipLibCheck` — zero type errors
3. Run `npx vitest run` — full test suite green
4. Run `git diff --stat` to review unstaged changes

### 2. Push to staging
5. Stage and commit changes
6. Push to your feature branch: `git push origin feature/<name>`
7. Open a PR targeting `staging` (not `main`)
8. CI runs: tsc + vitest + build + pr-check + E2E
9. Merge PR into `staging` once CI is green

### 3. Verify on staging
10. Check Render staging build: `https://dashboard.render.com`
11. Hit the health check on the staging URL: `curl https://<STAGING_URL>/api/health`
12. Smoke-test the feature manually in the staging environment

### 4. Release to production
13. Open a PR from `staging` → `main`
14. Merge once staging verification passes — this triggers the production deploy
15. Check Render production build status
16. Hit production health check: `curl https://<APP_URL>/api/health`

### 5. Post-deploy
17. Update `data/roadmap.json` — mark shipped items with `shippedAt` date
18. If client-facing changes: notify via the activity log
19. Enable any feature flags that were dark-launched: set `FEATURE_<FLAG>=true` in Render env vars

---

## Feature flags

Dark-launch incomplete phases so production never serves broken UI.

| Action | Command / location |
|--------|-------------------|
| Add a new flag | `shared/types/feature-flags.ts` — add to `FEATURE_FLAGS` (default `false`) |
| Enable on staging | Render staging env: `FEATURE_COPY_ENGINE=true` |
| Enable on production | Render production env: `FEATURE_COPY_ENGINE=true` |
| Wrap UI | `<FeatureFlag flag="copy-engine"><YourComponent /></FeatureFlag>` |
| Gate a server route | `if (!isFeatureEnabled('copy-engine')) return res.status(404).json({ error: 'Not found' });` |

---

## Hotfix (production only, use sparingly)

For critical production bugs only:
1. Branch off `main`: `git checkout -b hotfix/<name> main`
2. Fix, verify locally, push
3. PR directly into `main` (skip staging — but CI still runs)
4. After merging to `main`, immediately merge `main` back into `staging` to keep branches in sync

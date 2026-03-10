---
description: How to commit, push, and verify a deploy to Render
---

# Deploy

## Pre-flight
1. Run `npx tsc --noEmit` to ensure no TypeScript errors
// turbo
2. Run `git diff --stat` to review unstaged changes
// turbo
3. Run `git diff --cached --stat` to review staged changes

## Stage & Commit
4. Stage all changes: `git add -A`
5. Write a concise commit message summarizing what shipped. Format:
   ```
   Short summary line

   - Bullet per meaningful change
   - Group related items
   ```
6. Commit: `git commit -m "<message>"`
7. Push: `git push origin main`

## Verify Deploy
8. Check Render dashboard for build status (https://dashboard.render.com)
9. Once deployed, hit the health check: `curl https://<APP_URL>/api/workspace-overview`
10. If deploying to staging too, push the staging branch: `git push origin staging`

## Post-Deploy
11. Update `data/roadmap.json` if new features were shipped (add items with `shippedAt` date)
12. If the deploy includes client-facing changes, consider notifying via the activity log

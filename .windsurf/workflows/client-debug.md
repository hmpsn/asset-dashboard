---
description: How to investigate and fix a client-reported bug or issue
---

# Client Debug

## Gather Context
1. Identify the **workspace ID** and **client user** (if known).
2. Determine if the issue is:
   - **Data issue** — wrong/missing data in the dashboard
   - **UI issue** — visual bug, broken layout, wrong state
   - **API issue** — endpoint returning errors or wrong data
   - **CMS/Webflow issue** — changes not pushing to Webflow
   - **Email issue** — notifications not sending or wrong content

## Investigate

### For data issues:
3. Check the workspace data files: `ls data/<workspaceId>/` (or `$DATA_DIR/<workspaceId>/` in production)
4. Check approval batches: `GET /api/approvals/<workspaceId>`
5. Check activity log: `GET /api/activity?workspaceId=<workspaceId>`

### For API issues:
6. Search server logs on Render Dashboard → Logs tab
7. Find the relevant endpoint in `server/index.ts` — search for the route path
8. Check for error handling gaps (missing try/catch, unhandled promise rejections)

### For CMS/Webflow issues:
9. Verify the Webflow API token is valid: check token expiry
10. Check if the collection ID and item ID are correct
11. Verify the field slug matches what Webflow expects (case-sensitive)
12. Check if items need publishing after update (see `publishCollectionItems`)

### For email issues:
13. Check `server/email.ts` — is the email function being called?
14. Check `server/email-templates.ts` — is the template rendering correctly?
15. Verify SMTP/email service credentials are configured

## Fix
16. Identify the **root cause** — don't patch symptoms.
17. Make the minimal fix. Prefer single-line changes when sufficient.
18. If the fix involves data correction, check if other workspaces are affected.

## Verify & Ship
// turbo
19. Run `npx tsc --noEmit` to ensure no type errors.
20. Test the fix locally if possible.
21. Follow `/deploy` workflow to ship.
22. Notify the client if the fix is for a reported issue (activity log or direct message).

## Common Gotchas
- **CMS updates need publishing** — `updateCollectionItem` creates a draft; must call `publishCollectionItems` after.
- **Internal links extraction** — excludes nav/header/footer; if links seem missing, check the HTML structure.
- **Approval field types** — `field` is a generic string (not just seoTitle/seoDescription), handles CMS slugs too.
- **WebSocket presence** — users must send `identify` action to appear online; shared password logins don't have identity.
- **Tier gating** — some features only work for paid tiers; check if the client's workspace tier allows the feature.

---
description: Checklist for implementing a new feature end-to-end
---

# New Feature

## Plan
1. Check `data/roadmap.json` — does this feature already have a roadmap item? If not, add one to the appropriate sprint with `status: "pending"`.
2. Identify affected files. Use `code_search` to find related code before making changes.
3. Draft a plan: which files to modify, any new files needed, any new API endpoints, any new WebSocket events.

## Implement
4. **Server changes first** — new API endpoints, data models, business logic in `server/`.
5. **Types** — update `src/components/client/types.ts` or add new interfaces as needed.
6. **Frontend components** — modify or create React components in `src/components/`.
7. **WebSocket events** — if the feature has real-time data:
   - Add event name to `server/ws-events.ts` (WS_EVENTS or ADMIN_EVENTS)
   - Call `broadcastToWorkspace()` or `broadcast()` from the server endpoint
   - Handle the event in `useWorkspaceEvents` or `useWebSocket` on the client
8. **Activity logging** — call `addActivity()` for user-visible actions (auto-broadcasts via WS).

## Verify
// turbo
9. Run `npx tsc --noEmit` to check for type errors.
10. Test the feature locally: start the dev server with `npm run dev` and verify in browser.
11. Check that existing features still work (no regressions).

## Ship
12. Update `data/roadmap.json` — set the item to `status: "done"`, add `shippedAt` date.
13. Follow `/deploy` workflow to commit and push.

## Key Conventions
- **No purple** in client-facing UI — use teal, amber, green, blue, red, zinc only.
- **WebSocket events** must be registered in `ws-events.ts` before use.
- **DATA_DIR** — all persistent file storage goes through `server/data-dir.ts` helpers.
- **Email notifications** — add templates in `server/email-templates.ts`, send via `server/email.ts`.
- **Tier gating** — wrap paid features with `TierGate` component or check server-side with tier logic.

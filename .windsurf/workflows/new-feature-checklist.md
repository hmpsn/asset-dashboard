---
description: Checklist to follow before, during, and after implementing any new feature or modification
---

# New Feature / Modification Checklist

Follow this checklist for EVERY feature, bug fix, or modification that touches data visible to users. This ensures consistent wiring and prevents the need for retroactive audits.

## Before Implementation

- [ ] **Identify all data flow points**: Which endpoints read/write the data? Which components display it?
- [ ] **Check existing patterns**: Review `wiring-patterns.md` for the relevant pattern (chat, strategy, reports, WebSocket, email, etc.)
- [ ] **Review `server/ws-events.ts`**: Does a relevant event already exist, or do you need a new one?

## During Implementation — Server Side

- [ ] **Write endpoint has `broadcastToWorkspace()`**: Every POST/PUT/PATCH/DELETE that modifies client-visible data calls `broadcastToWorkspace(wsId, event, data)`
- [ ] **Write endpoint has admin `broadcast()`**: If the data is also visible in admin dashboards, include admin-global `broadcast(event, data)`
- [ ] **Delete endpoints read entity BEFORE deleting**: Capture `workspaceId` before the delete call
- [ ] **External module broadcast**: If the write happens outside `index.ts`, use the `initMyModuleBroadcast` callback pattern (see `data-flow.md` Rule 4)
- [ ] **Public endpoint safety**: `/api/public/*` endpoints don't leak tokens, passwords, or admin-only config
- [ ] **Activity logging**: Significant actions call `addActivity()` with the correct type
- [ ] **New activity type?**: If adding a new `ActivityType`, add it to the union in `activity-log.ts`. If clients should see it, add to `CLIENT_VISIBLE_TYPES` in `listClientActivity()`
- [ ] **New event name?**: Register it in `server/ws-events.ts`

## During Implementation — Frontend Side

- [ ] **Client dashboard handler**: `ClientDashboard.tsx` `useWorkspaceEvents()` has a handler for the event that refetches relevant data
- [ ] **Admin dashboard handler**: Relevant admin component (e.g., `WorkspaceHome.tsx`) handles the event if applicable
- [ ] **State updates**: Components receive fresh data from state (not stale closures or one-time fetches)
- [ ] **Feature toggles**: If feature is tier-gated, `effectiveTier` check is in place and updates when `workspace:updated` fires

## After Implementation

- [ ] **TypeScript build check**: `npx tsc --noEmit` passes with zero errors
- [ ] **Test both sides**: Verify the change appears in real-time on both admin and client dashboards
- [ ] **Update documentation**:
  - `wiring-patterns.md` if a new pattern was introduced
  - `codebase-overview.md` if architecture changed
  - `data/roadmap.json` to mark item as done with implementation notes
- [ ] **Commit with descriptive message**: Include what was added, what events were wired, what endpoints were created/modified

## Quick Reference: Common Pitfalls

1. **Admin-only broadcast**: Using `broadcast()` without `broadcastToWorkspace()` — client dashboard won't update
2. **Missing frontend handler**: Broadcasting an event that no component listens for
3. **Stale workspace data**: Workspace info (tier, settings) fetched once on mount but never refreshed — always handled by `workspace:updated` event now
4. **Delete without pre-read**: Deleting entity then trying to access its workspaceId for broadcast — will be null
5. **String literal typo**: Using `'request:updated'` in one place and `'request:update'` in another — check `ws-events.ts`
6. **Missing null guard**: Broadcasting with `entity.id` when entity could be null after a failed operation

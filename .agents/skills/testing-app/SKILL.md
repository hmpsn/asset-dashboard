# Testing asset-dashboard Locally

## Local Development Setup

1. Copy `.env.example` to `.env` (most values are optional for local dev)
2. Start the backend: `npm run dev:server` (runs on port 3001)
3. Start the frontend: `npm run dev` (Vite on port 5173)
4. Or run both: `npm run dev:all` (uses concurrently)

The server creates a SQLite database automatically on first run at `~/.asset-dashboard/`. No external API keys are required to start the app — features that need them (GSC, GA4, Stripe, etc.) will show placeholder states.

## Authentication

- In dev mode with no `APP_PASSWORD` set, the app skips the login screen entirely
- `JWT_SECRET` falls back to an insecure hardcoded value in dev
- No credentials needed for local testing

## Creating Test Data

- **Create a workspace**: Click the workspace selector dropdown in the sidebar header, then "New workspace" → type a name → click "Add"
- Many features require a Webflow site to be linked (`needsSite: true` in nav config). Without a linked site, those pages show "Link a Webflow site to use this tool"
- You can still navigate to these pages directly via URL to verify routing works

## Sidebar Navigation Structure

The sidebar groups are defined in `src/App.tsx` in the `navGroups` array (~line 348). Current structure:

- **Home** (no group)
- **ANALYTICS**: Search Console, Google Analytics, Rank Tracker
- **SITE HEALTH**: Site Audit, Performance, Links, Assets
- **SEO**: Brand & AI, Strategy, SEO Editor, Schema
- **CONTENT**: Content Pipeline, Calendar, Requests, Content Perf

Note: "Annotations" is NOT a separate sidebar item — it's embedded as a collapsible panel inside Search Console.

## Key Routes

- Workspace home: `/ws/{workspaceId}`
- Content Pipeline: `/ws/{workspaceId}/content-pipeline` (tabbed wrapper with Briefs/Posts/Subscriptions)
- Requests: `/ws/{workspaceId}/requests`
- All routes defined in `src/routes.ts` as the `Page` type union
- Route rendering in `src/App.tsx` `renderContent()` function (~line 401)

## Aggregated Endpoints

- `GET /api/workspace-home/:id` — returns all WorkspaceHome data in a single response (ranks, requests, contentRequests, activity, annotations, churnSignals, workOrders, searchData, ga4Data, comparison)
- `GET /api/workspace-badges/:id` — lightweight badge counts for sidebar
- Server routes in `server/routes/workspace-home.ts` and `server/routes/workspace-badges.ts`

## Testing Network Requests

To verify API call consolidation:
1. Open Chrome DevTools Network tab
2. Filter by "Fetch/XHR"
3. Navigate to workspace Home
4. Filter for "workspace-home" — should see exactly 1 aggregated call
5. Filter for "activity", "annotations", "rank-tracking" — should see 0 results (no redundant individual fetches)

## Running Checks

- TypeScript: `npx tsc --noEmit --skipLibCheck`
- Build: `npx vite build`
- Tests: `npx vitest run` (597+ tests)
- No separate lint command configured

## Devin Secrets Needed

None required for basic local testing. External integrations (Webflow, Google, Stripe) need their respective API keys from `.env.example` but are optional.

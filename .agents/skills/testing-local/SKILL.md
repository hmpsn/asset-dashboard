# Testing asset-dashboard Locally

## Quick Start

```bash
cd ~/repos/asset-dashboard
npm run dev:all   # Starts both Vite (port 5173) and Express (port 3001)
```

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3001
- **Tests**: `npx vitest run`
- **Typecheck**: `npx tsc --noEmit --skipLibCheck`
- **Build**: `npx vite build`

## Authentication

- Without `APP_PASSWORD` in `.env`, the admin dashboard is accessible without login
- The `useAuth` hook checks `/api/auth/check` — if the server reports auth is not required, the app auto-authenticates
- For testing navigation/routing, running without `.env` is sufficient
- Client portal (`/client/:id`) may require a workspace password depending on workspace config — newly created workspaces don't have one

## Workspace Setup for Testing

- On first run with no data, the admin dashboard shows an empty state
- Create a workspace via the workspace selector dropdown (top-left) → "New workspace"
- Workspace IDs follow the pattern `ws_{timestamp}_{index}`
- Many sidebar tabs (Site Audit, Strategy, SEO Editor, etc.) require a linked Webflow site — they show a "Link a Webflow site" placeholder when no site is linked
- Tabs that work without a Webflow site: Home, Assets (media), Brand & AI
- Global tabs (Settings, Roadmap, Prospect, AI Usage) work without any workspace

## URL Routing Structure

### Admin Dashboard
- Home: `/ws/{workspaceId}`
- Workspace tab: `/ws/{workspaceId}/{tab}` (e.g., `/ws/abc/media`, `/ws/abc/brand`)
- Global tabs: `/{tab}` (e.g., `/settings`, `/roadmap`)

### Client Portal
- Overview: `/client/{workspaceId}`
- Tab: `/client/{workspaceId}/{tab}` (e.g., `/client/abc/health`)
- Beta mode: `/client/beta/{workspaceId}` and `/client/beta/{workspaceId}/{tab}`

## Vite Proxy Configuration

- `/api` proxies to Express backend at `http://localhost:3001`
- `/ws` (exact match, regex `^/ws$`) proxies WebSocket to `ws://localhost:3001`
- Important: The proxy uses a regex key `^/ws$` to avoid intercepting `/ws/{id}/{tab}` admin routes. If the proxy key is changed back to a simple `/ws` prefix, page refresh on admin workspace URLs will break in dev mode.

## Common Testing Scenarios

### Navigation/Routing
1. Create a workspace → verify URL updates to `/ws/{id}`
2. Click sidebar tabs → verify URL updates for each tab
3. Click Settings gear → verify URL is `/settings` (no workspace ID)
4. Browser back/forward → verify correct tab loads
5. Deep-link: paste a URL like `/ws/{id}/media` → verify correct tab loads directly
6. Beta mode: navigate to `/client/beta/{id}` → click tabs → verify `/client/beta/` prefix preserved

### Client Portal
- Access via `/client/{workspaceId}` — shows onboarding wizard on first visit (click "Skip for now")
- Beta mode at `/client/beta/{workspaceId}` hides Plans and ROI tabs, shows premium features

## Devin Secrets Needed

None required for basic navigation/routing testing. For full feature testing:
- `APP_PASSWORD` — enables admin auth gate
- `OPENAI_API_KEY` — for AI features (content briefs, chat)
- `WEBFLOW_API_TOKEN` — for Webflow integration features
- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` — for GSC/GA4 data
- `STRIPE_SECRET_KEY` — for payment features

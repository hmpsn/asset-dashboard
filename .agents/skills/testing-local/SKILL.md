# Local Testing — Asset Dashboard

## Quick Start

```bash
cd ~/repos/asset-dashboard

# Create minimal .env (PORT is the only required var for local dev)
echo "PORT=3001" > .env

# Start both servers
npm run dev:all
# Or separately:
npm run dev:server  # Backend on :3001
npm run dev         # Frontend on :5173 (Vite, proxies /api to :3001)
```

Frontend: http://localhost:5173  
Backend: http://localhost:3001  
Vite proxies `/api` requests to the backend automatically.

## Environment

- **No APP_PASSWORD**: Admin dashboard loads without login gate
- **No API keys**: Most features show "not configured" empty states — this is expected
- **No Webflow token**: Site Audit, SEO Editor, Search Console, Analytics tabs show "Link a Webflow site" prompt
- **SQLite DB**: Auto-created on first server start at `~/.asset-dashboard/`

## Navigation Patterns

### Admin Dashboard
- URL pattern: `/ws/{workspaceId}/{tab}`
- Tabs: `home`, `seo-audit`, `search`, `analytics`, `content-briefs`, `workspace-settings`, etc.
- Global pages: `/settings`, `/roadmap`
- Workspace selector: Top-left dropdown in sidebar
- Create workspace: Dropdown → "New workspace" → type name → click "Add"

### Client Dashboard
- URL pattern: `/client/{workspaceId}/{tab}`
- Tabs: insights, performance, health, strategy, inbox, plans, roi
- Requires client user setup (won't load without configured workspace)

## Key API Calls on Page Load

These fire on every admin dashboard load (good for smoke testing API changes):
- `GET /api/auth/check` — auth state
- `GET /api/health` — connection status (shown in status bar)
- `GET /api/workspaces` — workspace list
- `GET /api/queue` — processing queue

## Smoke Test Checklist

1. App loads without crash, status bar shows "Connected"
2. Create a workspace (tests `POST /api/workspaces`)
3. Navigate Home tab — dashboard cards render
4. Navigate Site Audit, Search Console, Analytics — empty states load
5. Navigate Settings — connections and health status render
6. Check browser console — only WebSocket warnings expected (Vite proxy timing), no red errors

## Known Issues

- WebSocket warnings in console (`WebSocket is closed before the connection is established`) are normal with Vite dev proxy — they resolve after initial connection
- `GET /api/public/audit-summary/{wsId}` returns 400 for workspaces without Webflow site — expected
- Sidebar navigation may require clicking precisely on the text; alternatively use URL bar to navigate directly

## Build & Type Check

```bash
npx tsc --noEmit          # Type check
npx vite build            # Production build
npx vitest run            # Run all tests (465 tests across 38 files)
```

## Devin Secrets Needed

None required for basic local smoke testing. Optional secrets for deeper testing:
- `OPENAI_API_KEY` — enables AI features (content generation, chat)
- `ANTHROPIC_API_KEY` — enables Claude-based features
- `WEBFLOW_API_TOKEN` — enables Webflow integration testing
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — enables GSC/GA4 testing
- `STRIPE_SECRET_KEY` — enables payment flow testing

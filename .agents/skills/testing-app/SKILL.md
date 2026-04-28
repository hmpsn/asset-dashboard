# Testing asset-dashboard Locally

## Dev Server Setup

1. Install dependencies: `npm install`
2. Start the server: `npm run dev:server` (Express on port 3001)
3. Start the frontend: `npx vite --host 0.0.0.0` (Vite on port 5173)
4. Or use `npm run dev:all` to start both concurrently

The server creates a SQLite database and data directory at `~/.asset-dashboard/` on first run. Migrations run automatically.

## Authentication Mechanisms

### Admin Auth
- Controlled by `APP_PASSWORD` env var
- If `APP_PASSWORD` is NOT set, admin auth is bypassed entirely (`POST /api/auth/login` returns `{ok: true}` with no token)
- If `APP_PASSWORD` IS set, login returns a JWT token in both the response body and an `auth_token` httpOnly cookie

### User-based JWT Auth
- Create the first owner user via `POST /api/auth/setup` with `{email, password, name}`
- This returns a JWT token that can be used for WebSocket authentication and API calls
- Subsequent users are invited via admin workspace routes

### Client Portal Auth
- Client portal users authenticate via httpOnly cookies (`client_session_<wsId>` and `client_user_token_<wsId>`)
- They do NOT have `auth_token` in localStorage
- Shared password login: `POST /api/public/auth/<wsId>` with `{password}`
- Client user login: `POST /api/public/client-login/<wsId>` with `{email, password}`

## Creating Test Data

```bash
# Create a workspace
curl -X POST http://localhost:3001/api/workspaces \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test Workspace"}'

# Create a client user (use workspace ID from above)
curl -X POST http://localhost:3001/api/workspaces/<wsId>/client-users \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"testpass123","name":"Test User","role":"client_owner"}'

# Set client password on workspace
curl -X PATCH http://localhost:3001/api/workspaces/<wsId> \
  -H 'Content-Type: application/json' \
  -d '{"clientPassword":"portal123"}'

# Create owner user (for JWT token)
curl -X POST http://localhost:3001/api/auth/setup \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@test.com","password":"adminpass123","name":"Admin User"}'
```

### Seeding Recommendations Data

InsightsEngine on the client Health tab requires both audit snapshot data AND recommendations to render fully. You can seed recommendations directly via better-sqlite3:

```bash
cd /home/ubuntu/repos/asset-dashboard && node --input-type=commonjs -e "
const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(process.env.HOME, '.asset-dashboard', 'dashboard.db'));
const recs = [
  { id: 'rec-1', title: 'Fix missing alt text', priority: 'fix_now', impact: 'high', effort: 'low', status: 'pending', category: 'accessibility', trafficAtRisk: 500, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
];
const summary = { fixNow: 1, fixSoon: 0, fixLater: 0, ongoing: 0, totalImpactScore: 500 };
db.prepare('INSERT OR REPLACE INTO recommendation_sets (workspace_id, generated_at, recommendations, summary) VALUES (?, ?, ?, ?)').run('<wsId>', new Date().toISOString(), JSON.stringify(recs), JSON.stringify(summary));
db.close();
"
```

**Note:** InsightsEngine also requires `auditDetail` (from `/api/public/audit-detail/<wsId>`), which needs the workspace to have a `webflowSiteId` AND at least one audit snapshot in the `snapshots` table. Without audit data, the InsightsEngine renders only the empty state (Shield icon).

## DOM Inspection via CDP

The `computer` tool's console feature may intermittently fail to detect Chrome as the foreground window. For reliable DOM inspection, use Chrome DevTools Protocol (CDP) directly via WebSocket:

```bash
# 1. Find the page's WebSocket URL
curl -s http://localhost:29229/json | python3 -c "
import sys, json
for p in json.load(sys.stdin):
    if 'your-url-fragment' in p.get('url',''):
        print(p['webSocketDebuggerUrl'])
"

# 2. Evaluate JavaScript in the page via CDP
cd /home/ubuntu/repos/asset-dashboard && node -e "
const WebSocket = require('ws');
const ws = new WebSocket('<webSocketDebuggerUrl>');
ws.on('open', () => {
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: \`
        (function() {
          const el = document.querySelector('your-selector');
          const cs = window.getComputedStyle(el);
          return JSON.stringify({ display: cs.display, width: cs.width });
        })()
      \`,
      returnByValue: true
    }
  }));
});
ws.on('message', (data) => {
  const resp = JSON.parse(data);
  if (resp.id === 1) { console.log(resp.result?.result?.value); ws.close(); }
});
setTimeout(() => { ws.close(); process.exit(1); }, 5000);
"
```

This approach is more reliable than Playwright `connectOverCDP()` which may timeout, and more reliable than the `computer` console tool which requires Chrome to be detected as the foreground window.

## Admin Page Navigation Paths

| Page | URL Pattern | Notes |
|------|-------------|-------|
| Dashboard Home | `/ws/<wsId>` | Shows Command Center |
| Workspace Settings | `/ws/<wsId>/workspace-settings` | Has tabs: Connections, Features, Publishing, etc. |
| Content Pipeline | `/ws/<wsId>/content-pipeline` | Has sub-tabs: Planner, Calendar, Briefs, Posts, Subscriptions |
| Content Manager | Content Pipeline → Posts tab | Renders within ContentPipeline, not a separate route |
| Features | `/features` | Global page (not workspace-scoped) |
| Site Audit | `/ws/<wsId>/seo-audit` | Requires webflowSiteId |
| Asset Audit | `/ws/<wsId>/assets` | Under SITE HEALTH |
| Client Portal | `/client/<wsId>?tab=<tab>` | Tabs: insights, performance, health, strategy, inbox, schema, plans |

## CSS Token Testing Notes

- **Border-radius normalization**: CSS normalizes `6px 12px 6px 12px` to `6px 12px` in computed styles (shorthand when opposite corners match). So `var(--radius-signature)` resolving to `6px 12px` in computed styles is correct.
- **Inline-flex blockification**: When an `inline-flex` element is a direct child of a flex container, the browser "blockifies" it to `flex` per CSS spec. This is expected — check the element's className for `inline-flex` rather than relying solely on computed `display`.
- **Token resolution check**: Verify CSS custom properties resolve by reading `getComputedStyle(document.documentElement).getPropertyValue('--token-name')`.

## WebSocket Testing

The WebSocket endpoint is at `ws://localhost:3001/ws`. Use the `ws` npm package (already in node_modules) for programmatic testing:

```javascript
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3001/ws');

// Admin auth flow:
ws.on('open', () => {
  ws.send(JSON.stringify({ action: 'authenticate', token: '<jwt_token>' }));
});
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.action === 'authenticated' && msg.ok) {
    ws.send(JSON.stringify({ action: 'subscribe', workspaceId: '<wsId>' }));
  }
});

// Client portal flow (no auth needed):
ws.on('open', () => {
  ws.send(JSON.stringify({ action: 'subscribe', workspaceId: '<wsId>' }));
});
```

## Testing JWT_SECRET Production Check

```bash
NODE_ENV=production npx tsx server/index.ts
# Should crash with: "JWT_SECRET environment variable must be set in production"
```

## Build & Test Commands

- Build: `npx vite build`
- Tests: `npx vitest run` (339+ tests)
- TypeScript check: `npm run typecheck` (uses `tsc -b --noEmit` with project references; do NOT use plain `npx tsc --noEmit` against root tsconfig as it checks zero files)
- PR check: `npx tsx scripts/pr-check.ts`

## Known Limitations

- **No Webflow API**: Without `WEBFLOW_API_TOKEN`, site audits, page listing, and SEO features that depend on Webflow data won't work. SeoAudit tab will show empty state.
- **No OpenAI API**: Knowledge base generation, brand voice generation, and AI-powered features require `OPENAI_API_KEY`.
- **No Stripe**: Payment features require `STRIPE_SECRET_KEY`.
- **CDP port 29229**: Chrome DevTools Protocol is available at `http://localhost:29229`. Playwright `connectOverCDP` may timeout; prefer raw WebSocket CDP approach (see DOM Inspection section above).
- **Rate limiting**: The `publicApiLimiter` uses per-path mode. The `globalPublicLimiter` is IP-based at 200 req/min. Avoid changing `publicApiLimiter` to global mode as it shares the same bucket key format with `globalPublicLimiter`, causing double-counting.

## Devin Secrets Needed

No secrets are required for basic local testing. Optional secrets for extended testing:
- `WEBFLOW_API_TOKEN` — for testing Webflow-dependent features
- `OPENAI_API_KEY` — for testing AI features
- `STRIPE_SECRET_KEY` — for testing payment flows

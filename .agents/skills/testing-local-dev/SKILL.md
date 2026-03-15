# Testing asset-dashboard Locally

## Dev Server Setup

```bash
# Start both frontend and backend concurrently
npm run dev:all

# Or start separately:
npx tsx server/index.ts          # Backend on port 3001
npx vite --port 5173              # Frontend (Vite), proxies /api to :3001
```

- Vite may auto-increment the port if 5173 is in use (check `/tmp/frontend.log` or terminal output)
- Backend logs diagnostics on startup: WEBFLOW_API_TOKEN, OPENAI_API_KEY status
- If port 3001 is in use from a prior run, kill stale processes: `pkill -f "tsx server/index.ts"`

## Authentication

- Without `APP_PASSWORD` env var, auth is **not required** (`/api/auth/check` returns `{"required": false}`)
- No login screen appears in local dev without APP_PASSWORD
- This is the easiest path for local testing

## Creating Test Data

`sqlite3` CLI may not be installed. Use a Node script with `better-sqlite3` instead:

```bash
node --input-type=commonjs -e "
const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(process.env.HOME, '.asset-dashboard', 'dashboard.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
// Insert workspace, posts, etc.
db.close();
"
```

### Creating a workspace with publishTarget:
```bash
# Create workspace
curl -s -X POST http://localhost:3001/api/workspaces \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test Workspace","webflowSiteId":"fake-site-123","webflowSiteName":"Test Site"}'

# Set publishTarget
curl -s -X PATCH http://localhost:3001/api/workspaces/WORKSPACE_ID \
  -H 'Content-Type: application/json' \
  -d '{"publishTarget":{"collectionId":"fake-col-123","collectionName":"Blog Posts","fieldMap":{"title":"name","slug":"slug","body":"post-body"}}}'
```

### Creating test content posts:
Insert directly into SQLite via Node (see above pattern). Key fields:
- `id`, `workspace_id`, `brief_id`, `target_keyword`, `title`, `introduction`, `sections` (JSON array), `conclusion`, `status` ('draft'|'review'|'approved'|'generating'), `total_word_count`, `target_word_count`
- `sections` must be a JSON string array of objects with `index`, `heading`, `content`, `wordCount`, `status`
- Note: sections may optionally have a `keywords` array — code should guard against it being undefined

## UI Navigation Paths

- **Workspace Settings > Publishing tab**: Select workspace → gear icon or "Settings →" link → click "Publishing" tab
- **Content Manager**: Sidebar → CONTENT group → "Content"
- **PostEditor**: Content Manager → click on a post title
- **Publish button** appears in ContentManager list when: `hasPublishTarget` AND post status is `approved` or `review`
- **Publish button** appears in PostEditor header when: `hasPublishTarget` AND post status is `approved`, `draft`, or `review`

## Testing Without API Keys

Without `WEBFLOW_API_TOKEN`:
- PublishSettings will show "Failed to load collections" toast (expected)
- Clicking Publish shows error: "No Webflow API token configured"
- All UI rendering, navigation, button visibility, and error handling can be verified
- Cannot test actual Webflow CMS publishing

Without `OPENAI_API_KEY`:
- AI-suggested field mappings won't work
- DALL-E image generation won't work
- Content generation won't work

## Devin Secrets Needed

- `WEBFLOW_API_TOKEN` — Required for testing actual Webflow CMS publishing
- `OPENAI_API_KEY` — Required for AI field mapping suggestions, content generation, DALL-E images
- `APP_PASSWORD` — Optional; only needed if testing auth-gated flows

## Known Gotchas

- `section.keywords` may be undefined on content post sections — always guard with `section.keywords &&` before accessing `.length`
- Vite port may auto-increment if prior instances are still running
- The `npm run dev:all` command uses `concurrently` and may not cleanly terminate — use `pkill` to clean up
- SQLite DB path: `~/.asset-dashboard/dashboard.db`

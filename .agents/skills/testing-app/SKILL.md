# Testing asset-dashboard Locally

## Dev Servers

### Frontend (Vite)
```bash
cd ~/repos/asset-dashboard && npm run dev
```
Runs on http://localhost:5173

### Backend (Express)
```bash
cd ~/repos/asset-dashboard && npm run dev:server
```
Runs on http://localhost:3001

Both servers must be running for the app to function.

## Build & Lint Verification
```bash
npx tsc --noEmit --skipLibCheck   # typecheck
npx vite build                     # production build
npx vitest run                     # unit tests (596 passing, 1 pre-existing failure in users-api.test.ts)
```

## Test Workspace
- The app auto-creates a "Test Workspace" on first backend start
- Workspace ID: dynamically generated (format: `ws_TIMESTAMP_1`)
- Site ID: `test-site-123`
- No real Webflow/OpenAI API keys are configured by default
- The workspace selector is in the top-left sidebar

## Navigation to Key Components

After selecting a workspace in the sidebar:

| Sidebar Item | URL Path | Component |
|---|---|---|
| Home | `/ws/{id}` | WorkspaceHome |
| Assets → Browse tab | `/ws/{id}/media` | MediaTab → AssetBrowser |
| SEO Editor | `/ws/{id}/seo-editor` | SeoEditor (via SeoEditorWrapper) |
| Strategy | `/ws/{id}/seo-strategy` | KeywordStrategy |
| Schema | `/ws/{id}/seo-schema` | SchemaSuggester |
| Content Pipeline | `/ws/{id}/content-pipeline` | ContentPipeline (embeds ContentBriefs) |
| Site Audit | `/ws/{id}/seo-audit` | SeoAudit |

Notes:
- ContentBriefs is embedded inside ContentPipeline (Briefs tab)
- PostEditor opens inline when clicking a generated post from ContentBriefs
- AssetBrowser is under MediaTab's "Browse" sub-tab (not directly in sidebar)

## Testing Without API Keys

Without Webflow/OpenAI API keys:
- Components will load but show empty states or error messages about missing tokens
- This is sufficient to verify component rendering, prop wiring, and layout
- Backend will log 500 errors for Webflow API calls (expected)
- For full end-to-end testing (AI generation, asset operations, SEO edits), real API keys are needed

## Common Issues

- **Backend script name**: Use `npm run dev:server` (not `npm run server`)
- **WebSocket warnings in console**: Pre-existing, safe to ignore
- **CSS @import warnings from Vite**: Pre-existing postcss warning about @import ordering, does not affect functionality
- **Prop mismatch bugs after extraction**: When components are extracted into sub-modules, callback prop names may not match between parent and child. TypeScript catches data prop mismatches but callbacks typed as `(value: string) => void` can silently accept wrong names. Always verify interactive elements work after extraction.

## Devin Secrets Needed

None required for basic component rendering tests. For full E2E testing:
- `WEBFLOW_API_TOKEN` - Webflow API token for asset/page operations
- `OPENAI_API_KEY` - OpenAI key for AI generation features

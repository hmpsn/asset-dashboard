# Testing Content Planner UI Components

## Overview
The Content Planner feature has 5 UI components: TemplateEditor, MatrixGrid, MatrixBuilder, CellDetailPanel, and MatrixProgressView (client-facing). These are located in `src/components/matrix/` and `src/components/client/`.

## Dev Preview Harness
- `src/components/DevPreview.tsx` renders all 5 components with mock data
- Temporary route at `/dev/matrix` in `src/App.tsx` loads the harness
- Mock data is in `src/components/matrix/mockData.ts` (MOCK_TEMPLATE, MOCK_MATRIX, MOCK_TEMPLATES)
- Mock matrix has 6 services x 3 cities = 18 cells with various statuses

## Running the Dev Server
- `npm run dev` starts Vite frontend on port 5173 (may use 5174/5175 if ports busy)
- `npm run dev:all` runs both backend and frontend concurrently
- If you get HMR cache errors after code changes, kill the Vite process and restart fresh
- `lsof` may not be available — use `pkill -f vite` or `ps aux | grep vite` to find/kill stale processes

## Key Testing Scenarios

### 1. Grid Cell Population (variableName alignment)
- Navigate to `/dev/matrix`, scroll to MatrixGrid section
- If grid cells are empty/blank, the `variableName` field in MatrixDimension types may be misaligned with the server
- Server shared types use `variableName` (not `name`), check `shared/types/content.ts`
- All grid lookups use `cell.variableValues[dim.variableName]` to match rows/columns

### 2. Flag Display (clientFlag alignment)
- Server uses `clientFlag` (string) and `clientFlaggedAt` (string), NOT `flagged` (boolean) or `flagComment`
- Check `shared/types/content.ts` MatrixCell interface for authoritative field names
- Flag icons appear in MatrixGrid cells and MatrixProgressView cells when `cell.clientFlag` is truthy
- To test flag rendering, add `clientFlag: 'Needs revision'` to a mock cell in mockData.ts

### 3. Status Enum Alignment
- Server uses: `planned`, `keyword_validated`, `brief_generated`, `review`, `approved`, `draft`, `in_production`, `published`
- Frontend previously used `keyword_optimized` and `client_review` which don't exist on server
- Always verify status names match `shared/types/content.ts` MatrixCellStatus type

### 4. No Purple Rule (Three Laws of Color)
- Purple is reserved for admin AI features only (AdminChat, SeoAudit)
- All Content Planner components must use zinc/blue/amber/teal/green/orange
- Check status legends, variable pills, badges, and detail panel elements
- "Client Review" / "Your Review" status uses blue, NOT purple

### 5. Cell Selection and Detail Panel
- Single-click selects a cell (teal ring, toolbar shows count)
- Double-click opens CellDetailPanel with cell data
- Ctrl+click adds to selection, Shift+click selects range
- Detail panel must show fresh data (stores cell ID, not object)

## Common Pitfalls
- **Type divergence**: Frontend local types in `src/components/matrix/types.ts` may drift from server shared types in `shared/types/content.ts`. Always check both files match.
- **Vite HMR cache**: After significant type changes, Vite's HMR may serve stale modules. Restart the dev server.
- **API method mismatch**: Template update uses PUT (not PATCH). Check `src/api/content.ts`.
- **MatrixBuilder crossProduct**: Uses `first.variableName` to key generated cells. If wrong, preview shows "undefined x undefined".

## Lint and Typecheck
```bash
npx eslint src/components/matrix/ src/components/client/
npx tsc --noEmit
```

## Devin Secrets Needed
None required for testing with mock data. Backend integration testing may need workspace auth tokens.

# Book-level Command Center parity contract

Status: implementation contract for W4.1b; visual owner review pending.

## Route and mount

- Canonical URL: `/`.
- Mount: `BOOK_REBUILT_SURFACE` in `src/components/layout/rebuiltSurfaces.ts`.
- Gate: the existing global `ui-rebuild-shell` flag only.
- Flag ON at `/`: mount the book surface inside `RebuiltAppChrome` with no selected workspace.
- Flag OFF at `/`: preserve the legacy `WorkspaceOverview` branch unchanged.
- `/ws/:workspaceId`: continue mounting the existing workspace Cockpit through `REBUILT_SURFACES['home']`.

The book surface is deliberately registered separately from `Page`-keyed workspace surfaces. Reusing `home` would make the same route identity mean both a portfolio and a workspace, and changing root route parsing would disturb the legacy branch.

## Persona and trust contract

The primary user is a busy operator starting morning triage across a client book. They need to know which workspace deserves attention first, why, and who is presently active. They will distrust the surface if it silently re-ranks server results, implies all money frames share an attribution window, or hides establishing/empty accounts.

## Data authority

- `GET /api/cockpit/portfolio` is the sole authority for workspace order, attention rank, work-queue classification, verdicts, reconciled counts, and unreconciled money states.
- The client must render `rollup.workspaces` in response order. No sort, priority calculation, or verdict reconstruction is allowed in the browser.
- `/api/presence` plus the existing global `presence:update` event is the authority for presence indicators.
- Money totals render the server's `status: 'not_yet_reconcilable'`, `value: null`, and reason. No dollar sign, zero, sum, or fallback aggregate may replace that state.

## Composition

1. Compact Command Center context and generated-at stamp.
2. Reconciled count band: workspace count, attention-needed count, and total queue items.
3. Reconciled stream and verdict count summaries.
4. Two explicit money-status cards, both labeled “Not yet reconcilable” with the server reason.
5. Server-ordered workspace cards: attention rank, workspace identity, live presence, verdict headline/narrative, stream counts, a bounded work preview, and an action to the workspace Cockpit.

The layout is a restrained operations ledger: dense, calm, and evidence-led. Teal is reserved for actions, blue for read-only optimization data, emerald for on-track/presence success, amber for watch/growth, red for at-risk, and neutral tokens for establishing/unavailable states. No purple, raw hex, palette drift, or hand-rolled card primitive.

## State contract

- Loading: layout-preserving skeletons with “Ranking workspace attention…” status copy.
- Error: empathetic retry state for the portfolio read.
- Empty: truthful “No workspaces in this book yet” state with a Settings action.
- Presence loading/error are shown as unknown states, never misrepresented as “offline.”
- A workspace with no queue rows still renders its verdict and zero stream totals.

## Acceptance tests

- Real `useFeatureFlag` loading-to-ON transition mounts the book surface without a hook-order failure.
- Root wiring mounts book surface only with `ui-rebuild-shell` ON; flag-OFF retains `WorkspaceOverview`.
- Workspace cards preserve server response order.
- All reconciled count families render.
- Both money totals render “Not yet reconcilable,” include the server reason, and render no fabricated currency aggregate.
- The rebuilt registry census names the book root separately from the 28 `Page` direct mounts.

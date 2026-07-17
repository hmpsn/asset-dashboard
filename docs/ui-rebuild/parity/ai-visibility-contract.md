# AI Visibility Prototype Parity Contract

Surface: `ai-visibility` / AI Visibility  
Route: `/ws/:workspaceId/ai-visibility`  
Status: `awaiting owner approval`; W3.1 implements the embedded default of a dedicated lightweight receiving home, subject to owner veto at PR review

## Prototype And Production Authority

- Prototype source: `docs/ui-rebuild/phase-a/surfaces/ai-visibility.json`, limited by the W3.1 campaign contract to the established aggregate visibility capabilities.
- Rebuilt implementation: `src/components/ai-visibility-rebuilt/AiVisibilitySurface.tsx`.
- Direct mount: `src/components/layout/rebuiltSurfaces.ts` `REBUILT_SURFACES['ai-visibility']`.
- Navigation identity: `src/lib/navRegistry.tsx`, in the rebuilt-only `Search & Site Health` zone.
- Production capability owner: `src/components/strategy/AiVisibilityPanel.tsx`, backed by `useAiVisibility` and `useAiVisibilityRefresh`.

The W3.1 campaign contract supersedes the broader Phase A consolidation ticket for this task. This is a lightweight home for the live LLM-mention panel, not a move of LLMs.txt, AEO review, branded-demand, or any prototype-only AI Answer Monitor capability.

## Required Interaction And Composition

1. The dedicated page uses the compact rebuilt surface header and one established AI visibility panel.
2. Share of voice, mention volume/trend, co-mentioned competitors, and cited source domains remain truthful projections of the existing aggregate read.
3. Share of voice, mention trend, source domains, and `Refresh AI visibility` each have exactly one reachable flag-ON home on this page.
4. Refresh calls the existing `refresh-ai-visibility` background-job path through `useAiVisibilityRefresh`; the surface introduces no job, endpoint, query key, or mutation semantics.
5. Empty and refresh-error states remain owned by the reused panel, including a reachable first-refresh control.

## Route, Flag, And Legacy Contract

- `adminPath(workspaceId, 'ai-visibility')` resolves to `/ws/:workspaceId/ai-visibility`; the surface introduces no local query state.
- `ui-rebuild-shell` is the only gate. The retired `ai-visibility` product flag is not resurrected.
- The nav entry is hidden while `ui-rebuild-shell` is OFF and appears in `Search & Site Health` while ON.
- The flag-OFF Keyword Hub continues to mount its existing `AiVisibilityPanel` byte-identically.
- No legacy route, tab, feature-flag row, or redirect is removed or changed under D8.

## Capability And Data Boundaries

- Aggregates only: no raw LLM answer transcripts or prompt monitoring.
- ChatGPT remains the sole measured platform supported by the existing read.
- Growth/tier, provider, credit-budget, cancellation, activity, WebSocket invalidation, and workspace-intelligence behavior remain backend-owned and unchanged.
- AI Search Ready, LLMs.txt, branded demand, scheduled scans, composite scoring, and client graduation are outside this W3.1 surface.

## Automated Test Floor

- Real `useFeatureFlag` / `ui-rebuild-shell` loading-to-ON transition mounts the registry-owned surface without throwing.
- Populated rendering asserts exact-once share-of-voice, mention-trend, source-domain, and refresh capability homes.
- Refresh calls `rankTracking.refreshAiVisibility(workspaceId)` exactly once.
- Route, rebuilt-mount, nav-zone, and flag-ON-only nav census tests include `ai-visibility`.

## Owner Review Boundary

The dedicated lightweight surface is the campaign's embedded default, not a recorded owner approval. PR review may veto it in favor of a temporary Keywords mount. Until that decision, this packet remains `awaiting owner approval`; automated gates are supporting evidence only.

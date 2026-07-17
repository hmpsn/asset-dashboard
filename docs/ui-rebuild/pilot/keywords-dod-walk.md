# Keywords Pilot DoD Walk

**Date:** 2026-07-06  
**Surface:** Admin `seo-keywords` UI Rebuild pilot  
**Authority:** `docs/ui-rebuild/phase0/surfaces/keywords.md` + `docs/ui-rebuild/pilot/keywords-data-source-ledger.md`  
**Result:** Additive parity met for the pilot. Rows #1-47 are resolved as preserved, improved, new, or explicitly deferred.

## Capability Walk

| # | Capability | Resolution | Evidence |
|---|---|---|---|
| 1 | Admin route and nav entry | Preserved | `App.tsx` mounts `KeywordsSurface` at the top-level layout branch only when `ui-rebuild-shell` is on and the tab is `seo-keywords`; flag-off and non-Keywords tabs keep the legacy shell. |
| 2 | `?tab=` receiver | Preserved | `useKeywordsSurfaceState` accepts rebuilt lenses and legacy segment tabs, mapping legacy tabs to filters. |
| 3 | `?q=` drawer deep link | Preserved | `useKeywordsSurfaceState` reads the hub query param and `KeywordDrawer` opens from the selected keyword. |
| 4 | Cross-surface deep-link senders | Preserved | Existing `buildHubDeepLinkQuery` senders remain compatible because the receiver still supports `?tab=` and `?q=`. |
| 5 | KPI summary cards | Improved | Existing count/value KPIs plus server-owned Avg. position and Position change ship with DS `MetricTile`; missing rank/prior evidence remains unavailable rather than zero. `DEF-kw-002` is complete. |
| 6 | Summary loading skeletons | Preserved | Summary and initial-view loading render `Skeleton` tiles, never zero-value placeholders. |
| 7 | Summary-fetch error with usable rows | Preserved | Summary/initial error states render retry affordances and stale data warnings when cached data exists. |
| 8 | Truncation honesty banner | Preserved | Table renders the display-cap banner from `rawEvidenceTotal - rawEvidenceReturned`. |
| 9 | Metric-window disclosure | Preserved | Table includes the `GSC_METRIC_WINDOW_DAYS` disclosure for clicks, impressions, rank, and volume. |
| 10 | Primary status segments | Preserved | Primary filters are DS `FilterChip`s and retain All, In Strategy, Tracked, Needs Review, Retired, Local, and Striking Distance. |
| 11 | Advanced filters | Preserved | Server-counted non-primary filters render in the advanced filter select. |
| 12 | Debounced keyword/page search | Preserved | `SearchField` is URL-backed and debounced through `useKeywordsSurfaceState`. |
| 13 | User sort controls | Preserved | Sort chips drive the server sort/direction query. |
| 14 | Server pagination | Preserved | Table renders total rows plus previous/next pagination from `pageInfo`. |
| 15 | Empty-state branching | Preserved | Default empty state links to Strategy; filtered empty state offers Clear filters. |
| 16 | Row error retry | Preserved | Rows/initial errors render inline retry and preserve stale rows when present. |
| 17 | Row metric columns | Preserved | DataTable shows rank, clicks, volume, difficulty, opportunity, and display-only value. |
| 18 | Local-visibility column | Preserved | Table shows local lifecycle/priority; drawer keeps per-market local detail. |
| 19 | Row provenance badges | Preserved | Lifecycle, From gap, Auto-managed, Raw evidence, and source labels remain visible. |
| 20 | Multi-select | Preserved | DataTable checkbox column and Select visible action use the shared toggle-set helper. |
| 21 | Bulk lifecycle actions | Preserved | Bulk bar keeps add_to_strategy, track, pause, retire, decline, protected confirm, and result toast/banner feedback. |
| 22 | Per-row action catalog | Preserved | Drawer footer renders every server-provided `nextActions` entry, not a truncated subset. |
| 23 | Hard delete channel | Preserved | Drawer exposes hard delete separately with destructive confirmation and no lifecycle-action overload. |
| 24 | Protected keyword model | Preserved | Protected/lost badges, protection reason, and force-confirm paths remain visible. |
| 25 | Manual add keyword | Preserved | Header add input writes through rank-tracking add and reports toast errors/success. |
| 26 | Row click to detail drawer | Preserved | DataTable rows open the DS `Drawer` with instant selected-keyword state. |
| 27 | Mutation feedback | Improved | Shared tokenized Toast plus inline result/error banners cover row, drawer, add, bulk, and refresh mutations. |
| 28 | Origin/source descriptor and strategy context | Preserved | Drawer includes tracking source, assigned page, replacement, feedback, and source-label provenance. |
| 29 | Source labels | Preserved | Drawer renders `sourceLabels[]` as badges with DS tones. |
| 30 | Outcome read-back chip | Preserved | Drawer renders `detail.outcome` through `OutcomeReadbackChip`. |
| 31 | Pin/unpin | Preserved | Drawer keeps the rank-tracking pin mutation and pressed state. |
| 32 | Rank trend | Preserved with deferral | Drawer lazy history sparkline remains; inline list sparkline/7-day delta is deferred in `DEF-kw-001`. |
| 33 | Live SERP detail | Preserved | Drawer shows national live rank, AI Overview presence/citation, and SERP feature badges. |
| 34 | Per-market local visibility | Preserved | Drawer shows market rows, local pack rank, match confidence, competitors, and local refresh. |
| 35 | Replaced-by chain | Preserved | Drawer replacement banner links to the replacement keyword through the hub deep link. |
| 36 | Protection/lost-visibility header badges | Preserved | Drawer header shows Protected, Lost visibility, and Pinned badges. |
| 37 | Drawer navigation actions | Preserved | `review_page` remaps to SEO Editor; `generate_brief` remaps to the content pipeline; local refresh actions remain. |
| 38 | Drawer accessibility | Improved | Rebuilt drawer uses the DS `Drawer` primitive and component a11y coverage. |
| 39 | Variants and value transparency | Preserved | Value reasons, current/upside monthly values, and no-CPC empty states render from server fields only. |
| 40 | National refresh trigger | Preserved | Drawer keeps the `national-serp-tracking` flag gate and refresh mutation. |
| 41 | AI Visibility panel | Preserved elsewhere | Authority ledger maps AI Visibility to Brand & AI; Keywords does not re-own it. |
| 42 | Local Presence handoff | Preserved elsewhere | Authority ledger maps the broad handoff to Local Presence; Keywords keeps keyword-level local evidence. |
| 43 | Client keyword feedback | Improved | Feedback panel is relocated into Keywords with counts, reasons, and Add to Strategy action. |
| 44 | WebSocket invalidation | Preserved | Rebuilt surface registers `RANK_TRACKING_UPDATED`, `SERP_SNAPSHOTS_REFRESHED`, and `STRATEGY_UPDATED` handlers. |
| 45 | Combined initial view fetch | Preserved | Rebuilt surface consumes `/initial` for supported filters and falls back to split endpoints only for `local_candidates`. |
| 46 | Locked state | Improved | 402/403 render an explicit permission state instead of a broken empty table. |
| 47 | MCP keyword tooling | Preserved | UI rebuild does not alter MCP or server write paths. |

## Prototype Proposals

| Proposal | Resolution |
|---|---|
| N1 five-lens model | Built: Rankings, Opportunities, Pages, Clusters, Lifecycle. |
| N2 lifecycle stage taxonomy | Built as a server-derived `lifecycleStage` field with unit coverage. |
| N3 Pages lens | Built as lightweight keyword grouping only, per D3 scope. |
| N4 Clusters lens | Built from summary topic clusters plus row assignments. |
| N5 inline row sparkline and 7-day delta | Deferred in `DEF-kw-001`. |
| N6 intent chips | Built with canonical `IntentTag`; no purple local intent chip. |
| N7 Stage into Insights Engine | Mapped to existing KCC action semantics; no new undefined staging flow. |
| N8 SERP external link | Not introduced; existing paid SERP evidence and refresh remain preserved. |
| N9 intent/stage toolbar filters | Existing server filters preserved; new intent/stage taxonomy not introduced silently. |

## Deferrals

- `DEF-kw-001`: Inline list-row rank sparkline and 7-day delta wait for a batched history-by-keyword read model.
- `DEF-kw-002`: Avg-position and period-over-period KPI variants wait for server-owned rollup and delta semantics.

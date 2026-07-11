# Post-Parity Functionality, Wiring, AI, And Optimization Audit

Audit date: 2026-07-11
Branch: `codex/ui-visual-parity`
Scope: legacy-versus-rebuilt capability preservation, runtime wiring, general bugs, AI summaries/workspace-intelligence integration, and behavior-preserving performance opportunities
Status: safe repair and first optimization waves implemented; seven owner decisions are `awaiting owner approval`; final all-project and bundle gates remain open

This audit follows the owner-approved visual baseline. It does not revoke the original 26-route approval or the later Page Intelligence / Content Performance receiving-home approval. It also does not convert an automated reviewer `PASS` into approval of a newly discovered exception.

## Executive Result

- No P0 functionality loss was found.
- Real safe-local functionality, state, invalidation, overlay, cache, AI-context, and summary-cadence defects were fixed.
- Six high-value frontend performance wins were implemented without changing route meaning, capability homes, or settled loaded composition.
- Seven material choices remain owner-gated because they change composition, capability grouping, time authority, AI refresh semantics, or shared design-system behavior.
- The clean current all-project suite is complete; an explicit bundle-budget disposition is still required, so this audit is not a release-readiness claim.

## Implemented Safe Repair Wave

| Commit | Scope | Result |
|---|---|---|
| `8f6c3ce83` | Client review targets | Preserves safe Site Audit approval field identities and shared deliverable-adapter semantics. |
| `476db936a` | Workspace-owned state | Isolates App, Admin Chat, and Page Intelligence state across workspace/route changes and pins route-state precedence. |
| `8a8f42f85` | Admin refresh wiring | Corrects query keys, refetch behavior, Brand/Pipeline/asset/content-performance refreshes, formatters, and WS invalidation coverage. |
| `1757ef409` | Provider-backed summaries | Invalidates workspace intelligence after rank, local GBP, LLM mention, LLMs.txt, and intelligence-cron producer updates. |
| `7405e802b` | AI reliability evidence | Aligns deterministic reliability evidence matching and reports with actual runtime operation paths. |
| `4e647d093` | Stacked overlays | Makes only the topmost Modal/Drawer/ConfirmDialog own Escape, backdrop, and focus; shares one reference-counted body scroll lock. |
| `ba62f607e` | Digest/calendar/cache freshness | Aligns digest calendar selection and invalidates digest, workspace intelligence, and learnings caches from their real producers. |
| `09bc10bfa` | Generated intelligence context | Repairs in-flight cache invalidation races, briefing voice authority, evidence-hashed LLMs.txt summaries, Admin Chat intent/provider context, prompt deduplication, and resilient conversation-summary cadence. |
| `a90971567` | Navigation and state wiring | Restores client WS subscriptions, flag-aware palette identity/folding, Pipeline raw-route editor remounts, and Page Rewriter URL/request epoch safety. |
| `3b7f4343f` | Page Intelligence verification closure | Pins real flag loading-to-ON and flag-off receivers, exact-once analysis/edit/tracking/copy/handoff actions, cold `?page=` initialization after data resolution, and the contained 390px list-to-detail/back floor. |
| `e4b12beb7` | Page Intelligence focus and refresh-link closure | Transfers/restores focus across the mobile hidden-list flow and waits through cached background page refreshes before consuming a requested page identity. |

These repairs are implemented and reviewed. They are not new visual-approval events.

## AI Summary And Intelligence Findings

The safe wave closes the directly fixable integration gaps:

- workspace-intelligence invalidation cannot be defeated by an older in-flight build publishing after a clear;
- provider-backed producers clear the affected intelligence/digest/learnings caches;
- briefing prompt voice resolves across draft, calibrated, legacy, and sample authority states;
- LLMs.txt summaries are evidence-hashed and sanitized rather than reused against changed evidence;
- Admin Chat scopes GSC/GA4 to the requested workspace, gates paid backlink reads by intent, preserves residual insight evidence while deduplicating prompt blocks, and sanitizes context;
- chat auto-summaries trigger on crossed 6/20/40-message thresholds, recover from odd counts and failures, preserve manual summaries, protect last-good state, and prevent old session incarnations or slower calls from overwriting newer summaries;
- deterministic AI reliability reports match named runtime operations.

Two semantic choices remain owner-gated: monthly-digest time authority (`AUD-D5`) and POV evidence/voice refresh policy (`AUD-D6`).

## Safe Optimization Waves

| Commit | Quick win | Preserved contract |
|---|---|---|
| `f8c9fa0f9` | Lazy-load Admin Chat's heavy ChatPanel only after open and disable the invisible smart-placeholder intelligence read while closed. | Chat history, sessions, workspace isolation, focus, and open-state behavior remain. |
| `ffd900f20` | Scope Search & Traffic provider queries by active lens, reuse parent projections, use analytics stale-time authority, and narrow event-specific invalidation while retaining the generic workspace-update fallback. | Search/Traffic/Annotations/hidden Overview routes, explicit Re-scan, provider truth, broad workspace-mutation refresh, and annotation behavior remain. |
| `fe8ab70a2` | Defer inactive Content Pipeline workspaces/lenses and avoid duplicate full-list reads used only for counts. | Board, Intake, Brief/Draft/Review, Calendar, Published, Content Health, Matrix, capacity, and deep links remain. |
| `faf5bd9cb` | Scope Tailwind's production utility scan to `index.html` and `src/**/*.{ts,tsx}` with an executable source-coverage contract. | Every production HTML/TS/TSX utility source remains scanned; tests, docs, and public prose no longer inflate the shipped stylesheet. |
| `b69246f59` | Split `RenderMarkdown` from the chart-heavy client helper closure so chat/editor consumers no longer pull Recharts through a text renderer. | Markdown, tables, lists, code, rich blocks, invalid-JSON fallback, and all six direct consumers remain behavior-identical. |
| `36a6bbd2c` | Lazy-load the 440px Keywords detail Drawer only when `?q=` or a row selection requests it, with an immediate canonical loading Drawer. | Drawer URL state, Close/Escape behavior, body scroll, row origin focus, nested controls, and settled loaded composition remain. |

Independent review and settled 1440×900 / 1600×1000 smoke support these changes. That evidence confirms implementation quality, not a new owner decision.

Remaining behavior-preserving optimization opportunities are lower priority: generic Admin Chat backend fanout/concurrency, Global Ops catch-all chunking, SEO Editor duplicated projections, the app-wide queue observer, invalidate-plus-immediate-refetch churn, Cockpit whole-surface rerenders for freshness copy, and a separately reviewed dynamic DOCX-export boundary for Page Rewriter. CSS and aggregate disposition may require approved-surface consolidation or feature-flag retirement authority rather than another local micro-split.

## Owner Circle-Backs

The following recommendations are recorded in `owner-decision-packet.md` and remain `awaiting owner approval`:

1. `AUD-D1` — active-only Engine Backing Moves plus collapsed Operations homes for Weekly Briefing review, terminal recommendation history/un-dismiss/full OV-EMV, and SEO Change Impact.
2. `AUD-D2` — unique Cockpit KPI band for organic traffic value, content velocity, and overall health without duplicating Search/GA4 metrics.
3. `AUD-D3` — compact rebuilt-shell connection-health strip/footer or an explicit StatusBar omission exception.
4. `AUD-D4` — compact Published impressions/sessions secondary summary row or an explicit card/Drawer-only exception.
5. `AUD-D5` — current-month operational digest authority with durable historical snapshots deferred to a later backend project.
6. `AUD-D6` — POV hash over used evidence/effective voice, `refresh available`, no automatic overwrite of operator edits, and removal of unused slices.
7. `AUD-D7` — shared overlay-aware Tooltip behavior for Asset Manager Drawer help.

Until Joshua resolves these, none may be described as an owner-approved exception or implemented by silently expanding shared/backend scope.

## Verification Evidence And Open Gates

Supporting evidence completed during the audit:

- focused unit/component/contract/integration suites for each repair batch;
- hooks lint, TypeScript, production Vite build, PR checks, and diff hygiene on the implemented waves;
- AI quality and AI reliability reports at 100;
- AI pipeline wiring report with zero gaps;
- quick platform verification passed its 13 checks;
- final fixed-viewport browser smoke at 1600×1000 and 1440×900 found no new console error or page overflow.
- Page Intelligence closure evidence now includes empty/detail captures at both desktop viewports plus the 390px list/detail floor. Live verification proved Back focus transfer and originating-row restoration; cached partial-data refresh has a regression test; and a fresh independent review returned `PASS`. Joshua's earlier explicit approval remains the acceptance authority.
- live Keywords row-click verification proved one Drawer, preserved `?q=`, reference-counted body-scroll release, URL cleanup, no document overflow, and focus restoration to the originating row after Close; focused Drawer/Keywords tests and a fresh review passed.

Current verification truth:

- the clean current all-project suite passed 2,061 files and 28,817 tests, with one intentional skip and three todos. The process emitted non-failing jsdom navigation and Node listener-count warnings but no failed files or tests.
- bundle-budget verification remains red, but Keywords now passes its entry budget. Remaining failures are CSS 37.5 KiB versus 36.4 KiB, Page Rewriter 8.7 KiB versus 8.1 KiB, and aggregate 1.75 MiB versus 1.72 MiB; 71 new assets are warn-only. Resolve surgically after owner decisions; do not blindly raise the baseline.
- the bounded live provider smoke remains unexecuted without dedicated staging credentials and separate staging authority. Deterministic local fixtures cover workflow verification; credentials are needed only for live/staging provider proof.

## Shipping Boundary

Do not push, open a PR, begin staging extraction, spend live-provider budget, or update bundle baselines during this goal without separate Joshua authorization. When extraction is later authorized, take each owning surface plus its applicable hardening commit from current `staging`; do not ship this integration stack wholesale.

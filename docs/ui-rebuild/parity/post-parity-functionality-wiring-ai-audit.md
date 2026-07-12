# Post-Parity Functionality, Wiring, AI, And Optimization Audit

Audit date: 2026-07-11
Branch: `codex/ui-visual-parity`
Scope: legacy-versus-rebuilt capability preservation, runtime wiring, general bugs, AI summaries/workspace-intelligence integration, and behavior-preserving performance opportunities
Status: safe repair and optimization waves implemented; `AUD-D1`–`AUD-D7` and `AUD-B1` are `owner-approved`, implementation-committed, and P5-verified locally

This audit follows the owner-approved visual baseline. It does not revoke the original 26-route approval or the later Page Intelligence / Content Performance receiving-home approval. It also does not convert an automated reviewer `PASS` into approval of a newly discovered exception.

## Executive Result

- No P0 functionality loss was found.
- Real safe-local functionality, state, invalidation, overlay, cache, AI-context, and summary-cadence defects were fixed.
- Ten high-value frontend performance wins were implemented without changing route meaning, capability homes, or settled loaded composition.
- Seven material choices required owner approval because they change composition, capability grouping, time authority, AI refresh semantics, or shared design-system behavior; all seven are owner-approved and their implementations are committed.
- The measured `AUD-B1` CSS and Page Rewriter baselines are committed without increasing the aggregate baseline.
- The all-project suite, fresh independent review, changed-surface browser pass, and final combined platform gates required by P5 are complete locally. This audit is not a release-readiness or staging-verification claim.

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

The two semantic choices—monthly-digest time authority (`AUD-D5`) and POV evidence/voice refresh policy (`AUD-D6`)—are owner-approved, committed, and P5-verified under explicit truthfulness/edit-preservation contracts.

## Safe Optimization Waves

| Commit | Quick win | Preserved contract |
|---|---|---|
| `f8c9fa0f9` | Lazy-load Admin Chat's heavy ChatPanel only after open and disable the invisible smart-placeholder intelligence read while closed. | Chat history, sessions, workspace isolation, focus, and open-state behavior remain. |
| `ffd900f20` | Scope Search & Traffic provider queries by active lens, reuse parent projections, use analytics stale-time authority, and narrow event-specific invalidation while retaining the generic workspace-update fallback. | Search/Traffic/Annotations/hidden Overview routes, explicit Re-scan, provider truth, broad workspace-mutation refresh, and annotation behavior remain. |
| `fe8ab70a2` | Defer inactive Content Pipeline workspaces/lenses and avoid duplicate full-list reads used only for counts. | Board, Intake, Brief/Draft/Review, Calendar, Published, Content Health, Matrix, capacity, and deep links remain. |
| `faf5bd9cb` | Scope Tailwind's production utility scan to `index.html` and `src/**/*.{ts,tsx}` with an executable source-coverage contract. | Every production HTML/TS/TSX utility source remains scanned; tests, docs, and public prose no longer inflate the shipped stylesheet. |
| `b69246f59` | Split `RenderMarkdown` from the chart-heavy client helper closure so chat/editor consumers no longer pull Recharts through a text renderer. | Markdown, tables, lists, code, rich blocks, invalid-JSON fallback, and all six direct consumers remain behavior-identical. |
| `36a6bbd2c` | Lazy-load the 440px Keywords detail Drawer only when `?q=` or a row selection requests it, with an immediate canonical loading Drawer. | Drawer URL state, Close/Escape behavior, body scroll, row origin focus, nested controls, and settled loaded composition remain. |
| `71a7ddc19` | Link production Font Awesome base CSS to a deterministic 52-glyph `ICON_NAMES` subset while retaining the full licensed source as the generator input; narrow `Icon.name` to the registry contract. | Every registered glyph, Sharp Regular family behavior, accessibility, Lucide migration bridge, licensed source, and icon semantics remain. |
| `71a7ddc19` | Remove scanner-proven dead legacy/light compatibility selectors and keep the production-only design-system harness out of the production graph. | Live production utility candidates, documented compatibility utilities, light/dark tokens, and the development harness route remain. |
| `71a7ddc19` | Move Page Rewriter's heavy DOCX dependency behind an on-demand boundary while keeping clipboard/print entry synchronous and snapshotting the editor at click time. | Markdown/HTML clipboard, Markdown download, PDF print, legacy/rebuilt DOCX filenames/styles, error feedback, and click-time document identity remain. |

Independent review and settled 1440×900 / 1600×1000 smoke support these changes. That evidence confirms implementation quality, not a new owner decision.

Remaining behavior-preserving optimization opportunities are lower priority: generic Admin Chat backend fanout/concurrency, Global Ops catch-all chunking, SEO Editor duplicated projections, the app-wide queue observer, invalidate-plus-immediate-refetch churn, and Cockpit whole-surface rerenders for freshness copy. The aggregate bundle is below its ceiling; the two owner-approved measured per-file ratchets are applied without increasing the aggregate baseline.

## Owner Circle-Back Closure Record

Joshua approved all eight directions on 2026-07-11 with **“Let’s do it.”** Their implementation commits and final local P5 evidence are now present on the integration branch. This is not a new visual-approval event.

| ID | Status | Implementation references | Committed outcome |
|---|---|---|---|
| `AUD-D1` | `owner-approved; implementation committed; P5 verified locally` | `29bac116a`, repaired by `833c26a9b` | Engine Backing Moves use canonical active recommendations; collapsed Operations homes preserve Weekly Briefings, terminal history/un-dismiss/full OV-EMV, and SEO Change Impact. |
| `AUD-D2` | `owner-approved; implementation committed; P5 verified locally` | `1c0f40ee3` | Cockpit has the unique organic-value, content-velocity, and overall-health decision band without duplicating Search/GA4 KPIs. |
| `AUD-D3` | `owner-approved; implementation committed; P5 verified locally` | `f46d4cfcd`, repaired by `f8d75d60e` and `43aec6960` | The rebuilt shell restores compact connection health, shared Global Ops health truth, and rebuilt command reachability. |
| `AUD-D4` | `owner-approved; implementation committed; P5 verified locally` | `c1dafb697`, repaired by `1229e48ff` | Pipeline Published adds authoritative impressions/sessions evidence and distinguishes unavailable provider data from empty work. |
| `AUD-D5` | `owner-approved; implementation committed; P5 verified locally` | `8892adc0d`, repaired by `a3efae499` | The operational digest is current-month and evidence-honest, including its structured summary boundary; durable historical snapshots remain deferred. |
| `AUD-D6` | `owner-approved; implementation committed; P5 verified locally` | backend `1451f78e2`; UI `29bac116a`, repaired by `833c26a9b` | POV fingerprints use rendered evidence/effective voice, expose freshness, and preserve operator edits until explicit regeneration. |
| `AUD-D7` | `owner-approved; implementation committed; P5 verified locally` | `1243b713d` | Shared Tooltips elevate relative to the active canonical overlay while ordinary page Tooltips keep their normal layer. |
| `AUD-B1` | `owner-approved; implementation committed; P5 verified locally` | `d611db84d` | CSS is baselined at 37,307 B and Page Rewriter at 8,819 B; aggregate remains 1,720,000 B. |

The post-implementation repair hashes `43aec6960`, `833c26a9b`, and `1229e48ff` are respectively the shell, Engine, and Pipeline truth/reachability hardening required with their primary owner-closure commits.

Additional cross-cutting hardening is committed in `eee07ed51` (structured AI reliability contracts), `d686d8030` (Brand AI persistence and trial metering), `a3efae499` (digest structured-evidence boundary), and `58a7068d5` (effective-trial quota gates). The intelligence-consumer census and its executable inventory were reconciled in `fe5d5ff58`. These commits strengthen the closure stack but do not broaden the approved visual scope.

The approved scope includes the bounded backend work required for `AUD-D6`. It does not authorize durable historical digest snapshots, live-provider spend, staging extraction, a push, or a PR.

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

- the latest recorded all-project suite passed 2,077 files and 29,063 tests, with one intentional skip and three todos;
- the production build emitted 269 assets totaling 1.72 MiB gzip; 73 newly observed assets are warning-only and each remains below 50 KiB;
- the owner-approved baselines are committed at 37,307 B for CSS and 8,819 B for Page Rewriter while the aggregate baseline remains 1,720,000 B;
- fresh independent review returned `PASS`; changed-surface browser smoke at 1440×900 and 1600×1000 found no overflow or current dev-server errors; typecheck, hooks, build, PR checks, bundle/deferred/flag/lexicon checks, and the 13-step quick platform verifier pass, completing P5 locally;
- the bounded live-provider smoke remains unexecuted without dedicated credentials and separate staging authority. Deterministic local fixtures cover local workflow verification; credentials are needed only for live/staging provider proof.

## Shipping Boundary

Do not push, open a PR, begin staging extraction, spend live-provider budget, or update bundle baselines during this goal without separate Joshua authorization. When extraction is later authorized, take each owning surface plus its applicable hardening commit from current `staging`; do not ship this integration stack wholesale.

# UI Parity Integration Baseline Shipping Manifest

Baseline: the integration checkpoint commit that introduces this file on `codex/ui-prototype-alignment`.

This commit is the immutable fork point for the earlier behavior checkpoint. It is intentionally broader than a shipping PR and did not itself establish visual parity. The later `codex/ui-visual-parity` surface commits now carry owner-approved parity for all 27 directly mounted route homes plus the folded Content Performance receiving home. The original 26-route approval remains the historical batch; Page Intelligence and Content Performance were approved later as one receiving-home bundle. Never open either integration stack as one PR; extraction remains dormant and must start from `staging` only after separate Joshua authorization.

Post-parity closure status: `AUD-D1`–`AUD-D7` and `AUD-B1` are `owner-approved`, implementation-committed, and P5-verified locally. This status does not create a new visual approval or authorize a push, PR, staging extraction, or live-provider spend.

## Baseline Verification

- `npm run lint:hooks`
- `npm run typecheck`
- `npx vitest run`: 2,030 files passed; 28,463 tests passed, 1 skipped, 3 todo
- `npx vite build`
- `npm run pr-check`
- `git diff --check`

## Shipping Cohorts

1. **Parity governance**
   - `docs/ui-rebuild/parity/**`
   - Owner decisions, route census, contracts, inventory, backlog, and execution evidence only.

2. **Typography authority**
   - `src/index.css`, `public/styleguide.css`, `tests/contract/typography-token-parity.test.ts`
   - Relevant `BRAND_DESIGN_LANGUAGE.md` and `FEATURE_AUDIT.md` entries.

3. **Rebuilt shell and navigation**
   - `src/App.tsx`, `src/components/layout/**`, rebuilt nav primitives, shell/co typography corrections, and matching component tests.
   - Includes prototype nav zones, global-route chrome context, mobile rail regression floor, and restored global chrome.

4. **Brand & AI modal-first correction**
   - `src/components/BrandHub.tsx`, `src/components/brand-ai-rebuilt/**`, the touched focused Brand editors under `src/components/brand/**`, `src/components/ui/overlay/Modal.tsx`, `src/utils/markdownPreview.ts`, matching tests, and accepted parity/design-system records.
   - Depends on cohorts 1-3.

5. **Calibrated aligned surfaces**
   - Cockpit, Schema, Links, Performance, Competitors, Keyword Hub, Local Presence, and their matching tests.
   - Extract per surface; do not combine them into one PR.

6. **P1 safe pre-work**
   - Insights Engine, Content Pipeline, SEO Editor, Site Audit, Search & Traffic, Asset Manager, Page Rewriter, and Global Ops current-state cleanup/tests.
   - Each accepted behavior correction lands as a later atomic commit and ships in its own surface PR.

## Extraction Rules

These rules are dormant during the active visual-parity goal. Do not start staging extraction unless Joshua explicitly authorizes it after the owner-approval sequence.

- Create each shipping branch from current `staging`; never cherry-pick this baseline wholesale.
- Apply only the semantic/path cohort being shipped, then run its targeted tests and all final gates.
- Preserve route ids, feature-flag behavior, URL receivers, legacy aliases, and exact-once capability homes.
- Ship dependent cohorts only after their prerequisite PR is merged and verified on staging.
- Keep local `/tmp/asset-dashboard-codex-parity-captures/` screenshots as review evidence; regenerate them for the shipping branch rather than committing local paths as baselines.

## Current Integration Cohorts

The integration sandbox has advanced beyond the baseline through reviewed, surface-scoped commits. Shipping still starts from `staging`; these hashes are semantic extraction references, not a request to cherry-pick the entire stack.

| Cohort | Owner-approved integration reference | Shipping boundary |
|---|---|---|
| Insights Engine | `d4323d902` | Engine-owned composition/tests/docs only; retain V4–V6 as approved exceptions. |
| Brand & AI | `5ac077770` | Grouped cockpit, focused editors, approved 680px workflow modal, tests, and V5–V7 exceptions. |
| Competitors | `342862e3a` | Competitive stack, provider/setup truth, detail/handoff preservation, and focused tests. |
| Content Pipeline | `63c8d5293` | Board, Intake, item workspaces, secondary lenses, shared Brief/Draft receivers, route-contract tests, and explicit unsupported-operation exceptions. |
| SEO Editor | `14927f2e7` | Full source-grouped worktable, inline fields, Manual rows, Research Drawer, URL/write contracts, and review-queue exception. |
| Search & Traffic | `8f6623f37` | Three-report composition, hidden Overview receiver, truthful provider states, annotation CRUD, Drawer, and tests. |
| Asset Manager | `a3de85db7` | Single workshop, repair placement, dense asset cards, production overlays, and tests. |
| Performance | `eeb828553` | Compact Page Weight/Page Speed composition, paired selected-page cards, Single/Bulk isolation, Asset handoff, and provider exceptions. |
| Site Audit | `7dd5efe77` | Audit decision spine, compact History, compatibility receivers, production overlays, and canonical repair handoffs. |
| Schema | `f9019091a` | Generator/Guide composition, workflow strip, production detail Drawer exception, and tests. |
| Links | `eb6ff3992` | Four-lens workshop, dense repair evidence, detail Drawers, copy/send exception, and tests. |
| Keyword Hub | `78d2d7777` | Five-lens workbench, bounded Lifecycle, detail Drawer, matrix snapshots, and trend/delta no-fabrication exception. |
| Cockpit | `ca620887b` | Verdict/stream/work/evidence spine, overlays, Risk receiver, and Send/Promote exceptions. |
| Local Presence | `735d7afe5` | Two-mode real-data composition, setup Drawer, legacy receivers, and geo-grid/GBP backend exceptions. |
| Global Ops | `e18271bf8` | All 11 route homes, shared legacy interiors, wave A/B/C composition modules, focused tests, and `GO-001` through `GO-008`. |
| Page Rewriter | `5f48acf09` | Two-pane export-only workspace, picker/chat/document composition, approved 62px Focus rail, deferred-ledger record, and backend write-spine exception. |
| Page Intelligence | `3bfcffe09` — `owner-approved` | Standalone Research master/detail workbench, validated tab/page deep links, existing analysis/edit/tracking/handoff capabilities, and flag-off legacy preservation. |
| Content Performance | `6057ca3e1` + `ae3df5488` — `owner-approved` | Shared authoritative readback contract plus Published result cards/Drawer, bounded trend loading, item deep links, flag-aware compatibility redirect, and legacy OFF preservation. |

The historical 28px Performance `PageHeader` pilot was superseded by the source-led compact header and is not a shipping cohort. These references are extraction aids only; no push, PR, or staging work is authorized by the visual-parity approval.

Route-home decision: Content Pipeline Published is the owner-approved flag-on Content Performance receiver; `/content-perf` remains a compatibility route and flag-off legacy home. Page Intelligence remains standalone with its owner-approved prototype-led Research workbench. Both are eligible only for a future surface-scoped extraction after separate authorization; this approval does not start staging work.

Provider-readiness follow-on: the integration branch now has deterministic provider-rich local fixtures, explicit environment profiles, truthful provider health, and a bounded read-only staging smoke. Treat that work as a separate integrations cohort; it does not authorize credentials, staging execution, provider spend beyond the smoke ceiling, or shipment with a visual surface.

## Post-Approval Hardening Cohorts

The independent functionality, runtime-wiring, bug, AI-intelligence, and optimization audit landed additional reviewed commits after the visual approvals. These hashes are required semantic extraction inputs for their owning surfaces; they are not owner-approval records and must not be shipped as one mixed PR.

| Cohort | Integration references | Extraction boundary |
|---|---|---|
| Capability and safe client-review preservation | `8f6c3ce83` | Site Audit/client decision adapters and matching shared/integration contracts. |
| Workspace-owned state and rebuilt shell wiring | `476db936a` | App, Admin Chat, and Page Intelligence state isolation with focused tests. |
| Admin refresh and cache wiring | `8a8f42f85` | Brand, Pipeline, assets, content-performance, query keys, refresh helper, WS mapping, and tests. |
| Provider-backed intelligence invalidation | `1757ef409` | Intelligence crons, local/LLM/rank producers, and cache-invalidation tests. |
| AI reliability runtime evidence | `7405e802b` | AI reliability scripts/registry and harness coverage only. |
| Canonical stacked overlays | `4e647d093` | Modal, Drawer, ConfirmDialog, shared overlay machinery, and component tests. |
| Digest/calendar/cache freshness | `ba62f607e` | Monthly digest and intelligence/learnings invalidation; pre-closure input to the now-committed `AUD-D5` implementation. |
| Generated-context freshness | `09bc10bfa` | Workspace intelligence, briefing voice, LLMs.txt, Admin Chat context, chat summaries, and focused AI tests; pre-closure input to the now-committed `AUD-D6` implementation. |
| Final navigation and URL-state wiring | `a90971567` | Client dashboard subscriptions, Command Palette flag behavior, Pipeline editor identity, and Page Rewriter request epochs. |
| Closed Admin Chat deferral | `f8c9fa0f9` | Lazy ChatPanel and disabled closed-state smart-placeholder intelligence. |
| Search & Traffic provider scoping | `ffd900f20` | Active-lens provider reads, observer reuse, analytics stale times, and event-specific invalidation. |
| Content Pipeline interior deferral | `fe8ab70a2` | Lazy inactive interiors and bounded aggregate/list reads. |
| Page Intelligence verification closure | `3b7f4343f` | Real flag transition/OFF receiver, exact-once action/handoff pins, cold `?page=` resolution, and 390px list-to-detail/back containment. |
| Page Intelligence focus/refresh closure | `e4b12beb7` | Mobile Back/origin focus continuity plus cached-background-refresh deep-link resolution. |
| Production Tailwind source scope | `faf5bd9cb` | Explicit `index.html` plus `src/**/*.{ts,tsx}` scanning and the executable source-coverage contract. |
| Markdown-renderer closure split | `b69246f59` | Focused `RenderMarkdown` module and its six consumers without the chart-heavy client-helper closure. |
| Keywords detail deferral | `36a6bbd2c` | Lazy canonical 440px Drawer, immediate loading shell, URL cleanup, body-scroll release, and originating-row focus restoration. |
| Aggregate bundle closeout | `71a7ddc19` | Deterministic registry-only Font Awesome subset, scanner-proven dead-CSS cleanup, dev-harness production exclusion, and click-time-snapshotted on-demand DOCX export. |

## Owner-Approved Closure Implementation Cohorts

The owner-closure decisions are no longer queued or in progress. Each implementation is committed and P5-verified locally. This remains an extraction manifest, not release or staging authority.

| Decision | Implementation references | Semantic extraction boundary |
|---|---|---|
| `AUD-B1` | `d611db84d` | Lock the shared closure contracts and measured 37,307 B CSS / 8,819 B Page Rewriter baselines while keeping the aggregate baseline at 1,720,000 B. |
| `AUD-D2` | `1c0f40ee3` | Add only the unique Cockpit organic-value, content-velocity, and overall-health decision band. |
| `AUD-D5` | `8892adc0d` + `a3efae499` | Keep the operational monthly digest current-month and evidence-honest; close the structured summary boundary without simulating durable historical snapshots. |
| `AUD-D6` backend | `1451f78e2` | Make POV prompt fingerprints evidence/voice-aware, expose freshness, and preserve operator edits until explicit regeneration. |
| `AUD-D4` | `c1dafb697` + `1229e48ff` | Add authoritative Published impressions/sessions evidence and preserve the unavailable-data versus empty-work distinction. |
| `AUD-D7` | `1243b713d` | Elevate shared Tooltips relative to the active canonical overlay without changing the ordinary page layer. |
| `AUD-D1` / `AUD-D6` UI | `29bac116a` + `833c26a9b` | Restore Engine Operations/history capability homes and truthful POV freshness/evidence states. |
| `AUD-D3` | `f46d4cfcd` + `f8d75d60e` + `43aec6960` | Restore rebuilt-shell connection health, shared Global Ops health truth, and rebuilt command reachability. |

The paired repair references are `43aec6960` for shell reachability, `833c26a9b` for Engine evidence truth, and `1229e48ff` for Pipeline availability truth. Preserve each with its owning primary implementation during any future surface-scoped extraction.

Cross-cutting structured-AI and trial-metering hardening is committed in `eee07ed51`, `d686d8030`, `a3efae499`, and `58a7068d5`. The intelligence-consumer census and executable inventory are reconciled in `fe5d5ff58`. These are semantic hardening inputs, not visual-approval records and not authorization to ship the integration branch wholesale.

## Current Verification Caveats

P5 is complete locally, but do not describe this stack as release-ready or staging-verified. `AUD-D1`–`AUD-D7` and `AUD-B1` are owner-approved and implementation-committed; fresh independent review, changed-surface browser smoke, and the combined P5 gate record pass.

The latest recorded all-project run passed 2,077 files and 29,063 tests, with one intentional skip and three todos. The production build emitted 269 assets totaling 1.72 MiB gzip; 73 newly observed assets are warning-only and each is below 50 KiB. The approved baselines are committed at 37,307 B for CSS and 8,819 B for Page Rewriter while the aggregate baseline remains 1,720,000 B.

The fixed 1440×900 and 1600×1000 changed-surface review found no overflow or current dev-server warnings/errors, the fresh independent review returned `PASS`, and typecheck, hooks, build, PR checks, bundle/deferred/flag/lexicon checks, plus the 13-step quick platform verifier pass.

The bounded live-provider smoke remains unexecuted because dedicated credentials and separate staging authority were not provided. No push, PR, staging extraction, live-provider spend, or new visual approval is recorded by this manifest.

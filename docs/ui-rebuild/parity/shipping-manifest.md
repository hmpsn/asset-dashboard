# UI Parity Integration Baseline Shipping Manifest

Baseline: the integration checkpoint commit that introduces this file on `codex/ui-prototype-alignment`.

This commit is the immutable fork point for the earlier behavior checkpoint. It is intentionally broader than a shipping PR and did not itself establish visual parity. The later `codex/ui-visual-parity` surface commits now carry owner-approved parity for all 27 directly mounted route homes plus the folded Content Performance receiving home. The original 26-route approval remains the historical batch; Page Intelligence and Content Performance were approved later as one receiving-home bundle. Never open either integration stack as one PR; extraction remains dormant and must start from `staging` only after separate Joshua authorization.

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
| Digest/calendar/cache freshness | `ba62f607e` | Monthly digest and intelligence/learnings invalidation; keep `AUD-D5` unresolved. |
| Generated-context freshness | `09bc10bfa` | Workspace intelligence, briefing voice, LLMs.txt, Admin Chat context, chat summaries, and focused AI tests; keep `AUD-D6` unresolved. |
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

## Current Verification Caveats

Do not describe this stack as release-ready yet. Focused suites, hooks lint, typecheck, production build, PR checks, AI quality/reliability reports, and fixed-viewport browser smoke support the hardening wave. The clean current all-project run passed 2,065 files and 28,834 tests, with one intentional skip and three todos. Owner decisions and the bundle disposition below remain required.

The aggregate bundle ratchet is now green at 1,793,622 B against a 1,806,000 B ceiling after deterministic Font Awesome subsetting, scanner-proven dead-CSS cleanup, production harness exclusion, and on-demand click-snapshotted DOCX export. Two per-file entries still need surgical owner disposition: CSS is 37,307 B against a 37,274 B tolerance ceiling, and the behavior-safe Page Rewriter route is 8,819 B against an 8,326 B ceiling. Seventy-one new assets are warn-only. Independent review recommends measured baselines of 37,307 B and 8,819 B without changing the aggregate baseline. No push, PR, staging extraction, or baseline increase is authorized by this manifest.

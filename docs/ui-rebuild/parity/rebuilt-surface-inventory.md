# Rebuilt Surface Inventory Grading

Source of truth for mounted rebuilt surfaces: `src/components/layout/rebuiltSurfaces.ts`.

This inventory began as behavior-first triage. Joshua explicitly approved the final 24-route batch with every documented exception and retained Page Rewriter Focus rail on 2026-07-10, so all 26 mounted rebuilt route homes now carry `owner-approved` status.

Accepted directions and their circle-back triggers for the behavior mismatch and capability risk buckets are recorded in `docs/ui-rebuild/parity/owner-decision-packet.md`.

Route coverage note: this inventory grades mounted rebuilt route families, not every admin `Page` value. `docs/ui-rebuild/parity/coverage-audit.md` is the current route/nav census. It shows that `page-intelligence` and `content-perf` are standalone nav entries that are not in `REBUILT_SURFACES`; `seo-briefs`, `content`, and `calendar` are folded or redirect-only; `subscriptions` remains a standalone legacy receiver while its Content Pipeline query alias folds into publish/capacity state; `workspace-settings` remains a per-workspace settings receiver, not a main sidebar item. `competitors` is still globally `NON_REGISTRY_PAGES`, but the rebuilt sidebar now surfaces it in the prototype `Strategy & Content` zone because the rebuilt shell is flag-gated.

## Owner-Approved Former Review Queue

| Surface | Reason | Next check |
|---|---|---|
| `home` / Cockpit | Status: `owner-approved`. The corrected 1168px spine aligns the compact context/topbar, verdict hero, stream band, 702/434 work/evidence split, and weekly evidence order at both desktop viewports. Activity and work-order overlays mount exactly once, Risk deep-link semantics remain truthful, and fresh Sol review returned PASS. | Complete. Retain unsupported prototype Send/Promote controls, production stream/source filters, and the legacy work-order modal as approved exceptions. |
| `seo-schema` / Schema | Status: `owner-approved`. The corrected 1080/1020 generator now follows the prototype context, tray, readiness hero, stepper, summary, bulk band, and dense page order; the guide resolves to one calibrated five-row card. Real fixture metrics remain truthful, support stays exact-once, and fresh Sol review returned PASS. | Complete. Retain the production Drawer for review/edit/publish/history as the approved inline-card exception. |
| `links` / Links | Status: `owner-approved`. The corrected 1120/1060 workshop aligns the compact tray, 3/3/3/6 metric patterns, dense Redirect/Internal/Dead bodies, bounded Architecture tree, and collapsed evidence support. Every lens, Drawer, legacy alias, and handoff passed fresh Sol review. | Complete. Keep copy/send until a real Insert write target exists. |
| `performance` / Performance | Status: `owner-approved`. The exact 1080px canvas now uses the compact prototype header; Page Weight is metrics → controls → dense rows → repair guidance, and Page Speed uses paired selected-page Mobile/Desktop cards with isolated Single/Bulk bodies. Fresh Sol review PASS. | Complete. Retain Weight/bulk Drawers, secondary Bulk mode, full provider evidence, and no-fabricated-fix constraints. |
| `analytics-hub` / Search & Traffic | Status: `owner-approved`. The corrected 1120px report canvas uses compact report/date chrome and prototype report order across Search, Traffic, and Annotations while preserving the hidden Overview receiver, real Re-scan, overflow ranges, Breakdowns Drawer, annotation CRUD, anomalies, and exact-once lower-band homes. Fresh Sol review PASS. | Complete. Retain the approved no-invented-proof-band and live-provider-unavailable evidence exceptions. |
| `rewrite` / Page Rewriter | Status: `owner-approved`. The corrected capped two-pane workspace restores the compact context/picker, 44/56 split, seeded transcript, contained playbooks, live-document hierarchy, evidence band, and export-only footer. Loaded, empty, picker, export, Focus, and mobile states passed fresh Sol review; `pageUrl` and exact-once homes remain intact. | Complete. Treat draft/publish as a separate backend lifecycle project and retain the owner-approved 62px Focus rail. |
| `media` / Assets | Status: `owner-approved`. The exact 1180px workshop now follows the prototype's four metrics, proof band, compact controls, 132px dense cards, badge semantics, and two contextual card actions; Repair remains compact in-flow and all production overlays stay reachable. Fresh Sol review PASS. | Complete. Retain Drawer workflows and DS action/data colors as approved exceptions. |
| `competitors` / Competitors | Status: `owner-approved`. The corrected 1120/1060 single stack restores workspace context and prototype order from Alerts through Backlinks while preserving honest provider/setup states and production-only detail/handoffs. Fresh Sol review returned PASS; the populated composition is fixture-backed because local DataForSEO is unavailable. | Complete. Keep the detail Drawer and truthful setup state. |
| `seo-keywords` / Keyword Hub | Status: `owner-approved`. The corrected left-aligned 1128px surface aligns title, truthful KPIs, five-lens tray, tools, dense tables/groups, bounded Lifecycle, and 440px Drawer while preserving URL/bulk/protection/evidence contracts. Fresh Sol review returned PASS. | Complete. Keep trends and period deltas deferred until server-owned read models exist. |

## Owner-Approved Former Behavior Mismatch

| Surface | Reason | Required correction |
|---|---|---|
| `content-pipeline` / Content Pipeline | Status: `owner-approved`. The capped Board renders deduplicated real work, separate Intake, blank/filled Brief, Draft, and Review workspaces, a 440px capacity Drawer, and compact secondary modes while every production receiver remains exact-once. Fresh Sol review PASS. | Complete. Keep unsupported queue/graduation/AI-assist/questionnaire/matrix-bulk operations explicit rather than simulated. |
| `seo-editor` / SEO Editor | Status: `owner-approved`. The prototype-default full-width worksheet provides inline Static/CMS fields, Manual read-only rows, compact filters, selected actions, and 600/860px Research while retaining URL and write semantics. Fresh Sol review PASS. | Complete. Keep the unsupported keyboard review queue and Page Intelligence route decision explicit. |
| `seo-audit` / Site Audit | Status: `owner-approved`. The exact 1120px console follows the prototype hero, 3x2 category, CWV, utility, bulk, Broken Links, and dense-issues order; History is compact and compatibility evidence remains state-aware/exact-once. Fresh Sol review PASS. | Complete. Retain issue/schedule/report overlays and canonical repair handoffs as approved exceptions. |

## Owner-Approved Capability Exceptions

| Surface | Risk | Required contract focus |
|---|---|---|
| `local-seo` / Local Presence | Status: `owner-approved`. The corrected 1120/1060 real-data spine matches the prototype's two-mode interaction model (`Rank & profile`, `Reviews & replies`), 706/340 evidence split, share-of-voice composition, and setup Drawer while preserving `?lens=`/legacy `?tab=` receivers and every capability exactly once. Fresh Sol review returned PASS. Full data-backed parity still depends on unbuilt geo-grid, GBP Performance, profile-health, View-on-Google, and reopen contracts. | Complete. Under `ODP-008 A`, keep the truthful manual-refresh v1 and backlog geo-grid/GBP Performance as backend slices. |
| Global ops surfaces (`settings`, `workspace-settings`, `roadmap`, `revenue`, `ai-usage`, `features`, `prospect`, `outcomes-overview`, `outcomes`, `diagnostics`, `requests`) | Status: `owner-approved`. Settings, Workspace Settings, Roadmap, all four Business aliases, Outcomes Book/workspace, Diagnostics, and Requests have corrected 1440x900/1600x1000 evidence and fresh `PASS` verdicts. The additive shell preserves every route receiver and operator capability exactly once. | Complete. Retain `ODP-009 A` and accepted `GO-001` through `GO-008` as approved exceptions. |

## Needs Contract Pass

All currently mounted rebuilt admin route families have an initial behavior-first contract. Continue adding packets when new rebuilt routes are mounted in `REBUILT_SURFACES`.

## Earlier Owner-Approved Calibration Surfaces

| Surface | Reason | Required correction |
|---|---|---|
| `seo-strategy` / Insights Engine | Status: `owner-approved`. Joshua approved `ODP-001-V1` through `ODP-001-V6` as recommended. The final surface has one 1180px strategy spine, anchored/open `?lens=` receivers, exact-once topbar actions and overlays, compact POV/full-editor Drawer, compact Signals and move rows, staged-and-sendable projections, truthful preview content, collapsed Operations, mobile overflow coverage, and preserved legacy redirects. | Complete. Preserve V4–V6 as approved exceptions; use the rendered Engine as the next-surface desktop calibration reference without silently extending its exceptions elsewhere. |
| `brand` / Brand & AI | Status: `owner-approved`. The final surface follows the grouped cockpit and modal-first prototype composition, exposes all 17 generators exactly once in the 7 / 2 / 5 / 3 source grouping, focuses real Identity and Brandscript editors, uses the approved 680px workflow shell, and keeps production interiors and actions truthful. | Complete. Preserve V5–V7 as explicit production/data/design-system exceptions; finer feedback is deferred to the registry-wide pass. |

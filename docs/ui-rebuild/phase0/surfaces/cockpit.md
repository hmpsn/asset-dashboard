# Phase 0 Surface Ledger — Cockpit (Client · Overview)

**HEAD surface:** admin workspace home — `Page 'home'` → `WorkspaceHome` (`src/components/WorkspaceHome.tsx`), the default landing tab when an operator selects a workspace (`src/routes.ts:42`, `src/App.tsx:392`, `src/App.tsx:441`).
**Prototype views:** `hmpsn studio Design System/mockup/cockpit.js` (per-client Cockpit — "Today, scoped to one"), with `mockup/home.js` (all-clients Today / Command view, explicitly "Replaces WorkspaceHome's 9 stat cards + FOUR separate triage systems", home.js:2-4) and `mockup/workspace.js` (client switcher + scope state) as adjacent context.
**New IA home:** "Cockpit" under the Client zone's un-named Overview group, alongside Insights Engine (`mockup/nav.js:18-21`; Handoff Brief 18-surface map: "Client · overview → Cockpit, Insights Engine").

**Audit status:** READ-ONLY audit at branch `ui-rebuild-phase-0` HEAD. Every claim below carries file:line evidence.

---

## 1. Capability table

Legend: **preserved** = obvious home in new IA, same or better · **improved** = prototype upgrades it · **new_proposed** = prototype-only, needs sign-off · **at_risk** = exists at HEAD, no visible home in prototype or Parity Ledger. Uncertain = at_risk, never preserved.

### Routing, shell & data plumbing

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 1 | Default admin landing: `/ws/:id` → home tab | `src/routes.ts:42`, `src/App.tsx:392,441` | preserved | Picking a client lands on Cockpit (`cockpit.js:6`, `workspace.js:86-89`) | Prototype also keeps "stay on current client-scoped view" on switch (`workspace.js:87-89`) |
| 2 | Nav registry entry `home` / "Home" | `src/lib/navRegistry.tsx:115` | preserved | `nav.js:19` Cockpit item | Rename Home → Cockpit |
| 3 | Keyboard shortcut ⌘/Ctrl+1 → home (2=audit, 3=analytics) | `src/App.tsx:259-260` | at_risk | none visible | No shortcut scheme in mockup/nav.js or Build Conventions found for this |
| 4 | `?tab=meeting-brief` deep link (two-halves receiver) + param cleared on manual tab change | `src/components/WorkspaceHome.tsx:92-95,113-120` | at_risk | none | Falls with the Meeting Brief tab (row 26) |
| 5 | Single aggregated fetch `GET /api/workspace-home/:id?days=28` with per-source graceful fallback (`safe()`) | `src/api/platform.ts:92-94`, `server/routes/workspace-home.ts:32,40-41` | preserved | Data contract survives regardless of UI; Data-Source Ledger wiring | Endpoint aggregates ranks, requests, contentRequests, activity, annotations, churnSignals, workOrders, GSC, GA4, comparison, pipeline, velocity, decay, weeklySummary (`server/routes/workspace-home.ts:43-70`, `src/api/platform.ts:69-90`) |
| 6 | Loading state (contextual message) | `WorkspaceHome.tsx:146-148` | preserved | Build Conventions state matrix (loading/empty/error/locked) | |
| 7 | Error state with Retry + Refresh-page actions | `WorkspaceHome.tsx:150-163` | preserved | Build Conventions state matrix | |
| 8 | Live updates: ~15 WS events invalidate the workspaceHome query (APPROVAL_UPDATE, REQUEST_CREATED/UPDATE, BRIEF_UPDATED, ACTIVITY_NEW, AUDIT_COMPLETE, WORKSPACE_UPDATED, PAGE_STATE_UPDATED, SUGGESTED_BRIEF_UPDATED, CLIENT_ACTION_UPDATE, COPY_* etc.) | `src/lib/wsInvalidation.ts:25,68,128,137,145,161,179,192,205,236,255,343,376,391` | preserved | Mutation & feedback contract in Build Conventions | Rebuild must re-wire the same invalidation fan-out |
| 9 | Data freshness indicator ("5m ago", amber "Stale —" when >1h, 30s tick, tooltip with load time) | `WorkspaceHome.tsx:90,123-126,314-316,380-385`; FEATURE_AUDIT.md §121 (line 3954) | at_risk | none visible | Not in cockpit.js; candidate system-wide convention — needs a decision |
| 10 | Manual Refresh button (invalidates aggregate query, spinner while fetching) | `WorkspaceHome.tsx:318,386-396` | at_risk | none visible | Same decision as row 9 |
| 11 | Header: workspace name + Webflow site subtitle + Settings → shortcut | `WorkspaceHome.tsx:374-407` | preserved | Client-zone header + gear → wsettings (`nav.js:58-61,113-117`) | |

### Onboarding & attention triage

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 12 | OnboardingChecklist: 4 steps (link Webflow, connect GSC, connect GA4, first audit) w/ est. time, per-step nav, localStorage dismiss persistence per-workspace, completion celebration; owns setup tasks while active (T2.1) | `WorkspaceHome.tsx:98-110,177-186,320-372` | improved | Dedicated onboarding view: `mockup/onboard.js` (setup flow with unlock ladder, `onboard.js:86-100`); new clients land there (`workspace.js:85`) | onboard.js's "Fills the Technicals lane in the cockpit" (line 97) confirms the wiring intent |
| 13 | NeedsAttention: severity-sorted (critical→warning→info), capped at 5 with "N more" | `WorkspaceHome.tsx:309-311,432-438`; FEATURE_AUDIT §40 (line 2228) | improved | Cockpit's three stream tiles + grouped work queue (`cockpit.js:175-191`) | Prototype re-groups by work kind instead of severity; Parity Ledger marks Strategy's "OrientZone · NeedsAttention · QuickWins" present at Cockpit |
| 14 | Attention: new client requests → `requests?tab=requests` deep-link | `WorkspaceHome.tsx:189-198` | preserved | "From {client}" rail with Inbox link (`cockpit.js:252-257`) | Deep-link contract must carry over |
| 15 | Attention: open work orders (awaiting fulfillment / ready to close) → opens WorkOrderPanel | `WorkspaceHome.tsx:201-219` | at_risk | none — see row 33 | |
| 16 | Attention: churn signals (critical/warning) with title + description | `WorkspaceHome.tsx:138,221-229` | at_risk | none visible | Prototype has only a static health chip (On track / At risk, `cockpit.js:63,89`); no churn-signal rows anywhere in mockup (grep: 0 hits) |
| 17 | Attention: content decay (pages losing traffic) → `seo-audit?sub=content-decay` | `WorkspaceHome.tsx:231-243` | preserved | Pipeline → Content Health (Parity Ledger: DecayingPagesCard "present"); decay refresh feeds pipeline (`pipeline.js:7`) | |
| 18 | Attention: pending content briefs → content-pipeline | `WorkspaceHome.tsx:245-252` | preserved | Content in flight rail + Pipeline (`cockpit.js:273-279`) | |
| 19 | Attention: SEO audit errors (score, warnings) → seo-audit | `WorkspaceHome.tsx:254-261` | preserved | Technicals & optimization lane (`cockpit.js:258-264`) | |
| 20 | Attention: rank drops (>3 dropped) → seo-keywords | `WorkspaceHome.tsx:263-270` | preserved | Rank-anomaly work rows + keyword mini-board (`cockpit.js:69,78,266-271`) | |
| 21 | Attention: content plan pages needing review → content-pipeline | `WorkspaceHome.tsx:272-279` | preserved | Content in flight "Your review" stage + review card (`cockpit.js:212-228`) | |
| 22 | Attention: setup items (no Webflow / GSC / GA4) shown only after checklist dismissed | `WorkspaceHome.tsx:281-307` | preserved | onboard.js owns setup permanently (`onboard.js:86-100`) | |

### Metric cards (hero + secondary rail)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 23 | Site Health hero card: audit score + MetricRing + score delta + err/warn sub; empty "No audit yet" variant; → seo-audit | `WorkspaceHome.tsx:446-473`, delta `:166` | preserved | Site Audit surface (Ledger: improved) + cockpit technicals lane | Score itself leaves the home screen — see Open Q4 |
| 24 | Search Clicks hero card: clicks, impressions, CTR; → analytics-hub; "Connect GSC" empty | `WorkspaceHome.tsx:475-488` | preserved | Search & Traffic (Ledger: improved, KPI tiles present) | |
| 25 | Traffic Value hero card: `$organicTrafficValue` + ad-spend equivalent (useAdminROI) → client `roi` tab | `WorkspaceHome.tsx:88,490-503` | at_risk | none per-client | ROI appears only in `business.js` (book-level feature copy) and per-item impact chips; no per-client traffic-value roll-up in cockpit.js |
| 26 | Users card (GA4): users w/ period-over-period delta %, sessions, % new | `WorkspaceHome.tsx:173-175,512-527` | preserved | Search & Traffic (GA4 unified per Ledger note) | |
| 27 | Rank Changes card: tracked count, ↑/↓/= split → seo-keywords | `WorkspaceHome.tsx:170-171,529-538` | improved | Keyword position mini-board w/ per-term position + move (`cockpit.js:202-210,266-271`) | |
| 28 | Content Decay card: decaying count, crit/risk split → seo-audit?sub=content-decay | `WorkspaceHome.tsx:540-551` | preserved | Pipeline → Content Health (Ledger) | |
| 29 | Content Pipeline card: % published, pub/total cells → content-pipeline | `WorkspaceHome.tsx:553-567` | improved | Content-in-flight stage meter (brief→draft→review→ready) (`cockpit.js:212-220,273-279`) | |
| 30 | Content Velocity card: trailing-3-mo avg/mo, trend %, this-month count | `WorkspaceHome.tsx:569-582`; FEATURE_AUDIT §392 (line 6929) | at_risk | none visible | "velocity" in mockup only in roadmap.js (different context) |
| 31 | Coverage Gaps card (intelligence `contentPipeline.coverageGaps`) → seo-strategy | `WorkspaceHome.tsx:89,584-595` | preserved | Ledger: ContentGaps "folded" into Insights Engine moves + Editor Research | Verify count visibility survives the fold |
| 32 | Overall Health card: composite client-signals score (0–100, scoreColor) — distinct from audit score | `WorkspaceHome.tsx:598-609` | at_risk | Cockpit health chip is qualitative ("On track"/"At risk", `cockpit.js:63,89,110`) | Replacing a number with a label changes a status's meaning — kit rule says never do that without sign-off (Open Q6) |

### Sections & embedded tools

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 33 | WorkOrderPanel modal: per-workspace order list, client↔team conversation, reply box, "Mark complete" (in_progress→completed), one-way "Close out" (completed→closed) with confirm, terminal-order guard | `WorkspaceHome.tsx:671-675`, `src/components/admin/WorkOrderPanel.tsx:1-72`; FEATURE_AUDIT §51 (line 2357) | at_risk | none | Mockup mentions "work order → pipeline" only conceptually (`recs.js:221`, `strategy.js:435-438`); no fulfillment/conversation/close UI anywhere |
| 34 | Weekly Accomplishments strip ("This week: 3 SEO updates · 1 audit · …", hides zero items) | `WorkspaceHome.tsx:143,429`, `src/components/workspace-home/WeeklyAccomplishments.tsx:13-38` | at_risk | Possibly absorbed by the verdict narrative (`cockpit.js:64-65`) | Absorption is not demonstrated — verdict copy is forward-looking, not a done-this-week recap (Open Q7) |
| 35 | AnomalyAlerts panel: severity groups (critical/warning/positive), shared AI summary, expand detail, acknowledge, dismiss, manual re-scan (`POST /api/anomalies/scan`), compact mode | `WorkspaceHome.tsx:614`, `src/components/AnomalyAlerts.tsx:50-81,86-91` | preserved | Search & Traffic (Ledger: AnomalyAlerts "present"); rank anomalies also surface as cockpit work rows (`cockpit.js:69`) | Verify ack/dismiss/scan actions exist on the Traffic surface, not just display |
| 36 | Home TabBar: Overview \| Meeting Brief | `WorkspaceHome.tsx:55-58,412-425` | at_risk | none | |
| 37 | Meeting Brief page: AI-generated brief w/ generate/regenerate, At-a-Glance strip, BriefSection narrative, RecommendationsList, BlueprintProgress, OV divergence panel, keyword→route resolution for click-throughs | `WorkspaceHome.tsx:30,420-425`, `src/components/admin/MeetingBrief/MeetingBriefPage.tsx:41-63`, dir `src/components/admin/MeetingBrief/` | at_risk | none | Zero "meeting" hits across all 41 mockup views; no Parity Ledger row |
| 38 | Section TabBar: Overview \| Pipeline \| Activity | `WorkspaceHome.tsx:61-65,617-622` | improved | Cockpit merges these into one queue + rail layout | Content behind each tab must each find a home (rows 39–45) |
| 39 | BriefingReviewQueue (flag `client-briefing-v2`): weekly briefing drafts w/ category badges (win/risk/opportunity/competitive/period-change), approve, publish, skip-with-note, "Generate now" | `WorkspaceHome.tsx:627-631`, `src/components/admin/BriefingReviewQueue.tsx:38-62` | at_risk | Partially the "send" stream ("July monthly update … Send", `cockpit.js:68`) | Send action visible, but review/approve/skip-note/generate-now workflow is not demonstrated in cockpit.js or recs.js |
| 40 | AdminRecommendationQueue: Active/Dismissed tabs, priority grouping, full OV breakdown incl. admin-only emvPerWeek, un-dismiss action, WS-invalidated | `WorkspaceHome.tsx:634-638`, `src/components/admin/AdminRecommendationQueue.tsx:1-17,44-60` | preserved | Recommendations view: dismiss + undo + status lifecycle (`recs.js:107,146,156,164-165,250`) | Verify OV/emvPerWeek breakdown carried in recs.js detail |
| 41 | Pipeline tab — SeoWorkStatus grid: issues found / in review / approved / rejected / live / clean counts, each navigating to seo-audit or seo-editor | `WorkspaceHome.tsx:642-654`, `src/components/workspace-home/SeoWorkStatus.tsx:21-66` | preserved | Site Audit + SEO Editor surfaces (Ledger: improved) | |
| 42 | Pipeline tab — SeoChangeImpact: recent SEO changes list w/ source labels (editor/bulk-fix/approval/cart-fix/content/schema), on-demand before/after GSC impact (clicks/impr/CTR/pos deltas), too-recent guard | `WorkspaceHome.tsx:648-651`, `src/components/workspace-home/SeoChangeImpact.tsx:37-80` | at_risk | Closest candidate: Action Results (`outcomes.js`, Ledger "moved") | Change-level before/after measurement is not demonstrably in outcomes.js — verify |
| 43 | Activity tab — ActivityFeed: typed icon map (14 activity types), mcp-chat source badge, relative timestamps, empty state | `WorkspaceHome.tsx:660`, `src/components/workspace-home/ActivityFeed.tsx:17-52` | at_risk | none | "activity" hits in mockup are unrelated (settings storage row, diagnostics icon) |
| 44 | Activity tab — RankingsSnapshot: top-6 keywords w/ position + TrendBadge, View All → seo-keywords, GSC-aware empty state | `WorkspaceHome.tsx:661`, `src/components/workspace-home/RankingsSnapshot.tsx:20-64` | improved | Keyword position mini-board (`cockpit.js:266-271`) | |
| 45 | Activity tab — ActiveRequestsAnnotations: active requests w/ StatusBadge + View All → requests; recent annotations w/ color dots + View All → analytics-hub | `WorkspaceHome.tsx:664`, `src/components/workspace-home/ActiveRequestsAnnotations.tsx:29-99` | preserved | Requests → From-client rail / Inbox (`cockpit.js:252-257`, `nav.js:80-91`); annotations → Search & Traffic (Ledger: annotations "present", `traffic.js`) | |

### Prototype-only (new functionality proposed by cockpit.js — needs owner sign-off)

| # | Capability | Evidence (prototype) | Status | Notes |
|---|------------|---------------------|--------|-------|
| P1 | Verdict headline + narrative sub ("Acme is on track — 3 things need you today") | `cockpit.js:64-65,234-237` | new_proposed | AI-or-template generated per-client daily verdict; no HEAD equivalent |
| P2 | Three work streams incl. **Monetization** ("to pitch": upsells, scope expansion) | `cockpit.js:66,132-137,175-183` | new_proposed | Monetization plays don't exist at HEAD as a queue |
| P3 | Provenance chips (estimate / measured / actual) on money impacts | `cockpit.js:139-140`; ladder def `home.js:45-51,212-215` | new_proposed | Forward-compatible with the shipped Reconcile provenance ladder — wire real field, don't hardcode |
| P4 | "Promote to signal" on client requests (request → Insights Engine backing move) | `cockpit.js:163-173,285-293` | new_proposed | New cross-surface action; no HEAD equivalent |
| P5 | Technicals "graduate into the Insights Engine when they become a proof point" | `cockpit.js:24-27,263` | new_proposed | New lifecycle semantics for technical fixes |
| P6 | Client switcher popover with book roll-up (open requests / at-risk / in-setup) | `workspace.js:34-45` | new_proposed | HEAD has workspace switching but not this roll-up in the switcher |

---

## 2. Prototype coverage notes

- **cockpit.js demonstrates:** per-client verdict; 3 stream tiles (opt/send/money); grouped work queue with impact + provenance + per-row action (Fix/Send/Propose → issue/recs); "From {client}" thread rail (request/instruction/approval kinds, promote-to-signal, empty state, live re-render on `hmpsn-thread` events — `cockpit.js:295`); technicals lane with severity chips + Fix → pipeline; keyword mini-board; content-in-flight meter (brief/draft/review/ready) + review card; links out to requests/keywords/pipeline.
- **cockpit.js omits (relative to HEAD `WorkspaceHome`):** all 10 metric cards, Meeting Brief, activity feed, weekly accomplishments, churn signals, work-order fulfillment, briefing review workflow, anomaly ack/dismiss/scan, freshness/refresh, onboarding checklist (delegated to onboard.js), settings shortcut (delegated to nav gear).
- **home.js** is the *all-clients* Today view (separate surface in the Book zone per `workspace.js:18`); it, not cockpit.js, contains the client switcher rail and "Across your book" links (Site Health, Action Results). Cockpit inherits its layout system (`co-*` classes are defined in home.js and reused by cockpit.js — a per-view CSS dependency the Primitive Reuse Audit says not to copy).

## 3. Parity Ledger reconciliation

- **The Platform Parity Ledger has NO row for this surface.** The ledger's 31 surface rows (extracted from the embedded JS data) run from Search & Traffic to Workspace Settings; `home` / `WorkspaceHome` / Meeting Brief never appear, despite `home` being the first entry in `src/lib/navRegistry.tsx:115` which the ledger claims as its source of truth. Every at_risk row above is therefore *unledgered* — there is no Gap/Partial row to resolve; the gap is the missing row itself. **Action: add a "Workspace Home → Cockpit (+ Today)" ledger row before any build.**
- Indirect ledger coverage that partially protects this surface: AnomalyAlerts "present" at Search & Traffic; annotations "present" at Search & Traffic; DecayingPagesCard "present" at Pipeline → Content Health; ContentGaps "folded"; "OrientZone · NeedsAttention · QuickWins" listed "present at Cockpit" (under the Strategy row); Requests "moved" to Inbox; Action Results "moved" to Command Center home.
- Only explicit ledger `gap` row overall is Diagnostics (first of two Diagnostics rows) — not this surface.

## 4. Trade-offs (quick win vs full)

| Item | Quick win | Full version | Risk of quick win |
|------|-----------|--------------|-------------------|
| Verdict narrative (P1) | Template-composed verdict from existing `weeklySummary` + attention-item counts (no AI call) | `callAI()` named-operation verdict with per-client context via intelligence slices | Template copy reads robotic; still needs the same data wiring, so low waste |
| Stream tiles & work queue | Map existing attention items + recommendation statuses into the 3 streams client-side | Unified server-side work-queue model (opt/send/money) with its own endpoint + WS events | Counts drift from destination screens; misclassification (e.g. churn signal has no stream) silently drops items — mitigate with an explicit "unclassified" bucket |
| Provenance chips (P3) | Hardcode `estimate` on all money impacts | Wire the shipped Reconcile provenance field end-to-end | Mislabels measured/actual outcomes as estimates — trust landmine for the check-signing operator; prefer full since Reconcile already persists provenance |
| Meeting Brief | Keep `MeetingBriefPage` mounted as a secondary Cockpit tab unchanged | Redesign into the new IA (or fold into verdict + Insights Engine) after sign-off | Quick win preserves capability but carries old-IA chrome into the new shell; acceptable as additive-parity insurance |
| Metric visibility | Compact KPI strip on Cockpit reusing existing `WorkspaceHomeData` fields | Full drill-through model where Search & Traffic / Site Audit own all numbers | Removing all numbers from the landing screen is a behavior change the owner hasn't ratified (Open Q4); quick win de-risks it |
| Work orders | Keep `WorkOrderPanel` modal launchable from a Cockpit work-queue row | Purpose-built fulfillment lane (likely Inbox or Pipeline) | Modal-on-new-shell is visually inconsistent but loses nothing |
| Technicals lane | Feed from existing audit summary (`useAuditSummary`) + attention rows | Dedicated technicals feed with graduate-to-proof-point tracking (P5) | Quick win has no graduation semantics — fine, since graduation is new_proposed anyway |

## 5. Open questions (stop-and-ask — owner sign-off required)

1. **Missing ledger row:** The Parity Ledger has no row for Workspace Home (`Page 'home'`). Confirm cockpit.js (+ home.js for the book scope) is its intended replacement and add the ledger row with per-function statuses before build.
2. **Meeting Brief** (row 37): no home anywhere in the mockup. Keep as a Cockpit tab, move to Insights Engine, or retire (retire = capability loss, forbidden without sign-off)?
3. **Work-order fulfillment** (rows 15/33): conversation + mark-complete + close-out has no prototype home. Inbox? Pipeline? Keep modal?
4. **Per-client metrics:** Is the Cockpit intentionally number-free (Site Health score, Search Clicks, Users, Traffic Value all drill-through), or should it carry a compact KPI strip? Traffic Value/ROI (row 25) currently has *no* per-client home at all.
5. **Churn signals** (row 16): where do churn-risk rows live in the new IA? The health chip alone drops the detail (type, severity, description).
6. **Composite health number → qualitative chip** (row 32): "On track / At risk" replaces a 0–100 client-signals score — a status-meaning change the kit forbids unilaterally. Ratify or keep the number.
7. **Activity feed + Weekly accomplishments** (rows 34/43): no home. Absorb into verdict narrative / Action Results, or drop (drop = loss, forbidden)?
8. **Freshness + manual refresh** (rows 9/10): make it a system-wide Build Conventions pattern, or per-surface?
9. **New functionality P1–P6** (verdict, monetization stream, provenance chips, promote-to-signal, technicals graduation, switcher roll-up): each needs explicit sign-off as net-new scope.
10. **SeoChangeImpact** (row 42): confirm Action Results will carry change-level before/after GSC measurement, or give it a home.
11. **Briefing review workflow** (row 39): confirm the flag-gated approve/publish/skip-note/generate-now flow lands in the Recommendations surface (recs.js shows generic triage only).

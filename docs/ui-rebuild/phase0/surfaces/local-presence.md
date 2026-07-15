# Phase 0 Additive-Parity Ledger — Local Presence (`local-seo`)

- **Zone:** Strategy & Content
- **HEAD entry point:** Page `local-seo` (`src/routes.ts:7`), nav "Local Presence" (`src/lib/navRegistry.tsx:141`, group `seo-strategy`, `needsSite: true`)
- **Root component:** `src/components/local-seo/LocalPresencePage.tsx` — 4 tabs: Overview · Visibility · Reviews · Setup, `?tab=` deep-linked (`LocalPresencePage.tsx:16-27,188-197`)
- **Prototype views read:** `hmpsn studio Design System/mockup/local.js`, `local-setup.js`, `local-reviews.js`
- **Audited at:** branch `ui-rebuild-phase-0` (== post-Reconcile origin/staging HEAD), 2026-07-02
- **Status legend:** `preserved` = obvious home, same or better · `improved` = prototype upgrades it · `new_proposed` = prototype-only, needs sign-off · `at_risk` = exists at HEAD, no visible home in the prototype

## 1. Capability table

### 1.1 Page shell, tabs, deep links

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 1 | Dedicated admin Local Presence page under Strategy nav group | `src/routes.ts:7`; `src/lib/navRegistry.tsx:141-142` | preserved | `local.js` view (`view-local`) | Ledger row status "improved". |
| 2 | `?tab=` deep links for `overview\|visibility\|reviews\|setup` (two-halves contract; overview strips the param) | `LocalPresencePage.tsx:16-27,188-197` | at_risk | Prototype has only 2 sub-tabs (`presence`/`reviews`, `local.js:257,268-271`) held in JS state, no URL param | Rebuild must keep receiver-side `?tab=` wiring (contract test `tests/contract/tab-deep-link-wiring.test.ts`) and map/redirect the 4 legacy tab values. |
| 3 | Overview tab: 4 stat cards (Markets / Checked / Visible / Review-count-or-Local-packs, flag-dependent 4th card) | `LocalPresencePage.tsx:81-90` | improved | Hero profile card + legend avg (`local.js:316-334,351-354`) | Prototype hero shows rating/reviews instead; market/checked/visible counts have no explicit slot — see risk row 20. |
| 4 | Overview "Local operating status" card: workspace posture badge, setupLabel/setupDetail, market chips (active/needs_review/inactive tones) | `LocalPresencePage.tsx:92-125` | at_risk | No direct home | Prototype connection chip (`local.js:263-265`) covers connect/sync state but not posture/setup-state narrative or market chips. |
| 5 | Overview "Reviews vs competitors" / "Local pack coverage" summary blurb (flag-dependent) | `LocalPresencePage.tsx:115-123` | improved | Share-of-voice table + reviews mini-strip (`local.js:380-385,364-376`) | |
| 6 | Setup tab: entry points to Visibility setup + Brand & AI location records (`?tab=business-footprint&focus=locations-section`) | `LocalPresencePage.tsx:130-186` | preserved | Setup drawer opens from connection chip "Configure market" (`local.js:264-265`); Brand & AI shortcut in drawer (`local-setup.js:288-299,346`) | |
| 7 | Empty state when local presence not configured, with "Open setup" CTA | `LocalPresencePage.tsx:62-77` | at_risk | Prototype shows only populated states | Every surface owes loading/empty/error/locked states (Build Conventions); none demonstrated for Local. |

### 1.2 Local visibility (Visibility tab / `LocalSeoVisibilityPanel`)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 8 | Local keyword visibility stat grid: Markets / Checked / Visible / Possible / Not Found / Degraded (degraded column conditional) | `LocalSeoVisibilityPanel.tsx:197-220` | at_risk | Prototype replaces this with a geo-grid (`local.js:336-357`) that HEAD has no data for | The 5-posture model (`visible\|possible_match\|not_visible\|local_pack_present\|provider_degraded`, `LocalSeoVisibilityPanel.tsx:24-30`) must survive; the geo-grid is a different (uncollected) data shape. |
| 9 | Setup-state callout (has_data / ready_no_data / needs_market / non_local) with load + refresh error messaging | `LocalSeoVisibilityPanel.tsx:156-195` | at_risk | No home | Includes the explicit "Keyword and ranking data were not changed" safety copy. |
| 10 | Manual "Refresh" local visibility (background job, disabled unless active market + local posture; in-flight job detection via `useBackgroundTasks.findActiveJob`) | `LocalSeoVisibilityPanel.tsx:330-334,406-416`; `server/routes/local-seo.ts:225-250`; hook `useLocalSeoRefresh` (`useLocalSeo.ts:29-44`) | at_risk | Prototype only implies auto-sync ("synced 2h ago") plus save-and-refresh in drawer | The standalone refresh trigger + running-job awareness need a home. |
| 11 | Per-market visibility trend sparklines (visible-count over snapshot window, TrendBadge delta) | `LocalSeoVisibilityTrend.tsx:63-99`; wired at `LocalSeoVisibilityPanel.tsx:424` | at_risk | No home; geo-grid shows a single avg-position delta per keyword | Reads the `local_visibility_snapshots` time series (FEATURE_AUDIT.md:656). |
| 12 | Repeat Competitors list: wins-against-client, total appearances, markets, suggested tracking keywords with one-click **Track** (adds to rank tracking, per-keyword pending/tracked/error state) | `LocalSeoVisibilityPanel.tsx:70-154,317-329,447-455` | at_risk | Share-of-voice table (`local.js:380-385`) shows competitors but has no Track action or suggested keywords | Track uses `useRankTrackingAddKeyword` (`LocalSeoVisibilityPanel.tsx:312`). |
| 13 | First-load error state with retry (renders before the featureEnabled check so the panel never silently vanishes) | `LocalSeoVisibilityPanel.tsx:352-367` | at_risk | Not demonstrated | |
| 14 | Cross-surface mounts of the same panel: `mode="strategy"` in Strategy (`KeywordStrategy.tsx:343-349`), `mode="page"` annotation in Page Intelligence (`PageIntelligence.tsx:272`), `LocalPresenceHandoff` card in Keyword Hub (`KeywordHub.tsx:625`), `LocalSeoVisibilityBadge` on keyword rows/drawer (`keyword-command-center/KeywordDetailDrawer.tsx`, `page-intelligence/PageIntelligencePageRow.tsx`) | files cited | preserved | Owned by Strategy / Keyword Hub / Page Intelligence surfaces | Recorded here so the shared component isn't deleted out from under them; parity tracked in those surfaces' ledgers. |

### 1.3 Market setup drawer (`LocalSeoMarketSetupDrawer`)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 15 | Workspace posture select (local/hybrid/non_local/unknown) with suggested posture badge + up to 3 suggestion reasons | `LocalSeoMarketSetupDrawer.tsx:576-596` | preserved | `local-setup.js:178-190` | 1:1. |
| 16 | Uncovered-services nudges with copy-starter-keywords (clipboard + copied state) | `LocalSeoMarketSetupDrawer.tsx:112-146,598-618` | preserved | `local-setup.js:192-202,345` | |
| 17 | Suggested markets ("Use this market", cap-aware, dedup) | `LocalSeoMarketSetupDrawer.tsx:382-389,620-647` | preserved | `local-setup.js:204-214,342` | |
| 18 | Configured markets CRUD: add (max 3 active), label/city/state/country/status fields, deactivate→inactive list, reactivate | `LocalSeoMarketSetupDrawer.tsx:649-825`; server cap `server/routes/local-seo.ts:71-91` | preserved | `local-setup.js:232-272,338-340` | |
| 19 | DataForSEO provider-location match: lookup by city/state/country, matched/multiple-candidates/degraded outcomes, candidate picker, advanced provider identity (name/code/lat/lng), auto-resolve on save for active markets missing a code | `LocalSeoMarketSetupDrawer.tsx:391-441,474-539,728-797`; `server/routes/local-seo.ts:114-118,211-223` | preserved | `local-setup.js:216-252,343-344` | |
| 20 | Set-primary market (requires active + provider code; re-weights dependent surfaces via invalidation set) | `LocalSeoMarketSetupDrawer.tsx:683-692`; `useLocalSeo.ts:75-88`; `server/routes/local-seo.ts:195-209` | preserved | `local-setup.js:230,341` | |
| 21 | Per-workspace keywords-per-refresh budget override with min/max caps, live cost estimate ($/keyword × active markets), empty = global default | `LocalSeoMarketSetupDrawer.tsx:827-855,496-511`; `server/routes/local-seo.ts:84-90` | preserved | `local-setup.js:274-286,336` | |
| 22 | Business-locations shortcut card (confirmed/needs-review counts, Review/Manage/Add CTA → Brand & AI) | `LocalSeoMarketSetupDrawer.tsx:148-209` | preserved | `local-setup.js:288-299` | |
| 23 | Validation: active market requires provider identity; label/city/country required; numeric lat/lng/code; budget bounds; inline error band + footer "Fix errors above" | `LocalSeoMarketSetupDrawer.tsx:443-472,857-880` | preserved | `local-setup.js:347-353,303` | |
| 24 | Save vs "Save and refresh visibility" (refresh only active markets; disabled for non_local/no-active) | `LocalSeoMarketSetupDrawer.tsx:474-539,885-901` | preserved | `local-setup.js:320-327,347-360` | |
| 25 | Drawer a11y/robustness: focus trap + Escape, focus restore, dirty-state-preserving background-refetch resync | `LocalSeoMarketSetupDrawer.tsx:242-362` | preserved | Design-system drawer primitive | Behavior contract, not pixel contract. |
| 26 | Refresh API extras (no drawer UI at HEAD): explicit `keywords[]`, `device`, `languageCode`, `thenRegenerateStrategy` + `strategyGeneration` chaining | `server/routes/local-seo.ts:93-112` | preserved | Server contract unchanged | API-only capability — consumed by Strategy regen chaining + MCP; must not be dropped when rewiring the refresh button. |

### 1.4 GBP aggregates + reviews (free `local-gbp` layer)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 27 | GBP aggregate readout: own listing rating/review count vs top competitor(s), review-gap sentence, "no reviews yet" never invents 0★ | `GbpReviewsPanel.tsx:19-24,131-163` | improved | Hero card metrics + share-of-voice table (`local.js:316-334,380-385`) | Aggregates only — never per-review PII on this path (`server/routes/local-seo.ts:252-256`). |
| 28 | GBP completeness score /100 via `scoreColorClass` + concrete missing signals (photos/attributes/category) | `GbpReviewsPanel.tsx:44-69`; `server/routes/local-seo.ts:270-277` | improved | Completeness ring (`local.js:248-254,329-332`) + profile-health checklist | Prototype checklist adds checks HEAD has no data for — see new_proposed rows. |
| 29 | Manual "Refresh GBP & reviews" trigger (flag-gated, Growth+ tier gate, observe-only budget gate, per-workspace + global job serialization, error band for 403/404/409) | `GbpReviewsPanel.tsx:81-104`; `server/routes/local-seo.ts:287-312`; `useLocalGbpRefresh` (`useLocalSeo.ts:47-60`) | at_risk | Prototype implies auto-sync only | Bootstrap chicken-and-egg was a real shipped bug (`GbpReviewsPanel.tsx:106-129`) — first refresh must be triggerable from the UI. |
| 30 | Claim status intentionally NOT shown (provider defaults `is_claimed=true`; unclaimed owners never returned) | `GbpReviewsPanel.tsx:44-47` | at_risk (inverted) | Prototype shows a "Verified" badge (`local.js:320,44-46`) | Conflict: prototype displays exactly the signal HEAD suppressed as unreliable. Stop-and-ask #4. |
| 31 | Flag OFF ⇒ server returns empty payload (not 404) and panel renders nothing; flag ON + no data ⇒ empty state with refresh CTA | `server/routes/local-seo.ts:257-262`; `GbpReviewsPanel.tsx:106-129` | at_risk | Not demonstrated | Locked/empty state contract. |

### 1.5 Authenticated GBP connection + review sync (Phase 2A/2B flags)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 32 | GBP OAuth connect / callback / discovery sync / disconnect (admin-level), connection status | `server/routes/google-business-profile.ts:140-205,449-469`; `GbpConnectionCard` mounted in Workspace Settings → Connections (`settings/ConnectionsTab.tsx:257`) | improved | Connection-health chip with Reconnect Google CTA (`local.js:263-265,394`) | Chip is a better in-context surface; the Workspace Settings card must also survive (Settings surface ledger). |
| 33 | GBP location→workspace mapping status block (mapped/discovered counts, links to connection + mappings) + mappings read/replace API | `GbpMappingStatusBlock.tsx:6-55`; `server/routes/google-business-profile.ts:471-499` | improved | Chip "1/1 locations mapped" (`local.js:265`) | Mapping *editor* lives in Brand & AI business-footprint; only status is here. |
| 34 | Authenticated review sync: "Sync reviews" trigger (disabled unless connected + mapped), aggregate stat cards (average/stored/unanswered/low-rating/newest), per-location sync status (synced/partial/failed + lastError), recent excerpts, copy-policy guidance | `GbpAuthenticatedReviewsPanel.tsx:18-165`; `server/routes/google-business-profile.ts:207-274` | at_risk | Prototype reviews list assumes synced data; no sync trigger, no per-location sync health, no partial/failed handling | Sync failures write activity + broadcast (`google-business-profile.ts:246-266`) — the operator needs the failure surface. |
| 35 | Connection-gated empty states ("Connect GBP first", "Map a GBP location first") | `GbpAuthenticatedReviewsPanel.tsx:63-85` | at_risk | Not demonstrated | |

### 1.6 Review response workflow (Phase 2C flag `gbp-review-responses`)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 36 | Eligible unanswered reviews → "Draft reply" (AI draft per review) | `GbpReviewResponsesPanel.tsx:112-139`; draft route `google-business-profile.ts:289` | improved | `local-reviews.js:298-308` (Generate AI draft / Write manually / Draft & send) | "Write manually" (draft without AI) and one-step "Draft & send" are prototype additions. |
| 37 | Full response lifecycle: draft → awaiting_client → changes_requested → approved → publishing → published → publish_failed (+ declined, cancelled), status-tone map | `GbpReviewResponsesPanel.tsx:17-27,141-214`; state machine per `server/state-machines.ts` (CLAUDE.md contract) | improved (partial) | Pipeline funnel + stage timeline + per-stage workspaces (`local-reviews.js:119-136,266-377`) | Prototype omits `declined` and `cancelled` stages — they exist at HEAD and must keep a rendering. |
| 38 | Edit draft text (draft/changes_requested only) + Save draft | `GbpReviewResponsesPanel.tsx:145,160-180` | preserved | contenteditable draft + resend (`local-reviews.js:323-331`) | |
| 39 | Send to client for approval (creates `gbp_review_response` deliverable via `sendToClient`, optional note; client approves/declines/requests changes in client Inbox) | `google-business-profile.ts:353-393`; client renderer `src/components/client/inbox/UnifiedInbox.tsx` (grep hit) | preserved | `local-reviews.js:372,415-417` | Client half is Inbox-surface parity; admin half here. |
| 40 | Approve & publish (admin approval → background publish job), Retry publish on publish_failed, lastError display | `GbpReviewResponsesPanel.tsx:190-209,168-170`; `google-business-profile.ts:395-448`; job `GBP_REVIEW_REPLY_PUBLISH` (`shared/types/background-jobs.ts:38`) | preserved | `local-reviews.js:333-343,354-365,429-436` | Prototype frames admin approval as "Approve on their behalf" with audit-log note — same endpoint, better framing. |
| 41 | Policy/guidance footer copy (`data.policy.guidance`, `copyPolicy.guidance`) | `GbpReviewResponsesPanel.tsx:223`; `GbpAuthenticatedReviewsPanel.tsx:159-161` | preserved | Governance notes (`local-reviews.js:111-113,308,320,365,376`) | Prototype's inline governance notes are a faithful upgrade. |

### 1.7 Server/data plumbing that must survive regardless of UI shape

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 42 | Client-locations CRUD API under `/api/local-seo/:ws/locations` (create/update/delete with status transitions, last-confirmed-location delete guard in a transaction, location-backfill job enqueue, activity + `LOCAL_SEO_UPDATED` broadcast + intelligence-cache invalidation per mutation) | `server/routes/local-seo.ts:120-172,314-382` | preserved | Consumed by Brand & AI LocationsTab (`FEATURE_AUDIT.md:1307-1315`) | UI home is Brand & AI; API is owned here. |
| 43 | Background jobs: `local-seo-refresh`, `local-seo-location-backfill`, `local-gbp-refresh`, `gbp-review-reply-publish` — tracked via `useBackgroundTasks`/NotificationBell | `shared/types/background-jobs.ts:24-38`; `useLocalSeo.ts:31-59` | preserved | Background job platform unchanged | |
| 44 | WS events + frontend invalidation: `LOCAL_SEO_UPDATED`, `LOCAL_GBP_SNAPSHOTS_REFRESHED`, `GBP_CONNECTION_UPDATED`, `GBP_REVIEWS_UPDATED`, `GBP_REVIEW_RESPONSES_UPDATED` → `useWsInvalidation` registry | `server/ws-events.ts:169-178`; `src/hooks/useWsInvalidation.ts:81-85` | preserved | Rebuild keeps both halves of the broadcast contract | |
| 45 | Feature flags: `local-gbp` (Growth+, paid GBP layer), `gbp-auth-connection`, `gbp-auth-reviews`, `gbp-review-responses`; client `useFeatureFlag` reads GLOBAL flags only | `shared/types/feature-flags.ts:40-53,243-251,472`; gates in `LocalPresencePage.tsx:181,217-225` | preserved | Flag-gated blocks map to prototype sections | Per P2 direction these UI-shell flags are candidates for retirement during rebuild — but only with owner sign-off, backend flags stay on lifecycle. |
| 46 | Insights/intelligence integration: `local_visibility_shift` insight bridge (lost/regained visibility, new repeat competitors), `local_visibility` recs (review-gap, GBP completeness) through the recommendation spine, `LocalSeoSlice` (+ `reviewSummary`) in workspace intelligence | `server/bridge-local-visibility-shift.ts`; `FEATURE_AUDIT.md:135,656`; `shared/types/intelligence.ts:127,601` | preserved | Prototype's "graduates into the Insights Engine" note (`local.js:387`) matches this model | |
| 47 | MCP `start_local_seo_refresh` tool + job dashboard link to `/local-seo` | `server/mcp/tools/job-actions.ts:16,320` | preserved | Route id must survive rename/removal checklist | |
| 48 | Tier gating: GBP refresh requires Growth/Premium (`tierGate` 403), flag 404, conflict 409 — all surfaced as an error band, not swallowed | `server/routes/local-seo.ts:299-311`; `GbpReviewsPanel.tsx:96-104` | at_risk | Prototype shows no locked/error treatment | Locked state contract for the rebuild. |

### 1.8 New functionality proposed by the prototype (needs owner sign-off)

| # | Proposal | Prototype evidence | HEAD status | Notes |
|---|----------|--------------------|-------------|-------|
| N1 | 7×7 **geo-grid rank map** per keyword (49-point scan, rank-colored nodes, center pin, avg position + MoM delta, keyword selector) | `local.js:74-94,156-168,285-357` | Does not exist — HEAD local visibility is one point per market per keyword (`local_visibility_snapshots`) | Requires a new paid scanning job (per-node DataForSEO cost) + new table. Centerpiece of the mockup; biggest scope item. |
| N2 | **Profile views/mo + Calls & directions** metrics on hero card | `local.js:325-326` | No GBP Performance API integration; no such data captured | New Google scope + ingestion. Never render invented numbers. |
| N3 | **"Verified" badge** on profile | `local.js:320` | Deliberately suppressed as unreliable (`GbpReviewsPanel.tsx:44-47`) | Conflicts with a shipped correctness decision. |
| N4 | **Profile-health checklist** beyond completeness signals: hours/holiday hours, products listed, photos-per-quarter benchmark, Q&A monitored, service area, bio keywords — each with a "Fix" flow | `local.js:180-186,205-211,230-236,299-304,396` | Only photos/attributes/category captured (`GbpReviewsPanel.tsx:48-51`) | Needs richer GBP profile data + defined fix flows. |
| N5 | **Map-pack share-of-voice %** per competitor | `local.js:188-194,306-313,380-385` | Repeat-competitor appearances exist (`LocalSeoRepeatCompetitor.totalAppearances`) but no share % computation | Derivable from existing snapshots — cheapest new item. |
| N6 | Reviews pipeline **funnel with stage counts + desk filters** (On your desk / With client / Published / All) + desk-count badge on the sub-tab | `local-reviews.js:119-136,199-262`; `local.js:270` | HEAD renders a flat list with status badges | Pure re-presentation of existing statuses — low risk. |
| N7 | **Nudge client** reminder on awaiting_client | `local-reviews.js:317,427-428` | No endpoint | Needs a notification path. |
| N8 | **View on Google** deep link for published replies | `local-reviews.js:351,441-442` | Not stored/rendered | Needs review URL persistence. |
| N9 | **Rewrite with AI** (regenerate an existing draft) + **Write manually** (start a draft without AI) + **Draft & send** one-step | `local-reviews.js:304-306,330,373-374,406-423` | Draft endpoint creates the AI draft once; eligible list excludes reviews that already have a response (`GbpReviewResponsesPanel.tsx:50-56`) | Regen/manual-create are new server capabilities. |
| N10 | **Reopen for edits** from approved/publish_failed back to draft | `local-reviews.js:341,363,439-440` | Backward transitions governed by `server/state-machines.ts` — verify `approved→draft` is a legal transition before promising it | State-machine check required. |

## 2. Prototype coverage notes

- **`local.js` (Rank & profile):** collapses HEAD's Overview+Visibility into one presence view built around the geo-grid (N1) and a GBP hero card. It demonstrates the completeness ring, competitor table, reviews mini-strip, connection chip with reconnect + configure-market, and the insight-graduation narrative. It **omits** the entire HEAD posture/stat-grid/trend/degraded-state visibility model (rows 8–13) and both manual refresh triggers (rows 10, 29).
- **`local-setup.js` (Configure market drawer):** explicitly written to mirror `LocalSeoMarketSetupDrawer.tsx` (`local-setup.js:1-8`) and is a near-1:1 faithful port — posture+reasons, gaps, suggested markets, market cards with provider match/candidates/advanced identity, set-primary, deactivate/reactivate, budget with live cost math, locations shortcut, validation messages, Save / Save-and-refresh. Strongest parity of the three views.
- **`local-reviews.js` (Reviews & replies):** a governed upgrade of `GbpReviewResponsesPanel` — same lifecycle spine including publish_failed→retry, plus funnel/filters/timeline (N6) and several new actions (N7–N10). It **omits** `declined`/`cancelled` stages, the authenticated-sync layer (trigger, per-location sync health, copy policy) and treats all reviews as already synced.
- Prototype purple usage is on admin AI actions only (draft/rewrite) — consistent with the Four Laws for an admin surface.
- None of the three views demonstrate loading/empty/error/locked states; HEAD has explicit treatments for all of them (rows 7, 13, 31, 35, 48).

## 3. Parity Ledger reconciliation

The Platform Parity Ledger's Local Presence row (`Platform Parity Ledger.html`, group Strategy) is **status: `improved`** with all five listed tools **`present`** (LocalSeoVisibilityPanel→rank grid, GBP profile aggregate→profile card, GbpConnectionCard/MappingStatus→connection chip, GbpReviewResponsesPanel→Reviews pipeline + retry, LocalSeoMarketSetupDrawer→Configure market drawer). Its truth-check note confirms no GBP-posts composer and no citation/NAP tracker exist at HEAD (correct — verified against `src/components/local-seo/` and `src/components/google-business-profile/`), so earlier "partial" flags were removed rather than mocked.

**No Gap/Partial ledger rows remain for this surface.** However, this Phase 0 pass finds the ledger's "LocalSeoVisibilityPanel → rank grid = present" mapping **optimistic**: the geo-grid renders a *different, uncollected* data shape, and the panel's posture grid, degraded states, trend sparklines, repeat-competitor Track action, and manual refresh triggers have no visible home (rows 8–13, 10, 29). Those are recorded as at_risk here even though the ledger calls the tool present.

## 4. Trade-offs (quick win vs full)

| Item | Quick win | Full version | Risk of quick win |
|------|-----------|--------------|--------------------|
| Geo-grid (N1) | Ship the presence tab on HEAD's real per-market single-point posture data (grid of markets×keywords with posture colors), defer the 49-point scan | New geo-grid scan job (DataForSEO per-node), new snapshot table, cost gating like `local-gbp` | Visual under-delivers vs mockup promise; but the full version invents client-facing numbers until data exists — worse |
| Hero GBP metrics (N2) | Show rating + review count + completeness only (all real at HEAD) | GBP Performance API (views, calls, directions) behind a new flag/scope | Card looks sparser than mockup; acceptable vs fabricated metrics |
| Reviews pipeline (N6) | Re-skin existing statuses into funnel + filters — all states already exist server-side | Add nudge (N7), view-on-Google (N8), AI rewrite/manual draft (N9), reopen (N10) | Low — pure presentation; must still render declined/cancelled |
| Profile health (N4) | Render existing completeness missing-signals as the checklist (3 rows) | Ingest hours/products/Q&A/service-area from GBP + build fix flows | Checklist shorter than mockup; fix CTAs must not dead-end |
| Share of voice (N5) | Top-5 competitors by review count (HEAD data) without % column | Compute share % from local-pack appearance counts in snapshots | Mild — % is derivable, could even land in v1 |
| Visibility model (rows 8–13) | Keep `LocalSeoVisibilityPanel` capabilities as a "Visibility" sub-tab/section in the new shell, restyled with system primitives | Merge posture data into the geo-grid view once geo-grid exists | None — this is the additive-parity floor |

## 5. Open questions (stop-and-ask — owner sign-off required)

1. **Geo-grid**: build the paid 49-point geo-grid scanner (new job, per-node provider spend, new table), or ship Local Presence v1 on existing single-point market data and defer the grid? The mockup's centerpiece has no HEAD data source.
2. **GBP Performance metrics** (profile views/mo, calls & directions): in scope for the rebuild (new Google scope + ingestion) or cut from the hero card until integrated?
3. **Where do HEAD's Visibility-tab capabilities live in the new IA?** The prototype has no Visibility sub-tab: posture stat grid + degraded provider warnings (rows 8–9), visibility trend sparklines (11), repeat-competitor Track-keyword action (12), manual visibility Refresh (10) all lack a visible home.
4. **"Verified" badge**: HEAD deliberately suppresses claim status because the provider can't reliably report unclaimed listings (`GbpReviewsPanel.tsx:44-47`). The mockup shows it. Reinstate (with what data source?) or keep suppressed?
5. **Authenticated review sync surface**: where do the Sync-reviews trigger, per-location sync status (synced/partial/failed + lastError), aggregate stored/unanswered/low-rating stats, and copy-policy guidance live in the new Reviews pipeline (row 34)?
6. **Manual refresh triggers**: the mockup implies auto-sync ("synced 2h ago"). Keep the manual "Refresh" (local visibility) and "Refresh GBP & reviews" buttons — including the bootstrap path for a workspace with zero GBP data (row 29's chicken-and-egg) — or introduce scheduled refresh (new cron) with sign-off?
7. **Review-response stage coverage**: prototype omits `declined` and `cancelled`. Confirm both keep a rendering in the pipeline, and verify `approved→draft` ("Reopen for edits", N10) against `server/state-machines.ts` before promising it.
8. **Sub-tab → `?tab=` mapping**: prototype's 2 sub-tabs vs HEAD's 4 deep-linked tabs — confirm the redirect/alias plan for existing `?tab=overview|visibility|reviews|setup` bookmarks.

## 6. Status counts

- preserved: **25** (rows 1, 6, 14, 15–26, 38–47)
- improved: **8** (rows 3, 5, 27, 28, 32, 33, 36, 37 — 37 carries a partial caveat: declined/cancelled omitted)
- new_proposed: **10** (N1–N10)
- at_risk: **15** (rows 2, 4, 7, 8, 9, 10, 11, 12, 13, 29, 30, 31, 34, 35, 48)

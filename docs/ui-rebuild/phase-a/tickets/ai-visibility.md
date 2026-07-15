# Wave 3 BUILD TICKET — AI Visibility (Page `ai-visibility`)

> **Surface:** target admin `Page 'ai-visibility'`. The route id is not in the current `Page` union yet (`src/routes.ts:1-22`); this build adds it as the consolidated W3 receiving home for the three HEAD clusters documented in the Phase 0 ledger (`docs/ui-rebuild/phase0/surfaces/ai-visibility.md:5-20`).
> **HEAD component + mount:** no single HEAD page. Current sources are `AiVisibilityPanel` on Keyword Hub (`phase0/surfaces/ai-visibility.md:14,26-51`), `LlmsTxtGenerator` in Workspace Settings `?tab=llms-txt` (`phase0/surfaces/ai-visibility.md:15,53-70`), and `AeoReview` under SEO Audit `?sub=aeo-review` / "AI Search Ready" (`phase0/surfaces/ai-visibility.md:16,72-83`; current receiver reads `sub`, `src/components/SeoAudit.tsx:72-75`).
> **Wave:** W3 · **Lane:** A-lane (`ui-rebuild-shell`) · **Effort:** **M** (`docs/ui-rebuild/phase-a/surfaces/ai-visibility.json:536`).
> **Read order for the builder:** `PHASE_A_DECISIONS.md` -> `CROSS_SURFACE_CONTRACTS.md` -> `BUILD_CONVENTIONS.md` (especially §1 freshness, §5 score authority, §6 honest absence, §7 structural template, §8 tests) -> `surfaces/ai-visibility.json` -> `phase0/surfaces/ai-visibility.md` -> this ticket -> Keywords pilot (`src/components/keywords-rebuilt/`).
> **Mount contract:** rebuilt surface mounts behind `ui-rebuild-shell` through one `REBUILT_SURFACES['ai-visibility']` entry (`src/components/layout/rebuiltSurfaces.ts:5-15,19-38`). Flag-OFF remains byte-identical to today's scattered legacy homes and routes (`src/App.tsx:383,413,416,460-480`).

---

## 1. ⚠ OWNER DELTAS

**none — all defaults adopted.** Every discovery open question in `surfaces/ai-visibility.json:344-416` and the Phase 0 stop-and-ask list (`phase0/surfaces/ai-visibility.md:125-136`) resolves to its proposed default or to a ratified AD / cross-surface row. No item goes back to the owner.

| Discovery OQ | Resolution (default adopted unless noted) | Backing |
|---|---|---|
| Q1 / N1 — raw answer capture | Descope raw-answer transcripts for v1. Ship aggregates-only AI visibility and add a DEF row for the AI Answer Monitor follow-up. | `ai-visibility.json:346-349`; AD-009 says raw-answer capture + multi-engine chips are C3 follow-up and v1 is single-engine aggregates (`owner-decisions.json:130-138`); current route explicitly returns no raw transcripts (`server/routes/rank-tracking.ts:186-190`). |
| Q2 / N1 — prompt-set curation | Adopt the stated follow-up default: admin-curated prompt lists seeded from keyword strategy, but only when N1 is approved. Nothing ships in W3. | `ai-visibility.json:352-355`; AD-009 defers the prompt-transcript product stance (`owner-decisions.json:130-138`); SB-054 is the backing table/provider/API work (`server-backlog.json:718-728`). |
| Q3 / N2 — multi-engine scope | Ship ChatGPT only and render no fake engine chips. | `ai-visibility.json:358-361`; AD-009 (`owner-decisions.json:130-138`); current platform constant and GET read are `chat_gpt` only (`server/llm-mentions.ts:34-35`; `server/routes/rank-tracking.ts:194-196`). |
| Q4 / C3-C7 — AeoReview home | Keep the full AEO review machinery as a Drawer drill-in behind AI Search Ready "Improve"; do not ship the prototype's toast-only action. | `ai-visibility.json:364-367`; Site Audit split says AI Search Ready moves only after this receiving home is decided (`PHASE_A_DECISIONS.md:24`); T1 carry-over pattern says machinery-dense subsystems mount as token-restyled drill-ins (`BUILD_CONVENTIONS.md:274-280`); HEAD pipeline is real (`src/components/AeoReview.tsx:89-176,228-330`). |
| Q5 / A8/A9/N8 — score definition | Use existing `shareOfVoice * 100` as the AI visibility score with an explicit "not measured" state; composite score is deferred unless the owner later chooses it. | `ai-visibility.json:370-373`; AD-009 default (`owner-decisions.json:130-138`); AD-016 requires displayed score/share metrics to be server-computed with denominators (`owner-decisions.json:219-230`; `BUILD_CONVENTIONS.md:99-115`); existing share field is 0..1/undefined (`server/llm-mentions.ts:37-41`). |
| Q6 / N6 — client Insights graduation | Defer wholesale to the shared C3 graduation seam; do not add an AI Visibility-only insight write. | `ai-visibility.json:376-379`; AD-004 (`PHASE_A_DECISIONS.md:13,28-30`; `owner-decisions.json:64-81`); SB-001 shared seam includes ai-visibility (`server-backlog.json:7-23`). |
| Q7 — zone assignment | Place AI Visibility in Search & Site Health. | `ai-visibility.json:382-385`; Phase 0 header already assigns this surface to Search & Site Health (`phase0/surfaces/ai-visibility.md:1`); no owner override exists in `owner-decisions.json`. |
| Q8 / N7 — weekly scans | Manual refresh at launch with honest freshness copy; weekly cron is deferred. | `ai-visibility.json:388-391`; AD-001 applies freshness/refresh uniformly to ai-visibility and leaves cron scanning separate (`PHASE_A_DECISIONS.md:10`; `BUILD_CONVENTIONS.md:16-23`); SB-053 is the cron follow-up (`server-backlog.json:706-715`). |
| Q9 / B13 — Workspace Settings LLMs.txt tab | Retire the Settings tab as a rebuilt-shell home and redirect `workspace-settings?tab=llms-txt` to AI Visibility's Manifest lens when `ui-rebuild-shell` is ON; flag-OFF keeps the legacy tab byte-identical until shell retirement. | `ai-visibility.json:394-397,520`; current Settings receiver reads `?tab=` and mounts the generator (`src/components/WorkspaceSettings.tsx:71-80,85-107,306-310`); D8 redirect map is the required home for future route/tab moves (`docs/ui-rebuild/phase-a/D8_REDIRECT_MAP.md:1-8`). |
| Q10 / N5 — branded-demand split | **C-2 is ratified and already shipped by Search & Traffic W2.** AI Visibility consumes the existing `brandedDemand` field from `GET /api/google/search-overview/:siteId`, renders it, and shows honest absence/error. It must not rebuild the split or compute a second number. | `ai-visibility.json:400-403`; C-2 ratified Search & Traffic owns compute + canonical field while ai-visibility reads/displays (`CROSS_SURFACE_CONTRACTS.md:17-22,82`; `owner-decisions.json:7-14`); Search & Traffic ticket rode SB-055 in W2 (`tickets/search-traffic.md:109-115`); current endpoint serializes `brandedDemand` (`server/routes/google.ts:307-330`) from `fetchBrandedDemandSplit` (`server/analytics-data.ts:74-83,89-143`). |
| Newly found — A12 SoV bar denominator | Adopt with AD-016 constraint: the authoritative score remains server `shareOfVoice`; competitor bars may be display-only ratios over the exact counts shown, and must label the denominator. If the design wants a canonical percentage metric, move it server-side instead of deriving in JSX. | `ai-visibility.json:406-409,435-437`; AD-016 score/share authority (`owner-decisions.json:219-230`; `BUILD_CONVENTIONS.md:99-115`); current competitor data is counts in the GET response (`server/routes/rank-tracking.ts:202-206`; `src/api/seo.ts:114-152`). |
| Newly found — C1 AEO check to readiness-row mapping | Define the grouping in SB-009 / `sn-ai-visibility-1`; render all 8 AEO checks grouped, not the prototype's lossy 5-row summary. | `ai-visibility.json:412-415`; SB-009 maps the 8 `aeo-*` checks to readiness rows and a server-computed readiness score (`server-backlog.json:127-140`); actual checks are in `server/audit-page.ts:58-62,330-455`. |

---

## 2. Capability checklist

Every HEAD capability in `phase0/surfaces/ai-visibility.md:26-83` is an acceptance criterion. The prototype's N1-N9 rows are either adopted, consume-only, or deferred with ledger rows; nothing is silently deleted. That is the AI Visibility application of the AD-011 additive-parity floor even though the AD row's examples are other W2/W3 surfaces (`owner-decisions.json:159-173`): every omitted HEAD affordance moves into the new surface, a Drawer, or a named DEF row.

### 2.1 Page shell / routing / URL state
- [ ] **Consolidated page shell** — create target Page `ai-visibility` because HEAD has three homes and no current route id (`src/routes.ts:1-22`; `phase0/surfaces/ai-visibility.md:5-20`). Primitive: `PageContainer`, `PageHeader`, `Toolbar`, `LensSwitcher`. Zero capability drop: all three clusters remain reachable behind one rebuilt surface.
- [ ] **Three lenses** — Visibility, AI Search Ready, AI Site Manifest exactly match the surface composition (`ai-visibility.json:490-508`). Primitive: `LensSwitcher` + validating URL-state hook. Zero capability drop: Visibility carries A rows, AI Search Ready carries C rows, Manifest carries B rows.
- [ ] **Freshness + refresh convention** — use `Toolbar` trailing refresh + timestamp; scheduled scans are not implied (`BUILD_CONVENTIONS.md:16-46`). Primitive: `Toolbar`, `ToolbarSpacer`, `Button`, `InlineBanner` stale-data copy. Zero capability drop: manual refresh stays visible in header and empty state (A1/A15).
- [ ] **Deep-link receiver** — rebuilt page must read and validate `?tab=visibility|search-ready|manifest` plus legacy redirects (§4). Current Settings and SEO Audit already demonstrate receiver halves (`WorkspaceSettings.tsx:85-107`; `SeoAudit.tsx:72-75`). Primitive: URL-state hook; tests in §4.
- [ ] **Mount** — add one registry line only, no new hardcoded `App.tsx` branch (`src/components/layout/rebuiltSurfaces.ts:5-15,19-38`; generic mount `src/App.tsx:460-480`). Primitive: none. Zero capability drop: flag-OFF stays legacy.

### 2.2 Visibility lens — LLM mentions (A1-A22)
- [ ] **A1** manual "Refresh AI visibility" starts the existing `LLM_MENTIONS_REFRESH` job (`AiVisibilityPanel.tsx:97-108`; route `server/routes/rank-tracking.ts:160-184`; job metadata `shared/types/background-jobs.ts:39,363-368`). Primitive: `Toolbar` Refresh button + `useBackgroundTasks`/NotificationBell tracking.
- [ ] **A2** Growth/Premium locked state becomes explicit UI. Server gate exists (`server/routes/rank-tracking.ts:175-177`) and defense-in-depth no-op exists (`server/llm-mentions.ts:80-91`). Primitive: `TierGate` + `ErrorState type="permission"`; zero drop because current prototype omitted this state (`phase0/surfaces/ai-visibility.md:31`).
- [ ] **A3** credit-budget gate remains observe-only backend plumbing (`server/routes/rank-tracking.ts:178-181`; `server/llm-mentions.ts:118-136`). Primitive: none unless route surfaces a budget message. Do not rewrite budget enforcement.
- [ ] **A4** provider-capability error is carried into a visible error state (`server/llm-mentions.ts:100-106`; `phase0/surfaces/ai-visibility.md:33`). Primitive: `ErrorState` / `InlineBanner` with Retry.
- [ ] **A5** geo-targeted provider read stays backend-only (`server/llm-mentions.ts:112-116`). Primitive: optional caption if shown; no server change.
- [ ] **A6** owner-brand resolution stays backend-only (`server/llm-mentions.ts:55-70`). Primitive: optional "measured against" caption; no server change.
- [ ] **A7** dated snapshot store remains the source of truth (`server/llm-mentions-store.ts:1-14,21-90,171-228`). Primitive: none; render only from row mapper output.
- [ ] **A8/A9** AI visibility score is `shareOfVoice * 100` only when `shareOfVoice` is defined; undefined renders "not measured", not red 0 (`AiVisibilityPanel.tsx:144-179`; `server/llm-mentions.ts:37-41`). Primitive: `MetricTile`/`MetricRing` + `Badge`; color through `scoreColorClass`, never hand-rolled.
- [ ] **A10** raw mention-volume KPI stays visible because prompt-level "prompts cited" requires N1 and is deferred (`AiVisibilityPanel.tsx:182-191`; `src/api/seo.ts:126-152`). Primitive: `MetricTile` with blue data accent.
- [ ] **A11** dated mention trend renders from real `trend` snapshots only (`AiVisibilityPanel.tsx:24-63,194-199`; GET serializes trend `server/routes/rank-tracking.ts:196-200`). Primitive: `Sparkline`; honest absence per AD-026/BC §6 (`BUILD_CONVENTIONS.md:117-132`).
- [ ] **A12** co-mentioned competitor breakdown becomes % bars only over the exact counts shown (`AiVisibilityPanel.tsx:201-213`; counts serialized `server/routes/rank-tracking.ts:202-206`). Primitive: `Meter` + `DataTable`/`KeyValueRow`. Zero drop: counts remain readable even if a % bar is absent.
- [ ] **A13** aggregate cited source-domain list is restored (`AiVisibilityPanel.tsx:215-227`; `server/routes/rank-tracking.ts:202-206`). Primitive: `GroupBlock` + `DataTable`/`KeyValueRow`.
- [ ] **A14** refresh errors for tier/provider/conflict show an error band (`AiVisibilityPanel.tsx:110-118`; route conflict/tier messages `server/routes/rank-tracking.ts:170-181`). Primitive: `InlineBanner` or `ErrorState` with Retry.
- [ ] **A15** empty/bootstrap state includes the refresh trigger (`AiVisibilityPanel.tsx:120-142`). Primitive: `EmptyState` with action. Zero drop: first refresh is possible with no snapshot.
- [ ] **A16** workspace event invalidation survives: `llm-mentions:snapshots_refreshed` is registered server/frontend and invalidates AI Visibility + strategy/intelligence keys (`server/ws-events.ts:177-179`; `src/lib/wsEvents.ts:125-127`; `src/lib/wsInvalidation.ts:467-475`; query key `src/lib/queryKeys.ts:123`). Primitive: `useWorkspaceEvents` handler, not `useGlobalAdminEvents`.
- [ ] **A17** activity log entry per refresh stays backend-owned (`server/llm-mentions.ts:167-178`). Primitive: none.
- [ ] **A18** cancel-safe job behavior stays backend-owned (`server/llm-mentions.ts:142-151`; job cancellable `shared/types/background-jobs.ts:363-368`). Primitive: show running/cancel state if `useBackgroundTasks` exposes it; do not change job semantics.
- [ ] **A19** intelligence wiring remains aggregates-only (`shared/types/intelligence.ts:243-257`; `server/intelligence/seo-context-slice.ts:513-541`; prompt formatter `server/intelligence/formatters.ts:407-416`). Primitive: none; no raw transcripts.
- [ ] **A20** reuse typed API client and hooks (`src/api/seo.ts:114-160,202-210`; `src/hooks/admin/useAiVisibility.ts:15-43`). Primitive: React Query hooks, not raw fetch. Scrub stale doc-comments that still mention the retired `ai-visibility` feature flag only if touching those files (`shared/types/feature-flags.ts:61-66`).
- [ ] **A21** admin-only exposure remains admin-only (`AiVisibilityPanel.tsx:127-129,153-155`; Phase 0 grep note `phase0/surfaces/ai-visibility.md:50`). Primitive: `Badge` "Admin only"; no `src/components/client/**` render.
- [ ] **A22** single-platform legend says ChatGPT only (`server/llm-mentions.ts:34-35`; `server/routes/rank-tracking.ts:194-196`). Primitive: `Badge`; never render fake Perplexity/Gemini/AI Overview chips.
- [ ] **N5 / C-2 consume-only branded demand** — consume the existing `brandedDemand` field from `GET /api/google/search-overview/:siteId` through the Search Console overview read (`src/api/analytics.ts:129-131`; server field `server/routes/google.ts:307-330`). Render `status: ready` split, `status: error`, and unavailable/no-token absence honestly, using Search & Traffic's shipped denominator contract (`server/analytics-data.ts:74-83,89-143`; Search & Traffic display `OverviewLens.tsx:98,183-187,205-229`). Primitive: `GroupBlock`, `KeyValueRow`, `Meter`. **No second compute, no fork, no route changes.**

### 2.3 AI Site Manifest lens — LLMs.txt (B1-B14)
- [ ] **B1** generation uses the real `LLMS_TXT_GENERATION` background job + job progress (`LlmsTxtGenerator.tsx:52-68`; route `server/routes/llms-txt.ts:29-39`; job metadata `shared/types/background-jobs.ts:28,277-283`). Primitive: `Toolbar` action + job theater bound to real progress, not timers.
- [ ] **B2** stored-result read remains no-recrawl/404-on-never-generated (`server/routes/llms-txt.ts:72-78`; hook read `LlmsTxtGenerator.tsx:33-41`). Primitive: `EmptyState` + `Skeleton`.
- [ ] **B3** freshness endpoint and color stamp carry (`server/routes/llms-txt.ts:41-50`; `LlmsTxtGenerator.tsx:18-26,128-140`). Primitive: Toolbar freshness caption.
- [ ] **B4** both downloads are real attachments, not toasts (`server/routes/llms-txt.ts:52-70`; URLs `src/api/content.ts:400-404`; UI actions `LlmsTxtGenerator.tsx:90-96,157-174`). Primitive: icon `Button`.
- [ ] **B5** copy-to-clipboard stays mode-aware with fallback (`LlmsTxtGenerator.tsx:70-88`). Primitive: icon `Button` + `useToast`/inline copied state.
- [ ] **B6** two-tier preview toggle and show/hide preview carry; syntax highlighting is a client-rendering upgrade (`LlmsTxtGenerator.tsx:28-31,218-271`; `ai-visibility.json:430-432`). Primitive: `Segmented` + code preview block.
- [ ] **B7** stats strip carries (`LlmsTxtGenerator.tsx:100-104,206-215`). Primitive: `MetricTile` grid.
- [ ] **B8** empty/loading/error states carry (`LlmsTxtGenerator.tsx:106-126,192-204`). Primitive: `EmptyState`, `Skeleton`, `ErrorState`/`InlineBanner`.
- [ ] **B9** educational card carries without over-explaining the whole rebuilt surface (`LlmsTxtGenerator.tsx:273-292`). Primitive: `GroupBlock`.
- [ ] **B10** generator engine stays backend-owned: stored generation, validation, AI summaries, summary cache, and Webflow/content inputs remain unchanged (`server/routes/llms-txt.ts:1-14`; `server/llms-txt-generator.ts:191-205`; Phase 0 evidence `phase0/surfaces/ai-visibility.md:66`). Primitive: none.
- [ ] **B11** auto-regeneration triggers survive untouched (`server/llms-txt-generator.ts:191-205`; Phase 0 call-site list `phase0/surfaces/ai-visibility.md:67`). Primitive: optional metadata later; do not remove invisible plumbing.
- [ ] **B12** retention behavior stays backend-owned (`phase0/surfaces/ai-visibility.md:68`). Primitive: none.
- [ ] **B13** legacy `workspace-settings?tab=llms-txt` moves via D8 redirect, not a dead tab (`WorkspaceSettings.tsx:71-80,306-310`; `ai-visibility.json:394-397,520`). Primitive: URL receiver + redirect test.
- [ ] **B14** bulk/batch rerun via jobs route carries (`server/routes/jobs.ts:600-608`). Primitive: optional admin action if surfaced; no server rewrite.

### 2.4 AI Search Ready lens — AEO review (C1-C8)
- [ ] **C1** AI Search Ready readiness card rides SB-009 / `sn-ai-visibility-1`: server-derived readiness rows + score from 8 `aeo-*` checks, no client scoring (`ai-visibility.json:182-185,267-279`; SB-009 `server-backlog.json:127-140`; checks `server/audit-page.ts:58-62,330-455`). Primitive: `MetricTile` + grouped `GroupBlock` rows.
- [ ] **C2** AEO checks still feed Recommendation Engine as `aeo` RecType (`phase0/surfaces/ai-visibility.md:77`). Primitive: none; verify with Recommendations owner, do not fork rules.
- [ ] **C3** site review background job survives in the Drawer (`AeoReview.tsx:89-103`; route `server/routes/aeo-review.ts:104-125`). Primitive: `Drawer` + job theater.
- [ ] **C4** single-page on-demand review survives (`AeoReview.tsx:105-132`; route `server/routes/aeo-review.ts:40-92`). Primitive: Drawer row action / `Button`.
- [ ] **C5** per-page change recommendation depth survives: 12 change types, priority, effort, score, quick wins, time estimate (`shared/types/aeo.ts:1-47`; `AeoReview.tsx:28-63,236-290`). Primitive: `DataTable`, `IntentTag`, `MetricTile`.
- [ ] **C6** effort + priority filters survive (`AeoReview.tsx:68-74,228-330`). Primitive: `FilterChip`.
- [ ] **C7** send-to-client pipeline survives with source-research gating and `aeo_change` payloads (`AeoReview.tsx:134-176`; source-research field `shared/types/aeo.ts:34-35`). Primitive: Drawer footer `Toolbar`, `FormTextarea`, status `Badge`. This is a hard parity stop because it feeds client inbox today (`ai-visibility.json:212-215`).
- [ ] **C8** legacy `seo-audit?tab=aeo-review` / current `?sub=aeo-review` deep link redirects to AI Visibility's Search Ready lens (`SeoAudit.tsx:72-75,315-370`; `ai-visibility.json:217-220,520`). Primitive: URL receiver + D8 row.

### 2.5 Prototype additions / explicit defers (N1-N9)
- [ ] **N1/N2/N3** AI Answer Monitor, 4-engine coverage, and per-prompt "Brief this page" are deferred together because they require prompt/transcript storage and provider capability (`ai-visibility.json:222-235,445-457`; SB-054 `server-backlog.json:718-728`; AD-009 `owner-decisions.json:130-138`). DEF-ai-visibility-001.
- [ ] **N4** AI referral sessions KPI is deferred; ship three real KPIs instead of one fake KPI (`ai-visibility.json:237-240,460-463`; SB-012 `server-backlog.json:172-185`). DEF-ai-visibility-002.
- [ ] **N5** branded demand is **adopted as consume-only** via existing `brandedDemand` from Search & Traffic's endpoint; no DEF row and no server work in this ticket (§2.2, §3).
- [ ] **N6** graduation to client Insights Engine is deferred by AD-004 (`ai-visibility.json:247-250,470-472`; SB-001 `server-backlog.json:7-23`). DEF-ai-visibility-003.
- [ ] **N7** weekly scheduled scans are deferred; launch copy must not claim weekly scanning (`ai-visibility.json:252-255,475-477`; SB-053 `server-backlog.json:706-715`). DEF-ai-visibility-004.
- [ ] **N8** composite score is rejected for W3/default; defer only if owner later defines a composite over SoV (`ai-visibility.json:257-260,480-483`; SB-051 `server-backlog.json:681-691`). DEF-ai-visibility-005.
- [ ] **N9** authority-signal "why" rows defer until an assembled read exists (`ai-visibility.json:262-265,485-487`; SB-052 `server-backlog.json:694-703`). DEF-ai-visibility-006.

---

## 3. Server tickets [ride vs defer]

Consume verifier-adjusted backlog IDs from `server-backlog.json`, not gatherer-only `sn-*` labels. The surface JSON's branded-demand row was written before Wave 2 shipped Search & Traffic's C-2 producer; classify against the current code.

### RIDES in this PR
| SB / sn | Title | Effort | Disposition | Rationale |
|---|---|---|---|---|
| **SB-009** (`sn-ai-visibility-1`) | AI Search Ready readiness projection + single-definition schema coverage metric | M | **RIDE W3 (AEO readiness half only)** | C1 requires server-derived rows + score from the 8 `aeo-*` checks (`ai-visibility.json:267-279,412-415`). SB-009 explicitly owns the ai-visibility/site-audit readiness projection (`server-backlog.json:127-140`). Build a read-side derivation beside `server/routes/aeo-review.ts` / audit consumers; do not use unrelated setup-readiness code. |

### ALREADY SHIPPED / CONSUME ONLY
| SB / sn | Title | Effort | Disposition | Rationale |
|---|---|---|---|---|
| **SB-055** (`sn-ai-visibility-6`) | Branded vs non-branded demand split + branded search volume | M | **ALREADY RODE Search & Traffic W2; do not ride again** | C-2 says Search & Traffic owns compute + canonical field and ai-visibility reads/displays (`CROSS_SURFACE_CONTRACTS.md:17-22,82`; `owner-decisions.json:7-14`). The Search & Traffic W2 ticket records `sn-ai-visibility-6 = SB-055` riding there (`tickets/search-traffic.md:109-115`). Current code now exposes `brandedDemand` on `GET /api/google/search-overview/:siteId` (`server/routes/google.ts:307-330`) from `fetchBrandedDemandSplit` (`server/analytics-data.ts:74-83,89-143`). This ticket consumes the result only and renders honest absence/error. |

### DEFERS (with DEF-* ledger rows)
| SB / sn | Title | Effort | Disposition | Ledger |
|---|---|---|---|---|
| **SB-054** (`sn-ai-visibility-4`) | AI Answer Monitor backing | L | **DEFER** | DEF-ai-visibility-001. AD-009 keeps v1 aggregates-only and defers raw transcripts/multi-engine chips (`owner-decisions.json:130-138`); SB-054 is new migration + provider capability (`server-backlog.json:718-728`). |
| **SB-012** (`sn-ai-visibility-2` half) | GA4 AI-referral session segmentation + GSC prior-period dated trend series | S/M split | **DEFER AI-referral half** | DEF-ai-visibility-002. This is real backlog, not a mock: SB-012 says the search-traffic prior-period thread is S, but the ai-visibility AI-referrer half is genuinely no + M (`server-backlog.json:172-185`; verifier `ai-visibility.json:547-549`). |
| **SB-001** (`N6`) | Insight-graduation write seam | L | **DEFER** | DEF-ai-visibility-003. AD-004 defers all graduation bridges wholesale; no ad-hoc AI Visibility write (`PHASE_A_DECISIONS.md:13,28-30`; `server-backlog.json:7-23`). |
| **SB-053** (`sn-ai-visibility-3`) | Weekly LLM mentions refresh cron | S | **DEFER** | DEF-ai-visibility-004. AD-001 launch is manual refresh + freshness; cron is separate (`PHASE_A_DECISIONS.md:10`; SB-053 `server-backlog.json:706-715`). |
| **SB-051** (`sn-ai-visibility-5`) | Composite AI visibility score /100 + MoM delta | S | **DEFER / rejected for W3 default** | DEF-ai-visibility-005. Default score is SoV×100; SB-051 only applies if owner later chooses a composite (`ai-visibility.json:370-373,480-483`; `server-backlog.json:681-691`). |
| **SB-052** (`sn-ai-visibility-7`) | Authority-signals assembled read | M | **DEFER** | DEF-ai-visibility-006. Inputs exist but no assembled read; do not block W3 port (`ai-visibility.json:262-265,485-487`; `server-backlog.json:694-703`). |

**Net:** SB-009 rides for the AEO readiness read. SB-055/sn-ai-visibility-6 already shipped in Search & Traffic W2 and is consume-only here. SB-054, SB-012 AI-referral, SB-001, SB-053, SB-051, and SB-052 defer with ledger rows.

---

## 4. Deep-link receiver matrix

Two-halves contract applies (CLAUDE.md UI rule 12; BUILD_CONVENTIONS §7/§8). Update `tests/contract/tab-deep-link-wiring.test.ts` and add runtime receiver tests for the rebuilt surface.

| Link | Sender | Receiver / target | Disposition |
|---|---|---|---|
| `/ws/:workspaceId/ai-visibility` | New nav/breadcrumb/command-palette entry for target Page `ai-visibility` | AI Visibility, default Visibility lens | **ADD.** Page id is absent today (`src/routes.ts:1-22`); build adds the route and default lens. Flag-OFF legacy nav remains byte-identical (§5). |
| `/ws/:workspaceId/ai-visibility?tab=visibility` | Direct bookmarks / rebuilt lens switcher | Visibility lens | **ADD + TEST.** Receiver reads and validates `tab=visibility`; runtime test renders a fully loaded page and asserts LLM mentions widgets mount. |
| `/ws/:workspaceId/ai-visibility?tab=search-ready` | AI Search Ready cards, redirected SEO Audit AEO links | AI Search Ready lens + AeoReview Drawer entry | **ADD + TEST.** Receiver reads `tab=search-ready`; "Improve" opens the carried AEO drill-in, not a toast stub. |
| `/ws/:workspaceId/ai-visibility?tab=manifest` | Redirected Workspace Settings `llms-txt` links and manifest actions | AI Site Manifest lens | **ADD + TEST.** Receiver reads `tab=manifest`; runtime test asserts LLMs.txt generator states/actions mount. |
| `/ws/:workspaceId/workspace-settings?tab=llms-txt` | Existing bookmarks and Settings tab muscle memory (`WorkspaceSettings.tsx:71-80,85-107,306-310`) | Redirect to `/ws/:workspaceId/ai-visibility?tab=manifest` while `ui-rebuild-shell` is ON | **MOVE WITH D8.** Add row to `D8_REDIRECT_MAP.md` in the implementation PR (`ai-visibility.json:394-397,520`; map contract `D8_REDIRECT_MAP.md:1-8`). Static contract must prove sender and receiver agree. Flag-OFF keeps the current Settings tab. |
| `/ws/:workspaceId/seo-audit?tab=aeo-review` and current `/ws/:workspaceId/seo-audit?sub=aeo-review` | Existing SEO Audit AEO links/bookmarks (`SeoAudit.tsx:72-75,315-370`) | Redirect to `/ws/:workspaceId/ai-visibility?tab=search-ready` while `ui-rebuild-shell` is ON | **MOVE WITH D8.** The discovery doc says the AEO deep link needs a redirect when moved (`phase0/surfaces/ai-visibility.md:83`; `ai-visibility.json:217-220,520`). Support both the user-facing `?tab=` alias and the current `?sub=` receiver shape unless implementation proves only one exists. Flag-OFF keeps the current SEO Audit sub-tab. |
| `/ws/:workspaceId/ai-visibility?tab=<bad>` | User/bookmark noise | Default Visibility lens | Validate and fall back to Visibility; do not crash or show an empty shell. |

---

## 5. Flag disposition

| Flag | Kind | Disposition | Evidence |
|---|---|---|---|
| `ui-rebuild-shell` | A-lane UI-shell flag | **Gates this rebuilt surface.** Add one `REBUILT_SURFACES['ai-visibility']` mount entry; flag-OFF falls through to legacy Keyword Hub / Workspace Settings / SEO Audit homes byte-identical. | Flag default/catalog `shared/types/feature-flags.ts:117-120,460-470`; generic mount `App.tsx:460-480`; registry seam `rebuiltSurfaces.ts:5-15,19-38`; surface mount note `ai-visibility.json:520`. |

No new feature flag is introduced. The old `ai-visibility` product flag is already retired and the feature is unconditional at HEAD (`shared/types/feature-flags.ts:61-66`); do not resurrect it. Backend/tier/provider gates render as states (Growth+ locked, provider missing, no live domain, budget observe-only), not as new flags.

Flag-OFF behavior must be byte-identical to current production: Keyword Hub still contains the legacy AI Visibility panel, Workspace Settings still serves `llms-txt`, SEO Audit still serves `aeo-review`, and no new legacy-shell nav item appears while `ui-rebuild-shell` is OFF.

---

## 6. File ownership

**Owned by this ticket (create/edit in implementation PR):**
- `src/components/ai-visibility-rebuilt/**` — new `@ds-rebuilt` surface directory. Expected split: `AiVisibilitySurface.tsx`, `VisibilityLens.tsx`, `AiSiteManifestLens.tsx`, `AiSearchReadyLens.tsx`, `AeoReviewDrawer.tsx`, `useAiVisibilitySurfaceState.ts` (validated `?tab=` reads/writes + legacy aliases), mutation-feedback helper using `useToast` + `mutationErrorMessage`, and shared formatters. Every file first line `// @ds-rebuilt` (BC gates `BUILD_CONVENTIONS.md:208-219`).
- `src/routes.ts` — add target Page `'ai-visibility'` to the union; current union lacks it (`src/routes.ts:1-22`).
- `src/components/layout/rebuiltSurfaces.ts` — one line keyed by Page `'ai-visibility'`: `lazyWithRetry(() => import('../ai-visibility-rebuilt/AiVisibilitySurface').then(m => ({ default: m.AiVisibilitySurface })))`. Never add a new hardcoded `App.tsx` branch (`rebuiltSurfaces.ts:5-15,19-38`; `App.tsx:460-480`).
- `src/lib/navRegistry.tsx` / rebuilt-shell navigation seams only as needed to make Page `ai-visibility` reachable in Search & Site Health. Current Search & Site Health nav area is `seo-audit`, `performance`, `links`, `media` (`navRegistry.tsx:123-131`), and current non-registry guidance shows how flag-ON-only pages avoid legacy nav churn (`navRegistry.tsx:98-106`). Flag-OFF legacy nav must remain byte-identical.
- `tests/component/ai-visibility-rebuilt/**` — flag-transition component test with real `useFeatureFlag` seeded through `QueryClient`, a11y-floor assertion, state tests for locked/empty/error/stale, and runtime deep-link receiver tests for `?tab=visibility|search-ready|manifest`.
- `tests/contract/tab-deep-link-wiring.test.ts` — add/keep static assertions for both legacy redirects and new receiver params; BC requires static + runtime deep-link tests (`BUILD_CONVENTIONS.md:250-257`).
- `server/routes/aeo-review.ts` plus a small derivation module beside audit consumers, only for SB-009 readiness rows/score (`server-backlog.json:127-140`). Add shared response types if needed before implementation.
- `docs/ui-rebuild/phase-a/D8_REDIRECT_MAP.md` in the implementation PR for the two legacy tab moves; no D8 Page rename/removal row for Page `ai-visibility` itself (§7).
- `data/ui-rebuild-deferred-ledger.json` — add the DEF rows drafted in §7 in the implementation PR only. This ticket does not edit the ledger.

**Reused, NOT rewritten:**
- AI visibility read/refresh hooks and API client (`src/hooks/admin/useAiVisibility.ts:15-43`; `src/api/seo.ts:114-160,202-210`).
- Existing LLM mentions job/store/route (`server/routes/rank-tracking.ts:160-208`; `server/llm-mentions.ts:72-199`; `server/llm-mentions-store.ts:1-228`).
- Existing LLMs.txt API, generation job, stored-result read, downloads, freshness, jobs-route rerun (`server/routes/llms-txt.ts:1-80`; `src/api/content.ts:388-404`; `server/routes/jobs.ts:600-608`; `LlmsTxtGenerator.tsx:28-296`).
- Existing AeoReview machinery as T1 carry-over inside a Drawer (`src/components/AeoReview.tsx:68-176,228-330`; `server/routes/aeo-review.ts:40-125`; `shared/types/aeo.ts:1-70`).
- Existing workspace-event constants and invalidation (`server/ws-events.ts:177-179`; `src/lib/wsEvents.ts:125-127`; `src/lib/wsInvalidation.ts:467-475`).
- Existing Search & Traffic branded-demand producer and minimal display (`server/analytics-data.ts:74-83,89-143`; `server/routes/google.ts:307-330`; `src/components/search-traffic-rebuilt/OverviewLens.tsx:98,183-187,205-229`).

**Must NOT touch / other-owner constraints:**
- **C-2 branded-demand compute:** do not fork or rebuild `fetchBrandedDemandSplit`; do not alter the `brandedDemand` field name; do not alter `GET /api/google/search-overview/:siteId` semantics (`server/analytics-data.ts:89-143`; `server/routes/google.ts:307-330`). AI Visibility reads/displays only per C-2 (`CROSS_SURFACE_CONTRACTS.md:17-22,82`).
- Search & Traffic's field contract and display ownership; this W3 ticket is a downstream consumer, not the producer (`tickets/search-traffic.md:109-115,153-176`).
- Raw LLM transcript storage, prompt CRUD, multi-engine provider support, or DataForSEO provider widening (N1/N2/N3) until SB-054 is approved (`server-backlog.json:718-728`; AD-009 `owner-decisions.json:130-138`).
- Client portal / `src/components/client/**` paths. Graduation to client Insights Engine is deferred by AD-004 and must not leak admin purple into client surfaces (`PHASE_A_DECISIONS.md:13`; `phase0/surfaces/ai-visibility.md:105`).
- Weekly cron registration (`server/cron-registry.ts`) until SB-053 is scheduled (`server-backlog.json:706-715`).
- Ad-hoc insight-graduation writes or new InsightType registration for this page only; SB-001 is shared and deferred (`server-backlog.json:7-23`; AD-004).
- Delete/removal of the existing Workspace Settings or SEO Audit tabs without the D8 redirect rows and tests in the same implementation PR (`ai-visibility.json:394-397,520`; `D8_REDIRECT_MAP.md:1-8`).

---

## 7. D8 / DEF entries

**D8 Page rename/removal:** none for Page `ai-visibility`. This is a new receiving Page, not a renamed or removed Page; `src/routes.ts:1-22` currently has no `ai-visibility` route id to retire. The D8 route-removal rule in `PHASE_A_DECISIONS.md:22-24` applies when an existing Page/subtool is moved or retired.

**D8 tab-relocation rows required in the implementation PR** (flag-ON only until the shell flag retires; flag-OFF preserves current behavior):
- `workspace-settings?tab=llms-txt` -> `ai-visibility?tab=manifest` (`ai-visibility.json:394-397,520`; current receiver `WorkspaceSettings.tsx:71-80,85-107,306-310`).
- `seo-audit?tab=aeo-review` and current `seo-audit?sub=aeo-review` -> `ai-visibility?tab=search-ready` (`ai-visibility.json:217-220,520`; current receiver `SeoAudit.tsx:72-75,315-370`).

**Deferred-ledger rows to add in the surface PR** (schema fields and enum values from `scripts/verify-deferred-ledger.ts:15-35`; surface enum includes `ai-visibility`; `class` must be one of `token | primitive | behavior | data | a11y | perf | copy`):

```jsonc
{
  "id": "DEF-ai-visibility-001",
  "surface": "ai-visibility",
  "item": "AI Answer Monitor prompt rows, raw answer transcripts, multi-engine chips, and per-prompt brief CTA",
  "decision": "Ship aggregates-only ChatGPT AI Visibility in W3; defer prompt/transcript storage and multi-engine provider support to the signed C3-style follow-up.",
  "class": "data",
  "upgradeTrigger": "SB-054 is scheduled with owner-approved prompt curation, provider capability, migration, row mapper, and read/CRUD endpoints.",
  "owner": "josh",
  "status": "open",
  "roadmapItemId": null,
  "createdAt": "2026-07-07",
  "reviewBy": "2026-09-15",
  "links": {
    "decision": "AD-009",
    "backlog": "SB-054",
    "surface": "docs/ui-rebuild/phase-a/surfaces/ai-visibility.json:222-235,445-457",
    "ticket": "docs/ui-rebuild/phase-a/tickets/ai-visibility.md"
  }
},
{
  "id": "DEF-ai-visibility-002",
  "surface": "ai-visibility",
  "item": "AI referral sessions KPI and month-over-month delta from GA4 referrer segmentation",
  "decision": "Launch with three real visibility KPIs; defer the AI-referral sessions KPI because no GA4 referrer segmentation exists today.",
  "class": "data",
  "upgradeTrigger": "SB-012 AI-referral half ships a GA4 segmentation read for chatgpt.com, perplexity.ai, and gemini referrers plus MoM delta.",
  "owner": "josh",
  "status": "open",
  "roadmapItemId": null,
  "createdAt": "2026-07-07",
  "reviewBy": "2026-09-15",
  "links": {
    "backlog": "SB-012",
    "surface": "docs/ui-rebuild/phase-a/surfaces/ai-visibility.json:237-240,460-463",
    "ticket": "docs/ui-rebuild/phase-a/tickets/ai-visibility.md"
  }
},
{
  "id": "DEF-ai-visibility-003",
  "surface": "ai-visibility",
  "item": "Automatic graduation of AI Visibility wins into the client Insights Engine",
  "decision": "Do not build an AI Visibility-only graduation write; defer all insight graduation to the shared C3 owner-signed seam.",
  "class": "behavior",
  "upgradeTrigger": "SB-001 lands the shared graduation write contract with InsightType registration, broadcast, activity log, and snapshot provenance.",
  "owner": "josh",
  "status": "open",
  "roadmapItemId": null,
  "createdAt": "2026-07-07",
  "reviewBy": "2026-09-15",
  "links": {
    "decision": "AD-004",
    "backlog": "SB-001",
    "surface": "docs/ui-rebuild/phase-a/surfaces/ai-visibility.json:247-250,470-472",
    "ticket": "docs/ui-rebuild/phase-a/tickets/ai-visibility.md"
  }
},
{
  "id": "DEF-ai-visibility-004",
  "surface": "ai-visibility",
  "item": "Weekly scheduled LLM mentions scans with credit-budget enforcement",
  "decision": "Ship manual refresh plus honest freshness copy; defer scheduled scans so W3 does not imply unattended weekly provider spend.",
  "class": "behavior",
  "upgradeTrigger": "SB-053 adds CRON_METADATA, cron census coverage, and budget-enforced LLM_MENTIONS_REFRESH scheduling.",
  "owner": "josh",
  "status": "open",
  "roadmapItemId": null,
  "createdAt": "2026-07-07",
  "reviewBy": "2026-09-15",
  "links": {
    "decision": "AD-001",
    "backlog": "SB-053",
    "surface": "docs/ui-rebuild/phase-a/surfaces/ai-visibility.json:252-255,475-477",
    "ticket": "docs/ui-rebuild/phase-a/tickets/ai-visibility.md"
  }
},
{
  "id": "DEF-ai-visibility-005",
  "surface": "ai-visibility",
  "item": "Composite AI visibility score out of 100 with month-over-month delta",
  "decision": "Use server shareOfVoice times 100 as the W3 score; defer a separate composite because the prototype's score definition is unresolved.",
  "class": "data",
  "upgradeTrigger": "Owner chooses a composite score definition and SB-051 serializes the server-computed score plus MoM delta.",
  "owner": "josh",
  "status": "open",
  "roadmapItemId": null,
  "createdAt": "2026-07-07",
  "reviewBy": "2026-09-15",
  "links": {
    "decision": "AD-016",
    "backlog": "SB-051",
    "surface": "docs/ui-rebuild/phase-a/surfaces/ai-visibility.json:257-260,480-483",
    "ticket": "docs/ui-rebuild/phase-a/tickets/ai-visibility.md"
  }
},
{
  "id": "DEF-ai-visibility-006",
  "surface": "ai-visibility",
  "item": "Authority-signal why rows for owned content cited, NAP and reviews, and roundup presence",
  "decision": "Render existing source-domain evidence now; defer assembled authority-signal rows until a real joined read exists.",
  "class": "data",
  "upgradeTrigger": "SB-052 ships an assembled read over source domains, GBP review data, and roundup/owned-content signals.",
  "owner": "josh",
  "status": "open",
  "roadmapItemId": null,
  "createdAt": "2026-07-07",
  "reviewBy": "2026-09-15",
  "links": {
    "backlog": "SB-052",
    "surface": "docs/ui-rebuild/phase-a/surfaces/ai-visibility.json:262-265,485-487",
    "ticket": "docs/ui-rebuild/phase-a/tickets/ai-visibility.md"
  }
}
```

### Gates before merge

`npm run typecheck && npx vite build && npx vitest run` (full suite) + `npm run pr-check` + `npm run lint:hooks` + `npm run verify:bundle-budget` + `npm run verify:deferred-ledger`. Add flag-transition component coverage with a seeded `QueryClient`, static + runtime deep-link receiver tests, and a flag-ON browser smoke against a workspace with real LLM mention snapshots, LLMs.txt data, an AEO review, Search Console overview data, and unavailable/error branded-demand states.

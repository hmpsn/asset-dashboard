# Phase 0 Surface Ledger — AI Visibility (zone: Search & Site Health)

> READ-ONLY additive-parity audit at HEAD (branch `ui-rebuild-phase-0` == post-Reconcile staging).
> Prototype views read: `hmpsn studio Design System/mockup/aivis.js` + `mockup/llmstxt.js`.
> Verdict: this surface is **NOT net-new**. HEAD has three real capability clusters that the
> prototype consolidates into one surface: (A) the AI-visibility LLM-mention KPI (KeywordHub),
> (B) the LLMs.txt generator (Workspace Settings tab), and (C) the AEO / "AI Search Ready"
> review (SEO Audit sub-tab, mapped here by the Parity Ledger). The prototype also proposes
> substantial NEW functionality (prompt-level AI Answer Monitor with raw answer text, 4 engines,
> AI referral sessions, branded-demand split, graduation rule) that needs owner sign-off.

## Current routes / endpoints covered

- Page `seo-keywords` → `KeywordHub` mounts `AiVisibilityPanel` (`src/routes.ts:7`, `src/App.tsx:400`, `src/components/KeywordHub.tsx:33,635-637`)
- Page `workspace-settings` → `WorkspaceSettings` SectionTab `llms-txt` (`src/routes.ts:13`, `src/App.tsx:365`, `src/components/WorkspaceSettings.tsx:71-80,306-309`)
- Page `seo-audit` → `SeoAudit` sub-tab `aeo-review` ("AI Search Ready") (`src/components/SeoAudit.tsx:52,317,364-374`)
- `POST /api/rank-tracking/:wsId/refresh-ai-visibility` (`server/routes/rank-tracking.ts:163-184`)
- `GET /api/rank-tracking/:wsId/ai-visibility` (`server/routes/rank-tracking.ts:191-208`)
- `POST /api/llms-txt/:wsId/generate`, `GET /api/llms-txt/:wsId`, `/freshness`, `/download`, `/download-full` (`server/routes/llms-txt.ts:31-78`)
- `POST /api/aeo-review/:wsId/site`, `POST /api/aeo-review/:wsId/page`, `GET /api/aeo-review/:wsId` (`server/routes/aeo-review.ts:40,96,104`)

## Capability table

Status legend: preserved / improved / new_proposed / at_risk (uncertain = at_risk, never preserved).

### Cluster A — AI-visibility KPI (LLM mentions) — admin-only, today on Keyword Hub

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|---|---|---|---|---|
| A1 | Manual "Refresh AI visibility" action → background job `LLM_MENTIONS_REFRESH` (cancellable, domain-store, class user) | `src/components/strategy/AiVisibilityPanel.tsx:97-108`; `server/routes/rank-tracking.ts:163-184`; `shared/types/background-jobs.ts:39,363-368` | preserved | AI Visibility header ("Last scan…" + refresh) | Prototype implies weekly scheduled scans (`aivis.js:331,372,401`) — scheduling is new_proposed (A17). |
| A2 | Growth/Premium tier gate on refresh (route) + defense-in-depth no-op in job | `server/routes/rank-tracking.ts:175-177`; `server/llm-mentions.ts:81-91` | at_risk | AI Visibility locked state | Prototype shows NO locked/tier state. DS mandate: every surface owes locked. Must be designed in. |
| A3 | Credit-budget gate (observe-only) on `llm_mentions` endpoint | `server/routes/rank-tracking.ts:178-181`; `server/llm-mentions.ts:121-136` | preserved | backend, unchanged | Invisible to UI; survives any rebuild. |
| A4 | Provider capability detection (requires DataForSEO `getLlmMentions`) with explicit error message | `server/llm-mentions.ts:101-106` | preserved | error state | Prototype shows no provider-missing error state; carry the state kit. |
| A5 | Geo-targeted read (locationCode/name + languageCode) | `server/llm-mentions.ts:113-116` | preserved | backend | |
| A6 | Owner-brand resolution (workspace name + domain-root fallback) for share-of-voice identification | `server/llm-mentions.ts:60-70` | preserved | backend | |
| A7 | Dated snapshot store `llm_mention_snapshots` (per workspace/date/platform; NULL→undefined "never invented"; Zod-validated JSON arrays) | `server/llm-mentions-store.ts:1-70` (migration 155) | preserved | backend | |
| A8 | Share-of-voice headline as 0–100 score (MetricRing, `scoreColorClass`) | `AiVisibilityPanel.tsx:147-171` | improved | KPI strip "AI visibility score" (`aivis.js:376-380`) | Prototype adds MoM delta. BUT see stop-and-ask Q5: prototype shows score 58 while SoV list shows 22% — the score's definition is ambiguous. |
| A9 | Explicit "not measured" SoV state (brand not identifiable ≠ red 0%) | `AiVisibilityPanel.tsx:145-179` | at_risk | — | Prototype always renders a numeric score; the deliberate "not measured" distinction (P8 review finding) has no visible home. |
| A10 | Mention-volume KPI (raw mentions in AI answers, blue DATA) | `AiVisibilityPanel.tsx:182-191` | at_risk | — | Prototype KPI strip replaces raw mentions with "Prompts where cited X/N" (`aivis.js:386-390`) — a different metric requiring the new prompt monitor. Raw mentions (what HEAD actually measures) has no slot. |
| A11 | Mention-volume trend sparkline over dated snapshots (≥2 points, delta since first — "the before/after AEO proof") | `AiVisibilityPanel.tsx:26-63,194-199` | at_risk | — | Prototype has only KPI deltas ("+11 pts vs last month") and an unused `.spark` CSS hook (`aivis.js:28`); no dated trend chart. The accrued snapshot history must not be dropped. |
| A12 | Co-mentioned competitor breakdown (top 5, mentions) | `AiVisibilityPanel.tsx:201-213`; store `llm-mentions-store.ts:46` | improved | "Share of AI voice" bars (`aivis.js:359-364,412-413`) | Prototype upgrades to % bars with "you" highlighted. Mapping mention counts → % needs definition. |
| A13 | Cited source-domain list (top 5 — the off-site AEO targeting list) | `AiVisibilityPanel.tsx:215-227` | at_risk | — | Prototype shows per-prompt "Sources pulled" chips (`aivis.js:323,344`) but no aggregate top-source-domains list. Partial home only; aggregate view must be preserved. |
| A14 | Refresh error band (403 tier / 409 already-running surfaced, not swallowed) + workspace/global job-conflict messages | `AiVisibilityPanel.tsx:110-118`; `rank-tracking.ts:171-172` | at_risk | error state | No error affordance in prototype. State kit requirement. |
| A15 | Empty/bootstrap state with the refresh trigger visible (chicken-and-egg guard) | `AiVisibilityPanel.tsx:120-142` | preserved | empty state | Self-gating-panel lesson (PR #1306) — keep the trigger in the empty state. |
| A16 | Live update: WS event `llm-mentions:snapshots_refreshed` → query invalidation (KPI + strategy/intelligence) | `server/ws-events.ts:181`; `server/llm-mentions.ts:180-187`; `src/lib/wsInvalidation.ts:470-475`; `src/lib/wsEvents.ts:127-129` | preserved | backend + new hooks | Rebuild must re-wire `useWorkspaceEvents` invalidation to the new query keys. |
| A17 | Activity-log entry per refresh (`rank_snapshot`, mentions + SoV) | `server/llm-mentions.ts:167-178` | preserved | backend | |
| A18 | Cancel-safe job (cancel checks before spend + before persist) | `server/llm-mentions.ts:143,151` | preserved | backend | |
| A19 | Intelligence wiring: `SeoContextSlice.aiVisibility` (mentions, SoV, topCompetitor, topSourceDomain) → AI advisor context | `shared/types/intelligence.ts:243-258`; `server/intelligence/seo-context-slice.ts:514-541`; `server/intelligence/formatters.ts:407-414` | preserved | backend | Aggregates-only contract documented in the type. |
| A20 | React Query hooks + typed API client (`useAiVisibility`, `useAiVisibilityRefresh`, `AiVisibilitySnapshot` et al.) | `src/hooks/admin/useAiVisibility.ts:15-45`; `src/api/seo.ts:114-148`; `src/lib/queryKeys.ts:123` | preserved | new hooks | Note: hook doc-comments still reference the retired `ai-visibility` flag (sunset Wave 2b 2026-07-02, `shared/types/feature-flags.ts:61-66`) — feature is now unconditional; only the Growth+ tier gate remains. |
| A21 | "Admin only" badge — no client-facing exposure of the KPI at HEAD | `AiVisibilityPanel.tsx:128,154`; zero hits in `src/components/client/` (grep `aivis|llm.mention|llms`) | preserved | admin surface | Prototype keeps it admin-side; "graduation" to client Insights Engine is new_proposed (N6). |
| A22 | Single platform v1: `chat_gpt` (column leaves room for `google`) | `server/llm-mentions.ts:34-35`; `rank-tracking.ts:194` | preserved | engine legend | Prototype's 4 engines are new_proposed (N2). |

### Cluster B — LLMs.txt generator (today: Workspace Settings → "LLMs.txt" tab; prototype: AI Visibility §3 "AI Site Manifest")

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|---|---|---|---|---|
| B1 | Generate/regenerate as background job `LLMS_TXT_GENERATION` (non-cancellable, domain-store-and-result) via `useJobProgress` | `src/components/LlmsTxtGenerator.tsx:53-68`; `server/routes/llms-txt.ts:31-39`; `shared/types/background-jobs.ts:28,277-281` | improved | §3 Regenerate + generation theater (`llmstxt.js:204-228`) | Prototype adds a 5-step progress theater; wire it to real job progress, not fake timers. |
| B2 | Stored-result read path (no re-crawl on view; 404 when never generated) | `server/routes/llms-txt.ts:72-78`; migration 130 (`FEATURE_AUDIT.md:8364`) | preserved | §3 card | |
| B3 | Freshness endpoint + color-coded stamp (<24h green, <72h amber, older "consider regenerating") | `routes/llms-txt.ts:42-50`; `LlmsTxtGenerator.tsx:18-26` | preserved | §3 header (`llmstxt.js:135-140`) | Prototype mirrors thresholds faithfully. |
| B4 | Download both artifacts (`llms.txt` + `llms-full.txt`) as attachments | `routes/llms-txt.ts:52-70`; `LlmsTxtGenerator.tsx:90-96,157-174` | preserved | §3 actions (`llmstxt.js:179-180`) | Prototype download is a toast stub — must be a real file download. |
| B5 | Copy-to-clipboard (mode-aware, `execCommand` fallback) | `LlmsTxtGenerator.tsx:70-88` | preserved | §3 Copy (`llmstxt.js:210-214`) | |
| B6 | Two-tier preview toggle (index vs full) + show/hide preview | `LlmsTxtGenerator.tsx:31,224-258` | improved | §3 tabs (`llmstxt.js:192-199`) | Prototype adds markdown syntax highlighting of the preview (`llmstxt.js:143-151`). |
| B7 | Stats strip: pages indexed · sections · content lines · file size | `LlmsTxtGenerator.tsx:100-104,209-216` | preserved | §3 stat strip (`llmstxt.js:184-189`) | |
| B8 | Empty state w/ generate CTA; loading state; error banner | `LlmsTxtGenerator.tsx:106-126,192-204` | preserved | §3 states (`llmstxt.js:61-66` empty) | Prototype seeds all clients as generated; error state not demonstrated — carry state kit. |
| B9 | "What is LLMs.txt?" educational card | `LlmsTxtGenerator.tsx:273-292` | preserved | §3 about card (`llmstxt.js:160-166`) | |
| B10 | Generator engine: two-tier output, AI per-page summaries via `callAI`, SQLite summary cache, HEAD-request URL validation (concurrency 10, 5s timeout), up to 500 pages, pulls Webflow pages + keyword strategy + content plans | `server/llms-txt-generator.ts:2-12,58-105,237-252,278`; `FEATURE_AUDIT.md:3623-3627` | preserved | backend | |
| B11 | Auto-regeneration triggers: keyword-strategy update, schema publish, content-matrix cell published, MCP schema-actions parity path | `server/keyword-strategy-follow-ons.ts:72-73`; `server/domains/schema/publish-schema-to-live.ts:188-190`; `server/routes/content-matrices.ts:189-191`; `server/mcp/tools/schema-actions.ts:326-329`; `queueLlmsTxtRegeneration` at `server/llms-txt-generator.ts:195` | preserved | backend | Invisible plumbing — must survive the UI move untouched. |
| B12 | Summary-cache retention (90-day cleanup in data-retention cycle) | `server/data-retention.ts:18`; `llms-txt-generator.ts:109-110` | preserved | backend | |
| B13 | `?tab=llms-txt` deep link into Workspace Settings (two-halves contract wired) | `WorkspaceSettings.tsx:71-107` | at_risk | — | Prototype moves the generator out of Settings into AI Visibility §3. Old deep links / muscle memory need a redirect decision, and the Settings tab's retirement needs sign-off (route-removal-checklist analog). |
| B14 | Bulk/batch re-run path via jobs route | `server/routes/jobs.ts:600-604` | preserved | backend | |

### Cluster C — AEO / "AI Search Ready" (today: SEO Audit sub-tab; Parity Ledger maps it to AI Visibility)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|---|---|---|---|---|
| C1 | 8 AEO audit checks (`aeo-author`, `aeo-date`, `aeo-answer-first`, `aeo-faq-no-schema`, `aeo-hidden-content`, `aeo-citations`, `aeo-dark-patterns`, `aeo-trust-pages`) produced by the site audit | `server/audit-page.ts:59-62,335-452`; `server/seo-audit-site-checks.ts:191` | improved | §2 "AI Search Ready" card (`aivis.js:267-315`) | Prototype's 5 readiness rows + readiness score are a friendlier framing of these checks; exact check→row mapping needs definition (prototype rows don't 1:1 match the 8 checks). |
| C2 | AEO checks feed the Recommendation Engine as `aeo` RecType (traffic-aware insight text, CRITICAL_CHECKS, purchasable fix products) | `server/domains/recommendations/rules.ts:436,741-751`; `FEATURE_AUDIT.md:3143` | preserved | backend / Recommendations surface | Cross-surface: verify with the Recommendations auditor. |
| C3 | AEO site review background job (`AEO_SITE_REVIEW`, maxPages 15, prioritized by traffic, requires completed SEO audit) | `src/components/AeoReview.tsx:91-103,179-199`; `server/routes/aeo-review.ts:104` | at_risk | — | Prototype's "Improve" button fires a toast (`aivis.js:436`) — the real review job has no demonstrated home. |
| C4 | Single-page on-demand AEO review (merge into stored review) | `AeoReview.tsx:105-132`; `routes/aeo-review.ts:40` | at_risk | — | Not in prototype. |
| C5 | Per-page change recommendations: 12 typed change types, effort (quick/moderate/significant) + priority chips, quick-win counts, estimated minutes, per-page AEO score | `AeoReview.tsx:28-56,232-268`; `shared/types/aeo.ts` (imports at `AeoReview.tsx:18-19`) | at_risk | — | The prototype readiness card is site-level only; the per-page drill-down depth is absent. |
| C6 | Effort + priority filters on the change list | `AeoReview.tsx:73-74,232-233,304,322` | at_risk | — | |
| C7 | Send AEO page recommendations to client as a client action (`aeo_change` diff payload, optional note, `requiresSourceResearch` items withheld pending research, omitted-count messaging) | `AeoReview.tsx:134-176` | at_risk | — | A real admin→client workflow with provenance guarding. No home in prototype; losing it breaks an existing client-inbox pipeline (renderers exist in `src/components/client/DecisionDetailModal.tsx` et al.). |
| C8 | `?tab=aeo-review` deep link within SEO Audit | `SeoAudit.tsx:74` | at_risk | — | If AI Search Ready moves here (per Site Audit ledger note "Content Health + AI Search Ready split out to their proper homes", `ledger-groups` Site Audit row), the deep link needs a redirect. |

### New functionality proposed by the prototype (needs sign-off — none exists at HEAD)

| # | Proposal | Prototype evidence | HEAD status | Notes |
|---|---|---|---|---|
| N1 | **AI Answer Monitor**: tracked prompt list, expandable rows showing the actual AI answer text with own-brand/competitor highlighting, cited/absent tag, "top mention" position, per-answer "Sources pulled" | `aivis.js:160-166,185-264,319-349,398-406` | new_proposed | **Direct conflict with HEAD's aggregates-only stance** — `rank-tracking.ts:186-189` and `FEATURE_AUDIT.md:125` state the platform *never captures raw LLM answer text*. Storing/rendering transcripts is a product + data-source + cost decision, not a UI port. |
| N2 | 4-engine coverage (ChatGPT, Perplexity, Google AI Overview, Gemini) with per-engine chips | `aivis.js:161-167,317,402-404` | new_proposed | HEAD = `chat_gpt` only (`llm-mentions.ts:35`). Provider support per engine unverified. |
| N3 | Per-prompt fix CTA ("Brief this page" → content pipeline) | `aivis.js:194,324` | new_proposed | Good pattern (mirrors existing decay→brief handoffs) but depends on N1. |
| N4 | "AI referral sessions" KPI (+MoM) | `aivis.js:391-395` | new_proposed | No GA4 AI-referrer segmentation exists at HEAD (grep `chatgpt.com|perplexity` in server/src: no analytics hits). Data ticket. |
| N5 | Branded vs non-branded demand split + branded search volume/mo | `aivis.js:414-423` | new_proposed | No branded-demand KPI on this surface at HEAD. Possible overlap with Search & Traffic surface. |
| N6 | Graduation rule: an AI-visibility win becomes a client-facing Insights Engine story only once real referral sessions / branded-demand lift shows | `aivis.js:2-7,430` | new_proposed | Product rule; needs owner definition + cross-surface contract with Insights Engine. |
| N7 | Weekly scheduled scans ("scanned weekly · Last scan 2 days ago") | `aivis.js:331,372,401` | new_proposed | HEAD refresh is manual-only (no cron registration for `LLM_MENTIONS_REFRESH`). Cost/budget-gate implications. |
| N8 | Composite "AI visibility score /100" with MoM delta distinct from SoV | `aivis.js:177,376-380` (score 58 while SoV shows 22%) | new_proposed | Undefined metric — see stop-and-ask Q5. |
| N9 | Authority-signals "why" rows (owned content cited, NAP/reviews, roundup presence) | `aivis.js:200-205,301-313` | new_proposed | Partially derivable from existing data (source domains, GBP reviews) but no assembled read exists. |

## Prototype coverage summary

- **Demonstrates faithfully:** llms.txt generator (self-described "Faithful mirror of LlmsTxtGenerator.tsx", `llmstxt.js:2`), SoV competitor comparison, freshness color coding, two-tier preview, stats strip, empty state.
- **Improves:** llms.txt preview highlighting + generation theater; SoV as % bars; AEO checks reframed as a scored "AI Search Ready" readiness card; one consolidated surface instead of three scattered homes.
- **Omits (at_risk above):** tier-locked state, refresh error band, "not measured" SoV state, raw mention-volume KPI, dated mention trend chart, aggregate cited-source-domains list, the entire AeoReview per-page review + send-to-client pipeline, provider-missing error state.
- **Proposes new:** N1–N9.
- **Color-law note:** the prototype uses purple as the surface accent throughout (`aivis.js:12` etc.). This surface is admin-only so purple is legal (admin AI), but the graduation path to client Insights Engine must not carry purple client-side.

## Parity Ledger reconciliation

- No `gap`/`partial` rows exist for this surface in the Platform Parity Ledger. The only ledger `gap` row is Diagnostics (unrelated).
- Relevant rows (all `present`): `AiVisibilityPanel` → "Brand & AI / AI Visibility" (Strategy row tools); `AeoReview` → "AI Visibility" (Brand & AI row tools); `LlmsTxtGenerator` → "AI Visibility · §3 AI Site Manifest" with a detailed faithful-port note.
- Site Audit ledger row note: "Content Health + AI Search Ready split out to their proper homes" — AI Search Ready's proper home resolves to this surface (consistent with `aivis.js` §2).
- **Discrepancy:** the Handoff Brief's 18-surface map places AI Visibility under **SEARCH & SITE HEALTH** (matches this assignment), while the Parity Ledger tool rows and the `aivis.js` header banner say **"BRAND & AI"**. See stop-and-ask Q7.
- The ledger rows mark `AeoReview` as `present` at AI Visibility, but the prototype only demonstrates a 5-check summary — the ledger's `present` overstates coverage of C3–C7. Flagged at_risk here rather than trusting the ledger row.

## Trade-offs — quick win vs full implementation

| Item | Quick win | Full version | Risk of quick win |
|---|---|---|---|
| Core KPI + SoV | Port existing single-engine aggregates (SoV ring→score, mentions, trend, competitors, sources) into the new surface layout; keep manual refresh | Multi-engine AI Answer Monitor with tracked prompts and answer transcripts (N1/N2) | Engine legend/chips would imply 4-engine coverage with only ChatGPT data — must not render fake engine chips; also KPI "Prompts where cited" impossible without N1, so the strip needs an interim metric (raw mentions) |
| AI Search Ready card | Render existing `aeo-*` audit check results as the readiness rows + readiness score; "Improve" deep-links to the existing AeoReview flow (kept as a drill-in) | One-click AI-drafted on-page fixes from each row | Prototype's toast-only "Improve" is a dead action if shipped literally; and dropping the AeoReview drill-in silently loses C3–C7 |
| llms.txt section | Straight port of `LlmsTxtGenerator` (ledger calls it a faithful mirror) + syntax-highlighted preview | Generation theater driven by real job progress messages; auto-regen surfaced ("regenerated after schema publish") | Low — backend untouched; only risk is leaving the old Settings tab dangling without a redirect (B13) |
| AI referral sessions KPI | Omit the 4th KPI or label "coming soon" | GA4 referral-source segmentation for chatgpt.com/perplexity.ai/gemini + MoM | A visibly empty KPI slot; better to ship 3 real KPIs than 1 fake one |
| Scan cadence | Manual refresh + honest freshness stamp ("last refreshed X ago") | Weekly cron with credit-budget enforcement (N7) | Copy must not claim "scanned weekly" while refresh is manual |

## Open questions (stop-and-ask — owner sign-off required)

1. **Q1 — Raw answer capture (N1):** The AI Answer Monitor requires storing/rendering LLM answer transcripts, which HEAD explicitly forbids ("aggregates only — never raw LLM answer text", `rank-tracking.ts:186-189`, `FEATURE_AUDIT.md:125`). Approve the stance reversal + pick a data source (e.g. DataForSEO ChatGPT scraper — per-prompt cost) or descope to aggregates for v1?
2. **Q2 — Prompt-set curation:** Who defines/edits the tracked prompt list per client? The prototype shows tracked prompts but no CRUD. Needs a spec (admin-curated? auto-derived from keyword strategy?).
3. **Q3 — Multi-engine (N2):** Which engines are actually procurable? HEAD provider supports ChatGPT only. Ship single-engine honestly, or hold for multi-engine?
4. **Q4 — AeoReview home (C3–C7):** Does the full per-page AEO review (job, filters, send-to-client with source-research gating) live behind AI Search Ready's "Improve" as a drill-in, stay in Site Audit, or get redesigned? It must live somewhere — it feeds the client inbox today.
5. **Q5 — Score definition (N8/A8/A9):** Is "AI visibility score" SoV×100 (HEAD) or a new composite (prototype shows score 58 alongside SoV 22%)? And where does the "not measured" state render? Client-facing numbers may not change meaning per the standing rules.
6. **Q6 — Graduation rule (N6):** Define the threshold and mechanics for an AI-visibility win graduating into the client Insights Engine (cross-surface contract).
7. **Q7 — Zone assignment:** Handoff Brief says Search & Site Health; Parity Ledger rows + `aivis.js` banner say Brand & AI. Which zone does AI Visibility live in? (Affects nav + breadcrumb + this file's zone header.)
8. **Q8 — Scheduled scans (N7):** Approve a weekly `LLM_MENTIONS_REFRESH` cron (cost/budget-gate enforcement decision), or keep manual refresh at launch?
9. **Q9 — Workspace Settings "LLMs.txt" tab retirement (B13):** Confirm the tab is removed and `workspace-settings?tab=llms-txt` deep links redirect to AI Visibility §3, following the route-removal checklist pattern.
10. **Q10 — Branded-demand split (N5):** Does branded vs non-branded demand belong to this surface or to Search & Traffic? (Both surfaces could claim it; neither has it at HEAD.)

## Status counts

- preserved: 24 (A1, A3–A7, A15–A22, B2–B5, B7–B12, B14, C2)
- improved: 5 (A8, A12, B1, B6, C1)
- new_proposed: 9 (N1–N9)
- at_risk: 13 (A2, A9, A10, A11, A13, A14, B13, C3, C4, C5, C6, C7, C8)
- total capabilities audited: 51

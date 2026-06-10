# hmpsn.studio Platform Audit — Synthesis Report
*Six surfaces: SEO Strategy, Keyword Hub, Recommendations, Action Results, Content Generation, Client Dashboard. June 2026.*

---

## 1. Executive Summary

1. **The forward half of the intelligence loop (data → strategy → keywords → content → client) is genuinely well-built**; the back half (actions → results → learnings) is fully wired but transmits corrupted data into every AI prompt and score multiplier that consumes it.
2. **Outcome scoring is structurally broken for ~6 of 15 action types** (phantom metrics like `click_recovery` exist in no snapshot — `server/outcome-scoring-defaults.ts:27-46`), unexecuted suggestions are scored as executed, and the weekly backfill mislabels every completed recommendation as `audit_fix_applied` (`server/outcome-backfill.ts:196`) — the learnings that multiply recommendation and keyword scores are calibrated on noise, and this must be fixed before anything new is wired to learnings.
3. **The commercial proof-of-value layer is built server-side and dark client-side**: the tiered outcome scorecard (`src/components/client/OutcomeSummary.tsx`, ~1,200 lines with dead siblings), its live endpoint, and per-outcome dollar attribution (`action_outcomes.attributed_value`) reach almost no client and no admin screen.
4. **Four public-portal GET endpoints are unauthenticated** (`server/routes/public-portal.ts:246,331,459,622`) — anyone with a workspace UUID can read audit scores, keyword feedback with reasons, and stated business priorities on password-protected workspaces.
5. **Client-paid content gets the platform's weakest generation path**: request-driven briefs skip SERP/reference scraping and outcome recording entirely (`server/content-brief-generation-job.ts:203-309`), so paid posts ship with an empty claim-verification ledger.
6. **Five staging flags hold open three parallel keyword shells and two parallel client overviews**, and the pending Keyword Hub cutover has two ship-blocking regressions: one-click force-bypass of protected keywords (`KeywordActionMenu.tsx:90`) and no manual add-keyword input.
7. **The single highest-leverage AI call — master site synthesis — runs on gpt-5.4-mini at 3000 tokens** while routine brief generation gets gpt-5.4 at 7000 (`server/ai-operation-registry.ts:295`).
8. **The biggest cheap wins are wiring, not building**: dollar values, predicted EMV, rank histories, strategy snapshots, generation telemetry, and 12-month volume trends are all already collected and unconsumed.

---

## 2. The Intelligence Loop Today

The intended loop: external data (GSC/GA4/DataForSEO/Webflow) feeds **strategy generation**, which seeds the **keyword universe** and **content gaps**; gaps and quick wins mint **recommendations**; recommendations and gaps drive **content generation**; completions and publishes become **tracked actions** with GSC baselines; daily measurement scores them into **learnings**; learnings flow back to re-rank recommendations, ground prompts, and improve the next strategy.

**Strong:** The forward path is real and unusually complete. Strategy synthesis consumes five intelligence slices plus client feedback as hard prompt constraints (`server/keyword-strategy-ai-synthesis.ts:296-360`), with a closed-set candidate pool and 3-stage hallucination sanitizer. The strategy then grounds recommendations, briefs, AdminChat, llms.txt, and the client portal through the seoContext slice and a whitelisted public endpoint. Client feedback (declines, requests, votes, priorities) genuinely reaches the next generation. Rec completions record actions with predictedEmv snapshots and GSC baselines (`server/routes/recommendations.ts:199-220`) — the loop closes on paper.

**Broken:** Three failure classes on the back half.
- **Corrupted edge:** learnings exist and are consumed everywhere, but the data crossing them is poisoned (fabricated neutral/loss scores, `not_acted_on` pollution, backfill mislabeling, a "difficulty" multiplier that bins GSC *position* but is matched against provider *KD* — `server/workspace-learnings.ts:216-226` vs `server/outcome-learning-default-path.ts:65-79`). Prompts confidently assert lines like "content refreshes recover traffic 0% of the time."
- **Missing edges:** Keyword Hub lifecycle decisions create no tracked actions in either direction (no `recordAction` in `server/keyword-command-center.ts`); strategy regenerations are outcome-invisible after the first run ever (`server/keyword-strategy-persistence.ts:184`); rec dismissals teach nothing; publishing a post never resolves the matching content_gap rec.
- **Phantom edges:** ADD_TO_STRATEGY shows "in strategy" without writing the strategy (`server/keyword-command-center.ts:3287-3295`); the recommendation engine deliberately drops the contentPipeline slice (`server/recommendations.ts:1091`) so it can recommend content already in production.

Net: intelligence compounds going forward but the system cannot yet learn whether its own advice worked.

---

## 3. Per-Question Synthesis

### Q1 — Do the six surfaces actually connect?

Mostly yes on the forward path; the back path is the problem (see §2). The specific broken edges, each verified in code:

| Edge | Status | Evidence |
|---|---|---|
| Learnings → recs/strategy/content | **Wired but poisoned** | §2; fix is the #1 action item |
| Backfill → calibration | **Mislabeled** | `outcome-backfill.ts:196` hardcodes `audit_fix_applied`; `recommendationOutcomeActionType` mapping exists at `recommendations.ts:198-242` and is bypassed |
| Recs → content creation | **Dead-end** | `mapToProduct` returns `{}` for content type (`recommendations.ts:879-902`); the conversion flow already exists one tab over (`StrategyContentOpportunitiesSection.tsx:194-205`) |
| Recs ← content pipeline | **Blind** | slices override drops contentPipeline (`recommendations.ts:1091`); publish never resolves gap recs |
| Auto-publish → strategy refresh | **Skipped** | only manual route calls `queueKeywordStrategyPostUpdateFollowOns` (`content-publish.ts:224`); approval path (`content-posts.ts:369-441`) doesn't |
| Strategy regen → outcomes | **Once-ever** | `if (!getActionBySource('strategy', ws.id))` guard, `keyword-strategy-persistence.ts:184` |
| Keyword Hub ↔ outcomes | **Absent both ways** | baselines written, never scored; rank_snapshots never feed measurement |
| Hub ADD_TO_STRATEGY → strategy | **Phantom** | feedback row only; UI labels IN_STRATEGY immediately |
| Paid briefs → grounding + outcomes | **Severed on the revenue path** | `content-brief-generation-job.ts:203-309` — no scrape, no recordAction |
| Hub read model → intelligence slices | **UI-only** | only `{count, avgPosition, changes}` reaches prompts (`seo-context-slice.ts:113-141`) — Data Flow Rule 6 partial violation |

### Q2 — Is it useful and usable for the admin (solo founder, many workspaces)?

Per-workspace depth is strong (background jobs with progress, primitives used consistently). Cross-workspace **throughput** is the bottleneck:

- The landing-page "Needs Attention" list is dead text — labels and counts with no onClick, no per-workspace attribution (`WorkspaceOverview.tsx:110-124`). Triage requires manually scanning every workspace.
- **No admin recommendations surface exists.** The admin's only view is a compact client component with tier hardcoded `"premium"` (`WorkspaceHome.tsx:628`); no dismissed-recs view, no un-dismiss, no OV inspection, and zero `addActivity` on client rec actions, so the admin is blind to clients triaging their plan.
- **Action Results dead-ends one level down**: rows are filterable by score but never show scores; the per-action drill-down and notes hooks (`useOutcomeAction`/`useAddOutcomeNote`) have zero component consumers; the delta column reads never-populated `trailingHistory`; attributed dollar value — the most persuasive number the system computes — renders nowhere in admin UI.
- **Silent failures look like success**: 10 swallowed catch blocks in `ContentBriefs.tsx`; auto-publish failure is a `log.warn` while the UI shows "Approved"; AI review results are never persisted, so token spend and the verification audit trail evaporate on editor close (`content-posts.ts:570-581`).
- **The platform makes the admin remember things it knows**: client keyword requests shown only as counts (`KeywordStrategy.tsx:421-423`), no "feedback accumulated since last generation" nudge, three regeneration buttons explained only by hover titles, the admin metrics chips silently broken post table-strip (`routes/keyword-strategy.ts:253` never re-attaches `siteKeywordMetrics`; the guard test masks it by seeding identical fixtures).
- **Pre-cutover Hub regressions** (Q6) directly affect daily workflow: protected-keyword one-click bypass and the lost add-keyword input.

### Q3 — Is it useful and usable for the client?

The skeleton is the best in this product class — StrategyTab's feedback loops, the unified inbox, PostReviewCard's inline TipTap editing, and the #1-priority OV card are genuinely good, and the client-framing rules hold (zero purple in `src/components/client/`, narrative copy, TierGates).

But the **commercial core — proving the retainer is worth it — is under-delivered**:

- The outcome scorecard is dead code (Q7); the only live wins ledger (WinsSurface) is behind the dark `client-briefing-v2` flag; clients never see dollar attribution anywhere; and the wins that do render carry fabricated "recommendation" text (`routes/outcomes.ts:395` builds `'<action_type> action'`), a dead "See full history" link, and a free-tier teaser that miscounts all-time wins as "this month."
- **The feedback loop has no closure signal**: a declined keyword stays visible indefinitely with no "applies at next update" note; client-requested keywords get no rank-trend card despite 180 days of daily history existing.
- **Trust-eroding affordances ship today**: a lock icon on Strategy that opens an upgrade modal that *cannot* unlock it (`clientDashboardNav.ts:28` conflates `seoClientView` with tier), "docx"/"pdf" downloads that deliver CSV/JSON (`ContentPlanTab.tsx:62-64`), an "ROI 62" badge that is a 0-100 score not an ROI (`OverviewTab.tsx:286`), content recs — the highest-priced items — that dead-end with no purchase CTA, and silently swallowed mutation errors in InsightsEngine (`:169` "silently fail").
- Free-tier inbox is nav-invisible but banner-reachable and unguarded; the chat advisor vanishes entirely during onboarding (`ClientChatWidget.tsx:90`), exactly when new clients have questions.

### Q4 — Are AI outputs high quality and well grounded?

The bones are strong: a typed operation registry with per-op contracts, a unified `callAI` dispatcher with research-mode grounding, closed-set strategy prompts with hard declined-keyword filters and pool-sanitization, deterministic-first recommendations and briefings, and honestly force-failed provenance items in content review. Five real weaknesses:

1. **The learning layer feeds fabricated evidence into prompts** (cross-ref Q1 — the single most important quality issue).
2. **Model allocation is inverted**: master site synthesis on gpt-5.4-mini/3000 tokens vs briefs on gpt-5.4/7000; its failure mode degrades silently to the deterministic backfill floor, and the telemetry that would reveal this (`GenerationQuality`) is log-only (`keyword-strategy-generation.ts:588-602`).
3. **The client SEO advisor is grounded on client-supplied unvalidated JSON** — `z.record(z.unknown())` with no size cap serialized verbatim into the system prompt (`public-analytics.ts:302,509`): a prompt-injection, fabricated-data, and unbounded-token-cost vector, when the server already owns authoritative versions of everything via slices.
4. **Review integrity gaps**: AI review and voice scoring see only the first 8000 chars with no disclosure (`content-posts.ts:522-523`); factual ai-fix always rewrites `sections[0]` and never receives the flagged claims (`:794-807`); the internal_links fallback prompt explicitly instructs the model to invent URLs (`:722`); the evidence ledger matches claims against title/URL token overlap because scraped source text is discarded after brief generation.
5. **Deterministic data that would beat current heuristics is collected and ignored**: time-to-completion for effort priors, predicted EMV for dollar calibration, rank deltas for "since last generation" strategy context, GA4 conversions fetched per generation then discarded.

### Q5 — What's missing?

Three clusters, in descending priority for a solo founder:

- **Proof-of-value delivery** (mostly wiring, covered in Q3/Q7): mount the scorecard, show dollars, close the requested-keyword loop, lost-visibility alerts (detection already runs daily but only feeds a passive admin filter chip — no insight, email, or client story, while GSC anomalies *do* email the team).
- **Measurement depth**: rank tracking is GSC-impressions-only (`rank-tracking-scheduler.ts` imports only GSC readers), so aspirational keywords with zero impressions show nothing — a soft-broken promise to clients who add tracked keywords; no competitor positions/time-series/share-of-voice (the `competitorContext` outcome types exist and nothing populates them); no backlink history; zero AI-search visibility tracking despite shipping llms.txt; local SEO has no GBP/reviews despite local-pack SERP responses already containing competitor ratings.
- **Optimization & planning intelligence**: no Clearscope-style term-coverage grading (scraped SERP text is discarded); no goals/targets anywhere in the data model so "are we on track?" is unanswerable; 12-month volume trend arrays cached per keyword (`keyword_metrics_cache`) with zero consumers — seasonality guidance is free and unused; strategy evolution untrendable (4 of 5 history snapshots write-only).

**Adjudication**: the gaps analyst proposes several new-capability builds; the architecture analyst says fix-before-build. Resolution: data-integrity and cutover work first (Now), proof-of-value wiring second (Now/Next), new measurement capabilities third (Later) — with the exception of lost-visibility alerts, which is pure wiring of three existing systems and goes in Now.

### Q6 — Is the platform architected to grow?

Fundamentals are above-average: WAL SQLite, a real background-job platform used by every heavy path, store-layer state machines, a genuine coverage ratchet (61.33% lines, 473 integration files), and an executed normalization playbook (migrations 088-090). **Do not schedule broad coverage or infra work.** Four concentrated risks:

1. **Learnings corruption is growth debt of the worst kind** — it compounds silently as more surfaces subscribe (cross-ref Q1). Freeze new learnings consumers until fixed.
2. **Two stores violate the platform's own normalization rule**: `recommendation_sets` is one JSON blob per workspace rewritten on every status flip, with pending recs getting fresh random ids every regen — the P5/P6 calibration roadmap is being built on unstable rec identity. The `tracked_keywords` row table (migration 118) is a write-only shadow with no scheduled read cutover, permanent dual-write/CAS complexity.
3. **Per-request O(everything) read paths**: the 3,563-line KCC read model is rebuilt from scratch on every pagination click (a 2,000-row ceiling activates with `keyword-universe-full`), and `GET /api/outcomes/overview` runs ~3×W×A synchronous queries (`routes/outcomes.ts:145-193`) on the main thread.
4. **Migration backlog**: five staging flags = three keyword shells + two client overviews maintained in parallel; the briefing data pipeline runs weekly but is dark for most clients. Treat cutovers as features and ship the Hub P5 cutover (with its two blockers fixed) before any new keyword capability. Plus: content domain extraction barely started (1 file in `server/domains/content` vs 16 in inbox) — the 1,021-line `content-posts.ts` route owns AI review, claim extraction, and the inline fire-and-forget publish.

~2,600 lines of dead-but-maintained code (OutcomeSummary, WeCalledIt, FixRecommendations, copy-voice-feedback.ts, etc.) is worse than normal dead code in an agent-driven repo: it answers "does this exist?" with a false yes during the session protocol's existence checks.

### Q7 — Are we leveraging the data we collect?

No — this is the platform's largest untapped asset, and most unlocks are S/M because collection/schema/endpoints already shipped. The "computed but never consumed" inventory:

| Data | Where it sits | What it would unlock |
|---|---|---|
| `attributed_value` ($ per outcome) | migration 106; only consumer is one digest caption | "Value generated this quarter" — the retention number (admin + client) |
| OutcomeSummary scorecard + endpoint | dead component + live `/api/public/outcomes/:id/summary` | Client proof-of-value, one import away |
| `predicted_emv` | accrues, nulled on backfill paths | P6 honest-dollar calibration |
| `earlySignal` (7-day on-track) | broadcast, rendered nowhere | Kills the 30-day black box for pending actions |
| rank_snapshots (180d/keyword) | drawer sparkline only | Keyword-level outcomes + client requested-keyword progress |
| strategy_history (5 snapshots) | only latest read | Strategy-evolution trend for admin + AI |
| `searchSignals`, `competitorKeywordData` | persisted per generation, zero UI consumers | Free cards, or stop persisting (write amplification on the hottest DB row) |
| `GenerationQuality` telemetry | log-only | Generation-health panel + eval fixtures |
| GA4 conversions per generation | prompt-only, discarded | Conversion-weighted quick-win/OV scoring |
| 12-month volume trends | `keyword_metrics_cache`, unused | Seasonality in briefs/planner, zero new spend |
| Client edit/steering signals + `copy-voice-feedback.ts` | collected; classifier module is dead code | Voice-guardrail learning loop |
| AI review verdicts + scraped source text | discarded per run | Review audit trail + real evidence ledger |
| Cross-workspace outcomes | only workspace-scoped reads | Anonymized win-rate priors solving the learnings cold-start (the `keyword_metrics_cache` precedent proves the pattern) |

---

## 4. Prioritized Action Plan

Ranked by value-to-effort for a solo founder. "Now" = next 1-2 PRs; "Next" = this quarter; "Later" = after.

| # | When | Item | Why | Surfaces | Effort |
|---|---|---|---|---|---|
| 1 | Now | **Fix learnings corruption**: backfill uses `recommendationOutcomeActionType(rec.type)`; filter `not_acted_on` from measurement + learnings; phantom metrics score `inconclusive` (generic metric-presence guard); disable difficulty multiplier until rebinned; implement the `disabled` availability switch | Every AI prompt and score multiplier downstream is calibrated on noise; clamps bound but don't eliminate the damage | Action Results, Recs, Strategy, Content, Hub | M |
| 2 | Now | **Auth the four open public-portal GETs** (`public-portal.ts:246,331,459,622`) | Audit scores, keyword feedback with reasons, and business priorities readable by anyone with a UUID | Client Dashboard | S |
| 3 | Now | Request-driven briefs: add SERP/reference scrape + `recordAction` (shared enrichment helper with standalone path) | Clients pay for the weakest grounding path and an empty evidence ledger | Content, Client, Action Results | S |
| 4 | Now | Hub cutover blockers: ConfirmDialog instead of auto-`force:true` on protected actions; add-keyword input in Hub header | Both regressions ship at the P5 flag flip otherwise | Keyword Hub | S |
| 5 | Now | Mount OutcomeSummary on client ROI/Overview; surface `attributed_value` in OutcomeTopWins + WinsSurface; fix fabricated `recommendation` string | The retention feature, already built; sequence after #1 so the numbers shown are honest | Action Results, Client | S |
| 6 | Now | Upgrade `keyword-site-synthesis` to gpt-5.4 (~4-5k tokens); persist `GenerationQuality` rows | Highest-leverage call on cheapest model; makes the change measurable | Strategy | S |
| 7 | Now | Re-attach `siteKeywordMetrics` in admin GET (mirror `public-content.ts:165`); fix the masking test with divergent fixtures | Paid metrics silently vanished from admin after table-strip | Strategy | S |
| 8 | Now | Client trust batch: split tier-lock vs admin-hidden on Strategy nav; honest docx/CSV labels; WinsSurface dead link + teaser count; mutation-failure toasts in InsightsEngine + ContentBriefs | Five cheap fixes that each erode trust today | Client, Recs, Content | S |
| 9 | Now | Lost-visibility → mint insight + opportunity_event + briefing story candidate | Detection already runs daily; pure wiring of three existing systems; the proactive alert that justifies a retainer | Hub, Recs, Client | S |
| 10 | Now | Replace `/api/outcomes/overview` per-action loops with one aggregate SQL | ~3×W×A synchronous queries blocking the event loop | Action Results | S |
| 11 | Next | Recs ↔ content reconciliation: add contentPipeline slice; suppress recs matching in-flight briefs/posts; resolve gap recs on publish; content-rec CTA → existing brief-purchase flow | Closes the strategy→rec→content→revenue loop at its highest-value link | Recs, Content, Client | M |
| 12 | Next | Extract one `publishPostToWebflow` domain service running through the job platform (fixes silent auto-publish failure + skipped follow-ons + field-map drift) | Two divergent publish copies have already drifted; failures are invisible | Content, Strategy, Recs | M |
| 13 | Next | Close the client keyword loop: requested-keyword list with one-click add (reuse MCP `add_keyword_to_strategy` write); make ADD_TO_STRATEGY write the artifact (or relabel honestly); "applies at next update" note on declines; "feedback since last generation" nudge | A client request currently records, then nothing prompts or guarantees action | Strategy, Hub, Client | M |
| 14 | Next | Strategy outcome visibility: drop the once-ever guard; record per-keyword actions for net-new pageMap primaries (real pageUrl → scoreable) | `learningsDomain:'strategy'` is structurally starved today | Strategy, Action Results | M |
| 15 | Next | Keyword-level outcome bridge: recordAction on track/promote, scored against `rank_snapshots` vs stored baselines; client requested-keyword rank-trend card | The cheapest unbuilt edge with the highest learning + retention payoff; data exists end-to-end | Hub, Action Results, Client | M |
| 16 | Next | Persist AI review results + scraped SERP/reference source text on the brief | Review audit trail, real-text claim matching, free quality analytics; ends repeated token spend | Content | M |
| 17 | Next | Server-side grounding for client chat: replace `req.body.context` injection with slice-derived blocks; enum-validated, size-capped client hints only | Prompt injection + fabricated data + unbounded token cost on a public endpoint | Client | M |
| 18 | Next | Keyword Hub P5 cutover: flip flags, fold seo-ranks in, delete KCC + RankTracker shells, cut tracked_keywords reads to the row table, strip blob, delete CAS machinery | Ends three-shell maintenance and the dual-store drift window in one validation cycle | Hub, Strategy | L |
| 19 | Next | Admin recommendations surface (full queue, dismissed view, OV breakdown) + `addActivity` on client rec PATCH/DELETE | The admin currently borrows a client component and is blind to client triage | Recs | M |
| 20 | Next | Snapshot `predictedEmv` on all completion paths; aggregate time-to-completion into effortDays; schedule P6 realized-vs-predicted calibration | The OV ranking spine runs on hardcoded priors while its calibration data accrues unused | Recs, Action Results | M |
| 21 | Next | WorkspaceOverview "Needs Attention" deep links + severity sorting | The solo founder's daily triage surface answers "what" without "where" | All | M |
| 22 | Next | Cross-workspace `platform_learnings` priors as the no_data/degraded fallback tier | Solves the learnings cold-start that affects most workspaces; pattern proven by `keyword_metrics_cache` | Action Results, Recs | M |
| 23 | Next | Decide briefing-v2: set a cutover date or backport WinsSurface to the legacy overview | Weekly briefing pipeline runs dark for most clients; dual overviews double every change | Client | L |
| 24 | Later | Normalize `recommendation_sets` into a table with deterministic ids (merge-key-derived) | Required substrate for P5/P6 features and per-rec learning; follow the 088-090 template | Recs, Action Results | L |
| 25 | Later | Provider SERP position checks for tracked keywords (budget-capped, zero-impression + client-requested first) + persist competitor positions from the same responses | Keywords clients ask about page-5 rankings show nothing today; competitor time-series falls out free | Hub, Client, Strategy | M |
| 26 | Later | Workspace goals (target clicks/mo + date) + trajectory line on Performance + on-track narrative in digest/briefing | Without goals the dashboard reports activity, not progress | Client, Strategy | M |
| 27 | Later | Content performance join-back (post GSC trend by brief attributes, generationStyle comparison, client-edit-rate rollup) + term-coverage grading from persisted SERP text | The "what content works here" dataset, unexploited; #16 is the prerequisite | Content, Action Results | L |

**Minor items** (fold into adjacent PRs): delete dead components (FixRecommendations, WeCalledIt, ClientActionDetailModal, InsightCards, `copy-voice-feedback.ts` — or wire the last into request-changes); render-or-strip `searchSignals` + reuse persisted `competitorKeywordData` in CompetitiveIntel; seasonality sparkline from cached volume trends; earlySignal badges; show outcome scores on OutcomeActionFeed rows + sync the type filter to all 15 labels; store raw keyword strings in `upsertFeedback` (not comparison keys); KCC placeholder counts → skeletons; competitors-field clear bug (`KeywordStrategy.tsx:154-158`); advanced-filter page reset (`useKeywordHubState.ts:174-179`); Zod `validate()` on rec PATCH; tighten the strategy PATCH `.passthrough()`; whitelist the public brief endpoint like the strategy route; consume-or-delete `topOpportunityRationale`; `formatForPrompt` skip option for deterministic consumers; refresh the stale coverage-baseline doc; gate ClientDashboard's ~20 bootstrap hooks per tab before the briefing-v2 cutover; replace the post-generating poll with the existing WS event.

---

## 5. Things That Are Genuinely Good — Do Not Churn

- **The intelligence slice architecture and the client feedback loop.** ClientSignalsSlice → strategy prompts is a real, working differentiator: declines hard-excluded, requests prioritized, priorities authority-resolved (`keyword-strategy-ai-synthesis.ts:320-360`).
- **Closed-set strategy synthesis with the 3-stage sanitizer and honest backfill flags** — the best-grounded AI path in the platform, with hallucination structurally bounded by the candidate pool.
- **Deterministic-first design where it matters**: the recommendation engine, briefing templates, outcome measurement, and Hub read model make zero AI calls — cheap, reproducible, no hallucination. Keep this discipline.
- **The background-job platform** — every heavy generation path uses it correctly, with progress, cancellation, and usage refunds.
- **The provenance-honest content review**: force-failed factual items, deterministic claim extraction, human-in-the-loop by design. (Fix its evidence inputs; don't touch its philosophy.)
- **Client portal craft**: unified inbox routing, PostReviewCard inline editing with flush-before-action, the #1-priority card with component bars, the end-to-end `?tab=` deep-link contract, and zero purple in client components.
- **Test and flag hygiene**: 473 integration files, a real enforced coverage ratchet, state machines at the store layer, and flags with owners/removal-conditions/audit cadences. The gap is cutover *execution*, not hygiene.
- **The new KeywordHub shell itself** — segments, journey drawer, bulk actions, a11y — is materially better than what production runs; it needs the two blockers fixed and shipping, not rework.
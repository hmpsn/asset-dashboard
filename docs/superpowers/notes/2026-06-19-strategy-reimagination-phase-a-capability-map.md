# Strategy Reimagination — Phase A Confirmed Capability + Data Map

_Auto-assembled from a 6-agent verification pass (2026-06-19) that pressure-tested the
`2026-06-19-strategy-reimagination-understanding-brief.md` claims against the live code.
This is the GROUND TRUTH the concept tournament (Phase B) designs against — where it
disagrees with the understanding brief, this map wins (it read the code; the brief asserted)._

## 1. Verdict on the thesis

**CONFIRMED, with one sharpening.** The drafting brain genuinely is ~70% built: a slice-fed AI "drafts a POV" engine (`meeting-brief-generator.ts`), a battle-hardened single-writer curation lifecycle (`recommendation-lifecycle.ts`), a fully-renderable rec set with deterministic `insight`/`estimatedGain`/`evidence` strings (zero new AI), and a working deliverable spine with a respond/apply loop all exist. The sharpening: the curation spine is a **cut/send/park/fix** spine, not a full keep/cut/**edit**/**reorder**/**add** draft editor — ~40% of the proposed verb set (reorder, edit-rationale, generic add) needs real, pattern-consistent backend substrate before a surface can mount it. The "send dead-end" is also worse than framed (the deliverable-channel branch the lifecycle comment claims simply does not exist in the send route), which makes "close the loop" a genuine prize, not a polish.

## 2. Confirmed reusable substrate

- **POV drafting engine** — `server/meeting-brief-generator.ts:191-288`. Named AI op `'meeting-brief'` with Zod validation + retry; pulls 6 slices via `withActiveLocalSeoSlice(BRIEF_SLICES)`. Mount-anywhere (already dual-mounted in `App.tsx:421` + `WorkspaceHome.tsx:359`); not coupled to Home.
- **AI-free metrics presenter** — `assembleMeetingBriefMetrics(intel)` `server/meeting-brief-generator.ts:44-58`. Pure exported fn over `WorkspaceIntelligence`; drop onto Strategy as an at-a-glance header strip with zero AI cost.
- **Content-hash cache** — `buildPromptHash` `server/meeting-brief-generator.ts:139-175` + `meeting-brief-store.ts`. Already carries a tier-aware rec signal (`topRecommendationId`+`topTier`, lines 128-136); recompute is cheap, so a pre-baked draft "opens ready, not spinning."
- **Single-writer curation spine** — `server/recommendation-lifecycle.ts:58-75` (`mutateRec` txn re-read) + verbs send/strike/throttle/unstrike/fix. Trust invariant confirmed: none write `rec.status`.
- **Two-axis lifecycle model** — `shared/types/recommendations.ts` `status`/`clientStatus`/`lifecycle`; `state-machines.ts:100-123` (`RECOMMENDATION_TRANSITIONS` + `CLIENT_REC_TRANSITIONS`).
- **Regen-survival graft** — `applyLifecycleCarryOver` `server/recommendations.ts:617-636`; a sent rec stays sent through regen.
- **One surfacing predicate** — `isActiveRec` `server/recommendations.ts:661-667`, imported by every reader. Reuse verbatim so Strategy queue and brief agree on membership.
- **Renderable drafted POV** — every rec carries required `insight` + `estimatedGain` (`shared/types/recommendations.ts:17,28`); `opportunity.components[].evidence` one-liners (`server/scoring/opportunity-value.ts:312-322`); client-safe `topOpportunityRationale` (dollar-free join, `server/recommendations.ts:708-718`). All deterministic — no render-time AI.
- **Atomic bulk curation route** — `POST /api/recommendations/:workspaceId/bulk` `server/routes/recommendations.ts:426-506`; N-rec keep/cut/send in one txn — ready backbone for an "apply all my decisions" commit button.
- **Deliverable spine respond loop** — `server/routes/deliverables.ts:210` (`/respond`), `:247` (`/apply`), `+/remind`; client read `unified-inbox-read.ts:184`. The only path that closes admin→client→response.
- **Cross-type send-history ledger** — `listAdminDeliverables()` `server/domains/inbox/admin-inbox-read.ts:69` → `AdminDeliverableView` with `statusAxis`/`ageDays`/`stale`. Answers "what did I send / what did they say / what's overdue" across all send types.
- **Curation-UI shell precedent** — `src/components/admin/BriefingReviewQueue.tsx:37-227` (draft→approve→publish + required `adminNote` + state-machine-guarded store). Reuse as the review-shell template (note: whole-document grammar, not per-item).
- **Weekly push cron** — `server/briefing-cron.ts` (Monday 14:00 UTC, idempotent, mutex, gating, manual-bypass, auto-publish). Near-verbatim clone target for a pre-baked draft job.
- **Production doorbell rail** — `notifyClientCuratedRecsSent` `server/email.ts:354` + `email-queue.ts` (batched/persisted/dead-lettered/morning-digest) + `email-throttle.ts`. Channel-agnostic PUSH for a pre-baked brief; only a new template/event needed.
- **Calibrated brand-voice prose** — `callCreativeAI` `server/content-posts-ai.ts:73` + `SeoContextSlice.effectiveBrandVoiceBlock` `server/intelligence/seo-context-slice.ts:127`. Render a "letter from the strategist" in the client's own voice.
- **Live presence** — `getPresence()` `server/websocket.ts:40` + `presence:update`. "Client is in the portal now" / time a nudge to when they're online.

## 3. Corrections to the brief

- **The brief's `recommendations[]` are NOT sourced from the rec set** — they are freshly AI-generated from `buildBriefPrompt` (insights+learnings+siteHealth, `meeting-brief-generator.ts:61-126`). The only rec-set contact is `buildBriefRecSignal` reading one ID **purely as a cache key**, and that ID (`topRecommendationId`) is by construction the top **non-sent active** rec — the *inverse* of the curated/sent set. Serving meeting-prep from the curated POV requires re-pointing the prompt AND expanding the cache signal.
- **`lifecycle` (active/throttled/struck) is NOT state-machine-guarded** — unlike `clientStatus`. Strike/throttle/unstrike mutate it directly with hand-rolled idempotency guards. A keep/cut grammar built on lifecycle has no transition map to lean on; the designer owns legality.
- **`'curated'` is a vestigial state** — the only `clientStatus` write in the codebase is `='sent'`; `sendRecommendation` collapses system→curated→sent internally. No route sets `clientStatus='curated'` standalone.
- **The send dead-end is real AND the deliverable-channel branch is missing** — public rec read filters only `status`+`priority`, never `clientStatus` (`routes/recommendations.ts:193-196`); allow-list strips `clientStatus`/`sendChannel`. Even cannibalization (the one `sendChannel:'deliverable'` policy) is **not** mirrored to the spine — no `mirrorClientActionToDeliverable` call in the send handlers. The lifecycle comment claiming "the P2 route handles the deliverable branch" describes code that does not exist.
- **`content_decay` is NOT a RecType** — no entry in `RecType` or `REC_POLICY_REGISTRY`; reaches the spine only as a `ClientActionSourceType`. The only `sendChannel:'deliverable'` RecType is `cannibalization`.
- **`topOpportunityRationale` is OPTIONAL** — undefined when the #1 rec has no `opportunity.components`. Fall back to the always-present `rec.insight`. `opportunity`/`components` are likewise optional on legacy rows.
- **`estimatedGain` is a static/template string**, not a per-render economic projection — the real economic quantity (`emvPerWeek`) lives on `opportunity` and is admin-only.
- **The meeting brief is PULL, not PUSH today** — manual-only via `POST /api/workspaces/:id/meeting-brief/generate`; no cron schedules it. It is a single upserted document with **no** status/adminNote/approve-skip — NOT the draft→approve→publish flow (that's `briefing_drafts`, a separate subsystem).
- **No client meeting/QBR/cadence date exists anywhere** — targeted grep across schema+types returned zero. The "Faros meeting Thursday → prepped agenda" concept has no backing data.

## 4. Gaps / net-new work

| Gap | File / pattern | Lift |
|---|---|---|
| **Strategy-POV fusion op** (re-point the brief at the curated/sent set + expand cache signal) | extend `buildBriefPrompt` + `buildBriefRecSignal`/`buildPromptHash` | **MEDIUM** |
| **`normalizeRecommendation` inbox adapter** (recs → `NormalizedDecision`) | none exists; `decision-adapters.ts` has only action/batch/deliverable | **MEDIUM** |
| **rec→deliverable adapter + wire the missing mirror branch** (closes the loop) | mirror `deliverable-adapters/cannibalization.ts`; reuse `getAdapter`+`upsertDeliverable`+`DELIVERABLE_SENT` | **MEDIUM** |
| **Pushed-draft cron job** | clone `briefing-cron.ts`; +1 line `BACKGROUND_JOB_TYPES` + metadata; key off weekly tick | **MEDIUM** |
| **EDIT-RATIONALE** (in-place rewrite; must survive regen re-mint) | no write path; only append-a-note `rec_discussion` | **LARGE** |
| **REORDER** — no persisted `sortOrder` field; ordering is computed | new column + mapper + carry-over + sort-comparator | **LARGE** |
| **Generic ADD-a-rec** | exists competitor-only (`POST .../competitor-rec`); generalize w/ strict schema | **MEDIUM** |
| **Expose `delivered` to client** (option b) | add to `stripEmvFromPublicRecs` allow-list + `.filter(clientStatus==='sent')` | **SMALL** |
| **Archetype + create/refresh/defend maps** | new exhaustive `Record<RecType,Archetype>` + reuse `recommendationOutcomeActionType` | **SMALL** |
| **Calendar / next-meeting data** | net-new `workspaces.next_meeting_at` or `meetings` table, or calendar integration | **LARGE** (optional) |

## 5. Net-new data finds (highest-leverage, brief missed)

- **Cross-type send-history + response ledger** — `listAdminDeliverables()` → `AdminDeliverableView{statusAxis, ageDays, stale}` (`admin-inbox-read.ts:69`). Powers a **"Since we last spoke"** rail (every artifact sent, the client's decision, "awaiting N days") — pure read. Single best fit for the four-jobs north star.
- **Pre-aggregated client rec responses** — `ClientSignalsSlice.recResponses` (`client-signals-slice.ts:552-589`): approved/declined/discussing counts + `recentResponses[]` w/ `respondedAt`. A **"the loop"** panel reads this directly.
- **Structured client GOALS / personas / knowledgeBase** — `SeoContextSlice.businessProfile{industry, goals[], targetAudience}` (`seo-context-slice.ts:199-211`), personas, `knowledgeBase`. Frame & rank POV by the client's *stated* objective — the missing **"why this matters to YOUR goal"** tier.
- **Client's discovered/lost search terms** — `getDiscoveredQuerySummary` → `{totalDiscovered, lostVisibilityCount, topLostQueries[]}` (`seo-context-slice.ts:170-184`). High-emotion **"queries you used to win and just lost"** talking point.
- **Per-feature engagement** — `EngagementMetrics.portalUsage.featuresUsed[]` (`client-signals-slice.ts:301-349`) + `distinctDays`. Steer the agenda by what the client actually touched.
- **Editorial cadence engine** — `suggestPublishDates`/`suggestDraftSchedule` (`content-calendar-intelligence.ts:25,124`). Turns the content-plan job into a dated **"3 posts shipping over 2 weeks"** rail.
- **Client strategy-aware chat** — `POST /api/public/search-chat/:workspaceId` w/ a `'strategy'` category grounded in the same slices; admin equivalent `selectAdminChatSlices`. Add **"ask about this recommendation."**
- **Free presentation maps:** `recommendationOutcomeActionType` (`recommendations.ts:203-234`) encodes create/refresh/defend per RecType; `REC_TYPE_ADMIN_TAB` + `buildRecFixContext` (`recTypeTab.ts:15-53`) wire each card's "fix it" CTA.

## 6. Implications for the concept tournament (Phase B)

1. **The drafted POV is FREE and AI-free to render.** Don't propose new AI to "explain" recs — `insight` + `estimatedGain` + `evidence` already exist deterministically. Fall back to `insight` for legacy rows.
2. **Archetype grouping + create/refresh/defend counts are free** from `RecType` + a thin map. Exploit; don't treat as needing AI/new data.
3. **The mountable-as-is curation grammar is cut/send/park/fix.** edit-rationale, reorder, generic add are NOT free (LARGE/MEDIUM). A "triage queue" is cheap; a Clearscope in-place editor is the most expensive ambition. Price your verb set against this split.
4. **"Close the loop" = route rec-sends through the deliverable spine** (option a); step zero is wiring the missing mirror branch. Avoid building a second parallel client surface (option b) unless deliberately scoping down.
5. **A pushed, pre-baked, periodically-regenerated draft is fully feasible** (clone `briefing-cron` + one job type + doorbell rail + cheap hash cache). Assume "opens ready, pushed each cycle" is buildable.
6. **The calendar tie has NO backing data — treat "meeting Thursday" as OPTIONAL.** Key cadence off a weekly generation tick unless a concept explicitly budgets new `next_meeting_at` data.
7. **Richest unexploited anchors:** the send-history ledger ("since we last spoke"), pre-aggregated rec responses ("the loop is closing"), and the client's own stated goals/personas ("toward YOUR goal"). A winning concept frames the POV around these — all existing reads, no new collection.

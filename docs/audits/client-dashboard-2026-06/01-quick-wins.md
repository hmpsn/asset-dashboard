# Client Dashboard Audit — Quick Wins (2026-06-11)

> Deliverable 1 of 3. Source: [00-findings.md](./00-findings.md) (8-agent audit of `origin/staging` @ ff6c3caa).
> Companion docs: 02 (medium-term improvements), 03 (strategic bets).

## Scope & how to read this doc

Every item here is shippable in **hours to ~2 days**, requires **no architectural change and no
new bounded context**, and respects the locked decisions in the findings doc (unified Inbox with
Decisions/Reviews/Conversations, soft-gating via `<TierGate>`, free data visibility stays free,
client data through `ClientIntelligence` slices, background job platform for long work).

Items are grouped by theme. Each lists rationale, affected files, rough effort, and impact.
Many items are independent and parallelizable, but note the pairings called out inline
(e.g. `assembledAt` is the server half of the freshness-timestamp UX item). The doc ends with
a suggested first PR batch.

Effort estimates assume the standard quality gates (`npm run typecheck && npx vite build`,
`npx vitest run`, `npm run pr-check`) and that data-flow rules apply: any new mutation
broadcasts via `broadcastToWorkspace()` with a `server/ws-events.ts` constant, and any new
broadcast gets a `useWorkspaceEvents` handler.

---

## Theme 1 — Data-layer hygiene (do these first; they de-risk everything else)

### 1.1 Add `staleTime` to GA4/GSC hooks
Every tab focus currently refires 7–12 parallel Google API calls — a real quota and latency
risk that degrades the free-data experience that is our retention cornerstone. Other client
hooks already set 5–60 min `staleTime`; these two are the outliers.
- **Files:** `src/hooks/client/useClientGA4.ts`, `src/hooks/client/useClientSearch.ts`
- **Effort:** 1–2h (pick values consistent with GA4's 24–48h lag; ~10–15 min is safe)
- **Impact:** High

### 1.2 Convert `getSafe()` → `get()` on critical inbox/decision paths
`getSafe()` swallows errors and renders them as "no data" — a client whose approvals endpoint
500s sees an *empty inbox*, the most trust-destroying failure mode possible (looks like the
agency did nothing). Convert the queries backing the Inbox (approvals, client-actions,
requests, content-requests) to throwing `get()` so React Query surfaces `isError` and the
existing `<ErrorState>` renders with retry. Leave `getSafe` on genuinely optional decoration
(annotations, anomalies) where empty-on-error is acceptable.
- **Files:** `src/hooks/client/useClientQueries.ts` (lines ~70–99 per findings), consuming
  components already handle error states via `<ErrorState>` / `<ErrorBoundary>`
- **Effort:** 3–5h including verifying each consumer renders an error state, not a crash
- **Impact:** High

### 1.3 Wire the top-5 missing WS event handlers
Only ~37 of 67 broadcast events have client handlers, so clients sit on stale caches until
manual refresh — e.g. a brief updated by the admin doesn't appear until reload. Add
`useWorkspaceEvents` handlers (never `useGlobalAdminEvents`) that invalidate the matching
`client-*` query keys for the five highest-traffic gaps: `BRIEF_UPDATED`, `ANOMALIES_UPDATE`,
`INTELLIGENCE_SIGNALS_UPDATED`, `OUTCOME_*`, `SCHEMA_*`.
- **Files:** `src/components/ClientDashboard.tsx` (or the per-tab hook that owns the cache),
  event constants in `server/ws-events.ts`, query keys in `src/hooks/client/*`
- **Effort:** 4–6h (5 events × handler + invalidation + smoke check each)
- **Impact:** Med–High

### 1.4 Add `assembledAt` to the intelligence payload
`/api/public/intelligence/:wsId` has no staleness field, so the frontend cannot tell clients
how fresh AI context and derived cards are. Add `assembledAt: string` (ISO) to the assembled
intelligence type and set it in the facade — this is the server half of item 2.1.
- **Files:** `shared/types/intelligence.ts` (typed contract first, per data-flow rule 5),
  `server/workspace-intelligence.ts` (`buildWorkspaceIntelligence()` facade — set once at
  assembly, not per slice), `src/hooks/client/useClientIntelligence.ts`
- **Effort:** 1–2h
- **Impact:** Med (enabler for 2.1)

---

## Theme 2 — UX polish on core data tabs

### 2.1 Data freshness timestamps ("as of …") on metric surfaces
Health shows "last scanned"; nothing else shows freshness. GA4 lags 24–48h and clients can't
tell whether a flat chart means "no traffic" or "data not in yet" — a recurring source of
support questions and mistrust. Add a small `.t-caption` "Data as of {relative time}" line to
the Performance/Search/Analytics metric headers (from query `dataUpdatedAt` or the new
`assembledAt` from 1.4).
- **Files:** `src/components/client/PerformanceTab.tsx`, `SearchTab.tsx`, `AnalyticsTab.tsx`,
  `OverviewTab.tsx`; consider a tiny shared `FreshnessStamp` helper in `src/components/ui/`
  rather than four inline copies (UI/UX rule 9)
- **Effort:** 3–4h
- **Impact:** High

### 2.2 Analytics sub-tab: takeaway summary + conversion-rate color coding
Analytics is the only data tab with no narrative — raw numbers, no good/bad signal, 12+
ungrouped events. Two cheap fixes from the Search tab's playbook: (a) a takeaway summary line
at the top (deterministic template from the data, no AI call needed), and (b) color-code
conversion rates using the existing score helpers (`scoreColorClass()` semantics: blue for
the metric value per the Four Laws, emerald/amber/red only where a judgment is genuinely
scored). Do **not** restructure the tab — that's medium-term work.
- **Files:** `src/components/client/AnalyticsTab.tsx` (567 lines; additive change only)
- **Effort:** 4–6h
- **Impact:** High — converts the weakest data tab from "explorer" to "guided"

### 2.3 ROI methodology explainer
The ROI formula is transparent and conservative but unexplained, so skeptical clients discount
it. Add an info popover/expandable ("How we calculate this") describing inputs and the
conservative assumptions. Keep it copy-only — this *aligns with* roadmap #74 (ROI dashboard
polish) as its first slice, it does not replace it.
- **Files:** `src/components/client/ROIDashboard.tsx`
- **Effort:** 2–3h
- **Impact:** Med

### 2.4 Composite health ring breakdown
The composite health score (churn 40% / ROI 30% / engagement 30%) is shown but its weighting
is opaque — clients see a number with no levers. Surface the three components on
hover/expand of the ring. Flagged in findings §6 as a ~2h win; data is already assembled
server-side.
- **Files:** `src/components/client/HealthScoreCard.tsx` (and/or `health-tab/` model), read via
  the existing intelligence projection — no new route reads
- **Effort:** ~2–3h
- **Impact:** Med

---

## Theme 3 — Workflow feedback loops (Inbox, Content Plan, Strategy)

### 3.1 Post-approval "next step" toast
After approving, the item silently leaves the Decisions list — clients don't know it moved to
"Ready to publish" and sometimes re-ask. Show a toast on successful respond: "Approved — we're
publishing this. Track it in Reviews." Pure frontend; the mutation already exists.
- **Files:** `src/components/client/DecisionCard.tsx`, `DecisionDetailModal.tsx`,
  `UnifiedInbox` respond handler (`src/hooks/client/useUnifiedInbox.ts`)
- **Effort:** 2–3h
- **Impact:** Med–High (directly reduces "did it work?" support pings)

### 3.2 Flag-submission confirmation on Content Plan
Flagging a content-plan cell is currently silent — clients can't tell the flag was received,
making the tab feel read-only. Add a success toast ("Flag sent — we'll review and reply in
your Inbox") and an optimistic flagged-state on the cell.
- **Files:** `src/components/client/ContentPlanTab.tsx` (+ its flag mutation hook)
- **Effort:** 1–2h
- **Impact:** Med

### 3.3 Comment-count badges on work-order conversation threads
Conversation threads give no signal that replies exist, so clients miss admin responses. The
thread data is already fetched (`useWorkOrderConversation.ts`); render a count `<Badge>`
(blue — it's data, not an action) on the Conversations list rows.
- **Files:** `src/components/client/inbox/` thread list components,
  `src/hooks/client/useWorkOrderConversation.ts`
- **Effort:** 2–3h (verify the count is available list-side without N+1 fetches; if it needs a
  field on the list endpoint, that's a one-column serialization addition in `public-portal.ts`)
- **Impact:** Med

### 3.4 Keyword feedback summary card on Strategy
"You've approved 91% of our keyword suggestions" turns the feedback loop into visible
collaboration and reinforces that client input shapes the strategy. Findings §6 flags this as
~2h; the pattern data exists server-side — surface it through the existing
`clientSignals`-backed projection, not a new ad hoc read.
- **Files:** `src/components/client/StrategyTab.tsx` (new `<SectionCard>` summary block)
- **Effort:** ~2–4h (more if the stat isn't yet in the client intelligence payload)
- **Impact:** Med

### 3.5 "We Called It" card expansion
The prediction showcase is one of the strongest trust artifacts on Overview; findings flag a
~3h narrative expansion (richer before/after framing per prediction). Keep it on Overview —
no new tab.
- **Files:** `src/components/client/PredictionShowcaseCard.tsx`
- **Effort:** ~3h
- **Impact:** Med

---

## Theme 4 — Monetization

### 4.1 Trial countdown banner (dashboard-wide)
Trials currently end silently — the single worst conversion leak. `ws.isTrial` /
`ws.trialDaysRemaining` already exist in the public workspace payload (used in
`PlansTab.tsx:32,139`); render a dismissible amber banner in the client shell when
`trialDaysRemaining <= 5`, linking to Plans. MONETIZATION.md already specifies this — it's
unbuilt spec, not a new idea. Hide in betaMode (no upsell UI there).
- **Files:** `src/components/client/ClientHeader.tsx` or `src/components/ClientDashboard.tsx`
- **Effort:** 2–3h
- **Impact:** High

### 4.2 Day-10 trial warning email
The other half of the MONETIZATION.md trial spec. A daily check (existing cron/scheduler
surface — this is a short scheduled task, not a background job platform case) that emails
once at day 10 with days remaining + Plans link, with a sent-flag so it never double-sends.
- **Files:** server scheduler module + email helper; flag column or keyed activity entry to
  dedupe
- **Effort:** 4–6h
- **Impact:** High

### 4.3 Chat usage counter in the chat widget
"2 of 3 free conversations left" creates scarcity for free users and fairness transparency for
Growth. The endpoint already exists (`GET /api/public/chat-usage/:workspaceId` in
`server/routes/public-chat.ts`) — this is a fetch + caption render in the widget footer.
- **Files:** `src/components/client/ClientChatWidget.tsx`, small hook in
  `src/hooks/client/` (`client-*` query key)
- **Effort:** 2–3h
- **Impact:** Med–High

### 4.4 Enforce the Growth 50-chat/month limit
The free 3/mo limit is enforced; Growth's 50/mo is counted but not enforced — an unmetered
cost leak and an inconsistency with what we sell. Extend the existing rate-limit check
(`checkChatRateLimit`, used by `server/routes/public-chat.ts`, implemented alongside
`server/chat-memory.ts` / `server/usage-tracking.ts`) to return limit-reached for Growth, with
a friendly upgrade-to-Premium message in the widget (soft-gate language, not a hard wall).
Ship 4.3 first or together so the limit is never a surprise.
- **Files:** `server/chat-memory.ts` / `server/usage-tracking.ts`,
  `server/routes/public-chat.ts`, `ClientChatWidget.tsx` limit-state message
- **Effort:** 3–4h incl. an integration test against the public chat route (test the actual
  read path, per test conventions)
- **Impact:** Med (cost control + tier integrity)

### 4.5 Inline prices before checkout
Clients currently commit to Stripe Checkout before seeing a number in some brief/fix flows —
price surprise kills conversion. Ensure every purchase CTA shows the price inline on the
button or confirmation modal before redirecting.
- **Files:** `src/components/client/PricingConfirmationModal.tsx`, `SeoCart.tsx` /
  `useCart.tsx`, purchase CTAs in `PlansTab.tsx` and deliverable cards
- **Effort:** 3–4h (audit each CTA; prices are already in config/payload)
- **Impact:** Med–High

---

## Theme 5 — Code hygiene & accessibility

### 5.1 Justify or fix the bare eslint-disable
`useClientWorkspaceBootstrap.ts:168` has the repo's one unjustified
`react-hooks/exhaustive-deps` suppression — per CLAUDE.md every suppression needs an inline
justification or a real dep-array fix. Cheap now, stale-closure bug later.
- **Files:** `src/components/client/client-dashboard/useClientWorkspaceBootstrap.ts:168`
- **Effort:** 0.5–1h
- **Impact:** Low (debt prevention)

### 5.2 `role="dialog"` on DecisionDetailModal
The bulk-approval modal — the highest-stakes client interaction — is invisible to screen
readers as a dialog. Add `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` pointing
at the modal title.
- **Files:** `src/components/client/DecisionDetailModal.tsx`
- **Effort:** 0.5–1h
- **Impact:** Low–Med (a11y compliance on a core flow)

### 5.3 Menu roles + missing aria-labels in ClientHeader
Header dropdowns lack `role="menu"`/`role="menuitem"`, and several icon-only buttons lack
`aria-label`. Sweep the client shell once.
- **Files:** `src/components/client/ClientHeader.tsx` (+ icon buttons flagged in findings §8)
- **Effort:** 1–2h
- **Impact:** Low–Med

---

## Suggested first PR batch

Ordered for one sprint of small PRs (staging-first, one concern per PR). Rationale: fix the
silent-failure and quota risks before adding UI that depends on those data paths; ship the
two highest-leverage trust items (freshness, Analytics takeaway) and the two highest-leverage
revenue items (trial banner, chat counter + enforcement) in the same window.

| # | Item | Why first |
|---|------|-----------|
| 1 | 1.1 `staleTime` on GA4/GSC hooks | Two-line risk fix; protects Google quota for everything else |
| 2 | 1.2 `getSafe`→`get` on inbox paths | Eliminates the "empty inbox on error" trust hazard |
| 3 | 1.4 + 2.1 `assembledAt` + freshness stamps | One PR, server+client halves of the same contract; kills the #1 "is this data right?" question |
| 4 | 4.1 Trial countdown banner | Highest-leverage conversion fix; data already in payload |
| 5 | 4.3 + 4.4 Chat counter + Growth enforcement | Ship together so the limit is transparent, never a surprise |
| 6 | 2.2 Analytics takeaway + color coding | Biggest single UX upgrade per hour in the data tabs |
| 7 | 3.1 Post-approval toast | Closes the most-felt workflow loop, trivially small |
| 8 | 3.2 Flag-submission confirmation | Same pattern as #7, do in the same PR or back-to-back |
| 9 | 5.1 + 5.2 + 5.3 hygiene sweep | One small PR; zero product risk; clears the audit's code-quality flags |

Second wave (still quick wins): 1.3 WS handlers, 2.3 ROI explainer, 2.4 health ring breakdown,
3.3 comment badges, 3.4 keyword feedback card, 3.5 We-Called-It expansion, 4.2 day-10 email,
4.5 inline prices.

**Per-PR reminders:** new mutations/broadcasts follow data-flow rules 1–2; UI work follows the
Four Laws (teal actions, blue data, no purple client-side); update `FEATURE_AUDIT.md` for
feature-visible items; run `npm run pr-check` before each PR.

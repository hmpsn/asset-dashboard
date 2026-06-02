# Review-Substance Audit — Unified Inbox vs the Old Per-Type Review Surfaces

**Date:** 2026-06-01
**Subject:** does the new unified inbox (PRs #1019–#1020, dark behind `unified-inbox`) actually surface WHAT is being sent for review, and what's needed to launch the review feature working "once and for all."
**Type:** read-only diagnosis. Method: a 5-agent comparison workflow (new-inbox anatomy + per-type old-vs-new) → synthesis, centered on review *substance* and *purpose*.
**Builds on:** [client-inbox pipeline audit](2026-06-01-client-inbox-pipeline-audit.md) · [design](../designs/2026-06-01-unified-send-to-client-design.md) · [cutover runbook](../runbooks/2026-06-01-unified-send-to-client-cutover.md).

## Verdict
Yes — the unified inbox lost the review substance. PRs #1019-1020 correctly unified the SHELL (one queue, one status spine, one staleness clock, one PriorityStrip) and the SEND/respond PLUMBING (PATCH /respond fires a real, status-machine-validated decision for physical types), but it regressed the per-type review SUBSTANCE to near zero. `DecisionCard` renders only badge + title + line-clamped summary + three verbs for EVERY card (DecisionCard.tsx:116-180); it imports no item/payload renderer and `normalizeDeliverable` carries only id/title/summary/itemCount/badge/sentAt onto the card — never `d.items` or `payload` (decision-adapters.ts:147-163). A second, independent drop compounds it: the client read path `listDeliverables` calls `rowToDeliverable(r)` with NO items argument (client-deliverables.ts:384), so `items` is `undefined` on every physical deliverable in the API response — the substance never even reaches the browser. The old per-type surfaces (DecisionDetailModal diff renderers, ApprovalsTab current↔proposed grids + inline edit, ClientCopyReview, PostReviewCard TipTap, SchemaReviewTab JSON-LD/pageRoles) rendered the substance richly and ARE the right review UX; their only sin was the now-fixed wiring. LAUNCH DIRECTION: keep the unified queue/shell + status spine, but route each queue item into its RICH per-type review surface (reuse the old modals/diff views) rather than a thin card — physical types open the unified detail modal fed by items[]/payload (with /respond wired at item or batch grain), projected types open their bespoke routes via a deep-link that actually lands (fix the InboxTab early-return), and notification/order types get read/track surfaces instead of nonsensical Approve/Decline. Do NOT ship the current card-only inbox; it asks clients to approve live-site changes blind.

---

## The PURPOSE of review — what decision is the client making, and what affordance it requires

A review item is not a notification; it is a **decision point** where the client authorizes (or edits, or rejects) something that will change their live site, their content, or their strategy. The unified card collapsed all of these into one verb-set, which only works if the decision is genuinely binary and context-free. Almost none of these are.

### Review-purpose taxonomy (the five distinct purposes)

| Purpose | What the client is deciding | Required affordance (minimum) | Types in this bucket |
|---|---|---|---|
| **Approve-a-specific-change** | "Is THIS exact value correct?" — a string/markup/mapping that will be written live | A current→proposed view of the exact change, per item; ideally per-item flag | seo_edit, schema_item, redirect, internal_link |
| **Edit-and-approve** | "Read this; tweak it; then approve" — the client may rewrite before blessing | A current→proposed view PLUS an inline editor (text input / TipTap) that persists the edited value | seo_edit (inline title/meta edit), aeo_change, copy_section (per-section suggest), post (inline TipTap) |
| **Pick-subset** | "Approve most, reject a few" — the decision is per-row, not all-or-nothing | Per-item selection / per-item approve+reject with a batch-level "approve all" | seo_edit, audit_issue, internal_link, content_plan_sample |
| **Give-feedback / approve-with-rationale** | "Do I agree with this recommendation and WHY it's proposed?" — judgement needs the reasoning | The recommendation prose + the rationale ("Why") + a free-text feedback box | audit_issue, aeo_change, schema_plan (strategy), brief, content_decay |
| **Acknowledge / read-only** | Nothing to approve — the client just reads or tracks progress | A read view (briefing hero+stories) or a progress tracker (order lifecycle) + dismiss; NO approve/decline verbs | briefing (read), work_order (track) |

### The core mismatch

The unified inbox offers exactly ONE affordance — `Approve / Request changes / Decline` (DecisionCard.tsx:67-114) — and applies it to all five purposes. That single affordance:
- **cannot express edit-and-approve** (no editor) — breaks seo_edit inline edit, copy, post;
- **cannot express pick-subset** (whole-deliverable verb, UnifiedInbox.tsx:170-184) — breaks every batch family, collapsing N per-item decisions into one;
- **shows no rationale**, so give-feedback decisions are made blind — breaks audit_issue, aeo_change, schema_plan;
- **is nonsensical for acknowledge/read-only** — briefing and work_order should never show "Decline", and in fact are filtered out of the list entirely (born in non-client-facing statuses, unified-inbox-read.ts:44-50).

The PURPOSE framing is the launch lens: the unified inbox must select the review SURFACE by the item's review-purpose, not render one verb-set for all. The old surfaces already encode these purposes correctly — they are the reuse target.

## Core finding (validated against the code)

**The unified inbox unified the SHELL and the SEND/respond PLUMBING, but regressed the per-type review SUBSTANCE to near zero. The old per-type surfaces rendered the substance well; their only problem was the now-fixed wiring. So the system inverted the problem: good wiring, thin review UX.**

### What the unification got RIGHT (keep this)
- **One queue, one status spine.** `listClientFacingDeliverables` (unified-inbox-read.ts:127-137) assembles physical + projected into ONE `ClientDeliverable[]`, filtered to client-facing statuses, newest-sent first. This is the correct model.
- **One staleness clock + PriorityStrip.** `sentAt` drives `ageLabel` (UnifiedInbox.tsx:43-52); the previously-orphaned PriorityStrip is finally mounted (UnifiedInbox.tsx:149).
- **Real respond plumbing for physical types.** `useRespondToDeliverable` → PATCH /respond → `respondToDeliverable` does a status-machine-validated decision (send-to-client.ts:150-161). For physical types (seo_edit, audit_issue, schema_item, schema_plan, redirect, internal_link, aeo_change, content_decay, content_plan_*) the verb FIRES a real, persisted decision. The plumbing genuinely works.
- **Correct identification of projected types.** `isProjectedDeliverable` (decision-adapters.ts:130-137) correctly knows copy_section/content_request have no physical row and would 404 on /respond (verified: respondToDeliverable does a getDeliverable PK lookup, send-to-client.ts:155, throwing 404 at :157).

### What it got WRONG (the substance regression — two compounding drops)
1. **The card never renders substance.** `DecisionCard` (DecisionCard.tsx:116-180) renders ONLY badge + title + line-clamped summary + verbs for every card. It imports no item/payload renderer. `normalizeDeliverable` (decision-adapters.ts:147-163) carries only id/title/summary/itemCount/badge/sentAt — never `d.items`, never `payload`. The 'View N →' button (DecisionCard.tsx:82-86) only scrollIntoView's the same card (UnifiedInbox.tsx:166-169); it does NOT open DecisionDetailModal (that modal is imported only by the legacy InboxTab path, line 24/993). **There is no path from the unified inbox to any detail/diff/JSON-LD/copy view.**
2. **The substance never reaches the browser.** Even if the card wanted items, the client read path can't supply them: `listDeliverables` calls `rowToDeliverable(r)` with NO items argument (client-deliverables.ts:384), and `rowToDeliverable` only attaches items when the arg is provided (client-deliverables.ts:131,161). So `items` is `undefined` on every physical deliverable in the client API response. (Contrast `getDeliverable` at :359-363, which DOES load items.)

### Why this is exactly the owner's complaint
"Sending SEO titles just sends the task, not the proposed title + current value" is literally drop #1 + drop #2 in series: the proposedValue/currentValue ARE built and persisted per item (seo-edit.ts:24-30; approval-batch-shared.ts:101-127), but the read path doesn't load them and the card couldn't render them anyway.

### The asymmetry that defines the launch direction
- **Physical types**: substance is dropped on the READ + RENDER side, but respond WORKS. Fix = load items + render a detail surface; respond is already wired.
- **Projected types (copy/brief/post)**: respond is correctly punted to a deep-link, but the deep-link is a **dead-end** — InboxTab.tsx:302 early-returns `<UnifiedInbox>` and never mounts the ?tab=reviews branch (ClientCopyReview at :527, ContentTab at :534), and UnifiedInbox doesn't read `?tab=` (violates the CLAUDE.md ?tab= two-halves contract). Fix = make the deep-link land OR render projected review in the unified shell.
- **Notification/order types (briefing/work_order)**: filtered out of the list entirely (born in non-client-facing statuses, unified-inbox-read.ts:44-50) AND DecisionCard has no read/track mode. Fix = a read/track surface + status inclusion, NOT approve/decline.

## Per-work-type gap table — what is sent / what the client must see / OLD vs NEW / gap / purpose / severity

All file:line references verified against the working tree.

| Work type | What is SENT (where substance lives) | What client must SEE to decide | OLD surface renders | NEW unified renders | Substance gap | Purpose | Severity |
|---|---|---|---|---|---|---|---|
| **seo_edit** (batch) | N items: field + currentValue + proposedValue + pageTitle/slug + reason (seo-edit.ts:24-30; approval-batch-shared.ts:101-127) | Per-page current→proposed title/meta grid + inline edit | ApprovalsTab.tsx:362-420 current↔proposed grid grouped by page + 'Why' box + inline Edit; DecisionDetailModal.tsx:33-50 grid + per-item Flag | badge+title+'N changes ready'+verbs; **items not loaded** (client-deliverables.ts:384) and normalizeDeliverable drops them (decision-adapters.ts:147-163); 'View N→' only scrollIntoView (UnifiedInbox.tsx:166-169) | **Total** — no title, no diff, no page, no edit | Edit-and-approve / pick-subset | **blocker** |
| **audit_issue** (batch) | N items: resolved field (null for non-meta), current/proposed + itemPayload{check, reason} (audit-issue.ts:63-72) | Per-finding: check identity + page + current + recommended + the 'Why' rationale | ApprovalsTab 'Why' reason box (343-347) + current↔proposed grid | badge 'Audit'+title+'N changes'+verbs; check/reason/diff all dropped | **Total** — cannot tell an H1 fix from a broken-link report; approves blind | Give-feedback / approve-with-rationale | **blocker** |
| **schema_item** (batch) | N items: field='schema', proposedValue=JSON-LD markup, applyable=false (schema-item.ts:25-30) | Per-page proposed JSON-LD + @type list + existing schema | ApprovalsTab.tsx:300-361 parsed @type badges + full JSON-LD in <pre> + 'Existing on page' | badge 'Schema'+title+'N changes'+verbs; markup never rendered | **Total** — approves structured data with no sight of the JSON-LD | Approve-the-markup | **blocker** |
| **schema_plan** (review, PHYSICAL) | payload.pageRoles[] + canonicalEntities[] verbatim (schema-plan.ts:88-134) | Page-role grid + canonical entities + education context | SchemaReviewTab.tsx:150-304 role-grouped badges, expandable page lists, entity chips, education blurb, feedback box | uniform verbs (not projected → /respond resolves); 'N pages, M entities' count only; pageRoles/entities never rendered | **Total** — approves a site-wide strategy from a count | Give-feedback on a strategy artifact | **blocker** |
| **redirect** (batch) | source→target+type+rationale in **payload.items[]** (client-action-shared.ts:136-164); NO typed child rows → itemCount=1 (decision-adapters.ts:148) | Each source→target mapping + 301/302 type + rationale | DecisionDetailModal.tsx:218-239 source→target rows; ClientActionDetailModal type pill + rationale | badge 'Redirects'+title+'N redirects'+verbs; itemCount=1 so even 'View N→' is hidden; pairs never rendered | **Total + wrong count** | Approve-a-specific-change | **blocker** |
| **internal_link** (batch) | 6-field suggestions in payload.items[] (internal-link.ts:30-31) | Anchor + source page + target + context snippet, as a table | DecisionDetailModal.tsx:160-216 5-col table; ClientActionDetailModal 6th 'Context' col + links | verbs only; itemCount=1; table never rendered | **Total** — cannot evaluate a single link | Edit-and-approve / pick-subset | **blocker** |
| **aeo_change** (batch) | page/section/current/proposed/rationale/effort in payload.items[] (aeo-change.ts:32-33) | Per-diff current↔proposed text + the 'Why' rationale | DecisionDetailModal.tsx:120-158 page/section header + 2-col grid + 'Why:' line | verbs only; itemCount=1; diffs/rationale never rendered | **Total** — highest-stakes (rewrites live copy) yet approved sight-unseen | Edit-and-approve of live content | **blocker** |
| **content_decay** (decision, single) | single page metrics in payload.items[]; targetKeyword in origin; summary carries recommendation prose (content-decay.ts:40-69) | Decaying page + decline metrics + target keyword + recommendation | InboxTab single-action inline approve/flag; recommendation in summary | uniform verbs; summary (line-clamp-2) DOES carry recommendation; metrics/keyword not surfaced; uniformVerbs ignores isSingleAction | **Smallest** — prose survives via summary; metrics/keyword lost; itemCount=1 happens to be correct | Approve-a-recommendation | **minor** |
| **content_plan_sample** (batch) | per-page proposedValue = 'Keyword/URL/Variables/Volume' blocks (content-plan-review.ts:261-280) | Planned keyword + URL + volume per sample | ApprovalsTab generic item with full proposed summary visible | verbs only; per-sample detail dropped | **Total** — approves a plan blind to its pages | Approve-the-plan / pick-subset | **major** |
| **content_plan_template** (batch) | ONE item: templateDescription blob (page type/URL pattern/section outline/tone) (content-plan-review.ts:200-212) | The full template blueprint text | ApprovalsTab proposed cell shows full templateDescription | 'title + a button + literally nothing to read' (single proposedValue blob dropped) | **Total** — pure read-then-approve, body invisible | Approve-and-acknowledge | **blocker** |
| **copy_section** (review, PROJECTED) | payload.sections[] verbatim: generatedCopy + aiAnnotation + clientSuggestions[] (copy-section.ts:144-207) | Per-section prose + AI annotation + prior suggestions + per-section approve/suggest editor | ClientCopyReview.tsx:449-588 full copy block + annotation + suggestions thread + inline suggest textarea | read-only 'Review →' deep-link only (DecisionCard.tsx:138-143); sections never rendered AND deep-link dead-ends (InboxTab.tsx:302 early-return prevents ?tab=reviews mounting) | **Total + dead-end** — substance unreachable | Edit-and-approve per section | **blocker** |
| **brief** (content_request, PROJECTED) | briefId FK + comments[] (content-request.ts:144-200); **brief BODY not in payload** | Full brief: outline, keywords, PAA, SERP gaps, E-E-A-T, schema recs + feedback | ContentTab.tsx:361-605 full brief render + approve/request-changes/decline + comments thread | 'Review →' deep-link only; topic+keyword summary; body never in payload; deep-link dead-ends | **Total + dead-end + body not even sent** | Read-and-decide on a document | **blocker** |
| **post** (content_request, PROJECTED) | postId FK + comments[] (content-request.ts:91); **post BODY not in payload** | Title/meta/intro/sections/conclusion as editable rich text + steering note | PostReviewCard.tsx:196-471 inline TipTap editors with auto-save + steering box + approve | 'Review →' deep-link only; no editor; body not in payload; deep-link dead-ends | **Total** — most edit-heavy type, zero editing | Edit-and-approve a long document | **blocker** |
| **briefing** (notification, ONE-WAY) | weekOf/headline/storyCount metadata; story bodies NOT in payload (briefing.ts:54) | Just READ the briefing (hero + stories) | dedicated briefing read surface | **Filtered OUT** — born 'completed', not in CLIENT_FACING_STATUSES (unified-inbox-read.ts:44-50); no notification mode in DecisionCard | **Invisible** + no read affordance + wrong verbs if shown | Acknowledge / read-only | **blocker** |
| **work_order** (order) | productType/pageIds/progress (work-order.ts:91-127) | Order status + what it covers (track, don't approve) | dedicated order status surface | **Filtered OUT** — ordered/in_progress/completed/cancelled not client-facing (unified-inbox-read.ts:44-50); no order/progress mode | **Invisible** + no tracking UX + nonsensical approve/decline if shown | Acknowledge / track progress | **major** |
| **CROSS-CUTTING** | All substance lives in items[] or payload.* | The diffs/lists/tables/JSON-LD/bodies | DecisionDetailModal.tsx:12-239: 3 renderers + current/proposed grids, opened from 'Review N →' | DecisionCard renders only badge+title+summary+verbs (DecisionCard.tsx:116-180); no renderer imported; onOpen=scrollIntoView; modal unreachable from UnifiedInbox | **The entire detail tier is unreachable** | Every physical type needs a detail view | **blocker** |

## Launch direction — keep the unified shell, route each item to its RICH per-type review

Do not rebuild the old fragmented inbox, and do not ship the current card-only inbox. The decision is: **the unified queue/shell + status spine + respond plumbing stay; the review SURFACE per item becomes rich again by reusing the old per-type renderers.** Concretely:

### 1. Restore the substance to the read path (one-line-class fix, unblocks everything physical)
The client read must load child items. Change `listDeliverables` (client-deliverables.ts:382-385) to fetch and pass items per row (the machinery exists — `getDeliverable` at :359-363 already does `getItems.all(id)` + `rowToDeliverable(row, items)`). Without this, no amount of UI work can render the diff because the data isn't in the response. This is the single highest-leverage fix.

### 2. Give DecisionCard a per-type DETAIL surface, selected by review-purpose — reuse the old renderers
Keep the card as the queue entry-point, but wire its detail tier to the RICH old surfaces rather than scrollIntoView:
- **Approve-a-specific-change / pick-subset (seo_edit, audit_issue, schema_item, redirect, internal_link, content_plan_*)** → open the unified detail modal (reuse `DecisionDetailModal`'s ApprovalItemRow current→proposed grid, AeoRenderer, InternalLinkRenderer, RedirectRenderer — DecisionDetailModal.tsx:12-239) fed by the now-loaded `items[]` / `payload.items[]`. Carry per-item flag + batch approve. For redirect/internal_link/aeo_change, fix `itemCount` to read `payload.items.length` (today it falls back to 1, decision-adapters.ts:40-46/148) so the count and 'View N →' work.
- **Edit-and-approve (seo_edit inline, aeo_change)** → reuse the ApprovalsTab inline Edit (FormInput for title / FormTextarea for meta, ApprovalsTab.tsx:362-420) that persists clientValue.
- **Approve-the-markup (schema_item, schema_plan)** → reuse the SchemaReviewTab JSON-LD/@type/pageRoles renderers (SchemaReviewTab.tsx:150-304) — for schema_plan this means rendering payload.pageRoles[]/canonicalEntities[] in-card or in a modal.
- **Give-feedback (audit_issue, aeo_change, schema_plan, brief)** → always surface the rationale/reason prose + a free-text feedback box, never bare verbs.

### 3. Make projected types' review actually reachable
copy_section / content_request correctly punt to a deep-link, but it dead-ends. Two acceptable launch options — pick ONE:
- **(Preferred for "once and for all") Render projected review IN the unified shell**: have UnifiedInbox mount the existing `ClientCopyReview` / `ContentTab` / `PostReviewCard` for the selected projected item (they already self-fetch the brief/post body, which is NOT in payload). Respond stays on their bespoke routes (copy-pipeline /approve & /suggest; content-requests approve/requestChanges/decline). This keeps the unified inbox the single surface.
- **(Minimum viable) Fix the dead-end deep-link**: remove/adjust the InboxTab.tsx:302 early-return so ?tab=reviews still mounts the Reviews section, and make UnifiedInbox honor `?tab=` per the CLAUDE.md two-halves contract. Then 'Review →' lands on the real surface.

### 4. Give notification + order types a non-decision surface and stop filtering them out
- **briefing** → add a `notification` read mode to DecisionCard (hero headline + stories + dismiss; NO approve/decline) and include the `completed` notification status in the client-facing set for briefings (or a dedicated read lane). Note story bodies aren't in payload (briefing.ts:54) — the read view must fetch from briefing_drafts.
- **work_order** → add an `order` progress/track mode (ordered → in_progress → completed) and include order lifecycle statuses for display-only; never render approve/decline.

### 5. Confirm respond propagation before flipping the flag
The unified /respond writes `client_deliverable` status. Verify it propagates back to the source tables the old admin/source surfaces read (e.g. schema_site_plans.status, approval item status) — flagged as a cutover concern in the projected/schema_plan analysis. A green verb that doesn't update the source is a silent regression.

### The shape of the launch
Unified queue + status spine + PriorityStrip + respond plumbing = KEEP. Thin card = REPLACE with a purpose-routed detail surface that reuses the proven old renderers. This is a re-wiring + read-path fix, not a redesign — the substance components already exist and rendered well.

## Launch-readiness checklist — to ship review working "once and for all"

### A. Read path (data must reach the browser) — DO FIRST
- [ ] `listDeliverables` (client-deliverables.ts:382-385) loads + passes child items per row (mirror `getDeliverable` at :359-363). Without this every physical diff is empty regardless of UI.
- [ ] `normalizeDeliverable` (decision-adapters.ts:147-163) carries `items` and the relevant `payload` fields onto `NormalizedDecision` (or the card reads the raw `ClientDeliverable`). Today it carries neither.
- [ ] `itemCount` for redirect/internal_link/aeo_change reads `payload.items.length` not the fallback `1` (decision-adapters.ts:40-46/148) — fixes wrong counts + hidden 'View N →'.

### B. Per-type review substance (each type renders what the decision needs)
- [ ] seo_edit / content_plan_*: current→proposed grid per item + inline edit (reuse ApprovalsTab.tsx:362-420 / DecisionDetailModal.tsx:33-50).
- [ ] audit_issue: check identity + current/recommended + the 'Why' reason (itemPayload.reason) surfaced.
- [ ] schema_item / schema_plan: JSON-LD + @type badges (SchemaReviewTab.tsx:150-304) / pageRoles[] + canonicalEntities[] rendered.
- [ ] redirect: source→target rows + 301/302 type + rationale (DecisionDetailModal.tsx:218-239).
- [ ] internal_link: anchor/source/target/context table (DecisionDetailModal.tsx:160-216).
- [ ] aeo_change: per-diff current↔proposed + rationale (DecisionDetailModal.tsx:120-158).
- [ ] content_decay: surface page metrics + target keyword (today only summary survives — acceptable for launch but strengthen).
- [ ] content_plan_template: render the templateDescription blob (today: a title + a button + nothing to read).

### C. Respond wiring (decisions land, at the right grain)
- [ ] Physical types: /respond already works — add per-item flag/subset for the pick-subset purposes (seo_edit, audit_issue, internal_link, content_plan_sample) so N decisions aren't collapsed to one.
- [ ] Projected types (copy_section, content_request): the bespoke respond routes must be reachable from the unified inbox — either render the review in-shell (ClientCopyReview / ContentTab / PostReviewCard, which self-fetch the body) or fix the dead-end deep-link (see D). /respond must NOT be wired to projected ids (it 404s — send-to-client.ts:155-157).
- [ ] Verify unified /respond status writes PROPAGATE to the source tables the admin/source surfaces read (schema_site_plans.status, approval item status, content_request status). A deliverable-only write that doesn't reach the source is a silent regression.

### D. Deferred-from-runbook items that matter for review
- [ ] **Fix the projected deep-link dead-end**: InboxTab.tsx:302 early-returns `<UnifiedInbox>` so ?tab=reviews never mounts ClientCopyReview (:527) / ContentTab (:534); UnifiedInbox ignores `?tab=`. This violates the CLAUDE.md `?tab=` two-halves contract and makes copy/brief/post review unreachable. Resolve before flipping the flag.
- [ ] **Notification/order inclusion**: briefing (born 'completed', briefing.ts:15) and work_order (ordered/in_progress/completed/cancelled) are filtered out by CLIENT_FACING_STATUSES (unified-inbox-read.ts:44-50). Add a read lane (briefing) and a track lane (work_order) with appropriate verbs.

### E. Edge / empty / error / mobile
- [ ] Empty state already present (UnifiedInbox.tsx:192-197) — keep; verify per-section empties.
- [ ] Error: /respond failure shows a toast (UnifiedInbox.tsx:120-121) — keep; add error states to the detail surfaces.
- [ ] Optimistic/disabled state during submit exists (submittingId, UnifiedInbox.tsx:171) — extend to per-item respond.
- [ ] Mobile: the old DecisionDetailModal grids/tables must stay mobile-sane (the unified shell was explicitly mobile-first; reused tables must not regress that).
- [ ] briefing story bodies + brief/post bodies are NOT in payload (briefing.ts:54; content-request.ts FK-only) — the review surface must fetch them; confirm the fetch exists on the in-shell path.

### F. Before flipping `unified-inbox` ON in production
- [ ] All blocker-severity types (every physical batch type + schema_plan + content_plan_template + copy/brief/post + briefing) render their substance and respond correctly.
- [ ] Contract test: ?tab= deep-link wiring (tests/contract/tab-deep-link-wiring.test.ts) passes for the unified inbox.
- [ ] Integration test exercises the PUBLIC read endpoint (GET /api/public/deliverables/:workspaceId) and asserts items[]/payload are present in the response — not just the admin read (per CLAUDE.md read-path testing rule).
- [ ] `npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts` green.
- [ ] Respond-propagation verified end-to-end on staging for at least one physical and one projected type before staging→main.

## Open questions — product decisions that shape the build

1. Respond propagation: does the unified PATCH /respond status write back to the SOURCE tables the legacy admin/source surfaces read (schema_site_plans.status, approval item status, content_request status), or only to client_deliverable? If only the latter, the old admin views and any apply step go stale on approve — this is the riskiest unknown for a clean cutover.
2. In-shell vs deep-link for projected types: should copy/brief/post review be rendered INSIDE the unified inbox (mounting ClientCopyReview/ContentTab/PostReviewCard) to truly unify the surface, or is fixing the ?tab=reviews dead-end (so 'Review →' lands on the existing Reviews section) acceptable for launch? The former is 'once and for all'; the latter is faster but keeps two surfaces.
3. Per-item respond grain: the old system supported per-item flag + subset approve; the unified /respond is whole-deliverable. Is per-item granularity in scope for launch, or is whole-batch approve + a note acceptable for v1 (with per-item as a fast-follow)? This changes the size of the respond rewrite materially.
4. Brief/post bodies are not in payload (only FKs) — should the unified read project the body in (extra fetch in unified-inbox-read), or should the in-shell review surface keep self-fetching via useClientPostPreview/brief preview? Affects whether the unified read stays a cheap projection.
5. briefing/work_order status inclusion: should these appear in the unified list at all (requiring a read/track mode + status-set change in unified-inbox-read.ts:44-50), or stay out of the inbox and live in a separate 'Updates'/'Orders' surface? Determines whether DecisionCard needs notification + order modes.

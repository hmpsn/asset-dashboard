# Platform UX Audit P2 Closeout — Implementation Plan

## Overview
Close the remaining P2 findings from `docs/audits/2026-05-19-platform-ux-audit.md`: verify the admin-to-client terminology fixes, make Inbox badge counts consistent between legacy and `new-inbox-ia` layouts, and add a client-visible highlight when a post is sent back to review.

## Scope
- `P2-5` — Admin to client terminology mismatches
- `P2-6` — New Inbox Decisions badge count parity
- `P2-16` — Post back-in-review highlight for clients

## Pre-Plan Audit
- Source audit reviewed: `docs/audits/2026-05-19-platform-ux-audit.md`
- Current code scan reviewed: `InboxTab`, `ClientDashboard`, approval cards, `SearchTab`, and `ContentBriefs`
- Existing `P2-5` implementation appears partially or fully present:
  - Client inbox now uses "Content Briefs & Posts"
  - `applied` statuses have explanatory title text
  - Search annotations are now labeled "Timeline Notes" with Inbox guidance
- Remaining implementation risk is concentrated in `P2-16`, because the correct highlight depends on the post review data shape and how updated post state reaches the client.

## Bounded Context Ownership
- Primary owner: Inbox
- Secondary owner: Content Pipeline
- Coordination owner: Client Portal
- Route/API surface: existing public/client content review and post review read paths only; no new endpoints expected.
- Shared contracts: existing content/post review types only; avoid new shared types unless the current payload cannot identify the highlighted post.
- React Query/cache keys: existing client inbox/content review keys; preserve current invalidation behavior.
- WebSocket events: existing `post:updated`/content review broadcasts; only add events if the current update path cannot notify clients.
- Test ownership: component tests for `InboxTab`/client content review surfaces, plus targeted regression tests for count parity and highlight rendering.
- Behavior type: user-facing UI behavior cleanup; no data model migration expected.

## Task Dependencies
Sequential:
Task 1 (`P2-5` verification) -> Task 2 (`P2-6` count parity) -> Task 3 (`P2-16` data trace) -> Task 4 (`P2-16` UI highlight) -> Task 5 (audit/docs update)

Parallelization:
No parallel agents needed. The write set is small and centered on `InboxTab`/client content review behavior, so a single pass is lower coordination risk.

## Task 1 — Verify and Close P2-5
Platform: Codex/OpenAI
Model: `GPT-5.4-Mini`

Owns:
- `docs/audits/2026-05-19-platform-ux-audit.md`

May read:
- `src/components/client/InboxTab.tsx`
- `src/components/client/ApprovalsTab.tsx`
- `src/components/client/ApprovalBatchCard.tsx`
- `src/components/client/SearchTab.tsx`
- `src/components/ContentBriefs.tsx`

Steps:
- Confirm the three `P2-5` bullets are represented in the current UI copy.
- If complete, mark `P2-5` fixed in the audit.
- If any copy is still missing, patch the smallest owning component and add or update the closest component test.

## Task 2 — Fix P2-6 Inbox Badge Count Parity
Platform: Codex/OpenAI
Model: `GPT-5.4`

Owns:
- `src/components/client/InboxTab.tsx`
- relevant `InboxTab` component tests

May read:
- `shared/types/approvals.ts`
- `shared/types/client-actions.ts`
- `shared/types/decision.ts`
- `src/components/client/SchemaReviewModal.tsx`

Steps:
- Compare the legacy and `new-inbox-ia` badge count formulas for Decisions and Reviews.
- Decide whether schema plan review belongs in Decisions or Reviews for both layouts based on current inbox routing rules.
- Extract local count constants if needed so both layouts consume the same source of truth.
- Add a regression test where `schemaPlanPending` is true and `new-inbox-ia` is toggled, asserting counts match the intended section.
- Preserve beta-mode behavior if schema review is intentionally hidden there.

## Task 3 — Trace P2-16 Post Review Data Flow
Platform: Codex/OpenAI
Model: `GPT-5.4`

Owns:
- no writes unless the trace reveals a missing test fixture

May read:
- `src/components/ClientDashboard.tsx`
- `src/components/client/InboxTab.tsx`
- client content/post review components
- `src/hooks/client/*`
- `src/api/content.ts`
- server post review/public content routes
- shared content types

Steps:
- Identify the payload field that distinguishes a post newly returned to `client_review` from an older item already awaiting review.
- Verify whether the client receives `updatedAt`, `sentAt`, `reviewRequestedAt`, status transition time, or activity data sufficient for a highlight.
- Verify the existing `post:updated` client invalidation path refreshes the rendered list.
- If the current client payload cannot support a reliable highlight, add the minimum server serialization field and matching shared type/test.

## Task 4 — Implement P2-16 Highlight
Platform: Codex/OpenAI
Model: `GPT-5.4`

Owns:
- client component that renders post review/content review rows
- targeted component test for the highlighted state

May read:
- `src/components/client/InboxTab.tsx`
- `src/components/ClientDashboard.tsx`
- `src/components/ui/Badge.tsx`
- `src/components/ui/SectionCard.tsx`

Steps:
- Add a restrained "New review" or "Needs your review" indicator on the specific post item, not just the global badge.
- Use existing UI primitives and design tokens; no new color semantics.
- Keep the highlight time/state rule deterministic and documented in code only if it is not self-explanatory.
- Ensure screen-reader text or visible copy makes the state understandable without relying only on color.

## Task 5 — Audit and Roadmap Closeout
Platform: Codex/OpenAI
Model: `GPT-5.4-Mini`

Owns:
- `docs/audits/2026-05-19-platform-ux-audit.md`
- `data/roadmap.json` only if the existing roadmap item needs notes updated

Steps:
- Mark `P2-5`, `P2-6`, and `P2-16` fixed after verification passes.
- Recompute remaining audit counts in the audit summary if present.
- Run `npx tsx scripts/sort-roadmap.ts` only if `data/roadmap.json` changes.

## Systemic Improvements
- Shared utilities: only extract a helper if both legacy and new inbox layouts duplicate the same count formula after the fix.
- pr-check rules: none recommended for this batch; these are product-specific wiring/copy issues rather than broad recurring syntax patterns.
- New tests required:
  - Inbox count parity with schema review pending and `new-inbox-ia` on/off.
  - Highlight rendering for a post returned to client review.
  - Existing `P2-5` test coverage is enough if current copy is already covered; otherwise add focused assertions.
- Feature-class gates:
  - Client-visible workflow gate
  - Admin-to-client handoff gate
  - UI/UX consistency gate

## Verification Strategy
- `npx vitest run tests/component/client/InboxTab.test.tsx`
- Run the closest post/content review component test after identifying the owner.
- `npm run typecheck`
- `npx vite build`
- `npx tsx scripts/pr-check.ts`
- Full suite if server serialization changes: `npx vitest run`

## Stop Conditions
- Stop and reassess if `P2-16` requires a new durable unread/read state or migration. A visual highlight based only on timestamps is acceptable for this audit batch; a persistent per-user read model is a larger feature.
- Stop and reassess if `P2-6` reveals that legacy and new layouts intentionally route schema review to different sections. That would require updating the audit expectation rather than forcing parity.

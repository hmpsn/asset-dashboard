---
description: Canonical UI vocabulary for action labels, badges, and status text. Reference this before writing any user-facing strings.
---

# UI Vocabulary Guide

Use these exact labels when creating buttons, badges, tooltips, status text, and toast messages. Do NOT invent synonyms.

> **Color assignments below must match `BRAND_DESIGN_LANGUAGE.md` § 2 (Four Laws of Color).** When in doubt, check the Per-Component Color Map.

## Action Verbs

| Action | Label | Icon | Color | Context |
|--------|-------|------|-------|---------|
| Send item(s) to client | **"Send to client"** | `Send` | teal | Audit issues, schemas, briefs, SEO/CMS editor batches — see §Admin Send Convention (the single canonical send button; purple was retired, send buttons are teal per the Four Laws) |
| Create internal team work item | **"Add to Tasks"** | `ClipboardList` | zinc | Audit → request manager |
| Batch create internal tasks | **"Add [X] to Tasks"** | `ClipboardList` | varies | e.g. "Add Errors to Tasks (5)" |
| Push fix directly to Webflow | **"Accept & Push"** | `CheckCircle` | emerald | AI suggestion → Webflow API |
| Navigate to fix tool | **"Fix"** | `Wrench` | teal | Audit → SEO Editor / Schema / etc. |
| Run/re-run an analysis | **"Re-scan"** / **"Run Audit"** | `RefreshCw` | zinc | Audit, Performance |
| Save + generate share link | **"Save & Share"** | `Share2` | teal | Audit report |
| Export data | **"Export"** | `FileText` | zinc | Audit, Analytics |

## Status Badges (past-tense of action)

| State | Badge Label | Icon | Color |
|-------|-------------|------|-------|
| Sent to client | **"Sent"** | `Send` | teal |
| Task created | **"Added"** | `CheckCircle` | green |
| Fix pushed to Webflow | **"Applied"** | `CheckCircle` | green |
| Approval sent | **"Sent!"** | `CheckCircle` | teal |
| Currently processing | **"Pushing..."** / **"Sending..."** / **"Adding..."** | `Loader2` | inherit |

## Nouns

| Concept | Canonical Term | DO NOT use |
|---------|---------------|------------|
| Client-submitted item | **"request"** | ticket, issue (in client context) |
| Internal team work item | **"task"** | ticket, to-do |
| Audit finding | **"issue"** | error (unless severity=error), problem, bug |
| AI-generated recommendation | **"AI suggestion"** | AI fix, AI recommendation, auto-fix |
| The place tasks live | **"Tasks"** (nav label) | Request Manager (internal name only) |
| Client-facing dashboard | **"Client Dashboard"** | portal, client view |
| Admin-facing dashboard | **"Command Center"** | admin panel, control panel |
| Client inbox section — approvals/actions without note | **"Decisions"** | Approvals, Needs Action, SEO Changes |
| Client inbox section — briefs/posts/copy | **"Reviews"** | Content, Briefs, Posts |
| Client inbox section — approvals/actions with note + requests | **"Conversations"** | Requests, Messages |
| Win quality indicator | **"Win"** / **"Strong win"** | "success", "confirmed win" |

### Client-facing outcome/action labels (C2 / R12a)

Every client surface that renders an outcome `ActionType` (win rows, scorecards, monthly
digest highlights) MUST read its label from `shared/types/client-vocabulary.ts`
(`CLIENT_ACTION_LABELS` / `clientActionLabel()`) — never hand-roll a parallel
`Record<ActionType, string>`. This module folds what were four independently-drifting
maps (`OutcomeSummary.tsx`, `WinsSurface.tsx`, `server/routes/outcomes.ts`, and the
monthly-digest ROI highlights in `server/outcome-tracking.ts`) into one canonical source,
modeled on the locked-copy pattern in `src/components/client/the-issue/evergreenCopy.ts`.
Pinned by `tests/contract/client-vocabulary-map.test.ts`.

**Wording rule:** client copy prefers the fuller narrative sentence over admin nouns —
e.g. "Published new post", not "Content published"; "Replied to a Google Business
Profile review", not "GBP reply". `clientActionLabel()` degrades any unrecognized value
to a humanized fallback (never a raw `snake_case` enum, never a throw).

This is intentionally **separate** from the ADMIN action label source
(`shared/types/action-catalog.ts` `OUTCOME_CATALOG` labels, consumed by
`src/components/admin/outcomes/outcomeConstants.ts`) — admin surfaces keep short,
operator-legible nouns ("Insight Acted On"). Admin and client are allowed to disagree on
tone; only the four *client* surfaces must agree with each other. The same admin/client
split applies to archetype labels: `shared/types/strategy-archetype.ts` `ARCHETYPE_LABELS`
(admin) vs. `IssueAlsoOnPlanSection.tsx` `CLIENT_GROUP_META` (client, paired with a
one-line description per archetype — richer than a single label, so not folded into the
same `Record`).

### ActionQueueStrip Chip Labels (Phase 2B — PR #665)

The briefing page action strip chips emit final `InboxFilter` values as `?tab=` deep-link params. These are the canonical chip labels and their target inbox sections:

| Chip label | `InboxFilter` value emitted | Target section in InboxTab |
|------------|----------------------------|---------------------------|
| Decisions | `decisions` | Decisions section (schema + action cards without note) |
| Reviews | `reviews` | Reviews section (briefs + posts needing editorial review) |

**DO NOT** use the retired intermediate values (`seo-changes`, `content`, `needs-action`) — these were trimmed from `LEGACY_FILTER_MAP` in PR #665. Canonical first-party links use `decisions`, `reviews`, or `conversations`; any remaining `LEGACY_FILTER_MAP` entries are external URL filter compatibility only, not top-level client route aliases.

## Overflow Menu Labels

When actions are behind a `⋮` (MoreVertical) overflow menu:

- **"Send to client"** — always first, teal text (the canonical send action — see §Admin Send Convention)
- **"Add to Tasks"** — always second, zinc text

## Admin Send Convention (PR 1.4)

All admin surfaces that send items to the client use a single button + optional inline note field:

| Retired pattern | Current pattern |
|-----------------|-----------------|
| "Send for Review" + "Flag for Client" (two buttons) | "Send to client" (one button) |
| Dual state variables `sendingReview` + `flagging` | Single `sending` state |

**Button label:** `"Send to client"` (lowercase "to")  
**Loading state:** `"Sending..."`  
**Past-tense badge:** `"Sent"`  
**Note routing:** note present → item lands in Conversations; no note → Decisions.

Enforced by pr-check rule `send-for-review-anti-pattern`.

## Toast / Confirmation Messages

| Event | Message |
|-------|---------|
| Sent to client | `"Sent to client"` |
| Task created | `"Added to tasks"` |
| Batch tasks created | `"{N} added to tasks"` |
| Fix applied | `"Applied to Webflow"` |
| Report saved | `"Report saved! Share this link with clients:"` |

## Studio / Agency Name

All user-facing copy that references the studio or agency MUST use the `STUDIO_NAME` constant:

| Context | Import from | Usage |
|---------|-------------|-------|
| Client components (JSX text) | `src/constants.ts` | `{STUDIO_NAME}` |
| Client components (template literal) | `src/constants.ts` | `` `text ${STUDIO_NAME} text` `` |
| Server emails / logic | `server/constants.ts` | `` `text ${STUDIO_NAME} text` `` |

**DO NOT** hardcode: "your team", "Web Team", "SEO team", "our team", "your web team", or "hmpsn studio".

**Common interpolation bugs:**
- `'text ${STUDIO_NAME} text'` (single quotes) — **won't interpolate**, renders literal `${STUDIO_NAME}`
- `<p>text ${STUDIO_NAME} text</p>` (JSX text) — **won't interpolate**, use `<p>text {STUDIO_NAME} text</p>`

## Rules

1. **Never mix "flag" and "send"** — always use "send" for client-facing actions.
2. **Never use "create" for tasks** — use "add" (tasks already exist as a concept; you're adding to the list).
3. **Past-tense badges match the verb** — Send → Sent, Add → Added, Apply → Applied.
4. **Tooltips expand the label** — e.g. button says "Fix", tooltip says "Open SEO Editor".
5. **Batch labels include the destination** — "Add Errors to Tasks", not just "Add Errors".
6. **Loading states use "...ing"** — "Pushing...", "Sending...", "Adding...".
7. **Color rules** — All action colors must follow the Four Laws in `BRAND_DESIGN_LANGUAGE.md`: teal for CTAs, blue for data, emerald for success, purple for admin AI only. Never use violet or indigo.

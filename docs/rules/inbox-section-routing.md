# Inbox Section Routing

**Introduced:** PR 1.2 (2026-05-10) — Client IA Restructure  
**Feature flag:** `new-inbox-ia` (default `false`; flip manually after staging verification)

---

## Three sections

| Section | Contains | Routing rule |
|---------|----------|-------------|
| **Decisions** | `approval_batches` + `client_actions` without a note | `batch.note == null` / `action.clientNote == null` |
| **Reviews** | content briefs, posts, copy pipeline items | Static — no note-based routing |
| **Conversations** | `approval_batches` + `client_actions` with a note | `batch.note != null` / `action.clientNote != null` |

---

## Note-based routing invariant

When an admin sends an item to the client:

- **No note attached** → lands in **Decisions** (trust-first, one-click approve UX)
- **Note attached** → lands in **Conversations** (opens a discussion thread)

This split is computed at send-time in the server and reflected in the data the client reads.
`InboxTab.tsx` sorts items into sections by reading `note`/`clientNote` presence — it does not
re-apply routing logic.

---

## Where routing is enforced

| Layer | File | What it does |
|-------|------|-------------|
| Send API (batches) | `server/routes/approvals.ts` | Accepts `note?: string` in Zod schema; stores in `approval_batches.note` (migration 093) |
| Send API (actions) | `server/routes/client-actions.ts` | Accepts `clientNote?: string`; stored in `client_actions.client_note` (migration 083) |
| Client read | `GET /api/public/client-actions/:wsId` | Returns `clientNote` field |
| Client read | `GET /api/public/approvals/:wsId/batches` | Returns `note` field |
| UI routing | `src/components/client/InboxTab.tsx` | Splits items by note presence into Decisions vs Conversations |

---

## Adding a new `client_action` source type

1. Add the value to `ClientActionSourceType` in `shared/types/client-actions.ts`
2. Decide: can this action type carry a note? If not → always routes to Decisions. If yes → follows the note-based rule.
3. Add a renderer case to `src/components/client/ClientActionDetailModal.tsx`
4. Update this doc's "Three sections" table if the new type has special routing.
5. Check that the `keyword-strategy-action-type` pr-check rule does not affect the new type (it only blocks `'keyword_strategy'` specifically).

## Adding a new batch source

Same as above. Verify the `approval_batches.note` column is read by the public endpoint serializer in `server/public-portal.ts`.

---

## What is NOT routed by note

- **Requests** (`RequestsTab`) — always in Conversations. These are client-initiated; note routing doesn't apply.
- **Content briefs, posts, copy** — always in Reviews. These have their own review flow and don't use the note field.

---

## pr-check enforcement

- `inbox-legacy-filter-literal` — blocks retired filter literals (`approvals`, `seo-changes`, `needs-action`, `content-plan`, `copy`, `content`) from re-appearing in URLs.
- `inbox-action-queue-strip` — blocks `ActionQueueStrip` from being re-added to `InboxTab.tsx` (§5.6 of IA spec: urgency is now carried through chip counts, not a strip).

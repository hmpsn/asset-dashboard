# Brand Intelligence Slice — P5: `update_brand_deliverable` MCP write tool

**Status:** in progress · **Branch:** `brand-slice-p4` (P5 ships first, then P4) · **Origin:** [brand-intelligence-slice design](../../designs/2026-06-26-brand-intelligence-slice.md)

## Goal

Close the read **+ write** loop of the original ask ("could we read and/or write the
client's mission statement, values, etc. via the MCP"). P3 gave agents the read
(`get_brand_identity`); P5 gives them the write: `update_brand_deliverable`, which
edits the content of an existing brand deliverable.

## Grounded scope (read before writing — verified on `origin/staging` d7a927982)

- **Write fn (wrapped):** `updateDeliverableContent(workspaceId, id, content)` in
  `server/brand-identity.ts:240` — transactional, snapshots prior version, bumps
  `version`, forces `status → 'draft'`, **no-ops** (returns existing, no version bump)
  when content is byte-identical, returns `null` when not found. Does **not**
  broadcast/log on its own.
- **Canonical write side-effects (from the admin route `server/routes/brand-identity.ts:137-165`):**
  `addActivity(ws, 'brand_deliverable_refined', …)` + `broadcastToWorkspace(ws, WS_EVENTS.BRAND_IDENTITY_UPDATED, …)` + `invalidateIntelligenceCache(ws)`.
- **Template (1:1):** `update_brief` (`server/mcp/tools/content-actions.ts:387`) — the
  established MCP-write pattern uses an optimistic-concurrency conflict check
  (`expected_revision`) because agents write **blind**. We mirror that with the
  deliverable's native `version` int (already surfaced by
  `get_brand_identity(includeDeliverables:true)`).
- **Dispatch:** `server/mcp/server.ts:65` routes by `brandTools.some(t => t.name === name)
  → handleBrandTool`. **Adding the tool to `brandTools[]` auto-routes it — no server.ts edit.**
- **Read for conflict check:** `getDeliverable(workspaceId, id)` (`server/brand-deliverable-read-model.ts:55`).
- **Identity:** by `deliverableId` (mirrors `update_brief`'s `brief_id`; agent gets the id
  from `get_brand_identity(includeDeliverables:true)`). **Update-only** — wrapping
  `updateDeliverableContent` means a missing deliverable returns a clear "not found";
  creation stays out of scope (deliverables are AI-generated, not MCP-authored).

## Design decisions

1. **Optimistic concurrency (`expectedVersion`, optional).** Provided → must equal the
   current `version` or return a conflict error telling the agent to re-fetch via
   `get_brand_identity`. Omitted → last-write-wins (matches the admin route, which never
   enforced it). Protects precious, low-churn brand copy from a blind agent clobbering a
   human edit, without making the tool unusable for simple sets.
2. **No-op suppression.** If `updateDeliverableContent` returns an unchanged `version`
   (content identical), return success but **skip** activity/broadcast/cache-invalidation —
   an "Edited …" activity entry for a no-op write is misleading.
3. **camelCase params** (`workspaceId`, `deliverableId`, `content`, `expectedVersion`) —
   consistent with the sibling `get_brand_identity`, not the snake_case content-action tools.

## Registration lockstep (all in one commit)

1. `shared/types/mcp-action-schemas.ts` — `updateBrandDeliverableInputSchema` + type export.
2. `server/mcp/tools/brand.ts` — add tool def to `brandTools[]`; split `handleBrandTool`
   into a name dispatcher + extract `handleGetBrandIdentity` + add `handleUpdateBrandDeliverable`.
3. `server/mcp/server.ts` — **no change** (auto-routed).
4. Tests — new real-DB write test `tests/unit/mcp-brand-write.test.ts`; existing contract
   test (`mcp-tool-input-schema-properties`) and routing test auto-cover the new tool.

## Acceptance checklist

- [ ] `update_brand_deliverable` registered in `brandTools[]` with a clear description (read-then-write flow + version-conflict note).
- [ ] Schema validates `workspaceId`/`deliverableId`/`content` required, `expectedVersion` optional positive int.
- [ ] Success path: content persisted (re-read DB), `version` bumped, `status='draft'`, version snapshot row created, activity + broadcast(BRAND_IDENTITY_UPDATED) + cache invalidation fired, returns updated deliverable JSON.
- [ ] No-op path: identical content → success, **no** side effects, version unchanged.
- [ ] Conflict path: `expectedVersion` mismatch → isError "Version conflict", **no** write.
- [ ] Not-found path: unknown `deliverableId` → isError "not found".
- [ ] Cross-workspace isolation: deliverable owned by ws-A not writable via ws-B.
- [ ] Invalid args (missing content / empty) → validation error.
- [ ] Unknown tool name still returns "Unknown tool" (dispatcher regression guard).
- [ ] Gates: typecheck · vite build · vitest (full) · pr-check · lint:hooks · verify:feature-flags · verify:coverage-ratchet.
- [ ] Adversarial review (single-domain → `superpowers:requesting-code-review`).
- [ ] Docs: FEATURE_AUDIT.md entry; MCP audit doc updated to mark the write gap closed.

# Strategy Redesign — Phase 3b-ii: Cannibalization "Send to client" (dedicated type)

> Execute with superpowers:executing-plans. All compile-gate edits land in ONE commit.

**Goal:** Add a per-issue **Send to client** action to the Act-band cannibalization triage, delivering a purpose-built `cannibalization` client-action / deliverable type (owner decision — not a piggyback). The client sees a dedicated card: the keyword, the competing pages (keeper marked), and the recommended fix.

**Architecture:** A new `cannibalization` member of the `client_action` deliverable family (decision-kind, like `content_decay`). Reuses the grandfathered `createAdminClientAction` / `POST /api/client-actions/:wsId` path (pr-check-compliant; a new `/send-to-client` route would violate `unified-send-to-client-bespoke-route`). The send writes a legacy `client_action` AND auto-mirrors a `client_deliverable` of type `cannibalization` via the existing dual-write. A new deliverable adapter (modeled on `content-decay.ts`) handles validate/build/sourceRef/respond; apply stays the family's permanent no-op. A new `CannibalizationRenderer` renders the client card in both the production `DeliverableDetailModal` and the legacy `DecisionDetailModal`.

**Compile-gate discipline (one commit):** Adding `'cannibalization'` to `ClientActionSourceType` compile-fails `clientActionDeliverableType` (exhaustive switch, no default — a miss SILENTLY swallows the deliverable mirror) and `DELIVERABLE_TYPE_BADGES` (exhaustive `Record<DeliverableType>`). Adding to `DELIVERABLE_TYPES` requires the adapter + the pr-check hardcoded list. All in lockstep.

**Dedup:** `sourceId = cannibalizationSourceId(keyword)` (the same helper 3b-i uses) so a re-send of the same keyword dedupes onto one row (`getActiveClientActionBySource`).

**Routing:** no note → Decisions; note → Conversations (single "Send to client" button; we send without a note for now → Decisions; the optional inline note is a future enhancement).

## Verified touchpoints
- `shared/types/client-actions.ts:3-7` ClientActionSourceType (4 members); `ClientActionPayload` has `metadata?` + index sig.
- `shared/types/client-deliverable.ts:18-33` `DELIVERABLE_TYPES` (14).
- `server/client-actions.ts:24` `validSources`; `:112` rowToAction coerces unknown source_type → 'aeo_change' (so validSources MUST include cannibalization).
- `server/routes/client-actions.ts:24` `sourceTypeSchema` z.enum.
- `server/domains/inbox/deliverable-adapters/client-action-shared.ts`: `CLIENT_ACTION_FAMILY_TYPES:74`, `clientActionDeliverableType:88` (exhaustive switch), `buildClientActionPayload:152` kind ternary (`content_decay` → 'decision'), `originTargetKeyword`, `applyDisabledStub`, `respondToClientActionSource`.
- `server/domains/inbox/deliverable-adapters/content-decay.ts` — the decision-kind adapter MODEL.
- `server/domains/inbox/deliverable-adapters/index.ts:24` registration imports.
- `scripts/pr-check.ts:8420` hardcoded `deliverableTypes` list (parallel to DELIVERABLE_TYPES).
- `src/lib/decision-adapters.ts`: `CLIENT_ACTION_BADGES:8`, `DELIVERABLE_TYPE_BADGES:132` (exhaustive Record — compile gate), `normalizeClientAction:87` kind ternary, `PAYLOAD_ITEMS_DELIVERABLE_TYPES:176` (batch only — cannibalization NOT added, it's decision).
- `src/components/client/decision-renderers.tsx:412` `RedirectRenderer` model; client_action renderers at `:312+`.
- `src/components/client/DeliverableDetailModal.tsx:281-294` branch chain (`subType === 'X' || decision.badge === 'Y'` → renderer with `payloadItems`), final else at `:299`. Import line `:30`.
- `src/components/client/DecisionDetailModal.tsx:95-100` legacy sourceType switch, final else `:101` (raw JSON). Imports `:10-12`.
- `src/api/clientActions.ts` `clientActions.create(wsId, {...})` exists.

## Payload shape
Admin sends `action.payload = { keyword, pages: [{path, position?}], recommendation, canonicalPath?, metadata: { origin: { targetKeyword: keyword, pageUrl: canonicalPath } } }`. The adapter wraps the issue as the single decision item `items: [{ keyword, pages, recommendation, canonicalPath }]`. The renderer narrows to `CannibalizationPayload`.

---

## Task 1: Shared contracts (one place each — pre-commit gate)
- [ ] `shared/types/client-actions.ts`: add `| 'cannibalization'` to `ClientActionSourceType`; add:
```ts
export interface CannibalizationActionItem { path: string; position?: number }
export interface CannibalizationPayload {
  keyword: string;
  pages: CannibalizationActionItem[];
  recommendation: string;
  canonicalPath?: string;
}
```
- [ ] `shared/types/client-deliverable.ts`: add `'cannibalization'` to `DELIVERABLE_TYPES`.

## Task 2: Server family wiring + adapter
- [ ] `server/client-actions.ts:24`: add `'cannibalization'` to `validSources`.
- [ ] `server/routes/client-actions.ts:24`: add `'cannibalization'` to `sourceTypeSchema`.
- [ ] `client-action-shared.ts`: add `'cannibalization'` to `CLIENT_ACTION_FAMILY_TYPES`; add `case 'cannibalization': return 'cannibalization';` to `clientActionDeliverableType`; change the `buildClientActionPayload` kind ternary to `type === 'content_decay' || type === 'cannibalization' ? 'decision' : 'batch'`.
- [ ] NEW `server/domains/inbox/deliverable-adapters/cannibalization.ts` (model on `content-decay.ts`): `type:'cannibalization'`; `validateSendable` requires `originTargetKeyword` (else `{ok:false}`); `buildPayload` builds the single issue item from `action.payload` (`{keyword,pages,recommendation,canonicalPath}`) → `buildClientActionPayload('cannibalization', action, [issue], 'page')`; `sourceRef` = `const kw = originTargetKeyword(input.action); return kw ? \`cannibalization:${kw}\` : input.action.sourceId ?? null;`; `respondToSource: respondToClientActionSource`; `applyDeliverable: applyDisabledStub`. End with `registerAdapter(cannibalizationAdapter as DeliverableAdapter);`.
- [ ] `deliverable-adapters/index.ts`: add `import './cannibalization.js';` in the client_action family block.

## Task 3: pr-check list
- [ ] `scripts/pr-check.ts` (~:8420): add `'cannibalization'` to the hardcoded `deliverableTypes` array.

## Task 4: Frontend client renderer + modal wiring
- [ ] `src/lib/decision-adapters.ts`: add `cannibalization: 'Keywords'` to `CLIENT_ACTION_BADGES` and `cannibalization: 'Keywords'` to `DELIVERABLE_TYPE_BADGES` (compile gate); add `'cannibalization'` to the `normalizeClientAction` decision ternary (`=== 'content_decay' || === 'cannibalization'`).
- [ ] `src/components/client/decision-renderers.tsx`: add `CannibalizationRenderer({ payload }: { payload: CannibalizationPayload })` — client-facing, narrative, Four Laws, NO purple. Render `payload.keyword`, the competing `payload.pages` (mark the one matching `payload.canonicalPath` as "We'll keep"), and `payload.recommendation`. Import `CannibalizationPayload` from `../../../shared/types/client-actions`.
- [ ] `DeliverableDetailModal.tsx`: import `CannibalizationRenderer`; add a branch BEFORE the schema_plan/final-else: `} else if (subType === 'cannibalization' || decision.badge === 'Keywords') { body = <CannibalizationRenderer payload={(payloadItems?.[0] as CannibalizationPayload) ?? emptyShape} />; }`.
- [ ] `DecisionDetailModal.tsx`: import `CannibalizationRenderer`; add `} else if (action.sourceType === 'cannibalization') { body = <CannibalizationRenderer payload={p as CannibalizationPayload} />; }` before the JSON else.

## Task 5: Admin "Send to client" button
- [ ] `src/components/strategy/CannibalizationTriage.tsx`: add a per-issue **Send to client** button (label exactly "Send to client", loading "Sending…"). Uses a `useMutation` over `clientActions.create(workspaceId, { sourceType: 'cannibalization', sourceId: cannibalizationSourceId(item.keyword), title: \`Keyword cannibalization: "${item.keyword}"\`, summary: item.recommendation, payload: { keyword, pages: item.pages.map(p=>({path:p.path,position:p.position})), recommendation: item.recommendation, canonicalPath, metadata: { origin: { targetKeyword: item.keyword, pageUrl: canonicalPath } } } })`. Show a "Sent" state after success (track sent keywords locally, or rely on dedup). Import `clientActions` from `../../api/clientActions`.

## Task 6: Tests
- [ ] `tests/unit/deliverable-adapter-registry.test.ts`: assert `listAdapterTypes()` includes `'cannibalization'`.
- [ ] Integration: `POST /api/client-actions/:ws` with `sourceType:'cannibalization'` → 200; the unified inbox read path returns a `cannibalization` deliverable (assert via the public/unified read, not just admin GET — per the integration-read-path rule).
- [ ] `tests/unit/strategy/CannibalizationTriage.test.tsx`: mock `clientActions.create`; click "Send to client" → assert called with `sourceType:'cannibalization'`, `sourceId` = normalized keyword, payload carries keyword/pages/recommendation.

## Quality gates + closeout
- [ ] typecheck (compile gate must be satisfied) · pr-check · build · touched-area tests + adapter registry + integration.
- [ ] Commit staged-only; verify `git log -2` (no foreign parent) + `git diff origin/staging...HEAD --name-only` before PR (shared-checkout hazard).
- [ ] Scaled review (client-facing + compile-gate → warrants a real review pass).
- [ ] FEATURE_AUDIT, roadmap (3b-i done + 3b-ii item), `docs/rules/inbox-section-routing.md` (note the new source type), memory.
- [ ] PR → staging. This completes Phase 3.

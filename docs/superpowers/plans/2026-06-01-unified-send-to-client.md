# Unified Send-to-Client — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the five bespoke "send to client" pipelines with one `ClientDeliverable` model + one `sendToClient()` service + one client inbox + one admin inbox, via a strangler-fig per-type cutover that production never feels.

**Architecture:** Phase 0 lands the shared spine (one table for the simple types, a self-registering adapter registry, one status state machine, the service skeleton, and three phase-group feature flags) **dark**. Phase 1 migrates each work type onto the spine one PR at a time (dual-write → idempotent backfill → shadow-compare at the public read path → flag-flip). Phase 2 builds the two unified inboxes once all types are dual-writing. Phase 3 tears down the old tables behind a soft-FK prerequisite migration. The two *hierarchical* types (`copy_section`, `content_request`) are **projected** from their source tables, not physically migrated (D-hybrid).

**Tech Stack:** TypeScript, Express, better-sqlite3 (WAL, FK ON), React 19 + React Query, Zod v3, Vitest. Patterns: `createStmtCache()`/`rowToX()` mappers (template: `server/opportunity-events.ts`), `validateTransition()` (`server/state-machines.ts`), `parseJsonSafe` (`server/db/json-validation.ts`), feature-flag catalog (`shared/types/feature-flags.ts`), `broadcastToWorkspace` + `useWorkspaceEvents`.

**Source-of-truth docs:**
- Design: [docs/designs/2026-06-01-unified-send-to-client-design.md](../../designs/2026-06-01-unified-send-to-client-design.md)
- Pre-plan audit (verified scope, 118 files, per-PR file ownership): [docs/superpowers/audits/2026-06-01-unified-send-to-client-audit.md](../audits/2026-06-01-unified-send-to-client-audit.md)
- Motivating audit: [docs/audits/2026-06-01-client-inbox-pipeline-audit.md](../../audits/2026-06-01-client-inbox-pipeline-audit.md)

**Owner decisions baked in:** D-apply (apply opt-in, default no-op) · D-hybrid (project copy + content_request) · D-workorder (`work_order` = `order` kind, `briefing` = `notification`) · Read strategy = hybrid per type · Adapter registry = self-registering · `new-inbox-ia` ≈100% (Phase 3 deletes `LegacyInboxLayout`).

---

## Plan shape & why it's split this way

This plan is **fully bite-sized for Phase 0** (the shared contracts — buildable right now, every signature determined). **Phases 1–3 are specified as an exact execution template + per-PR file ownership + acceptance gates**, NOT as speculative bite-sized code: per CLAUDE.md *phase-per-PR* ("never open phase N+1 until phase N is merged and green on staging"), each Phase-1 type PR's micro-steps must be written against the **real** Phase-0 adapter interface and store API once they exist — writing literal code for them now would be guesses (the No-Placeholders rule forbids guesses). When Phase 0 merges, run writing-plans again to expand the next phase's PR into bite-sized tasks using the frozen contracts. The template below is detailed enough to dispatch each PR; only the exact code bodies wait for Phase 0.

**Execution order (from audit §E):**
- **Phase 0** — 1 PR, sequential, dark.
- **Phase 1** — 7 PRs. Parallel-safe set after Phase 0: PR-1b (client_action), PR-1c (schema_plan — but its `parent_deliverable_id` backfill serializes *after* PR-1a), PR-1d (copy), PR-1g (briefing). Serialize: PR-1a → PR-1e (share `src/api/content.ts`); PR-1e → PR-1f (share `server/stripe.ts`). PR-1a (approval family, fixes the live B1 destructive write) goes **first**.
- **Phase 2** — 1–2 PRs (client inbox, admin inbox), after all types dual-writing.
- **Phase 3** — 1 PR, teardown, last.

---

## File Structure (Phase 0 — created/modified)

| File | Responsibility |
|---|---|
| `server/db/migrations/111-client-deliverable.sql` (create) | `client_deliverable` table + indexes + cascade-on-workspace-delete (migration 019 is not re-run, so wire cascade here) |
| `server/db/migrations/112-client-deliverable-item.sql` (create) | `client_deliverable_item` child table + index |
| `shared/types/client-deliverable.ts` (create) | `ClientDeliverable`, `ClientDeliverableItem`, `DeliverableType`, `DeliverableKind`, `DeliverableStatus`, the discriminated `DeliverablePayload` union, Zod schemas |
| `server/client-deliverables.ts` (create) | the store: `createStmtCache`, `rowToDeliverable`, `upsertDeliverable`, `getDeliverable`, `listDeliverables`, status reads; **only writer of the table** |
| `server/state-machines.ts` (modify) | add `CLIENT_DELIVERABLE_TRANSITIONS` (+ per-type override helper), `MATRIX_CELL_TRANSITIONS`, `REQUEST_TRANSITIONS` |
| `server/domains/inbox/send-to-client.ts` (create) | `sendToClient()` (5 guarantees) + `respondToDeliverable()` shared handler + the adapter registry |
| `server/domains/inbox/deliverable-adapters/index.ts` (create) | the registry barrel — adapters self-register on import (empty in Phase 0) |
| `server/domains/inbox/deliverable-adapters/types.ts` (create) | `DeliverableAdapter` interface + `registerAdapter()` |
| `server/routes/deliverables.ts` (create) | thin HTTP adapter: `PATCH /api/public/deliverables/:workspaceId/:id/respond`, `POST /api/deliverables/:workspaceId/:id/remind` |
| `server/ws-events.ts` (modify) | `DELIVERABLE_SENT`, `DELIVERABLE_UPDATED` constants |
| `shared/types/feature-flags.ts` (modify) | 3 phase-group flags + catalog entries |
| `scripts/pr-check.ts` (modify) | 3 new rules (no-direct-insert-outside-store, every-type-has-adapter, extend send-for-review) |
| `shared/types/decision.ts` (modify) | **deferred to Phase 2** — `kind` replacing `isSingleAction` is a consumer-touching rename; Phase 0 only *adds* `client-deliverable.ts` (zero importers) |

---

## PHASE 0 — Shared contracts (one PR, dark/no-op)

### Task 0.1: Migrations — `client_deliverable` + `_item`

**Files:**
- Create: `server/db/migrations/111-client-deliverable.sql`
- Create: `server/db/migrations/112-client-deliverable-item.sql`
- Test: `tests/integration/client-deliverable-store.test.ts` (added in 0.3)

- [ ] **Step 1: Write `111-client-deliverable.sql`** (schema per design §4.1; cascade wired here because `019-cascade-workspace-delete.sql` is not re-run — audit §B.3)

```sql
-- 111-client-deliverable.sql
-- Unified client-deliverable spine (replaces the 5 bespoke send-to-client artifacts
-- for the physically-migrated types; copy_section + content_request are PROJECTED).
-- Dark until the unified-deliverables-* flags flip per type. See
-- docs/designs/2026-06-01-unified-send-to-client-design.md §4.1.
CREATE TABLE IF NOT EXISTS client_deliverable (
  id                    TEXT PRIMARY KEY,
  workspace_id          TEXT NOT NULL,
  external_ref          TEXT,            -- site_id for schema_plan; null otherwise
  type                  TEXT NOT NULL,
  kind                  TEXT NOT NULL,   -- decision|batch|review|notification|order
  status                TEXT NOT NULL,
  title                 TEXT NOT NULL,
  summary               TEXT,
  payload               TEXT NOT NULL,   -- typed JSON, discriminated by `type`
  note                  TEXT,
  client_response_note  TEXT,
  parent_deliverable_id TEXT,            -- self-FK (schema_plan → its schema-item batch)
  sent_at               TEXT,            -- staleness clock
  decided_at            TEXT,
  due_at                TEXT,
  applied_at            TEXT,
  generated_at          TEXT,            -- producer version stamp
  source                TEXT,
  source_ref            TEXT,            -- stable dedup key (per-type, design §4.5)
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cd_ws_status_sent ON client_deliverable(workspace_id, status, sent_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cd_ws_type_sourceref
  ON client_deliverable(workspace_id, type, source_ref) WHERE source_ref IS NOT NULL;
```

- [ ] **Step 2: Write `112-client-deliverable-item.sql`**

```sql
-- 112-client-deliverable-item.sql
-- Child items for kind='batch' (approval/SEO/schema-item family). Heterogeneous
-- client_action sub-items live in client_deliverable.payload JSON instead (design §4.1).
CREATE TABLE IF NOT EXISTS client_deliverable_item (
  id             TEXT PRIMARY KEY,
  deliverable_id TEXT NOT NULL REFERENCES client_deliverable(id) ON DELETE CASCADE,
  status         TEXT NOT NULL,
  target_ref     TEXT,            -- pageId / cms-collection-item id
  collection_id  TEXT,            -- Webflow collection
  field          TEXT,            -- the SPECIFIC target field (fixes B1)
  current_value  TEXT,
  proposed_value TEXT,
  client_value   TEXT,            -- client's edited value (apply reads this)
  client_note    TEXT,
  applyable      INTEGER NOT NULL DEFAULT 0,
  item_payload   TEXT,            -- typed JSON for heterogeneous per-item fields
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cdi_deliverable ON client_deliverable_item(deliverable_id);
```

- [ ] **Step 3: Run migrations against a scratch DB to verify they apply**

Run: `npm run db:migrate`
Expected: applies `111`/`112` with no error; re-running is a no-op (`IF NOT EXISTS`).

- [ ] **Step 4: Commit**

```bash
git add server/db/migrations/111-client-deliverable.sql server/db/migrations/112-client-deliverable-item.sql
git commit -m "feat(deliverable): add client_deliverable + _item tables (dark)"
```

### Task 0.2: Shared types — `ClientDeliverable` + payload union + Zod

**Files:**
- Create: `shared/types/client-deliverable.ts`
- Test: covered by 0.3 (round-trip)

- [ ] **Step 1: Write the type module** (mirror the row exactly; CLAUDE.md DB-column+mapper lockstep). Discriminated `DeliverablePayload` per type; Zod via `import { z } from '../../server/middleware/validate.js'` is server-only, so define the Zod schema in the store module (0.3) and keep this file types-only + a const arrays for enums.

```ts
// shared/types/client-deliverable.ts
export const DELIVERABLE_TYPES = [
  'seo_edit','audit_issue','schema_item','schema_plan','redirect','internal_link',
  'aeo_change','content_decay','content_plan_sample','content_plan_template',
  'work_order','briefing','copy_section','content_request',
] as const;
export type DeliverableType = (typeof DELIVERABLE_TYPES)[number];

export const DELIVERABLE_KINDS = ['decision','batch','review','notification','order'] as const;
export type DeliverableKind = (typeof DELIVERABLE_KINDS)[number];

export const DELIVERABLE_STATUSES = [
  'draft','awaiting_client','changes_requested','partial','approved','declined',
  'applied','expired','cancelled','ordered','in_progress','completed',
] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];

export interface ClientDeliverableItem {
  id: string;
  deliverableId: string;
  status: string;
  targetRef: string | null;
  collectionId: string | null;
  field: string | null;
  currentValue: string | null;
  proposedValue: string | null;
  clientValue: string | null;
  clientNote: string | null;
  applyable: boolean;
  /** Heterogeneous per-item fields (internal-link 6-field, AEO 7-field, redirect 4-field). */
  itemPayload: Record<string, unknown> | null;
  sortOrder: number;
}

export interface ClientDeliverable {
  id: string;
  workspaceId: string;
  externalRef: string | null;
  type: DeliverableType;
  kind: DeliverableKind;
  status: DeliverableStatus;
  title: string;
  summary: string | null;
  payload: Record<string, unknown>;
  note: string | null;
  clientResponseNote: string | null;
  parentDeliverableId: string | null;
  sentAt: string | null;
  decidedAt: string | null;
  dueAt: string | null;
  appliedAt: string | null;
  generatedAt: string | null;
  source: string | null;
  sourceRef: string | null;
  createdAt: string;
  updatedAt: string;
  items?: ClientDeliverableItem[];
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: zero errors (the module has no importers yet).

- [ ] **Step 3: Commit**

```bash
git add shared/types/client-deliverable.ts
git commit -m "feat(deliverable): ClientDeliverable shared types (dark)"
```

### Task 0.3: The store (`server/client-deliverables.ts`)

**Files:**
- Create: `server/client-deliverables.ts` (template: `server/opportunity-events.ts`)
- Test: `tests/integration/client-deliverable-store.test.ts` (unique port from `tests/` range; check `grep -r 'createTestContext(' tests/` first)

- [ ] **Step 1: Write the failing round-trip test** (CLAUDE.md: build→store→parse→assert-no-fallback)

```ts
import { describe, it, expect, afterAll } from 'vitest';
import db from '../../server/db/index.js';
import { upsertDeliverable, getDeliverable, rowToDeliverable } from '../../server/client-deliverables.js';

const WS = 'cd-store-test';
afterAll(() => db.prepare("DELETE FROM client_deliverable WHERE workspace_id = ?").run(WS));

describe('client_deliverable store round-trip', () => {
  it('persists and reads back every field with no fallback', () => {
    const d = upsertDeliverable({
      workspaceId: WS, type: 'redirect', kind: 'decision', status: 'awaiting_client',
      title: 'Redirect proposal', payload: { redirects: [{ source: '/a', target: '/b' }] },
      sourceRef: 'redirect:site-1', sentAt: '2026-06-01T00:00:00.000Z',
    });
    const got = getDeliverable(d.id)!;
    expect(got.type).toBe('redirect');
    expect(got.payload).toEqual({ redirects: [{ source: '/a', target: '/b' }] });
    expect(got.sourceRef).toBe('redirect:site-1');
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — Run: `npx vitest run tests/integration/client-deliverable-store.test.ts` — Expected: FAIL (`upsertDeliverable` not defined).

- [ ] **Step 3: Implement the store** following the `opportunity-events.ts` template (lazy `createStmtCache`, `rowToDeliverable`, `parseJsonSafe` for `payload`, `crypto.randomBytes` ids, `INSERT ... ON CONFLICT(workspace_id,type,source_ref) DO UPDATE` for dedup-on-resend, finite/`updated_at` stamping). Define the Zod `deliverablePayloadSchema` discriminated union here. **Do not** value-import `recommendations.ts` or route files (circular-import hazard — audit lesson).

- [ ] **Step 4: Run it, verify it passes** — Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(deliverable): client_deliverable store + round-trip test"`

### Task 0.4: State machine — `CLIENT_DELIVERABLE_TRANSITIONS` + `MATRIX_CELL_TRANSITIONS` + `REQUEST_TRANSITIONS`

**Files:**
- Modify: `server/state-machines.ts` (append, following the existing map format at `:11-129`)
- Test: `tests/unit/client-deliverable-transitions.test.ts`

- [ ] **Step 1: Write the failing guard test**

```ts
import { describe, it, expect } from 'vitest';
import { CLIENT_DELIVERABLE_TRANSITIONS, REQUEST_TRANSITIONS, validateTransition, InvalidTransitionError } from '../../server/state-machines.js';

describe('CLIENT_DELIVERABLE_TRANSITIONS', () => {
  it('allows awaiting_client → changes_requested and back', () => {
    expect(validateTransition('deliverable', CLIENT_DELIVERABLE_TRANSITIONS, 'awaiting_client', 'changes_requested')).toBe('changes_requested');
    expect(validateTransition('deliverable', CLIENT_DELIVERABLE_TRANSITIONS, 'changes_requested', 'awaiting_client')).toBe('awaiting_client');
  });
  it('allows awaiting_client → declined (the new terminal for client_action)', () => {
    expect(validateTransition('deliverable', CLIENT_DELIVERABLE_TRANSITIONS, 'awaiting_client', 'declined')).toBe('declined');
  });
  it('rejects approved → awaiting_client (no un-approve in the base map)', () => {
    expect(() => validateTransition('deliverable', CLIENT_DELIVERABLE_TRANSITIONS, 'approved', 'awaiting_client')).toThrow(InvalidTransitionError);
  });
  it('REQUEST_TRANSITIONS forbids closed → new (B24)', () => {
    expect(() => validateTransition('request', REQUEST_TRANSITIONS, 'closed', 'new')).toThrow(InvalidTransitionError);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — Expected: FAIL (maps undefined).

- [ ] **Step 3: Add the maps** to `server/state-machines.ts`. Base `CLIENT_DELIVERABLE_TRANSITIONS` per design §4.2 (`draft→awaiting_client`; `awaiting_client→{changes_requested,approved,declined,partial}`; `changes_requested↔awaiting_client`; `approved→applied`; `partial→{approved,declined,changes_requested}`; `order` chain `ordered→in_progress→completed`; terminals `applied/declined/expired/cancelled/completed`). Add `getDeliverableTransitions(type)` returning base + per-type override (copy: `approved` terminal, `changes_requested→draft`; notification: `{}`). Add `MATRIX_CELL_TRANSITIONS` (the 8 `MatrixCellStatus` values — read `shared/types/content.ts`) and `REQUEST_TRANSITIONS` (the 6 `RequestStatus` values — read `server/requests.ts:4`).

- [ ] **Step 4: Run it, verify it passes** — Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(deliverable): state machines (deliverable, matrix cell, request)"`

### Task 0.5: Adapter registry + interface

**Files:**
- Create: `server/domains/inbox/deliverable-adapters/types.ts`, `.../index.ts`
- Test: `tests/unit/deliverable-adapter-registry.test.ts`

- [ ] **Step 1: Write the failing test** — registering an adapter and resolving it by type returns it; resolving an unregistered type throws.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `DeliverableAdapter<T>` interface (`validateSendable`/`buildPayload`/`sourceRef`/`applyDeliverable` default no-op/`projectFromSource?`), a module-level `Map<DeliverableType, DeliverableAdapter>`, `registerAdapter()`, `getAdapter(type)`. `index.ts` is the import barrel (empty list in Phase 0; each Phase-1 PR adds `import './<type>.js'` here — append-only, the only shared edit, kept tiny so parallel PRs merge trivially per the self-registration decision).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(deliverable): self-registering adapter registry"`

### Task 0.6: `sendToClient()` + `respondToDeliverable()` service skeleton

**Files:**
- Create: `server/domains/inbox/send-to-client.ts`
- Modify: `server/ws-events.ts` (add `DELIVERABLE_SENT: 'deliverable:sent'`, `DELIVERABLE_UPDATED: 'deliverable:updated'`)
- Test: `tests/integration/send-to-client.test.ts`

- [ ] **Step 1: Write the failing test** with a fake adapter registered for a throwaway type: `sendToClient` runs `validateSendable` (rejects bad input), inserts a guarded `awaiting_client` row, broadcasts `DELIVERABLE_SENT`; `respondToDeliverable('approved')` validates the transition, sets `decided_at`, and calls `applyDeliverable` **only if the adapter opted in** (assert no-op adapter does NOT apply).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the 5 guarantees (design §4.3): `validateSendable` → `validateTransition(draft→awaiting_client)` → `buildPayload` → `upsertDeliverable` → client-notify (email + broadcast). `respondToDeliverable`: guard transition → persist response + `client_response_note` → team email **every outcome** → broadcast `DELIVERABLE_UPDATED` → on `approved` AND `adapter.appliesOnApprove === true`, run `applyDeliverable` (Webflow call **outside** the DB txn — mark-pending → call → mark-applied, per CLAUDE.md external-call guard). Default `appliesOnApprove` is false (D-apply).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(deliverable): sendToClient + respond service (5 guarantees, apply opt-in)"`

### Task 0.7: HTTP adapter route (`server/routes/deliverables.ts`)

**Files:**
- Create: `server/routes/deliverables.ts`; register in `server/app.ts` route table
- Test: `tests/integration/deliverables-route.test.ts`

- [ ] **Step 1: Write the failing test** — unauthenticated `PATCH /api/public/deliverables/:workspaceId/:id/respond` returns **401** (the route uses `requireAuthenticatedClientPortalAuth`, param named `:workspaceId` — audit §B.5, M1); authenticated approve transitions the row.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the thin route: `PATCH .../respond` → `respondToDeliverable`; `POST /api/deliverables/:workspaceId/:id/remind` (admin) → service remind. Lives under `server/routes/` so pr-check rule 135 scans it (audit minor-2). Per-type guard resolution is added when copy/strategy types cut over (Phase 1d/1e).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(deliverable): public respond + admin remind routes (auth-gated)"`

### Task 0.8: Three phase-group feature flags

**Files:**
- Modify: `shared/types/feature-flags.ts` (add to `FEATURE_FLAGS` + `FEATURE_FLAG_CATALOG`)
- Test: `npm run verify:feature-flags`

- [ ] **Step 1: Add the flags** (default `false`) to `FEATURE_FLAGS`:

```ts
  // Unified Send-to-Client (strangler-fig, per phase group; dark by default)
  'unified-deliverables-approval-family': false,
  'unified-deliverables-broken-family': false,
  'unified-deliverables-rest': false,
```

- [ ] **Step 2: Add catalog entries** for each in `FEATURE_FLAG_CATALOG` with full `FeatureFlagLifecycleMeta` (owner `inbox-platform`, `createdAt: '2026-06-01'`, `rolloutTarget: 'staging-validation'`, a `removalCondition`, a `linkedRoadmapItemId` pointing at a new roadmap item id, `staleAuditCadence: 'monthly'`, `lastReviewedAt: '2026-06-01'`) and a `group` from `FEATURE_FLAG_GROUP_LABELS` (add a `'Unified Send-to-Client'` group label if absent).

- [ ] **Step 3: Add the roadmap item** the flags link to (`data/roadmap.json`, then `npx tsx scripts/sort-roadmap.ts`).

- [ ] **Step 4: Verify** — Run: `npm run verify:feature-flags` — Expected: pass (no orphaned/ungrouped keys).

- [ ] **Step 5: Commit** — `git commit -m "feat(deliverable): 3 phase-group flags + catalog + roadmap item"`

### Task 0.9: Three prevention pr-check rules

**Files:**
- Modify: `scripts/pr-check.ts` (add to the `CHECKS` array — entry shape at `:226-254`: `name`/`pattern`|`customCheck`/`pathFilter`/`message`/`severity`)
- Then: `npm run rules:generate`
- Test: `tests/pr-check.test.ts` (add a positive + negative fixture per rule)

- [ ] **Step 1: Write failing fixture tests** for the 3 rules.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Add the rules:** (a) **no direct insert to `client_deliverable` outside the store/service** (`customCheck`: flag `INSERT INTO client_deliverable` or `db.prepare(... client_deliverable ...)` outside `server/client-deliverables.ts`); (b) **every registered `DeliverableType` has an adapter file** (`customCheck`: each `DELIVERABLE_TYPES` member except the projected/notification ones has `deliverable-adapters/<type>.ts` once its flag group is active — Phase-aware, start as `warn`); (c) **extend `send-for-review-anti-pattern`** to also forbid new bespoke `POST /api/<x>/send-to-client` routes outside the unified service.
- [ ] **Step 4: Run tests + `npm run rules:generate`; verify the committed `docs/rules/automated-rules.md` matches.**
- [ ] **Step 5: Commit** — `git commit -m "feat(deliverable): pr-check rules (no-direct-insert, adapter-required, send anti-pattern)"`

### Task 0.10: Phase-0 gate

- [ ] Run the full gate: `npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts && npm run verify:feature-flags`. All green.
- [ ] Open the Phase-0 PR → `staging`. Adversarial review (scaled-code-review per CLAUDE.md, since multi-agent). Merge only when CI is green. **Do not start any Phase-1 PR until this is merged.**

---

## PHASE 1 — Per-type cutover (7 PRs) · repeatable strangler-fig template

Each Phase-1 PR follows this template. **File ownership per PR is fixed by audit §E** (reproduced below). Expand each into bite-sized tasks via writing-plans against the frozen Phase-0 contracts when the PR goes active.

**The template (every type PR):**
1. **Adapter** — create `server/domains/inbox/deliverable-adapters/<type>.ts` implementing `validateSendable`/`buildPayload`/`sourceRef`/`applyDeliverable`; add its `import` line to the registry barrel. TDD: adapter unit test first (build→store→parse→assert-no-fallback; `validateSendable` rejects the type's not-ready inputs).
2. **Dual-write at every writer seam** — route each writer from audit §B.1 through `sendToClient`/the store *in addition to* the legacy write. **Every writer gets a dual-write test** (the seam list per type is in §B.1 — incl. async/cron/MCP/Stripe writers).
3. **Backfill** — `scripts/backfill-deliverables-<type>.ts`, standalone + idempotent (`INSERT ... ON CONFLICT DO NOTHING` on `uq_cd_ws_type_sourceref`; **normalize legacy `sourceId` prefixes to the new `sourceRef()` form** so legacy + fresh dedupe as one — §B.4). Backfill-parity test (row counts + per-type spot checks).
4. **Shadow-compare** — `server/deliverable-divergence.ts` projects both old and new at the **public GET path** and logs reason-coded mismatches; the read flag flips for the type only when parity holds (design §8).
5. **Flag-flip read** — gate the type's reads behind its phase-group flag (DB read-routing for finer per-type granularity, §B/flags). 
6. **Gate** — `typecheck && vite build && vitest run && pr-check && verify:feature-flags`; adversarial review; merge to staging green before the next PR.

### PR-1a — approval_batch family (seo_edit / audit_issue / schema_item / content_plan_*) · FIRST
**Why first:** it's the cleanest, proves the spine, and its `audit_issue` adapter **fixes the live B1 destructive write** (real per-check `field` map + `applyable=false` for non-meta checks).
**Owns:** `server/approvals.ts`, `server/routes/approvals.ts`, `server/routes/content-plan-review.ts`, `server/content-matrices.ts` (add the `MATRIX_CELL_TRANSITIONS` guard — CP-K4/B2/M6), `server/approval-reminders.ts` (retire → fold into `server/deliverable-nudge-cron.ts`, migrate throttle state — M8), `server/deliverable-nudge-cron.ts` (new), `src/components/SeoAudit.tsx` (the B1 field map), `src/components/audit/AuditIssueRow.tsx`, `src/components/editor/useSeoEditorApprovalWorkflow.ts`, `src/components/cms-editor/useCmsEditorApprovalWorkflow.ts`, `src/components/schema/useSchemaSuggesterPublishingWorkflow.ts`, `src/api/content.ts` (sendSamples/sendTemplateReview — shared with PR-1e, serialize 1a→1e).
**Type-specific:** `apply` stays **disabled** behind the flag until the field map soaks (D-apply / risk §9). Backfill needs the deterministic classifier (which of the 5 sub-types each legacy batch is) + a parity assertion that every row resolves to exactly one type (audit §E, minor-9). Carries the `partial` status mapping (M7).

### PR-1b — client_action family (redirect / internal_link / aeo_change / content_decay) · parallel-safe
**Owns:** `server/client-actions.ts`, `server/routes/client-actions.ts`, `server/domains/inbox/client-actions-mutations.ts`, `server/domains/inbox/client-action-feedback-loop.ts`, `server/playbooks.ts` (the async content-decay worker dual-write — §B.1), `src/components/RedirectManager.tsx` + `src/components/InternalLinks.tsx` (**`sourceRef` producer change**: stop keying on `scannedAt`/`analyzedAt`, use `redirect:<siteId>`/`internal_link:<siteId>` — M2/§B.4), `src/components/AeoReview.tsx`, `src/components/ContentDecay.tsx` (`validateSendable` requires a non-empty `targetKeyword` — B13), `src/api/clientActions.ts`.
**Type-specific:** adds `declined` to the model (B23); preserves "return existing active row" dedup semantics (§B.4); the `redirect_proposal`→`redirect` naming decision (open-Q#5).

### PR-1c — schema_plan · parallel-safe but backfill serializes after PR-1a
**Owns:** `server/schema-store.ts`, `server/routes/webflow-schema.ts` (incl. the under-guarded feedback `:874` — "fix not replicate"), `server/serializers/client-safe.ts:262` (`parent_deliverable_id`), `src/components/schema/SchemaPlanPanel.tsx`, `src/api/schema.ts`.
**Type-specific:** `external_ref` = siteId (resolve siteId→workspaceId in backfill, assert 1:1); `client_preview_batch_id` → `parent_deliverable_id` self-FK (depends on PR-1a's migrated batch); send route adopts standard admin guard (open-Q#7); `schema-store.ts:370` becomes guarded.

### PR-1d — copy (PROJECTED) · parallel-safe
**Owns:** `server/copy-review.ts`, `server/routes/copy-pipeline.ts`, `server/copy-generation.ts`, `src/components/brand/CopyReviewPanel.tsx`, `src/api/brand-engine.ts`.
**Type-specific:** **no physical migration** — `projectFromSource()` exposes `copy_sections`/`copy_metadata` through the model (blueprint→entry→section tree + append-only `client_suggestions` + `version` preserved in the source table). Canonical `revision_requested`→`changes_requested` mapped at projection. Per-type auth guard = `requireClientCopyReviewAuth` (M1). Copy `approved` is terminal (no apply).

### PR-1e — brief + post (content_request, PROJECTED) · serialize after PR-1a
**Owns:** `server/content-requests.ts`, `server/routes/content-requests.ts`, `server/routes/content-briefs.ts`, `server/routes/public-content.ts`, `server/stripe.ts` (content_request payment dual-write — shared with PR-1f, serialize 1f after 1e), `server/mcp/tools/content-actions.ts` (**delegate `send_to_client` to the service** — minor-5), `src/components/ContentBriefs.tsx`, `src/components/ContentManager.tsx` (B7 WS read-back so a responded post stops showing a live Approve), `src/api/content.ts` (shared with PR-1a).
**Type-specific:** projected; full 10-state `content_request` override (M4) carrying `brief_id`/`post_id`/`comments[]`/`delivery_url`; `validateSendable` rejects not-ready posts (B19, incl. via MCP).

### PR-1f — work_order (net-new, `kind:'order'`) · serialize after PR-1e (shares stripe.ts)
**Owns:** `server/work-orders.ts`, `server/routes/work-orders.ts`, `server/stripe.ts` (work_order create), `src/components/client/OrderStatus.tsx` (wire it — currently orphaned), **net-new admin advance/complete UI** (B14/M10).
**Type-specific:** additive net-new — **no shadow-compare** (idempotent on `payment_id`); `WORK_ORDER_TRANSITIONS` entry `pending`→`ordered` decision (open-Q#4); gives the client a status surface + operator an advance/complete control.

### PR-1g — briefing (one-way, `kind:'notification'`) · parallel-safe
**Owns:** `server/briefing-store.ts`, `server/routes/briefing.ts`, `server/briefing-cron.ts`, `src/components/admin/BriefingReviewQueue.tsx`.
**Type-specific:** additive net-new (idempotent on briefing id, no shadow-compare); `notification` kind = no client transitions; also fixes the `ActionQueueStrip` `?tab=reviews` beta misroute (B-add-1) in the Phase-2 client work, not here.

---

## PHASE 2 — The two inboxes (after all types dual-writing)

**Serialized into Phase 2 because every client-surface change touches the 1043-line `InboxTab.tsx`** (audit §E shared-file #4); do NOT spread these across Phase-1 PRs.

**PR-2a — Client inbox (Pillar 2):** owns `src/components/client/InboxTab.tsx`, `inbox/InboxTabLayouts.tsx`, `inbox/useInboxTabShell.ts`, `inbox/inbox-filter.ts`, `PriorityStrip.tsx` (mount as landing), `ClientHeader.tsx` + `OverviewTab.tsx` (the **one** `awaiting_client` counter via the dual-window helper), `DecisionCard.tsx`/`DecisionDetailModal.tsx`/`ClientActionDetailModal.tsx` (uniform Approve/Request-changes/Decline + `sent_at` age), `decision-adapters.ts` + `collaboration-artifacts.ts` (the `kind`-replaces-`isSingleAction` + `DecisionSource` widening, one commit — minor-6), `shared/types/decision.ts`, `ClientDashboard.tsx`. Fixes D1–D11. **Dual-window count** until the last type's read flips.

**PR-2b — Admin inbox (Pillar 3):** owns `src/components/admin/AdminInbox.tsx` (repurpose to show sent deliverables, E1/E2), `ClientActionsTab.tsx`, `PendingApprovals.tsx` (generalize remind + read-back), `NotificationBell.tsx` + `useNotifications.ts` (`deliverable-*` → "Actions Needed", E3), `App.tsx` (`requestsSubTab` reads `useSearchParams` — both halves of the `?tab=` contract, A2), `WorkspaceOverview.tsx` (rollup reads the model; **B29** review/flagged split fixed; lands with content_plan read cutover). Status axis (Awaiting/Changes/Approved/Stale) + age from `sent_at`.

**Read-path cutover (serialized, §E shared-file #3):** a dedicated step routes the intelligence slices (`operational-slice.ts`, `client-signals-slice.ts`, `content-pipeline-slice.ts`), the `workspace-overview` rollup, and `workspace-data.ts` to the hybrid read strategy (migrated types → `client_deliverable`; copy/content_request → projected source reads). Respect the `admin-chat-context.ts:691-694` TASK-8 guard (open-Q#1).

---

## PHASE 3 — Teardown (last PR)

**PR-3 — Teardown:** 
1. **Soft-FK prerequisite migration `113`** — add `deliverable_id` to `page_edit_states` + `payments`, backfill from the old `*_id` columns; update **both** `page_edit_states` mappers (the duplicate in `server/workspaces.ts` too — §B.3), `server/payments.ts`. Gate with a verifier asserting **zero readers** of the old id columns (retire the 2 behavior-gating reads at `approvals.ts:163` + `webflow-schema.ts:756-757`).
2. **Drop** the physically-migrated old tables (`approval_batches`, `client_actions`, `schema_site_plans`, + their items). **Do NOT drop** `copy_sections`/`content_topic_requests` (projected).
3. **Delete `LegacyInboxLayout`** (`InboxTab.tsx:618-956`) — `new-inbox-ia` confirmed ≈100%; run the **route-removal-checklist** + grep CLAUDE.md/`docs/rules/inbox-section-routing.md` for stale refs; confirm `inbox-legacy-filter-literal`/`inbox-action-queue-strip` pr-check rules still pass.
4. Retire the 3 phase-group flags (lifecycle → removed).

---

## Model assignments (audit §F)

| Task class | Model | Why |
|---|---|---|
| Migrations, type modules, flag/catalog entries, state-machine maps | Sonnet | mechanical, pattern-matched against templates |
| Store, service, adapters, route, backfill scripts | Sonnet→Opus | DB + service logic; Opus for the apply/dual-write seams |
| The B1 audit field map, copy/content_request projection, read-path cutover | Opus | correctness-critical judgment, cross-file |
| Orchestration, adversarial review per PR, parity-gate decisions | Opus | full-context judgment |

## CLAUDE.md grounding checklist (audit §G — verify per PR)

- **DB column + mapper lockstep** — every migration ships with row interface + `rowToX` + `upsert` + Zod + public-portal serialization in one commit (Tasks 0.1–0.3; every type PR).
- **Status transitions use state machines** — `validateTransition` before every status mutation; the new maps cover deliverable/matrix-cell/request (Task 0.4; PR-1a CP-K4; M11).
- **Broadcast after mutation + `useWorkspaceEvents` two-halves** — `DELIVERABLE_*` events + handlers (Task 0.6; Phase 2).
- **Public route client-portal auth** — `requireAuthenticatedClientPortalAuth`, `:workspaceId` param, per-type guard resolver (Task 0.7; PR-1d/1e).
- **Wire new data into intelligence slices** — `ClientSignalsSlice` reads the model (Phase 2 read-path).
- **Phase-per-PR + dark-launch flags** — every phase gated, green on staging before the next (all phases).
- **Inbox section routing + `?tab=` two-halves** — preserved in Phase 2 (PR-2a/2b); route-removal-checklist on teardown (PR-3).
- **Feature-flag lifecycle** — finite enumerated flags w/ full metadata + roadmap link (Task 0.8).
- **No raw fetch / queryKeys / no purple in client** — Phase 2 UI work.

## Open scope questions to resolve inline (audit §H — 6 remaining)

work_order entry-state rename (#4) · `redirect_proposal`→`redirect` naming (#5) · declined/expired vs dedup-active (#6) · schema_plan send guard (#7) · schema snapshot boundary (#8) · B15 stays deferred while M11 is in (#9). State the chosen answer in each relevant PR description.

---

## Self-review

- **Spec coverage:** every blueprint section (§4.1 schema → Tasks 0.1–0.3; §4.2 machine → 0.4; §4.3/4.4 service+apply+auth → 0.6/0.7; §4.5 adapters → 0.5 + Phase-1 template; §5 client inbox → PR-2a; §6 admin inbox → PR-2b; §7 rollout → Phase structure; §8 testing → embedded per task; §10 traceability → covered by the type that fixes each finding) maps to a task/PR. ✓
- **Placeholders:** Phase 0 steps carry real SQL/TS/tests/commands. Phases 1–3 are intentionally a template (justified above — bite-sized code waits for frozen Phase-0 contracts), not vague TODOs; each PR has exact file ownership + type-specific gotchas + acceptance gates. ✓
- **Type consistency:** `ClientDeliverable`/`DeliverableType`/`DeliverableStatus`/`DeliverableKind` names used consistently across Tasks 0.2–0.7 and the Phase-1 template; `sendToClient`/`respondToDeliverable`/`getAdapter`/`upsertDeliverable` signatures consistent. ✓

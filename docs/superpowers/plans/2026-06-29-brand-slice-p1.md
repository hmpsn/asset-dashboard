# Brand Intelligence Slice — P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, controller-executed) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register a read-only, behavior-neutral `brand` intelligence slice that unifies brand voice + identity, retrievable via `buildWorkspaceIntelligence(ws, { slices: ['brand'] })`, with zero change to any generated prompt/content.

**Architecture:** A new `brand` slice (assembler `server/intelligence/brand-slice.ts`) reads **voice** by importing the unchanged `buildEffectiveBrandVoiceBlock` (`seo-context-source.ts`) and **identity** through a newly-extracted pure read-model (`server/brand-deliverable-read-model.ts`) — the extraction is required because `brand-identity.ts` imports `workspace-intelligence.js`, which would close a cycle the **zero circular-dependency ratchet** rejects. The slice is registered (types + registry) but **NOT** added to `PROMPT_FORMATTABLE_INTELLIGENCE_SLICES`, the `formatters.ts` if-chain, or any `baseSlices` — exactly like the precedent `generationQuality` slice — so it is dark/behavior-neutral until P2.

**Tech Stack:** Express + TypeScript, better-sqlite3 (`createStmtCache`), Vitest, madge circular-dep ratchet.

**Base:** `origin/staging` @ `cdc660db6`. **Branch:** `brand-slice-p1`. **Audit:** `docs/superpowers/audits/2026-06-29-brand-slice-p1-audit.md`.

---

## File structure

| File | Action | Responsibility |
|------|--------|----------------|
| `server/brand-deliverable-read-model.ts` | **Create** | Pure deliverable reads (stmts + mappers + `listDeliverables`/`getDeliverable`). Leaf: imports only `db`, `stmt-cache`, `brand-engine` types. |
| `server/brand-identity.ts` | Modify | Import reads from read-model; re-export `listDeliverables`/`getDeliverable`; keep write stmts. |
| `shared/types/intelligence.ts` | Modify | `BrandSlice` interface; `'brand'` in `INTELLIGENCE_SLICES`; `brand?` field on `WorkspaceIntelligence`. |
| `server/intelligence/brand-slice.ts` | **Create** | `assembleBrand(workspaceId): Promise<BrandSlice>` — voice block + identity + prompt blocks. |
| `server/intelligence/slice-metadata-registry.ts` | Modify | `brand` registry entry (lazy import). |
| `tests/contract/intelligence-facade-cycles.test.ts` | Modify | Add `'brand-slice'` to `sliceModules`. |
| `tests/contract/cycle-kill-boundaries.test.ts` | Modify | Assert `brand-slice` imports read-model, not `brand-identity`. |
| `tests/unit/brand-slice.test.ts` | **Create** | Assembly: voice authority, identity mapping, availability, parity, cold-start. |
| `docs/rules/workspace-intelligence.md` | Modify | Add `brand` row to slice table. |
| `FEATURE_AUDIT.md`, `data/roadmap.json` | Modify | Post-task doc lockstep. |

**Non-goals (deferred to P2):** formatter case, `PROMPT_FORMATTABLE` entry, `baseSlices` additions, WS events / frontend / query keys, MCP `prepare_*_context` wiring.

---

## Task 1: Extract `brand-deliverable-read-model.ts` (behavior-preserving refactor)

**Files:**
- Create: `server/brand-deliverable-read-model.ts`
- Modify: `server/brand-identity.ts` (imports + re-export; remove migrated read stmts/mappers)
- Test: existing `tests/unit/brand-identity-deliverables.test.ts` + `tests/unit/copy-generation-pure.test.ts` must stay green (no new test; this is a refactor verified by the existing suite + typecheck + circular-dep).

- [ ] **Step 1:** Create `server/brand-deliverable-read-model.ts` with the read half moved verbatim from `brand-identity.ts:22-83`:

```ts
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import type {
  BrandDeliverable, DeliverableVersion, DeliverableType, DeliverableTier, DeliverableStatus,
} from '../shared/types/brand-engine.js';

export interface DeliverableRow {
  id: string; workspace_id: string; deliverable_type: string;
  content: string; status: string; version: number; tier: string;
  created_at: string; updated_at: string;
}
export interface VersionRow {
  id: string; deliverable_id: string; content: string;
  steering_notes: string | null; version: number; created_at: string;
}

const stmts = createStmtCache(() => ({
  listByWorkspace: db.prepare(`SELECT * FROM brand_identity_deliverables WHERE workspace_id = ? ORDER BY tier, deliverable_type`),
  listByTier: db.prepare(`SELECT * FROM brand_identity_deliverables WHERE workspace_id = ? AND tier = ? ORDER BY deliverable_type`),
  getById: db.prepare(`SELECT * FROM brand_identity_deliverables WHERE id = ? AND workspace_id = ?`),
  listVersions: db.prepare(`SELECT v.* FROM brand_identity_versions v INNER JOIN brand_identity_deliverables d ON v.deliverable_id = d.id WHERE v.deliverable_id = ? AND d.workspace_id = ? ORDER BY v.version DESC`),
}));

export function rowToDeliverable(row: DeliverableRow): BrandDeliverable {
  return {
    id: row.id, workspaceId: row.workspace_id,
    deliverableType: row.deliverable_type as DeliverableType,
    content: row.content,
    status: row.status as DeliverableStatus,
    version: row.version,
    tier: row.tier as DeliverableTier,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function rowToVersion(row: VersionRow): DeliverableVersion {
  return {
    id: row.id, deliverableId: row.deliverable_id,
    content: row.content, steeringNotes: row.steering_notes ?? undefined,
    version: row.version, createdAt: row.created_at,
  };
}

export function listDeliverables(workspaceId: string, tier?: DeliverableTier): BrandDeliverable[] {
  const rows = tier
    ? stmts().listByTier.all(workspaceId, tier) as DeliverableRow[]
    : stmts().listByWorkspace.all(workspaceId) as DeliverableRow[];
  return rows.map(rowToDeliverable);
}

export function getDeliverable(workspaceId: string, id: string): (BrandDeliverable & { versions: DeliverableVersion[] }) | null {
  const row = stmts().getById.get(id, workspaceId) as DeliverableRow | undefined;
  if (!row) return null;
  const deliverable = rowToDeliverable(row);
  const versions = (stmts().listVersions.all(id, workspaceId) as VersionRow[]).map(rowToVersion);
  return { ...deliverable, versions };
}
```

- [ ] **Step 2:** In `server/brand-identity.ts`: delete the migrated `DeliverableRow`/`VersionRow` interfaces (22-30), `rowToDeliverable`/`rowToVersion` (48-66), `listDeliverables`/`getDeliverable` (70-83), and the read-only stmts (`listByWorkspace`, `listByTier`, `listVersions`) from the `stmts()` cache (keep `getById`, `getByType`, `insert`, `updateContent`, `updateStatus`, `insertVersion` — writes still use them). Add the import + re-export at top:

```ts
import { rowToDeliverable, listDeliverables, getDeliverable, type DeliverableRow } from './brand-deliverable-read-model.js';
export { listDeliverables, getDeliverable };
```

  (Write functions at lines 199/227/249/276/297/361 keep using `stmts().getById`/`getByType` + the imported `rowToDeliverable` — unchanged behavior.)

- [ ] **Step 3:** Run targeted gates:

```
npm run typecheck
npx vitest run tests/unit/brand-identity-deliverables.test.ts tests/unit/copy-generation-pure.test.ts
npm run check:circular-deps
```
Expected: typecheck clean; both test files PASS; circular-deps `server: 0/0`.

- [ ] **Step 4:** Commit.

```
git add server/brand-deliverable-read-model.ts server/brand-identity.ts
git commit -m "refactor: extract brand-deliverable-read-model (leaf reads, cycle-safe)"
```

---

## Task 2: Define `BrandSlice` interface (type only, no registration yet)

**Files:** Modify `shared/types/intelligence.ts` (add interface near other slice interfaces, after `SeoContextSlice` block).

- [ ] **Step 1:** Add the interface (B3 hybrid — structured identity + voice metadata + resolved prompt blocks):

```ts
export interface BrandSlice {
  /** 'ready' when any approved identity field or a non-empty voice block exists. */
  availability: 'ready' | 'no_data';
  /** Structured, approved-only brand identity (each a single content blob). */
  identity: {
    mission?: string;
    vision?: string;
    values?: string;
    tagline?: string;
    elevatorPitch?: string;
    positioning?: string;
  };
  /** Voice metadata. P1: status only (structured tone/guardrails deferred to a later phase). */
  voice: { status: 'calibrated' | 'legacy' | 'none' };
  /** Authority-resolved voice block — identical to `seoContext.effectiveBrandVoiceBlock`. Inject directly; never re-derive from structured fields. */
  voicePromptBlock: string;
  /** Pre-formatted approved-identity block for prompt injection. Inject directly. */
  identityPromptBlock: string;
}
```

- [ ] **Step 2:** `npm run typecheck` → clean (interface is unreferenced but valid).
- [ ] **Step 3:** Commit: `git commit -am "feat(types): add BrandSlice interface"` (after `git add shared/types/intelligence.ts`).

---

## Task 3: `assembleBrand` + unit test (TDD)

**Files:**
- Create: `server/intelligence/brand-slice.ts`
- Test: `tests/unit/brand-slice.test.ts`

- [ ] **Step 1: Write the failing test** (`tests/unit/brand-slice.test.ts`) — mirror the `vi.hoisted` mock pattern from `tests/unit/client-signals-slice.test.ts`. Mock `../../server/intelligence/seo-context-source.js` (`buildEffectiveBrandVoiceBlock`, `getRawBrandVoice`), `../../server/voice-profile-read-model.js` (`getVoiceProfile`), and `../../server/brand-deliverable-read-model.js` (`listDeliverables`). Cases:
  - calibrated profile → `voice.status === 'calibrated'`, `voicePromptBlock === buildEffectiveBrandVoiceBlock()` (parity).
  - legacy voice only → `voice.status === 'legacy'`.
  - no voice + no deliverables → `availability === 'no_data'`, `voice.status === 'none'`.
  - approved-only mapping: a `draft` `mission` is excluded; an `approved` `values` populates `identity.values` and appears in `identityPromptBlock`.

- [ ] **Step 2:** Run `npx vitest run tests/unit/brand-slice.test.ts` → FAIL (`brand-slice.js` not found).

- [ ] **Step 3: Implement** `server/intelligence/brand-slice.ts` (leaf imports only):

```ts
import type { BrandSlice } from '../../shared/types/intelligence.js';
import { buildEffectiveBrandVoiceBlock, getRawBrandVoice } from './seo-context-source.js';
import { getVoiceProfile } from '../voice-profile-read-model.js';
import { listDeliverables } from '../brand-deliverable-read-model.js';
import { createLogger } from '../logger.js';

const log = createLogger('workspace-intelligence/brand');
const MISSING_SCHEMA_ERROR_RE = /no such (table|column)/i;

function safeRead<T>(context: string, workspaceId: string, fn: () => T, fallback: T): T {
  try { return fn(); } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!MISSING_SCHEMA_ERROR_RE.test(message)) throw err;
    log.warn({ context, workspaceId, error: message }, 'brand read degraded to fallback');
    return fallback;
  }
}

const IDENTITY_FIELDS = [
  ['mission', 'Mission'], ['vision', 'Vision'], ['values', 'Values'],
  ['tagline', 'Tagline'], ['elevator_pitch', 'Elevator pitch'], ['positioning_matrix', 'Positioning'],
] as const;
// deliverableType → BrandSlice.identity key
const TYPE_TO_KEY: Record<string, keyof BrandSlice['identity']> = {
  mission: 'mission', vision: 'vision', values: 'values',
  tagline: 'tagline', elevator_pitch: 'elevatorPitch', positioning_matrix: 'positioning',
};

export async function assembleBrand(workspaceId: string): Promise<BrandSlice> {
  const voicePromptBlock = safeRead('brand.voiceBlock', workspaceId, () => buildEffectiveBrandVoiceBlock(workspaceId), '');
  const profile = safeRead('brand.voiceProfile', workspaceId, () => getVoiceProfile(workspaceId), null);
  const legacyVoice = safeRead('brand.rawVoice', workspaceId, () => getRawBrandVoice(workspaceId), '');
  const status: BrandSlice['voice']['status'] =
    profile?.status === 'calibrated' ? 'calibrated' : (legacyVoice.trim() ? 'legacy' : 'none');

  const approved = safeRead('brand.identity', workspaceId, () => listDeliverables(workspaceId), [])
    .filter(d => d.status === 'approved');
  const identity: BrandSlice['identity'] = {};
  for (const d of approved) {
    const key = TYPE_TO_KEY[d.deliverableType];
    if (key && d.content.trim()) identity[key] = d.content.trim();
  }

  const idLines: string[] = [];
  for (const [type, label] of IDENTITY_FIELDS) {
    const key = TYPE_TO_KEY[type];
    const val = identity[key];
    if (val) idLines.push(`${label}: ${val}`);
  }
  const identityPromptBlock = idLines.length
    ? `\n\nBRAND IDENTITY (ground the brand's positioning in these):\n${idLines.join('\n')}`
    : '';

  const availability: BrandSlice['availability'] =
    (idLines.length > 0 || voicePromptBlock.trim()) ? 'ready' : 'no_data';

  return { availability, identity, voice: { status }, voicePromptBlock, identityPromptBlock };
}
```

- [ ] **Step 4:** Run `npx vitest run tests/unit/brand-slice.test.ts` → PASS.
- [ ] **Step 5:** Commit: `git add server/intelligence/brand-slice.ts tests/unit/brand-slice.test.ts && git commit -m "feat(intelligence): add assembleBrand slice assembler + tests"`.

---

## Task 4: Register the slice (lockstep — must land together to compile)

**Files:** `shared/types/intelligence.ts`, `server/intelligence/slice-metadata-registry.ts`, `tests/contract/intelligence-facade-cycles.test.ts`.

- [ ] **Step 1:** `shared/types/intelligence.ts` — add `'brand'` to `INTELLIGENCE_SLICES` (after `'generationQuality'`, line 41) and add `brand?: BrandSlice;` to `WorkspaceIntelligence` (after `generationQuality?`, line 133). **Do NOT** add to `PROMPT_FORMATTABLE_INTELLIGENCE_SLICES` (dark slice, like `generationQuality`).

- [ ] **Step 2:** `server/intelligence/slice-metadata-registry.ts` — add the entry (mirror `seoContext`, lines 51-56):

```ts
  brand: {
    assemble: async (workspaceId) => {
      const { assembleBrand } = await import('./brand-slice.js'); // dynamic-import-ok — slice registry intentionally lazy-loads typed module exports to avoid facade cycles.
      return { brand: await assembleBrand(workspaceId) };
    },
  },
```

- [ ] **Step 3:** `tests/contract/intelligence-facade-cycles.test.ts` — add `'brand-slice'` to the `sliceModules` array (lines 12-27), preserving ordering/format of existing entries.

- [ ] **Step 4:** Run:
```
npm run typecheck
npx vitest run tests/unit/workspace-intelligence.test.ts tests/contract/intelligence-facade-cycles.test.ts
```
Expected: typecheck clean (registry `satisfies Record<IntelligenceSlice,…>` now satisfied); registry-parity test (`workspace-intelligence.test.ts:156-159`) PASS; facade-cycles PASS.

- [ ] **Step 5:** Commit: `git commit -am "feat(intelligence): register brand slice (non-formattable, behavior-neutral)"`.

---

## Task 5: Cycle-kill boundary test + behavior-neutrality guard

**Files:** `tests/contract/cycle-kill-boundaries.test.ts`.

- [ ] **Step 1:** Add a boundary test mirroring the voice-profile case (`:204-212`):

```ts
it('keeps brand-slice reads on leaf modules (no brand-identity facade import)', () => {
  const brandSlice = readSource('server/intelligence/brand-slice.ts');
  expect(brandSlice).toContain("from '../brand-deliverable-read-model.js'");
  expect(brandSlice).not.toContain("from '../brand-identity.js'");
});
```
(Use the file's existing `readSource` helper; match its exact signature.)

- [ ] **Step 2:** Run `npx vitest run tests/contract/cycle-kill-boundaries.test.ts && npm run check:circular-deps`. Expected: PASS; `server: 0/0 cycles`.

- [ ] **Step 3:** Commit: `git commit -am "test: brand-slice leaf-import boundary guard"`.

---

## Task 6: Docs lockstep

**Files:** `docs/rules/workspace-intelligence.md`, `FEATURE_AUDIT.md`, `data/roadmap.json`.

- [ ] **Step 1:** Add a `brand` row to the slice registry table in `docs/rules/workspace-intelligence.md` (interface `BrandSlice`; "Unified brand voice (authority-resolved block) + approved identity (structured + prompt block). Read-only; non-formattable; assembled on request.").
- [ ] **Step 2:** Add a `FEATURE_AUDIT.md` entry for the brand intelligence slice (P1: read-only slice, behavior-neutral). Add/refresh the `data/roadmap.json` item; run `npx tsx scripts/sort-roadmap.ts`.
- [ ] **Step 3:** Commit: `git commit -am "docs: register brand slice in workspace-intelligence + feature audit + roadmap"`.

---

## Task 7: Full verification gates (definition of done)

- [ ] Run all, expect zero errors:
```
npm run typecheck
npx vite build
npx vitest run
npm run pr-check
npm run check:circular-deps
npm run verify:feature-flags
npm run lint:hooks
npm run verify:governance
npm run verify:style-drift
npm run verify:coverage-ratchet
```
- [ ] If `vitest run` flakes on the documented component-lane OOM / EADDRINUSE, re-run the failing file in isolation to confirm it's a flake, not a regression.
- [ ] Then: independent adversarial code review (per owner mandate), fix Critical/Important, push branch, open PR into `staging`.

---

## Self-review checklist (run before executing)

1. **Spec coverage:** voice (import) ✓, identity (read-model) ✓, structured + blocks (BrandSlice) ✓, behavior-neutral (no formatter/baseSlices/formattable) ✓, cycle-safe (read-model + leaf imports + boundary test) ✓, registration lockstep (5 sites) ✓.
2. **Type consistency:** `assembleBrand` returns `Promise<BrandSlice>`; registry entry returns `{ brand: ... }`; `WorkspaceIntelligence.brand?: BrandSlice`. `identity` keys (`elevatorPitch`, `positioning`) map from deliverableTypes (`elevator_pitch`, `positioning_matrix`) via `TYPE_TO_KEY` — names consistent.
3. **Behavior-neutral caveat:** `get_workspace_intelligence` default-all gains a `brand` key — Task 7 `vitest run` will surface any MCP snapshot test; update it additively if present.

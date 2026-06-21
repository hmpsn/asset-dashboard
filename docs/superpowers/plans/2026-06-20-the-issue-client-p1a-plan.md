# The Issue — Client P1a Implementation Plan (website-native outcome capture)

> **Status:** Implementation plan — **review gate before any code.** **Date:** 2026-06-20. **Scope:** reframed P1a (website-native outcome capture) — the first P1 sub-phase. Builds on P0 (committed). Export (P1b), push (P1c), and CRM reconciliation (P3) are named but NOT planned here. **Audit note:** the `ga4-events` audit agent hit a transient socket error; GA4 grounding leans on the P0 eventConfig model (already shipped + audited) + the provenance/admin audits — re-verify GA4 event-enumeration specifics during Lane A implementation.
> For agentic workers: REQUIRED SUB-SKILL — `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Steps use `- [ ]` checkboxes; strict TDD (write-failing-test → RED → minimal-implement → GREEN → commit). Re-read the actual `shared/types/*.ts` interface before consuming it — guessed field names are the #1 silent-data-loss bug in this codebase.

**Goal.** Turn the P0 GA4 *estimate* ("~$11,000 from your tracked conversions") into a *measured, client-verifiable* outcome ("23 form fills · 41 calls, tracked on your site") sourced entirely from the website + analytics the agency already accesses — GA4 key-events the operator pins + Webflow form-submission named leads via a signed webhook — with **no CRM** (deferred to P3).

**Architecture.** P1a adds a third provenance tier `measured_action` between P0's `estimate_ga4` and P3's `actual_reconciled`, plus event-type classification (form/call/booking) and a Webflow-form-webhook capture substrate (`form_submissions` table + HMAC-verified receiver). The reframed behavior reuses the shipped P0 substrate — `OutcomeProvenance`, `IssueVerdict`/`IssueOutcomeCount`, `ga4_conversion_snapshots`, `computeROI().outcomeVerdict`, `eventConfig` pinning, `resolveSegmentProfile`, the public ROI/workspace payloads — and is gated behind one new flag so the OFF path is **byte-identical** to P0. The dollar math never changes (count × client lead value stays an estimate); `measured_action` graduates the *count's* confidence, not the dollar.

**Tech stack.** React 19 + Vite 8 + TailwindCSS 4 (frontend); Express + TypeScript + better-sqlite3 WAL (backend); Zod v3 validation; React Query data layer; Pino logging; Vitest (unit/integration/contract/component) + Playwright (E2E); feature flags via `shared/types/feature-flags.ts` + `isFeatureEnabled`/`useFeatureFlag`.

---

## ⬛ FEASIBILITY VERDICT (from the audit — do NOT build on a false assumption)

| Capability | Verdict | What this plan therefore builds |
|---|---|---|
| **Site auto-instrumentation (GTM / custom-code / script inject)** | ❌ **NOT FEASIBLE / NOT BUILT.** Audit: *"Zero auto-injection capability… the platform reads and displays GA4 conversions; the operator manually ensures the client has instrumented GA4 events."* | **Operator-guided consumption only.** GA4 `measured_action` is earned when the admin **pins `eventConfig` events and maps each to an outcome type** (the guided setup) + sets `conversionTrackingConfirmedAt`. **No GTM / script-inject / custom-code module is created.** |
| **Webflow form-lead capture** | ✅ **FEASIBLE — with *manual* webhook registration.** Audit: *"Feasible with manual webhook registration. Existing Webflow client + OAuth token cover API auth. New webhook receiver (~200 LOC), form_submissions table… straightforward. Operator burden: clients manually enable webhook in Webflow UI."* | A `form_submissions` table + idempotent typed store, an **HMAC-verified webhook receiver** (`X-Webflow-Signature`), named-lead capture, GA4↔captured reconciliation count. The admin enables the webhook in Webflow's Designer UI (we render a copyable URL + secret); **no programmatic registration / OAuth-app install.** |
| **Webflow Forms API *polling* (`GET /forms/{id}/submissions`)** | ⏭️ **Deferred follow-up.** The webhook-push path covers real-time named-lead capture without a cron. | **Not built.** Listed as a roadmap redundancy/backfill item. |
| **Named-lead click-through ("clickable to actual named inquiries")** | ⚠️ Discovery spec wanted it; absent even in P0. | P1a **captures and stores** the named leads (admin-only/PII-internal) and graduates the affordance copy to "names captured." The public client-facing *click-through to names* is **deferred to P1b** (the names are PII and never ride the public payload at P1a). |

**The plan reflects the guided-consumption reality:** GA4 measured tier = operator-pinned typed events (not auto-detected, not script-injected); Webflow capture = signed webhook receiver the operator points at us (not auto-registered).

---

## ⬛ DECISION REGISTER (owner-ratified, 2026-06-20)

| # | Decision | Rationale / consequence |
|---|---|---|
| D1 | **CRM/HubSpot reconciliation deferred to P3.** `actual_reconciled` stays P3; the `'crm'` source value + `revenueClosedWon` are **not** shipped. | P1a is website-native only. Lane D adds negative assertions that no P3 field leaks into the P1a payload. |
| D2 | **Capture from website + analytics only.** GA4 key-events (operator-pinned, typed) + Webflow form leads (signed webhook). No call-tracking/DNI (the `'call_tracking'` source value is reserved, not integrated). | Honors both audit feasibility boundaries. |
| D3 | **`measured_action` is the P1a provenance tier** — ordered **between** `estimate_ga4` and `actual_reconciled`. A real website action we measured; stronger than an estimate, not yet revenue-reconciled. The **count** renders exact + "tracked on your site"; the **dollar** stays banded (still count × lead value). | The third tier between the two shipped tiers. |
| D4 | **P1a = capture · P1b = export · P1c = push.** P1b (board one-pager from `exportProfile`), P1c (SMS/email return-hook via the declared `the-issue-client-return-hook` flag), P3 (CRM) are out of P1a. | One phase = one PR. |
| D5 | **New dedicated flag `the-issue-client-measured-capture`** (default OFF). The pre-existing `the-issue-client-reconciliation` flag is **reserved for P3** (CRM/call-tracking → `actual_reconciled`); its `removalCondition` text is edited to say so in the same commit. | Avoids a misleadingly-named flag gating P1a and a future flag collision when `actual_reconciled` ships. Lane D owns flag-catalog mechanics; the `reconciliation` text edit is pre-committed with Lane A. |
| D6 | **Provenance graduates only on *confirmed* setup.** `selectOutcomeProvenance(ws)` returns `measured_action` only when the flag is ON **and** the workspace has confirmed conversion-tracking setup (`conversionTrackingConfirmedAt` set, i.e. ≥1 pinned typed event) **or** ≥1 captured `form_submission` in the period; else `estimate_ga4`. | The platform must never claim "measured" the instant the flag flips, before the operator has instrumented and pinned real events. |
| D7 | **PII is internal.** `leadName`/`leadEmail`/`leadMessage` + the webhook secret live ONLY in their tables/columns and are **never** serialized into any public/client payload. Only anonymous **counts** ride the public ROI payload. | Enforced by leakage-assertion tests on the public read path. |

---

## ⬛ TASK DEPENDENCY GRAPH

```
                         Lane A  (dependency root — contracts + capture substrate + flag)
                         ───────────────────────────────────────────────────────────────
   A0 flag ─▶ A1 provenance ─▶ A2 event-type ─▶ A3 Webflow lead types ─▶ A4 form_submissions store
                  │                  │                                          │
                  └──────────────────┴───────────▶ A5 eventConfig.outcomeType ─┤
                                                                                ▼
                                              A6 webhook receiver (needs A3+A4) ─▶ A7 computeROI seam
                                                                                       (needs A1+A2+A5)
                                                                                       ▼
                                                                          A8 public payload + reconciliation
                                                                                       ▼
                                                                          A9 flag-OFF byte-identical guard
                                                                                       │
                  ╔══════════════ Lane A pre-dispatch GREEN gate ═══════════════════════╝
                  ║   typecheck && vite build && vitest run  (ALL of Lane A merged + green)
                  ▼
        ┌─────────────────────────┬──────────────────────────────┐
        ▼                         ▼                              (D writes RED tests alongside A,
   Lane B (client render)    Lane C (admin setup flow)            but its GREEN depends on A/B/C)
   typed units +             lead-type mapping UI +
   measured labeling         webhook connect UI +
        │                    verification readout
        └────────────┬───────────────┘
                     ▼
                 Lane D  (flag + acceptance/contract tests + DOM-probe + verification rollup)
                 — runs throughout (RED with A), final GREEN + rollup gate LAST
```

**Rule:** Lanes B/C/D-GREEN do not start until Lane A's pre-dispatch commit is green. B and C run in **parallel** (disjoint files). D's flag + contract tests ship **with** Lane A's pre-dispatch commit; D's remaining tests go RED with A and turn GREEN as B/C land; D's verification rollup is the final gate.

---

## ⬛ EXCLUSIVE FILE OWNERSHIP

| Lane | Owns (exclusive — no other lane edits these) |
|---|---|
| **A** | `shared/types/outcome-tracking.ts`, `shared/types/the-issue.ts`, `shared/types/roi.ts`, `shared/types/workspace.ts` (the `EventDisplayConfig.outcomeType` + `FormCaptureConfig` + secret/mapping field adds), `shared/types/form-submission.ts` **(NEW)**, `server/roi.ts`, `server/the-issue-outcome.ts`, `server/form-submissions.ts` **(NEW)**, `server/webflow-form-webhook.ts` **(NEW: pure verify/parse helpers)**, `server/schemas/workspace-schemas.ts` (the `eventDisplayConfigSchema.outcomeType` + `formCaptureConfigSchema` adds), `server/ws-events.ts` (new event constant), `server/activity-log.ts` (new `ActivityType`), `server/db/migrations/148-form-submissions.sql` **(NEW)**, `server/db/migrations/149-workspace-form-capture.sql` **(NEW)**, `server/serializers/client-safe.ts` (the `formCaptureConnected` boolean exposure), `server/workspaces.ts` (the six-site column lockstep + `updateWorkspace` Pick widening). **Edits `shared/types/feature-flags.ts` ONLY for the `the-issue-client-reconciliation` text edit, co-committed with Lane D's flag add.** |
| **B** | `src/utils/formatNumbers.ts`, `src/components/client/the-issue/outcomeProvenance.ts` **(NEW)**, `src/components/client/the-issue/OutcomeCountBand.tsx`, `src/components/client/the-issue/IssueVerdictHeadline.tsx`, `tests/unit/format-measured.test.ts` **(NEW)**, `tests/unit/outcome-provenance-render.test.ts` **(NEW)**, `tests/component/OutcomeCountBand.test.tsx` (extend), `tests/component/IssueVerdictHeadline.test.tsx` (extend). |
| **C** | `src/components/settings/ClientDashboardTab.tsx`, `server/routes/the-issue-conversion-tracking.ts` **(NEW: webhook receiver route + admin status/enable endpoints)**, `server/app.ts` (mount the raw-body webhook + the admin router), `src/api/conversionTracking.ts` **(NEW: typed fetch wrapper)**, plus its own `tests/component/conversion-tracking-*.test.tsx` + `tests/integration/the-issue-conversion-*.test.ts`. |
| **D** | `tests/unit/the-issue-client-flags.test.ts` (extend), `tests/unit/select-outcome-provenance.test.ts` **(NEW)**, `tests/contract/the-issue-measured-capture-types.test.ts` **(NEW)**, `tests/integration/the-issue-measured-capture-roi-public.test.ts` **(NEW)**, `tests/integration/webflow-form-webhook.test.ts` **(NEW)**, `tests/integration/the-issue-outcome-typed.test.ts` **(NEW)**, `tests/integration/the-issue-conversion-tracking-setup.test.ts` **(NEW)**, `tests/component/OutcomeCountBand-measured.test.tsx` **(NEW)**, `shared/types/feature-flags.ts` (the **new** `the-issue-client-measured-capture` flag + catalog + group — **pre-committed with Lane A**), `scripts/verify/the-issue-flag-off-domprobe.ts` (extend: `measured-capture-off` scenario) + `scripts/verify/__baselines__/the-issue-measured-capture-off.html` **(NEW)**, `package.json` (script alias + roadmap item). |

**Shared-file collision resolution:** `shared/types/feature-flags.ts` is touched by both A (the `reconciliation` text edit) and D (the new flag). **D owns the file**; A hands D the one-line `removalCondition` text edit, and both land in the single pre-dispatch commit. `ClientDashboardTab.tsx` is **Lane C only** for P1a. `server/app.ts` is **Lane C only**.

---

## ⬛ MODEL ASSIGNMENTS (Anthropic ladder)

| Task class | Model | Why |
|---|---|---|
| A1, A2, A3, A5 (contract/type widening, Zod lockstep) | **Sonnet** | Mechanical, exhaustive-switch-guarded. |
| A4 (store), A7 (computeROI seam), A8 (public payload + PII boundary) | **Opus** | Data-loss-sensitive: store idempotency, the central provenance seam, the PII serialization boundary. |
| A6 (webhook receiver) | **Opus** | Security: HMAC verify, raw-body mount ordering, idempotency, PII handling. |
| A0/A9, all of Lane D | **Opus** (D-CONTRACT/D-PROVENANCE/D-ROI-PUBLIC/D-WEBHOOK), **Sonnet** (D-AGG-TYPE, D-COMPONENT, D-ADMIN, D-FLAG-OFF-PROBE) | Flag-OFF byte-identity reasoning + cross-lane handshake = Opus; fixture-shaped tests = Sonnet. |
| B-T1, B-T2 (pure functions + contract module) | **Sonnet** | Small, deterministic. |
| B-T3, B-T4 (render edits w/ StatCard prop judgment) | **Sonnet** | Local judgment on prop forwarding. |
| B-T5 (cross-lane verify + DOM probe) | **Opus** | Parity reasoning. |
| C1, C2 (UI on the 1100-line shared file — flag-OFF byte-identical judgment) | **Opus** | Highest silent-regression risk surface. |
| C3 (webhook receiver route + signature mount) | **Opus** | Security-sensitive. |
| C4, C5, C6 (admin status endpoint, connect UI, checklist/copy) | **Sonnet** | Token-grounded against frozen contracts. |

---

## ⬛ PER-PHASE ACCEPTANCE CRITERIA

**Lane A (dependency root) — every box evidence-checkable before unblocking B/C/D:**
- [ ] `measured_action` tier exists; every `OutcomeProvenance` consumer compiles (exhaustive switches surface unhandled sites); the P0 two-value test is **updated to three-value**, not left failing.
- [ ] Typed breakdown ships: `OutcomeType` + `IssueOutcomeCount.byType`/`units[].outcomeType` + `EventDisplayConfig.outcomeType`, all optional/additive, Zod lockstep.
- [ ] Webflow named-lead capture is real: `form_submissions` table (idempotent `UNIQUE(workspace_id, submission_id)`), HMAC-verified receiver, broadcast + activity, PII-internal storage. Programmatic registration + Forms-API polling explicitly deferred.
- [ ] GA4 measured tier is guided-consumption only: selected from operator-pinned typed `eventConfig` events; **no site-auto-instrumentation module exists**.
- [ ] `computeROI` selects `measured_action` per D6; `estimate_ga4` otherwise; dollar math unchanged.
- [ ] Public payload carries typed outcomes + anonymous reconciliation; **PII never leaks** (test exercises the **public** route, asserts absence of `leadEmail`/`leadName`/`webflowFormWebhookSecret`).
- [ ] Flag-OFF byte-identical: OFF selects `estimate_ga4`, emits no reconciliation/typed verdict fields, webhook receiver 404s, public payload matches P0.

**Lane B (client render):**
- [ ] Typed units render ("23 form fills · 41 calls") with type-aware icon + stable order; untyped/estimate units degrade byte-identically.
- [ ] `measured_action` headline shows EXACT dollar (no `~`) + "tracked on your site" disclosure; `estimate_ga4` stays banded.
- [ ] **No inline `provenance === …` branch in any component** — the single resolved render contract lives in `outcomeProvenance.ts` (authority-layered-fields rule).
- [ ] No purple in `src/components/client/the-issue/`; emerald for values; tokens only. No lead identity rendered (count/$ only).
- [ ] DOM probe screenshot attached (measured vs estimate side-by-side).

**Lane C (admin setup):**
- [ ] Per-pinned-event lead-type (`outcomeType`) mapping persists via the existing `eventConfig` PATCH.
- [ ] Verification readout renders ("3 events pinned · 2 typed · Webflow forms connected · last lead 2h ago").
- [ ] Webflow connect UI: Enable generates secret, renders copyable webhook URL + one-time secret, guided 3-step checklist. `requireWorkspaceAccess` (NOT `requireAuth`).
- [ ] Flag-OFF byte-identical: with the flag OFF, none of the new subsections render; the component is DOM-identical to pre-P1a HEAD.

**Lane D (flag + tests + verification):**
- [ ] New flag registered default-OFF, grouped, P1a roadmap-linked; `reconciliation` flag reserved for P3.
- [ ] Contract/provenance/public-payload/webhook/aggregation/admin/component acceptance tests all GREEN.
- [ ] No P1a→public leakage of `actual_reconciled`/`closedWonRevenue`/`crm`/`leadEmail`/`webflowFormWebhookSecret`.
- [ ] DOM-probe `measured-capture-off` baseline committed (on P0-HEAD) and passes after B lands.

---

## ⬛ CANONICAL NAMES (drift fixed — use these EXACTLY; the drafts disagreed)

The four drafts used conflicting names. These are the single source of truth for all four lanes:

| Concept | ✅ Canonical name | ❌ Rejected drift |
|---|---|---|
| P1a flag | `the-issue-client-measured-capture` | ~~`the-issue-client-reconciliation`~~ (reserved for P3) |
| Outcome-type union | `OutcomeType` exported from `shared/types/the-issue.ts` | ~~`OutcomeEventType`~~, ~~`LeadType`~~ |
| Outcome-type values | `'form_fill' \| 'call' \| 'booking' \| 'email' \| 'directions' \| 'chat' \| 'other'` | ~~`'form'`~~ (use `'form_fill'`) |
| Field on `EventDisplayConfig` | `outcomeType?: OutcomeType` | ~~`eventType`~~, ~~`leadType`~~ |
| Field on `IssueOutcomeCount.units[]` | `outcomeType?: OutcomeType` | ~~`eventType`~~ |
| Typed rollup on `IssueOutcomeCount` | `byType: OutcomeTypeBreakdown[]` | (B/C drafts omitted it) |
| Named-lead record | `FormSubmission` in `shared/types/form-submission.ts` | ~~`FormSubmissionRecord`~~ |
| Confirmation field on `Workspace` | `conversionTrackingConfirmedAt?: string` | — |
| Webhook secret field | `webflowFormWebhookSecret?: string` (admin-only) | (kept inside `FormCaptureConfig` in one draft — use the flat field for clarity + lockstep) |
| Form→type mapping | `webflowFormSources?: WebflowFormMapping[]` | ~~`webflowFormMappings`~~ |
| Provenance selector | `selectOutcomeProvenance(ws)` in `server/the-issue-outcome.ts` | — |
| Type classifier | `classifyOutcomeType(eventName, ws?)` in `server/the-issue-outcome.ts` | — |
| Public reconciliation block | `outcomeVerdict.outcomeReconciliation?: { ga4Count: number; capturedCount: number }` | — |
| Webhook route | `POST /api/public/webflow-form-webhook/:workspaceId` | ~~`/api/webhooks/webflow/form/:id`~~ |
| Admin status route | `GET /api/workspaces/:id/conversion-tracking-status` | — |
| Migration slots | **148** = `form_submissions`; **149** = `workspace-form-capture` (secret + sources + `conversion_tracking_confirmed_at`) | (147 is last shipped — verified) |
| WS event | `WS_EVENTS.FORM_SUBMISSION_CAPTURED = 'outcome:form_captured'` | inline literals (forbidden) |
| ActivityType | `'form_submission_captured'` | — |

---

# LANE A — contracts + capture substrate (dependency root)

> Lane A freezes every shared contract + the data layer. TDD per task. Typed contracts in `shared/types/` land FIRST. `parseJsonSafe`/`parseJsonSafeArray` at every JSON boundary. `createStmtCache()` for prepared statements. DB column + `rowToX` + write path + public serialization in lockstep, one commit. Broadcast + activity on the webhook write (frontend `useWorkspaceEvents` half is Lane C). No AI in Lane A (P1a is deterministic).

### Task A0 — Pre-commit the P1a flag (ships in the pre-dispatch commit, co-owned with Lane D)
See **Lane D Task D0** for the full flag spec. Lane A's only edit to `shared/types/feature-flags.ts` is the `the-issue-client-reconciliation` `removalCondition` text → "CRM/call-tracking reconciliation → `actual_reconciled` (P3); NOT P1a website capture." Both edits land in one commit. **The flag wiring contract:** `computeROI`'s provenance seam, the webhook receiver, and the admin setup flow all gate on `the-issue-client-measured-capture`, **not** `the-issue-client-spine`.

---

### Task A1 — Widen `OutcomeProvenance` with `measured_action` + update every consumer
**Files:** Modify `shared/types/outcome-tracking.ts:56-58`; create `tests/unit/outcome-provenance-measured.test.ts`.

- [ ] **RED** — `tests/unit/outcome-provenance-measured.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { OutcomeProvenance } from '../../shared/types/outcome-tracking.js';

describe('OutcomeProvenance — P1a measured_action tier', () => {
  it('admits the three phased provenance tiers in confidence order', () => {
    const tiers: OutcomeProvenance[] = ['estimate_ga4', 'measured_action', 'actual_reconciled'];
    expect(tiers).toEqual(['estimate_ga4', 'measured_action', 'actual_reconciled']);
  });
  it('measured_action is assignable wherever OutcomeProvenance is expected', () => {
    const p: OutcomeProvenance = 'measured_action';
    expect(p).toBe('measured_action');
  });
});
```
- [ ] **Run** `npx vitest run tests/unit/outcome-provenance-measured.test.ts` → **FAIL**.
- [ ] **Implement** — edit `shared/types/outcome-tracking.ts:56-58`:
```ts
export type OutcomeProvenance =
  | 'estimate_ga4'        // GA4 key-event aggregate × client lead value. Renders an "estimate" label.
  | 'measured_action'     // P1a: a real website action we measured (GA4 key-event marked as a conversion,
                          //      or a Webflow form-submission named lead). More than an estimate; not yet
                          //      revenue-reconciled. Renders "measured" + an exact count, but the DOLLAR
                          //      figure stays estimate-banded (still count × lead value).
  | 'actual_reconciled';  // P3: reconciled to call-tracking / CRM closed-won. Renders "actual".
```
- [ ] **Grep every consumer in the same commit** (paste output in PR): `grep -rn "OutcomeProvenance\|'estimate_ga4'\|provenance ===" shared/ server/ src/ tests/ --include='*.ts' --include='*.tsx'`. Confirm `server/roi.ts:362` (→ becomes a switch in A7), `IssueVerdictHeadline.tsx`/`OutcomeCountBand.tsx` (estimate-only checks — Lane B migrates them; A1 only confirms the type compiles), and any P0 two-value test → **edit it to the three-value form**, same commit.
- [ ] **Run** → **PASS**; `npm run typecheck` → **PASS** (fix any exhaustive-switch break here; never with a default that swallows the new tier).
- [ ] **Commit:** `feat(the-issue-client): add measured_action provenance tier (P1a) + update all consumers`

---

### Task A2 — Event-typed outcome breakdown on the client payload
**Files:** Modify `shared/types/the-issue.ts` (extend `IssueOutcomeCount`; add `OutcomeType` + `OutcomeTypeBreakdown`); create `tests/unit/the-issue-outcome-type.test.ts`.

- [ ] **RED** — `tests/unit/the-issue-outcome-type.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { IssueOutcomeCount, OutcomeType, OutcomeTypeBreakdown } from '../../shared/types/the-issue.js';

describe('event-typed outcome breakdown (P1a)', () => {
  it('OutcomeType admits the website-native high-intent action types', () => {
    const types: OutcomeType[] = ['form_fill', 'call', 'booking', 'email', 'directions', 'chat', 'other'];
    expect(types).toContain('form_fill');
    expect(types).toContain('call');
  });
  it('each unit carries an optional outcomeType discriminator + a byType rollup', () => {
    const c: IssueOutcomeCount = {
      units: [{ label: 'Form fills', current: 23, baseline: 9, priorPeriod: 18, eventName: 'form_submit', outcomeType: 'form_fill' }],
      byType: [{ outcomeType: 'form_fill', label: 'Form fills', current: 23, baseline: 9, priorPeriod: 18 }],
      provenance: 'measured_action',
      namedRecordsAvailable: true,
    };
    expect(c.units[0].outcomeType).toBe('form_fill');
    expect(c.byType[0].current).toBe(23);
  });
});
```
- [ ] **Run** → **FAIL**.
- [ ] **Implement** in `shared/types/the-issue.ts` (extend the existing `IssueOutcomeCount` at lines 18-28; keep `units[]`/`provenance`/`namedRecordsAvailable` byte-compatible):
```ts
/** Website-native high-intent action categories (P1a). 'other' is the honest fallback for any
 *  pinned event the admin has not mapped to a known type — never silently dropped. */
export type OutcomeType =
  | 'form_fill' | 'call' | 'booking' | 'email' | 'directions' | 'chat' | 'other';

export interface OutcomeTypeBreakdown {
  outcomeType: OutcomeType;
  label: string;
  current: number;
  baseline: number | null;
  priorPeriod: number | null;
}

export interface IssueOutcomeCount {
  units: {
    label: string;
    current: number;
    baseline: number | null;
    priorPeriod: number | null;
    eventName?: string;
    outcomeType?: OutcomeType;   // P1a: which website action this unit measures
  }[];
  /** P1a: typed rollup ("23 form fills + 41 calls"). Empty when no events carry an outcomeType. */
  byType: OutcomeTypeBreakdown[];
  provenance: OutcomeProvenance;
  namedRecordsAvailable: boolean;
}
```
> **Note:** adding the required `byType` field breaks existing `IssueOutcomeCount` constructors — A7's aggregation and Lane B's renderer must populate it; surface those as compile errors. Lane A fixes the server-side one (A7); Lane B fixes its own.
- [ ] **Run** → **PASS**; `npm run typecheck` → resolve constructor breaks per the note.
- [ ] **Commit:** `feat(the-issue-client): event-typed outcome breakdown (OutcomeType + byType) on IssueOutcomeCount (P1a)`

---

### Task A3 — Webflow named-lead contracts (`FormSubmission` + `WebflowFormMapping`)
**Files:** Create `shared/types/form-submission.ts`; create `tests/unit/form-submission-types.test.ts`.

> **PII note:** `leadName`/`leadEmail`/`leadMessage` are personal data — they live ONLY in `form_submissions` and are NEVER serialized into the public payload at P1a. This contract makes that boundary explicit.

- [ ] **RED** — `tests/unit/form-submission-types.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { FormSubmission, WebflowFormMapping } from '../../shared/types/form-submission.js';
import type { OutcomeType } from '../../shared/types/the-issue.js';

describe('Webflow named-lead contracts (P1a)', () => {
  it('FormSubmission carries the named-lead PII fields + an outcomeType', () => {
    const fs: FormSubmission = {
      id: 'fs_1', workspaceId: 'ws_1', formId: 'form_abc', submissionId: 'wf_sub_123',
      formName: 'Contact', leadName: 'Jane Doe', leadEmail: 'jane@example.com',
      leadMessage: 'Need a quote', eventName: 'form_submit', outcomeType: 'form_fill',
      submittedAt: '2026-06-19T12:00:00.000Z', capturedAt: '2026-06-19T12:00:01.000Z',
    };
    expect(fs.outcomeType).toBe('form_fill');
    expect(fs.submissionId).toBe('wf_sub_123');
  });
  it('WebflowFormMapping maps a Webflow form to an OutcomeType', () => {
    const m: WebflowFormMapping = { formId: 'form_abc', formName: 'Contact', outcomeType: 'form_fill' as OutcomeType };
    expect(m.outcomeType).toBe('form_fill');
  });
});
```
- [ ] **Run** → **FAIL**.
- [ ] **Implement** — `shared/types/form-submission.ts` (new file avoids the `the-issue.ts ↔ outcome-tracking.ts` import cycle entirely — `FormSubmission` imports `OutcomeType` from `the-issue.ts` one-way):
```ts
import type { OutcomeType } from './the-issue.js';

/** P1a: a real, named on-site form submission captured via the Webflow form webhook.
 *  PII (leadName/leadEmail/leadMessage) is stored ONLY in form_submissions and is NEVER
 *  serialized into the public ROI payload — the public count is anonymous. */
export interface FormSubmission {
  id: string;
  workspaceId: string;
  formId: string;                 // Webflow form id
  submissionId: string;           // Webflow submission id (dedup key, UNIQUE per workspace)
  formName: string;
  leadName: string | null;        // PII — admin-only
  leadEmail: string | null;       // PII — admin-only
  leadMessage: string | null;     // PII — admin-only
  eventName: string;              // mirrors the GA4 event used for reconciliation (default 'form_submit')
  outcomeType: OutcomeType;       // resolved from the workspace WebflowFormMapping; 'form_fill' default
  submittedAt: string;            // ISO — when Webflow recorded the submission
  capturedAt: string;             // ISO — when our webhook received it
}

/** Per-workspace mapping of a Webflow form to a typed outcome (admin sets this in the setup flow). */
export interface WebflowFormMapping {
  formId: string;
  formName: string;
  outcomeType: OutcomeType;
}
```
- [ ] **Run** → **PASS**; `npm run typecheck` → **PASS**.
- [ ] **Commit:** `feat(the-issue-client): FormSubmission + WebflowFormMapping named-lead contracts (P1a, PII-internal)`

---

### Task A4 — `form_submissions` migration **148** + typed store (`server/form-submissions.ts`)
**Files:** Create `server/db/migrations/148-form-submissions.sql`, `server/form-submissions.ts`; create `tests/integration/form-submissions-store.test.ts`.

> Models `server/ga4-snapshots.ts` (`createStmtCache`, `rowToX` mapper). `UNIQUE(workspace_id, submission_id)` + `INSERT OR IGNORE` makes a re-delivered webhook idempotent — never double-counts.

- [ ] **RED** — `tests/integration/form-submissions-store.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { saveFormSubmission, loadFormSubmissions, countFormSubmissions } from '../../server/form-submissions.js';

let ctx: Awaited<ReturnType<typeof createEphemeralTestContext>>; let wsId: string; let cleanup: () => void;
beforeAll(async () => { ctx = await createEphemeralTestContext(import.meta.url); const s = seedWorkspace(); wsId = s.id; cleanup = s.cleanup; });
afterAll(async () => { cleanup(); await ctx.teardown(); });

describe('form_submissions store (P1a)', () => {
  it('round-trips a named lead and is idempotent on (workspaceId, submissionId)', () => {
    const base = {
      workspaceId: wsId, formId: 'form_abc', submissionId: 'wf_sub_1', formName: 'Contact',
      leadName: 'Jane Doe', leadEmail: 'jane@example.com', leadMessage: 'Quote please',
      eventName: 'form_submit', outcomeType: 'form_fill' as const,
      submittedAt: '2026-06-19T12:00:00.000Z', capturedAt: '2026-06-19T12:00:01.000Z',
    };
    const r1 = saveFormSubmission(base);
    const r2 = saveFormSubmission(base); // duplicate webhook re-delivery
    expect(r1.inserted).toBe(true);
    expect(r2.inserted).toBe(false);
    const rows = loadFormSubmissions(wsId);
    expect(rows).toHaveLength(1);
    expect(rows[0].leadName).toBe('Jane Doe');
    expect(countFormSubmissions(wsId, { startDate: '2026-06-01', endDate: '2026-06-30' })).toBe(1);
  });
});
```
- [ ] **Run** → **FAIL**.
- [ ] **Implement migration** `148-form-submissions.sql`:
```sql
-- The Issue (Client) P1a: Webflow-native named-lead capture. One row per Webflow form submission.
-- PII (lead_name/email/message) is admin-only and NEVER serialized into the public ROI payload.
-- UNIQUE(workspace_id, submission_id) makes webhook re-delivery idempotent (no double counts).
CREATE TABLE IF NOT EXISTS form_submissions (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  form_id       TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  form_name     TEXT NOT NULL,
  lead_name     TEXT,
  lead_email    TEXT,
  lead_message  TEXT,
  event_name    TEXT NOT NULL DEFAULT 'form_submit',
  outcome_type  TEXT NOT NULL DEFAULT 'form_fill',
  submitted_at  TEXT NOT NULL,
  captured_at   TEXT NOT NULL,
  UNIQUE (workspace_id, submission_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_form_submissions_ws_submitted ON form_submissions(workspace_id, submitted_at);
```
- [ ] **Implement** `server/form-submissions.ts` (`createStmtCache`, `rowToFormSubmission`, `INSERT OR IGNORE` reporting `inserted` from `res.changes`):
```ts
import { randomUUID } from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import type { FormSubmission } from '../shared/types/form-submission.js';
import type { OutcomeType } from '../shared/types/the-issue.js';

interface FormSubmissionRow {
  id: string; workspace_id: string; form_id: string; submission_id: string; form_name: string;
  lead_name: string | null; lead_email: string | null; lead_message: string | null;
  event_name: string; outcome_type: string; submitted_at: string; captured_at: string;
}

const stmts = createStmtCache(() => ({
  insert: db.prepare(
    `INSERT OR IGNORE INTO form_submissions
       (id, workspace_id, form_id, submission_id, form_name, lead_name, lead_email,
        lead_message, event_name, outcome_type, submitted_at, captured_at)
     VALUES (@id, @workspace_id, @form_id, @submission_id, @form_name, @lead_name, @lead_email,
        @lead_message, @event_name, @outcome_type, @submitted_at, @captured_at)`,
  ),
  selectByWorkspace: db.prepare(`SELECT * FROM form_submissions WHERE workspace_id = ? ORDER BY submitted_at DESC`),
  countInRange: db.prepare(
    `SELECT COUNT(*) AS n FROM form_submissions
       WHERE workspace_id = ? AND submitted_at >= ? AND submitted_at <= ?`),
  status: db.prepare(
    `SELECT COUNT(*) AS n, MAX(submitted_at) AS last FROM form_submissions WHERE workspace_id = ?`),
}));

function rowTo(row: FormSubmissionRow): FormSubmission {
  return {
    id: row.id, workspaceId: row.workspace_id, formId: row.form_id, submissionId: row.submission_id,
    formName: row.form_name, leadName: row.lead_name, leadEmail: row.lead_email,
    leadMessage: row.lead_message, eventName: row.event_name,
    outcomeType: row.outcome_type as OutcomeType, submittedAt: row.submitted_at, capturedAt: row.captured_at,
  };
}

export function saveFormSubmission(s: Omit<FormSubmission, 'id'>): { inserted: boolean; id: string } {
  const id = randomUUID();
  const res = stmts().insert.run({
    id, workspace_id: s.workspaceId, form_id: s.formId, submission_id: s.submissionId,
    form_name: s.formName, lead_name: s.leadName, lead_email: s.leadEmail, lead_message: s.leadMessage,
    event_name: s.eventName, outcome_type: s.outcomeType, submitted_at: s.submittedAt, captured_at: s.capturedAt,
  });
  return { inserted: res.changes > 0, id };
}

export function loadFormSubmissions(workspaceId: string): FormSubmission[] {
  return (stmts().selectByWorkspace.all(workspaceId) as FormSubmissionRow[]).map(rowTo);
}

export function countFormSubmissions(workspaceId: string, range: { startDate: string; endDate: string }): number {
  const r = stmts().countInRange.get(workspaceId, range.startDate, `${range.endDate}T23:59:59.999Z`) as { n: number };
  return r.n;
}

/** Feeds the admin verification readout (Lane C) — count + freshness only, no PII. */
export function getFormCaptureStatus(workspaceId: string): { count: number; lastSubmissionAt: string | null } {
  const r = stmts().status.get(workspaceId) as { n: number; last: string | null };
  return { count: r.n, lastSubmissionAt: r.last };
}

/** GA4-vs-captured trust guard (A8). Counts only — never PII. */
export function reconcileFormCountVsGa4(workspaceId: string, ga4Count: number, range: { startDate: string; endDate: string }):
  { capturedCount: number; ga4Count: number; discrepancy: number } {
  const capturedCount = countFormSubmissions(workspaceId, range);
  return { capturedCount, ga4Count, discrepancy: ga4Count - capturedCount };
}
```
- [ ] **Run** → **PASS**.
- [ ] **Commit:** `feat(the-issue-client): form_submissions table (148) + idempotent typed store (P1a Webflow named-lead capture)`

---

### Task A5 — `EventDisplayConfig.outcomeType` lockstep (type + Zod)
**Files:** Modify `shared/types/workspace.ts:15-20` (`EventDisplayConfig`); modify `server/schemas/workspace-schemas.ts:15-20` (`eventDisplayConfigSchema`); create `tests/unit/event-display-config-type.test.ts`.

> Optional + additive → flag-OFF byte-identical; existing pinned events with no `outcomeType` aggregate as `'other'`. `eventConfig` is already a typed JSON column on `workspaces` — no DB column needed.

- [ ] **RED** — `tests/unit/event-display-config-type.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { eventDisplayConfigSchema } from '../../server/schemas/workspace-schemas.js';
import type { EventDisplayConfig } from '../../shared/types/workspace.js';

describe('EventDisplayConfig.outcomeType (P1a)', () => {
  it('accepts an optional outcome-type classification', () => {
    const c: EventDisplayConfig = { eventName: 'phone_call', displayName: 'Calls', pinned: true, outcomeType: 'call' };
    const parsed = eventDisplayConfigSchema.safeParse(c);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.outcomeType).toBe('call');
  });
  it('still accepts a P0 config with no outcomeType (byte-compatible)', () => {
    expect(eventDisplayConfigSchema.safeParse({ eventName: 'form_submit', displayName: 'Form fills', pinned: true }).success).toBe(true);
  });
  it('rejects an unknown outcomeType value', () => {
    expect(eventDisplayConfigSchema.safeParse({ eventName: 'x', displayName: 'X', pinned: true, outcomeType: 'teleport' }).success).toBe(false);
  });
});
```
- [ ] **Run** → **FAIL**.
- [ ] **Implement** — `shared/types/workspace.ts:15-20` (add `import type { OutcomeType } from './the-issue.ts';` grouped at top):
```ts
export interface EventDisplayConfig {
  eventName: string;
  displayName: string;
  pinned: boolean;
  group?: string;
  outcomeType?: OutcomeType;   // P1a: which website action this pinned event measures
}
```
  `server/schemas/workspace-schemas.ts:15-20`:
```ts
export const eventDisplayConfigSchema = z.object({
  eventName: z.string(),
  displayName: z.string(),
  pinned: z.boolean(),
  group: z.string().optional(),
  outcomeType: z.enum(['form_fill', 'call', 'booking', 'email', 'directions', 'chat', 'other']).optional(),
}).passthrough();
```
- [ ] **Run** → **PASS**; `npm run typecheck` → **PASS**.
- [ ] **Commit:** `feat(the-issue-client): EventDisplayConfig.outcomeType classification + Zod lockstep (P1a)`

---

### Task A6 — Webflow form webhook receiver (HMAC-verified) + named-lead read path + broadcast
**Files:** Create `server/webflow-form-webhook.ts` (pure helpers); create `server/db/migrations/149-workspace-form-capture.sql`; modify `shared/types/workspace.ts` + `server/workspaces.ts` (column lockstep) + `server/ws-events.ts` + `server/activity-log.ts` + `server/serializers/client-safe.ts`. **The route + `app.ts` mount are Lane C (Task C3)** — Lane A ships the pure verify/parse helpers + the store + the workspace fields the route consumes. Create `tests/unit/webflow-form-webhook-helpers.test.ts`.

> Splitting helpers (A6, testable without a server) from the route (C3, mounted with `express.raw` before `express.json` like the Stripe webhook at `app.ts:180`) keeps file ownership clean and the security logic unit-testable.

- [ ] **RED** — `tests/unit/webflow-form-webhook-helpers.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifyWebflowSignature, parseWebflowFormPayload, resolveOutcomeType } from '../../server/webflow-form-webhook.js';

const SECRET = 'whsec_test_123';
const sign = (b: string) => crypto.createHmac('sha256', SECRET).update(b).digest('hex');

describe('webflow form webhook helpers (P1a)', () => {
  it('verifies a valid HMAC-SHA256 signature, rejects a bad one (timing-safe)', () => {
    const body = JSON.stringify({ triggerType: 'form_submission', payload: { id: 'x' } });
    expect(verifyWebflowSignature(body, sign(body), SECRET)).toBe(true);
    expect(verifyWebflowSignature(body, 'deadbeef', SECRET)).toBe(false);
  });
  it('parses a form_submission payload, tolerant of field casing; returns null on non-form trigger', () => {
    const ok = parseWebflowFormPayload({ triggerType: 'form_submission', payload: {
      formId: 'form_abc', name: 'Contact', id: 'wf_sub_99', submittedAt: '2026-06-19T12:00:00.000Z',
      data: { Name: 'Jane Doe', Email: 'jane@example.com', Message: 'Quote please' } } });
    expect(ok?.leadName).toBe('Jane Doe');
    expect(ok?.submissionId).toBe('wf_sub_99');
    expect(parseWebflowFormPayload({ triggerType: 'site_publish', payload: {} })).toBeNull();
  });
  it('resolves outcome type from the workspace mapping; defaults to form_fill for an unmapped form', () => {
    const ws: any = { webflowFormSources: [{ formId: 'form_abc', formName: 'Contact', outcomeType: 'booking' }] };
    expect(resolveOutcomeType(ws, 'form_abc', 'Contact')).toBe('booking');
    expect(resolveOutcomeType(ws, 'form_zzz', 'Other')).toBe('form_fill');
  });
});
```
- [ ] **Run** → **FAIL**.
- [ ] **Implement** `server/webflow-form-webhook.ts` — `verifyWebflowSignature(rawBody, signature, secret): boolean` (length-check then `crypto.timingSafeEqual`); `parseWebflowFormPayload(json): { formId, formName, submissionId, submittedAt, leadName, leadEmail, leadMessage } | null` (local Zod schema; `null` on non-`form_submission` trigger or malformed body; field extraction tolerant of `Name`/`name`/`Full Name`, `Email`/`email`); `resolveOutcomeType(ws, formId, formName): OutcomeType` (reads `ws.webflowFormSources`; defaults `'form_fill'`).
- [ ] **Implement migration** `149-workspace-form-capture.sql`:
```sql
-- The Issue (Client) P1a: Webflow form-capture config on workspaces.
ALTER TABLE workspaces ADD COLUMN webflow_form_webhook_secret TEXT;             -- admin-only; signs X-Webflow-Signature
ALTER TABLE workspaces ADD COLUMN webflow_form_sources TEXT;                    -- JSON: WebflowFormMapping[]
ALTER TABLE workspaces ADD COLUMN conversion_tracking_confirmed_at TEXT;        -- ISO; set by the admin setup flow
```
- [ ] **Implement the workspace lockstep** (six sites in `server/workspaces.ts`: `WorkspaceRow`, `rowToWorkspace`, `workspaceToParams`, `columnMap`, the `updateWorkspace` Pick union widened with `'webflowFormWebhookSecret' | 'webflowFormSources' | 'conversionTrackingConfirmedAt'`) + the `shared/types/workspace.ts` `Workspace`/`AdminWorkspaceView` fields: `webflowFormWebhookSecret?: string` (admin-only, like `webflowToken`), `webflowFormSources?: WebflowFormMapping[]` (parsed via `parseJsonSafeArray` at the read boundary), `conversionTrackingConfirmedAt?: string`. **Secret + sources + PII NEVER serialized into any public/client payload.**
- [ ] **Add** `WS_EVENTS.FORM_SUBMISSION_CAPTURED = 'outcome:form_captured'` to `server/ws-events.ts` (near the `OUTCOME_*` block) and the `'form_submission_captured'` `ActivityType` to `server/activity-log.ts`.
- [ ] **Add** the client-safe `formCaptureConnected: boolean` to `server/serializers/client-safe.ts` (`!!ws.conversionTrackingConfirmedAt || !!ws.webflowFormWebhookSecret`), gated on the spine flag — mirrors the `segmentProfile` flag-gated attach at `:97`. Never the secret, never PII.
- [ ] **Run** → **PASS**; `npm run typecheck` → **PASS**.
- [ ] **Commit:** `feat(the-issue-client): Webflow webhook helpers (HMAC verify/parse/resolve) + form-capture workspace lockstep (149) (P1a)`

---

### Task A7 — `measured_action` selection in `computeROI().outcomeVerdict` + typed aggregation
**Files:** Modify `server/roi.ts` (replace the hard-coded `provenance` at `:362` with `selectOutcomeProvenance`; populate `outcomeTypeBreakdown`); modify `server/the-issue-outcome.ts` (add `selectOutcomeProvenance`, `classifyOutcomeType`; extend `aggregatePinnedOutcomes` to carry `outcomeType` + build `byType`); modify `shared/types/roi.ts:56-65` (add `outcomeTypeBreakdown?` — `provenance` already accepts the widened union). Create `tests/integration/compute-roi-measured-action.test.ts`.

> The dollar `estimatedValue` math (count × lead value) is unchanged — `measured_action` graduates the *count*'s confidence, not the dollar.

- [ ] **RED** — `tests/integration/compute-roi-measured-action.test.ts` (flag ON, a pinned typed event, a GA4 snapshot; companion case: flag OFF → `estimate_ga4`, feeds A9):
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { computeROI } from '../../server/roi.js';
import { saveGa4Snapshot } from '../../server/ga4-snapshots.js';
import { updateWorkspace } from '../../server/workspaces.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';

let ctx: Awaited<ReturnType<typeof createEphemeralTestContext>>; let wsId: string; let cleanup: () => void;
beforeAll(async () => {
  ctx = await createEphemeralTestContext(import.meta.url); const s = seedWorkspace(); wsId = s.id; cleanup = s.cleanup;
  setWorkspaceFlagOverride('the-issue-client-spine', wsId, true);
  setWorkspaceFlagOverride('the-issue-client-measured-capture', wsId, true);
  updateWorkspace(wsId, {
    outcomeValue: { valuePerOutcome: 800, unitLabel: 'new patient', currency: 'USD', basis: 'agency_estimate', monthlyRetainer: 1500 },
    eventConfig: [{ eventName: 'form_submit', displayName: 'Form fills', pinned: true, outcomeType: 'form_fill' }],
    conversionTrackingConfirmedAt: new Date().toISOString(),
  });
  saveGa4Snapshot({ workspaceId: wsId, capturedAt: new Date().toISOString(), totalConversions: 23, totalUsers: 300,
    byEvent: [{ eventName: 'form_submit', conversions: 23, users: 200, rate: 7 }] });
});
afterAll(async () => {
  setWorkspaceFlagOverride('the-issue-client-spine', wsId, null);
  setWorkspaceFlagOverride('the-issue-client-measured-capture', wsId, null);
  cleanup(); await ctx.teardown();
});

describe('computeROI outcomeVerdict — measured_action (P1a)', () => {
  it('selects measured_action when pinned events carry an outcomeType + setup confirmed', () => {
    const roi = computeROI(wsId)!;
    expect(roi.outcomeVerdict?.provenance).toBe('measured_action');
    expect(roi.outcomeVerdict?.outcomeCount).toBe(23);
    expect(roi.outcomeVerdict?.outcomeTypeBreakdown?.[0].outcomeType).toBe('form_fill');
  });
});
```
- [ ] **Run** → **FAIL**.
- [ ] **Implement** in `server/the-issue-outcome.ts`:
```ts
export function classifyOutcomeType(eventName: string, ws?: Workspace): OutcomeType {
  const pinned = ws?.eventConfig?.find((c) => c.eventName === eventName && c.pinned);
  if (pinned?.outcomeType) return pinned.outcomeType;            // admin override wins
  const n = eventName.toLowerCase();
  if (/call|phone/.test(n)) return 'call';
  if (/form|lead|contact|submit/.test(n)) return 'form_fill';
  if (/book|appoint|schedul|reserv/.test(n)) return 'booking';
  if (/email|mailto/.test(n)) return 'email';
  if (/direction|map/.test(n)) return 'directions';
  if (/chat|message/.test(n)) return 'chat';
  return 'other';
}

export function selectOutcomeProvenance(ws: Workspace, periodFormCount: number): OutcomeProvenance {
  if (!isFeatureEnabled('the-issue-client-measured-capture', ws.id)) return 'estimate_ga4';
  const hasConfirmedTypedSetup = !!ws.conversionTrackingConfirmedAt
    && (ws.eventConfig ?? []).some((c) => c.pinned && c.outcomeType);
  if (hasConfirmedTypedSetup || periodFormCount > 0) return 'measured_action';
  return 'estimate_ga4';
}
```
  Extend `aggregatePinnedOutcomes` to stamp each unit's `outcomeType` (via `classifyOutcomeType(eventName, ws)`) and build `byType: OutcomeTypeBreakdown[]` (group units by `outcomeType`, sum `current`; `baseline`/`priorPeriod` filled by the existing baseline path). The no-pinned fallback returns an empty `byType`.
  In `server/roi.ts`, replace `const provenance: OutcomeProvenance = 'estimate_ga4';` (`:362`) with `periodFormCount = countFormSubmissions(ws.id, currentPeriodRange)` (reuse the window `computeROI` already uses for the GA4 snapshot lookup) then `const provenance = selectOutcomeProvenance(ws, periodFormCount);` and set `result.outcomeVerdict.outcomeTypeBreakdown = agg.byType;`. `estimatedValue` unchanged.
  Add to `shared/types/roi.ts` `outcomeVerdict`: `outcomeTypeBreakdown?: OutcomeTypeBreakdown[];` (import from `the-issue.ts`).
- [ ] **Run** → **PASS** (measured_action ON + estimate_ga4 OFF cases).
- [ ] **Commit:** `feat(the-issue-client): select measured_action provenance + typed byType rollup in computeROI (P1a)`

---

### Task A8 — Public payload: typed outcomes + anonymous reconciliation count (no PII)
**Files:** Modify `server/roi.ts` (add `outcomeReconciliation` to `outcomeVerdict` when flag ON); modify `shared/types/roi.ts`; create `tests/integration/the-issue-roi-public-measured.test.ts`.

> `GET /api/public/roi/:workspaceId` returns `computeROI()` whole — A7 already put `provenance`/`outcomeTypeBreakdown` on it, so the client gets the typed breakdown for free. A8 adds the **reconciliation count** + asserts PII never leaks. Test exercises the **public** route.

- [ ] **RED** — `tests/integration/the-issue-roi-public-measured.test.ts` (seed: flag ON, `outcomeValue`, a typed pinned event, a GA4 snapshot of 23 `form_submit`, 2 stored `form_submissions` with `leadName`/`leadEmail`):
```ts
it('public ROI payload carries typed measured outcomes + anonymous reconciliation, never PII', async () => {
  const res = await api(`/api/public/roi/${wsId}`);
  expect(res.status).toBe(200);
  const raw = await res.text();
  const roi = JSON.parse(raw);
  expect(roi.outcomeVerdict.provenance).toBe('measured_action');
  expect(roi.outcomeVerdict.outcomeTypeBreakdown[0].outcomeType).toBe('form_fill');
  expect(roi.outcomeVerdict.outcomeReconciliation.ga4Count).toBe(23);
  expect(roi.outcomeVerdict.outcomeReconciliation.capturedCount).toBe(2);
  expect(raw).not.toContain('jane@example.com');               // PII boundary
  expect(raw).not.toMatch(/leadName|leadEmail|leadMessage|webflowFormWebhookSecret/);
});
```
- [ ] **Run** → **FAIL**.
- [ ] **Implement** in `server/roi.ts` — inside the `outcomeVerdict` hydration, when `isFeatureEnabled('the-issue-client-measured-capture', ws.id)`:
```ts
result.outcomeVerdict.outcomeReconciliation = {
  ga4Count: agg.totalConversions,                                   // anonymous aggregate
  capturedCount: countFormSubmissions(ws.id, currentPeriodRange),   // named-lead COUNT only — no names
  // named-lead PII stays in form_submissions; only the count rides the public payload
};
```
  Add to `shared/types/roi.ts` `outcomeVerdict`:
```ts
/** P1a: anonymous reconciliation counts for the trust-guard discrepancy surface. Counts only — never PII. */
outcomeReconciliation?: { ga4Count: number; capturedCount: number };
```
  **Verify the boundary:** `loadFormSubmissions` (returns names) is never called from `computeROI` or any public serializer — only `countFormSubmissions`.
- [ ] **Run** → **PASS**.
- [ ] **Commit:** `feat(the-issue-client): anonymous reconciliation count on public ROI payload + PII-boundary test (P1a)`

---

### Task A9 — Flag-OFF byte-identical guard
**Files:** Create `tests/integration/the-issue-p1a-flag-off.test.ts`.

> With only `the-issue-client-spine` ON and `the-issue-client-measured-capture` OFF, every Lane A change is unread: `computeROI` selects `estimate_ga4`, no `outcomeReconciliation`, the webhook route 404s, the public payload matches P0.

- [ ] **RED** — `tests/integration/the-issue-p1a-flag-off.test.ts` (seed spine ON, measured-capture OFF, `outcomeValue`, a GA4 snapshot, AND a pinned typed event + a stored `form_submission` to prove OFF ignores P1a data):
```ts
it('P1a OFF: computeROI selects estimate_ga4 and emits no P1a reconciliation/typed-verdict fields', () => {
  const roi = computeROI(wsId)!;
  expect(roi.outcomeVerdict?.provenance).toBe('estimate_ga4');
  expect(roi.outcomeVerdict?.outcomeReconciliation).toBeUndefined();
});
it('P1a OFF: the Webflow webhook receiver is inert (404), captures nothing', async () => {
  const body = JSON.stringify({ triggerType: 'form_submission', payload: { formId: 'f', id: 'wf_off_1', data: {} } });
  const res = await api(`/api/public/webflow-form-webhook/${wsId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webflow-Signature': 'whatever' }, body });
  expect(res.status).toBe(404);
});
```
- [ ] **Run** → **FAIL** until A6/A7/A8/C3 gate on the flag correctly; iterate until both pass (the route 404 case depends on Lane C's C3 mount — if Lane A runs before C3 lands, mark this assertion `it.todo` and convert it in C3's commit; the `computeROI` assertion is fully Lane A and must pass at the pre-dispatch gate).
- [ ] **Run** → **PASS**; `npm run typecheck && npx vite build && npx vitest run` → **GREEN** (full suite — the pre-dispatch gate that unblocks B/C/D).
- [ ] **Commit:** `test(the-issue-client): P1a flag-OFF byte-identical guard (computeROI estimate_ga4 + receiver inert)`

---

# LANE B — client surface: typed outcomes + measured labeling

> Pure-render lane. No DB, no endpoints, no broadcasts, no AI. All numbers/types/provenance arrive server-assembled from Lane A on `IssueVerdict`/`IssueOutcomeCount`/`ROIData.outcomeVerdict`. Gated by the shipped `the-issue-client-spine` flag; flag-OFF stays byte-identical. **Authority-layered-fields rule:** the provenance→label/precision mapping lives ONLY in `outcomeProvenance.ts` — components import the resolved object, never branch on `provenance ===` inline. No purple; emerald for values; tokens only. No lead identity rendered (count/$ only).

**HARD dependency:** do not start before Lane A's pre-dispatch commit is green (B imports `OutcomeProvenance += measured_action`, `OutcomeType`, `units[].outcomeType`). RED tests fail to *compile* if the names don't exist yet — that is the intended gate.

### Task B-T1 — `fmtMeasuredMoney` + provenance money selector
**Files:** Modify `src/utils/formatNumbers.ts`; create `tests/unit/format-measured.test.ts`.

- [ ] **RED** — `tests/unit/format-measured.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { fmtMeasuredMoney, fmtOutcomeMoney } from '../../src/utils/formatNumbers';

describe('fmtMeasuredMoney (exact, measured-labeled)', () => {
  it('exact whole dollars, no ~ band, no cents', () => {
    expect(fmtMeasuredMoney(11_234)).toBe('$11,234');
    expect(fmtMeasuredMoney(1_499)).toBe('$1,499');
  });
  it('renders $0 honestly, guards non-finite to em-dash', () => {
    expect(fmtMeasuredMoney(0)).toBe('$0');
    expect(fmtMeasuredMoney(Number.NaN)).toBe('—');
  });
});
describe('fmtOutcomeMoney (provenance-driven selector)', () => {
  it('estimate_ga4 → banded ~ estimate', () => { expect(fmtOutcomeMoney(11_234, 'estimate_ga4')).toBe('~$11,000'); });
  it('measured_action → exact', () => { expect(fmtOutcomeMoney(11_234, 'measured_action')).toBe('$11,234'); });
  it('actual_reconciled → exact (P3-ready)', () => { expect(fmtOutcomeMoney(11_234, 'actual_reconciled')).toBe('$11,234'); });
});
```
- [ ] **Run** → **RED**.
- [ ] **GREEN** — add to `src/utils/formatNumbers.ts` (after `fmtEstimateRatio`), with `import type { OutcomeProvenance } from '../../shared/types/outcome-tracking';` at the top:
```ts
/** Measured-action money: EXACT figure (we measured the real on-site actions), whole dollars, no ~ band. */
export function fmtMeasuredMoney(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return fmtMoneyFull(value);
}
/** The SINGLE place that maps an OutcomeProvenance → its money formatter. */
export function fmtOutcomeMoney(value: number, provenance: OutcomeProvenance): string {
  return provenance === 'estimate_ga4' ? fmtEstimateMoney(value) : fmtMeasuredMoney(value);
}
```
- [ ] **Run** → **GREEN**. **Commit:** `Lane B T1 — fmtMeasuredMoney + fmtOutcomeMoney provenance precision selector`

### Task B-T2 — the provenance render contract module
**Files:** Create `src/components/client/the-issue/outcomeProvenance.ts`; create `tests/unit/outcome-provenance-render.test.ts`.

- [ ] **RED** — `tests/unit/outcome-provenance-render.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { resolveProvenanceRender } from '../../src/components/client/the-issue/outcomeProvenance';

describe('resolveProvenanceRender', () => {
  it('estimate_ga4 → estimate label, banded money, estimate disclosure', () => {
    const r = resolveProvenanceRender('estimate_ga4');
    expect(r.qualifier).toMatch(/estimate/i); expect(r.isExact).toBe(false);
    expect(r.fmtMoney(11_234)).toBe('~$11,000'); expect(r.disclosure(800)).toMatch(/estimate/i);
  });
  it('measured_action → "tracked on your site", exact money, measured disclosure (NOT estimate language)', () => {
    const r = resolveProvenanceRender('measured_action');
    expect(r.qualifier).toMatch(/tracked on your site/i); expect(r.isExact).toBe(true);
    expect(r.fmtMoney(11_234)).toBe('$11,234');
    expect(r.disclosure(800)).toMatch(/measured/i); expect(r.disclosure(800)).not.toMatch(/estimate/i);
  });
  it('actual_reconciled → exact, "actual", no estimate language (P3-ready)', () => {
    const r = resolveProvenanceRender('actual_reconciled');
    expect(r.isExact).toBe(true); expect(r.fmtMoney(11_234)).toBe('$11,234'); expect(r.qualifier).not.toMatch(/estimate/i);
  });
});
```
- [ ] **Run** → **RED**.
- [ ] **GREEN** — `src/components/client/the-issue/outcomeProvenance.ts`:
```ts
import type { OutcomeProvenance } from '../../../../shared/types/outcome-tracking';
import { fmtEstimateMoney, fmtMeasuredMoney } from '../../../utils/formatNumbers';

export interface ProvenanceRender {
  qualifier: string;                 // "estimate" | "tracked on your site" | "actual"
  isExact: boolean;                  // true → no ~ band
  fmtMoney: (value: number) => string;
  disclosure: (valuePerOutcome: number) => string;
}

export function resolveProvenanceRender(provenance: OutcomeProvenance): ProvenanceRender {
  switch (provenance) {
    case 'measured_action':
      return { qualifier: 'tracked on your site', isExact: true, fmtMoney: fmtMeasuredMoney,
        disclosure: (v) => `Measured from real actions on your site — your tracked conversions valued at ${fmtMeasuredMoney(v)} each.` };
    case 'actual_reconciled':
      return { qualifier: 'actual', isExact: true, fmtMoney: fmtMeasuredMoney,
        disclosure: (v) => `Reconciled to your closed records — valued at ${fmtMeasuredMoney(v)} each.` };
    case 'estimate_ga4':
    default:
      return { qualifier: 'estimate', isExact: false, fmtMoney: fmtEstimateMoney,
        disclosure: (v) => `This is an estimate — your tracked conversions valued at ${fmtEstimateMoney(v)} each.` };
  }
}
```
- [ ] **Run** → **GREEN**. **Commit:** `Lane B T2 — outcomeProvenance render contract (single resolved label/precision/disclosure)`

### Task B-T3 — typed outcome units in `OutcomeCountBand` (icon + ordering + measured band)
**Files:** Modify `src/components/client/the-issue/OutcomeCountBand.tsx`; modify `tests/component/OutcomeCountBand.test.tsx`.

> Renders typed StatCards with a type→icon map + stable type order; degrades byte-identically when `outcomeType` is absent. **Read `src/components/ui/StatCard.tsx` first** (read-before-write) to confirm it forwards `icon` + spreads `data-*`; if not, wrap each card in a `<div data-outcome-type=…>` — the test asserts the attribute, not which element carries it.

- [ ] **RED** — append to `tests/component/OutcomeCountBand.test.tsx`: a `typedCount` fixture with `units` carrying `outcomeType: 'form_fill'` / `'call'`, `provenance: 'measured_action'`, `byType: [...]`, `namedRecordsAvailable: false`. Assert: each typed unit renders its label + count; `[data-outcome-type="form_fill"]` and `[data-outcome-type="call"]` present; honest names affordance retained; an untyped `estimate_ga4` unit renders label-only with **no** `[data-outcome-type]` (byte-identical degradation).
```ts
const typedCount: IssueOutcomeCount = {
  units: [
    { label: 'form fills', current: 23, baseline: 10, priorPeriod: 18, eventName: 'form_submit', outcomeType: 'form_fill' },
    { label: 'calls', current: 41, baseline: 22, priorPeriod: 39, eventName: 'phone_call', outcomeType: 'call' },
  ],
  byType: [
    { outcomeType: 'form_fill', label: 'form fills', current: 23, baseline: 10, priorPeriod: 18 },
    { outcomeType: 'call', label: 'calls', current: 41, baseline: 22, priorPeriod: 39 },
  ],
  provenance: 'measured_action', namedRecordsAvailable: false,
};
```
- [ ] **Run** → **RED**.
- [ ] **GREEN** — in `OutcomeCountBand.tsx`: replace the single-icon import with the type-icon set (`PhoneCall, FileText, CalendarCheck, Mail, MapPin, MessageSquare, Activity` from `lucide-react`) + `import type { OutcomeType } from '../../../../shared/types/the-issue';` (top). Add a `TYPE_ICON: Record<OutcomeType, ...>` map + `TYPE_ORDER: OutcomeType[]` + a `typeRank(t?)` (untyped sort last). Sort `[...count.units]` by `typeRank` and tag each card with the type icon + `data-outcome-type={unit.outcomeType ?? undefined}`. Type icons use `text-[var(--brand-text-muted)]` (never a new hue); values stay `text-accent-success` (emerald).
- [ ] **Run** → **GREEN**. **Commit:** `Lane B T3 — OutcomeCountBand renders typed units (icon + stable order) with honest untyped degradation`

### Task B-T4 — measured branch in `IssueVerdictHeadline`
**Files:** Modify `src/components/client/the-issue/IssueVerdictHeadline.tsx`; modify `tests/component/IssueVerdictHeadline.test.tsx`.

> Migrates the inline `provenance === 'estimate_ga4'` check (`:83`) + hard-coded `fmtEstimateMoney` calls (`:71`, `:85`) onto the T2 contract (authority-layered-fields rule). The retainer ratio (`fmtEstimateRatio`) stays banded for ALL provenances — a multiple of a measured value is editorial, not sourced; add a one-line comment so review doesn't "fix" it.

- [ ] **RED** — append to `tests/component/IssueVerdictHeadline.test.tsx`: a `measured` verdict (`estimatedValue: 11_234, provenance: 'measured_action'`). Assert: exact `/\$11,234/` (no `/~\$/`); "measured from real actions" disclosure (not "this is an estimate"); `estimate_ga4` stays banded `~$11,000` + estimate disclosure; verdict-zone evergreen guard passes in the measured branch.
- [ ] **Run** → **RED**.
- [ ] **GREEN** — add `import { resolveProvenanceRender } from './outcomeProvenance';` (top). Resolve once inside the `verdict != null` branch: `const prov = verdict != null ? resolveProvenanceRender(verdict.provenance) : null;`. Replace the banded dollar lead with `{prov!.fmtMoney(verdict.estimatedValue)}` and the inline-estimate disclosure block with `{prov!.disclosure(verdict.valuePerOutcome)}`. Remove the now-unused `fmtEstimateMoney` import (keep `fmtEstimateRatio`).
- [ ] **Run** → **GREEN**. **Commit:** `Lane B T4 — IssueVerdictHeadline measured_action branch via provenance contract (exact money + measured disclosure)`

### Task B-T5 — wiring verification + parity guard (no new production code)
**Depends on:** T1–T4 + Lane A merged so `computeROI()` emits `measured_action` and `OverviewTab` passes `outcomeType`/`byType` through.
- [ ] Confirm in the cross-lane diff review that `OverviewTab.tsx:132-147`'s `outcomeUnits` map carries `outcomeType` from the typed event config. **If that pass-through is unassigned, it belongs to Lane A/C** (whoever owns the typed-event-config read) — raise at the diff-review checkpoint; Lane B does NOT touch `OverviewTab.tsx`.
- [ ] `npm run typecheck` (proves Lane A's names resolve everywhere B references them).
- [ ] `npx vitest run tests/unit/format-measured.test.ts tests/unit/outcome-provenance-render.test.ts tests/component/OutcomeCountBand.test.tsx tests/component/IssueVerdictHeadline.test.tsx` → green.
- [ ] `npx vitest run tests/component/the-issue-flag-parity.test.tsx tests/component/the-issue-spine-order.test.tsx tests/unit/format-estimate.test.ts` → P0 parity/estimate tests STILL pass unchanged (flag-OFF + estimate-only byte-identity).
- [ ] `npx vitest run` (full, single run) · `npx vite build` · `npx tsx scripts/pr-check.ts` (expect authority-layered-fields rule to PASS — no component branches on `provenance ===` inline).
- [ ] **DOM probe (5-layer rule):** mount the spine in Preview/Chrome MCP for a measured-provenance workspace — confirm no `~` on the verdict, "tracked on your site" disclosure, typed StatCards with distinct icons, emerald (not green) values, no purple. Capture before/after screenshot.
- [ ] Docs: `FEATURE_AUDIT.md`, `data/roadmap.json` (+ `sort-roadmap.ts`), `BRAND_DESIGN_LANGUAGE.md` (type-icon map + measured-vs-estimate label/precision rule).
- [ ] **Commit:** `Lane B T5 — verify typed/measured client render end-to-end + docs`

---

# LANE C — admin conversion-tracking setup flow

> **⬛ ADMIN-REFRAME ALIGNMENT (fold into Lane C — from `docs/superpowers/audits/2026-06-20-the-issue-admin-reframe-review.md` §5).** The admin-persona review surfaced 4 cheap, in-scope alignments to bake in NOW so the later (deferred) admin-reframe phase is a re-mount, not a rewrite — the big admin reframe itself is HELD until P1a is green: **(1)** build the Lane C verification readout (value/basis · segment · pinned+typed events · forms-connected · last-lead freshness · resolved provenance) as a **self-contained, REUSABLE component**, NOT inline JSX welded to the Settings tab — the future cockpit integrity strip + portfolio setup-column will consume the same component. *(highest-leverage)* **(2)** give the setup steps an **ordering + completion model compatible with `OnboardingChecklist`** even while it lives in Settings, so the later "give it a spine" change is a re-mount. **(3)** add **integrity guardrails on the value-per-outcome input while building that card** (a sanity band + a "last 90d would have read ~$Y" preview + an echo of the exact client-facing verdict sentence) — directly de-risks the "one misset input → confident-wrong client headline" watch-item. **(4)** keep the **provenance flip rule ABSOLUTE** (`measured_action` only on `conversionTrackingConfirmedAt`) — it's the integrity spine the whole reframe inherits. Contract note for Lane A: ensure `computeROI().outcomeVerdict`/`baselineVerdict()` are a clean server seam the admin can later READ without forking (same source/banding/provenance the client reads).

> The operator flow that *earns* `measured_action`: pin candidate GA4 events, map each to an `outcomeType`, connect the Webflow form source (guided manual webhook registration), and confirm setup (`conversionTrackingConfirmedAt`). Builds the P1a layer on top of shipped P0 (Outcome Value / Segment / Event Pinning are already live in `ClientDashboardTab.tsx`). Gated by `the-issue-client-measured-capture`; flag-OFF byte-identical. Admin routes use `requireWorkspaceAccess`, NEVER `requireAuth`. No AI (deterministic). Webhook write broadcasts + logs activity (server half here; frontend `useWorkspaceEvents` invalidation half is C2's status query + the client spine).

**HARD dependency:** Lane A's contract commit green (C imports `OutcomeType`, `EventDisplayConfig.outcomeType`, `FormSubmission`/store, the workspace fields, the flag). **Drift guards:** the actual provenance flip is **Lane A's `computeROI` seam** — Lane C only *writes* the config the seam reads; re-read `selectOutcomeProvenance` + `EventDisplayConfig` before wiring (a guessed field name is the canonical silent-data-loss bug). No AI-op-registry change (the `outcome-value-enrich` op stays Lane A's only registry entry).

### Task C1 — Lead-type (`outcomeType`) mapping in Event Display & Pinning
**Files:** Modify `src/components/settings/ClientDashboardTab.tsx`; create `tests/component/conversion-tracking-leadtype.test.tsx`.

- [ ] **RED** — render `ClientDashboardTab` with `the-issue-client-measured-capture` mocked ON, `ws.ga4PropertyId` set, `availableEvents` containing `form_submit` + `phone_call`. Pin both, assert an `outcomeType` `<select>` per pinned row, choose `form_fill`/`call`, Save → assert `patchWorkspace` called with `eventConfig` carrying `outcomeType: 'form_fill'`/`'call'`. Flag-OFF case: no `outcomeType` select renders (row byte-identical to P0).
```ts
expect(patchSpy).toHaveBeenCalledWith(expect.objectContaining({
  eventConfig: expect.arrayContaining([
    expect.objectContaining({ eventName: 'form_submit', pinned: true, outcomeType: 'form_fill' }),
    expect.objectContaining({ eventName: 'phone_call', pinned: true, outcomeType: 'call' }),
  ]),
}));
```
- [ ] **Run** → **FAIL**.
- [ ] **GREEN** — add `const measuredCapture = useFeatureFlag('the-issue-client-measured-capture');` (unconditional, Rules-of-Hooks-safe; import at top). Add module-scope `OUTCOME_TYPE_OPTIONS` (`form_fill`/`call`/`booking`/`email`/`directions`/`chat`/`other`). Add a `setOutcomeType(name, outcomeType)` helper next to the existing `assignGroup` (same upsert-into-`localEventConfig` shape). In each pinned event row, inside `{measuredCapture && pinned && (...)}`, render a `FormSelect` bound to `localEventConfig.find(c => c.eventName === ev.eventName)?.outcomeType ?? ''` → `setOutcomeType`. `saveEventConfig` already PATCHes `eventConfig` — `outcomeType` rides along; Lane A's `.passthrough()` + explicit Zod field accept it.
- [ ] **Run** → **PASS**; `npm run typecheck` → **PASS**.
- [ ] **Commit:** `feat(the-issue-conversion-tracking): per-event outcomeType mapping in admin event config (flag-gated)`

### Task C2 — Verification readout
**Files:** Modify `src/components/settings/ClientDashboardTab.tsx`; create `src/api/conversionTracking.ts`; create `tests/component/conversion-tracking-readout.test.tsx`.

- [ ] **RED** — flag ON, `ws.eventConfig` = 3 pinned (2 carrying `outcomeType`), mocked `getConversionTrackingStatus` → `{ pinnedCount: 3, typedCount: 2, formCaptureConnected: true, lastSubmissionAt: <2h ago>, submissionCount: 5 }`. Assert readout contains "3 events pinned", "2 typed", "Webflow forms connected", relative "2h ago". Flag-OFF: readout absent.
- [ ] **Run** → **FAIL**.
- [ ] **GREEN** — create `src/api/conversionTracking.ts` (typed wrapper for `GET /api/workspaces/:id/conversion-tracking-status` — no raw `fetch` in components). Render a `<SectionCard noPadding>` (only when `measuredCapture`) above Event Configuration. Compute `pinnedCount`/`typedCount` from `ws.eventConfig`; fetch status via a React Query hook gated on `measuredCapture && !!ws?.ga4PropertyId`. Four-Laws color: teal connected pill, amber "not connected", blue count metrics, `t-caption`. Honest empty copy when nothing wired.
- [ ] **Run** → **PASS**; `npm run typecheck` → **PASS**.
- [ ] **Commit:** `feat(the-issue-conversion-tracking): admin verification readout (pinned/typed/connected/last-lead)`

### Task C3 — Webflow webhook receiver route + admin status endpoint + `app.ts` mount
**Files:** Create `server/routes/the-issue-conversion-tracking.ts`; modify `server/app.ts`; create `tests/integration/the-issue-conversion-webhook.test.ts`.

> Consumes Lane A's pure helpers (`verifyWebflowSignature`, `parseWebflowFormPayload`, `resolveOutcomeType`), store (`saveFormSubmission`, `getFormCaptureStatus`), and workspace fields. Raw-body mount BEFORE `express.json` (sibling to the Stripe webhook at `app.ts:180`). Flag-gated → OFF returns 404 (satisfies A9's receiver-inert assertion). FM-2: bad signature → 401, nothing stored; malformed body → 400.

- [ ] **RED** — `tests/integration/the-issue-conversion-webhook.test.ts` (`createEphemeralTestContext`, seed `webflowFormWebhookSecret` + a pinned event, flag ON). Cases: (1) valid signature → 200, lead stored, `outcomeType: 'form_fill'`; (2) bad signature → 401, nothing stored; (3) duplicate `submissionId` → 200, count stays 1 (idempotent); (4) flag OFF → 404, nothing stored; (5) PII boundary — `GET /api/public/workspace/:id` carries `formCaptureConnected: true` but NEVER `webflowFormWebhookSecret`/`leadEmail`/`leadName`.
- [ ] **Run** → **FAIL**.
- [ ] **GREEN** — implement the router:
```ts
import express, { Router } from 'express';
import { getWorkspace, updateWorkspace } from '../workspaces.js';
import { verifyWebflowSignature, parseWebflowFormPayload, resolveOutcomeType } from '../webflow-form-webhook.js';
import { saveFormSubmission, getFormCaptureStatus } from '../form-submissions.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { addActivity } from '../activity-log.js';
import { isFeatureEnabled } from '../feature-flags.js';
import { requireWorkspaceAccess } from '../middleware/...js';
import { createLogger } from '../logger.js';

const log = createLogger('the-issue-conversion-tracking');
export const theIssueConversionTrackingRouter = Router();

// Raw body required for HMAC (mounted via express.raw in app.ts before express.json).
export function handleWebflowFormWebhook(req: express.Request, res: express.Response) {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.sendStatus(404);
  if (!isFeatureEnabled('the-issue-client-measured-capture', ws.id)) return res.sendStatus(404);
  const secret = ws.webflowFormWebhookSecret;
  if (!secret) return res.status(400).json({ error: 'Webflow form webhook not configured' });
  const raw = (req.body as Buffer).toString('utf8');
  if (!verifyWebflowSignature(raw, req.header('x-webflow-signature') ?? '', secret)) {
    log.warn({ workspaceId: ws.id }, 'webflow form webhook: invalid signature');
    return res.sendStatus(401);
  }
  let parsed; try { parsed = parseWebflowFormPayload(JSON.parse(raw)); } catch { return res.sendStatus(400); }
  if (!parsed) return res.status(200).json({ ignored: true }); // non-form trigger → ack, store nothing
  const outcomeType = resolveOutcomeType(ws, parsed.formId, parsed.formName);
  const { inserted } = saveFormSubmission({
    workspaceId: ws.id, formId: parsed.formId, submissionId: parsed.submissionId, formName: parsed.formName,
    leadName: parsed.leadName, leadEmail: parsed.leadEmail, leadMessage: parsed.leadMessage,
    eventName: 'form_submit', outcomeType, submittedAt: parsed.submittedAt, capturedAt: new Date().toISOString(),
  });
  if (inserted) {
    if (!ws.conversionTrackingConfirmedAt) updateWorkspace(ws.id, { conversionTrackingConfirmedAt: new Date().toISOString() });
    addActivity(ws.id, 'form_submission_captured', `New ${parsed.formName} submission captured`, undefined, { formId: parsed.formId, outcomeType }); // PII omitted from metadata
    broadcastToWorkspace(ws.id, WS_EVENTS.FORM_SUBMISSION_CAPTURED, { workspaceId: ws.id, outcomeType });
  }
  return res.status(200).json({ ok: true, inserted });
}

theIssueConversionTrackingRouter.get('/api/workspaces/:id/conversion-tracking-status', requireWorkspaceAccess(), (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (!isFeatureEnabled('the-issue-client-measured-capture', ws.id)) return res.sendStatus(404);
  const pinned = (ws.eventConfig ?? []).filter(c => c.pinned);
  const status = getFormCaptureStatus(ws.id);
  return res.json({
    pinnedCount: pinned.length,
    typedCount: pinned.filter(c => c.outcomeType).length,
    formCaptureConnected: !!ws.conversionTrackingConfirmedAt && !!ws.webflowFormWebhookSecret,
    lastSubmissionAt: status.lastSubmissionAt,
    submissionCount: status.count,
  });
});
```
  In `server/app.ts`, BEFORE `express.json` (next to the Stripe raw mount at `:180`): `app.post('/api/public/webflow-form-webhook/:workspaceId', express.raw({ type: 'application/json' }), handleWebflowFormWebhook);` and `app.use(theIssueConversionTrackingRouter);` after the existing admin router mounts.
- [ ] **Run** → **PASS**.
- [ ] **Commit:** `feat(the-issue-conversion-tracking): Webflow webhook receiver route + admin status endpoint (HMAC, idempotent, flag-gated)`

### Task C4 — Webflow form-source connect UI (guided manual registration)
**Files:** Modify `src/components/settings/ClientDashboardTab.tsx`; modify `server/routes/the-issue-conversion-tracking.ts` (enable/disable endpoints); modify `src/api/conversionTracking.ts`; create `tests/component/conversion-tracking-connect.test.tsx`.

- [ ] **RED** — flag ON, Webflow site linked. Assert a "Webflow form capture" subsection with an Enable button; mock enable → `{ webhookUrl, webhookSecret, formCaptureConfig: { enabled: true } }`; click Enable → copyable URL renders, "Copy" calls `navigator.clipboard.writeText` (reuse the existing `copyClientLink` pattern). Flag-OFF: subsection absent.
- [ ] **Run** → **FAIL**.
- [ ] **GREEN** — server: `POST /api/workspaces/:id/form-capture/enable` (+ `/disable`), `requireWorkspaceAccess`, flag-gated, generates `webflowFormWebhookSecret` via `crypto.randomBytes(24).toString('hex')` on first enable, persists via `updateWorkspace`, returns `{ webhookUrl: \`${origin}/api/public/webflow-form-webhook/${id}\`, webhookSecret }` (secret returned ONCE with a "copy now, shown once" note, never re-serialized). UI: a `<SectionCard>` (flag-gated) — Enable toggle, copyable `webhookUrl`, copyable one-time secret, 3-step guided checklist ("1. In Webflow Settings → Forms → Webhook, paste this URL · 2. Paste this signing secret · 3. Submit a test form — it'll appear in the readout above"). Teal CTA, blue data, `t-caption`.
- [ ] **Run** → **PASS**; `npm run typecheck && npx vite build` → **PASS**.
- [ ] **Commit:** `feat(the-issue-conversion-tracking): Webflow form-capture connect UI (guided manual webhook setup)`

### Task C5 — Setup checklist + measured-action honesty copy + flag-OFF parity test
**Files:** Modify `src/components/settings/ClientDashboardTab.tsx`; create `tests/component/conversion-tracking-flag-off-parity.test.tsx`.

- [ ] **RED (parity)** — flag mocked OFF: assert NONE of the readout, `outcomeType` selects, or connect card render — component is exactly today's P0 surface.
- [ ] **RED (checklist)** — flag ON: ordered 3-step checklist with done/todo from the C2 status ("Pin & type your key conversions" done when `typedCount > 0`; "Connect Webflow form capture" done when `formCaptureConnected`; "Confirm a measured lead landed" done when `submissionCount > 0`). Assert honesty caption: "Once a conversion is pinned, typed, and capturing real website actions, your client's number becomes measured, not estimated."
- [ ] **Run** → **FAIL**.
- [ ] **GREEN** — render the checklist inside the flag-gated readout card, driving step states from the fetched status; every new render path inside `{measuredCapture && ...}`.
- [ ] **Run** → **PASS**.
- [ ] **Commit:** `feat(the-issue-conversion-tracking): guided setup checklist + measured-action honesty copy + flag-OFF parity`

---

# LANE D — flag + acceptance tests + verification spine

> Builds no product behavior — every implementation step is "implement = Lane A/B/C lands X." Strict TDD. Flag + contract tests ship in the pre-dispatch commit WITH Lane A; the rest go RED with A and turn GREEN as B/C land; the verification rollup is the final gate. **Negative assertions** keep P3/PII out of the P1a payload.

### Task D0 — Register the P1a flag (pre-dispatch, FIRST)
**Files:** Modify `shared/types/feature-flags.ts` (`FEATURE_FLAGS`, `FEATURE_FLAG_CATALOG`, the `'The Issue (Client)'` group); extend `tests/unit/the-issue-client-flags.test.ts`; add `data/roadmap.json` item.

- [ ] **RED** — append to `tests/unit/the-issue-client-flags.test.ts`:
```ts
describe('the-issue-client-measured-capture (P1a website-native capture)', () => {
  it('registered, default-OFF, grouped under "The Issue (Client)"', () => {
    expect(FEATURE_FLAGS['the-issue-client-measured-capture']).toBe(false);
    const group = FEATURE_FLAG_GROUPS.find(g => g.label === 'The Issue (Client)');
    expect(group!.keys).toContain('the-issue-client-measured-capture');
  });
  it('carries a P1a roadmap link + pilot-clients rollout, distinct from the P3 reconciliation flag', () => {
    const meta = FEATURE_FLAG_CATALOG['the-issue-client-measured-capture'].lifecycle;
    expect(meta.rolloutTarget).toBe('pilot-clients');
    expect(meta.linkedRoadmapItemId).toBe('the-issue-client-redesign-p1a-measured-capture');
  });
  it('the P3 reconciliation flag stays reserved for CRM/call-tracking (NOT P1a)', () => {
    expect(FEATURE_FLAGS['the-issue-client-reconciliation']).toBe(false);
    expect(FEATURE_FLAG_CATALOG['the-issue-client-reconciliation'].lifecycle.removalCondition).toMatch(/CRM|call.?tracking|P3/i);
  });
});
```
- [ ] **Run** `npx vitest run tests/unit/the-issue-client-flags.test.ts` → **FAIL** (key not in `FEATURE_FLAGS`); confirm `npm run verify:feature-flags` currently green.
- [ ] **Implement** — add `'the-issue-client-measured-capture': false,` to `FEATURE_FLAGS` (comment: "P1a — website-native MEASURED outcome capture: GA4 key-event instrumentation + Webflow form capture → measured_action provenance. OFF = P0 estimate-only spine, byte-identical."); catalog entry (`owner: 'analytics-intelligence'`, `createdAt: '2026-06-20'`, `rolloutTarget: 'pilot-clients'`, `removalCondition`: "Promote once GA4 measured-action selection + Webflow form-capture named-lead path is validated with pilot clients on staging.", `linkedRoadmapItemId: 'the-issue-client-redesign-p1a-measured-capture'`, `staleAuditCadence: 'monthly'`, `lastReviewedAt: '2026-06-20'`); add the key to the `'The Issue (Client)'` group; update `the-issue-client-reconciliation`'s `removalCondition` to clarify P3. Add the roadmap item as `pending`; run `npx tsx scripts/sort-roadmap.ts`.
- [ ] **Run** → **PASS**; `npm run verify:feature-flags` → **PASS**; `npm run typecheck` → **PASS**.
- [ ] **Commit** (with Lane A): `flag(the-issue): register the-issue-client-measured-capture (P1a, OFF) + reserve reconciliation for P3`

### Task D-CONTRACT — Contract tests for the new shared types (ships with Lane A)
**Files:** Create `tests/contract/the-issue-measured-capture-types.test.ts`.

- [ ] **RED** — assert the three-tier provenance ladder (with a `@ts-expect-error` closed-union guard on a fourth value), `IssueOutcomeCount.units[].outcomeType` + `byType`, `outcomeVerdict.provenance: 'measured_action'`, and `FormSubmission` shape (import `OutcomeType`/`IssueOutcomeCount` from `the-issue.js`, `FormSubmission` from `form-submission.js`, `ROIData` from `roi.js`). Use the canonical names from the names table (`outcomeType`, `'form_fill'`, `FormSubmission`).
- [ ] **Run** → **FAIL**.
- [ ] **Implement = Lane A** (A1/A2/A3).
- [ ] **Run** → **PASS**; `npm run typecheck` → **PASS**.
- [ ] **Commit** (with Lane A): `test(the-issue): contract tests for P1a measured-capture types`

### Task D-PROVENANCE — Unit: `selectOutcomeProvenance()` graduation rules
**Files:** Create `tests/unit/select-outcome-provenance.test.ts`. Consumes `server/the-issue-outcome.ts` (Lane A).

- [ ] **RED** — four cases: (1) flag OFF + pinned events → `estimate_ga4` (P0 byte-identical); (2) flag ON + confirmed typed setup (`conversionTrackingConfirmedAt` set + pinned typed event) → `measured_action`; (3) flag ON but setup NOT confirmed → `estimate_ga4` (no false "measured" claim — the load-bearing honesty assertion, mirrors P0 `establishing`/`ready`); (4) never `actual_reconciled` at P1a. Pass `periodFormCount` as the second arg per A7's signature (`selectOutcomeProvenance(ws, periodFormCount)`).
- [ ] **Run** → **FAIL**.
- [ ] **Implement = Lane A** (A7).
- [ ] **Run** → **PASS**. **Commit:** `test(the-issue): selectOutcomeProvenance graduates estimate→measured_action only on confirmed setup`

### Task D-ROI-PUBLIC — Integration: public ROI gate + flag-OFF byte-identical + no P3/PII leakage
**Files:** Create `tests/integration/the-issue-measured-capture-roi-public.test.ts`. Models the shipped `tests/integration/the-issue-client-roi-public.test.ts` (distinct workspaces per flag state, overrides before `startServer()`, raw-text leakage assertions).

- [ ] **RED** — two workspaces: `wsMeasured` (spine ON + measured-capture ON + confirmed setup), `wsEstimateOnly` (spine ON, measured-capture OFF). Assert OFF → `provenance === 'estimate_ga4'`; ON → `measured_action`, `outcomeCount === 23`, `estimatedValue === 23*800`, `outcomeTypeBreakdown[0].outcomeType === 'form_fill'`, `outcomeReconciliation.ga4Count === 23`. **Leakage guard on the raw text:** `not.toContain('actual_reconciled')`, `not.toContain('closedWonRevenue')`, `not.toContain('"crm"')`, `not.toMatch(/leadEmail|leadName|webflowFormWebhookSecret/)`.
- [ ] **Run** → **FAIL**.
- [ ] **Implement = Lane A** (A7/A8).
- [ ] **Run** → **PASS**. **Commit:** `test(the-issue): public ROI provenance gate — measured_action ON, estimate_ga4 OFF, no P3/PII leak`

### Task D-WEBHOOK — Integration: Webflow webhook named-lead capture + reconciliation
**Files:** Create `tests/integration/webflow-form-webhook.test.ts`. Consumes Lane A helpers/store + Lane C route. Route: `POST /api/public/webflow-form-webhook/:workspaceId` (canonical).

- [ ] **RED** — seed `webflowFormWebhookSecret` + a pinned event, flag ON. Sign the body with the secret. Cases: bad signature → 401, nothing written; valid signature → 200, `countFormSubmissions === 1`; duplicate `submissionId` → still 1 (idempotent); flag OFF → 404, count unchanged; `reconcileFormCountVsGa4(wsId, 5, range)` → `{ capturedCount: 1, ga4Count: 5, discrepancy: 4 }` (surfaced, not hidden).
- [ ] **Run** → **FAIL**.
- [ ] **Implement = Lane A/C** (A4/A6 + C3).
- [ ] **Run** → **PASS**. **Commit:** `test(the-issue): Webflow form-webhook named-lead capture (signature, idempotency, flag-gated, reconciliation)`

### Task D-AGG-TYPE — Integration: event-typed aggregation
**Files:** Create `tests/integration/the-issue-outcome-typed.test.ts`. Consumes `classifyOutcomeType` + the typed `aggregatePinnedOutcomes` (Lane A).

- [ ] **RED** — `classifyOutcomeType('phone_call') === 'call'`, `'form_submit' === 'form_fill'`, `'generate_lead' === 'form_fill'`, `'book_appointment' === 'booking'`, `'mystery_event' === 'other'`; `aggregatePinnedOutcomes(ws, [...])` stamps each unit's `outcomeType` (admin override wins over heuristic) and `agg.totalConversions` sums correctly; `agg.byType` populated.
- [ ] **Run** → **FAIL**.
- [ ] **Implement = Lane A** (A7). Re-run shipped `tests/integration/the-issue-outcome.test.ts` → still PASS (untyped aggregation back-compat).
- [ ] **Run** → **PASS**. **Commit:** `test(the-issue): event-typed outcome aggregation (call/form_fill/booking, admin-override > heuristic)`

### Task D-COMPONENT — Component: `OutcomeCountBand` measured label + typed units + named-records affordance
**Files:** Create `tests/component/OutcomeCountBand-measured.test.tsx`. Consumes Lane B's extension.

- [ ] **RED** — a `measured` `IssueOutcomeCount` (typed units, `provenance: 'measured_action'`, `byType`, `namedRecordsAvailable: true`). Assert: "tracked on your site" / "measured" label, NOT "estimate"; by-type counts render (41 calls + 23 form fills); `namedRecordsAvailable: true` surfaces a names affordance not the call/CRM upsell; the P0 estimate path still renders the upsell (byte-identical regression guard); no purple (`container.querySelector('[class*="purple-"]')` null).
- [ ] **Run** → **FAIL**.
- [ ] **Implement = Lane B** (B-T3). Re-run shipped `tests/component/OutcomeCountBand.test.tsx` → still PASS.
- [ ] **Run** → **PASS**. **Commit:** `test(the-issue): OutcomeCountBand measured-vs-estimate label + typed units + named-records affordance`

### Task D-ADMIN — Integration: admin setup PATCH persists typed events + confirmation + Webflow source
**Files:** Create `tests/integration/the-issue-conversion-tracking-setup.test.ts`. Consumes Lane A column lockstep + Lane C PATCH validation. Admin uses `requireWorkspaceAccess` (`authedFetch`).

- [ ] **RED** — PATCH `/api/workspaces/:id` with pinned+typed `eventConfig` + `conversionTrackingConfirmedAt` → 200, persisted; PATCH with `outcomeType: 'banana'` → 400 (not a silent drop); PATCH with `webflowFormWebhookSecret` + `webflowFormSources: [{ formId, formName, outcomeType: 'form_fill' }]` → 200, persisted.
- [ ] **Run** → **FAIL**.
- [ ] **Implement = Lane A/C** (A5/A6 lockstep + C's PATCH boundary).
- [ ] **Run** → **PASS**. **Commit:** `test(the-issue): admin conversion-tracking setup PATCH (typed events, confirmation, Webflow source mapping)`

### Task D-FLAG-OFF-PROBE — DOM-probe scenario (extend the P0 harness)
**Files:** Modify `scripts/verify/the-issue-flag-off-domprobe.ts` (add `--scenario=measured-capture-off`); add `scripts/verify/__baselines__/the-issue-measured-capture-off.html`; modify `package.json`.

- [ ] **Extend** the harness — load `/client/:workspaceId/overview` with spine ON + measured-capture OFF, normalize `[data-testid="the-issue-client-page"]` innerHTML, diff against the new baseline. Throw if the text contains "measured" (leaked label) or a named-records affordance renders.
- [ ] **Capture baseline** on P0-HEAD (before Lane B edits): `npm run seed:demo && npm run dev:all` (background), then `PROBE_SCENARIO=measured-capture-off npx tsx scripts/verify/the-issue-flag-off-domprobe.ts --capture-baseline`. Commit the baseline.
- [ ] **Run after Lane B lands** → must print `measured-capture-OFF byte-identical: PASS`.
- [ ] **Wire** `"verify:the-issue-measured-off": "PROBE_SCENARIO=measured-capture-off tsx scripts/verify/the-issue-flag-off-domprobe.ts"`; reference in the P1a PR checklist (not in the default `verify:platform` chain — needs a running server + seed).
- [ ] **Commit:** `chore(the-issue): flag-OFF DOM-probe scenario for measured-capture + committed P0-spine baseline`

---

## ⬛ VERIFICATION STRATEGY (single sequential pass before the P1a PR)

```bash
# Targeted P1a suites (fast feedback)
npx vitest run \
  tests/unit/outcome-provenance-measured.test.ts \
  tests/unit/the-issue-outcome-type.test.ts \
  tests/unit/form-submission-types.test.ts \
  tests/unit/event-display-config-type.test.ts \
  tests/unit/webflow-form-webhook-helpers.test.ts \
  tests/unit/the-issue-client-flags.test.ts \
  tests/unit/select-outcome-provenance.test.ts \
  tests/unit/format-measured.test.ts \
  tests/unit/outcome-provenance-render.test.ts \
  tests/contract/the-issue-measured-capture-types.test.ts \
  tests/integration/form-submissions-store.test.ts \
  tests/integration/compute-roi-measured-action.test.ts \
  tests/integration/the-issue-roi-public-measured.test.ts \
  tests/integration/the-issue-measured-capture-roi-public.test.ts \
  tests/integration/webflow-form-webhook.test.ts \
  tests/integration/the-issue-conversion-webhook.test.ts \
  tests/integration/the-issue-outcome-typed.test.ts \
  tests/integration/the-issue-conversion-tracking-setup.test.ts \
  tests/integration/the-issue-p1a-flag-off.test.ts \
  tests/component/OutcomeCountBand.test.tsx \
  tests/component/OutcomeCountBand-measured.test.tsx \
  tests/component/IssueVerdictHeadline.test.tsx \
  tests/component/conversion-tracking-leadtype.test.tsx \
  tests/component/conversion-tracking-readout.test.tsx \
  tests/component/conversion-tracking-connect.test.tsx \
  tests/component/conversion-tracking-flag-off-parity.test.tsx

# Shipped P0 — must STILL pass (regression guards)
npx vitest run \
  tests/integration/the-issue-client-roi-public.test.ts \
  tests/integration/the-issue-outcome.test.ts \
  tests/component/the-issue-flag-parity.test.tsx \
  tests/unit/format-estimate.test.ts

# Full gate (NEVER two concurrent vitest passes — per-file deterministic ports → EADDRINUSE)
npm run typecheck                  # tsc -b, project-aware
npx vite build
npx vitest run                     # FULL suite, single run
npx tsx scripts/pr-check.ts        # parseJsonSafe at JSON boundaries; createStmtCache; WS-event no-inline-literal;
                                   # activity-logging on webhook mutation; UPDATE/DELETE workspace-scoped;
                                   # no raw fetch in components; authority-layered-fields; auth conventions
npm run verify:feature-flags       # the-issue-client-measured-capture grouped + lifecycle-complete
npm run verify:coverage-ratchet
grep -rn "purple-" src/components/client/   # MUST be empty

# DOM probes (require running server + seed:demo) — referenced in the PR checklist
PROBE_SCENARIO=measured-capture-off npx tsx scripts/verify/the-issue-flag-off-domprobe.ts
```

**Flag-OFF byte-identical + phase-per-PR.** This is **one phase = one PR (P1a)**, merged to `staging` first, verified on the staging deploy, then `staging → main`. Flag-OFF identity is proven at three layers because section/label reorders are exactly where typecheck/build/pr-check/CI all pass while the visible surface silently regresses: (1) the closed-union + computeROI guard (A9 + D-CONTRACT), (2) the public-payload integration test (D-ROI-PUBLIC: `estimate_ga4` default + P3/PII leak guards), (3) the real-browser DOM probe (D-FLAG-OFF-PROBE). **Do not start P1b (export) / P1c (push) / P3 (CRM) until P1a is merged and green on `staging`.** Because A/B/C/D ran as parallel agents, invoke the **`scaled-code-review`** skill before merging; fix all Critical/Important findings in this PR.

**Scaled-review re-verify list (read-before-write):** `OutcomeProvenance` has exactly three values; `outcomeType` field name matches across producer (`aggregatePinnedOutcomes`) and consumers (`OutcomeCountBand`, `EventDisplayConfig`, `FormSubmission`); `form_submissions` `UNIQUE(workspace_id, submission_id)` exists; `webflowFormWebhookSecret` + PII absent from `PublicWorkspaceView`/`client-safe.ts`; the webhook raw-body route is mounted BEFORE `express.json()` in `app.ts` (sibling to the Stripe webhook at `:180`); the `computeROI` seam reads exactly the fields Lane C persists (`conversionTrackingConfirmedAt`, `eventConfig[].outcomeType`).

---

## ⬛ SYSTEMIC IMPROVEMENTS

1. **`tests/contract/the-issue-measured-capture-types.test.ts`** — extends the P0 closed-union pattern to a three-tier provenance ladder; the executable guard against a silent fourth-value widening.
2. **`tests/integration/webflow-form-webhook.test.ts`** — a reusable inbound-webhook receiver test template (signature + idempotency + flag-gate + reconciliation), copyable for any future non-Stripe webhook (the repo currently has no such fixture).
3. **`server/webflow-form-webhook.ts` pure-helper split** — verify/parse/resolve are unit-testable without a server; a reusable pattern for future signed-webhook receivers.
4. **DOM-probe `PROBE_SCENARIO` parameterization** — generalizes the P0 flag-OFF probe so any future flag-gated label/layout change reuses one harness, directly addressing the captured "design-batch passes 4 gates, regresses surface" failure mode.
5. **P3/PII-leakage negative-assertion guard** — a reusable "future-phase / PII field must not appear in this phase's public payload" pattern (`actual_reconciled`/`closedWonRevenue`/`crm`/`leadEmail`/`webflowFormWebhookSecret`), enforcing phase-per-PR data discipline at the serialization boundary.
6. **`src/api/conversionTracking.ts` typed wrapper** — keeps the admin status/enable calls out of raw component `fetch`, consistent with the no-raw-fetch convention.

---

## ⬛ SELF-REVIEW PASS (placeholders, name consistency, scope→task coverage — fixed inline)

**Name drift — RESOLVED inline** (the four drafts conflicted; the Canonical Names table is authoritative and every task above now uses it):
- `OutcomeType` (not `OutcomeEventType`/`LeadType`); values use `'form_fill'` (not `'form'`).
- `outcomeType` field on both `EventDisplayConfig` and `units[]` (not `eventType`/`leadType`).
- `the-issue-client-measured-capture` is the P1a flag; `the-issue-client-reconciliation` is reserved for P3 (Decision D5). Lane A draft's use of `reconciliation` for P1a was rejected and rewritten.
- `FormSubmission` in `shared/types/form-submission.ts` (not `FormSubmissionRecord`; new file avoids the `the-issue.ts ↔ outcome-tracking.ts` import-cycle the A3 draft flagged as a risk).
- Webhook route `POST /api/public/webflow-form-webhook/:workspaceId` (Lane C/D drafts used two different paths — unified).
- Migrations: **148** form_submissions, **149** workspace-form-capture (147 verified last shipped; the drafts' "148 + 149" split is correct but reassigned: leads table → 148, workspace columns → 149).

**Scope-item → task coverage (every audit gap maps to a task):**
- `measured_action` enum → A1; event-type classification → A2 + A5 + A7 (`classifyOutcomeType`); `FormSubmission` model → A3 + A4; webhook receiver + signature → A6 (helpers) + C3 (route); `form_submissions` table → A4; `computeROI` seam → A7; reconciliation count → A8 + A4 (`reconcileFormCountVsGa4`); admin "set up conversion tracking" flow → C1–C5; admin verification readout → C2; named-lead click-through → **explicitly deferred to P1b** (PII boundary; A3/A8/D-ROI-PUBLIC assert names never ride the public payload); GTM/auto-instrument → **explicitly NOT built** (feasibility verdict); Forms-API poll → **deferred follow-up**; CRM → **P3**.

**Placeholders / open handoffs — flagged, not hidden:**
- `requireWorkspaceAccess` import path in C3 is shown as `'../middleware/...js'` — the implementing agent must read the actual export site (it's an established middleware; do not guess the path).
- A9's webhook-404 assertion depends on C3's mount; if Lane A lands before C3, mark that single assertion `it.todo` and convert it in C3's commit (called out at A9). The `computeROI` half of A9 is fully Lane A and gates the pre-dispatch commit.
- `OverviewTab.tsx` `outcomeType`/`byType` pass-through ownership: assigned to **Lane A/C** (whoever owns the typed-event-config read), explicitly raised at the B-T5 diff-review checkpoint — Lane B does not touch that file.

**Docs lockstep (in the P1a PR, per project after-task rules):** `FEATURE_AUDIT.md` (measured-outcome capture + Webflow form webhook entries), `data/roadmap.json` (`the-issue-client-redesign-p1a-measured-capture` → done-marks + deferred follow-up items: Forms-API poll, discrepancy UI, P1b export, P1c push, P3 CRM; run `sort-roadmap.ts`), `BRAND_DESIGN_LANGUAGE.md` (type-icon map + measured-vs-estimate label/precision), the outcome-tracking rule doc (new `measured_action` tier + PII-internal `form_submissions` boundary), `data/features.json` (client-impactful: "measured outcome capture").

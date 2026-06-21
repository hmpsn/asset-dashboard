# Client IA — P4: Share/Export gate-D — band the exported money by provenance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Controller commits; subagents never git-write.

**Goal:** Enforce **gate D** on the forwardable one-pager export: the dollar value must be **banded (`~$11,000`)** for `estimate_ga4` / `measured_action` provenances (the value is `outcomeCount × an estimated per-outcome rate` — editorial, not sourced) and **exact (`$11,200`)** only for `actual_reconciled`. Today the export prints an exact `count × rate` dollar for every provenance — the release-blocking thing gate D forbids ("showing count×rate as an exact dollar is release-blocking").

**Pre-plan finding (architecture scan):** the rest of P4's tournament grafts are ALREADY built — **graft A** (Overview Share/Export) is `IssueExportBar` mounted on the spine (slot 1b, gated `the-issue-client-return-hook`); **graft B** (per-piece attribution) is `ROIDashboard`'s `contentItems` "Content ROI Attribution" table fed by `contentPerformance.publicGet`, already on the Overview spine (slot 3) and in Results. The provenance label + `methodologyLine` already ride the export payload. **The single open item is the money banding** in the export render path.

**Architecture:** Add ONE shared banding helper (`shared/format-money.ts`) — extract the client's existing `fmtEstimateMoney` rounding/`~$` logic so client + server use a SINGLE definition (authority rule: no two banding implementations). The export **assembler** (`server/the-issue-export.ts`) computes a provenance-resolved `estimatedValueLabel: string` (banded vs exact) and uses it in `verdictSentence`; the payload carries that pre-resolved string; the **renderer** (`server/the-issue-one-pager-html.ts`) prints `p.estimatedValueLabel` instead of re-formatting `estimatedValue`. (Pre-resolved representation per the authority-layered-fields rule — the renderer holds no money logic.)

> ⚠️ **GATE-D RULE = band UNLESS `actual_reconciled`** (i.e. band BOTH `estimate_ga4` AND `measured_action`; exact only for `actual_reconciled`). This matches `resolveProvenanceRender` ([outcomeProvenance.ts](../../../src/components/client/the-issue/outcomeProvenance.ts) — the hero's contract: measured_action → `fmtEstimateMoney` banded). It does NOT match `formatNumbers.ts:fmtOutcomeMoney` ([:79](../../../src/utils/formatNumbers.ts)), which wrongly EXACTS `measured_action` — a pre-existing discrepancy between the two mappers. **Do NOT delegate the export's provenance decision to `fmtOutcomeMoney`.** Task 0 makes the shared `formatOutcomeMoney` the canonical (band-unless-reconciled) mapper; Task 0 Step 4 then `grep`s every `fmtOutcomeMoney` caller and points `formatNumbers.ts:fmtOutcomeMoney` at the shared canonical one (reconciling the discrepancy — measured_action becomes banded everywhere, matching the hero). If any caller relied on exact measured_action money, surface it in the PR rather than silently flipping it.

**Scope source:** the P4 architecture scan + `docs/superpowers/audits/2026-06-21-client-ia-tournament.md` gate D. **Depends on:** P3 merged to staging.

**Out of scope:** IssueExportBar, the export route/auth, per-piece attribution (all exist + verified); `adSpendEquivalent` and `monthlyRetainer` stay exact (ad-spend is its own estimate line; retainer is a known config value, not count×rate).

---

## Task 0: Shared banding helper (single source)

**Files:** `shared/format-money.ts` (new), `src/utils/formatNumbers.ts` (delegate), `tests/unit/format-money.test.ts` (new)

- [ ] **Step 1:** Read `src/utils/formatNumbers.ts` `fmtEstimateMoney` + `fmtMeasuredMoney` + `fmtOutcomeMoney` to capture the EXACT current banding rule (round to 2 significant figures, `~$` prefix, no cents) and exact rule.
- [ ] **Step 2:** Create `shared/format-money.ts` exporting pure functions: `bandEstimateMoney(value: number): string` (the `~$` 2-sig-fig form, IDENTICAL output to the current `fmtEstimateMoney`), `exactMoney(value: number): string` (the `$` exact form), and `formatOutcomeMoney(value: number, provenance: OutcomeProvenance): string` (banded for `estimate_ga4`/`measured_action`, exact for `actual_reconciled`). Import `OutcomeProvenance` from `shared/types/the-issue.js`.
- [ ] **Step 3:** Unit test `tests/unit/format-money.test.ts` — assert `bandEstimateMoney(11200) === '~$11,000'` (2 sig figs), boundary cases (e.g. 0, 950→'~$950', 11200, 1_250_000), and `formatOutcomeMoney(11200, 'estimate_ga4')` banded / `(11200,'actual_reconciled')` exact / `(11200,'measured_action')` banded. Match the CURRENT `fmtEstimateMoney` output exactly (copy a few of its existing test expectations if present). Run red→green.
- [ ] **Step 4:** Refactor `src/utils/formatNumbers.ts` `fmtEstimateMoney` to delegate to `bandEstimateMoney` (and `fmtMeasuredMoney`→`exactMoney`) so there is ONE banding definition. Run the existing formatNumbers tests + the hero `IssueVerdictHeadline` tests to confirm IDENTICAL client output (no visual change).
- [ ] **Step 5: Commit** `feat(client-ia): shared money-banding helper (single source for client + export) (P4)`.

---

## Task 1: Band the exported money by provenance

**Files:** `shared/types/the-issue.ts` (`OnePagerExportPayload` +1 field), `server/the-issue-export.ts` (assembler), `server/the-issue-one-pager-html.ts` (renderer), `tests/integration/the-issue-export.test.ts` (new or extend)

- [ ] **Step 1:** Add `estimatedValueLabel: string` to `OnePagerExportPayload` (`shared/types/the-issue.ts`) — JSDoc: "Provenance-resolved money string (banded ~$ for estimate/measured, exact for reconciled). The renderer prints this verbatim — gate D. Never re-format estimatedValue downstream."
- [ ] **Step 2:** In `server/the-issue-export.ts` assembler: compute `const estimatedValueLabel = formatOutcomeMoney(estimatedValue, verdict.provenance)` (import from `shared/format-money.js`). Use it in `verdictSentence` — for banded provenances the sentence reads e.g. `${count} ${noun} = ${estimatedValueLabel} in value vs. a $${retainer} retainer` (DROP the `≈` since `~$` already conveys approximation; keep exact `$` + no extra hedge for reconciled). Add `estimatedValueLabel` to the returned payload.
- [ ] **Step 3:** In `server/the-issue-one-pager-html.ts`: replace `$${p.estimatedValue.toLocaleString('en-US')}` (the "Estimated value" stat, ~line 149) with `${esc(p.estimatedValueLabel)}`. Leave `adSpendEquivalent` + `monthlyRetainer` exact (not count×rate). `verdictSentence` is already banded from Step 2.
- [ ] **Step 4:** Test (`tests/integration/the-issue-export.test.ts` — exercise the real `GET /api/public/export/:workspaceId/one-pager` authed route): seed a workspace with `outcomeValue` + spine + return-hook flags + a GA4 snapshot so `outcomeVerdict.provenance === 'estimate_ga4'`; assert the export HTML contains a banded `~$` for the estimated value and does NOT contain the exact `count × rate` dollar. (If a reconciled fixture is feasible, assert exact `$` with no `~`.) Run red→green. If a pure-assembler unit test is simpler than the HTTP route, assert `assembleOnePagerExport(...).estimatedValueLabel` starts with `~$` for estimate_ga4 and `$` (no `~`) for actual_reconciled.
- [ ] **Step 5: Commit** `fix(client-ia): band exported money by provenance — gate D (P4)`.

---

## Task 2: Verification gate

- [ ] **Step 1:** `npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts && npm run lint:hooks && npm run verify:feature-flags && npm run verify:coverage-ratchet` — all green.
- [ ] **Step 2 — gate D acceptance:** the exported one-pager shows `~$X` (banded) for estimate/measured and exact `$X` only for reconciled; the provenance `methodologyLine` is present (unchanged). The exact `count × rate` dollar never appears for a non-reconciled verdict.
- [ ] **Step 3:** Flag-OFF / no-export parity — `the-issue-client-return-hook` OFF → no export affordance (unchanged); the banding change only affects the export payload (additive field).
- [ ] **Step 4: scaled-code-review** (multi-agent) → fix Critical/Important. (Money/honesty path — review the banding rounding + the provenance switch + that no exact count×rate leaks.)
- [ ] **Step 5: Docs** — `FEATURE_AUDIT.md` (#601), `data/roadmap.json` (`client-dashboard-ia-restructure` → P4 done; the whole IA v2 P1–P4 single-site track complete; P5 deferred; `sort-roadmap`), `BRAND_DESIGN_LANGUAGE.md` if the export visual changed (banded value formatting — likely a one-line note).
- [ ] **Step 6: PR → staging**, CI green, merge. **This completes the single-site IA v2 track (P1–P4).** P5 (multi-location) is a separate session per owner.

---

## Self-Review

- **Spec coverage (gate D):** the one open release-blocker — exported money banding — is the whole of P4. Grafts A (Overview Share/Export) + B (per-piece attribution) verified already built (no work). Banding lives in ONE shared helper (no drift); the payload carries the pre-resolved string (renderer holds no money logic — authority rule).
- **No false precision either way:** estimate/measured → `~$` banded; reconciled → exact. `adSpendEquivalent`/`monthlyRetainer` correctly stay exact (not count×rate).
- **Parity:** export-only change behind the existing return-hook flag; client hero rendering unchanged (Task 0 Step 4 delegates to the same logic, identical output).

## Execution Handoff

Subagent-driven (small). Task 0 (shared helper) → Task 1 (export banding) → gate. One PR into staging. Closes the IA v2 single-site track.

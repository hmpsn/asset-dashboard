# Feature-Flag Sunset — Pre-Plan Audit

**Date:** 2026-07-02
**Purpose:** Bucket all 29 feature flags for retirement before the P2 UI rebuild, so every "two paths behind a flag" collapses into one clean unconditional path.
**Method:** 4 parallel code auditors (read every runtime read-site + what each gates + client-facing? + ON-path-built? + coupling) **overlaid with the live prod override state** (`GET /api/admin/feature-flags`, read-only).
**Staging HEAD audited:** `90895abde` (Reconcile complete).

---

## The one finding that reframes everything: prod override state

The code default for **all 29 flags is `false` (OFF)**. But in production, **26 of 29 are globally overridden ON** (a *global* DB override — which, unlike a per-workspace override, **reaches the client UI**). So for those 26, clients already see the ON path today. **Making them unconditional is a near-no-op for clients** — the scary "client-facing flip" is already flipped operationally.

Only **3 flags are genuinely OFF in prod**: `client-briefing-v2`, `client-briefing-v2-ai-polish`, `client-work-feed`. Those are the only ones where retiring = a *real* new client-facing behavior. (`client-locations` still shows in prod because prod is at Phase A; it's already retired on staging via C3.)

**Consequence:** the sunset is much safer than "29 client-facing releases." It's mostly mechanical OFF-branch deletion on already-live behavior, plus 3 genuine decisions and a small KEEP set.

---

## 🚨 Safety callout (separate from the sunset)

**`strategy-trust-ladder-autosend` is globally ON in prod** (`enabled:true`, code default `false`). That flag gates `runAutoSendForWorkspace()` in `server/strategy-issue-cron.ts:197` — the weekly cron auto-sends client recs **with no operator veto window**. Its whole design is to stay OFF until a decoupled-tick + operator-veto ships (which it hasn't). A *global* ON is broader than ever intended. **This is not a sunset action — it's a production-config question for the owner:** confirm it's intentional; if not, flip it off in prod (safe direction). I did not change it. (Follow-up: I can check prod activity for whether any auto-sends actually fired.)

---

## Buckets (all 29)

Legend — **Combined rec** merges the code bucket with the prod override state.
`prod` = live global state. `CF` = client-facing flip (per code).

### A. DELETE-AS-UNUSED — phantoms / reserved-future (zero runtime readers) — 3
Retire by deletion now; re-add the key if/when the reserved feature is actually built (per the owner's "reserved-future → delete-not-flip" rule).

| Flag | prod | CF | Notes |
|---|---|---|---|
| `strategy-paid-topics` | ON* | no | Phantom. `status:'reserved'`. Gating is a `productType` data-check, not this flag. 1-file removal. *ON is meaningless (zero readers). |
| `the-issue-client-reconciliation` | ON* | no | Phantom, reserved for P3 CRM/call-tracking → `actual_reconciled`. Test file asserts its reserved status (update it). |
| `the-issue-client-segment-inserts` | ON* | no | Phantom, reserved. The feature its label describes already ships **unflagged** under the spine. Stale comment at `the-issue-admin.ts:8` to tidy. |

### B. UNCONDITIONAL-IZE — server/admin, ON in prod (no client change) — 8
Safe strips: already live, no client surface. Each = delete the OFF branch + remove the flag + update tests.

| Flag | prod | CF | Notes / caveat |
|---|---|---|---|
| `smart-placeholders` | ON | no | Admin AdminChat placeholder. Bonus: delete an unreachable `isAdminContext:false` client branch too. |
| `keyword-universe-full` | ON | no | Keyword Hub coverage uncap. Cost concern moot — it's on in prod. Last survivor of the retired `keyword-hub` umbrella. |
| `ai-visibility` | ON | no | LLM-mentions admin panel + slice. Paid DataForSEO, but on-in-prod = cost accepted. |
| `signal-auto-recompute` | ON | no | Intelligence recompute cron/triggers. Cost accepted (on in prod). |
| `geo-targeting` | ON | no (indirect) | Threads real geo into DataForSEO. Do in same PR as `national-serp-tracking` if that one moves. |
| `strategy-staleness-scan` | ON | no | Server nudge cron. Clean single gate. |
| `strategy-signal-fold` | ON | no (indirect) | Mints IntelligenceSignals as recs. **Verify the standalone `IntelligenceSignals` card is deleted** in the same effort (its removalCondition). |
| `strategy-divergence-sweep` | ON | no | Read-only rec↔mirror drift diagnostic. B7 struck≠completed trigger shipped, but C4 found live mirror/respond gaps — **keep as diagnostic a bit longer**, or unconditional-ize with eyes open. |

### C. UNCONDITIONAL-IZE — client-facing but ALREADY ON in prod (no-op for clients; coupled) — 9
Clients already see ON (global override), so no visible change — but these have **real OFF-branch UI to delete** and **coupling** to respect. Retire in dependency order, in coupled units, with a flag-ON real-render smoke each (CLAUDE.md rule 13).

| Flag | prod | Coupling / caveat |
|---|---|---|
| `strategy-command-center` | ON | Admin v3 cockpit master. **BUT** the docs overstate it: `strategy-the-issue`/`-competitor-send`/`-keywords-managed-set` are read *independently* on the client — retiring command-center ≠ retiring those. Large single-file strip (`KeywordStrategy.tsx` ~15 branch points + legacy layout). |
| `strategy-keywords-managed-set` | ON | Admin composed under command-center, **but `ContentGaps.tsx`/`TopicClusters.tsx` read it standalone** and already leak the "Keep" button into the legacy layout. Resolve that leak. |
| `strategy-competitor-send` | ON | **Client-facing** (`InsightsEngine.tsx:138` standalone gate un-hides competitor recs). Sequence the client migration with the admin strip. ⚠️ latent bug: `InsightsEngine.tsx:228` useMemo omits `competitorSendEnabled` from deps. |
| `strategy-the-issue` | ON | Second master (client mount gate + admin cockpit + server view-model/cron; parent of autosend). Largest blast radius. ⚠️ `strategy-issue-cron.ts:321` reads it **globally** (no workspaceId) unlike every sibling — fix before removal. |
| `the-issue-client-spine` | ON | Client Overview layout master (new-vs-legacy fork in one file); parent of measured-capture/return-hook/next-bets. Large OFF-branch delete. Retire with/after `strategy-the-issue`. |
| `the-issue-client-measured-capture` | ON | Child of spine. Turns on a live **Webflow form Data-API poller** (cost/rate-limit) — its own soak. Additive (no OFF branch), 7 sites. |
| `the-issue-client-return-hook` | ON | Child of spine. Cron sends real **SMS/email**; `staging-validation` maturity (less field-tested). |
| `the-issue-client-next-bets` | ON | Child of spine. **Thin test coverage — no dedicated ON-render test.** Manual flag-ON smoke before promoting. |
| `client-ia-v2` | ON | Independent nav-shell master (4-tab vs legacy 9-tab). Best-tested flag. Largest strip. Verify the IA-v2-ON + spine-OFF combination renders sanely if retired separately. |

### D. GENUINE DECISION — OFF in prod (retiring = a real new client behavior) — 3

| Flag | prod | CF | The decision |
|---|---|---|---|
| `client-work-feed` | **OFF** | **yes (direct)** | Unconditional-ize = every client newly sees `AgencyWorkFeed` on Overview (replaces the legacy timeline). Complete + tested. **A real client release** — decide + smoke, don't auto-strip. |
| `client-briefing-v2` | **OFF** | yes (indirect) | The client magazine UI it gated was **removed 2026-06-20**; it now gates only a **server pipeline that emails clients + feeds ClientSignalsSlice**. Flipping ON = start auto-emailing every eligible workspace. **Owner decides:** promote (start emails) or keep as an intentional kill-switch. A teardown-PR "controller-review note" is referenced but wasn't found — read it first. |
| `client-briefing-v2-ai-polish` | **OFF** | yes (indirect) | Child of `client-briefing-v2` (unreachable without it). Resolve in the same decision/commit. No regression test today — add one if promoting. |

### E. KEEP — do not sunset now — 6

| Flag | prod | Why keep |
|---|---|---|
| `strategy-trust-ladder-autosend` | ON⚠️ | **Permanent safety exemption** (in `PERMANENTLY_EXEMPT_FLAGS`, test-enforced). Unconditional-izing = auto-send with no veto. See the safety callout above re: its prod-ON state. |
| `gbp-auth-connection` | ON | Complete OAuth code, **blocked on external Google API access**. Root of a hard 3-flag AND chain — must retire in lockstep with the next two, only once Google approves. |
| `gbp-auth-reviews` | ON | Hard-ANDed to `gbp-auth-connection`. Same Google block. |
| `gbp-review-responses` | ON | Hard 3-flag chain; **client-facing** (inbox approval card); Google **write-scope** pending; freshly landed on `codex/gbp-review-responses-phase2c`, still stabilizing. Do not touch gating now. Follow-up: add a real flag-transition test for the inbox card + de-dupe the two `responseFeatureEnabled()` copies. |
| `national-serp-tracking` | ON | Paid DataForSEO (metered). On-in-prod suggests cost accepted, **but** a kill-switch for a metered paid feature has ongoing value — **owner call** whether to keep it as a permanent control vs. unconditional-ize. Client-facing insight (`serp_feature_opportunity`). |
| `local-gbp` | ON | Paid DataForSEO; same "cost accepted operationally, but kill-switch value" owner call. Admin-only. No Google dependency (internal timeline). |

---

## Recommended sequencing (waves, ordered by risk)

- **Wave 0 — Safety (not a strip):** resolve `strategy-trust-ladder-autosend` prod-ON (owner). Independent of everything else.
- **Wave 1 — Delete phantoms (zero risk):** the 3 in bucket A. One small PR, pure catalog + test cleanup, zero behavior change. **Start here.**
- **Wave 2 — Unconditional-ize server/admin (bucket B, 8):** already-live, no client surface. Small PRs; each strips one OFF branch + removes the flag. Verify the two "same-effort" conditions (signal-fold's standalone card; divergence-sweep's diagnostic value).
- **Wave 3 — Unconditional-ize client, coupled (bucket C, 9):** already-ON so no client-visible change, but big strips + coupling. Retire in dependency order as coupled units: `client-ia-v2` (independent) can go alone; the `strategy-command-center` admin cluster together; the `strategy-the-issue` → `the-issue-client-spine` → {measured-capture, return-hook, next-bets} tree bottom-up. Flag-ON smoke each. Fix the two ⚠️ bugs (competitor-send deps; the-issue-cron global scoping) in-flight.
- **Wave 4 — Genuine decisions (bucket D, 3):** `client-work-feed` (client release + smoke); the `client-briefing-v2` pair (owner decides promote-vs-keep — read the teardown note first).
- **Never (bucket E, 6):** keep autosend (safety) + the 3 GBP-chain (Google) + the 2 paid DataForSEO kill-switches (owner call).

**Net:** ~20 flags retire cleanly (3 delete + 8 server + 9 client-no-op), 3 need an owner decision, 6 stay. Only `client-work-feed` (and, if promoted, the briefing pair) is an actual new client-facing release — everything else is either already-live or invisible.

## Cleanup items surfaced in passing (worth a ticket regardless)
- `src/components/client/InsightsEngine.tsx:228` — `grouped` useMemo reads `competitorSendEnabled` but omits it from deps (stale-filter bug).
- `server/strategy-issue-cron.ts:321` — `isFeatureEnabled('strategy-the-issue')` with **no workspaceId** (global), inconsistent with every other per-workspace read site.
- `src/hooks/useSmartPlaceholder.ts` — unreachable `isAdminContext:false` client branch (dead code).
- `gbp-review-responses` — client inbox approval card has only a mocked-hook test (no real flag transition); two identical `responseFeatureEnabled()` implementations.

## Open questions for the owner
1. **Autosend prod-ON** — intentional, or flip off? (safety)
2. **`client-briefing-v2` pair** — promote (start client emails) or keep as kill-switch? Where's the teardown-PR review note?
3. **`national-serp-tracking` / `local-gbp`** — retire the paid-feature kill-switches, or keep them as permanent cost controls?
4. **Reserved phantoms** — delete now and re-add when built (recommended), or leave the reserved placeholders?

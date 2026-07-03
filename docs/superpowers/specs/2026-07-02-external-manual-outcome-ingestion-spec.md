# External / Manual Outcome Ingestion — Spec

**Date:** 2026-07-02
**Status:** DRAFT for owner review (deferred from Reconcile C4; sits on the settled attribution/provenance contract)
**Owner:** analytics-intelligence
**Related:** memory `project-external-outcome-ingestion-followup`; Reconcile B13 (outcome seams), B14 (attribution-required), B15 (coverage/provenance), C4 remediation A (honest attribution at client seams)

---

## 1. Problem

The outcome/attribution engine captures an outcome only when the **platform itself acts** (a rec applied through the platform, a post published through the platform flow, an approval, etc. — the B13 seams). Two real sources of work are invisible to it:

1. **Agency/manual work** — blog posts and pages the operator publishes **directly to the live site**, bypassing the platform's content flow. Real agency work, but no tracked action is ever created, so it never becomes a measurable client win.
2. **Externally-published pages** — new pages/posts that appear on the client's site (client's own team, or agency-out-of-band) that the platform never saw.

The result: the client's wins/results **under-count** the actual work done for them, and there's no honest way to bring manual/external work into the ledger.

## 2. Personas & the honesty tension

- **The operator (agency/owner)** manually posts a blog to the live site. Needs a fast "mark this as published/done" so it enters the ledger with honest **agency** attribution (`platform_executed` — the agency *did* perform it). Anxiety: double-entry with the platform flow; a tool that claims credit dishonestly.
- **The client** sees the outcome surfaces (wins, monthly digest, results). Needs those to reflect **all** the work done for them — including manual/agency — **honestly attributed**. Distrust trigger (the exact one C4 remediation A just closed): the platform claiming credit for the client's **own** independently-published pages.

The whole feature lives or dies on **not repeating the C4 trust bug**: auto-detected work whose author is unknown must never be silently stamped as an agency win.

## 3. Capabilities (one feature family)

1. **Manual "mark as published"** — the reliable core. An admin action that records a tracked outcome (right ActionType, honest attribution, source snapshot URL+title) via the existing hardened `recordAction` path.
2. **Historical backfill (Rinse Dental)** — narrow, one workspace. Bulk-use of capability #1 over existing timestamped brief/post records; **no separate one-off importer**.
3. **Auto-detect newly-published pages** — Webflow CMS + sitemap diff, behind a **neutral-provenance + operator-confirm** honesty gate.

## 4. Substrate that already exists (this is why (a) is light)

| Need | Already built | Location |
|---|---|---|
| Manual record backend | `POST /api/outcomes/:workspaceId/actions` (admin-only; accepts `actionType`, `sourceType`, `attribution`, `baselineSnapshot`, `source{label,snapshot}`) — **hardened in C4** (explicit attribution, no silent default) | `server/routes/outcomes.ts:302` |
| Durable win title | `source: { label, snapshot: TrackedActionSourceSnapshot{title,type,page} }` threading (B11) | `shared/types/outcome-tracking.ts:113` |
| External-execution detector (confirmation-signal pattern) | GSC-baseline comparison flips `not_acted_on → externally_executed` after 2 consecutive positive checks — for **existing** tracked actions | `server/external-detection.ts` |
| Webflow CMS read | `listCollections`, `listCollectionItems` (items carry published dates), `getCollectionSchema` | `server/webflow-cms.ts` |
| Daily poller pattern to clone | per-workspace, idempotent-on-id, floor-timestamp to skip pre-setup history, broadcast + activity on genuinely-new insert, `start*Poller()` registration | `server/webflow-form-poller.ts` |
| Attribution honesty axis | `platform_executed` / `externally_executed` / `not_acted_on` (3-value enum — keep it 3-value) | `shared/types/outcome-tracking.ts` |

**Gaps to build:** an admin UI for manual-add; a new-page detector poller; the operator-confirm queue + the neutral "needs attribution" state.

## 5. Design decisions (resolved, with recommendations)

- **D1 — Manual-add gets a small admin UI.** The backend is done. Add a lightweight "Record published work" form on the outcomes admin surface (and/or a "mark as published" affordance on a completed deliverable). Fields: page URL, title, ActionType (`content_produced`/`meta_updated`/…), **attribution** (default `platform_executed` for agency-posted; `externally_executed` when logging client-posted work), optional baseline. **Recommend: build it** — it's the reliable core and it subsumes D5.
- **D2 — Auto-detected pages are NEVER auto-attributed as wins.** Detection creates a tracked action in a **needs-attribution / unconfirmed** state; an operator confirms *who did it* (we posted → `platform_executed`; client posted → `externally_executed`; noise → dismiss) before it can count. This is the load-bearing honesty gate (ties to B14 + C4-A). **Recommend: an operator-confirm queue**, mirroring external-detection's "require confirmation" caution.
- **D3 — Detect mechanism.** Webflow CMS API (`listCollectionItems` + published date) as the primary for Webflow content — **clone `webflow-form-poller.ts`** (daily, per-workspace, idempotent on item id, floor timestamp so first poll doesn't ingest all history). `sitemap.xml` diff vs a stored page-inventory snapshot as the **general fallback** for non-Webflow/static pages (reuse existing crawl/page-inventory infra — don't build fresh). GSC first-impressions as a **confirmation** signal (lags indexing), never the trigger.
- **D4 — Represent "detected, unconfirmed" without polluting the 3-value attribution enum.** Two options: (a) a context/status flag (`needsAttribution: true` in `ActionContext`, the field `external-detection.ts` already uses for `detectionChecks`) that excludes the action from all rollups until cleared; (b) a new neutral value. **Recommend (a)** — keeps the honesty enum clean (3 values), reuses the existing `ActionContext` mechanism, and a detected-but-unconfirmed action simply never counts (consistent with the C4-A rule that only executed work counts). The admin confirm queue reads `context.needsAttribution`.
- **D5 — Rinse backfill is a thin script over D1.** A `scripts/backfill-rinse-outcomes.ts` that reads Rinse's existing timestamped brief/post records and calls the same record path with `platform_executed` + source snapshot. No bespoke importer; delete after the one-time run.

## 6. Honesty invariants (contract — enforce in every phase)

1. Auto-detection **never** stamps `platform_executed` (or any win-counting attribution) without operator confirmation. (B14 + C4-A.)
2. A detected-but-unconfirmed action is excluded from **every** rollup (win-rate, digest, wins surface, coverage funnel) — same exclusion the client scorecard already applies to `not_acted_on`.
3. Manual-add always passes an **explicit** attribution (the hardened route rejects the silent default) and captures a **source snapshot** (durable title, B11).
4. Client surfaces show manual/agency work identically to platform work **only when honestly `platform_executed`**; client-posted (`externally_executed`) work uses the "we called it / implemented on your side" framing from C4-A.

## 7. Suggested phasing (one PR per phase)

- **P1 — Manual mark-as-published** (admin UI over the existing route) **+ Rinse backfill script**. Ships the reliable core; zero new client-facing behavior beyond honest wins appearing. **Smallest, highest-value; can start immediately.**
- **P2 — Webflow CMS new-page detector** → `needsAttribution` action → **operator confirm queue** → attribution. The honesty-gated automation. Depends on P1's record path + the confirm UI.
- **P3 (optional) — sitemap-diff fallback** for non-Webflow sites + GSC first-impression confirmation signal.

## 8. Verification

- Contract test: a `needsAttribution` action is excluded from the public scorecard/wins/digest until confirmed (extends the C4-A exclusion tests).
- Integration test: manual-add via the route creates a counted win only with explicit attribution; detector creates an *un*counted action pending confirmation.
- Flag-ON real-render smoke if any client surface changes (none expected in P1).

## 9. Effort read

**Light-to-moderate.** ~70% of the backend substrate exists. P1 is days (a form + a script). P2 is the real work (a poller + a confirm queue + the `needsAttribution` plumbing) but every piece has a proven precedent to clone. No migration beyond possibly one nullable column if `needsAttribution` is promoted out of `ActionContext` JSON. Sits cleanly on the Reconcile-settled attribution/provenance contract — which is exactly why it was deferred to here.

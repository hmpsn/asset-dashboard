# SEO Generation-Quality — Canary Rollout Runbook

The generation-quality rebuild (P0–P5, PRs #1042–#1047) shipped **dark** behind the
per-workspace `seo-generation-quality` umbrella flag (global default **OFF**). Production
behaviour is byte-identical until you canary-flip a workspace. This runbook is the turnkey
flip + verify procedure. Plan: `docs/plans/2026-06-02-seo-generation-quality-plan.md`.
Contracts: `docs/rules/seo-generation-quality.md`.

## What the flag turns on (per workspace)

| Phase | Flag-ON behaviour |
|---|---|
| P1 | `buildKeywordUniverse` — full candidate pool, geo + language threaded into every provider call, MCP-seeded (**the Faros fix**) |
| P2 | un-suppress narrow-but-real keywords, token-subset page-prune, KD-0 long-tail, deterministic **backfill floor ≥6** (`backfilled` "Expanded pick") |
| P3 | Zod-validated, closed-set **membership-verified** prompting; never emits empty; client-signal contract (declined/requested/votes) |
| P4 | `predictedEmv` (admin-only, accrues always); **OV-derived priority tier** (cross-tier reorder); one OV-EMV gain basis; brief-cache bust |
| P5 | `keyword_gaps`/`topic_clusters`/`cannibalization` as **first-class recs**; scheduled-audit regen |

`opportunity-value-scorer` (global) is independent and NOT widened by this flag.

## 0. Canary on **staging** first

Point `DATA_BASE` at staging and run the whole procedure there before prod. Confirm
migrations 114–116 are applied (the CLI errors clearly if 114 is missing).

## 1. Pick the cohort

Three workspaces that exercise the changes: **Faros** (the sparse "2 gaps" case), **one
non-US workspace** (proves geo+language threading), **one broad-business workspace** (proves
un-suppress + OV re-tier). Find a workspace id from the admin URL (`/ws/:workspaceId`).

## 2. Flip the flag (per workspace)

The per-workspace override has no admin UI — use the CLI (it invalidates the flag cache
immediately):

```
npx tsx scripts/seo-genquality-canary.ts status <workspaceId>   # before
npx tsx scripts/seo-genquality-canary.ts on     <workspaceId>
npx tsx scripts/seo-genquality-canary.ts list                   # see all canaried workspaces
```

## 3. RE-RUN strategy generation (required — the flag only changes FUTURE generation)

Existing stored strategy + recs are unchanged until regen. Trigger a fresh run for the
workspace via the platform (the keyword-strategy "Generate" action, or the
`start_keyword_strategy_generation` MCP tool). The scheduled-audit path will also regen
going forward (P5).

## 4. Verify

- **`generationQuality` telemetry** — structured log line `keyword-strategy/generation-quality`
  (Pino JSON): `poolSize`, `suppressedCount`, `aiReturnedCount`, `backfilledCount`, `floorHit`.
  Expect `poolSize` up sharply vs. before; `floorHit:true` only on genuinely sparse sites.
- **Content gaps** — the client Strategy tab: **Faros 2 → ≥6**; non-US site shows
  correct-country volumes; gaps tagged "Expanded pick" are the backfill (honest).
- **OV-divergence shadow log / `OvDivergencePanel`** (admin) — for historical canary
  review rows only. Fresh runtime rows stopped writing once the legacy scorer was removed
  on 2026-06-05, but older rows still show the legacy-vs-OV ordering and tier-level
  divergence that gated the OV→tier thresholds.
- **New rec types** — `keyword_gap` / `topic_cluster` / `cannibalization` recs appear with
  correct labels/icons (not "Technical Fixes").
- **No leak / no error** — client never sees a raw `$/wk` or `predictedEmv`; no empty
  strategies; FAQ enrichment intact.

## 5. Success criteria → broaden, or roll back

- **Success:** Faros ≥6 gaps; geo-correct volumes for the non-US site; OV re-tier #1 sane in
  the divergence panel; no errors/leaks. Then sign off the OV→tier band thresholds
  (`OV_TIER_BANDS`, P4) and widen the cohort gradually.
- **Roll back** (any concern): `npx tsx scripts/seo-genquality-canary.ts off <workspaceId>`
  then re-run generation — the workspace reverts to the legacy pipeline. No deploy needed.

## 6. After the canary holds

- Decide the broader rollout (more workspaces, then consider a global default flip).
- **P6 GO/NO-GO** (semantic business-fit + GA4 conversion value → retires the `predictedEmv`
  CPC-proxy + swaps the calibration basis) — only if telemetry shows un-suppress+backfill is
  not hitting relevance targets.
- **P7 GO/NO-GO** (local-SEO strategy/recs track) — gated on local/hybrid workspace count;
  prereq is the `marketId` passthrough fix.

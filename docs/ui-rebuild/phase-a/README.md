# Phase A — Admin Fan-out Discovery (landed 2026-07-06)

Deliverables of the Phase A discovery workflow (run `wf_0670b5fb-92d`, 18 surfaces, adversarially
verified) plus the owner ratification pass of 2026-07-05. These gate the Phase A fan-out plan
(`docs/superpowers/plans/2026-07-06-ui-rebuild-phase-a-fanout.md`).

| File | What it is |
|---|---|
| `PHASE_A_DECISIONS.md` | **RATIFIED owner decisions** (AD-001…AD-007 + blocking-hole resolutions). This is the authoritative doc — where it conflicts with `owner-decisions.json`, this file wins. |
| `owner-decisions.json` | The full consolidated decision list (AD-001…AD-030) as *proposed* before ratification. AD-008…AD-030 are `per-surface-dispatch` / `C3-later` items resolved at each surface's ticket-cut. |
| `server-backlog.json` | 61 deduplicated server-side needs (SB-001…SB-061) with kind, consumers, effort, priority, and verified homes. |
| `completeness-critique.json` | The adversarial completeness pass — holes found + overall readiness verdict. Its three front-load conditions are satisfied by the ratification pass and by the fan-out plan's structure. |
| `surfaces/*.json` | Per-surface capability classification (18 surfaces): every legacy capability row resolved as ui-only / defer-candidate / server-need / open-question, with verifier-adjusted serverNeed homes. |

## Known supersessions (ratification overrides the proposed defaults)

- **AD-008 (Meeting Brief)** — `owner-decisions.json` proposed T1 carry-over as a Cockpit tab.
  The owner **retired Meeting Brief outright** on 2026-07-05 ("we no longer need the meeting
  brief"). See `PHASE_A_DECISIONS.md` blocking-hole #1. The cut-ticket (route-removal checklist,
  deep-link retargeting, ledger correction) is a wave-0 task in the fan-out plan.
- **AD-004 scope extension** — SB-002 (request→signal mint) is deferred under the same rationale
  as SB-001 (graduation seam): both wait for the one C3-era cross-surface contract.

## Reading order for ticket-cutters

1. `PHASE_A_DECISIONS.md` (ratified constraints)
2. Your surface's `surfaces/<name>.json` — consume the **verifier-adjusted** serverNeed homes,
   never the gatherer originals (see PHASE_A_DECISIONS.md standing instruction #1)
3. `server-backlog.json` rows your surface consumes
4. `owner-decisions.json` AD-008+ rows listing your surface (resolve at ticket-cut)

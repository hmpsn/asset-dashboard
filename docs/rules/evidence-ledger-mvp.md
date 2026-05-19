# Evidence Ledger MVP

Use this rule for content-post review surfaces that help humans verify claims against saved source context.

## Contracts

- The evidence ledger is **reviewer support**, not automated fact-checking.
- `factual_accuracy` and `no_hallucinations` remain human-review-required even when AI finds likely source candidates.
- Saved source packs may include:
  - `referenceUrls`
  - `realPeopleAlsoAsk`
  - `realTopResults`
- Claim-level evidence may attach likely candidates from those saved inputs, but the UI and API must never imply deterministic proof.

## Matching Rules

- Source matching should be conservative and degradable.
- If a saved source pack exists but no likely candidate overlaps the claim, return an explicit manual-review posture rather than inventing confidence.
- Malformed or partial saved source data must degrade to empty/manual-review candidates, not fail the review route.

## UI Expectations

- Reviewers should see:
  - the claim that needs verification
  - likely supporting sources when available
  - an explicit “no likely source found” posture when matching fails
- Copy must frame all evidence as assistive reviewer support.

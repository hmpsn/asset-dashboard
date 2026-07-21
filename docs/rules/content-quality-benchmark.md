# Content Quality Benchmark

The content-quality benchmark measures whether generation changes improve approved work without turning subjective prose judgment into an automated production gate.

## Authority and privacy

- The benchmark extends the existing AI reliability registry and matrix runtime audits. It is not a second scoring platform.
- Raw approved HTML, prompts, evidence, URLs, workspace IDs, client identity, and reviewer identity stay under gitignored `artifacts/content-quality-benchmark/` or an explicitly supplied local path.
- Committed data is limited to typed schemas, synthetic fixtures, content hashes, rubric versions, and owner-approved aggregate reports with no recoverable client text. Case IDs use opaque `case_NNN` values; descriptive client, location, service, or workspace labels are invalid.
- Approved matrix posts qualify only through exact human approval evidence tied to the current post revision. Approved copy sections and operator-curated external pages require explicit source selection. A merely generated or review-ready artifact is not approved copy.
- Benchmark reads never modify voice authority, copy samples, content artifacts, approvals, or evidence rows.

## Execution contract

- Default execution validates and scores supplied local cases only. Live candidate generation is a separate, opt-in action.
- There is no bulk workspace export. Any source importer requires explicit workspace and source IDs and fails closed when approval provenance is missing or stale.
- Persistence, approval, send, publish, and database-sync flags are rejected.
- Deterministic checks reuse canonical matrix contracts for headings, semantic tables, verified non-self internal links, placeholders, evidence, primary-keyword placement, and final word count wherever possible.
- Subjective ratings are blinded. Candidate labels must not expose provider, model, or variant identity to the reviewer.
- A factual-discipline failure cannot be hidden by a composite prose score.

### Local workflow

1. Build private cases under `artifacts/content-quality-benchmark/`. Use the pure qualification helpers in `scripts/content-quality-benchmark-sources.ts` so matrix references prove exact human approval, copy-section references include only explicitly selected approved rows, and matrix candidates carry the sanitized canonical audit and durable fingerprint.
2. Assign opaque labels such as `candidate_a` before presenting copy to a reviewer. Provider, model, and variant identity remain inside the private case file.
3. Record ratings in a separate private ratings file.
4. Produce a scrubbed aggregate:

```bash
npm run benchmark:content-quality -- \
  --cases artifacts/content-quality-benchmark/cases.json \
  --ratings artifacts/content-quality-benchmark/ratings.json \
  --baseline-label candidate_a
```

The default output is `artifacts/content-quality-benchmark/report.json`. An explicit output path is allowed because the report schema excludes raw copy, prompts, evidence, workspace identity, URLs, reviewer notes, and provider/model identity. The evaluator refuses to overwrite either private input and publishes the report through an atomic temporary-file rename.

## Recommendation gate

A report returns `no_recommendation` unless it includes at least six rated cases and complete ratings for every compared candidate. A candidate may be recommended only when:

- it receives at least 70% of recorded preferences;
- mean brand-fidelity and intent-satisfaction ratings are at least 4/5;
- it has zero factual-discipline failures;
- it has zero deterministic contract failures; and
- its mean estimated cost and prompt-token use do not exceed the baseline.

All recommendations remain advisory until the owner accepts the blinded comparison. Model changes remain operation-specific canaries and never follow automatically from benchmark output.

## Phase acceptance

- **Q0:** typed private/safe aggregate contracts, synthetic fixtures, read-only evaluator, explicit approved-source qualification, AI registry coverage, and no production generation changes.
- **Q1:** benchmark the prompt/voice-context candidate against the frozen baseline; stop adding architecture if the recommendation gate passes.
- **Q2:** allowed only when Q1 failures specifically identify page-level coherence, positioning, or brand-specificity gaps in more than 20% of rated cases.
- **Q3:** desktop workflow changes remain additive to existing MCP tools and preserve default full-response compatibility.

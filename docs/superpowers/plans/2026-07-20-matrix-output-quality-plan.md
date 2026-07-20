# Matrix Output Quality Implementation Plan

## Objective

Implement Obsidian open-work §2c-1 through §2c-5 as one backend-focused, staging-first PR while preserving every §Do-Not-Break gate.

## Dependency Graph

```text
Shared contracts + guardrails (commit first)
  ├─ A. Template/manifest/sanitizer implementation
  └─ B. Evidence/preview/census implementation
       A + B reviewed and integrated
         → C. Generation/audit/same-model revision
           → closeout docs + full verification
             → independent runtime/security review
             → independent quality/compat/performance review
```

Parallel agents receive exclusive file ownership and stop before requiring an unowned file. Shared types, schemas, guardrails, and the plan are committed before implementation dispatch. Model assignment follows the repository coordination guide: cheaper agents for fixture inventories/mechanical schema work, bounded implementation agents for isolated batches, and highest-reasoning agents for integration and both independent reviews.

## Phase 0 — Shared Contracts and Guardrails

- Add template render/internal-link contracts, typed link evidence, resolved manifest/target authority, and additive stored schemas.
- Update reusable generation-runtime rules and the roadmap pending item.
- Add red-to-green contract tests for new values and legacy round trips.
- Commit before parallel implementation.

Acceptance:

- Old stored templates/runs parse unchanged.
- New contracts are explicit and bounded.
- Frozen link authority participates in canonical fingerprints.
- No UI, MCP auth, approval, or staging data file changes.

## Phase A — Template, Heading, and Table Infrastructure

Exclusive ownership: template persistence/validation, block manifest, run repository schemas, rich-text sanitizer, and their focused tests.

- Resolve mixed heading locks from role + required AEO contract.
- Thread `renderAs` and link contract through the block manifest.
- Preserve semantic table tags in sanitization with no unsafe attributes.
- Validate declared table contracts and legacy default behavior.

Acceptance:

- Empty headings are not treated as an unlock mechanism.
- Rinse-shaped cost/definition/FAQ blocks stay literal; proof/CTA/non-AEO body unlock.
- Valid semantic tables survive sanitization; unsafe attributes do not.

## Phase B — Verified Link Evidence and Preview Authority

Exclusive ownership: evidence resolution, preview preparation, workspace page-census sidecar, and focused tests.

- Add stable link evidence requirements for declared included sections.
- Resolve typed link lists against one complete workspace census read.
- Reject external, unknown, duplicate, and self destinations before paid work.
- Freeze per-block links into preview targets/fingerprints.
- Preserve public read-service response compatibility.

Acceptance:

- Required section with zero verified links is blocked.
- Absolute and relative self-links fail.
- Only census-backed workspace destinations become frozen authority.
- Identical preview retries return identical targets/fingerprints and make no mutation or paid call.

## Phase C — Generation, Audit, and Revision Integration

Exclusive ownership: matrix generation stages, item audit, revision operation, AI operation metadata/budget integration, and focused/integration tests.

- Teach prompts and section assembly to honor heading locks, frozen anchors, and table rendering.
- Permit revision-added anchors only when they are in the frozen block allowlist.
- Replace vacuous page-wide link checking with block-scoped minimum/self/allowlist enforcement.
- Add semantic table structural audit.
- Route revision to the homogeneous accepted prose provider/model with fallback disabled.
- Explicitly evaluate grammatical person/register after revision.

Acceptance:

- Mixed headings, real anchors, and semantic table markup survive into the stored post.
- Zero links, self-links, non-allowlisted links, and malformed declared tables fail truthfully.
- Mixed/missing prose provenance or same-model revision failure preserves the original and yields editorial attention.
- Existing evidence placeholders, census, lifecycle, paid-work, send, approval, and publication gates remain unchanged.

## Closeout and Release Gate

- Update `FEATURE_AUDIT.md` and mark/sort the roadmap item only after implementation passes.
- Run focused suites, typecheck, Vite build, pr-check, hook lint, and the full Vitest suite.
- Inspect the diff for unowned/UI files, duplicate implementations, raw prompt/evidence logging, and contract drift.
- Obtain two independent reviews: runtime/spec/security and code-quality/backward-compatibility/performance. Fix and rerun any affected review.
- Keep work local until both reviews approve. Push and PR creation require explicit release action; staging verification precedes any main merge.

## Staging Acceptance (Owner-Controlled)

After merge to staging, explicitly update the Rinse template contracts and run free preview first. A paid regenerated whitening cell is a separate owner-authorized action and must show mixed heading styles, verified internal anchors, semantic comparison table markup, and pre-revision voice register. Human approval, send, and publish remain outside MCP generation.

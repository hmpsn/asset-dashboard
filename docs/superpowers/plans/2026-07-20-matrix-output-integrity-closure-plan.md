# Matrix Output Integrity Closure — Execution Plan

## Scope and ownership

Primary bounded context: `content-pipeline`. This PR combines M5 and essential M6 only. It changes
matrix generation/revision integrity and the shared content-post unification seam; it adds no UI,
migration, MCP tool, provider read, approval, send, or publication authority.

## Dependencies

```text
Task 0 shared contracts and red tests
  ├─ Task 1 heading integrity
  └─ Task 2 typed unification and guarded prompt policy
Task 1 + Task 2 → Task 3 matrix count/audit integration → verification/reviews
```

## Task 1 — Heading integrity (GPT-5.5)

Owns the heading helper, matrix stages/operations/repository/audit seams, and focused heading,
stage, repository, audit, and item-audit tests. It must prove validation before persistence and
after revision, exact locked headings, one-H2 unlocked derivation, and prior-artifact preservation
on invalid revision. It must not touch content-post unification files.

## Task 2 — Typed unification and prompt policy (GPT-5.4)

Owns `server/content-posts-ai.ts`, `server/content-posts.ts`, and their focused unit/integration
tests. It distinguishes short-input skips from invalid/provider failures, adds symmetric bounded
word guidance, treats secondary keywords topically only under the new flag, and leaves deterministic
primary placement untouched. It must not edit matrix domain files.

## Task 3 — Matrix count truth and final audit integration (GPT-5.5, sequential)

After the parallel diff checkpoint, add the final sanitized body ±10% audit, exact section/full-page
stored-count checks, welded-phrase revision guidance, and post-revision final note/count truth. Reuse
existing model-provenance gates; do not rebuild mixed-model skip behavior.

## Verification and release

Each task reads real signatures, runs its focused test red, implements minimally, reruns green, and
typechecks. Integration then runs focused matrix/content-post suites, typecheck, Vite build,
pr-check, hook lint, platform quick verification, and full Vitest. Two independent GPT-5.5 reviews
must approve runtime/spec/security and quality/backward-compatibility/performance before push.
Staging paid generation still requires a fresh preview and explicit owner confirmation; stop at
human review and never retry automatically.

## Implementation result

- Task 1 complete: shared heading inspection/synchronization is enforced before initial persistence,
  at both repository commit seams, after automatic revision, and in deterministic audit.
- Task 2 complete: unification outcomes are typed; the pre-unification draft is retained atomically;
  the natural-keyword and symmetric correction prompt is isolated behind the default-OFF canary flag.
- Task 3 complete: sanitized body counts use the frozen manifest's body-only target, stored section and
  page totals are exact, revision notes are recomputed, and welded phrasing is revision-driving under
  the canary policy.
- Paid staging acceptance remains intentionally pending owner confirmation and is not part of local CI.

# Matrix Output Quality Source Audit — 2026-07-20

Source: Obsidian `hmpsn studio/Insights Engine/spec-open-work-2026-07-16.md` §2c.

## Outcome

The five requested findings are real, but three proposed explanations need correction before implementation:

1. An empty `headingTemplate` does **not** create an unlocked heading. The manifest leaves the rendered heading null while retaining `locked: true`; the implemented resolution treats that as an explicit no-visible-heading contract rather than leaking an internal section ID or discovering the mismatch after paid work.
2. The observed comparison flattening does not prove the model omitted table markup. `sanitizeRichText()` currently removes `table`, `thead`, `tbody`, `tr`, `th`, and `td`, producing the exact concatenated output reported even from valid table HTML.
3. `internal-paths` has two independent blind spots: zero links pass vacuously, and absolute/protocol-relative links are skipped before workspace-path validation. That allows absolute self-links to pass.

The cross-model revision finding is confirmed in architecture but model names have advanced since the audit. Creative page prose is currently Claude-preferred through `callCreativeAI()`, while `content-matrix-item-revise` is hard-wired to the OpenAI structured-synthesis role. Existing post-revision audits do run, but deterministic `voice-guardrails` is lexical only and the model audit does not explicitly require grammatical-person/register preservation.

## Verified Existing Behavior

- `ResolvedPageBlockHeadingContract.locked` exists, but generation and census do not yet give it meaningful end-to-end behavior.
- The real Rinse template cannot classify desired heading behavior by `generationRole` alone: hero, cost, why-us, and related-care sections are all `body`. Its `aeoContract.required` distinguishes the literal/query-oriented cost block from conversion-oriented body blocks.
- HTML anchors survive sanitization and storage. The matrix brief does not provide a typed, block-scoped verified link allowlist, so generation receives generic evidence rather than usable destinations.
- The revision path removes every newly added anchor, including a legitimate repair, because it has no frozen verified allowlist against which to authorize additions.
- Top-level post provenance can describe the final SEO metadata call. Same-model revision must instead inspect the accepted prose execution chain.

## Guardrails

- Keep the evidence ledger authoritative and fail closed when required facts or destinations are absent.
- Preserve the URL census fail-closed behavior, `MATRIX_PAGE_TYPE_IDENTITY_ALLOWLIST`, start-time re-preview/fingerprint checks, revision fences, and all human-only approval/finalization boundaries.
- Never invent, infer, or silently truncate links, approved identity, voice authority, or facts.
- Do not mutate the staging database or run paid Rinse generation as part of implementation verification.
- Avoid current UI rebuild surfaces. Rich-text table editing support is a separate compatibility risk; this backend phase guarantees generated/read/export markup and must document that risk rather than editing the active UI.

## Recommended Design

- Heading policy: lock `answer_first`, `definition`, `faq`, and any template block whose AEO contract is required. Unlock `proof`, `cta`, and non-AEO `body`; keep `process` locked conservatively. Unlocked blocks retain the rendered template heading only as a prompt fallback/reference, not an output lock.
- Internal links: add an explicit per-section contract and a typed `link_list` evidence value. Preview resolves destinations against the complete workspace page census, rejects the target page itself, freezes the bounded per-block allowlist into the target/fingerprint, and generation renders anchors only from that authority.
- Tables: add an explicit `renderAs: 'prose' | 'table'` section contract, allow only semantic table tags through sanitization, prompt for semantic markup, and audit the declared table block structurally.
- Revision: use the exact homogeneous provider/model that produced accepted prose, disable cross-provider fallback for revision, and fail closed to editorial attention when prose provenance is mixed/missing or same-model revision is unavailable. Re-run lexical audit and the model audit with explicit person/register instructions after revision.

## Rinse-Shaped Acceptance Fixture

Use production-shaped metadata only: a service template with AEO definition/cost/FAQ blocks, conversion-oriented hero/proof/body/CTA blocks, one declared internal-link section, and one declared comparison table. Verification must prove mixed heading styles, real allowlisted anchors, self/zero-link rejection, semantic table markup survival, and homogeneous same-model revision without copying brand content into fixtures or logs.

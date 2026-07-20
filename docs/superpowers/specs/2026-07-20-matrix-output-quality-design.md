# Matrix Output Quality Design

## 1. Ownership Snapshot

- Feature name: Matrix output quality contracts (§2c-1 through §2c-5)
- Owning bounded context: `content-pipeline`
- Secondary context integrations: `brand-engine` authority, unified AI dispatcher, workspace page census, MCP generation projection
- Behavior type: additive contracts plus correctness repairs

## 2. Route / API Surface

- Server route modules touched: `server/routes/content-templates.ts`
- Public endpoints: existing content-template create/update/read endpoints only; no new route
- MCP surface: existing template and matrix tools inherit additive schema fields; no new tool
- Frontend API wrappers/consumers: none in this phase
- Paid/human boundary: preview remains free and side-effect-free; start remains explicitly owner-authorized; page approval remains HTTP-only and human-only

## 3. Shared Contracts

- `TemplateSection.renderAs?: 'prose' | 'table'`; absence preserves legacy prose behavior.
- `TemplateSection.internalLinkContract?: { minimum: number }`; presence declares that an included block requires a bounded number of verified internal anchors.
- `GenerationEvidenceValue` gains typed `link_list` values containing canonical href and anchor text.
- Resolved template blocks and optional omissions retain rendering/link contracts.
- Prepared targets freeze block-scoped verified links so audit, generation, revision, fingerprinting, and retries use the same authority.
- Stored template and run JSON schemas are updated in lockstep. No database migration is required because these are additive fields in existing JSON documents.

### Heading policy

`locked` is resolved deterministically from the existing role plus AEO contract:

- locked: `answer_first`, `definition`, `faq`, any AEO-required block, and `process`;
- unlocked: `proof`, `cta`, and non-AEO `body`;
- system introduction/conclusion remain unlocked.

Locked blocks must use the manifest-rendered literal. Unlocked blocks must return a non-empty generated heading that agrees between section metadata and the first heading in content and is not silently replaced by the literal fallback.

### Internal-link authority

An internal-link section is explicit, not inferred from prose. For every included declared section:

1. the evidence ledger exposes a stable section requirement;
2. the resolution accepts only typed links;
3. preview canonicalizes the destination against the complete live/published workspace census;
4. preview rejects unknown, duplicate, external, and target/self destinations;
5. preview freezes the bounded allowlist into the cell target and fingerprint;
6. generation/revision may emit anchors only from the frozen allowlist;
7. audit requires at least the declared minimum in that block and rejects self or non-allowlisted anchors.

Optional sections retain existing `optional_omit` semantics. The contract narrows required evidence; it never bypasses it.

### Same-model revision

Find the accepted prose execution records for introduction, section, conclusion, and unification operations. Revision is allowed only when all accepted prose contributors share one provider/model. Dispatch the revision with that exact pair, no fallback, and provider-aware fingerprints/reservations. Mixed/missing provenance or provider failure preserves the original and produces `needs_attention` rather than paying for a cross-model rewrite.

The post-revision audit prompt explicitly checks grammatical person, reader address, register, tone boundaries, and anti-patterns. The deterministic lexical guard remains a fast fail-first check; no unreliable pronoun-ratio heuristic is introduced.

### Semantic tables

`renderAs: 'table'` requires a semantic table in the matching block. Sanitization permits table structure tags but no table styles, event attributes, or arbitrary classes. Deterministic audit requires one table with header cells, data cells, and at least two rows; substantive text checks remain in force.

## 4. Query Cache + Real-Time Contract

- No new query key or event.
- Existing template mutations and generation state broadcasts remain unchanged.
- No new durable mutation outside existing template/run/post writes.

## 5. Test Ownership

- Contract tests: template/evidence/resolved-run schema round trips and legacy absence parity.
- Unit tests: heading lock resolution, sanitizer semantic table preservation, typed link resolution, self/unknown/zero-link rejection, table structural audit, same-model provenance selection and mixed-provenance fail-closed behavior.
- Integration tests: production-shaped matrix preview/generation fixtures with mixed heading modes, frozen links, table markup, unchanged retries/fingerprints, and no side effects during preview.
- Regression tests: blocked requirements, never-invent placeholders, URL census fail-closed behavior, page approval/MCP separation, and revision fences.

## 6. Verification Commands

- Focused red-to-green Vitest suites per contract and implementation batch
- `npm run typecheck`
- `npx vite build`
- `npm run pr-check`
- `npm run lint:hooks`
- `npx vitest run`

No `db:sync-staging`, staging data import, paid generation, approval, send, or publish is part of automated verification.

## 7. Open Questions / Risks

- Existing TipTap editing does not register table extensions. This phase must prove generated/read/export markup safety and record editor round-trip support as follow-up unless the current editor already preserves semantic tables without modification.
- Existing templates receive no inferred internal-link/table contracts. The Rinse template must be explicitly revised and human-approved before a paid regeneration smoke.
- `generationRole` alone is insufficient for cost-versus-conversion `body` blocks; `aeoContract.required` is the verified discriminator.

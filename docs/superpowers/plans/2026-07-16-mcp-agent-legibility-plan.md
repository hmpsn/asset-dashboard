# MCP agent-legibility implementation plan

Date: 2026-07-16
Target: `staging`
Owner: MCP boundary (`server/mcp/`)

## Dependency graph

```text
P1 error helpers and contract tests
  -> P2 migrate read-only families
  -> P3 migrate mutation/generation families
  -> P4 flip registry contracts and update operator guidance
  -> P5 full verification and adversarial review
```

Each phase is part of one independently complete PR. The later casing-alias
change is deliberately excluded because it changes authorization semantics.

## P1 — Lock the public error contract

Acceptance checklist:

- Add small branded constructors for validation, not-found, conflict,
  precondition, rate-limit, and internal failures.
- Field-addressed validation keeps `field_path` and `constraint` details.
- Constructors redact prohibited detail keys and likely credentials through the
  existing `mcpJsonV1Error` boundary.
- Tests fail if an arbitrary/unbranded error result crosses a `json_v1` family.

## P2 — Read-only families

Migrate workspaces, intelligence, insights, content reads, legacy brand reads,
clients, and analytics reads.

Acceptance checklist:

- Missing resources use `not_found`.
- Invalid arguments use `validation_failed` with actionable safe detail.
- Unexpected read failures return a generic `internal_error`; exception text is
  not returned.
- Existing successful response shapes do not change.

## P3 — Mutation and generation families

Migrate keyword, content, recommendation, content-generation, schema, and job
actions.

Acceptance checklist:

- Revision/state conflicts use `conflict`.
- Missing prerequisites use `precondition_failed`.
- Throttling uses `rate_limited` where applicable.
- Domain-safe messages remain actionable, while raw provider/AI/DB exceptions
  return generic `internal_error`.
- Human approval/finalization/publish gates are unchanged.

## P4 — Registry and guidance

Acceptance checklist:

- All 18 registered families use `json_v1`; the legacy tool count is zero.
- Instructions and README no longer describe a mixed error surface.
- Template/matrix descriptions explicitly say placeholders use one brace pair,
  with `/{service}-{city}` as the example.
- Existing tone, intake-cap, and pending-approval documentation remains tested.

## P5 — Verification

Run focused MCP tests first, followed by:

```text
npm run typecheck
npx vite build
npm run pr-check
npm run lint:hooks
npx vitest run
```

Then perform an independent adversarial diff review focused on secret leakage,
wrong stable codes, lost field details, registry census drift, and accidental
weakening of human gates. Fix every material finding before pushing the PR.

## Follow-on productized-template PR sequence

This PR is the safety/legibility prerequisite for the attached productized-template
spec. The remaining work ships as small staging-first PRs in this order:

```text
PR A unified MCP errors + placeholder guidance (this plan)
  -> PR B update_content_matrix_cell MCP wrap + URL/collision integrity
  -> PR C evidence-driven optional template sections + visible omissions
  -> PR D copy-on-instantiate per-vertical template library
  -> PR E auth-safe deprecated camelCase workspace aliases
```

- PR B reuses the existing `updateMatrixCell` service and revision guard; it does
  not add a second matrix mode or bypass URL validation.
- PR C defaults `optional` to false, derives section requirements from existing
  generation roles, includes omissions in manifest fingerprints, and keeps pages
  with zero resolved blocks or no required primary CTA blocked.
- PR D uses a vertical tag and copy-on-instantiate ownership. Library edits never
  mutate an approved workspace instance; promotion remains an explicit operator act.
- PR E is isolated because workspace aliases affect authorization scope resolution.
  Conflicting spellings fail closed, and snake_case remains canonical.

Every PR preserves voice finalization, evidence, approval, review, send, and
publication gates, and must merge green to `staging` before the next PR starts.

### PR B implementation closure

Dependency order: stored cell provenance and URL validation → resolver support →
snake-case MCP adapter → discovery/instructions → boundary tests. The adapter
allows only `target_keyword`, `planned_url`, `variable_values`, and
`expected_schema_types`, requires the exact current cell revision, and delegates
to the existing single-cell writer. Intentional URL overrides remain safe
workspace-relative paths and unique across every durable matrix cell; ordinary
pattern drift still blocks generation. Matrix-definition regeneration clears the
override marker. The mutation advances only the target cell, invalidates stale
content-pipeline context, broadcasts the existing content update event, records
MCP provenance, and creates no generation, approval, send, or publish action.

Acceptance checklist:

- [x] A one-dimensional matrix cell accepts an arbitrary keyword and URL that no
  shared pattern could produce.
- [x] Unsafe URLs, same-matrix collisions, cross-matrix collisions, and stale
  cell revisions fail without mutation.
- [x] Resolution treats an explicitly overridden URL as the intended target but
  preserves the live-page and workspace collision census.
- [x] Real HTTP/MCP dispatch returns the updated cell and exact advanced revision.
- [x] Registry, workspace-scope, instructions, and tool-count contracts include
  the new tool; no human gate changes.

### PR C implementation closure

Dependency order: section contract and stored-schema compatibility → deterministic
manifest omission → current evidence read-through → preview/MCP projection →
boundary tests. `optional` remains absent/false for existing sections. New optional
sections use one stable `matrix-cell:<cell_id>:section:<section_id>` requirement;
missing evidence is an `optional_omit`, not a paid-work blocker or placeholder.
Supplying exact factual evidence advances the cell revision and includes the block
on the next resolution. New fingerprints cover the omission census, while legacy
stored manifests without that field retain their original fingerprint contract.

Acceptance checklist:

- [x] Missing optional-section evidence omits only that section and reports its
  stable requirement ID and reason in resolution and preview.
- [x] Current exact section evidence restores the block after a cell-revision
  advance; no per-cell inclusion toggle exists.
- [x] Required sections retain existing behavior, and an all-optional generation
  template is rejected.
- [x] Omitting an optional primary CTA transfers the one required primary CTA to
  the system conclusion.
- [x] Legacy upgrade proposals default `optional` to false, and old durable
  fingerprints remain readable.
- [x] MCP create/update discovery exposes the section marker and omission flow;
  voice, evidence, approval, review, send, and publish gates are unchanged.

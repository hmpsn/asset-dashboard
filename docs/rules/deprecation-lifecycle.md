# Deprecation Lifecycle Discipline

Wave 5 item: `platform-reliability-deprecation-discipline`

Source of truth: `scripts/deprecation-lifecycle.ts`

## Lifecycle taxonomy

Every deprecated/retired capability should be explicitly tracked in one of these states:

- `deprecated`
- `hidden`
- `read-only`
- `migrated`
- `removed`

This avoids cleanup drift where old aliases and retired surfaces silently return.

## Contract requirements

Each registry entry must include:

1. replacement guidance
2. at least one explicit contract with code evidence and test evidence
3. state-specific enforcement:
   - `deprecated` → redirect or safe-failure contract
   - `hidden` → visibility-gate contract
   - `read-only` → read-only-enforcement contract
   - `migrated` → migration contract + redirect/safe-failure
   - `removed` → safe-failure contract
4. human verification for `deprecated`, `migrated`, and `removed` entries

## Operating flow

When introducing or retiring any major surface:

1. add/update an entry in `DEPRECATION_REGISTRY`
2. point evidence at real files/routes/components
3. point test evidence at real automated coverage
4. run:

```bash
npm run verify:deprecations
npm run verify:deprecations -- --markdown
npx vitest run tests/unit/deprecation-lifecycle.test.ts
```

## Why this exists

Without a deprecation registry, we get additive-only behavior:

- old URLs kept forever with no owner
- retired endpoints reintroduced accidentally
- partially migrated flows with no sunset decision
- hidden capability debt that is never reviewed

This contract keeps cleanup measurable and auditable in each platform-health cycle.

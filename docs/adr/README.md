# Architecture Decision Records

This directory tracks major architecture choices in a lightweight format.

## ADR Format

Each ADR should stay concise and include these sections:

- `## Decision`
- `## Context`
- `## Alternatives Considered`
- `## Consequences`

## Naming

- File format: `NNNN-short-kebab-name.md`
- Keep ADRs append-only; if a decision is superseded, add a new ADR and reference the old one.

## Verification

- Run `npm run verify:adr-log` to check ADR structure and required topic coverage.

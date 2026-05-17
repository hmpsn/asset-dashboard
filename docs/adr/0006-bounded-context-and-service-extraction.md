# ADR 0006: Platform Ownership Uses Bounded Contexts and Route-to-Service Extraction

## Decision

Feature ownership is modeled by bounded context, and overloaded route logic is gradually extracted into context-owned service/domain modules.

## Context

Large route files accumulated mixed concerns, making regressions more likely and onboarding slower.

## Alternatives Considered

- Keep adding behavior directly to existing route handlers.
- Attempt a one-shot full-repo folder migration.

## Consequences

- Incremental extraction preserves behavior while improving ownership clarity.
- Plans and PRs should name primary/secondary contexts explicitly.
- Shared coordination files remain intentionally constrained and high-scrutiny.

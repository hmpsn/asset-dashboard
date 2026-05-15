# ADR 0002: Workspace Intelligence Uses Slice Assemblers

## Decision

Cross-feature AI context and workspace intelligence are assembled through typed slice modules (`server/intelligence/*-slice.ts`) orchestrated by `buildWorkspaceIntelligence()`.

## Context

Ad hoc reads from route handlers made AI context incomplete and hard to reason about as data sources grew.

## Alternatives Considered

- Keep direct reads in every consumer.
- Build one monolithic intelligence builder with no slice boundaries.

## Consequences

- Data onboarding follows a repeatable slice contract.
- Shared types in `shared/types/intelligence.ts` remain the boundary.
- Missing slice wiring is a known class of regressions and must be tested/verified during feature work.

# ADR 0004: Client and Admin Route Surfaces Stay Explicitly Split

## Decision

Client/public routes and admin/internal routes remain explicitly separated, with distinct auth expectations and serialization contracts.

## Context

Mixing client/admin access patterns created confusion around auth middleware, route protection, and response shape drift.

## Alternatives Considered

- Unify client/admin APIs under a single generic route layer.
- Duplicate business logic separately in fully isolated services.

## Consequences

- Auth logic is easier to reason about (`APP_PASSWORD`/client session/JWT boundaries remain explicit).
- Public serialization paths require dedicated testing and activity logging rules.
- Route work must identify which surface is being changed before implementation.

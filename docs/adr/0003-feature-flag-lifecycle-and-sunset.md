# ADR 0003: Feature Flags Require Lifecycle Metadata and Sunset Path

## Decision

Every feature flag lives in a typed catalog with lifecycle metadata, review cadence, roadmap linkage, and explicit removal conditions.

## Context

Flags were historically easy to add but easy to forget, creating split-path complexity and stale behavior in production.

## Alternatives Considered

- Keep boolean-only flags without governance metadata.
- Track lifecycle status in separate docs disconnected from code.

## Consequences

- Operators can audit stale flags with `verify:feature-flags`.
- Promotion/sunset work becomes explicit roadmap work instead of incidental cleanup.
- New flags must include owner, rollout target, and removal contract at creation time.

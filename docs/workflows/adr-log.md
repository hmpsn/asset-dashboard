---
description: Lightweight architecture decision record workflow
---

# ADR Log Workflow

Wave 5 item: `platform-org-adr-log`

## Why

Capture major architecture choices in one place so future contributors understand intent, tradeoffs, and consequences without archaeology.

## Where ADRs Live

- Directory: `docs/adr/`
- Format guide: `docs/adr/README.md`
- Verification: `npm run verify:adr-log`

## ADR Authoring Rules

Keep each ADR short and include exactly:

- `## Decision`
- `## Context`
- `## Alternatives Considered`
- `## Consequences`

## When To Add A New ADR

Add or update ADRs when decisions materially affect:

- long-running background jobs
- intelligence/context assembly strategy
- feature-flag rollout/sunset contracts
- client/admin/public route boundary behavior
- AI dispatch/provider strategy
- bounded-context ownership and service extraction

## Verification Flow

1. Add or update ADR markdown in `docs/adr/`.
2. Run `npm run verify:adr-log`.
3. Include ADR references in roadmap notes/PR summary for architecture-impacting work.

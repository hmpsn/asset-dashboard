# Platform Domain Event Definitions

This is the canonical reference for workspace-scoped domain events in `WS_EVENTS`.

## Source Of Truth

- Registry data + report builder: `scripts/platform-domain-event-definitions.ts`
- Advisory CLI report: `scripts/report-domain-event-definitions.ts`
- Verification script: `npm run verify:domain-events`

The registry defines, per `WS_EVENTS` key:

- owning bounded context
- producer route/service surfaces
- payload contract note
- expected React Query invalidation surfaces
- admin/client listener surfaces
- related activity types

## Intended Use

- Use this map during planning/review when a mutation emits or consumes workspace events.
- Keep event definitions in sync with `server/ws-events.ts`.
- Use report output as advisory evidence for drift, not as a hard CI blocker in Wave 3.

## Required Contracts

- Every `WS_EVENTS` key must have exactly one registry definition.
- Producer/listener discoveries must not introduce orphan event names.
- Missing mapping details are reported as advisory structural gaps.

# ADR 0001: Long-Running Generation Uses Background Jobs

## Decision

All long-running admin generation flows run through the background jobs platform (`server/jobs.ts` + `/api/jobs`) instead of in-request execution.

## Context

Multi-page crawls and repeated AI calls can exceed request time budgets and create inconsistent UX when they fail mid-response.

## Alternatives Considered

- Keep synchronous route handlers and increase timeouts.
- Add one-off queue logic per feature.

## Consequences

- Job progress/cancellation is consistent across product surfaces.
- Route handlers stay thin and return `jobId`.
- New long-running work must include job labels, result behavior, and background-task UI wiring.

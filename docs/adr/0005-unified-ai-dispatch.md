# ADR 0005: AI Calls Route Through Unified Dispatch by Default

## Decision

New product AI integrations default to `callAI()` in `server/ai.ts`, with direct provider helpers reserved for explicit specialized paths.

## Context

Provider-specific calls spread across route handlers made model policy, cost tracking, and failure behavior inconsistent.

## Alternatives Considered

- Keep direct `callOpenAI` and `callAnthropic` usage everywhere.
- Abstract all AI calls behind one opaque wrapper with no escape hatches.

## Consequences

- Provider selection and defaults are centralized.
- Cost/perf policy can evolve in one place.
- Specialized paths still exist, but usage should be justified and documented.

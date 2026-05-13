# Feature-Class Definition of Done

Use this after the normal feature checklist to decide whether a PR is actually ready. Pick every class that applies; client-facing AI generation with a write route must satisfy all three relevant sections.

This is guidance, not a new automated gate. Automated rules still live in `docs/rules/automated-rules.md`.

## All Work

- Owning bounded context is named from `docs/rules/platform-organization.md`.
- Integration surfaces are checked in `docs/rules/platform-integration-surfaces.md`.
- Existing feature, component, endpoint, and helper patterns are searched before adding new ones.
- Verification commands are listed in the PR summary.
- Roadmap items are marked done only for work that actually shipped; incomplete sprint items remain pending.

## UI-Only Work

- Uses existing primitives before adding new markup.
- Loading, empty, error, mobile, accessibility, and keyboard states are covered where relevant.
- Color usage follows the four laws of color and shared tokens.
- Visual/mobile verification is performed when the surface is user-visible.
- Required verification: `npm run typecheck`, `npx vite build`, relevant component/unit tests.

## Admin CRUD

- Route validation uses `validate()` and Zod where request data crosses the server boundary.
- Writes are workspace-scoped and preserve metadata for delete-then-reinsert flows.
- Significant changes call `addActivity()`.
- Mutations that change visible workspace data broadcast via `broadcastToWorkspace()` with event constants.
- Frontend mutations invalidate the matching React Query keys and listen to workspace events where realtime matters.
- Required verification: route integration test, relevant store/unit tests, `npx tsx scripts/pr-check.ts`.

## Route Writes

- Read-before-delete is used for delete operations.
- State transitions use `validateTransition()` when the domain has a state machine.
- Response shape matches the consuming API wrapper and shared types.
- Public/client exposure is checked separately from admin reads.
- Required verification: integration test against the actual route handler and any public/client read path that consumes the result.

## Client-Visible Features

- Client copy is outcome-oriented and avoids admin jargon.
- Premium or tier-limited behavior is wrapped at the narrowest useful point.
- Public endpoints expose only client-safe fields.
- Actual client read-path tests cover data that affects what clients see.
- WebSocket listener/broadcast pairs invalidate the relevant `client-*` query keys.

## AI Generation

- New generation paths use `callAI()` unless a documented direct-provider exception applies.
- Prompt output format matches frontend/server parsing and rendering.
- Factual or provenance-sensitive content follows `docs/rules/content-quality-grounding.md`.
- Long-running generation uses the background job platform.
- Error, timeout, fallback, and malformed-output behavior is tested.
- Cost/model/provider assumptions are named in the PR notes when material.

## Background Jobs

- Job type is registered in shared background job metadata with label, cancellability, and result behavior.
- Route returns `{ jobId }` for long-running work and does not continue hidden post-response generation without an approved hatch.
- Progress, cancellation, completion, failure, and result visibility are covered.
- Admin/client surfaces show job state through the shared task panel or context-appropriate status UI.
- Required verification: job lifecycle unit/integration tests plus a route test for the job-start endpoint.

## Analytics / Intelligence

- New data sources are wired through intelligence slices, not direct ad hoc reads.
- Shared insight/intelligence types and Zod schemas stay in lockstep.
- Insight data renderers handle the typed payload without `Record<string, unknown>` fallbacks.
- Enrichment fallbacks degrade gracefully and do not block insight storage.
- Required verification: slice population, insight shape, and consuming read-path tests.

## Approval / Inbox

- Inbox routing follows Decisions, Reviews, and Conversations rules.
- `NormalizedDecision` is used for surfaces that handle both client actions and approval batches.
- Client/admin mutation flows include activity logging and broadcast/listener invalidation.
- Deep links using `?tab=` satisfy both halves of the sender/receiver contract.
- Required verification: route tests for mutations, public/client read-path tests, and relevant component tests.

## Billing

- Stripe Checkout is used rather than Payment Intents.
- Webhooks are idempotent and update workspace billing/tier state consistently.
- Tier gates update when workspace billing state changes.
- Encrypted config and auth boundaries are not bypassed.
- Required verification: Stripe route/webhook tests, entitlement/tier-gate tests, and public/client visibility tests where applicable.

## Integrations

- Provider calls use existing adapters and normalized provider interfaces.
- External API errors record failed/error state rather than phantom success.
- Secrets/tokens are never exposed through public/client reads.
- Long sync or CMS write work uses jobs when it can outlive a request.
- Required verification: mocked provider success/failure tests and consuming route tests.

## PR Closeout

- `FEATURE_AUDIT.md` is updated for feature work.
- `data/roadmap.json` is updated only for completed roadmap items, then `npx tsx scripts/sort-roadmap.ts` is run.
- `BRAND_DESIGN_LANGUAGE.md` is updated if UI color/component patterns changed.
- Full platform verification is chosen based on risk; at minimum run the commands listed by the relevant feature classes.

# PR13 Keyword Strategy Quality UX Guardrails

Date: 2026-05-20
Owner: analytics-intelligence
Scope: Keyword strategy explainability, refresh summary, action-loop UX

## Grounding

This PR builds on:
- `CLAUDE.md` / `AGENTS.md` phase-per-PR, shared-type, no-publishing, broadcast, and UI primitive rules.
- `BRAND_DESIGN_LANGUAGE.md` and the styleguide color laws: teal actions, blue data, emerald success, amber caution, red risk, no purple in client-facing strategy views.
- PR9 keyword operating-loop audit.
- PR11 rank-tracking lifecycle fields.
- PR12 shared keyword-intelligence deterministic rules.
- The keyword strategy refactor/signal hygiene audit and sanitizer work.

## Product Boundary

PR13 is the visible explanation layer. It must not:
- change strategy ranking or scoring rules;
- regenerate strategy automatically;
- publish content or write live SEO metadata;
- implement local SEO;
- hard-delete historical rank data or analytics insights.

## Data Boundary

New data crossing API boundaries must be optional and backward-compatible. The shared contract is additive:
- refresh summary;
- keyword explanation;
- tracking/action status;
- raw evidence posture.

The server may derive this from existing strategy, page keyword, content gap, keyword gap, feedback, and rank-tracking data. No DB migration is expected for this phase.

The PR13 payload is a read-time projection, not a new mutable store. Mutations that already refresh strategy, page keywords, rank tracking, feedback, or content gaps remain responsible for broadcasting and invalidating their existing query keys; PR13 must not introduce a separate cache key that can drift from those source records. Client/public reads should stay lightweight and avoid workspace-intelligence assembly unless a future phase adds explicit caching.

## UX Rules

Admin UX may expose raw provider evidence, but must label it as evidence rather than a selected strategy action. Client UX should translate the same data into:
- what changed;
- what we are watching;
- what we recommend reviewing next.

Every CTA must be safe. “Generate brief,” “Review page,” “Track keyword,” and “Open Page Intelligence” style actions are allowed. Automatic publishing, live metadata writes, and silent tracking changes are not allowed.

## Acceptance Checklist

- Admins can answer what changed, why a keyword exists, what is tracked, and what action comes next.
- Clients see strategy movement and next steps without raw-provider jargon.
- Raw competitor gaps remain visible only as source evidence.
- Deprecated/replaced strategy-owned tracked keywords stay out of active rank views but remain explainable through summary counts.
- Existing strategy and diff clients remain safe if optional PR13 fields are absent.

# Keyword Command Center

The Keyword Command Center is the admin operating layer for keyword lifecycle management. It lives at `/ws/:workspaceId/seo-keywords` and owns the question, "What keywords exist, where did they come from, what state are they in, and what safe action comes next?"

## Surface Boundaries

- **Command Center owns lifecycle operations:** track, pause, retire, decline, restore, and promote raw evidence into the active operating loop.
- **Rank Tracker remains measurement-only:** ranking history, current positions, and snapshot capture belong there. Do not add broad management workflows to Rank Tracker when the action is keyword lifecycle state.
- **Strategy remains generation/explanation:** strategy can explain selected terms and regeneration diffs, but it should not become the primary keyword manager.
- **Page Intelligence remains page-first:** it can show a mapped page keyword and hand off to the Command Center, but keyword-universe filtering belongs in the Command Center.
- **Client Strategy remains client-safe:** client feedback and tracked keywords feed the Command Center, but admin-only raw/provider evidence labels must not leak into client copy.

## Data Contract

- Use `shared/types/keyword-command-center.ts` for rows, filters, actions, counts, tracking state, feedback state, and next-action payloads.
- Use `normalizeKeywordForComparison()` from `shared/keyword-normalization.ts` for Command Center joins and touched keyword lifecycle comparisons.
- Preserve raw display strings for user-facing keyword labels and provider payloads. Canonical normalization is for equality, dedupe, and map keys.
- Raw provider evidence must be labeled as evidence, not a selected strategy action.
- Inactive lifecycle rows are preserved for auditability; active rank views should continue hiding paused/deprecated/replaced rows by default.

## Mutation Rules

- No hard deletes from the Command Center. "Remove" means lifecycle retirement or feedback suppression.
- Manual, pinned, and client-requested keywords are protected from accidental retirement or decline. Actions that target them must require explicit confirmation/force semantics.
- Mutations must preserve rank history and metadata whenever possible.
- Mutations must broadcast the affected surfaces:
  - `WS_EVENTS.RANK_TRACKING_UPDATED` for tracking lifecycle changes.
  - `WS_EVENTS.STRATEGY_UPDATED` when strategy/feedback consideration changes.
  - `WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED` when feedback/suppression can affect strategy signals.
- Mutations must add activity entries for admin-visible lifecycle changes.
- No Command Center action may publish content, write live metadata, or regenerate strategy automatically.

## UI Rules

- Use shared primitives (`PageHeader`, `SectionCard`, `Badge`, `Button`, `ClickableRow`, `EmptyState`, form primitives) before hand-rolling UI.
- Teal is for safe actions and active filters, blue is for read-only metrics, amber is for review/protection posture, red is for decline/retire.
- The detail drawer must explicitly distinguish:
  - selected strategy keyword,
  - tracked keyword,
  - raw provider evidence,
  - client/admin feedback,
  - retired/declined lifecycle state.
- Handoffs should navigate with context only:
  - Generate brief → content planning/brief flow.
  - Review page → Page Intelligence.
  - View rankings → Rank Tracker.

## Follow-Up Boundary

The Command Center includes only the minimal shared keyword normalizer needed by this surface. The broader `intel-quality-keyword-normalization-route-reliability-hardening` roadmap item remains responsible for migrating legacy keyword equality variants and keyword-loop async routes across the repo before local SEO work begins.

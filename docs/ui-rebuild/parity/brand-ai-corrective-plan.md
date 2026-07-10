# Brand & AI Corrective Implementation Plan

This is the completed implementation record for the Brand & AI parity pass. It supersedes the earlier inline readiness-panel alignment slice.

Status: `owner-approved`; Joshua approved V1–V7 as recommended, reviewed the final live comparison, said “It looks great,” and deferred finer feedback to the registry-wide review.

## Goal

Make the rebuilt Brand & AI page match the prototype's modal-first interaction model while preserving existing data contracts, URL aliases, and legacy panel behavior.

Follow-up alignment note: the implemented overview also removes the legacy top tab strip. Cockpit cards, section rows, and four non-overlapping Brand identity disclosures are the visible launch surface; `?tab=` remains the invisible state/deep-link contract.

## Dependency Graph

1. Confirm modal contract from prototype files.
2. Add failing component tests for modal-open deep links.
3. Introduce modal state in `BrandAiSurface`.
4. Move child panel rendering from inline active area into rebuilt overlays.
5. Preserve URL writes, aliases, and `focus` params.
6. Run browser smoke on desktop, mobile, modal, and deep-link states.

## File Ownership

Owned:

- `src/components/brand-ai-rebuilt/BrandAiSurface.tsx`
- `tests/component/brand-ai-rebuilt/BrandAiSurface.test.tsx`
- `FEATURE_AUDIT.md`
- `docs/ui-rebuild/parity/brand-ai-contract.md`

Reused, not rewritten:

- Legacy Brand child panels.
- Existing Brand API clients, query keys, and feature flag hook.
- Existing DS overlay primitives and focus/scroll-lock helpers.

Must not touch:

- Backend routes.
- Migrations.
- Shared data contracts.
- Client-facing components.
- Route ids or `REBUILT_SURFACES` key names.

## Implementation Notes

- Treat `activeTab` as modal-open state, not inline section state.
- Keep the overview as the default page body.
- Do not reintroduce the top `LensSwitcher`/tab strip on the overview; the prototype uses grouped context sections as navigation.
- Distribute the 17 Brand identity generators exactly once across their prototype groups while retaining one Identity editor home.
- Use DS overlay primitives for focus management and close behavior.
- The modal body may carry existing panels as-is in this corrective slice.
- If a panel needs a richer bespoke modal shell later, defer that as visual polish after interaction parity.

## Visual Pass 1 — 2026-07-10

Completed without changing route or capability contracts:

- Removed the loaded-state duplicate PageHeader and placed Refresh context exactly once in the rebuilt topbar.
- Matched the prototype's 1140px desktop canvas and opening/body vertical landmarks at 1440×900 and 1600×1000.
- Restored first-viewport density by clamping overview excerpts while retaining full editor content.
- Changed Brand workflow modals from DS `xl` to DS `lg` and removed the synthetic workflow cards that created triple framing.
- Fixed Brandscript's nested interactive controls.
- Preserved all nine modal receivers, aliases, focus handling, exact-once child mounts, and `ui-rebuild-shell` gating.

## Owner-Approved Final Pass — 2026-07-10

Implemented V1–V7 exactly as approved:

- Removed the inferred overall percentage/readiness and promoted truthful configured-count evidence.
- Restored all 17 generators in the source-exact 7 / 2 / 5 / 3 group mapping.
- Added atomic validated Identity focus while preserving bare/invalid full-library behavior.
- Added and adopted the 680px DS `workflow` Modal size without changing existing sizes.
- Focused the real existing Brandscript only from the overview launch; direct deep links retain the library.
- Preserved real production interiors/actions and documented prototype-only data/backend exceptions.
- Retained Refresh in the topbar, Discovery in the rail, and omitted unsupported Preview.
- Retained the existing 13.5px/700 rail-title role as the approved 1px exception.

The final paired screenshots, fresh Sol `PASS`, and Joshua's live visual approval close this surface for the ordered parity sequence. Finer feedback remains a registry-wide circle-back, not a revocation of this approval.

## Acceptance Tests

Write or update tests before implementation so the current inline page fails for the intended reason:

- `?tab=brandscript` opens a modal/dialog.
- `?tab=eeat-assets` opens a modal/dialog.
- `?tab=business-profile&focus=business-profile-section` opens the Business Footprint modal and keeps focus intent.
- Closing the modal clears modal state without breaking the route.
- Overview has no top tab radiogroup.
- Four group disclosures expose all 17 generators exactly once and write validated focused Identity URLs.
- Only one copy of each legacy panel is mounted.
- The loaded page passes the rebuilt a11y floor.

## Verification Gates

- `npx vitest run tests/component/brand-ai-rebuilt/BrandAiSurface.test.tsx`
- `npm run lint:hooks`
- `npm run typecheck`
- `npx vite build`
- `npm run pr-check`

## Browser Smoke

Use `ui-rebuild-shell` ON and capture:

- `/ws/ws_demo_premium/brand`
- `/ws/ws_demo_premium/brand?tab=identity`
- `/ws/ws_demo_premium/brand?tab=brandscript`
- `/ws/ws_demo_premium/brand?tab=business-profile&focus=business-profile-section`
- Mobile overview and one mobile modal state.

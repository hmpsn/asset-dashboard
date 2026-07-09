# Brand & AI Corrective Implementation Plan

This is the implementation plan for the next Brand & AI pass. It supersedes a purely inline readiness-panel alignment slice.

Status: implemented in `codex/ui-prototype-alignment` as the modal-first parity correction slice.

## Goal

Make the rebuilt Brand & AI page match the prototype's modal-first interaction model while preserving existing data contracts, URL aliases, and legacy panel behavior.

Follow-up alignment note: the implemented overview also removes the legacy top tab strip. Cockpit cards, section rows, and the Voice & Messaging Brand identity generators disclosure are the visible launch surface; `?tab=` remains the invisible state/deep-link contract.

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
- Keep Brand identity generators scoped to Voice & Messaging for this slice.
- Use DS overlay primitives for focus management and close behavior.
- The modal body may carry existing panels as-is in this corrective slice.
- If a panel needs a richer bespoke modal shell later, defer that as visual polish after interaction parity.

## Acceptance Tests

Write or update tests before implementation so the current inline page fails for the intended reason:

- `?tab=brandscript` opens a modal/dialog.
- `?tab=eeat-assets` opens a modal/dialog.
- `?tab=business-profile&focus=business-profile-section` opens the Business Footprint modal and keeps focus intent.
- Closing the modal clears modal state without breaking the route.
- Overview has no top tab radiogroup.
- Voice & Messaging exposes one Brand identity generators disclosure and its rows open the Brand identity modal.
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

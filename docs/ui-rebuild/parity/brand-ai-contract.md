# Brand & AI Prototype Parity Contract

Surface: `brand` / Brand & AI  
Owner: `brand-engine`  
Status: modal-first correction implemented in `codex/ui-prototype-alignment`; generator, bespoke-flow, remaining workflow modal interior polish, and overview typography-role alignment implemented  
Primary route: `/ws/:workspaceId/brand`

## Prototype References

- Overview prototype: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/brand.js`
- Generator modal prototype: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/brand-modal.js`
- Flow modal prototype: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/brand-flows.js`
- Existing build ticket: `docs/ui-rebuild/phase-a/tickets/brand-ai.md`
- Current rebuilt implementation: `src/components/brand-ai-rebuilt/BrandAiSurface.tsx`

## Required Interaction Model

Brand & AI is a grouped context inventory with modal-first workflows.

The overview is not a generic readiness hero or a flat work-area grid. It should mirror the prototype's four context groups:

- Voice & Messaging — how the client sounds.
- Knowledge — what the platform knows.
- Audience — who the client serves.
- Business Facts & Trust — the verifiable record.

The overview should include a compact context-completeness cockpit, group sections with actionable rows, and a right rail explaining how the context is used. It should not mount every legacy editor inline below the overview.

The overview should not show the legacy top tab strip. The grouped context inventory is the navigation surface: cockpit cards and section rows open the corresponding modal workflow while `?tab=` remains the deep-link/state contract.

Voice & Messaging owns the Brand identity generators disclosure for voice-adjacent identity outputs: Tagline, Voice Guidelines, Brand Archetypes, Personality Traits, Messaging Pillars, Differentiators, and Tone Examples. The other context groups should not duplicate that disclosure in this production slice.

Prototype-critical overlay behavior:

- Brand identity deliverables open the generator modal.
- Discovery opens a structured discovery modal/flow.
- Brandscript opens a brandscript modal/flow.
- E-E-A-T opens a trust-proof modal/flow.
- Business Footprint and Locations open the business facts/location modal/flow.
- Existing legacy panels may be mounted inside those overlays while they are carried forward, but the page-level interaction remains modal-first.

Modal lifecycle for the generator:

1. Generate
2. Refine
3. Edit
4. Approve
5. Export

The modal can reuse existing legacy components as the content body, but the shell, title, close behavior, focus trap, and URL-open state must follow the rebuilt overlay primitives.

Current implementation note:

- The Brand identity modal now adds a DS-framed `Generator workflow` panel before the carried identity editor, showing the prototype lifecycle: Generate, Refine, Edit, Approve, Export.
- The Discovery, Brandscript, Trust evidence, and Business facts modals now add DS-framed workflow context before their carried panels, matching the prototype's bespoke `brand-flows.js` modal framing: source intake, seven-part narrative, E-E-A-T proof signals, and locations/service-area facts.
- The Context editors, Voice calibration, and Strategy intelligence modals now add DS-framed workflow context before their carried panels: reusable AI context, voice DNA calibration, and strategy inputs.
- The overview, rail, and modal workflow frames now use desktop-first typography roles: operator labels use `.t-ui`, explanatory copy uses `.t-body`, and caption roles stay reserved for metadata, counts, badges, timestamps, and compact controls.
- The carried panels still mount exactly once and remain the editor bodies. This is modal-shell parity polish, not a rewrite of the legacy panel internals.

## URL and Deep Links

The existing `?tab=` contract stays. The change is what the receiver opens.

Required receiver behavior:

- `/ws/:workspaceId/brand` opens the overview with no modal.
- `?tab=overview` opens the overview with no modal.
- `?tab=identity` opens the generator modal.
- `?tab=brandscript` opens the brandscript modal.
- `?tab=discovery` opens the discovery modal.
- `?tab=voice` opens the voice calibration modal or drawer, depending on prototype confirmation.
- `?tab=context` opens the context quality modal or drawer, depending on prototype confirmation.
- `?tab=eeat-assets` opens the E-E-A-T trust proof modal.
- `?tab=business-footprint` opens the Business Footprint modal.
- Legacy aliases `?tab=business-profile` and `?tab=locations` open the Business Footprint modal and preserve focus handling.
- `&focus=business-profile-section` and `&focus=locations-section` still reach the intended section inside the modal.

Lens switching still writes validated URL state. Closing a modal should return to `/brand` or `?tab=overview` without dropping workspace state.

## Carry-Over Homes

Keep these child panels mounted exactly once, but move their visible home into modal/dialog workflows:

- Brandscript panel.
- Discovery panel.
- Voice panel.
- Brand identity panel.
- Business Footprint panel.
- E-E-A-T assets panel.
- Intelligence Profile panel.
- Page Strategy and Copy Pipeline carry-over, while C-6 keeps them on Brand & AI.

The current inline active-panel area is a known mismatch. The corrective pass should replace inline panel switching with modal-open state while preserving the same child panel instances.

## Moved, Excluded, or Deferred

- Do not add backend APIs, migrations, shared types, or new feature flags for the parity correction.
- Do not move Page Strategy or Copy Pipeline out of Brand & AI in this slice.
- Do not invent a numeric brand-context score unless the server-backed score exists.
- Do not surface internal rebuild language such as route tabs, carry-over contracts, mounted below, migration terms, or legacy aliases in the UI.

## Browser Smoke

Required before calling Brand & AI aligned:

- Desktop overview with no modal.
- Desktop overview has no top tab strip.
- Mobile overview with no text overlap.
- Voice & Messaging exposes exactly one Brand identity generators disclosure.
- `?tab=identity` opens the generator modal.
- `?tab=brandscript` opens the brandscript modal.
- `?tab=business-profile&focus=business-profile-section` opens the Business Footprint modal and focuses the expected section.
- `?tab=eeat-assets` opens the trust proof modal.
- Closing a modal restores overview state.
- No blank modal body, duplicate panel mount, or internal migration labels.

Current generator-modal polish smoke:

- Desktop identity modal with workflow frame: `/tmp/asset-dashboard-codex-parity-captures/brand-ai-identity-generator-modal-desktop.png`.
- Mobile identity modal with workflow frame: `/tmp/asset-dashboard-codex-parity-captures/brand-ai-identity-generator-modal-mobile.png`.
- Smoke state: `/tmp/asset-dashboard-codex-parity-captures/brand-ai-identity-generator-modal-smoke-state.json`.

Result: passed. Both desktop and mobile show exactly one `Brand identity` dialog, the `Generator workflow` frame, all five lifecycle steps, no visible internal labels, no page-level horizontal overflow, no console errors, and no local failed responses.

Current bespoke-flow modal polish smoke:

- Desktop Discovery modal with workflow frame: `/tmp/asset-dashboard-codex-parity-captures/brand-ai-discovery-workflow-modal-desktop.png`.
- Mobile Discovery modal with workflow frame: `/tmp/asset-dashboard-codex-parity-captures/brand-ai-discovery-workflow-modal-mobile.png`.
- Desktop Business facts alias modal with workflow frame: `/tmp/asset-dashboard-codex-parity-captures/brand-ai-business-facts-workflow-modal-desktop.png`.
- Smoke state: `/tmp/asset-dashboard-codex-parity-captures/brand-ai-bespoke-flow-modal-smoke-state.json`.

Result: passed. Discovery desktop/mobile and Business facts alias deep-link states show exactly one dialog, the expected workflow frame, no visible internal labels, no page-level horizontal overflow, and no console errors.

Current context/voice/intelligence modal polish smoke:

- Desktop Context editors modal with workflow frame: `/tmp/asset-dashboard-codex-parity-captures/brand-ai-context-workflow-modal-desktop.png`.
- Desktop Voice calibration modal with workflow frame: `/tmp/asset-dashboard-codex-parity-captures/brand-ai-voice-workflow-modal-desktop.png`.
- Mobile Strategy intelligence modal with workflow frame: `/tmp/asset-dashboard-codex-parity-captures/brand-ai-strategy-intelligence-workflow-modal-mobile.png`.
- Smoke state: `/tmp/asset-dashboard-codex-parity-captures/brand-ai-context-voice-intelligence-modal-smoke-state.json`.

Result: passed. Context editors, Voice calibration, and Strategy intelligence modal states show exactly one dialog, the expected workflow frame, no visible internal labels, no page-level horizontal overflow, and no console errors.

Current typography-role smoke:

- Desktop overview after role alignment: `/tmp/asset-dashboard-codex-parity-captures/brand-ai-typography-role-overview-desktop.png`.
- Desktop Brand identity modal after role alignment: `/tmp/asset-dashboard-codex-parity-captures/brand-ai-typography-role-identity-modal-desktop.png`.
- Smoke state: `/tmp/asset-dashboard-codex-parity-captures/brand-ai-typography-role-smoke-state.json`.

Result: layout passed. The overview has no dialog, the identity deep link opens exactly one dialog, sampled operator labels compute at `.t-ui`/13.5px, sampled explanatory copy computes at `.t-body`/15.5px, no internal labels are visible, and no horizontal overflow is present. The local preview emitted existing websocket/notification fetch noise with the backend stack not attached; no Brand & AI render or modal errors were observed.

## Automated Test Floor

`tests/component/brand-ai-rebuilt/BrandAiSurface.test.tsx` proves:

- Real feature flag hook survives loading-to-loaded transition.
- Overview renders the four prototype context groups and usage rail for a loaded workspace with no dialog, no top tab radiogroup, and no legacy child panel.
- Overview labels/snippets, right-rail copy, and modal workflow framing use the intended styleguide type roles instead of putting primary operator copy in caption-sized roles.
- Voice & Messaging renders exactly one Brand identity generators disclosure and its rows open Brand identity.
- `?tab=brandscript` opens a dialog/modal and mounts Brandscript exactly once.
- `?tab=eeat-assets` and `?tab=identity` open the expected dialog/modal and mount their legacy panels exactly once.
- The Brand identity modal renders the generator workflow lifecycle before the carried editor panel.
- Discovery, Brandscript, Trust evidence, and Business facts modal states render the prototype workflow context before the carried panel.
- Context editors, Voice calibration, and Strategy intelligence modal states render workflow context before the carried panel.
- `?tab=business-profile` and `?tab=locations` open Business Footprint exactly once.
- Lens switching updates the validated URL state and opens the expected modal.
- Modal close returns to overview.
- Internal migration terms are absent from visible UI.
- Rebuilt a11y floor passes.

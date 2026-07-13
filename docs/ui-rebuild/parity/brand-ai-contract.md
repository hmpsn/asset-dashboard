# Brand & AI Prototype Parity Contract

Surface: `brand` / Brand & AI  
Owner: `brand-engine`  
Status: `owner-approved`; Joshua approved the rendered desktop comparison on 2026-07-10 and deferred finer feedback to the registry-wide review
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

Each context group owns one non-overlapping Brand identity generators disclosure: seven Voice deliverables, two Knowledge deliverables, five Audience deliverables, and three Business Facts deliverables. Together they expose all 17 released interactive generators exactly once while the Identity workflow remains the single editor/capability home. The additive `naming` `BrandDeliverableType` is reserved for the reviewed MCP brand pipeline and intentionally remains absent from rendered tiers, actions, and focus links until that owning phase ships.

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

- The loaded page opens with the prototype's purple mono eyebrow instead of a duplicate standard PageHeader. The existing Refresh context capability is hosted exactly once in the rebuilt topbar.
- The Brand canvas now measures 1140px at both required desktop viewports: x=266–1406 at 1440×900 and x=346–1486 at 1600×1000. The opening lede, cockpit, two-column body, and first Knowledge rows follow the prototype's first-viewport rhythm.
- Long live Brand Voice, Knowledge Base, and persona fields are visually clamped to two lines in the overview while their full content remains available in the real editors. Browser-computed clamp evidence is about 37px / two lines for the 4,648-character Brand Voice fixture. Markdown-backed preview prose is normalized for display without changing stored editor values.
- Modal shells use the owner-approved DS `workflow` size (680px) and no longer prepend synthetic workflow cards. Every carried production editor still mounts exactly once.
- Brandscript list selection and deletion are sibling controls; the invalid nested-button composition found during browser comparison is removed.
- All 17 prototype generators are mapped to their real production deliverable types. `?tab=identity&focus=<released-generator-value>` opens the existing selected editor; bare, reserved, or invalid focus opens the full library. The overview Brandscript row focuses the first real record while bare `?tab=brandscript` retains the library.
- The carried panel interiors remain truthful production editors, not copies of the prototype's curated fixtures. Joshua approved that data-dependent difference under V5; founder Q&A, E-E-A-T rollups, and confirmed-geo rollups remain documented backend exceptions rather than simulated data. Collapsed Brandscript previews hide Markdown syntax, and Context separators render as rules while round-tripping to the stored `---` form.

## Source-Led Desktop Discrepancy Matrix — 2026-07-10

| Area | Prototype | Rebuilt baseline | Final resolution |
|---|---|---|---|
| Opening hierarchy | Purple mono eyebrow; no page-title block | Duplicate PageHeader plus teal badge | Corrected; purple eyebrow and right-aligned read indicator now lead the page. |
| Desktop canvas | 1140px inner canvas at 1440 and 1600 | Expanded to 1300px at 1600 | Corrected with existing `--page-max`; measured canvas matches at both viewports. |
| First viewport | Compact Voice group; Knowledge starts onscreen | Raw 4,648-character Voice field consumed the viewport | Corrected with a computed two-line clamp; collapsed surface height is about 1946px versus about 1893px in the prototype. Cockpit and Voice landmarks are within about 2px of the reference. |
| Cockpit | Compact four-group overview with emerald ≥80, amber ≥40, red below 40 | Extra readiness/count emphasis and a locally inferred 45% score | V1 implemented: inferred score/readiness removed; truthful `5/11 inputs configured` leads the live fixture while group evidence remains. |
| Group spine | Four ordered color-coded groups; 17 generators distributed by group | Correct group order; only seven Voice generators exposed | V2 implemented exactly once as 7 / 2 / 5 / 3, in prototype order. |
| Generator modal | 640px and focused on the clicked deliverable | 768px and the full 17-card library | V3/V4 implemented: selected real editor for validated focus, full-library compatibility receiver, and one 680px workflow shell. |
| Bespoke flows | 680px Discovery, Brandscript, E-E-A-T, and Locations compositions | Truthful production editors and real empty states | V5 implemented: real interiors/data preserved; overview Brandscript launch focuses the real record. Prototype-only data rollups are approved exceptions. |
| Topbar actions | Visual-only Preview context and Generate from site controls | Truthful Refresh context; Generate from website remains in the rail | V6 implemented as an approved production exception; no simulated actions added. |
| Rail title role | 12.5px / 700 compact headers | Shared `SectionCard` title is 15.5px / 600 | V7 implemented as an approved exception using the closest existing DS role, 13.5px / 700. |
| Accessibility | Separate row and destructive actions | Brandscript nested one button inside another | Corrected and browser-verified with zero nested buttons. |

## URL and Deep Links

The existing `?tab=` contract stays. The change is what the receiver opens.

Required receiver behavior:

- `/ws/:workspaceId/brand` opens the overview with no modal.
- `?tab=overview` opens the overview with no modal.
- `?tab=identity` opens the full generator library.
- `?tab=identity&focus=<released-generator-value>` opens exactly one real focused editor; a reserved or invalid focus value safely falls back to the full library.
- `?tab=brandscript` opens the brandscript modal.
- `?tab=brandscript&focus=existing-brandscript` opens the first real existing Brandscript; clearing focus retains the library modal.
- `?tab=discovery` opens the discovery modal.
- `?tab=voice` opens the voice calibration modal.
- `?tab=context` opens the context quality modal.
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

## Moved, Excluded, or Deferred

- Do not add backend APIs, migrations, shared domain types, or new feature flags for the parity correction. The sole owner-approved DS addition is the 680px `workflow` Modal size.
- Do not move Page Strategy or Copy Pipeline out of Brand & AI in this slice.
- Do not invent a numeric brand-context score unless the server-backed score exists.
- Do not surface internal rebuild language such as route tabs, carry-over contracts, mounted below, migration terms, or legacy aliases in the UI.

## Browser Smoke

Required before calling Brand & AI aligned:

- Desktop overview with no modal.
- Desktop overview has no top tab strip.
- Mobile overview with no text overlap.
- The four context groups expose exactly four non-overlapping Brand identity disclosures totaling 17 unique generators (7 / 2 / 5 / 3).
- `?tab=identity` opens the full generator library; validated focus opens one editor and invalid focus falls back safely.
- `?tab=brandscript` opens the brandscript modal.
- `?tab=business-profile&focus=business-profile-section` opens the Business Footprint modal and focuses the expected section.
- `?tab=eeat-assets` opens the trust proof modal.
- Closing a modal restores overview state.
- No blank modal body, duplicate panel mount, or internal migration labels.

Final V1–V7 evidence root: `/tmp/asset-dashboard-codex-visual-parity/brand-ai/final-v1-v7/`.

- Paired desktop overviews: `paired-overview-1440.png` and `paired-overview-1600.png`.
- Expanded generator states: `expanded-voice-1440.png`, `expanded-audience-1440.png`, and `expanded-facts-1440.png`.
- Focused Identity states: `identity-focused-tagline-1440.png`, `identity-focused-missing-brand-story-1440.png`, `identity-library-1440.png`, and `identity-invalid-focus-1440.png`.
- Brandscript compatibility states: `brandscript-focused-existing-1440.png` and `brandscript-library-1440.png`.
- Production-interior comparison: `modal-comparison-sheet.png`.
- Mobile floor: `rebuilt-overview-mobile-390.png` and `identity-focused-mobile-390.png`.

Browser result: all tested desktop/mobile states have one real receiver, one Refresh action, zero nested buttons, zero page-level horizontal overflow, zero console errors, and zero page errors. Every Brand workflow dialog computes to 680px on desktop; the focused mobile dialog fits at 358px inside the 390px viewport.

Fresh Sol review, 2026-07-10: `PASS`. V1–V7 are implemented exactly as approved; Voice begins within about 2px of the prototype landmark; Markdown-backed previews are readable while raw editor values round-trip unchanged; no safe-local defects remain. Joshua then reviewed the live surface and said, “It looks great,” establishing `owner-approved` status. His finer feedback is explicitly deferred to the registry-wide pass.

## Automated Test Floor

`tests/component/brand-ai-rebuilt/BrandAiSurface.test.tsx` proves:

- Real feature flag hook survives loading-to-loaded transition.
- Overview renders the four prototype context groups and usage rail for a loaded workspace with no dialog, no top tab radiogroup, and no legacy child panel.
- Overview labels/snippets, right-rail copy, and modal context use the intended styleguide roles, including the owner-approved 13.5px/700 rail-title exception.
- The four context groups render all 17 generators exactly once in the source-exact 7 / 2 / 5 / 3 mapping.
- Generator rows write a validated atomic `tab + focus` state and mount one selected real Identity editor; bare/invalid focus preserves the full library.
- `?tab=brandscript` opens a dialog/modal and mounts Brandscript exactly once.
- The overview Brandscript row focuses a real record; clearing focus or using the bare deep link retains the library.
- `?tab=eeat-assets` and `?tab=identity` open the expected dialog/modal and mount their legacy panels exactly once.
- All Brand workflows use the approved 680px `workflow` Modal shell without synthetic framing.
- `?tab=business-profile` and `?tab=locations` open Business Footprint exactly once.
- Group/item switching updates validated URL state and opens the expected modal.
- Modal close returns to overview.
- Internal migration terms are absent from visible UI.
- Rebuilt a11y floor passes.

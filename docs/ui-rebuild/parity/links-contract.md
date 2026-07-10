# Links Prototype Parity Contract

Surface: `links` / Links  
Owner: optimization / link-repair workflow  
Status: `behavior-safe / visual-unverified` after safe cleanup; row-level insert is an owner choice
Primary route: `/ws/:workspaceId/links`

## Prototype References

- Prototype source: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/links.js`
- Parity ledger source: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/Platform Parity Ledger.html`
- Existing rebuilt implementation: `src/components/links-rebuilt/LinksSurface.tsx`
- Route-state hook: `src/components/links-rebuilt/useLinksSurfaceState.ts`
- Redirect workflow: `src/components/links-rebuilt/RedirectsLens.tsx`
- Internal link workflow: `src/components/links-rebuilt/InternalLinksLens.tsx`
- Dead link workflow: `src/components/links-rebuilt/DeadLinksLens.tsx`
- Architecture workflow: `src/components/links-rebuilt/ArchitectureLens.tsx`
- Current component test: `tests/component/links-rebuilt/LinksSurface.test.tsx`

## Required Interaction Model

The prototype is the link workshop. Site Audit detects broken links and redirect problems; Links is where operators fix, export, or route them.

Prototype-critical modes:

1. `Redirects` — AI-suggested 301 rules, accept/edit/reject, CSV export for Webflow, and client-send.
2. `Internal Links` — linking opportunities, orphan pages, priority sorting, client-send, and implementation support.
3. `Dead Links` — domain-aware broken-link checker, internal vs external repair framing, and handoff into Redirects.
4. `Architecture` — URL tree, live/planned/strategy/gap filters, schema coverage, gaps, orphans, and depth distribution.

The rebuilt surface preserves all four as peer lenses, which matches the prototype better than most remaining surfaces.

## Current Parity Grade

Visual status: `behavior-safe / visual-unverified`.

Why:

- The rebuilt surface has the same four workshop modes: Redirects, Internal Links, Dead Links, and Architecture.
- `?tab=` state initializes each mode, including the legacy `?tab=dead` alias.
- Redirect recommendations can be accepted, edited, dismissed, exported as CSV, copied, or sent to the client.
- Internal-link opportunities preserve list/grouped review, priority filters, orphan pages, detail drawer, HTML copy, and client-send.
- Dead-link rows open a detail drawer, preserve reviewed session state, export CSV, and can route the operator back to Redirects.
- Architecture preserves source filters, URL tree, schema priority queue, gaps, orphans, and depth distribution.
- Safe cleanup removed implementation/deferred language from visible drawer/banner copy and now keeps the default route clean.

Owner choice:

- The prototype shows a row-level `Insert` action for internal links. The rebuilt surface currently provides HTML copy plus client-send instead of claiming a direct insert. Recommended default: keep copy/send until the write target is explicit; do not simulate an insert that does not actually publish or stage a real change.

## URL and Deep Links

Current route/state behavior:

- `/ws/:workspaceId/links` opens Redirects with no query string.
- `?tab=redirects` remains accepted and opens Redirects.
- Switching back to Redirects clears the default `tab` query param.
- `?tab=internal` opens Internal Links.
- `?tab=dead-links` opens Dead Links.
- Legacy `?tab=dead` maps to Dead Links.
- `?tab=architecture` opens Architecture.
- Invalid `?tab=` values fall back to Redirects.
- Secondary params remain validated: `search`, `status`, `priority`, `view`, `list`, `type`, and `source`.

Compatibility requirements:

- Preserve the existing `?tab=` values and `dead` alias.
- Do not add backend APIs, migrations, shared types, route ids, or feature flags for visual alignment.
- Keep Site Audit's dead-link handoff home intact: internal broken links should route operators toward Redirects.

## Carry-Over Homes

Keep these capabilities reachable exactly once:

- Redirect scan, saved redirect snapshot, 404 table, redirect chains, accepted-rule export, accepted-rule copy, and client-send.
- Internal-link analysis, saved internal-link snapshot, priority filters, list/grouped modes, orphan pages, HTML copy, detail drawer, and client-send.
- Link-check domain selection, saved dead-link snapshot, dead/redirect list mode, internal/external type filters, reviewed state, CSV export, and detail drawer.
- Site architecture tree, architecture source filters, schema coverage, priority queue, gaps, orphans, and depth distribution.

## Safe Work Completed

- Default `Redirects` now matches the prototype route shape by clearing `?tab=redirects`; the deep link remains accepted.
- Dead-link drawer copy now describes operator repair steps instead of exposing deferred implementation language.
- Architecture copy now describes next actions instead of relocation/write-target implementation notes.
- Redirect proposal summary no longer exposes `v1` implementation language.
- The page now carries the prototype's shared outcome footer: link repair happens in Links, while measured traffic or crawlability wins graduate to Insights Engine after analytics or Search Console proves impact.
- Redirect apply guidance, Internal Links implementation guidance, internal-link drawer rationale, Dead Links drawer repair guidance, Architecture gap explanations, Architecture next steps, and the measured-outcome footer now use `.t-body` so workshop instructions read as workflow copy rather than crawl metadata.
- Component tests assert default URL behavior, legacy alias behavior, critical deep links, exact-once dead-link drawer mounting, real feature flag loading transition, no internal implementation language in critical states, and rebuilt a11y.

## Browser Smoke Evidence

Clean fixture target: `ws_2ceaeb6c-0820-4da5-941e-ad9eae643993`.

- Desktop overview: `/tmp/asset-dashboard-codex-parity-captures/links-rinse-desktop-current.png`
- Internal Links deep link: `/tmp/asset-dashboard-codex-parity-captures/links-rinse-internal-current.png`
- Dead-link drawer: `/tmp/asset-dashboard-codex-parity-captures/links-rinse-dead-drawer-current.png`
- Architecture deep link: `/tmp/asset-dashboard-codex-parity-captures/links-rinse-architecture-current.png`
- Mobile overview: `/tmp/asset-dashboard-codex-parity-captures/links-rinse-mobile-current.png`
- Smoke state: `/tmp/asset-dashboard-codex-parity-captures/links-rinse-smoke-state.json`
- Outcome-footer desktop: `/tmp/asset-dashboard-codex-parity-captures/links-outcome-footer-desktop.png`
- Outcome-footer internal deep link: `/tmp/asset-dashboard-codex-parity-captures/links-outcome-footer-internal.png`
- Outcome-footer mobile: `/tmp/asset-dashboard-codex-parity-captures/links-outcome-footer-mobile-viewport.png`
- Outcome-footer smoke state: `/tmp/asset-dashboard-codex-parity-captures/links-outcome-footer-smoke-state.json`
- Typography role Redirects desktop: `/tmp/asset-dashboard-codex-parity-captures/links-typography-redirects-desktop.png`
- Typography role Internal Links deep link: `/tmp/asset-dashboard-codex-parity-captures/links-typography-internal-desktop.png`
- Typography role Dead Links drawer: `/tmp/asset-dashboard-codex-parity-captures/links-typography-dead-drawer-desktop.png`
- Typography role Architecture deep link: `/tmp/asset-dashboard-codex-parity-captures/links-typography-architecture-desktop.png`
- Typography role state: `/tmp/asset-dashboard-codex-parity-captures/links-typography-role-smoke-state.json`

Result: passed with local browser smoke. Desktop overview, Internal Links deep link, Dead Links drawer, Architecture deep link, and mobile overview had all lens labels visible, no page-level horizontal overflow, no internal implementation labels, no duplicate dialogs, no console errors, and no failed responses. The outcome-footer smoke also passed on desktop, Internal Links deep link, and mobile footer viewport: footer copy stayed visible, no row-level `Insert` claim appeared, no internal implementation terms appeared, and console warnings/errors were empty.

Typography result: passed for the live Links samples available in the clean Rinse fixture. The measured-outcome footer and Dead Links repair guidance rendered as `.t-body` at 15.5px, the Dead Links drawer opened exactly once, no internal terms appeared, no failed responses were recorded, and the light mobile Internal Links viewport had no horizontal overflow. Redirect apply guidance, Internal Links implementation guidance, and Architecture gap/next-step copy are component-test evidence because the clean live fixture does not consistently expose those optional data states. Local preview console noise was limited to the existing notification fetch failure when the full backend notification stack was not attached.

## Automated Test Floor

Existing/current branch coverage proves:

- Real `useFeatureFlag('ui-rebuild-shell')` loading-to-loaded transition mounts Links.
- Redirects, Internal Links, Dead Links, and Architecture deep links initialize the intended state.
- Legacy `?tab=dead` still maps to Dead Links, and invalid tabs fall back to Redirects.
- Lens switching writes non-default URL state and clears the default Redirects URL.
- Internal-link grouped/list modes and client-send remain reachable.
- Prototype outcome footer renders inside the workshop and frames measured wins as belonging in Insights Engine.
- Redirect apply guidance, internal-link implementation guidance, measured-outcome footer copy, Dead Links repair guidance, and Architecture gap/next-step copy use `.t-body` for substantive workshop instructions.
- Dead-link rows open a detail drawer exactly once and preserve reviewed state.
- Architecture filters and schema coverage remain visible.
- Internal implementation terms are absent from the dead-link drawer and architecture view.
- The rebuilt a11y floor passes.

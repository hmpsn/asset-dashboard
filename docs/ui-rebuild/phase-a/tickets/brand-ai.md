# Wave 3 BUILD TICKET — Brand AI

**Surface:** Brand AI / Brand & AI admin surface (`brand-ai` ticket slug; live nav label "Brand & AI").  
**Page id:** `brand` — the current `Page` union contains `brand`, not `brand-ai` (`src/routes.ts:1-8`), the nav registry labels it "Brand & AI" (`src/lib/navRegistry.tsx:143-149`), and `App.tsx` currently mounts `BrandHub` for `tab === 'brand'` (`src/App.tsx:428-433`).  
**Flag:** `ui-rebuild-shell` only; default OFF (`shared/types/feature-flags.ts:117-120`) with the Phase A lifecycle catalog entry (`shared/types/feature-flags.ts:460-472`).  
**Branch:** `ui-rebuild-w3-base` off `origin/staging` (task scope).  
**Owner references:** C-6 is ratified for Brand AI Page Strategy / Copy Pipeline (`docs/ui-rebuild/phase-a/CROSS_SURFACE_CONTRACTS.md:41-45,86`); AD-010 requires T1 carry-over-then-reskin for Voice calibration, Page Strategy/Copy Pipeline, and discovery loop (`docs/ui-rebuild/phase-a/owner-decisions.json:140-157`); AD-020 applies AI 429 handling to `brand-ai` (`docs/ui-rebuild/phase-a/owner-decisions.json:267-278`; `docs/ui-rebuild/phase-a/BUILD_CONVENTIONS.md:81-98`); AD-021 resolves the Brandscript/completeness/E-E-A-T/Redo defaults (`docs/ui-rebuild/phase-a/owner-decisions.json:280-288`); AD-030 marks `SteeringChat` cleanup C3-later (`docs/ui-rebuild/phase-a/owner-decisions.json:381-395`).  
**Build posture:** additive-only behind `ui-rebuild-shell`; flag-OFF must be byte-identical to the legacy `BrandHub` path (`src/components/layout/rebuiltSurfaces.ts:5-15`; `shared/types/feature-flags.ts:117-120`).

## §1 ⚠ OWNER DELTAS

The Phase 0 audit counted 56 current Brand & AI capabilities (`docs/ui-rebuild/phase0/surfaces/brand-ai.md:125`) and listed 13 stop-and-ask questions (`docs/ui-rebuild/phase0/surfaces/brand-ai.md:199-213`). The surface JSON restates the same questions plus one newly-found persona editor item (`docs/ui-rebuild/phase-a/surfaces/brand-ai.json:242-326`) and three unknowns (`docs/ui-rebuild/phase-a/surfaces/brand-ai.json:423-427`).

| Discovery item | Resolution for this ticket | Backing |
|---|---|---|
| Q1 Voice calibration workspace home | Adopt proposed default: T1 carry-over `VoiceTab` as a token-restyled drill-in; no redesign in this wave. | `docs/ui-rebuild/phase-a/surfaces/brand-ai.json:243-248`; AD-010 (`docs/ui-rebuild/phase-a/owner-decisions.json:140-157`); T1 rule (`docs/ui-rebuild/phase-a/BUILD_CONVENTIONS.md:274-280`). |
| Q2 Page Strategy + Copy Pipeline destination | Override the JSON/Phase 0 relocation default: rows 39-45 stay on Brand AI as T1 drill-ins now. Content Pipeline relocation is a separate C3-later ticket and is not part of Wave 3. | Q2 default (`docs/ui-rebuild/phase-a/surfaces/brand-ai.json:249-254`); ratified C-6 (`docs/ui-rebuild/phase-a/CROSS_SURFACE_CONTRACTS.md:41-45,86`); AD-010 (`docs/ui-rebuild/phase-a/owner-decisions.json:140-157`). |
| Q3 Discovery process to extraction review loop | Adopt proposed default: keep docs -> process -> review as a drill-in step. | `docs/ui-rebuild/phase-a/surfaces/brand-ai.json:256-260`; AD-010 lists the discovery loop (`docs/ui-rebuild/phase-a/owner-decisions.json:140-157`). |
| Q4 Founder interview Q&A | Adopt proposed default: defer. | `docs/ui-rebuild/phase-a/surfaces/brand-ai.json:262-266`; AD-021 defers founder interview (`docs/ui-rebuild/phase-a/owner-decisions.json:280-288`); SB-034 is later (`docs/ui-rebuild/phase-a/server-backlog.json:467-477`). |
| Q5 E-E-A-T 8 typed assets to 4-pillar lens | Adopt proposed default: keep CRUD/autofill and add only a read-only pillar lens. | `docs/ui-rebuild/phase-a/surfaces/brand-ai.json:268-272`; AD-021 adopts the read-only lens (`docs/ui-rebuild/phase-a/owner-decisions.json:280-288`). |
| Q6 Brandscript multiplicity | Adopt proposed default: multi-script API remains; UI can auto-select newest script and put list/import/delete in overflow. | `docs/ui-rebuild/phase-a/surfaces/brand-ai.json:274-278`; AD-021 (`docs/ui-rebuild/phase-a/owner-decisions.json:280-288`). |
| Q7 Completeness metric semantics and invented similarity | Adopt proposed default: qualitative Ready/Partial/Needs setup; cut the unsupported "92% on-brand" style metric unless SB-033 later extends `ai-context-check`. | `docs/ui-rebuild/phase-a/surfaces/brand-ai.json:280-284`; AD-021 (`docs/ui-rebuild/phase-a/owner-decisions.json:280-288`); SB-033 (`docs/ui-rebuild/phase-a/server-backlog.json:454-465`). |
| Q8 Per-deliverable export | Adopt proposed default: keep Export All only; defer per-item export. | `docs/ui-rebuild/phase-a/surfaces/brand-ai.json:286-290`; SB-037 (`docs/ui-rebuild/phase-a/server-backlog.json:503-512`). |
| Q9 Brand-docs upload UI | **Unresolved owner delta.** The proposed default gives the headless brand-docs API a Discovery dropzone home, but no AD/C decision ratifies UI placement. Keep the API and existing folder hints; do not silently drop the ingestion path. | Proposed default (`docs/ui-rebuild/phase-a/surfaces/brand-ai.json:292-296`); current API (`server/routes/brand-docs.ts:25-109`); brand-engine raw-doc data flow (`docs/rules/brand-engine.md:11-19`). |
| Q10 Promote-to-Guardrail | Adopt proposed default: preserve the deliberately disabled affordance; do not implement promotion in Wave 3. | `docs/ui-rebuild/phase-a/surfaces/brand-ai.json:298-302`; current disabled button (`src/components/brand/CopyIntelligenceManager.tsx:288-298`). |
| Q11 `SteeringChat` dead code | Resolved by AD-030 as C3-later cleanup; do not revive it as part of the rebuild. | `docs/ui-rebuild/phase-a/surfaces/brand-ai.json:304-308`; AD-030 (`docs/ui-rebuild/phase-a/owner-decisions.json:381-395`); Phase 0 dead-code row (`docs/ui-rebuild/phase0/surfaces/brand-ai.md:103-104`). |
| Q12 Brand identity version history exposure | Adopt proposed default: leave server-only in this rebuild; keep IDs/versions intact. | `docs/ui-rebuild/phase-a/surfaces/brand-ai.json:310-314`; current route exposes single deliverable history (`server/routes/brand-identity.ts:80-85`); MCP expected-version contract (`server/mcp/tools/brand.ts:37-40,98-116`). |
| Q13 New URL scheme | **Unresolved owner delta.** No AD/C row ratifies the proposed `?group=` + anchor scheme. Wave 3 must preserve the existing `?tab=` receiver, legacy aliases, and `&focus=` targets; any URL consolidation needs owner sign-off before D8 work. | Proposed default (`docs/ui-rebuild/phase-a/surfaces/brand-ai.json:316-320`); current receiver (`src/components/BrandHub.tsx:237-247,331-339`); URL-state convention warns not to overload `tab` (`docs/ui-rebuild/phase-a/BUILD_CONVENTIONS.md:186-195`). |
| Persona structured-field editor | Adopt proposed default: carry pain points, goals, objections, and preferred content format into expanded edit. | `docs/ui-rebuild/phase-a/surfaces/brand-ai.json:322-326`; current persona manager saves structured personas (`src/components/BrandHub.tsx:715-760,925-973`). |
| Unknown: Content Pipeline destination room | Resolved by C-6: destination reserved zero room, so Page Strategy/Copy Pipeline stay on Brand AI now. | `docs/ui-rebuild/phase-a/surfaces/brand-ai.json:423-425`; C-6 (`docs/ui-rebuild/phase-a/CROSS_SURFACE_CONTRACTS.md:41-45,86`). |
| Unknown: discovery upload accept-list | Resolved by verification: server enforces `.txt`/`.md` extension + MIME and UTF-8 read. | `docs/ui-rebuild/phase-a/surfaces/brand-ai.json:425`; `server/routes/discovery-ingestion.ts:91-110`; verify row (`docs/ui-rebuild/phase-a/surfaces/brand-ai.json:470-473`). |
| Unknown: Brandscript template section-count parity | **Unresolved evidence gap.** The audit did not inspect template data, so the build must verify HEAD template section count before replacing section UI. | `docs/ui-rebuild/phase-a/surfaces/brand-ai.json:426`; Phase 0 notes the prototype 7 vs HEAD 8 concern (`docs/ui-rebuild/phase0/surfaces/brand-ai.md:49`). |

## §2 Capability checklist

Zero-drop floor: apply the AD-011 additive-parity principle here even though the original AD-011 surface list was narrower; its rule is that prototype-dropped capabilities move into Drawers/overflow, not deletion (`docs/ui-rebuild/phase-a/owner-decisions.json:159-173`). Every current row below must remain available while the new surface ships behind `ui-rebuild-shell`.

| Rows | HEAD/current capability and evidence | Target DS primitive / home | Zero-drop confirmation |
|---|---|---|---|
| 1 | Current route/nav/mount is Page `brand`, nav label "Brand & AI", legacy `BrandHub` mount (`docs/ui-rebuild/phase0/surfaces/brand-ai.md:16-23`; `src/routes.ts:1-8`; `src/lib/navRegistry.tsx:143-149`; `src/App.tsx:428-433`). | `PageHeader`, rebuilt shell nav, one `REBUILT_SURFACES['brand']` entry. | Keep route id `brand`; no route rename to `brand-ai`. |
| 2 | Nine current tabs: overview, context, brandscript, discovery, voice, identity, business-footprint, eeat-assets, intelligence-profile (`src/components/BrandHub.tsx:66-68,502-517`). | `LensSwitcher` + `GroupBlock` cockpit with drill-ins. | Regrouping is allowed only if all nine tabs land in a group or carry-over panel. |
| 3-5 | `?tab=` receiver, legacy aliases, and `&focus=` cross-surface targets (`src/components/BrandHub.tsx:237-247,331-339`; `src/components/settings/BusinessFootprintTab.tsx:45-69,83-134`; Phase 0 senders at `docs/ui-rebuild/phase0/surfaces/brand-ai.md:20-22`). | Validated URL-state helper plus existing focus receiver. | Preserve all old URLs until Q13 is ratified. |
| 6 | Overview snapshot cards, configured badges, local-SEO location counts, and deep links (`src/components/brand/BrandOverviewTab.tsx:72-164`). | `MetricTile`, `KeyValueRow`, `ClickableRow`, no fabricated percentages. | Use qualitative completeness unless SB-033 ships. |
| 7-13 | Context tab: rich-text Brand Voice and KB editors, website-generation jobs, sessionStorage job recovery, persona structured editor, "how it works" footer, and brand-docs ingestion contract (`src/components/BrandHub.tsx:74-88,341-443,575-710,715-760,925-1014`; `server/routes/brand-docs.ts:25-109`; Phase 0 rows at `docs/ui-rebuild/phase0/surfaces/brand-ai.md:32-40`). | `SectionCard`, `RichTextEditor`, `ProgressIndicator`, `NextStepsCard`, `Drawer` drill-ins, optional Discovery dropzone after Q9. | Do not downgrade rich text to textarea; do not remove job recovery or persona fields. |
| 14-20 | Brandscripts: list/create/templates/import/delete, per-section edit/save, 409 concurrency, complete-empty AI batch, server-side questionnaire population (`src/components/brand/BrandscriptTab.tsx:27-130,199-245,326-355,415-430,472-620`; Phase 0 rows at `docs/ui-rebuild/phase0/surfaces/brand-ai.md:44-52`). | Single-script flow panel plus `Menu` overflow for list/import/delete and `ConfirmDialog` for delete. | Multi-script API stays; per-section Redo can ride SB-017, but approved status does not. |
| 21-26 | Discovery: source type selector, upload/paste/delete, `.txt`/`.md` validation, process source, extraction review filters, accept/dismiss/confidence/routing, and update API (`src/components/brand/DiscoveryTab.tsx:35-190,204-320,321-530,559-636,692-770,813-824`; `server/routes/discovery-ingestion.ts:70-120,173-215`). | Discovery `Drawer`, `FilterChip`, `DataList`, `ConfirmDialog`, `EmptyState`. | Keep process -> review loop; richer file parsing is DEF only. |
| 27-32 | Voice calibration: create profile, samples, DNA sliders/traits, guardrails lists, calibration loop, approved copy feeding samples (`src/components/brand/VoiceTab.tsx:21-108`; `src/components/brand/voice-tab/SamplesSection.tsx:24-198`; `src/components/brand/voice-tab/DNASection.tsx:15-192`; `src/components/brand/voice-tab/voiceTabModel.ts:1-50`; `server/copy-review.ts:221-288,496-503`). | T1 `Drawer`/panel carrying `VoiceTab`; `RadioGroup`/`Segmented` only inside the drill-in where safe. | Carry all four voice sections; no numeric similarity stat. |
| 33-38 | Brand identity: 17 deliverable types, generate/refine/edit/approve lifecycle, Export All, empty/loading/error, version IDs, MCP optimistic concurrency (`src/components/brand/IdentityTab.tsx:13-45,56-110,368-490`; `server/routes/brand-identity.ts:55-105`; `server/mcp/tools/brand.ts:29-116`). | Generator `Drawer`, `StatusBadge`, `WorkflowStepper`, `Toolbar` export action. | Export All stays; per-item export is DEF. |
| 39-41 | Page Strategy blueprints: list/create/delete/AI job, detail Pages tab, entry scope/removal/section plan, version history (`src/components/brand/PageStrategyTab.tsx:18-253`; `src/components/brand/BlueprintDetail.tsx:60-125,220-292,361-385,539-705`; `src/components/brand/BlueprintVersionHistory.tsx:12-106`; Phase 0 rows at `docs/ui-rebuild/phase0/surfaces/brand-ai.md:87-93`). | **C-6 T1 drill-in on Brand AI**; `Drawer` or full-width panel. | Do not move to Content Pipeline in Wave 3. Existing admin-only purple narrative-role badge may remain (`src/components/brand/BlueprintDetail.tsx:228-231`); never add purple to `src/components/client/**`. |
| 42-46 | Copy Pipeline: per-entry generation/status/review, copy review and client suggestions, batch generation, export formats/scopes, copy intelligence and locked Promote-to-Guardrail (`src/components/brand/CopyReviewPanel.tsx:74-362,404-543`; `src/components/brand/CopyExportPanel.tsx:36-136`; `src/components/brand/CopyIntelligenceManager.tsx:42-305,309-405`; `server/routes/copy-pipeline.ts:1-3,64-239`; Phase 0 rows at `docs/ui-rebuild/phase0/surfaces/brand-ai.md:95-104`). | **C-6 T1 drill-in on Brand AI**; preserve current panels with token restyle. | Do not relocate or redesign the pipeline in this wave; preserve disabled Webflow CMS export and disabled Promote-to-Guardrail. |
| 47-48 | `SteeringChat` is exported but unmounted; content-decay copy-refresh is server behavior (`docs/ui-rebuild/phase0/surfaces/brand-ai.md:103-105`). | No UI resurrection; C3 cleanup for dead code. | Not a parity obligation; do not delete server copy-refresh behavior. |
| 49-52 | Business Footprint, Locations, GBP flag gate, E-E-A-T 8-type asset CRUD/autofill, Intelligence Profile save/autofill (`src/components/settings/BusinessFootprintTab.tsx:71-137`; `src/components/settings/EeatAssetsTab.tsx:49-100,117-212,229-296`; `src/components/settings/IntelligenceProfileTab.tsx:35-110`; Phase 0 rows at `docs/ui-rebuild/phase0/surfaces/brand-ai.md:107-114`). | Business Facts & Trust group, `Meter`/read-only E-E-A-T pillar lens, `Drawer` for CRUD. | Pillar lens cannot replace typed assets or autofill. |
| 53-56 | WS events, query invalidation, background job types, prompt/intelligence/MCP consumers (`server/ws-events.ts:118-136`; `src/hooks/useWsInvalidation.ts:84-92`; `shared/types/background-jobs.ts:13-29`; `src/lib/queryKeys.ts:150-180`; `docs/rules/brand-engine.md:17-19,331-335`). | `useWorkspaceEvents`/existing invalidation registry, Task Panel, unchanged stores. | Rebuild changes editors, not data semantics or downstream prompt consumers. |

## §3 Server tickets — ride-along vs defer

The brand-engine contract is explicit: `buildSystemPrompt()` injects calibrated voice DNA and guardrails as Layer 2, and callers must not inline duplicate DNA/guardrail blocks (`docs/rules/brand-engine.md:23-58,70-88`). `buildVoiceCalibrationContext()` is the only safe helper for user-prompt context; it returns empty DNA/guardrails when the profile is calibrated (`docs/rules/brand-engine.md:150-168`). The rebuilt surface must not propose a second DNA/voice injection path.

| SB item | Classification | Ticket instruction |
|---|---|---|
| SB-017 Brandscript approved status + per-section Redo (`docs/ui-rebuild/phase-a/server-backlog.json:243-254`) | **Partial ride-along.** Per-section Redo can ride because AD-021 adopts it; the approved-status half is deferred/rejected by AD-021. | Add only the small per-section regenerate path if the UI ships Redo. Do not add a brandscript `approved` status, migration, or state machine in this wave. |
| AD-020 AI 429 pattern (`docs/ui-rebuild/phase-a/owner-decisions.json:267-278`; `docs/ui-rebuild/phase-a/BUILD_CONVENTIONS.md:81-98`) | **Ride-along behavior.** | Every AI action in Brand AI must expose disabled-with-reason, quota tooltip, first-429 banner, and partial-run tally where bulk jobs apply. |
| SB-033 Brand-context completeness score (`docs/ui-rebuild/phase-a/server-backlog.json:454-465`) | **Defer -> `DEF-brand-ai-001`.** | Use qualitative field-presence states now; later extend `server/ai-context-check.ts`, not a new scorer. |
| SB-034 Founder-interview Q&A (`docs/ui-rebuild/phase-a/server-backlog.json:467-477`) | **Defer -> `DEF-brand-ai-002`.** | No interview table, migration, AI operation, or flow in Wave 3. |
| SB-035 Source-fed KB regeneration job (`docs/ui-rebuild/phase-a/server-backlog.json:479-488`) | **Defer -> `DEF-brand-ai-003`.** | Existing KB generation remains website-crawl based; do not make discovery sources feed KB yet. |
| SB-036 PDF/DOCX/XLSX discovery parsing (`docs/ui-rebuild/phase-a/server-backlog.json:491-500`) | **Defer -> `DEF-brand-ai-004`.** | Keep `.txt`/`.md`; server currently rejects other types (`server/routes/discovery-ingestion.ts:91-110`). |
| SB-037 Single-deliverable export (`docs/ui-rebuild/phase-a/server-backlog.json:503-512`) | **Defer -> `DEF-brand-ai-005`.** | Keep Export All via `/api/brand-identity/:workspaceId/export` (`server/routes/brand-identity.ts:67-78`). |
| Q9 Brand-docs UI placement (`docs/ui-rebuild/phase-a/surfaces/brand-ai.json:292-296`) | **Unresolved -> `DEF-brand-ai-006` if the UI remains headless.** | API exists (`server/routes/brand-docs.ts:25-109`); owner must ratify Discovery dropzone home before implementation. |

## §4 Deep-link receiver matrix

| Incoming URL/state | Current receiver evidence | Rebuilt receiver requirement |
|---|---|---|
| `/ws/:workspaceId/brand` | Page id is `brand` (`src/routes.ts:1-8`); nav entry is `brand` (`src/lib/navRegistry.tsx:143-149`); legacy mount is `App.tsx:431`. | Keep route id `brand`; surface slug `brand-ai` is documentation only. |
| `?tab=overview|context|brandscript|discovery|voice|identity|business-footprint|eeat-assets|intelligence-profile` | `VALID_BRAND_TABS` and initial receiver (`src/components/BrandHub.tsx:66-68,237-247`), reactive sync (`src/components/BrandHub.tsx:331-339`). | Read and validate `tab` before render; default to Overview. |
| Legacy `?tab=business-profile` and `?tab=locations` | Alias map (`src/components/BrandHub.tsx:69-72`) and legacy scroll handling (`src/components/settings/BusinessFootprintTab.tsx:58-69`). | Preserve aliases and focus behavior. |
| `&focus=business-profile-section` and `&focus=locations-section` | Overview sends these (`src/components/brand/BrandOverviewTab.tsx:138-162`); BusinessFootprint exposes focused sections (`src/components/settings/BusinessFootprintTab.tsx:83-134`). | Keep focus targets and `data-schema-deeplink` attributes. |
| Blueprint detail nested `?tab=pages|copy` | `BlueprintDetail` currently reads `searchParams.get('tab')` for nested `pages`/`copy` (`src/components/brand/BlueprintDetail.tsx:361-382`) while BrandHub also owns top-level `tab` (`src/components/BrandHub.tsx:237-247`). | Do not overload top-level `tab` for new group state; use scoped nested state or a future owner-ratified URL scheme. |
| Static contract tests | Contract test describes the two-halves `?tab=` rule (`tests/contract/tab-deep-link-wiring.test.ts:1-15`) and has a Brand fallback (`tests/contract/tab-deep-link-wiring.test.ts:103-111`). | Update the contract test if the rebuilt receiver moves; do not remove coverage. |

## §5 Flag disposition

- Ship behind the existing `ui-rebuild-shell` flag; no new feature flag. The flag is OFF by default and documented as additive/pilot-mounted (`shared/types/feature-flags.ts:117-120,460-472`).
- Add exactly one `REBUILT_SURFACES['brand']` entry, because the registry is keyed by `Page` and the current Page key is `brand` (`src/components/layout/rebuiltSurfaces.ts:1-20`; `src/routes.ts:1-8`). Do **not** add `REBUILT_SURFACES['brand-ai']` unless a separate route-rename ticket changes `Page`.
- Flag-OFF must remain byte-identical: no changes to the legacy `BrandHub` branch in `App.tsx` except the existing generic rebuilt-surface seam (`src/components/layout/rebuiltSurfaces.ts:5-15`; `src/App.tsx:428-433`).
- Admin-AI purple exception: existing admin-only Page Strategy narrative-role purple may remain (`src/components/brand/BlueprintDetail.tsx:228-231`). The rebuild must not add purple to any client-facing path, and `src/components/client/**` is must-not-touch for this ticket.

## §6 File ownership

**Owned in the rebuild PR**
- `src/components/brand-ai-rebuilt/**` for the new `@ds-rebuilt` surface; every file must carry the marker and seven DS gates (`docs/ui-rebuild/phase-a/BUILD_CONVENTIONS.md:208-219`).
- `src/components/layout/rebuiltSurfaces.ts` for the one-line `brand` mount (`src/components/layout/rebuiltSurfaces.ts:19-38`).
- `tests/contract/tab-deep-link-wiring.test.ts` only if the receiver file changes (`tests/contract/tab-deep-link-wiring.test.ts:1-15,103-111`).
- `data/ui-rebuild-deferred-ledger.json` for the `DEF-brand-ai-*` rows below; ledger required fields are documented in Build Conventions (`docs/ui-rebuild/phase-a/BUILD_CONVENTIONS.md:216-219`) and the existing schema shape is visible in `DEF-foundation-001` (`data/ui-rebuild-deferred-ledger.json:1-20`).

**Reused, not rewritten**
- Brand engine modules listed by the domain rule: `server/prompt-assembly.ts`, `server/voice-calibration.ts`, `server/intelligence/seo-context-source.ts`, `server/intelligence/seo-context-slice.ts`, and `server/brand-identity.ts` (`docs/rules/brand-engine.md:1-5,17-19`).
- Existing endpoints and clients: `server/routes/brandscript.ts`, `server/routes/discovery-ingestion.ts`, `server/routes/brand-docs.ts`, `server/routes/brand-identity.ts`, `server/routes/copy-pipeline.ts`, and `src/api/brand-engine.ts` (copy-pipeline route scope at `server/routes/copy-pipeline.ts:1-3`; Brand API row coverage at `docs/ui-rebuild/phase0/surfaces/brand-ai.md:44-63,78-104`).
- Current query keys, WS events, and background jobs (`src/lib/queryKeys.ts:150-180`; `server/ws-events.ts:118-136`; `shared/types/background-jobs.ts:13-29`).

**Must not touch**
- The Content Pipeline surface: C-6 says Page Strategy and Copy Pipeline stay on Brand AI now and Content Pipeline relocation is C3-later (`docs/ui-rebuild/phase-a/CROSS_SURFACE_CONTRACTS.md:41-45,86`).
- Frozen Contract files in `CROSS_SURFACE_CONTRACTS.md` (`docs/ui-rebuild/phase-a/CROSS_SURFACE_CONTRACTS.md:61-73`).
- Any `src/components/client/**` path, especially for purple/admin-AI styling.
- Prompt-layer behavior that would duplicate voice DNA/guardrail injection (`docs/rules/brand-engine.md:23-58,150-168`).

## §7 D8/DEF entries

**D8:** none for this ticket. The Page key is not being renamed or removed; it remains `brand` (`src/routes.ts:1-8`). The C-6-mandated future relocation of Page Strategy / Copy Pipeline to Content Pipeline is a separate future C3 ticket, not a D8/DEF row here (`docs/ui-rebuild/phase-a/CROSS_SURFACE_CONTRACTS.md:41-45,86`).

Add these rows if the Wave 3 PR ships the quick-win scope described above:

```json
[
  {
    "id": "DEF-brand-ai-001",
    "surface": "brand-ai",
    "item": "Numeric brand-context completeness score for the Brand AI overview cockpit",
    "decision": "Ship qualitative Ready/Partial/Needs setup from field presence; defer a trusted numeric percent until SB-033 extends ai-context-check.",
    "class": "data",
    "upgradeTrigger": "SB-033 adds brand-scoped sources to server/ai-context-check.ts and exposes tested per-group scores.",
    "owner": "josh",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-08-18",
    "links": {
      "decision": "docs/ui-rebuild/phase-a/owner-decisions.json:280-288",
      "backlog": "docs/ui-rebuild/phase-a/server-backlog.json:454-465",
      "surface": "docs/ui-rebuild/phase-a/surfaces/brand-ai.json:280-284"
    }
  },
  {
    "id": "DEF-brand-ai-002",
    "surface": "brand-ai",
    "item": "Founder interview Q&A store and AI draft-from-docs endpoint",
    "decision": "Defer the interview flow; ship Discovery with existing source ingestion and extraction review only.",
    "class": "data",
    "upgradeTrigger": "SB-034 opens with a migration, AI operation contract, and Discovery flow design.",
    "owner": "josh",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-08-18",
    "links": {
      "decision": "docs/ui-rebuild/phase-a/owner-decisions.json:280-288",
      "backlog": "docs/ui-rebuild/phase-a/server-backlog.json:467-477",
      "surface": "docs/ui-rebuild/phase-a/surfaces/brand-ai.json:262-266"
    }
  },
  {
    "id": "DEF-brand-ai-003",
    "surface": "brand-ai",
    "item": "Source-fed knowledge-base regeneration from Discovery sources and extractions",
    "decision": "Keep the existing website-crawl knowledge-base job; defer source-fed regeneration until SB-035.",
    "class": "behavior",
    "upgradeTrigger": "SB-035 adds a background-job variant that reads discovery sources/extractions.",
    "owner": "josh",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-08-18",
    "links": {
      "decision": "docs/ui-rebuild/phase-a/owner-decisions.json:280-288",
      "backlog": "docs/ui-rebuild/phase-a/server-backlog.json:479-488",
      "surface": "docs/ui-rebuild/phase-a/surfaces/brand-ai.json:423-475"
    }
  },
  {
    "id": "DEF-brand-ai-004",
    "surface": "brand-ai",
    "item": "PDF DOCX and XLSX discovery-source upload parsing",
    "decision": "Keep .txt and .md only in Wave 3 because the server rejects other types and has no binary parser.",
    "class": "data",
    "upgradeTrigger": "SB-036 adds parser dependencies, upload validation, fixtures, and extraction tests.",
    "owner": "josh",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-08-18",
    "links": {
      "backlog": "docs/ui-rebuild/phase-a/server-backlog.json:491-500",
      "server": "server/routes/discovery-ingestion.ts:91-110",
      "surface": "docs/ui-rebuild/phase-a/surfaces/brand-ai.json:470-473"
    }
  },
  {
    "id": "DEF-brand-ai-005",
    "surface": "brand-ai",
    "item": "Single-deliverable brand identity export from generator modal",
    "decision": "Keep Export All approved deliverables; defer per-item export endpoint and modal action.",
    "class": "behavior",
    "upgradeTrigger": "SB-037 adds an item-scoped export route or type parameter with tests.",
    "owner": "josh",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-08-18",
    "links": {
      "backlog": "docs/ui-rebuild/phase-a/server-backlog.json:503-512",
      "server": "server/routes/brand-identity.ts:67-78",
      "surface": "docs/ui-rebuild/phase-a/surfaces/brand-ai.json:286-290"
    }
  },
  {
    "id": "DEF-brand-ai-006",
    "surface": "brand-ai",
    "item": "Brand-docs upload UI placement for the existing headless ingestion API",
    "decision": "Do not invent placement without owner sign-off; preserve the API and folder hints until Q9 is resolved.",
    "class": "behavior",
    "upgradeTrigger": "Owner resolves Q9 by choosing Discovery dropzone home or intentionally API-only documentation.",
    "owner": "josh",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-08-18",
    "links": {
      "surface": "docs/ui-rebuild/phase-a/surfaces/brand-ai.json:292-296",
      "api": "server/routes/brand-docs.ts:25-109",
      "contract": "docs/rules/brand-engine.md:11-19"
    }
  }
]
```

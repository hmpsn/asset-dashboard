# Schema Generator — Workstream B: LocalBusiness

**Date:** 2026-04-30
**Status:** Approved for implementation planning
**Depends on:** Nothing — fully independent (does not require C or D)
**Unlocks:** /contact and /about reference the LocalBusiness entity; sub-services claim the correct provider; schema dashboard surfaces the business-profile data-entry gap

---

## Problem

Three gaps identified in the baseline audit, with one root cause reframe:

1. **Homepage emits `Organization + WebSite`, not `LocalBusiness`** — this is a data-presence issue, not a code gap. `generator.ts:123` already auto-selects `buildLocalBusinessSchema` when `workspace.businessProfile?.address` is set. hmpsn's `businessProfile.address` is empty in the DB. No code fix needed here: filling in the address in workspace settings triggers the correct output on next regeneration.

2. **`/contact` and `/about` don't reference the LocalBusiness entity** — both templates currently emit their primary node with no `mainEntity` cross-reference. When `businessProfile.address` is present, these pages should carry a thin `/@id` pointer to `/#localbusiness` so Google can associate them with the site-wide local business entity.

3. **Sub-service `provider` points to `Organization`, not `LocalBusiness`** — `buildServiceSchema` hardcodes `provider: { '@type': 'Organization', ...orgRef(baseUrl) }`. For local businesses this should be `provider: { '@id': '${baseUrl}/#localbusiness' }`.

4. **Schema dashboard doesn't surface the business-profile data-entry gap** — the "schema impact" of business profile completeness is buried in workspace settings and not visible to the agency while they're working on schema. Easy fix: a passive callout on the schema page.

---

## Design

### 1. `buildAboutPageSchema` — thread `businessProfile`, update `mainEntity`

`AboutPage.mainEntity` currently references `orgRef(baseUrl)` (i.e. `{ '@id': '/#organization' }`). When `businessProfile?.address` is set, point it at `/#localbusiness` instead. The thin `@id` reference is sufficient — Google follows the pointer to the full node on the homepage.

```typescript
// StaticInput extended:
export interface StaticInput {
  baseUrl: string;
  pageData: PageData;
  businessProfile?: BusinessProfile | null;  // NEW
}

// buildAboutPageSchema change:
'mainEntity': input.businessProfile?.address
  ? { '@id': `${baseUrl}/#localbusiness` }
  : orgRef(baseUrl),
```

### 2. `buildContactPageSchema` — thread `businessProfile`, add `mainEntity`

`ContactPage` currently has no `mainEntity`. When `businessProfile?.address` is set, add a thin LocalBusiness reference:

```typescript
// buildContactPageSchema change:
'mainEntity': input.businessProfile?.address
  ? { '@id': `${baseUrl}/#localbusiness` }
  : undefined,
```

### 3. `buildServiceSchema` — thread `businessProfile`, switch `provider`

`Service.provider` currently emits a full inline Organization node. When `businessProfile?.address` is set, replace with a thin LocalBusiness @id reference (leaner JSON-LD, correct entity graph):

```typescript
// ServiceInput extended:
export interface ServiceInput {
  baseUrl: string;
  pageData: PageData;
  businessProfile?: BusinessProfile | null;  // NEW
}

// buildServiceSchema change:
'provider': input.businessProfile?.address
  ? { '@id': `${baseUrl}/#localbusiness` }
  : dropUndefined({
      '@type': 'Organization',
      ...orgRef(baseUrl),
      'name': pageData.publisher.name,
    }),
```

### 4. `generator.ts` — pass `businessProfile` into all three templates

`input.workspace.businessProfile` is already in scope at template dispatch time. Thread it into the three calls:

```typescript
case 'AboutPage':
  schema = buildAboutPageSchema({ baseUrl, pageData, businessProfile: input.workspace.businessProfile });
  break;
case 'ContactPage':
  schema = buildContactPageSchema({ baseUrl, pageData, businessProfile: input.workspace.businessProfile });
  break;
case 'Service':
  schema = buildServiceSchema({ baseUrl, pageData, businessProfile: input.workspace.businessProfile });
  break;
```

No changes to `ServiceIndex`, `BlogIndex`, `CaseStudyIndex`, `Legal`, or `WebPage` dispatch.

### 5. Schema dashboard callout (`src/components/schema/SchemaSuggester.tsx`)

When `workspace.businessProfile?.address` is missing or empty, render a dismissible callout at the top of the schema dashboard:

```
⚠ Your business profile is incomplete
Add your address, phone, and hours to unlock LocalBusiness schema on your
homepage, /contact, and /about — the highest-value schema type for local businesses.
[Complete business profile →]  (links to workspace settings business profile tab)
```

Conditions for showing:
- `businessProfile` is null OR `businessProfile.address` is missing/empty
- User has not dismissed it (persisted in `localStorage` keyed by `workspaceId`)

The link deep-links to the business profile tab in workspace settings using the existing `adminPath` / `clientPath` routing helpers.

---

## What does NOT change

- **Homepage template**: already correct — `buildLocalBusinessSchema` is used when `businessProfile?.address` is set, `buildHomepageSchema` when not. No code change needed.
- **LocalBusiness template itself**: already handles address, phone, hours, sameAs, AggregateRating, Review[]. No changes needed.
- **Healthcare/dental subtypes** (`Dentist`, `Physician`, `Attorney`): deferred per existing `local-business.ts` comment. Not in scope.
- **`/about` team members as `Person` entities**: requires page content extraction; deferred to a future enrichment PR.
- **`/contact` contactPoint**: requires threading BusinessProfile phone/email into ContactPage schema; the thin LocalBusiness `@id` reference covers this implicitly (Google follows the pointer to the full node).

---

## PR scope

**One PR.**

| File | Change |
|------|--------|
| `server/schema/templates/static.ts` | Extend `StaticInput` with `businessProfile`; conditional `mainEntity` on AboutPage + ContactPage |
| `server/schema/templates/service.ts` | Extend `ServiceInput` with `businessProfile`; conditional `provider` on Service |
| `server/schema/generator.ts` | Pass `businessProfile` into three template dispatch calls |
| `src/components/schema/SchemaSuggester.tsx` | Passive callout when `businessProfile?.address` is missing |
| `tests/schema/localbusiness-threading.test.ts` | New — unit tests: AboutPage/ContactPage/Service with and without businessProfile.address |

Expected diff: ~100 lines. Second-smallest PR after Workstream A.

---

## Verification gate

On staging, after filling in hmpsn's `businessProfile.address` (manually, in workspace settings) and triggering a regeneration:

- `/` (homepage) emits `LocalBusiness` (already works — data-presence fix)
- `/about` emits `AboutPage` with `mainEntity: { "@id": "https://hmpsn.studio/#localbusiness" }`
- `/contact` emits `ContactPage` with `mainEntity: { "@id": "https://hmpsn.studio/#localbusiness" }`
- `/services/design`, `/services/strategy`, `/services/development` emit `Service` with `provider: { "@id": "https://hmpsn.studio/#localbusiness" }`
- Schema dashboard shows NO callout (businessProfile.address is now set)

With `businessProfile.address` empty (current state):
- Schema dashboard shows the callout banner
- `/about`, `/contact`, `/services/*` emit current output (no mainEntity, provider = Organization) — graceful fallback

`npm run typecheck && npx vite build && npx vitest run` — zero failures.

---

## Implementation planning notes

Follow `docs/PLAN_WRITING_GUIDE.md`. Key constraints from `CLAUDE.md`:

- **Phase-per-PR:** Single PR. All three template changes are tightly coupled (same `businessProfile` threading pattern); splitting them adds coordination cost with no benefit.
- **No dependencies:** Can be dispatched in parallel with A, C, or D-PR1. Touches only `server/schema/templates/`, `server/schema/generator.ts`, and one frontend component. Zero overlap with C (`site-context.ts`) or D (`schema-plan.ts`, `schema-suggester.ts`).
- **Optional field threading:** `businessProfile` is added as optional to `StaticInput` and `ServiceInput`. Existing callers (unit tests) that don't pass it will get the current behavior (no `mainEntity`, provider = Organization). No breaking changes.
- **Model assignment:** Haiku — mechanical parameter threading + conditional logic. Frontend callout → Haiku.
- **Data-presence dependency:** The homepage LocalBusiness fix requires no code — only the workspace `businessProfile.address` field to be populated. Add a note in the spec that this is a content/data task, not a code task, and should be tracked separately (e.g. as a roadmap item or workspace settings improvement).

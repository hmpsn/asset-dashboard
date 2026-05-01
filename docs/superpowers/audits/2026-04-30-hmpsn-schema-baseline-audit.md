# hmpsn studio Schema Baseline Audit

**Date:** 2026-04-30
**Source:** `/api/webflow/schema-snapshot/662a84f1ca1f7847c26a1eb8` (post-PR1 + post-PR2 deployed to staging)
**Workspace:** hmpsn studio 2024 (28 pages)
**Validator status:** 28/28 valid per `REQUIRED_BY_TYPE` rules

## Type distribution

| @type | Count | Pages |
|---|---|---|
| WebPage | 10 | `/discovery`, `/privacy-policy`, `/401`, `/404`, `/schedule/15min`, `/schedule/20-minute-client-interview`, `/schedule/30min`, `/schedule/45min`, `/schedule/60min`, `/schedule/linkedin` |
| BlogPosting | 5 | `/insights/4-ways…`, `/insights/goodshuffle…`, `/insights/how-i-built…`, `/insights/our-partnership…`, `/insights/the-branding-recipe…` |
| Article | 4 | `/our-work/expero`, `/our-work/retirement-resources`, `/our-work/swish-dental`, `/our-work/thumbtack-careers-site` |
| Service | 3 | `/services/design`, `/services/development`, `/services/strategy` |
| CollectionPage | 3 | `/our-work`, `/insights`, `/services` |
| Organization (+ WebSite) | 1 | `/` (homepage) |
| AboutPage | 1 | `/about` |
| ContactPage | 1 | `/contact` |

## Enrichment emission across all 28 pages

| Field | Count emitted |
|---|---|
| `Article.citation[]` (PR1) | **0** |
| `VideoObject` graph node (PR1) | **0** |
| `HowTo` graph node (PR1) | **0** |
| `FAQPage` graph node (existing) | **0** |
| `Review[]` graph nodes (PR2) | **0** |
| `AggregateRating` (PR2) | **0** |
| `ImageGallery` graph node (PR2) | **0** |
| `Table` mainEntity (PR2) | **0** |

**Why every enrichment is 0:** hmpsn's Webflow templates render content into `<div class="w-richtext">` containers, not semantic `<article>`/`<blockquote>`/`<table>`. PR1 + PR2 extractors all scope to `<article>` (with whole-document fallback for some). The `<article>` tag is absent on every hmpsn page → all `<article>`-scoped extractors return empty arrays → all enrichment templates correctly emit nothing.

The PR1 + PR2 code is verifiably correct. It just has zero observable effect on this particular workspace's site.

## Page-by-page semantic gaps

### 🔴 Type-mismatch + thin-schema gaps

**`/services` (CollectionPage)** — Service hub page with 3 child Service pages. Currently emits CollectionPage + BreadcrumbList only. **Does not reference `/services/design`, `/services/strategy`, or `/services/development`.** Right shape:
- CollectionPage with `mainEntity: { @type: 'ItemList', itemListElement: [{ position, item: { @id: 'https://hmpsn.studio/services/design#service' }}, ...] }`
- OR Service with `hasOfferCatalog: { @type: 'OfferCatalog', itemListElement: [3 Offer entries pointing at sub-Service @ids] }`

**`/our-work` (CollectionPage)** — Case-study hub with 4 Article children. Same gap: doesn't reference the 4 case studies. Right shape: `mainEntity: ItemList` listing the 4 case studies by `@id`.

**`/insights` (CollectionPage)** — Blog hub with 5 BlogPosting children. Same gap. Right shape: either CollectionPage with `mainEntity: ItemList`, or `Blog` @type with `blogPost: [{ @id: ... }, ...]`.

**Homepage `/` (Organization + WebSite)** — Doesn't include LocalBusiness despite the workspace being an Austin agency with a physical address. Schema profile completeness widget says "all pages emit recommended fields" but the LocalBusiness entity is missing site-wide.

**`/contact` (ContactPage)** — Currently ContactPage + BreadcrumbList. Doesn't reference Organization with `contactPoint`, doesn't expose phone/email/address even though they exist on the page.

**`/about` (AboutPage)** — Currently AboutPage + BreadcrumbList. Doesn't list team members as `Person` entities (the page is literally "About Our Team in Austin, TX"). Could populate `mainEntity: { @type: 'Organization', founder: [...], employee: [...] }`.

### 🟡 "Schema padding" gaps

**6 of 10 WebPage emissions are content-less:**
- `/401`, `/404` — error pages, should NOT have schema (or have `noindex` instead)
- `/schedule/15min`, `/schedule/20-minute-client-interview`, `/schedule/30min`, `/schedule/45min`, `/schedule/60min`, `/schedule/linkedin` — Calendly booking iframes, no unique content. Schema adds zero SEO value.

These pages should be filtered out of schema generation (or at minimum, the agency should explicitly opt them out via the Schema Site Plan).

**`/discovery` (WebPage)** — A "Book Your Custom Web Design Consultation" lead-gen page. Schema Site Plan classifies it as **"Lead-Gen / Conversion"**. Generator emits plain WebPage. Better fit: `Service` with `offers: { @type: 'Offer', priceSpecification, availability }` OR `WebPage.potentialAction: { @type: 'ReserveAction' }`.

### 🟢 Pages where the schema looks right

- `/services/design`, `/services/development`, `/services/strategy` — Service @type chosen correctly. Required fields populated. provider links to Organization correctly.
- 5 BlogPostings — BlogPosting @type chosen correctly. Article rich-result eligibility = 2 (Article + Breadcrumb).
- 4 Articles in `/our-work` — Article @type chosen correctly for case studies.
- `/privacy-policy` — WebPage is appropriate.

## Schema Site Plan ↔ Generator disconnect

The Schema Site Plan stores `pageRoles` (Lead-Gen / Conversion, Service Page, Blog Post, Case Study, Pillar/Product Page, Homepage, About/Team, Contact, Partnership, General Page).

| Site Plan role | Plan count | Generator @type | Match? |
|---|---|---|---|
| Lead-Gen / Conversion | 6 | WebPage (×6 Calendly + ×1 discovery) | ❌ — emits thin WebPage |
| Blog Post | 5 | BlogPosting (×5) | ✅ |
| Case Study | 5 | Article (×4) + 1 missing? | ⚠️ — count mismatch |
| Service Page | 3 | Service (×3) | ✅ |
| Homepage | 1 | Organization + WebSite | ✅ (missing LocalBusiness) |
| About / Team | 1 | AboutPage | ⚠️ — doesn't reference team |
| Contact | 1 | ContactPage | ⚠️ — doesn't reference contactPoint |
| Partnership | 1 | (unknown) | ⚠️ |
| Pillar / Product Page | 1 | (unknown) | ⚠️ |
| General Page | 3 | WebPage (×3 — privacy, 401, 404) | ⚠️ — error pages shouldn't be here |

**Code path confirmation:**
- `server/schema/generator.ts:124` calls `classifyPage(url, baseUrl)` — pure URL pattern match.
- `server/schema-store.ts` stores `pageRoles` but is never read by `generator.ts` or `schema-suggester.ts`.
- The Site Plan is a **descriptive review surface**, not a **prescriptive emission source**.

## What "right schema" needs

For hmpsn studio's site to have schema that fully describes the business and earns rich-result eligibility:

1. **Homepage**: Organization + WebSite + LocalBusiness (Austin address, phone, hours, sameAs social profiles).
2. **Service hub (`/services`)**: Service or CollectionPage that lists sub-services as ItemList or OfferCatalog. Each sub-service should reference its child page's `@id`.
3. **Sub-services (3)**: Service with `aggregateRating` (when reviews exist), `provider: { @id: '#localbusiness' }` (not just Organization), `offers` (when pricing is on the page or in workspace settings), `areaServed` (Austin TX).
4. **Case studies (4 in /our-work)**: Article with `mentions: [{ @type: 'Organization', name: 'Expero' }]` etc., and `image[]` for the case study gallery. Currently Article-only.
5. **Insights hub (`/insights`)**: Blog @type with `blogPost: [...]` references. Currently CollectionPage with no children.
6. **Blog posts (5)**: BlogPosting + emerging PR1 enrichments (citation, video, HowTo) once Webflow templates use `<article>` containers OR PR3 widens scope to `.w-richtext`.
7. **About**: AboutPage with `mainEntity: { Organization with employee: [Person...] }` if team is listed on the page.
8. **Contact**: ContactPage with `mainEntity: Organization { contactPoint: [...] }`.
9. **Discovery / lead-gen (`/discovery`)**: Service with `potentialAction: ReserveAction` or `Offer` block.
10. **`/schedule/*`, `/401`, `/404`**: Excluded from schema generation entirely.

## Cross-cutting architectural gaps

1. **No entity graph across pages.** Each page is generated in isolation. The generator doesn't know that `/services/design` is a child of `/services`, or that `/insights/foo` is a post on the `/insights` blog. This is why hub pages can't reference their children — the data isn't threaded into the generator.

2. **Schema Site Plan is descriptive only.** Agency-curated `pageRoles` don't drive emission. A page role of "Lead-Gen / Conversion" should produce richer schema than a default WebPage; today it doesn't.

3. **No page-filtering in generator.** The generator runs against every Webflow page including `/401`, `/404`, and Calendly-embed scheduling pages. These shouldn't get schema at all (or should be explicit no-schema pages).

4. **No "schema completeness" beyond required fields.** Validator passes a schema that has only `name + url + description`. There's no signal for "this page COULD have richer schema if we threaded in workspace data" — e.g., `/contact` has all the data needed for `contactPoint` but doesn't emit it.

5. **PR1 + PR2 are dormant on this site.** The `<article>` scope was conservative-by-design (avoid emitting from nav/footer). On Webflow's `.w-richtext` templates, the scope never matches. Every PR1 + PR2 enrichment path is correct in tests but emits zero in production for hmpsn. Either:
   - Widen the scope to `main, article, .w-richtext` (with carve-outs for nav/footer) — easy change, partial fix.
   - Build a Webflow-specific extractor pass that detects `.w-richtext` as an article-equivalent — better fix.
   - Use AI extractors (PR2 ships them) more aggressively to identify content boundaries — costliest.

## Severity summary

- **🔴 Critical (semantic correctness issues blocking value):**
  - Hub pages don't reference their children (3 pages: services, our-work, insights)
  - Homepage doesn't include LocalBusiness despite Austin address being available
  - Schema Site Plan ignored by generator (architectural)

- **🟡 Important (thin schemas — valid but valueless):**
  - 6/10 WebPage emissions are content-less (error pages, Calendly booking pages)
  - `/contact`, `/about` don't reference workspace data (contactPoint, team)
  - Lead-gen page emits plain WebPage instead of Service+offer

- **🟢 Working as designed:**
  - All 3 Service pages
  - All 5 BlogPostings (basic shape)
  - All 4 Articles (case studies)
  - PR1 + PR2 emission paths correct (even if 0 fires on this site)

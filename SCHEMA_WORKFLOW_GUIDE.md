# Schema Markup — Workflow Guide

> **What this is:** A step-by-step operator guide for using the upgraded schema system. Covers the full lifecycle from site plan through deployment and impact measurement.
>
> **Who this is for:** You, the agency admin running schema for client sites.

---

## What Changed (The Upgrade)

The schema system went from "generate JSON-LD per page" to a **site-aware, plan-driven pipeline** with 13 integrated capabilities:

| Capability | What it does | Where |
|-----------|-------------|-------|
| **Site-Aware Schema Plan** | AI analyzes all pages + keyword strategy → assigns page roles + identifies canonical entities | Schema tab → "Schema Plan" panel |
| **Page Type → Schema Mapping** | Deterministic mapping from page role to recommended Schema.org types | Automatic (injected into AI prompt) |
| **Template → Schema Binding** | Content templates carry expected schema types → matrix cells inherit them | Content Pipeline → Templates |
| **Architecture-Aware Breadcrumbs** | BreadcrumbList generated from real site tree, not guessed | Automatic (post-processing) |
| **Hub Page Detection** | Pages with 2+ children auto-get CollectionPage + ItemList | Automatic (post-processing) |
| **SiteNavigationElement** | Homepage gets auto-generated nav schema from top-level pages | Automatic (post-processing) |
| **Sibling/Parent Relationships** | relatedLink, isPartOf, hasPart injected from architecture tree | Automatic (post-processing) |
| **E-E-A-T Author Enrichment** | Extracts author/expertise from content briefs → Person schema | Automatic (when brief is linked) |
| **Competitor Schema Intel** | Crawls competitor sites, extracts their JSON-LD, compares coverage | Schema tab → "Competitor Schema" |
| **Planned Page Pre-Generation** | Auto-generates schema skeleton when matrix cell reaches brief stage | Automatic (background) |
| **Schema Coverage Dashboard** | Visual coverage map across all pages — what has schema, what doesn't | Schema tab → "Coverage" |
| **Schema Priority Queue** | Ranks uncovered pages by internal link health — fix high-traffic gaps first | Schema tab → "Priority" |
| **Schema Impact Tracking** | GSC before/after comparison for schema deployments | Schema tab → "Impact" panel |

---

## The Workflow (Step by Step)

### Step 1: Generate the Schema Plan

**Where:** Schema tab → click **"Generate Schema Plan"** (or the plan panel at the top)

**What happens:**
- AI reads all your published pages + keyword strategy
- Assigns a **page role** to every page (homepage, service, pillar, blog, about, contact, location, product, lead-gen, etc.)
- Identifies **canonical entities** (your Organization, key Products/Services, Persons) that should be consistent across the whole site
- Creates a plan with status: `draft`

**What to review:**
- Are the page roles correct? A "service" page should be labeled `service`, not `generic`. Use the dropdown to fix any misassigned roles.
- Are the canonical entities right? Check Organization name, URL, description. Add any key Products or Services that should appear across pages.
- The entity `@id` values are auto-generated — these ensure the same Organization/Service entity is referenced consistently site-wide.

**Actions available:**
- **Save** — saves your edits (stays in `draft`)
- **Regenerate** — re-runs AI analysis (overwrites current plan)
- **Send to Client** — creates an approval batch with plain-English descriptions of each page's role and planned schema types. Client receives an email notification.
- **Activate** — marks plan as `active`. Once active, ALL future schema generation uses this plan as context.

**Recommended flow:** Generate → review/edit roles → Save → Send to Client → wait for approval → Activate.

---

### Step 2: Check Coverage (Optional but Recommended)

**Where:** Schema tab → **"Coverage"** sub-tab

**What it shows:**
- A site-wide view of which pages have schema markup and which don't
- Coverage percentage by page role (e.g., "Services: 3/10 covered")
- Visual indicators: green = has schema, red = missing

**Why this matters:** Before bulk-generating, you want to know the starting point. If a site already has some manual schema, you'll see it here.

---

### Step 3: Prioritize What to Generate First

**Where:** Schema tab → **"Priority"** sub-tab

**What it shows:**
- Pages WITHOUT schema, ranked by internal link health score
- Higher-traffic, better-linked pages should get schema first (more impact)
- Priority levels: critical, high, medium, low

**Use this when:** A site has 100+ pages and you can't do them all at once. Start with the critical/high priority pages.

---

### Step 4: Generate Schema (Single or Bulk)

**Where:** Schema tab → main view

#### Single Page
1. Select a page from the page picker
2. Click **"Generate Schema"**
3. AI generates JSON-LD using:
   - The page's HTML content
   - Its assigned role from the Schema Plan (if active)
   - Page type → schema type mapping (Service pages get `Service` schema, etc.)
   - Architecture tree context (for breadcrumbs, parent/child relationships)
   - Linked content brief E-E-A-T data (if a brief exists for this page)
4. Review the generated JSON-LD in the editor
5. Edit if needed → **"Save to Snapshot"**

#### Bulk Generation
1. Click **"Generate All"** (or select specific pages)
2. A background job processes all pages (progress shown in task panel)
3. Each page goes through the same pipeline: plan context + page type mapping + architecture enrichment + post-processing
4. Results saved to schema snapshot

**What the post-processing does automatically:**
- Validates all contact info (emails, phones, addresses) against actual page HTML — strips hallucinated values
- Ensures consistent Organization/WebSite entities across all pages (homepage gets full Org, subpages get stubs)
- Injects BreadcrumbList from real site tree
- Adds CollectionPage/ItemList for hub pages with 2+ children
- Adds SiteNavigationElement on homepage
- Injects cross-references (isPartOf, publisher, provider, mainEntity)
- Validates against the schema plan (strips types that shouldn't exist per the plan)
- Runs AI auto-fix pass on any validation errors

---

### Step 5: Review & Publish to CMS

**Where:** Schema tab → select pages with generated schema

1. Review the generated JSON-LD per page
2. Use the **"CMS Template"** panel to map schema to a Webflow CMS field
3. **"Publish"** pushes the JSON-LD to the Webflow CMS field for each page
4. For bulk: **"Bulk Publish"** panel lets you push all at once

**Important:** Schema is stored in a CMS Rich Text or Plain Text field. You'll need a `<script type="application/ld+json">` embed on the page template in Webflow that reads from this CMS field.

---

### Step 6: Check Competitor Coverage (Optional)

**Where:** Schema tab → **"Competitor Schema"** section (or via the competitor analysis)

**What it does:**
- Crawls competitor homepages + key pages
- Extracts their JSON-LD schema
- Compares: what schema types do they have that you don't?
- 24-hour cache to avoid excessive crawling

**Use this for:** Client conversations ("Your top competitor has Product schema on every service page — we should match that") and identifying gaps in your schema strategy.

---

### Step 7: Monitor Impact

**Where:** Schema tab → **"Impact"** panel (collapsible, below the main view)

**What it shows:**
- For each schema deployment (tracked via SEO Change Tracker), compares GSC metrics 14 days before vs 14 days after:
  - Clicks delta
  - Impressions delta  
  - CTR delta
  - Position delta
- Aggregate summary across all schema deployments
- Per-page breakdown for each deployment

**Timeline:** Impact data becomes meaningful ~2-4 weeks after deployment. The system auto-fetches GSC data for the comparison windows.

**Use this for:** Proving ROI to clients. "After deploying schema to 15 service pages, average impressions increased 23% and position improved by 1.2 spots."

---

## Content Pipeline Integration

If you're using **Content Matrices** (Content Pipeline → Matrices tab):

1. **Templates carry schema types** — When you create a content template with `pageType: 'service'`, it auto-inherits expected schema types (`Service`, `Offer`, `BreadcrumbList`).

2. **Matrix cells inherit from template** — Each cell in the matrix shows expected schema type badges.

3. **Auto pre-generation** — When a matrix cell transitions to `brief_generated` or `approved` status, the system automatically generates a schema skeleton in the background. These go into a `pending_schemas` queue.

4. **Ready on publish** — When the page is published in Webflow, the pre-generated schema is ready to apply without re-running the full generation pipeline.

---

## Quick Reference: Where Things Live

| Task | Where to go |
|------|------------|
| Create/edit schema plan | Schema tab → Plan panel (top) |
| Generate schema for pages | Schema tab → Page picker → Generate |
| Bulk generate all pages | Schema tab → "Generate All" button |
| Check which pages need schema | Schema tab → Coverage sub-tab |
| Prioritize generation order | Schema tab → Priority sub-tab |
| See competitor schema | Schema tab → Competitor section |
| Publish to Webflow CMS | Schema tab → select page → Publish / Bulk Publish |
| Measure impact | Schema tab → Impact panel (collapsible) |
| Set expected schema per template | Content Pipeline → Templates → edit template |
| See pending pre-generated schemas | GET /api/pending-schemas/:workspaceId |

---

## Typical Client Engagement Flow

1. **Discovery:** Generate Schema Plan + run Competitor Schema analysis
2. **Strategy:** Review plan, adjust page roles, send to client for approval
3. **Prioritize:** Check Coverage dashboard, focus on Priority queue (critical/high)
4. **Execute:** Bulk generate schema for priority pages → review → publish to CMS
5. **Expand:** Generate remaining pages in batches
6. **Measure:** After 2-4 weeks, check Impact panel for GSC deltas
7. **Report:** Share impact metrics with client ("schema added to 45 pages, avg +18% impressions")
8. **Maintain:** As new pages are added (especially via content matrices), schema auto-generates. Run coverage check periodically.

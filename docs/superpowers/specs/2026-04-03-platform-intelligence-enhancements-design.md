# Platform Intelligence Enhancements — Design Spec
**Date:** 2026-04-03
**Status:** Approved for implementation planning

---

## Overview

Three groups of improvements spanning chat/notifications, strategy/SEO tooling, and the client portal. The unifying theme: make every part of the platform feel smarter, more connected, and closer to converting clients.

---

## Group 1 — Chat + Notifications

### 1.1 Service Interest CTA in Client Chat

**What:** An explicit, stylized CTA button rendered inside the client chat panel when the AI detects or the user expresses intent to move forward with a service.

**Behavior:**
- The button is context-aware based on the conversation topic:
  - Content-related intent → "Explore content recommendations" (navigates to the content/strategy tab)
  - General service interest → "Get in touch" (triggers admin notification + confirmation message to client)
- The button is rendered as a distinct styled element below the AI response — not inline text
- Tapping it does not require the client to "move forward" themselves; it signals intent to the admin for follow-up

**Admin notification flow:**
- Fires a new `client_signal` event to the workspace
- Creates a record in a new `client_signals` table: `workspaceId`, `type` (content_interest | service_interest), `chatContext` (the last 10 messages), `timestamp`
- Sends an email to the admin with a summary and a link to the signal

**Signal types to detect:**
- Content interest: user asks about blog posts, briefs, writing, content creation
- Service interest: user asks about "moving forward," pricing, working together, next steps

---

### 1.2 Admin Signals Panel

**What:** A dedicated section for client intent signals — separate from system alerts.

**Notification panel:** New "Client Signals" section appears at the top of the notifications panel when signals are unread. Shows workspace name, signal type, and timestamp.

**Admin inbox — new "Signals" tab:**
- Lists all client signals across all workspaces
- Each signal expands to show the full chat context window (last ~10 messages) around the moment the CTA was tapped
- Status: New → Reviewed → Actioned
- Clicking a signal navigates to the relevant workspace

**Email:**
- Subject: `[hmpsn.studio] Client signal from [Workspace Name]`
- Body: signal type, workspace, a snippet of the chat context, and a direct link to the Signals tab

---

### 1.3 Notification Panel Slide-out (Bug Fix)

**Problem:** The notification panel is a dropdown anchored inside the sidebar, constrained by `overflow-y-auto` on the sidebar container. It can't render beyond the sidebar width and gets clipped.

**Fix:** Convert to a fixed-position slide-out drawer — same pattern as `AdminChat.tsx`. The panel renders at `fixed` position with `z-50`, slides in from the left over the sidebar, and closes on outside click or Escape. Width: 360px.

---

### 1.4 Chatbot Loading States

**What:** Replace the three bouncing dots in `ChatPanel.tsx` with rotating Western-flavored loading messages.

**Copy pool (cycle randomly):**
- Hootin'…
- Hollerin'…
- Rustlin'…
- Wranglin'…
- Cookin'…
- Fetchin'…
- Gettin' after it…
- Tinkerin'…
- Rummagin'…

**Behavior:** Pick a random entry from the pool on each new AI response. Display it in the same location as the current dots. Fade in/out on change if the response takes long enough to warrant a second pick (>4s).

**Note:** `ChatPanel.tsx` is the shared component used by both client chat and admin chat. This change applies to both automatically — no separate implementation needed for the admin side.

---

## Group 2 — Strategy + SEO

### 2.1 Briefs Button Context Fix

**Problem:** The `rationale` field (and other card metadata) is passed to the pricing modal but dropped before reaching `generateBrief()` on the server. Briefs are generated without the strategic context visible on the recommendation card.

**Fix:** Thread all available card data through the full pipeline:
- `rationale` — strategic reasoning (the subtext)
- `volume` — monthly search volume
- `difficulty` — keyword difficulty score
- `trendDirection` — rising / declining / stable
- `serpFeatures` — featured_snippet, people_also_ask
- `competitorProof` — competitor validation text
- `impressions` — existing GSC impressions

**Server:** `generateBrief()` in `server/content-brief.ts` receives this as a `strategyCardContext` object and injects it into the brief generation prompt. Calibrates competition framing (difficulty), urgency (trend), differentiation angle (competitorProof), and opportunity size (volume).

**Page-type-aware brief generation:** `pageType` is already passed through the pipeline but only used for word count. Expand to full structural, tonal, and strategic guidance per type — all wired in `generateBrief()` in the same pass as the context fix:

**Tone + structure templates:**
- `blog` → conversational, educational; hook → problem framing → H2/H3 sections → FAQ → internal links → soft CTA
- `landing` → persuasive, conversion-focused; single hook → benefit bullets → trust signals → one CTA, no distractions
- `service` → authoritative, trust-building; value prop → problem/solution → feature/benefit pairs → social proof → objection handling → FAQ → conversion CTA
- `location` → locally grounded; NAP block → service area signals → proximity language → local review integration → map embed note
- `pillar` → comprehensive, cluster-anchoring; topic overview → linked subtopics list → internal linking map → breadth over depth
- `product` → feature-benefit balance; specs → comparison table placeholder → testimonials → pricing context → purchase CTA

**Schema markup recommendations per type:**
- `blog` → `Article` schema
- `service` → `Service` + `LocalBusiness`; flag if currently missing (cross-reference schema validation data)
- `landing` → `WebPage`
- `location` → `LocalBusiness` + `GeoCoordinates`
- `pillar` → `Article` + `BreadcrumbList`
- `product` → `Product` + `AggregateRating`

**Internal linking strategy:**
- Use existing `page_keywords` map to suggest which pages to link to and from
- Pillar pages: list cluster pages to anchor; service pages: link to location variants and related blog posts; blog posts: link back to relevant service/pillar pages

**E-E-A-T signals per type:**
- `service` / `product` → author credentials, certifications, review signals
- `blog` → cited sources, publication + last-updated date
- `location` → proximity language, local references, verified NAP

**Media/asset callouts:**
- `blog` → infographic or custom image per major section
- `service` → process diagram or before/after
- `location` → map embed, location photography
- `product` → product photography, comparison table visual
- `pillar` → summary diagram or visual table of contents

**Competitor content benchmark:**
- Pull top-ranking competitor result for the target keyword from SEMRush domain organic data (already fetched during strategy generation)
- Include in brief: estimated word count of #1 result, key topics covered, content type (list/guide/how-to)
- Frame as: *"Current #1 result is ~1,400 words with a strong FAQ section — target 1,800 words with deeper coverage and schema."*

**Search journey stage:**
- Derive from existing `searchIntent` field: `informational` → Awareness (TOFU), `commercial` → Consideration (MOFU), `transactional` → Decision (BOFU)
- Include in brief as plain-language frame affecting language register, assumed reader knowledge, and CTA type

---

### 2.2 Smarter Recommendation Cards

Three enhancements to the strategy recommendation cards in the client portal:

**A — Predicted Impact (confidence-gated)**
- Shows an estimated monthly visitor impact below the rationale: *"Ranking for this could bring ~340 monthly visitors based on your current traffic profile."*
- **Confidence gate:** Only renders when BOTH conditions are met: (1) `volume > 0` from real SEMRush data, and (2) the workspace has GSC data with a calculable average CTR. Without both, the line is omitted entirely — no placeholder, no estimate.
- Calculation: `volume × estimatedCTR(position)` using a standard CTR curve by position bucket.

**D — Status Tracking**
- Each recommendation card tracks whether action has been taken:
  - Default: no badge
  - Brief requested → amber "Brief requested" badge
  - Brief in production → teal "In production" badge
  - Content published → green "Published" badge
  - Rankings tracked → blue "Tracking" badge with position if available
- Status is derived from existing `content_requests` and `page_keywords` data — no new table needed.

**E — Plain-Language Difficulty Framing**
- Replace the raw `KD {n}` badge with a human-readable label:
  - KD 0–30 → "Low competition — strong odds"
  - KD 31–60 → "Moderate competition — achievable with a strong post"
  - KD 61–80 → "Competitive — requires authority and depth"
  - KD 81–100 → "Highly competitive — long-term play"
- Tooltip shows the raw KD number for admin reference.

---

### 2.3 SEO Editor Unification

**What:** Merge static and CMS pages into a single unified list. Enable bulk SEO generation and apply for ALL page types.

**Page discovery:** Switch SEO editor to use `/api/webflow/all-pages/:siteId` (already returns static + CMS with `source` marker).

**Filtering:** Filter bar above the list with chips for each collection name (e.g., "All", "Static Pages", "Blog", "Changelog", "Services"). Collection names derived from CMS page paths via the sitemap discovery already in place.

**Bulk generate:** Works across all page types. AI generates title/description variations using existing workspace context (brand, keywords, GSC data).

**Bulk apply — two paths:**
- Static pages → existing Webflow Pages API (`updatePageSeo()`)
- CMS pages → `updateCollectionItem(collectionId, itemId, { [metaTitleSlug]: value, [metaDescSlug]: value })` + `publishCollectionItems()` to go live
- Field mapping from workspace `publishTarget.fieldMap` (already in place) determines which CMS field slugs to write to
- CMS pages show a "Publishes to Webflow" indicator in the editor so the write path is transparent

**Read-only fallback:** If a CMS page's collection is not mapped in `publishTarget.fieldMap`, suggestions are generated but marked "Manual apply required" — user can copy/paste into Webflow directly.

**Easy win — select-all per collection:** Each collection chip in the filter bar gets a checkbox that selects all pages in that collection in one click. Saves manually checking every blog post row before bulk generating.

---

### 2.4 Page Intelligence + Strategy Blend

**Problem:** After strategy generation, the Page Intelligence tab shows empty because strategy and Page Intelligence write different field shapes to `page_keywords`.

**Fix:** During strategy's page batch processing phase, write ALL fields that Page Intelligence expects into `page_keywords` via merge-upsert. Strategy already has all the data in memory at this point — this is a wiring fix, not new processing.

**Safety contract:**
1. Pre-implementation audit maps every field both systems read/write — documented in the implementation plan
2. Upsert is additive only: never overwrite a non-null field with null. If Page Intelligence was run independently with richer data, a strategy regeneration preserves it
3. Test: run Page Intelligence on a page → regenerate strategy → assert all Page Intelligence fields are unchanged

**Result:** Navigating to Page Intelligence immediately after strategy generation shows a fully populated view. No separate trigger, no extra cost, no extra time.

---

## Group 3 — Client Portal

### 3.1 Client Brand Section

**What:** New section in the client portal exposing curated, safe brand data.

**Two components:**

**Business Profile (editable):**
- Fields clients can view and update: business description, services offered, contact information
- Changes sync back to workspace business profile
- Smart placeholders on all fields (see 3.3)

**Brand Positioning Summary (read-only):**
- Plain-language summary of calibrated voice characteristics: e.g., *"Your brand voice is calibrated to sound: authoritative, approachable, and jargon-free."*
- Derived from the internal brand voice doc — human-readable takeaway only
- Full brand voice document (prompt-ready format) stays internal, never exposed
- No editing capability on this section

**What stays internal (never shown to clients):**
- Full brand voice document
- Voice calibration scores and raw style parameters
- Anything formatted as a system prompt

---

### 3.2 Hide Site Intelligence — Per-Workspace Toggle

**What:** Admin setting to hide the Site Intelligence module from a specific workspace's client dashboard homepage.

**Location:** Workspace settings → Features tab (alongside existing `clientPortalEnabled`, `seoClientView`, `analyticsClientView` toggles)

**Toggle name:** `siteIntelligenceClientView` (default: `true` — preserves current behavior for all workspaces; admin explicitly sets to `false` to hide)

**Behavior:** When off, the Site Intelligence module is omitted from the client dashboard homepage render. No empty state, no placeholder — the layout simply reflows without it.

---

### 3.3 System-Wide Smart Placeholders

**What:** Every workspace-specific input field across the platform shows contextually relevant placeholder text and (on admin) AI-generated suggestion chips, derived from the workspace knowledge profile.

**Hook:** `useSmartPlaceholder(fieldKey, workspaceContext)` — called once per section load, generates suggestions for all fields in that section in a single batch AI call. Results stored in component state for the session.

**Admin experience (full):**
- Ghost text placeholder: contextually tailored to the workspace's industry and known details
- Suggestion chips below each field: 2–3 tappable pre-fills (e.g., *"Grow new patient appointments by 25% in Q3"*)
- One click to pre-fill the field; user edits from there
- Applies to: all workspace configuration fields, business profile, brand voice inputs, strategy inputs, content brief customization, any admin form tied to a specific workspace

**Client experience (ghost text only):**
- Smart placeholder text only — the field appears to already understand their business
- No chips, no pre-fill buttons, no indication AI generated the placeholder
- Clients experience it as a thoughtfully designed product, not an AI feature
- Controlled by auth context: the `useSmartPlaceholder` hook returns `{ placeholder }` only when called in a client context, and `{ placeholder, suggestions }` in an admin context

**Fallback:** If the workspace knowledge profile is thin (new workspace, no brand data), fall back to generic but slightly smarter defaults (industry-based if available, otherwise standard placeholder copy).

---

## Central Intelligence Wiring

These connections were identified during review and must be included in the implementation — not optional additions.

### Intelligence Slice Status (verified against origin/main)

All 8 slices are fully implemented as of Phase 4A/4B/4C. `formatForPrompt()` covers all 8. Admin chat now dynamically selects slices via `buildWorkspaceIntelligence()`. `INTELLIGENCE_CACHE_UPDATED` is actively broadcast.

**Two genuine gaps in `seoContext` (Brand & Voice Intelligence):**
- `backlinkProfile` — declared optional in `SeoContextSlice`, never populated. Data available via `SeoDataProvider.getBacklinksOverview()`, 7-day file cache.
- `serpFeatures` — declared optional in `SeoContextSlice`, never populated. Data is already fetched during strategy generation via `getDomainOrganicKeywords()` — reuse from `page_keywords` table via `parseSerpFeatures()`. No new API call needed.

Wire both in `assembleSeoContext()` in `workspace-intelligence.ts`. Use `SeoDataProvider` abstraction — no direct vendor calls.

### Smart Placeholder Hook — Intelligence-First

The `useSmartPlaceholder` hook (3.3) must read from the existing `seoContext` intelligence slice rather than making independent AI calls per section. The `seoContext` slice already contains brand voice, personas, keywords, and business context — everything needed to generate placeholder suggestions.

- Single intelligence fetch per workspace session (already cached at 5-minute TTL)
- Placeholder generation uses the cached context to derive suggestions — no additional AI call unless context is stale
- Consistent with every other AI endpoint in the platform (all 26 callers use `buildSeoContext()`)

### Easy Wins — Fold In

**`bridge-client-signal` flag is already defined** in `bridge-infrastructure.ts`. Group 1 implementation just needs to point at it — zero new bridge infrastructure required.

**`INTELLIGENCE_CACHE_UPDATED` is already broadcast** (confirmed in Phase 4A). No work needed here.

**Cache invalidation call sites for new mutations:**
- New `client_signals` insert → `invalidateIntelligenceCache(workspaceId)` + `invalidateSubCachePrefix(workspaceId, 'slice:clientSignals')`
- CMS SEO apply (2.3) → `invalidateIntelligenceCache(workspaceId)` (same as existing static page SEO apply)
- Brand profile client edit (3.1) → `clearSeoContextCache(workspaceId)` + `debouncedSettingsCascade()`

---

## Implementation Groups Summary

| Group | Items | Key constraint |
|-------|-------|----------------|
| Chat + Notifications | CTA button, Signals panel, Notification slide-out fix, Chatbot shimmer | New `client_signals` table; email sending |
| Strategy + SEO | Briefs fix, Smarter cards, SEO editor unification, PI+Strategy blend | CMS write path via existing `updateCollectionItem`; merge-upsert safety |
| Client Portal | Brand section, Site Intelligence toggle, Smart placeholders | Auth-context-aware placeholder hook; brand voice boundary |

---

## Shared Contracts (must be defined before parallel implementation)

These types, migrations, and flags must be committed before any parallel agent work begins. Agents read from committed code — never from each other's in-progress branches.

### New TypeScript interfaces (`shared/types/`)

```typescript
// shared/types/client-signals.ts
interface ClientSignal {
  id: string;
  workspaceId: string;
  type: 'content_interest' | 'service_interest';
  chatContext: ChatMessage[]; // last 10 messages
  status: 'new' | 'reviewed' | 'actioned';
  createdAt: string;
}

// shared/types/briefs.ts (extend existing)
interface StrategyCardContext {
  rationale?: string;
  volume?: number;
  difficulty?: number;
  trendDirection?: 'rising' | 'declining' | 'stable';
  serpFeatures?: string[];
  competitorProof?: string;
  impressions?: number;
}

interface PageTypeBriefConfig {
  pageType: 'blog' | 'landing' | 'service' | 'location' | 'pillar' | 'product' | 'resource';
  journeyStage: 'awareness' | 'consideration' | 'decision';
  schemaType: string[];
  structureTemplate: string[];
  eeatSignals: string[];
  mediaCallouts: string[];
  competitorBenchmark?: { wordCount: number; topicsSummary: string; contentType: string };
}
```

### New DB migrations

| Table/Column | Purpose | Migration # |
|---|---|---|
| `client_signals` table | Store client CTA taps with chat context | next available |
| `workspace.businessPriorities` JSON column | Admin-editable client business goals | next available |

### New feature flags (`shared/types/feature-flags.ts`)

| Flag | Controls |
|---|---|
| `smart-placeholders` | System-wide smart placeholder hook |
| `client-brand-section` | Client portal brand visibility section |
| `seo-editor-unified` | Merged static+CMS SEO editor |

### Key file ownership map (for parallel agent dispatch)

| Feature | Primary files | Must not touch |
|---|---|---|
| Briefs context + page-type config | `server/content-brief.ts`, `server/routes/content-briefs.ts` | `src/components/ContentBriefs.tsx` (separate agent) |
| Smarter cards | `src/components/client/StrategyTab.tsx`, `src/components/strategy/ContentGaps.tsx` | Strategy server routes |
| SEO editor unification | `src/components/SeoEditor.tsx`, `src/components/editor/BulkOperations.tsx`, `server/routes/webflow-seo.ts` | `server/routes/webflow.ts` (shared) |
| PI + Strategy blend | `server/routes/keyword-strategy.ts`, `server/page-keywords.ts` | `src/components/PageIntelligence.tsx` (separate agent) |
| Client signals + notifications | `server/routes/public-chat.ts`, `src/components/NotificationBell.tsx`, `src/components/layout/Sidebar.tsx` | `server/routes/ai.ts` (shared) |
| Client brand section | `src/components/client/ClientDashboard.tsx`, new `src/components/client/BrandTab.tsx` | Admin settings components |
| Smart placeholders hook | New `src/hooks/useSmartPlaceholder.ts`, `src/api/intelligence.ts` | Any component (hook only, no component changes in this task) |
| seoContext gaps | `server/workspace-intelligence.ts` (assembleSeoContext only) | All other assembler functions |

---

## Out of Scope

- Editing the full brand voice document from the client portal
- Automated service purchasing flow (clients signal intent; agency follows up manually)
- Per-field confidence scores for smart placeholder suggestions
- A/B testing content variations (future)

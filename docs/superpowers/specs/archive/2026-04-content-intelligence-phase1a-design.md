# Phase 1a: Content Intelligence Engine — Design Spec

**Status:** Approved
**Prerequisite:** Page Intelligence (shipped), Knowledge Base Crawl (shipped)
**Relationship:** Enhancement to Phase 1b (Brandscript Engine + Voice Calibration). Ships first to start collecting voice data before Phase 1b's UI is built.

---

## Overview

The Content Intelligence Engine is a continuous learning layer that extracts voice patterns, tone observations, and vocabulary preferences from a client's existing website content. It piggybacks on the existing knowledge base crawl, reads page inventory and content types from the shipped Page Intelligence feature, and feeds findings directly into the Phase 1b Voice Profile infrastructure.

The result: by the time the Voice Calibration UI ships in Phase 1b, every workspace already has a baseline voice profile built from real published content. Clients who skip the full brandscript/discovery process still get meaningful voice intelligence. And the platform gets smarter about each client's voice over time as they publish new content.

### Problems this solves

1. **Cold start for voice profiles** — Without this, Voice Calibration in Phase 1b starts from nothing unless the admin manually uploads transcripts or fills in brand voice fields. With this, there's already a data-driven baseline.
2. **Clients with existing brands** — Clients who come with an established website, brand assets, and content history don't need the full discovery process to get voice-aware AI output. The platform learns from what they've already published.
3. **Voice drift over time** — A one-time voice setup becomes stale. Continuous re-analysis keeps the voice profile current as the client's content evolves.
4. **Content-type blindness** — Current AI features treat all content the same. Blog posts should sound different from service pages. Per-content-type voice extraction makes this possible.
5. **Future content channel foundation** — Social copy, email copy, and marketing campaigns need voice intelligence per content type. This builds the data foundation before those features exist.

### What exists today

- **Knowledge Base Crawl** — Hits the client's website and extracts business facts (services, differentiators, FAQs) into the knowledge base. Already scheduled and automated.
- **Page Intelligence** (`PageIntelligence.tsx`) — Shipped feature tracking every page's content type (`schema_page_types`), structure (headings, word count, readability), keyword assignments, content gaps, and search intent. 16 page types already defined.
- **Brand Hub** — Freeform brand voice text field, knowledge base, audience personas, brand docs upload.
- **`buildStyleExampleContext()`** — Existing function that pulls top GA4 pages as style examples for AI prompts. Passes raw text, no structured voice analysis.
- **Web Scraper** (`server/web-scraper.ts`) — Extracts title, meta description, headings, and body text (first 3,000 chars) from URLs.

---

## Architecture

```
Page Intelligence (shipped)
  ├── Page inventory (all URLs)
  ├── Content types (schema_page_types)
  └── Page structure (word count, headings, readability)
        │
        ▼
Knowledge Base Crawl (shipped) ──→ Business facts → Knowledge Base
        │
        │ same crawl data
        ▼
Voice Extraction Pipeline (NEW)
  ├── Group pages by content type
  ├── AI pass per group (GPT-4.1-mini)
  └── Extract: voice samples, tone, vocabulary, structure
        │
        ▼
Phase 1b Voice Profile Tables
  ├── voice_samples (source: 'content_analysis')
  ├── voice_dna_json (additive tone observations)
  └── guardrails_json (vocabulary patterns)
        │
        ▼
Every AI Feature
  (briefs, posts, rewrites, SEO meta, future: social/email/campaigns)
```

---

## Section 1: Continuous Discovery Crawl

### Unified crawl operation

When the knowledge base crawl runs, voice extraction runs as a second pass on the same scraped content. One trigger, two outputs:
- Business facts → knowledge base (existing)
- Voice patterns → voice profile (new)

### Scheduled re-crawl

A workspace-level setting controls automatic re-crawling:
- **Default:** Monthly
- **Configurable:** Weekly, biweekly, monthly, quarterly, or off
- Runs via existing cron infrastructure (same pattern as analytics intelligence refresh)
- Each re-crawl produces a new `discovery_sources` record with `source_type: 'website_crawl'`

### Incremental analysis

The system only re-analyzes pages that have changed since the last crawl:

1. Fetch all pages (same as knowledge base crawl)
2. Compare content hashes against the previous crawl
3. Only send changed/new pages through the AI extraction pass
4. Removed pages are flagged (content was taken down — patterns from those pages may be stale)

This keeps per-crawl AI cost near zero for stable sites and only spends tokens when content actually changes.

### Smart trigger

If Page Intelligence detects significant content changes during its own analysis cycle, it triggers a voice extraction pass ahead of the next scheduled run. Significant means: 3+ new pages added since last crawl, or any single page with >40% content change (by word count delta). A client who redesigns their site or publishes a burst of content doesn't wait a month for the voice profile to catch up.

### Extraction review

- **Initial crawl:** Extractions are surfaced for admin review (accept/dismiss), consistent with Phase 1b's Discovery Ingestion review workflow
- **Scheduled re-crawls:** New extractions are auto-accepted by default (initial crawl established the reviewed baseline). A workspace setting allows switching to manual review for re-crawls if tighter control is needed.

### Confidence handling

Website-crawl-sourced extractions use Phase 1b's existing lower confidence tier. Extractions that remain stable across 3+ consecutive crawls are promoted to medium confidence — if a pattern persists across content updates, it's likely intentional rather than a previous copywriter's artifact.

---

## Section 2: Page Intelligence Integration

### No new page cataloging

The Content Intelligence Engine reads from Page Intelligence's existing data rather than building its own classification system:

| Data needed | Source | Already exists? |
|---|---|---|
| Page inventory (all URLs) | `page_keywords` table | Yes |
| Content type per page | `schema_page_types` table | Yes |
| Page structure (headings, word count, readability) | `page_keywords` analysis fields | Yes |
| Content gaps vs competitors | `page_keywords.content_gaps` | Yes |
| Search intent per page | `page_keywords` intent fields | Yes |

### Content change detection

Page Intelligence already re-analyzes pages and detects structural/content changes (word count shifts, heading changes, readability score changes). The Content Intelligence Engine hooks into this:

- When a page change is detected, the engine stores a content diff summary: what sections changed, word count delta, new/removed headings
- It emits a `content_change_detected` event with before/after baseline snapshots
- The Outcome Intelligence Engine (in development) subscribes to this event for performance comparison at 7/30/60/90-day checkpoints

This is a forward-compatibility hook — detection is built now, measurement lives in the Outcome Engine's domain.

### The integration benefit

Page Intelligence is the "source of truth" for what pages a client has. Connecting it to the brand pipeline unifies the platform's understanding:
- **Page Intelligence** — SEO and structural intelligence per page
- **Voice Profile** — brand and tone intelligence per content type
- **Knowledge Base** — business facts and differentiators

Same pages, three complementary lenses, all feeding into every AI feature.

---

## Section 3: Voice Extraction Pipeline

The core new piece — the AI pass that reads client content and produces voice intelligence.

### When it runs

- **Initial run:** Triggered alongside the first knowledge base crawl (or manually from Brand Hub). Analyzes all pages grouped by content type.
- **Scheduled refresh:** Runs after the monthly re-crawl. Only analyzes changed pages.
- **Smart trigger:** Runs ahead of schedule when Page Intelligence detects significant content changes.

### How it works

1. **Group pages by content type** — Pull from `schema_page_types`. Example: 8 blog posts, 6 service pages, 3 case studies, 1 about page.

2. **Batch by group** — Send each content-type group to GPT-4.1-mini as a single prompt. This produces better patterns than page-by-page analysis because the AI sees enough examples to identify *recurring* patterns vs. one-off anomalies.

3. **Extract per group:**
   - **Voice samples** — 2-3 standout phrases/sentences that best represent the brand voice in this content type. Tagged with `context_tag` matching the content type.
   - **Tone observations** — Where this content type falls on formality, humor, technical depth, and energy spectrums. Maps to Voice DNA structure.
   - **Vocabulary patterns** — Words/phrases they gravitate toward, words they avoid, jargon usage, terminology preferences.
   - **Structural patterns** — How they open content, CTA structure, paragraph length tendencies, heading style.

4. **Merge into Voice Profile:**
   - Voice samples → `voice_samples` table with `source: 'content_analysis'`
   - Tone observations → merged into `voice_dna_json` (additive, does not overwrite manually set values)
   - Vocabulary patterns → merged into `guardrails_json` (forbidden/required terminology)
   - Structural patterns → stored as extraction metadata for downstream prompt enrichment

5. **Conflict resolution:** If the extraction disagrees with existing manually-set voice profile data (e.g., crawl says "formal" but admin set tone to "casual"), the manual setting wins. The extraction is stored but flagged as "divergent" — visible in the UI as a nudge: "Your published blog content reads more formal than your voice profile suggests. Worth reviewing?"

### AI prompt structure (simplified)

```
You are analyzing [N] [content_type] pages from [client domain].

Extract:
1. Voice samples: 2-3 sentences that best capture how this brand writes [content_type] content
2. Tone: Rate formality, humor, technical depth, energy (1-10 scale)
3. Vocabulary: Words/phrases used repeatedly, words notably avoided
4. Structure: How content typically opens, CTA patterns, paragraph rhythm

Output as structured JSON matching the Voice Profile schema.
```

### AI model

GPT-4.1-mini — this is structured pattern extraction, not creative work. Cost: ~$0.01-0.03 per workspace per crawl.

### Content-type grouping

Pages are grouped using `schema_page_types` classifications. Groups with fewer than 2 pages are merged into an "other" group — a single page isn't enough to identify patterns. Groups are processed independently so each content type gets its own voice characterization.

---

## Section 4: Lightweight UI

### Location

A summary card within the Brand Hub, under the Voice section. Not a new tab — a collapsible section within the voice profile view.

### Content Analysis Summary Card

- Last crawl date and next scheduled crawl
- Pages analyzed count and content-type breakdown (e.g., "47 pages: 12 blog, 8 service, 6 location, 3 case study, 18 other")
- Extraction stats: voice samples extracted, tone observations, vocabulary patterns
- Crawl frequency selector (monthly/biweekly/weekly/quarterly/off)

### Divergence alerts (when applicable)

Surfaced when crawl-derived patterns conflict with manually-set voice profile data:
- "Your published blog content reads more formal than your voice profile suggests"
- "Your service pages use 'customers' but your voice guardrails say 'patients'"
- Actionable: click to update the voice profile or dismiss

### Content change log (last 3 changes)

- "3 new blog posts detected (Mar 15) — voice patterns updated"
- "Service page rewrite detected (Mar 8) — tone shift noted"
- Links to the pages that changed

### What it does NOT include

- No page-by-page breakdown (Page Intelligence's job)
- No manual extraction review workflow for re-crawls (auto-accepted after initial crawl review)
- No detailed analytics or charts
- No separate settings page

---

## Section 5: Forward Compatibility — Future Content Channels

This section documents design decisions that make future social/email/campaign features possible without retrofitting.

### Per-content-type voice patterns

Because extractions are grouped by content type from Page Intelligence, the Voice Profile contains tagged data: "this is how they write blog posts" vs. "this is how they write service pages." Future social copy generation can query voice patterns from the client's shortest, punchiest content types (landing pages, CTAs) as the closest analog to social copy.

### Voice sample context tags

Samples extracted with `source: 'content_analysis'` carry a `context_tag` matching the content type. Phase 1b's voice shifting infrastructure (context modifiers for headlines vs. body vs. FAQ) consumes these tags directly. Adding a `social` or `email` context modifier later is a configuration change, not a code change.

### Content change events

The `content_change_detected` event is generic — any future system can subscribe. An email campaign feature could listen for "client published new blog post" and suggest promoting it via email.

### No new types or tables needed for future features

- `voice_samples.source` — Phase 1b already defines the enum; this adds `'content_analysis'` as a value
- `voice_samples.context_tag` — already supports arbitrary tags
- `discovery_extractions.category` — already supports vocabulary, tone, and structural patterns

Future content channels consume what's already there by reading the profile with a new lens, not building a new data pipeline.

---

## Data Model

### Extended Phase 1b tables (no new tables)

**`voice_samples`** — adds `source: 'content_analysis'` to the existing source enum:

```typescript
export type VoiceSampleSource =
  | 'manual'
  | 'transcript_extraction'
  | 'calibration_loop'
  | 'copy_approved'
  | 'identity_approved'
  | 'content_analysis';      // Phase 1a: extracted from website crawl
```

**`discovery_sources`** — uses existing `source_type: 'website_crawl'`. Adds fields:

| Column | Type | Description |
|---|---|---|
| `content_hash` | TEXT NULL | Hash of page content for change detection |
| `content_type` | TEXT NULL | Content type from `schema_page_types` at time of crawl |
| `previous_source_id` | TEXT NULL | Links to previous crawl of same URL for diffing |

**`discovery_extractions`** — uses existing table. Extractions from the Content Intelligence Engine use:
- `extraction_type: 'voice_pattern'`
- `category`: `'voice_sample'`, `'tone_observation'`, `'vocabulary_pattern'`, `'structural_pattern'`
- `confidence`: `'low'` initially, promoted to `'medium'` after 3+ stable crawls
- `status`: `'pending'` for initial crawl (manual review), `'accepted'` auto for re-crawls

### New table: `content_change_log`

Tracks content changes detected across crawls for Outcome Engine integration:

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID |
| `workspace_id` | TEXT FK | Links to workspace |
| `page_url` | TEXT NOT NULL | URL of the changed page |
| `change_type` | TEXT NOT NULL | `'content_updated'`, `'page_added'`, `'page_removed'` |
| `diff_summary` | TEXT NULL | JSON — sections changed, word count delta, heading changes |
| `content_hash_before` | TEXT NULL | Previous content hash |
| `content_hash_after` | TEXT NULL | New content hash |
| `detected_at` | TEXT NOT NULL | ISO timestamp |
| `outcome_event_emitted` | INTEGER DEFAULT 0 | Whether `content_change_detected` event was sent |

### New table: `crawl_schedules`

Workspace-level crawl configuration:

| Column | Type | Description |
|---|---|---|
| `workspace_id` | TEXT PK | Links to workspace |
| `frequency` | TEXT NOT NULL DEFAULT 'monthly' | `'weekly'`, `'biweekly'`, `'monthly'`, `'quarterly'`, `'off'` |
| `last_crawl_at` | TEXT NULL | ISO timestamp of last completed crawl |
| `next_crawl_at` | TEXT NULL | ISO timestamp of next scheduled crawl |
| `auto_accept_extractions` | INTEGER DEFAULT 1 | Whether re-crawl extractions are auto-accepted |
| `updated_at` | TEXT NOT NULL | ISO timestamp |

---

## AI Model Strategy

| Task | Model | Reasoning |
|---|---|---|
| Voice pattern extraction per content-type group | GPT-4.1-mini | Structured pattern recognition, not creative work |
| Content change classification | No AI — hash comparison | Deterministic, zero cost |
| Page content-type classification | None — reads from Page Intelligence | Already classified |
| Divergence detection | GPT-4.1-mini | Compare extraction vs. existing profile, flag conflicts |

**Cost estimate:** ~$0.01-0.03 per workspace per crawl. At 50 workspaces on monthly schedule: ~$0.50-1.50/month total.

---

## Integration Points

| Content Intelligence Concept | Connects To | Relationship |
|---|---|---|
| Page inventory | Page Intelligence `page_keywords` | Reads page list (no duplication) |
| Content types | Page Intelligence `schema_page_types` | Reads classification (no duplication) |
| Voice samples | Phase 1b `voice_samples` | Writes with `source: 'content_analysis'` |
| Tone observations | Phase 1b `voice_profiles.voice_dna_json` | Merges additively |
| Vocabulary patterns | Phase 1b `voice_profiles.guardrails_json` | Merges additively |
| Crawl data | Knowledge Base crawl | Piggybacks on same crawl operation |
| Content changes | Outcome Intelligence Engine | Emits `content_change_detected` event |
| Divergence alerts | Brand Hub Voice section | Surfaces in lightweight UI card |

---

## Service Tier Considerations

Content Intelligence runs for all tiers — it's low-cost background processing that improves AI output quality universally:

- **All tiers:** Automatic voice extraction on crawl, monthly refresh, voice profile enrichment
- **Growth+:** Configurable crawl frequency (weekly/biweekly options), divergence alerts
- **Premium:** Smart trigger (ahead-of-schedule extraction on significant changes), content change log visible in UI

---

## What This Does NOT Cover

- **Brandscript builder or voice calibration UI** — Phase 1b
- **Page strategy or site blueprints** — Phase 2
- **Copy generation or review workflows** — Phase 3
- **Social, email, or campaign content generation** — future features that consume this data
- **Performance measurement of content changes** — Outcome Intelligence Engine's domain
- **New crawl infrastructure** — uses existing knowledge base crawl and web scraper

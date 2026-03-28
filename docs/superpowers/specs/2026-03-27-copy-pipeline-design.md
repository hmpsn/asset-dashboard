# Phase 3: Full Copy Pipeline — Design Spec

**Date:** 2026-03-27
**Status:** Approved
**Prerequisites:** Phase 1 (Brandscript Engine + Voice Calibration), Phase 2 (Page Strategy Engine)
**Branch:** `claude/confident-lamport`

---

## Overview

The Full Copy Pipeline turns the blueprint from Phase 2 into actual copy — headlines, body text, CTAs, FAQs, meta tags, and everything else a page needs. Copy is generated with the full brand context from Phase 1, reviewed section by section with conversational steering, and exported directly to Webflow CMS or as a formatted copy deck.

The blueprint is the pipeline. No new organizing concept — copy lives as a layer on top of the blueprint entries from Phase 2. One artifact carries a page from strategy through execution.

---

## Core Concepts

### Copy Layer

Each blueprint entry gains a copy layer: generated copy that sits alongside its section plan. For each section in the plan:

- **Generated copy** — the AI-produced text
- **Status** — unified flow: `pending` → `draft` → `client_review` → `approved`, with `revision_requested` branching from `client_review` back to `draft`
- **AI annotation** — brief one-liner explaining intent (visible by default)
- **AI reasoning** — detailed rationale (hidden by default, expandable on demand)
- **Steering history** — log of refinement notes and regenerations
- **Client suggestions** — inline text edits from client review (suggesting mode)

The entry's overall copy status derives from its sections — no separate status to manage.

### SEO Metadata

Each entry also generates:
- **SEO title** (50-60 chars, primary keyword front-loaded)
- **Meta description** (150-160 chars, compelling click hook with keyword)
- **OG title** (defaults to SEO title, overridable)
- **OG description** (defaults to meta description, overridable)

These follow the same review status flow as copy sections.

### Copy Intelligence

A workspace-level learning system that makes copy generation smarter over time:
- Patterns extracted from steering notes, manual edits, and approvals
- Examples: "use 'patients' not 'clients'", "client prefers shorter headlines", "avoid passive voice in CTAs"
- Persists across all entries in the workspace — every future generation benefits
- Can be viewed, edited, and toggled on/off

---

## System 1: Copy Generation Engine

### Generation Approach

Generate all sections for a page in a single AI call. The AI sees the full page context so sections flow coherently (hero sets up problem, problem flows into solution, etc.). Review happens section by section after generation.

### Full Context Prompt Architecture

The generation prompt is assembled from 8 context layers:

**Layer 1 — Brand Foundation (Phase 1: Brandscript)**
- Framework type (StoryBrand, Golden Circle, custom)
- All brandscript sections with content
- Key offerings/services extracted from discovery
- Customer journey stages
- Key differentiators

**Layer 2 — Voice (Phase 1: Voice Calibration)**
- Voice DNA traits
- Voice samples — actual examples of approved copy
- Guardrails — hard boundaries (words to avoid, tone limits)
- Context modifiers — how voice shifts per section type (headlines punchier, FAQ conversational, meta descriptions concise)

**Layer 3 — Brand Identity (Phase 1: Brand Identity Generator)**
- Mission statement
- Vision statement
- Core values
- Taglines / slogans
- Brand archetypes
- Messaging pillars (3-5 themes that recur across all copy)

**Layer 4 — Page Strategy (Phase 2: Blueprint)**
- Page name and type
- Primary keyword + secondary keywords
- Section plan with narrative roles, brand notes, SEO notes, word count targets
- Static page vs. CMS collection item
- Position in the site structure

**Layer 5 — Cross-Page Awareness**
- All other pages in the blueprint (names, types, keywords) — prevents overlap
- Already-approved copy from other pages — maintains consistency
- CTA strategy — which pages are conversion points, so supporting pages direct traffic appropriately

**Layer 6 — SEO Intelligence (SEMrush)**
- Keyword metrics (volume, difficulty) for this page's targets
- People Also Ask questions relevant to this page's topic
- Top-ranking competitor content summaries
- Related keywords to weave in naturally

**Layer 7 — Section-Specific Instructions**
For each section:
- Section type + narrative role
- Brand note (emotional/strategic intent)
- SEO note (keyword placement guidance)
- Word count target
- Voice context modifier for this section type

**Layer 8 — Generation Rules**
- Never stuff keywords — weave naturally
- Match approved voice samples in tone and rhythm
- Respect guardrails absolutely
- Headlines: clarity and hook over cleverness
- CTAs: primary + secondary option
- FAQs: address real objections, not softballs
- Consistent terminology across all sections

Each layer is assembled by a dedicated context builder function (extending the existing `seo-context.ts` pattern). Missing layers degrade gracefully — output is still usable, just less refined.

### AI Model

Claude Sonnet 4 for all copy generation — creative work requiring full brand context.

### Output Structure

The AI returns structured JSON: one block per section, each containing:
- Section ID (matching the section plan)
- Generated copy text
- AI annotation (brief)
- AI reasoning (detailed)

Plus SEO metadata block: SEO title, meta description, OG title, OG description.

---

## System 2: Review + Refinement

### Section-by-Section Review

After generation, review each section individually within the blueprint entry view. Each section displays the generated copy with its brief annotation visible.

### Review Actions

**Approve** — marks section as `approved`, moves to next.

**Regenerate with note** — type a quick direction (e.g., "shorter", "more urgent"). AI regenerates that section with full page context + your note. The note is logged in steering history.

**Highlight + steer** — select specific text in the copy, a popover appears with a text input. Type what should change about the selection (e.g., "too salesy", "more empathetic"). AI regenerates the section with surgical guidance. Uses the same `SteeringChat` component from Phase 1.

**Manual edit** — directly edit the copy text. Saves as `draft` with an edit flag.

**Send to client review** — moves section to `client_review` status.

### Steering History

Every regeneration is logged per section:
- The note/direction given
- What was highlighted (if applicable)
- Timestamp
- Which version of the copy resulted

The AI includes recent steering history in its regeneration context, so each attempt builds on previous feedback rather than starting fresh.

### Copy Intelligence Accumulation

As you steer and approve copy across entries, the platform extracts patterns at the workspace level:
- Terminology preferences ("patients" not "clients")
- Tone adjustments ("shorter headlines", "more conversational FAQ")
- Structural patterns ("always lead with the transformation")
- Keyword usage patterns

These are extracted by GPT-4.1-mini from steering notes periodically and stored in the copy intelligence table. Every future generation for the workspace includes these patterns as additional context.

Copy intelligence can be viewed, edited, and toggled on/off in a management UI.

---

## System 3: Client Review

### Client-Facing Copy View

Extends the client portal pattern from Phase 2's blueprint client view:
- Client sees copy organized by page, then by section
- Each section shows the copy with its annotation
- Status badges show which sections need review

### Client Actions

**Approve** — marks section as `approved`.

**Suggest edit** — inline text editing in suggesting mode. The client's suggested text is stored alongside the original. The studio sees both versions and can:
- Accept the suggestion → section moves to `approved`
- Reject the suggestion → section stays in `client_review` with a note
- Modify the suggestion → apply a hybrid, section goes to `approved`

### Doc-Based Review (Alternative)

For clients who prefer working in documents:
1. Export copy deck to Google Docs
2. Client makes edits with Google Docs suggesting mode
3. Studio reviews and accepts/rejects in the doc
4. Manually update the platform with final copy

Future enhancement: automatic doc import to sync changes back.

---

## System 4: Batch Generation

Two modes for generating copy across multiple entries, chosen when you kick off generation:

### Review Inbox Mode

- Generate copy for all selected entries at once (e.g., all 20 service pages)
- Pages generate in parallel (multiple AI calls)
- All pages queue in a review inbox
- Work through them one at a time — approve, steer, regenerate
- Progress bar: "7/20 reviewed"
- Best for: confident in template and voice, just need quality check

### Iterative Batch Mode

- Generate a small batch (3-5 pages) first
- Review and approve that batch
- Steering notes from the first batch are automatically applied to subsequent batches
- Generate next batch with accumulated refinements
- Repeat until all entries are done
- Best for: new templates, tricky clients, dialing in voice before scaling

### Batch Mechanics

- Pages generate in parallel for speed
- Full context payload per page — no shortcuts
- CMS collection items share the template but get unique copy (per matrix variables)
- Progress persists across sessions — close browser, come back, see exactly where you left off
- Can pause and resume batch generation at any point

---

## System 5: Export + Delivery

### Path 1: Webflow CMS API (Primary)

For CMS collections:
1. Platform checks if the Webflow collection exists
2. If not, creates the collection + fields via Webflow API (field names derived from section plan: `hero_headline`, `hero_body`, `problem_body`, `cta_text`, etc.)
3. Pushes approved copy into collection items
4. Subsequent exports update existing items (matched by entry ID mapping)

Static pages are not pushed via API — hand-rolled in Webflow.

Requires Webflow site connected to the workspace.

### Path 2: CSV Export (Fallback)

- Same field structure as the API path
- Column headers match Webflow CMS import format
- One row per CMS item, one column per section field
- Includes SEO metadata columns (seo_title, meta_description, og_title, og_description)
- Upload to Webflow manually and map fields
- Works when Webflow isn't connected or for non-Webflow projects

### Path 3: Copy Deck Document

- Google Doc or Word doc export
- Organized by page, then by section
- Each section shows: section name, narrative role, copy text, brief annotation
- Approved sections marked with checkmark, drafts marked "pending review"
- SEO metadata displayed at the top of each page section
- Suitable for client review, internal handoff, or archival

### Export Scope

- Entire blueprint (all approved entries)
- Selected entries only
- Single entry

---

## Data Model

### New Tables

#### `copy_sections`

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID |
| `entry_id` | TEXT FK | Links to blueprint_entries |
| `section_plan_item_id` | TEXT | Links to specific section in the plan JSON |
| `generated_copy` | TEXT | The actual copy text |
| `status` | TEXT | `pending`, `draft`, `client_review`, `approved`, `revision_requested` |
| `ai_annotation` | TEXT NULL | Brief one-liner explaining intent |
| `ai_reasoning` | TEXT NULL | Detailed rationale (hidden by default) |
| `steering_history` | TEXT | JSON array of {note, highlight?, timestamp, resultVersion} |
| `client_suggestions` | TEXT NULL | JSON — inline edit suggestions |
| `version` | INTEGER | Increments on each regeneration |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

#### `copy_metadata`

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID |
| `entry_id` | TEXT FK | Links to blueprint_entries (one per entry) |
| `seo_title` | TEXT NULL | 50-60 char SEO title |
| `meta_description` | TEXT NULL | 150-160 char meta description |
| `og_title` | TEXT NULL | Open Graph title (defaults to seo_title) |
| `og_description` | TEXT NULL | Open Graph description (defaults to meta_description) |
| `status` | TEXT | Same status flow as copy_sections |
| `steering_history` | TEXT | JSON array |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

#### `copy_intelligence`

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID |
| `workspace_id` | TEXT FK | Links to workspace |
| `pattern_type` | TEXT | `terminology`, `tone`, `structure`, `keyword_usage` |
| `pattern` | TEXT | The learned rule (e.g., "use 'patients' not 'clients'") |
| `source` | TEXT NULL | Which steering note/edit this was derived from |
| `active` | INTEGER | 1 = active, 0 = disabled |
| `created_at` | TEXT | ISO timestamp |

### No Existing Tables Modified

Copy lives in its own tables. Blueprint entries are referenced via `entry_id` FK but not modified. The section plan JSON in `blueprint_entries` defines the structure; `copy_sections` rows reference individual sections by `section_plan_item_id`.

---

## Integration Map

| Phase 3 Concept | Connects To | Relationship |
|---|---|---|
| Copy generation context | Brandscript (Phase 1) | Pulls story elements + messaging pillars |
| Copy generation context | Voice Profile (Phase 1) | Pulls voice DNA, samples, guardrails, context modifiers |
| Copy generation context | Brand Identity (Phase 1) | Pulls mission, vision, values, taglines, archetypes |
| Copy generation context | Blueprint Entry (Phase 2) | Section plan, keywords, narrative roles, brand/SEO notes |
| Copy generation context | SEMrush | Keyword metrics, PAA questions, competitor content |
| Copy sections | Blueprint entries | `entry_id` FK — copy lives on the entry |
| Copy intelligence | Workspace | Workspace-level learning persists across entries |
| Steering UI | SteeringChat (Phase 1) | Reuses the same component |
| Client review | Client portal pattern | Read-only + suggesting mode |
| Webflow export | Webflow CMS API (MCP) | Creates collections + pushes items |
| Doc export | Google Docs / Word | Formatted copy deck |
| CSV export | Webflow CMS import | Fallback when API not connected |

---

## UI Location

Phase 3 extends the existing Blueprint Detail view from Phase 2. No new top-level tab — copy lives inside the blueprint.

### Key Views

1. **Entry copy view** — section plan on the left, generated copy on the right. Review controls per section (approve, regenerate, steer, edit).
2. **Batch generation controls** — at the blueprint level. Select entries, choose mode (Review Inbox or Iterative Batch), kick off generation.
3. **Review inbox** — list of entries with copy to review, progress tracking, filter by status.
4. **Copy intelligence manager** — workspace-level view of learned patterns. View, edit, toggle on/off.
5. **Export panel** — choose export path (Webflow API, CSV, copy deck), select scope (all/selected/single).
6. **Client copy review** — read-only view with approve + suggest edit per section.

---

## Service Tier Considerations

- **Essentials** — Single-page copy generation only, no batch mode, CSV export only, no client review portal
- **Professional** — Full copy generation, both batch modes, all export paths, client review portal
- **Premium** — everything in Professional + copy intelligence accumulation, Webflow CMS API push, iterative batch learning

---

## AI Model Strategy

| Task | Model | Reasoning |
|---|---|---|
| Full page copy generation | Claude Sonnet 4 | Creative work requiring full brand context |
| Section regeneration with steering | Claude Sonnet 4 | Creative refinement with surgical guidance |
| SEO title + meta description | GPT-4.1-mini | Constrained format, keyword-focused |
| Copy intelligence extraction | GPT-4.1-mini | Structured pattern extraction from steering notes |
| Annotation + reasoning | Included in main generation call | No separate call needed |

---

## Phase Dependencies

Phase 3 depends on both Phase 1 and Phase 2:

- **From Phase 1:** Brandscript content, voice profile (DNA + samples + guardrails + context modifiers), brand identity deliverables, `SteeringChat` component, `callAnthropic`/`callOpenAI` wrappers, `seo-context.ts` builder pattern
- **From Phase 2:** Blueprint entries with section plans, keyword assignments, narrative roles, brand/SEO notes, page type templates, Content Matrix integration for scaled collections

Phase 3 is the culmination — it uses everything built in Phases 1 and 2 to produce the final output.

---

## Addendum: Holistic Review Enhancements (Added 2026-03-27)

> These enhancements were identified during the cross-phase holistic review. They leverage existing codebase infrastructure to make copy generation significantly more powerful without adding UI complexity.

### Enhancement 1: Content Brief as Intermediate Enrichment Step

**The single highest-value addition to this spec.**

Before generating copy for a blueprint entry, auto-generate a Content Brief using the existing `generateBrief()` function from `server/content-brief.ts`. This enriches the section plan with data the existing brief system already knows how to gather:

- Real People Also Ask questions from SERP scraping
- Top-ranking competitor page summaries (what's already ranking — what to beat)
- E-E-A-T guidance (experience, expertise, authority, trust signals)
- Internal link suggestions (which other pages to cross-link)
- Topical entities for topical authority
- CTA recommendations
- Schema.org recommendations per page type
- Keyword validation with volume/difficulty metrics

**Updated pipeline flow:**
```
Blueprint Entry (strategy)
    ↓
Auto-Generate Content Brief (enrichment — existing function, no new code)
    ↓
Generate Copy (using brief as detailed creative brief)
    ↓
Quality Check (WRITING_QUALITY_RULES scan)
    ↓
Review + Steer → feedback loops
```

**Implementation requirements:**
- Call `generateBrief()` per blueprint entry before copy generation
- Store the brief ID on the blueprint entry (`brief_id` FK — added in Phase 2 addendum)
- Pass the full brief data into the copy generation prompt as Layer 4.5 (between Page Strategy and Cross-Page Awareness)
- If brief generation fails (SEMrush rate limit, etc.), proceed with copy generation using the section plan alone — degrade gracefully, never block
- For batch generation, generate briefs in parallel before copy generation starts

**Critical rule:** Do NOT skip brief generation to save time. The brief provides the competitive intelligence that makes copy actually rank. Without it, copy is on-brand but SEO-blind beyond basic keyword placement.

### Enhancement 2: Writing Quality Rules Integration

The existing `WRITING_QUALITY_RULES` block from `server/content-posts-ai.ts` must be injected into every copy generation prompt. This is a string constant — zero implementation cost.

**What it includes:**
- 25+ forbidden AI cliche phrases ("Did you know...", "In today's world...", "Let's dive in...", "game-changing", "secret sauce", etc.)
- Structural anti-patterns (no section-end summaries, varied list lengths, no repeated metaphors across sections)
- Fabrication rules (never invent statistics, never invent quotes)
- Brand mention limits (max 2-3 in entire article, none in first paragraph)

**Implementation:**
```typescript
import { WRITING_QUALITY_RULES } from './content-posts-ai.js';

// Add to Layer 8 (Generation Rules) in the copy generation prompt:
const generationRules = `
${WRITING_QUALITY_RULES}

ADDITIONAL COPY-SPECIFIC RULES:
- Headlines: clarity and hook over cleverness
- CTAs: always include primary + secondary option
- FAQs: address real objections, not softballs
- Consistent terminology across all sections
`;
```

**If `WRITING_QUALITY_RULES` is not currently exported, export it.** Do not copy-paste the rules into a new constant.

### Enhancement 3: AEO Principles in Copy Generation

FAQ sections, educational content, and service page body copy must be generated with AEO (Answer Engine Optimization) principles baked in from the start — not just applied as a post-hoc review.

**AEO rules to add to the generation prompt:**
- Write for AI citation-worthiness (encyclopedic precision + brand voice)
- Replace superlatives with evidence ("market-leading" → specific metric or proof point)
- Use "According to [specific source]..." framing when referencing data
- Definition blocks are disproportionately cited by AI — include clear definitions for key terms
- FAQ answers must be concise, direct, and self-contained (each answer should make sense without reading the question)
- Comparison content needs measurable fields with units, not vague claims

**Source:** Extract AEO rules from `server/aeo-page-review.ts` prompt. Do not duplicate — import or reference the same rules.

### Enhancement 4: Auto Quality Check on Generated Copy

After copy is generated but before it enters `draft` status, run a lightweight quality scan. This is a regex/pattern check — no AI call needed.

**Scan for:**
- Any phrase from the `WRITING_QUALITY_RULES` forbidden list
- Keyword stuffing (same keyword appearing more than 3x in a single section)
- Word count violations (section copy more than 50% over or under the target)
- Missing elements (hero section without a headline, CTA without an action verb)
- Guardrail violations (check against voice profile guardrails — forbidden words, required terminology)

**Output:** Quality flag per section. Flagged sections get a warning badge in the review UI: "Auto-check: contains forbidden phrase 'in today's world'" so you can fix it before reviewing.

**Implementation:** Pure JavaScript string matching. No AI call. Runs synchronously after generation returns. Add the quality flags to the `copy_sections` table as a `quality_flags` JSON column (nullable).

**Add to `copy_sections` table:**
```sql
quality_flags TEXT  -- JSON array of {type, message, severity} or NULL if clean
```

### Enhancement 5: Page-Type-Specific Generation Instructions

The existing content brief system has battle-tested page type configs with word count ranges, section counts, and writing style guidance per type. Copy generation MUST use these rather than generic instructions.

**Implementation:**
```typescript
import { PAGE_TYPE_CONFIGS } from './content-brief.js';

// When generating copy for a service page:
const config = PAGE_TYPE_CONFIGS['service'];
// config.writingStyle → "Professional, benefit-focused, trust-building..."
// config.wordCountRange → { min: 1500, max: 2500 }
// config.sectionCount → { min: 5, max: 8 }
```

**If `PAGE_TYPE_CONFIGS` is not currently exported, export it.**

Include the page type's `writingStyle` as additional context in the generation prompt. This gives the AI page-type-appropriate instructions without the user needing to configure anything.

### Enhancement 6: Smart Context Selection by Page Type

Not every page needs the same weight of context. A homepage generation should emphasize brand identity; a location page should emphasize local SEO.

**Emphasis mapping:**
```typescript
const PAGE_TYPE_CONTEXT_EMPHASIS: Record<string, {
  brandscript: ContextEmphasis;
  voice: ContextEmphasis;
  identity: ContextEmphasis;
  seo: ContextEmphasis;
}> = {
  homepage:  { brandscript: 'full', voice: 'full', identity: 'full', seo: 'summary' },
  about:     { brandscript: 'full', voice: 'full', identity: 'full', seo: 'minimal' },
  service:   { brandscript: 'summary', voice: 'full', identity: 'summary', seo: 'full' },
  location:  { brandscript: 'minimal', voice: 'summary', identity: 'minimal', seo: 'full' },
  blog:      { brandscript: 'summary', voice: 'full', identity: 'minimal', seo: 'full' },
  faq:       { brandscript: 'summary', voice: 'summary', identity: 'minimal', seo: 'summary' },
  contact:   { brandscript: 'minimal', voice: 'summary', identity: 'minimal', seo: 'minimal' },
};
```

**Uses the `ContextEmphasis` parameter added to seo-context.ts builders in the Phase 1 addendum.**

### Enhancement 7: Internal Link Suggestions in Copy

The content brief system already generates internal link suggestions. When generating copy, include the full site map from the blueprint so the AI can:
- Suggest natural internal links within body copy
- Reference other pages in CTAs ("Learn more about our [service name]")
- Cross-link FAQ answers to relevant service pages

**Implementation:** Include a "SITE MAP FOR INTERNAL LINKING" block in Layer 5 (Cross-Page Awareness) listing all blueprint entries with their names, page types, and primary keywords. The AI uses this to create contextually relevant internal links.

### Enhancement 8: Competitor Content Awareness

For service, product, and blog pages, the auto-generated brief includes competitor content summaries from SERP data. Include these in the copy generation prompt as:

```
COMPETITOR CONTENT (differentiate from these — don't repeat their approach):
1. [Competitor Page Title] — [Summary of their angle, tone, key points]
2. [Competitor Page Title] — [Summary]
3. [Competitor Page Title] — [Summary]

Your copy should: address the same topic but with a unique angle, use the brand voice (not a generic version of their tone), and include proof points they don't have.
```

**This data comes from the auto-generated brief — no additional API calls.**

### Enhancement 9: Bidirectional Voice Feedback Loop

When copy is steered during review, the steering notes should feed back into the Phase 1 voice profile — not just the copy intelligence table.

**Two feedback paths:**

**Path A: Copy Intelligence (existing in spec)** — workspace-level patterns extracted from steering notes. "Use 'patients' not 'clients'" → copy intelligence rule.

**Path B: Voice Profile Refinement (new)** — when steering notes indicate a voice issue (not just a content issue), update the voice profile:
- Steering note contains tone language ("too formal", "more playful", "less corporate") → adjust voice DNA trait scores
- Steering note references specific words ("don't use 'synergy'") → add to voice guardrails
- Approved section is markedly different from existing voice samples → add as a new voice sample with `source: 'copy_approved'`

**Detection logic:** GPT-4.1-mini classifies each steering note as `content_feedback` (adjust this section's content) or `voice_feedback` (adjust the overall voice profile). Content feedback stays in copy intelligence. Voice feedback propagates to the voice profile.

**Implementation:** After copy intelligence extraction runs, check for voice-classified patterns and call the appropriate voice profile update functions from `server/voice-calibration.ts`.

**Critical rule:** Voice profile changes from copy feedback should be flagged for review, not applied silently. Show a notification: "Based on your copy feedback, we suggest adding 'never use synergy' to your voice guardrails. [Apply] [Dismiss]"

### Enhancement 10: Approved Copy as Training Data

Every approved copy section is a high-quality, client-vetted example of on-brand writing for that section type. These should automatically feed the voice sample pool.

**Rules:**
- When a section is approved, save it as a voice sample with `source: 'copy_approved'` and `context_tag` matching the section type (hero → 'headline', cta → 'cta', faq → 'faq', etc.)
- Cap at 3 copy-approved samples per context_tag to avoid overwhelming the voice samples
- Newer approved samples replace older ones (FIFO per context_tag)
- Only save sections with status `approved` — never `draft` or `client_review`

**Mapping from section type to voice sample context_tag:**
```typescript
const SECTION_TYPE_TO_CONTEXT_TAG: Record<string, string> = {
  'hero': 'headline',
  'problem': 'body',
  'solution': 'body',
  'features-benefits': 'body',
  'process': 'body',
  'social-proof': 'body',
  'testimonials': 'body',
  'faq': 'faq',
  'cta': 'cta',
  'about-team': 'about',
  'content-body': 'body',
};
```

**This is the system's most powerful self-improvement mechanism.** The more copy you approve, the better the voice samples get, the better future copy gets. Virtuous cycle.

### Enhancement 11: Brief Quality Feedback Loop

Track which auto-generated briefs produce copy that's approved on first try vs. heavily steered. Use this signal to improve future brief generation.

**Implementation:**
- When copy for an entry is fully approved, record `first_try_approval_rate` on the brief (what % of sections were approved without regeneration)
- After 10+ briefs in a workspace, identify patterns: "service page briefs need more competitor differentiation" or "blog briefs produce good copy — no changes needed"
- Surface these insights in the brief generation prompt for future briefs: "In this workspace, service page briefs perform better with detailed competitor analysis. Include extra competitor context."

**Data:** Add `copy_approval_rate` (REAL, nullable) column to `content_briefs` table. Updated by Phase 3 when all sections for a linked entry are approved.

### Enhancement 12: Quality Rules Evolution

When copy intelligence extracts a pattern that appears 3+ times, the platform should suggest elevating it to a voice guardrail or a writing quality rule.

**Flow:**
1. Copy intelligence pattern "avoid passive voice in CTAs" appears in 3+ steering notes
2. Platform suggests: "This pattern has appeared 3 times. Add as a voice guardrail? [Add to Guardrails] [Keep as Intelligence Only]"
3. If added to guardrails, it becomes a hard boundary checked by both the generation prompt and the auto quality scan

**Implementation:** Add a `frequency` counter to `copy_intelligence` table. Increment each time the same pattern is extracted. When frequency hits threshold (3), flag for promotion.

**Add to `copy_intelligence` table:**
```sql
frequency INTEGER NOT NULL DEFAULT 1  -- how many times this pattern has been observed
```

### Enhancement 13: Steering Chat Auto-Summarization

The SteeringChat component (built in Phase 1, reused in Phase 3) must include conversation auto-summarization per the Phase 1 addendum.

**Phase 3 specific requirements:**
- Summarization triggers after 6 steering exchanges within a single section's review
- Summary preserves: directions given, what was rejected, what was approved, current trajectory
- Recent 3 exchanges remain in full
- Summary is stored in `copy_sections.steering_history` as a `{type: 'summary', content: '...'}` entry

### Enhancement 14: Reuse Client Review Workflow

The existing content plan review system (`server/routes/content-plan-review.ts`) has client approval batches, sample-then-batch-approve flow, and per-cell flagging. Phase 3's client copy review should extend this pattern rather than building from scratch.

**What to reuse:**
- Client review link generation (share via URL)
- Batch approval mechanics (approve multiple sections at once)
- Client comment/flag pattern
- Review status tracking

**What's new (Phase 3 adds):**
- Inline suggesting mode (client can edit text, not just approve/flag)
- Per-section review (existing system is per-cell, which maps to per-entry)

### Updated Data Model Changes

Based on the enhancements above, the following changes to the Phase 3 data model:

**`copy_sections` — add column:**
```sql
quality_flags TEXT  -- JSON array of {type, message, severity} or NULL if clean
```

**`copy_intelligence` — add column:**
```sql
frequency INTEGER NOT NULL DEFAULT 1  -- observation count for promotion detection
```

**`content_briefs` (existing table) — add column:**
```sql
copy_approval_rate REAL  -- % of linked copy sections approved without regeneration
```

### Updated AI Model Strategy

| Task | Model | Reasoning |
|---|---|---|
| Full page copy generation | Claude Sonnet 4 | Creative work requiring full brand context |
| Section regeneration with steering | Claude Sonnet 4 | Creative refinement with surgical guidance |
| SEO title + meta description | GPT-4.1-mini | Constrained format, keyword-focused |
| Copy intelligence extraction | GPT-4.1-mini | Structured pattern extraction from steering notes |
| Steering note classification (content vs. voice) | GPT-4.1-mini | Binary classification — fast, cheap |
| Auto quality check | No AI — regex/pattern matching | Synchronous, free, instant |
| Brief quality analysis | GPT-4.1-mini | Structured pattern analysis after 10+ briefs |
| Annotation + reasoning | Included in main generation call | No separate call needed |

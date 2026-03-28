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

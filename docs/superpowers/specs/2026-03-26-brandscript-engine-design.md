# Phase 1: Brandscript Engine + Voice Calibration

**Date:** 2026-03-26
**Status:** Design approved
**Scope:** Brand-aware copy layer — structured brandscript system, discovery ingestion, voice calibration, and brand identity deliverable generation
**Phase:** 1 of 3 (Phase 2: Page Strategy Engine, Phase 3: Full Copy Pipeline)

---

## Context

hmpsn.studio builds websites for clients using a discovery-driven process: structured questionnaires, branding workshops, and client calls produce a "brand bible" (typically a StoryBrand BrandScript) that guides copywriting and design. The current platform has a Brand Hub with freeform text fields for voice and a knowledge base, but the gap between what's captured in discovery and what the AI can use for copy generation is large.

### Problems this solves

1. **SEO vs. Brand tension** — AI-generated copy optimizes for keywords at the expense of brand voice. The AI lacks enough brand context to balance both.
2. **Manual translation overhead** — Discovery insights (transcripts, workshop notes, brand docs) must be manually distilled into Brand Hub fields. This is time-consuming and lossy.
3. **Flat voice definition** — "Professional and friendly" tells the AI almost nothing. Copy comes out generic and requires heavy revision.
4. **Missing branding deliverables** — Mission, vision, values, messaging pillars, and other brand identity artifacts are created manually outside the platform, despite the platform having all the raw material to generate them.
5. **Inconsistent voice across contexts** — A hero headline should sound different from an FAQ answer, but the current single voice setting can't express that nuance.

### What exists today

- **Brand Hub** (`BrandHub.tsx`) — freeform brand voice text, knowledge base, audience personas, brand docs upload
- **Client Onboarding Questionnaire** (`ClientOnboardingQuestionnaire.tsx`) — captures business info, audience, brand personality traits, competitors
- **Brand docs folder** — `.txt` and `.md` files included in AI prompts
- **SEO context pipeline** (`seo-context.ts`) — builds brand voice + knowledge base + personas + keyword context for every AI call
- **Content quality engine** — anti-cliche guardrails, forbidden phrases, structural rules
- **Knowledge base auto-generation** — crawls client website to extract business facts

---

## Architecture Overview

Four interconnected systems, each independently useful:

```
Otter Transcripts ──┐
                    ├──→ Discovery Ingestion ──→ Extracted Voice + Story Elements
Brand Docs (.txt/.md) ┘                              │
Website Crawl ─────────┘                              │
                                                      ▼
Manual Input ────────────→ Brandscript Builder ◄── Extracted Story Elements
                                    │
Voice Samples ───────────→ Voice Calibration ◄─── Extracted Voice Patterns
                                    │
                                    ▼
                    Brand Identity Generator ──→ Mission / Vision / Values / etc.
                                    │
                                    ▼
                    Enriched AI Context ──→ All existing features
                                           (briefs, posts, SEO, rewrites, CMS editor)
```

---

## Section 1: Brandscript Builder

### Purpose

Replace the freeform Brand Hub voice field with a structured narrative framework. StoryBrand is the default, but the system supports custom frameworks for clients where StoryBrand isn't the right fit.

### Framework support

**StoryBrand (default):** Pre-built sections mapping to the BrandScript structure:
- Hook — Setting the stage
- Character — Who is the customer, what do they want
- Problem — External, Internal, Philosophical
- Guide — Empathy + Authority
- Plan — Simple steps to engage
- Call to Action — Primary + Secondary CTAs
- Failure — Stakes if they don't act
- Success — Transformation they experience

**Custom frameworks:** Sections can be added, removed, renamed, and reordered. Custom frameworks can be saved as reusable templates. Examples:
- "Problem / Solution / Proof" for B2B SaaS
- "Why / How / What" (Golden Circle)
- Any structure the studio develops over time

### Three population modes

1. **Manual** — Fill in each section directly via rich text editor. For when you already have a polished brandscript.
2. **Import** — Paste a full brandscript document (markdown or plain text). AI parses it into structured sections automatically. Review and adjust.
3. **AI-Assisted** — Fill in 2-3 key sections (Character + Problem is usually enough). AI drafts the remaining sections using ingested transcripts, brand docs, and questionnaire responses.

### Integration with existing Brand Hub

The brandscript does not replace the Brand Hub — it enhances it. The Brand Hub becomes the home for all brand assets:
- **Brandscript** (new) — structured narrative framework
- **Voice Profile** (new) — calibrated voice with samples and guardrails
- **Brand Identity** (new) — mission, vision, values, deliverables
- **Knowledge Base** (existing) — business facts, services, differentiators
- **Audience Personas** (existing) — enhanced with brandscript Character data
- **Brand Docs** (existing) — uploaded files

### Data model

```
brandscripts
  id              TEXT PRIMARY KEY
  workspace_id    TEXT NOT NULL (FK → workspaces)
  name            TEXT NOT NULL
  framework_type  TEXT NOT NULL DEFAULT 'storybrand'  -- 'storybrand' | 'custom' | template ID
  created_at      TEXT NOT NULL
  updated_at      TEXT NOT NULL

brandscript_sections
  id              TEXT PRIMARY KEY
  brandscript_id  TEXT NOT NULL (FK → brandscripts)
  title           TEXT NOT NULL
  purpose         TEXT           -- description of what this section captures
  content         TEXT           -- rich text content
  sort_order      INTEGER NOT NULL

brandscript_templates
  id              TEXT PRIMARY KEY
  name            TEXT NOT NULL
  description     TEXT
  sections_json   TEXT NOT NULL  -- JSON array of {title, purpose} defining default sections
  created_at      TEXT NOT NULL
```

---

## Section 2: Discovery Ingestion

### Purpose

Upload raw materials from the discovery process — Otter transcripts, brand docs, existing website copy — and extract structured brand intelligence that feeds into the Brandscript Builder, Voice Profile, and Brand Identity Generator.

### Supported inputs

**Discovery transcripts:**
- Raw Otter `.txt` exports (primary use case)
- Handles messy formatting: timestamps, speaker labels, filler words, cross-talk
- Speaker identification: attributes quotes to client vs. interviewer
- Multiple transcripts per workspace — each deepens the profile

**Brand documents:**
- `.txt` and `.md` files (extends existing brand-docs support)
- Existing brand guidelines, style guides, previous copy
- Competitor materials (tagged as contrast — "what to avoid")
- Questionnaire responses from the onboarding wizard

**Existing website copy (quick-turn projects):**
- Crawl the client's current website (extends existing knowledge base crawl)
- Extract voice patterns from published copy
- Flagged with lower confidence: "extracted from published copy — may reflect a previous copywriter's voice rather than the client's authentic voice"
- Useful when transcripts and calls aren't available

### What gets extracted

**Voice patterns** (→ feeds Voice Calibration):
- Signature phrases — lines they repeat, natural catchphrases
- Vocabulary — words they gravitate toward vs. avoid
- Tone markers — humor style, formality level, energy
- Metaphors and analogies — how they explain their business
- Sentence patterns — short/punchy vs. flowing narrative

**Story elements** (→ feeds Brandscript Builder + Brand Identity Generator):
- Origin story — why they started, what drove them
- Customer problems — pain points (external, internal, philosophical)
- Solution framing — how they describe what they do differently
- Authority markers — credentials, experience, proof points
- Empathy signals — how they relate to customer frustrations
- Success stories — transformations they describe
- Values in action — principles they reference naturally

### Extraction workflow

1. **Upload** — Drag and drop transcripts/docs into Brand Hub. Each file tagged with type: transcript, brand doc, competitor, existing copy, or website crawl.
2. **Process** — AI reads each file, cleans transcript formatting, identifies speakers, extracts voice patterns and story elements. 30-60 seconds per file.
3. **Review extractions** — You see what the AI found: voice patterns and story elements, each with the source quote highlighted. Accept, edit, or dismiss each extraction.
4. **Route to destinations** — Accepted extractions flow into the appropriate system: voice patterns → Voice Profile, story elements → Brandscript sections, values/mission language → Brand Identity inputs.
5. **Accumulate** — Upload more transcripts after follow-up calls. New extractions merge with existing profile. Contradictions flagged for review (e.g., "In call 1 they said 'premium', in call 3 they said 'accessible' — which positioning?").

### Source confidence tiers

The system tracks where each extraction came from and assigns confidence:
1. **High confidence** — From discovery transcripts (founder's natural voice)
2. **Medium confidence** — From brand docs and questionnaire responses (intentional but polished)
3. **Lower confidence** — From existing website copy (may reflect previous copywriter)

Confidence is visible during review and influences how heavily the AI weights each source.

### Data model

```
discovery_sources
  id              TEXT PRIMARY KEY
  workspace_id    TEXT NOT NULL (FK → workspaces)
  filename        TEXT NOT NULL
  source_type     TEXT NOT NULL  -- 'transcript' | 'brand_doc' | 'competitor' | 'existing_copy' | 'website_crawl'
  raw_content     TEXT NOT NULL
  processed_at    TEXT
  created_at      TEXT NOT NULL

discovery_extractions
  id              TEXT PRIMARY KEY
  source_id       TEXT NOT NULL (FK → discovery_sources)
  workspace_id    TEXT NOT NULL (FK → workspaces)
  extraction_type TEXT NOT NULL  -- 'voice_pattern' | 'story_element'
  category        TEXT NOT NULL  -- e.g., 'signature_phrase', 'origin_story', 'metaphor', 'authority_marker'
  content         TEXT NOT NULL  -- the extracted insight
  source_quote    TEXT           -- the original text it was extracted from
  confidence      TEXT NOT NULL  -- 'high' | 'medium' | 'low'
  status          TEXT NOT NULL DEFAULT 'pending'  -- 'pending' | 'accepted' | 'dismissed'
  routed_to       TEXT           -- 'voice_profile' | 'brandscript' | 'identity' | NULL
  created_at      TEXT NOT NULL
```

---

## Section 3: Voice Calibration

### Purpose

Go beyond adjective-based voice descriptions. Teach the AI to sound like the client through concrete samples, structured traits, and hard guardrails. Includes a conversational calibration loop for iterative refinement.

### Three layers of voice definition

**Layer 1: Voice Samples**
Show, don't tell — examples of copy that nails the voice.
- Paste 3-5 samples of on-brand copy
- Sources: existing site, previous projects, competitor copy you admire, copy you wrote manually
- Auto-populated from transcript extractions (signature phrases and natural language)
- Each sample tagged with context: "hero headline," "body copy," "CTA," "about section"
- The AI uses these as style anchors for generation

**Layer 2: Voice DNA**
Structured traits extracted and refined from all sources.
- Personality traits — e.g., "Witty but never sarcastic," "Confident but never arrogant"
- Tone spectrum — position on scales: formal↔casual, serious↔playful, technical↔accessible
- Sentence style — short/punchy, flowing/narrative, mixed rhythm
- Vocabulary level — reading grade, jargon tolerance
- Humor style — none, self-deprecating, observational, dry
- Auto-generated from transcripts + samples, editable by user

**Layer 3: Guardrails**
Hard boundaries the voice must never cross.
- Forbidden words/phrases — "synergy," "leverage," "best-in-class," etc.
- Required terminology — "patients" not "clients," "office" not "clinic"
- Tone boundaries — "never condescending," "don't use fear-based urgency"
- Anti-patterns — "no corporate buzzwords," "no exclamation marks in headlines"
- Builds on existing content quality engine anti-cliche guardrails

### Context-aware voice shifting

Brand voice adapts per copy context:
- **Headlines & CTAs** — Maximum personality. Punchy. Humor welcome.
- **Service descriptions** — Clear and warm. Less humor, more reassurance.
- **SEO meta titles/descriptions** — Brand voice balanced with keyword requirements. Personality in the description, precision in the title.
- **Blog / long-form** — Full voice. Narrative rhythm. Room for extended personality.
- **FAQ / educational** — Accessible, helpful. Expertise without condescension.

Context modifiers are configurable per workspace.

### Voice Test & Calibration Loop

Interactive refinement — not just rate, but steer.

1. **Generate** — Pick a prompt type (hero headline, about section intro, service page body). AI generates 3 variations using the current voice profile.
2. **Rate** — Rate each variation: On-brand / Close but off / Wrong. Optionally add direction ("too formal," "the humor feels forced here").
3. **Steer** — Conversational refinement beyond simple ratings:
   - Inline direction — highlight a phrase and say "more like this" or "too corporate here"
   - Comparative steering — "Variation B is closest, but blend in the casualness from A"
   - Iterative riffing — keep refining a single piece of copy until it's perfect
4. **Anchor** — Perfected copy from the calibration loop automatically becomes a new voice sample. The more you calibrate, the better the samples get.
5. **Lock** — When satisfied, mark the voice as "calibrated." This becomes the active voice profile for all AI features in the workspace.

The calibration loop doubles as a copy workshop tool — usable during weekly client sessions for real-time voice refinement with the client in the room.

### Enriched AI context payload

Replaces the current thin brand voice block in `seo-context.ts`:

```
BRAND VOICE PROFILE:
  Personality: Witty but never sarcastic. Confident but never arrogant.
  Tone: Casual (7/10), Playful (6/10), Direct (8/10)
  Humor: Self-deprecating, observational. Used to disarm anxiety.
  Sentence style: Short punchy lines with occasional longer payoff.

VOICE SAMPLES (write like these):
  [headline] "Walk into an office that doesn't smell like 1982"
  [body] "Nobody judges you for skipping flossing since 2019"
  [positioning] "Treatment plans speak plain English"

GUARDRAILS (never do these):
  - Never use: "state-of-the-art", "cutting-edge", "your smile journey"
  - Always use: "patients" not "clients", "office" not "clinic"
  - Never: condescending, fear-based urgency, corporate buzzwords

NARRATIVE CONTEXT (from brandscript):
  Hero: Sarasota professionals tired of corporate chains and outdated practices
  Problem: Anxiety, judgment, surprise bills, confusing jargon
  Guide positioning: Empathetic local expert, modern but personal
  Transformation: Confident, cared for, surprisingly relaxed

MESSAGING PILLARS:
  1. Modern comfort  2. Radical transparency  3. No-judgment care

CONTEXT MODIFIER (for this copy type):
  [Headlines] Maximum personality. Punchy. Humor welcome.
```

### Data model

```
voice_profiles
  id              TEXT PRIMARY KEY
  workspace_id    TEXT NOT NULL (FK → workspaces)
  status          TEXT NOT NULL DEFAULT 'draft'  -- 'draft' | 'calibrating' | 'calibrated'
  voice_dna_json  TEXT  -- personality traits, tone spectrum, sentence style, humor style, vocab level
  guardrails_json TEXT  -- forbidden words, required terms, tone boundaries, anti-patterns
  context_modifiers_json TEXT  -- per-context voice shifts (headlines, body, SEO, blog, FAQ)
  created_at      TEXT NOT NULL
  updated_at      TEXT NOT NULL

voice_samples
  id              TEXT PRIMARY KEY
  voice_profile_id TEXT NOT NULL (FK → voice_profiles)
  content         TEXT NOT NULL
  context_tag     TEXT  -- 'headline' | 'body' | 'cta' | 'about' | 'service' | 'social'
  source          TEXT  -- 'manual' | 'transcript_extraction' | 'calibration_loop'
  sort_order      INTEGER
  created_at      TEXT NOT NULL

voice_calibration_sessions
  id              TEXT PRIMARY KEY
  voice_profile_id TEXT NOT NULL (FK → voice_profiles)
  prompt_type     TEXT NOT NULL  -- 'hero_headline' | 'about_intro' | 'service_body' | etc.
  variations_json TEXT NOT NULL  -- array of {text, rating, feedback}
  steering_notes  TEXT           -- conversational direction notes
  created_at      TEXT NOT NULL
```

---

## Section 4: Brand Identity Generator

### Purpose

Synthesize the brandscript, ingested discovery materials, and calibrated voice into the full suite of branding deliverables a high-end agency would produce. Each deliverable is a first draft refined through the same conversational steering as Voice Calibration.

### Deliverables

**Core Identity:**
- Mission Statement — Why the business exists
- Vision Statement — Where they're headed
- Core Values — 3-5 values with descriptions, drawn from how the founder naturally talks about what matters
- Tagline / Positioning Statement — Multiple options ranked by brandscript alignment
- Elevator Pitches — 30s, 60s, 90s versions in the calibrated voice

**Brand Personality:**
- Brand Archetypes — Primary + secondary archetype with rationale
- Personality Traits — 5-7 traits with "this, not that" framing
- Brand Voice Guidelines — The calibrated voice profile packaged as a shareable document
- Tone of Voice Examples — Do's and don'ts with concrete copy samples per context

**Strategic Messaging:**
- Messaging Pillars — 3-4 core themes all copy should reinforce
- Key Differentiators — What sets them apart, framed as copy-ready statements
- Competitive Positioning Matrix — Where they sit vs. competitors on key dimensions
- Brand Story — Full narrative form of the brandscript, written in the calibrated voice

**Audience Intelligence:**
- Audience Personas — Enhanced from existing personas with brandscript context
- Customer Journey Map — Awareness → Consideration → Decision with recommended messaging at each stage
- Objection Handling — Common objections with on-brand responses
- Emotional Triggers — What motivates action for each persona

### Generation workflow

1. **Generate** — Select which deliverables to generate (all or specific ones). AI draws from brandscript + voice profile + ingested materials. Each deliverable generated independently.
2. **Refine** — Conversational steering. Highlight a values statement and say "this feels too generic, make it more specific to their dental practice." Iterate until right.
3. **Approve** — Mark each deliverable as approved. Approved deliverables become part of the brand context — mission, messaging pillars, and differentiators feed into all downstream AI generation.
4. **Export** — Package approved deliverables into a client-ready brand guide. Export formats: PDF (client presentation) and Markdown (internal reference). Uses the existing content post export patterns. Visual design of the PDF export is out of scope for Phase 1 — initial export is clean formatted text, not a designed document.

### Conversational steering UI

The same interaction pattern is used in Voice Calibration and Brand Identity refinement:
- A chat-style interface alongside the generated content
- User can highlight specific text in the generated output and attach direction to it
- AI responds with a revised version, showing what changed
- Each revision is versioned — you can go back to any previous version
- This is the same component in both contexts, parameterized by what it's refining (voice test copy vs. identity deliverable)
- Implementation note: extends the existing `PageRewriteChat.tsx` pattern — a chat panel alongside editable content

### Service tier gating

Not every client package includes every deliverable. Configurable tiers:

- **Essentials** — Mission, Vision, Values, Tagline, Voice Guidelines
- **Professional** — Everything in Essentials + Brand Personality, Messaging Pillars, Elevator Pitches, Differentiators
- **Premium** — Full suite including Competitive Positioning, Brand Story, Customer Journey, Objection Handling

Tier names and groupings are configurable per workspace.

### Downstream integration (Phases 2 & 3)

Every approved deliverable enriches the AI context for future content generation:
- Messaging Pillars → Page section recommendations (Phase 2)
- Key Differentiators → Content briefs + SEO copy (existing features)
- Customer Journey → CTA strategy per page (Phase 2)
- Objection Handling → FAQ sections + trust copy (Phase 3)
- Brand Story → About page copy generation (Phase 3)

### Data model

```
brand_identity_deliverables
  id              TEXT PRIMARY KEY
  workspace_id    TEXT NOT NULL (FK → workspaces)
  deliverable_type TEXT NOT NULL  -- 'mission' | 'vision' | 'values' | 'tagline' | 'elevator_pitch' | etc.
  content         TEXT NOT NULL   -- rich text content (or JSON for structured types like values, archetypes)
  status          TEXT NOT NULL DEFAULT 'draft'  -- 'draft' | 'approved'
  version         INTEGER NOT NULL DEFAULT 1
  tier            TEXT NOT NULL DEFAULT 'essentials'  -- which service tier this belongs to
  created_at      TEXT NOT NULL
  updated_at      TEXT NOT NULL

brand_identity_versions
  id              TEXT PRIMARY KEY
  deliverable_id  TEXT NOT NULL (FK → brand_identity_deliverables)
  content         TEXT NOT NULL
  steering_notes  TEXT           -- refinement direction that produced this version
  version         INTEGER NOT NULL
  created_at      TEXT NOT NULL
```

---

## AI Model Strategy

- **Discovery extraction + brandscript drafting:** Claude Sonnet 4 — needs strong comprehension of messy transcripts and narrative structure
- **Voice calibration + identity generation:** Claude Sonnet 4 — creative prose quality is critical for voice matching
- **Structured tasks** (parsing imports, formatting exports): GPT-4.1-mini — cost-efficient for non-creative work
- **Fallback:** GPT-4.1 when Anthropic key unavailable (existing fallback pattern)

Temperature settings:
- Extraction: 0.3 (accuracy over creativity)
- Voice calibration variations: 0.8 (diversity in options)
- Identity deliverable drafts: 0.7 (creative but controlled)
- Import parsing: 0 (deterministic)

---

## Integration Points with Existing Features

All existing AI-powered features receive the enriched brand context:

| Feature | Current context | New context additions |
|---------|----------------|----------------------|
| Content Briefs | Knowledge base + personas | + Brandscript narrative + voice DNA + messaging pillars |
| Full Post Generation | Brand voice text + knowledge base | + Voice samples + guardrails + context modifiers |
| SEO Title/Description | Brand voice text | + Voice samples (tagged 'seo') + guardrails + key differentiators |
| Page Rewrite Chat | Brand voice + strategy | + Full voice profile + brandscript + messaging pillars |
| CMS Editor variations | Brand voice text | + Voice samples + guardrails |
| AEO Review | Brand voice text | + Messaging pillars + brand story elements |
| Content Decay refresh | Brand voice text | + Full voice profile for consistent refresh copy |

The enriched context is built by extending `seo-context.ts` with new builder functions: `buildBrandscriptContext()`, `buildVoiceProfileContext()`, `buildIdentityContext()`.

---

## UI Location

All new features live within the existing **Brand Hub** tab, reorganized into sub-sections:

1. **Brandscript** (new) — framework builder, import, AI-assist
2. **Discovery** (new) — transcript/doc upload, extraction review
3. **Voice** (new) — samples, voice DNA, guardrails, calibration loop
4. **Identity** (new) — deliverable generation, refinement, export
5. **Knowledge Base** (existing) — business facts
6. **Personas** (existing) — audience personas
7. **Brand Docs** (existing) — uploaded files

---

## What This Does NOT Cover

- **Page strategy / site blueprint** — Phase 2 (what pages to build, what sections go on each page)
- **Full page copy generation** — Phase 3 (section-by-section draft copy for every page)
- **Design handoff / wireframe integration** — Phase 2-3
- **Logo or visual identity** — handled outside the platform
- **Client portal for brand review** — can be added later; initial version is admin-only with export for client sharing

---

## Addendum: Forward-Compatibility Requirements (Added 2026-03-27)

> These requirements were identified during the holistic cross-phase review. They ensure Phase 1 components are ready for Phase 2 and Phase 3 integration without retrofitting.

### 1. SteeringChat Must Include Auto-Summarization

The `SteeringChat` component (used by Voice Calibration in Phase 1, then reused by Brand Identity and Copy Pipeline in Phase 3) must include conversation auto-summarization from day one.

**Why this matters:** Phase 3 copy review will produce 10+ rounds of steering per section across dozens of pages. Without summarization, the context window fills with stale notes and the AI loses focus on the latest direction. The existing `rewrite-chat.ts` already implements this pattern — after 6+ messages, prior messages are summarized into a condensed context block.

**Implementation requirements:**
- After 6 steering exchanges within a single calibration/refinement session, auto-summarize prior exchanges into a condensed block
- The summary preserves: key directions given, what was rejected, what was approved, and the current trajectory
- Recent exchanges (last 3) remain in full — only older ones get summarized
- Summarization uses GPT-4.1-mini (cheap, structured task)
- Store the summary on the session record (`voice_calibration_sessions.steering_notes` or equivalent)

**Anti-pattern to avoid:** Do NOT just truncate old messages. Summarize them. Truncation loses critical context like "we already tried a formal tone and the user hated it."

**Reference implementation:** `server/routes/rewrite-chat.ts` — look for the `summarizeConversation` pattern.

### 2. Voice Sample Source Enum Must Support Future Sources

The `voice_samples.source` field currently accepts: `manual`, `transcript_extraction`, `calibration_loop`.

**Add to the type definition (not the migration — it's a TEXT field):**
- `copy_approved` — for Phase 3, when approved copy sections are saved back as voice samples
- `identity_approved` — for Phase 1 itself, when approved brand identity deliverables (taglines, elevator pitches) are saved as samples

**Why this matters:** Phase 3's most powerful learning mechanism is routing approved copy back as voice samples. If the type enum doesn't include `copy_approved`, the implementer will either skip the feature or invent an inconsistent value.

**In `shared/types/brand-engine.ts`:**
```typescript
export type VoiceSampleSource =
  | 'manual'
  | 'transcript_extraction'
  | 'calibration_loop'
  | 'copy_approved'        // Phase 3: approved copy sections become samples
  | 'identity_approved';   // Phase 1: approved taglines/pitches become samples
```

**Use this type everywhere** — never use raw strings for source values.

### 3. SEO Context Builders Must Support Emphasis Parameters

The new builder functions added to `seo-context.ts` (`buildBrandscriptContext()`, `buildVoiceProfileContext()`, `buildIdentityContext()`) must accept an optional `emphasis` parameter that controls output verbosity.

**Why this matters:** Phase 3 uses smart context selection — a homepage generation emphasizes brand identity and messaging pillars, while a location page emphasizes local keywords and NAP data. Without emphasis control, every generation gets the same massive context payload, diluting the AI's attention.

**Interface:**
```typescript
type ContextEmphasis = 'full' | 'summary' | 'minimal';

function buildBrandscriptContext(
  workspaceId: string,
  emphasis?: ContextEmphasis  // defaults to 'full'
): string;

function buildVoiceProfileContext(
  workspaceId: string,
  emphasis?: ContextEmphasis
): string;

function buildIdentityContext(
  workspaceId: string,
  emphasis?: ContextEmphasis
): string;
```

**Behavior:**
- `full` — include everything (all sections, all samples, all deliverables). Default for Phase 1 usage.
- `summary` — include key items only (first 2 voice samples, top 3 messaging pillars, mission statement only). For pages where this context is secondary.
- `minimal` — one-paragraph summary of the brand. For pages where this context is background only.

**Critical rule:** Always default to `full` if no emphasis is provided. Phase 1 callers should not need to change. This is a non-breaking extension.

### 4. Voice Calibration Sessions Must Track Prompt Metadata

The `voice_calibration_sessions` table stores `prompt_type` (e.g., `hero_headline`, `about_intro`). Phase 3 will query this data to find the best voice samples per section type.

**Ensure these prompt_type values align with Phase 2's SectionType enum:**
```
hero_headline    → hero
about_intro      → about-team
service_body     → features-benefits
cta_copy         → cta
faq_answer       → faq
testimonial_copy → testimonials
```

**Implementation requirement:** Create a mapping constant that the Phase 1 implementer uses:
```typescript
export const PROMPT_TYPE_TO_SECTION_TYPE: Record<string, string> = {
  'hero_headline': 'hero',
  'about_intro': 'about-team',
  'service_body': 'features-benefits',
  'cta_copy': 'cta',
  'faq_answer': 'faq',
  'testimonial_copy': 'testimonials',
  'blog_intro': 'content-body',
  'meta_description': 'seo-meta',
};
```

This lets Phase 3 query: "give me the best-rated calibration output for `hero` sections" and use it as additional voice context.

### 5. Brand Identity Deliverables Should Auto-Create Voice Samples

When a tagline, elevator pitch, or tone-of-voice example is approved in the Brand Identity Generator, it should automatically be saved as a voice sample with `source: 'identity_approved'` and the appropriate `context_tag`.

**Mapping:**
- Approved tagline → voice sample with `context_tag: 'headline'`
- Approved elevator pitch → voice sample with `context_tag: 'body'`
- Approved tone example (from Brand Voice Guidelines deliverable) → voice sample with matching `context_tag`

**Why this matters:** These are high-quality, client-approved examples of the brand voice. Not using them as voice samples wastes the best training data the system produces.

**Implementation:** Add a post-approval hook in `server/brand-identity.ts` that calls `addVoiceSample()` from `server/voice-calibration.ts`. Keep it simple — one function call after status changes to `approved`.

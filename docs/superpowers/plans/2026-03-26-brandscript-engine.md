# Brandscript Engine + Voice Calibration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a structured brandscript system, discovery ingestion from transcripts/docs/website crawl, voice calibration with conversational steering, and brand identity deliverable generation to the existing Brand Hub.

**Architecture:** Four new server-side modules (`brandscript.ts`, `discovery-ingestion.ts`, `voice-calibration.ts`, `brand-identity.ts`) with corresponding route files, a single new migration (`041-brandscript-engine.sql`), frontend API layer (`src/api/brand-engine.ts`), and four new Brand Hub sub-tab components. The existing `seo-context.ts` gets extended with three new builder functions. All AI calls go through the existing `callAnthropic` / `callOpenAI` helpers.

> **⚠️ AMENDMENTS:** A pattern alignment audit (2026-03-28) identified 9 corrections to the inline code blocks below. See the **Amendments** section at the bottom of this file. Implementers MUST apply those corrections — the inline code is the original draft, amendments override it.

**Tech Stack:** better-sqlite3, Express, React, Claude Sonnet 4 (creative), GPT-4.1-mini (structured), multer (file upload), existing `callAnthropic`/`callOpenAI` wrappers.

**Spec:** `docs/superpowers/specs/2026-03-26-brandscript-engine-design.md`

**Guardrails:** `docs/superpowers/plans/COPY_ENGINE_GUARDRAILS.md` — **READ BEFORE DISPATCHING AGENTS.** Contains file ownership maps, task dependency graphs, cross-phase contracts, and missing spec addendum items that must be implemented.

**Coordination rules:** `.windsurf/rules/multi-agent-coordination.md`

> **🔧 NEED TO ADD:** The client-facing `BrandTab` accepts optional `brandVoiceSummary` and `industry` props (`src/components/client/BrandTab.tsx:19-22`), but `ClientDashboard.tsx` does not pass them because neither field is on the `WorkspaceInfo` client type or in the public workspace serialization list (`public-portal.ts:27-77`). The Brand Positioning panel always shows EmptyState even when server-side data exists. Wiring requires: (1) add `brandVoiceSummary` + `industry` to the public workspace response in `public-portal.ts`, (2) add both fields to `WorkspaceInfo` in `src/components/client/types.ts`, (3) pass them through `ClientDashboard.tsx` → `BrandTab`. *(Flagged 2026-04-07 during PR #149 review.)*

---

## Task Dependencies

```
Sequential foundation:
  Task 1 (Migration 026) → Task 2 (Shared Types)

Parallel services (after Task 2):
  Task 3 (Brandscript Service) ∥ Task 4 (Discovery Ingestion) ∥ Task 5 (Voice Calibration) ∥ Task 6 (Brand Identity)

▶ CHECKPOINT: Invoke `scaled-code-review` on Tasks 3-6 output. Fix Critical/Important before proceeding.

Sequential shared-file tasks (after review):
  Task 7 (SEO Context Builders) — modifies server/seo-context.ts
  Task 8 (App.ts Route Registration) — modifies server/app.ts
  Task 9 (Brand Engine API Client) — creates src/api/brand-engine.ts

Parallel frontend (after Task 9):
  Task 10 (BrandscriptTab) ∥ Task 11 (DiscoveryTab) ∥ Task 12 (VoiceTab) ∥ Task 13 (IdentityTab)

▶ CHECKPOINT: Invoke `scaled-code-review` on Tasks 10-13 output. Fix Critical/Important before proceeding.

Sequential shared frontend (after review):
  Task 14 (SteeringChat — shared component)
  Task 15 (BrandHub.tsx integration)
```

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `server/db/migrations/026-brandscript-engine.sql` | All new tables: brandscripts, brandscript_sections, brandscript_templates, discovery_sources, discovery_extractions, voice_profiles, voice_samples, voice_calibration_sessions, brand_identity_deliverables, brand_identity_versions |
| `server/brandscript.ts` | Brandscript CRUD, import parsing, AI-assisted completion, template management |
| `server/discovery-ingestion.ts` | Source upload processing, AI extraction, review workflow, confidence scoring |
| `server/voice-calibration.ts` | Voice profile CRUD, calibration loop (generate/rate/steer), voice sample management |
| `server/brand-identity.ts` | Deliverable generation, versioning, refinement, tier gating, markdown export |
| `server/routes/brandscript.ts` | API routes for brandscript CRUD + import + AI-assist |
| `server/routes/discovery-ingestion.ts` | API routes for source upload, extraction review, routing |
| `server/routes/voice-calibration.ts` | API routes for voice profile, samples, calibration sessions |
| `server/routes/brand-identity.ts` | API routes for deliverable generation, refinement, export |
| `src/api/brand-engine.ts` | Frontend API client for all four systems |
| `src/components/brand/BrandscriptTab.tsx` | Brandscript builder UI with framework selection, section editor, import, AI-assist |
| `src/components/brand/DiscoveryTab.tsx` | Transcript/doc upload UI, extraction review cards with accept/edit/dismiss |
| `src/components/brand/VoiceTab.tsx` | Voice samples, DNA editor, guardrails, calibration loop UI |
| `src/components/brand/IdentityTab.tsx` | Deliverable cards with generate/refine/approve/export workflow |
| `src/components/brand/SteeringChat.tsx` | Reusable conversational steering component (used by Voice + Identity) |
| `shared/types/brand-engine.ts` | Shared TypeScript types for all four systems |

### Modified files

| File | Changes |
|------|---------|
| `server/app.ts` | Import and register 4 new route files |
| `server/seo-context.ts` | Add `buildBrandscriptContext()`, `buildVoiceProfileContext()`, `buildIdentityContext()`, extend `buildSeoContext()` to include them in `fullContext` |
| `src/components/BrandHub.tsx` | Add sub-tab navigation for Brandscript, Discovery, Voice, Identity alongside existing sections |

---

## Task 1: Database Migration

**Files:**
- Create: `server/db/migrations/026-brandscript-engine.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 026-brandscript-engine.sql
-- Brandscript Engine + Voice Calibration tables

-- ═══ BRANDSCRIPT BUILDER ═══

CREATE TABLE IF NOT EXISTS brandscript_templates (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  sections_json TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brandscripts (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  name            TEXT NOT NULL,
  framework_type  TEXT NOT NULL DEFAULT 'storybrand',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_brandscripts_workspace ON brandscripts(workspace_id);

CREATE TABLE IF NOT EXISTS brandscript_sections (
  id              TEXT PRIMARY KEY,
  brandscript_id  TEXT NOT NULL REFERENCES brandscripts(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  purpose         TEXT,
  content         TEXT,
  sort_order      INTEGER NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_brandscript_sections_brandscript ON brandscript_sections(brandscript_id);

-- ═══ DISCOVERY INGESTION ═══

CREATE TABLE IF NOT EXISTS discovery_sources (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  filename      TEXT NOT NULL,
  source_type   TEXT NOT NULL,
  raw_content   TEXT NOT NULL,
  processed_at  TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discovery_sources_workspace ON discovery_sources(workspace_id);

CREATE TABLE IF NOT EXISTS discovery_extractions (
  id              TEXT PRIMARY KEY,
  source_id       TEXT NOT NULL REFERENCES discovery_sources(id) ON DELETE CASCADE,
  workspace_id    TEXT NOT NULL,
  extraction_type TEXT NOT NULL,
  category        TEXT NOT NULL,
  content         TEXT NOT NULL,
  source_quote    TEXT,
  confidence      TEXT NOT NULL DEFAULT 'medium',
  status          TEXT NOT NULL DEFAULT 'pending',
  routed_to       TEXT,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discovery_extractions_workspace ON discovery_extractions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_discovery_extractions_source ON discovery_extractions(source_id);

-- ═══ VOICE CALIBRATION ═══

CREATE TABLE IF NOT EXISTS voice_profiles (
  id                      TEXT PRIMARY KEY,
  workspace_id            TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'draft',
  voice_dna_json          TEXT,
  guardrails_json         TEXT,
  context_modifiers_json  TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_voice_profiles_workspace ON voice_profiles(workspace_id);

CREATE TABLE IF NOT EXISTS voice_samples (
  id                TEXT PRIMARY KEY,
  voice_profile_id  TEXT NOT NULL REFERENCES voice_profiles(id) ON DELETE CASCADE,
  content           TEXT NOT NULL,
  context_tag       TEXT,
  source            TEXT,
  sort_order        INTEGER,
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_voice_samples_profile ON voice_samples(voice_profile_id);

CREATE TABLE IF NOT EXISTS voice_calibration_sessions (
  id                TEXT PRIMARY KEY,
  voice_profile_id  TEXT NOT NULL REFERENCES voice_profiles(id) ON DELETE CASCADE,
  prompt_type       TEXT NOT NULL,
  variations_json   TEXT NOT NULL,
  steering_notes    TEXT,
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_voice_calibration_profile ON voice_calibration_sessions(voice_profile_id);

-- ═══ BRAND IDENTITY ═══

CREATE TABLE IF NOT EXISTS brand_identity_deliverables (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL,
  deliverable_type  TEXT NOT NULL,
  content           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'draft',
  version           INTEGER NOT NULL DEFAULT 1,
  tier              TEXT NOT NULL DEFAULT 'essentials',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_brand_identity_workspace ON brand_identity_deliverables(workspace_id);

CREATE TABLE IF NOT EXISTS brand_identity_versions (
  id              TEXT PRIMARY KEY,
  deliverable_id  TEXT NOT NULL REFERENCES brand_identity_deliverables(id) ON DELETE CASCADE,
  content         TEXT NOT NULL,
  steering_notes  TEXT,
  version         INTEGER NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_brand_identity_versions_deliverable ON brand_identity_versions(deliverable_id);

-- ═══ SEED: Default StoryBrand template ═══

INSERT OR IGNORE INTO brandscript_templates (id, name, description, sections_json, created_at)
VALUES (
  'tmpl_storybrand',
  'StoryBrand BrandScript',
  'Donald Miller''s StoryBrand framework — Character, Problem, Guide, Plan, CTA, Stakes, Success',
  '[{"title":"Hook","purpose":"Set the stage — the opening that captures attention and frames the brand story"},{"title":"Character","purpose":"Who is the customer? What do they want? Their desires and aspirations"},{"title":"Problem","purpose":"External problem (tangible frustration), Internal problem (emotional struggle), Philosophical problem (bigger picture)"},{"title":"Guide","purpose":"Why is this brand the right choice? Empathy (we understand) + Authority (we can help)"},{"title":"Plan","purpose":"Simple steps the customer takes to engage — make it easy and clear"},{"title":"Call to Action","purpose":"Primary CTA (main action) + Secondary CTA (lower commitment alternative)"},{"title":"Failure","purpose":"What is at stake if they do not act? The negative consequences of inaction"},{"title":"Success","purpose":"What transformation do they experience? The positive outcome of choosing this brand"}]',
  '2026-03-26T00:00:00.000Z'
);
```

- [ ] **Step 2: Verify migration runs on server start**

Run: `cd /Users/joshuahampson/CascadeProjects/asset-dashboard && npx tsx server/db/index.ts`
Expected: No errors, tables created. Check with: `sqlite3 data/app.db ".tables"` — should include `brandscripts`, `discovery_sources`, `voice_profiles`, `brand_identity_deliverables`.

- [ ] **Step 3: Commit**

```bash
git add server/db/migrations/026-brandscript-engine.sql
git commit -m "feat(db): add brandscript engine tables — migration 026"
```

---

## Task 2: Shared Types

**Files:**
- Create: `shared/types/brand-engine.ts`

- [ ] **Step 1: Write the shared types**

```typescript
// shared/types/brand-engine.ts

// ═══ BRANDSCRIPT ═══

export interface BrandscriptTemplate {
  id: string;
  name: string;
  description?: string;
  sections: { title: string; purpose: string }[];
  createdAt: string;
}

export interface BrandscriptSection {
  id: string;
  brandscriptId: string;
  title: string;
  purpose?: string;
  content?: string;
  sortOrder: number;
  createdAt: string;
}

export interface Brandscript {
  id: string;
  workspaceId: string;
  name: string;
  frameworkType: string;
  sections: BrandscriptSection[];
  createdAt: string;
  updatedAt: string;
}

// ═══ DISCOVERY INGESTION ═══

export type SourceType = 'transcript' | 'brand_doc' | 'competitor' | 'existing_copy' | 'website_crawl';
export type ExtractionType = 'voice_pattern' | 'story_element';
export type ExtractionCategory =
  | 'signature_phrase' | 'vocabulary' | 'tone_marker' | 'metaphor' | 'sentence_pattern'
  | 'origin_story' | 'customer_problem' | 'solution_framing' | 'authority_marker'
  | 'empathy_signal' | 'success_story' | 'values_in_action';
export type Confidence = 'high' | 'medium' | 'low';
export type ExtractionStatus = 'pending' | 'accepted' | 'dismissed';
export type ExtractionDestination = 'voice_profile' | 'brandscript' | 'identity';

export interface DiscoverySource {
  id: string;
  workspaceId: string;
  filename: string;
  sourceType: SourceType;
  rawContent: string;
  processedAt?: string;
  createdAt: string;
}

export interface DiscoveryExtraction {
  id: string;
  sourceId: string;
  workspaceId: string;
  extractionType: ExtractionType;
  category: ExtractionCategory;
  content: string;
  sourceQuote?: string;
  confidence: Confidence;
  status: ExtractionStatus;
  routedTo?: ExtractionDestination;
  createdAt: string;
}

// ═══ VOICE CALIBRATION ═══

export type VoiceProfileStatus = 'draft' | 'calibrating' | 'calibrated';
export type VoiceSampleContext = 'headline' | 'body' | 'cta' | 'about' | 'service' | 'social' | 'seo';
// Phase 1 sources + forward-compatible values for Phase 1 identity approval and Phase 3 copy approval
export type VoiceSampleSource =
  | 'manual'
  | 'transcript_extraction'
  | 'calibration_loop'
  | 'identity_approved'    // Phase 1: approved taglines/pitches become samples
  | 'copy_approved';       // Phase 3: approved copy sections become samples

// ═══ CONTEXT EMPHASIS (for seo-context.ts builders) ═══
// Controls verbosity of brand context injected into AI prompts.
// Phase 1 callers default to 'full'. Phase 3 uses 'summary'/'minimal' for smart context selection.
export type ContextEmphasis = 'full' | 'summary' | 'minimal';

// ═══ PROMPT TYPE → SECTION TYPE MAPPING ═══
// Maps Phase 1 calibration prompt types to Phase 2 section types.
// Phase 3 uses this to find the best-rated calibration output per section type.
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

export interface ToneSpectrum {
  formal_casual: number;       // 1-10 scale, 10 = most casual
  serious_playful: number;
  technical_accessible: number;
}

export interface VoiceDNA {
  personalityTraits: string[];   // e.g., "Witty but never sarcastic"
  toneSpectrum: ToneSpectrum;
  sentenceStyle: string;         // e.g., "Short punchy lines with occasional longer payoff"
  vocabularyLevel: string;       // e.g., "Conversational, 8th grade reading level"
  humorStyle: string;            // e.g., "Self-deprecating, observational"
}

export interface VoiceGuardrails {
  forbiddenWords: string[];
  requiredTerminology: { use: string; insteadOf: string }[];
  toneBoundaries: string[];
  antiPatterns: string[];
}

export interface ContextModifier {
  context: string;       // e.g., "Headlines & CTAs"
  description: string;   // e.g., "Maximum personality. Punchy. Humor welcome."
}

export interface VoiceProfile {
  id: string;
  workspaceId: string;
  status: VoiceProfileStatus;
  voiceDNA?: VoiceDNA;
  guardrails?: VoiceGuardrails;
  contextModifiers?: ContextModifier[];
  createdAt: string;
  updatedAt: string;
}

export interface VoiceSample {
  id: string;
  voiceProfileId: string;
  content: string;
  contextTag?: VoiceSampleContext;
  source?: VoiceSampleSource;
  sortOrder?: number;
  createdAt: string;
}

export type CalibrationRating = 'on_brand' | 'close' | 'wrong';

export interface CalibrationVariation {
  text: string;
  rating?: CalibrationRating;
  feedback?: string;
}

export interface CalibrationSession {
  id: string;
  voiceProfileId: string;
  promptType: string;
  variations: CalibrationVariation[];
  steeringNotes?: string;
  createdAt: string;
}

// ═══ BRAND IDENTITY ═══

export type DeliverableType =
  | 'mission' | 'vision' | 'values' | 'tagline' | 'elevator_pitch'
  | 'archetypes' | 'personality_traits' | 'voice_guidelines' | 'tone_examples'
  | 'messaging_pillars' | 'differentiators' | 'positioning_matrix' | 'brand_story'
  | 'personas' | 'customer_journey' | 'objection_handling' | 'emotional_triggers';

export type DeliverableTier = 'essentials' | 'professional' | 'premium';
export type DeliverableStatus = 'draft' | 'approved';

export interface BrandDeliverable {
  id: string;
  workspaceId: string;
  deliverableType: DeliverableType;
  content: string;
  status: DeliverableStatus;
  version: number;
  tier: DeliverableTier;
  createdAt: string;
  updatedAt: string;
}

export interface DeliverableVersion {
  id: string;
  deliverableId: string;
  content: string;
  steeringNotes?: string;
  version: number;
  createdAt: string;
}

// ═══ DELIVERABLE TIER CONFIG ═══

export const DEFAULT_TIER_MAP: Record<DeliverableType, DeliverableTier> = {
  mission: 'essentials',
  vision: 'essentials',
  values: 'essentials',
  tagline: 'essentials',
  voice_guidelines: 'essentials',
  elevator_pitch: 'professional',
  archetypes: 'professional',
  personality_traits: 'professional',
  messaging_pillars: 'professional',
  differentiators: 'professional',
  tone_examples: 'professional',
  positioning_matrix: 'premium',
  brand_story: 'premium',
  personas: 'premium',
  customer_journey: 'premium',
  objection_handling: 'premium',
  emotional_triggers: 'premium',
};
```

- [ ] **Step 2: Commit**

```bash
git add shared/types/brand-engine.ts
git commit -m "feat: add shared TypeScript types for brandscript engine"
```

---

## Task 3: Brandscript Service (Backend CRUD + AI)

**Files:**
- Create: `server/brandscript.ts`
- Create: `server/routes/brandscript.ts`
- Modify: `server/app.ts` (add route import + registration)

- [ ] **Step 1: Write the brandscript service**

```typescript
// server/brandscript.ts
import db from './db/index.js';
import { callAnthropic, isAnthropicConfigured } from './anthropic-helpers.js';
import { callOpenAI } from './openai-helpers.js';
import { buildSeoContext } from './seo-context.js';
import type { Brandscript, BrandscriptSection, BrandscriptTemplate } from '../shared/types/brand-engine.js';

// ── Row types
interface BrandscriptRow {
  id: string; workspace_id: string; name: string; framework_type: string;
  created_at: string; updated_at: string;
}
interface SectionRow {
  id: string; brandscript_id: string; title: string; purpose: string | null;
  content: string | null; sort_order: number; created_at: string;
}
interface TemplateRow {
  id: string; name: string; description: string | null;
  sections_json: string; created_at: string;
}

// ── Prepared statements (lazy)
interface Stmts {
  listByWorkspace: ReturnType<typeof db.prepare>;
  getById: ReturnType<typeof db.prepare>;
  insert: ReturnType<typeof db.prepare>;
  update: ReturnType<typeof db.prepare>;
  deleteById: ReturnType<typeof db.prepare>;
  listSections: ReturnType<typeof db.prepare>;
  insertSection: ReturnType<typeof db.prepare>;
  updateSection: ReturnType<typeof db.prepare>;
  deleteSection: ReturnType<typeof db.prepare>;
  deleteSectionsByBrandscript: ReturnType<typeof db.prepare>;
  listTemplates: ReturnType<typeof db.prepare>;
  getTemplate: ReturnType<typeof db.prepare>;
  insertTemplate: ReturnType<typeof db.prepare>;
}

let _s: Stmts | null = null;
function s(): Stmts {
  if (!_s) {
    _s = {
      listByWorkspace: db.prepare(`SELECT * FROM brandscripts WHERE workspace_id = ? ORDER BY updated_at DESC`),
      getById: db.prepare(`SELECT * FROM brandscripts WHERE id = ? AND workspace_id = ?`),
      insert: db.prepare(`INSERT INTO brandscripts (id, workspace_id, name, framework_type, created_at, updated_at) VALUES (@id, @workspace_id, @name, @framework_type, @created_at, @updated_at)`),
      update: db.prepare(`UPDATE brandscripts SET name = @name, framework_type = @framework_type, updated_at = @updated_at WHERE id = @id AND workspace_id = @workspace_id`),
      deleteById: db.prepare(`DELETE FROM brandscripts WHERE id = ? AND workspace_id = ?`),
      listSections: db.prepare(`SELECT * FROM brandscript_sections WHERE brandscript_id = ? ORDER BY sort_order`),
      insertSection: db.prepare(`INSERT INTO brandscript_sections (id, brandscript_id, title, purpose, content, sort_order, created_at) VALUES (@id, @brandscript_id, @title, @purpose, @content, @sort_order, @created_at)`),
      updateSection: db.prepare(`UPDATE brandscript_sections SET title = @title, purpose = @purpose, content = @content, sort_order = @sort_order WHERE id = @id`),
      deleteSection: db.prepare(`DELETE FROM brandscript_sections WHERE id = ?`),
      deleteSectionsByBrandscript: db.prepare(`DELETE FROM brandscript_sections WHERE brandscript_id = ?`),
      listTemplates: db.prepare(`SELECT * FROM brandscript_templates ORDER BY name`),
      getTemplate: db.prepare(`SELECT * FROM brandscript_templates WHERE id = ?`),
      insertTemplate: db.prepare(`INSERT INTO brandscript_templates (id, name, description, sections_json, created_at) VALUES (@id, @name, @description, @sections_json, @created_at)`),
    };
  }
  return _s;
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ── Row converters
function rowToBrandscript(row: BrandscriptRow): Omit<Brandscript, 'sections'> {
  return {
    id: row.id, workspaceId: row.workspace_id, name: row.name,
    frameworkType: row.framework_type, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function rowToSection(row: SectionRow): BrandscriptSection {
  return {
    id: row.id, brandscriptId: row.brandscript_id, title: row.title,
    purpose: row.purpose ?? undefined, content: row.content ?? undefined,
    sortOrder: row.sort_order, createdAt: row.created_at,
  };
}

function rowToTemplate(row: TemplateRow): BrandscriptTemplate {
  return {
    id: row.id, name: row.name, description: row.description ?? undefined,
    sections: JSON.parse(row.sections_json), createdAt: row.created_at,
  };
}

// ── Public API

export function listBrandscripts(workspaceId: string): Brandscript[] {
  const rows = s().listByWorkspace.all(workspaceId) as BrandscriptRow[];
  return rows.map(row => {
    const base = rowToBrandscript(row);
    const sectionRows = s().listSections.all(row.id) as SectionRow[];
    return { ...base, sections: sectionRows.map(rowToSection) };
  });
}

export function getBrandscript(workspaceId: string, id: string): Brandscript | null {
  const row = s().getById.get(id, workspaceId) as BrandscriptRow | undefined;
  if (!row) return null;
  const base = rowToBrandscript(row);
  const sectionRows = s().listSections.all(row.id) as SectionRow[];
  return { ...base, sections: sectionRows.map(rowToSection) };
}

export function createBrandscript(
  workspaceId: string,
  name: string,
  frameworkType: string,
  sections: { title: string; purpose?: string; content?: string }[],
): Brandscript {
  const now = new Date().toISOString();
  const id = genId('bs');
  s().insert.run({ id, workspace_id: workspaceId, name, framework_type: frameworkType, created_at: now, updated_at: now });

  const sectionObjs: BrandscriptSection[] = sections.map((sec, i) => {
    const secId = genId('bss');
    s().insertSection.run({
      id: secId, brandscript_id: id, title: sec.title,
      purpose: sec.purpose ?? null, content: sec.content ?? null,
      sort_order: i, created_at: now,
    });
    return { id: secId, brandscriptId: id, title: sec.title, purpose: sec.purpose, content: sec.content, sortOrder: i, createdAt: now };
  });

  return { id, workspaceId, name, frameworkType, sections: sectionObjs, createdAt: now, updatedAt: now };
}

export function updateBrandscriptSections(
  workspaceId: string,
  brandscriptId: string,
  sections: { id?: string; title: string; purpose?: string; content?: string }[],
): Brandscript | null {
  const existing = getBrandscript(workspaceId, brandscriptId);
  if (!existing) return null;

  const now = new Date().toISOString();

  // Delete all existing sections and re-insert (simpler than diffing)
  s().deleteSectionsByBrandscript.run(brandscriptId);

  const sectionObjs: BrandscriptSection[] = sections.map((sec, i) => {
    const secId = sec.id || genId('bss');
    s().insertSection.run({
      id: secId, brandscript_id: brandscriptId, title: sec.title,
      purpose: sec.purpose ?? null, content: sec.content ?? null,
      sort_order: i, created_at: now,
    });
    return { id: secId, brandscriptId, title: sec.title, purpose: sec.purpose, content: sec.content, sortOrder: i, createdAt: now };
  });

  s().update.run({ id: brandscriptId, workspace_id: workspaceId, name: existing.name, framework_type: existing.frameworkType, updated_at: now });

  return { ...existing, sections: sectionObjs, updatedAt: now };
}

export function deleteBrandscript(workspaceId: string, id: string): boolean {
  const result = s().deleteById.run(id, workspaceId);
  return result.changes > 0;
}

export function listTemplates(): BrandscriptTemplate[] {
  return (s().listTemplates.all() as TemplateRow[]).map(rowToTemplate);
}

export function createTemplate(name: string, description: string, sections: { title: string; purpose: string }[]): BrandscriptTemplate {
  const id = genId('tmpl');
  const now = new Date().toISOString();
  s().insertTemplate.run({ id, name, description, sections_json: JSON.stringify(sections), created_at: now });
  return { id, name, description, sections, createdAt: now };
}

// ── AI: Import brandscript from markdown text
export async function importBrandscript(
  workspaceId: string,
  name: string,
  rawText: string,
): Promise<Brandscript> {
  const prompt = `You are a brand strategist. Parse the following brand document into structured sections.

For each section you identify, return:
- title: The section name (e.g., "Hook", "Character", "Problem", "Guide", "Plan", "Call to Action", "Failure", "Success")
- purpose: A one-sentence description of what this section captures
- content: The full text content of that section

If this follows the StoryBrand framework, use those section names. If it follows a different framework, use whatever section names fit the content.

Return valid JSON: { "frameworkType": "storybrand" | "custom", "sections": [{ "title": "...", "purpose": "...", "content": "..." }] }

DOCUMENT TO PARSE:
${rawText}`;

  const result = await callOpenAI({
    model: 'gpt-4.1-mini',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 4000,
    temperature: 0,
    feature: 'brandscript-import',
    workspaceId,
  });

  const cleaned = (result.text || '{}').replace(/^```json?\s*/i, '').replace(/```\s*$/, '');
  const parsed = JSON.parse(cleaned) as { frameworkType: string; sections: { title: string; purpose: string; content: string }[] };

  return createBrandscript(workspaceId, name, parsed.frameworkType || 'custom', parsed.sections || []);
}

// ── AI: Complete missing brandscript sections
export async function completeBrandscript(
  workspaceId: string,
  brandscriptId: string,
): Promise<Brandscript | null> {
  const bs = getBrandscript(workspaceId, brandscriptId);
  if (!bs) return null;

  const { fullContext } = buildSeoContext(workspaceId);
  const filledSections = bs.sections.filter(sec => sec.content?.trim());
  const emptySections = bs.sections.filter(sec => !sec.content?.trim());

  if (emptySections.length === 0) return bs;

  const filledContext = filledSections.map(sec => `## ${sec.title}\n${sec.purpose ? `Purpose: ${sec.purpose}\n` : ''}${sec.content}`).join('\n\n');

  const prompt = `You are a brand strategist completing a brandscript. Some sections are already filled in. Draft the remaining empty sections to be consistent with the filled sections and the business context.

EXISTING SECTIONS:
${filledContext}

BUSINESS CONTEXT:
${fullContext}

SECTIONS TO COMPLETE:
${emptySections.map(sec => `- "${sec.title}" (purpose: ${sec.purpose || 'not specified'})`).join('\n')}

Return valid JSON: { "sections": [{ "title": "exact title from above", "content": "your draft content" }] }
Write in a natural, compelling voice that matches the tone of the existing sections. Be specific to this business, not generic.`;

  const aiCall = isAnthropicConfigured() ? callAnthropic : callOpenAI;
  const result = await aiCall({
    model: isAnthropicConfigured() ? 'claude-sonnet-4-20250514' : 'gpt-4.1',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 4000,
    temperature: 0.7,
    feature: 'brandscript-complete',
    workspaceId,
  });

  const cleaned = (result.text || '{}').replace(/^```json?\s*/i, '').replace(/```\s*$/, '');
  const parsed = JSON.parse(cleaned) as { sections: { title: string; content: string }[] };

  // Merge AI-drafted content into empty sections
  const updatedSections = bs.sections.map(sec => {
    if (sec.content?.trim()) return sec;
    const drafted = parsed.sections.find(d => d.title === sec.title);
    return { ...sec, content: drafted?.content || sec.content };
  });

  return updateBrandscriptSections(workspaceId, brandscriptId, updatedSections);
}
```

- [ ] **Step 2: Write the routes file**

```typescript
// server/routes/brandscript.ts
import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import {
  listBrandscripts, getBrandscript, createBrandscript,
  updateBrandscriptSections, deleteBrandscript,
  listTemplates, createTemplate,
  importBrandscript, completeBrandscript,
} from '../brandscript.js';

const router = Router();

// Templates
router.get('/api/brandscript-templates', (_req, res) => {
  res.json(listTemplates());
});

router.post('/api/brandscript-templates', (req, res) => {
  const { name, description, sections } = req.body;
  if (!name || !sections?.length) return res.status(400).json({ error: 'name and sections required' });
  res.json(createTemplate(name, description || '', sections));
});

// CRUD
router.get('/api/brandscripts/:wsId', requireWorkspaceAccess('wsId'), (req, res) => {
  res.json(listBrandscripts(req.params.wsId));
});

router.get('/api/brandscripts/:wsId/:id', requireWorkspaceAccess('wsId'), (req, res) => {
  const bs = getBrandscript(req.params.wsId, req.params.id);
  if (!bs) return res.status(404).json({ error: 'Not found' });
  res.json(bs);
});

router.post('/api/brandscripts/:wsId', requireWorkspaceAccess('wsId'), (req, res) => {
  const { name, frameworkType, sections } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  res.json(createBrandscript(req.params.wsId, name, frameworkType || 'storybrand', sections || []));
});

router.put('/api/brandscripts/:wsId/:id/sections', requireWorkspaceAccess('wsId'), (req, res) => {
  const { sections } = req.body;
  if (!sections) return res.status(400).json({ error: 'sections required' });
  const result = updateBrandscriptSections(req.params.wsId, req.params.id, sections);
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json(result);
});

router.delete('/api/brandscripts/:wsId/:id', requireWorkspaceAccess('wsId'), (req, res) => {
  const ok = deleteBrandscript(req.params.wsId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

// AI: Import from text
router.post('/api/brandscripts/:wsId/import', requireWorkspaceAccess('wsId'), async (req, res) => {
  const { name, rawText } = req.body;
  if (!rawText) return res.status(400).json({ error: 'rawText required' });
  try {
    const bs = await importBrandscript(req.params.wsId, name || 'Imported Brandscript', rawText);
    res.json(bs);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Import failed' });
  }
});

// AI: Complete empty sections
router.post('/api/brandscripts/:wsId/:id/complete', requireWorkspaceAccess('wsId'), async (req, res) => {
  try {
    const bs = await completeBrandscript(req.params.wsId, req.params.id);
    if (!bs) return res.status(404).json({ error: 'Not found' });
    res.json(bs);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Completion failed' });
  }
});

export default router;
```

- [ ] **Step 3: Register routes in app.ts**

Add to the imports section of `server/app.ts`:
```typescript
import brandscriptRoutes from './routes/brandscript.js';
```

Add to the `app.use(...)` section:
```typescript
app.use(brandscriptRoutes);
```

- [ ] **Step 4: Verify server starts without errors**

Run: `cd /Users/joshuahampson/CascadeProjects/asset-dashboard && npm run build`
Expected: No TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add server/brandscript.ts server/routes/brandscript.ts server/app.ts
git commit -m "feat: add brandscript service — CRUD, import, AI completion"
```

---

## Task 4: Discovery Ingestion Service (Backend)

**Files:**
- Create: `server/discovery-ingestion.ts`
- Create: `server/routes/discovery-ingestion.ts`
- Modify: `server/app.ts` (add route)

- [ ] **Step 1: Write the discovery ingestion service**

```typescript
// server/discovery-ingestion.ts
import db from './db/index.js';
import { callAnthropic, isAnthropicConfigured } from './anthropic-helpers.js';
import { callOpenAI } from './openai-helpers.js';
import { buildSeoContext } from './seo-context.js';
import type {
  DiscoverySource, DiscoveryExtraction, SourceType,
  ExtractionType, ExtractionCategory, Confidence, ExtractionStatus, ExtractionDestination,
} from '../shared/types/brand-engine.js';

// ── Row types
interface SourceRow {
  id: string; workspace_id: string; filename: string; source_type: string;
  raw_content: string; processed_at: string | null; created_at: string;
}
interface ExtractionRow {
  id: string; source_id: string; workspace_id: string; extraction_type: string;
  category: string; content: string; source_quote: string | null;
  confidence: string; status: string; routed_to: string | null; created_at: string;
}

// ── Prepared statements
interface Stmts {
  listSources: ReturnType<typeof db.prepare>;
  getSource: ReturnType<typeof db.prepare>;
  insertSource: ReturnType<typeof db.prepare>;
  markProcessed: ReturnType<typeof db.prepare>;
  deleteSource: ReturnType<typeof db.prepare>;
  listExtractions: ReturnType<typeof db.prepare>;
  listExtractionsBySource: ReturnType<typeof db.prepare>;
  insertExtraction: ReturnType<typeof db.prepare>;
  updateExtractionStatus: ReturnType<typeof db.prepare>;
  updateExtractionContent: ReturnType<typeof db.prepare>;
}

let _s: Stmts | null = null;
function s(): Stmts {
  if (!_s) {
    _s = {
      listSources: db.prepare(`SELECT * FROM discovery_sources WHERE workspace_id = ? ORDER BY created_at DESC`),
      getSource: db.prepare(`SELECT * FROM discovery_sources WHERE id = ? AND workspace_id = ?`),
      insertSource: db.prepare(`INSERT INTO discovery_sources (id, workspace_id, filename, source_type, raw_content, created_at) VALUES (@id, @workspace_id, @filename, @source_type, @raw_content, @created_at)`),
      markProcessed: db.prepare(`UPDATE discovery_sources SET processed_at = ? WHERE id = ?`),
      deleteSource: db.prepare(`DELETE FROM discovery_sources WHERE id = ? AND workspace_id = ?`),
      listExtractions: db.prepare(`SELECT * FROM discovery_extractions WHERE workspace_id = ? ORDER BY created_at DESC`),
      listExtractionsBySource: db.prepare(`SELECT * FROM discovery_extractions WHERE source_id = ? ORDER BY extraction_type, category`),
      insertExtraction: db.prepare(`INSERT INTO discovery_extractions (id, source_id, workspace_id, extraction_type, category, content, source_quote, confidence, status, created_at) VALUES (@id, @source_id, @workspace_id, @extraction_type, @category, @content, @source_quote, @confidence, @status, @created_at)`),
      updateExtractionStatus: db.prepare(`UPDATE discovery_extractions SET status = @status, routed_to = @routed_to WHERE id = @id AND workspace_id = @workspace_id`),
      updateExtractionContent: db.prepare(`UPDATE discovery_extractions SET content = @content WHERE id = @id AND workspace_id = @workspace_id`),
    };
  }
  return _s;
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function confidenceForSourceType(sourceType: SourceType): Confidence {
  switch (sourceType) {
    case 'transcript': return 'high';
    case 'brand_doc': return 'medium';
    case 'competitor': return 'medium';
    case 'existing_copy': return 'low';
    case 'website_crawl': return 'low';
    default: return 'medium';
  }
}

// ── Row converters
function rowToSource(row: SourceRow): DiscoverySource {
  return {
    id: row.id, workspaceId: row.workspace_id, filename: row.filename,
    sourceType: row.source_type as SourceType, rawContent: row.raw_content,
    processedAt: row.processed_at ?? undefined, createdAt: row.created_at,
  };
}

function rowToExtraction(row: ExtractionRow): DiscoveryExtraction {
  return {
    id: row.id, sourceId: row.source_id, workspaceId: row.workspace_id,
    extractionType: row.extraction_type as ExtractionType,
    category: row.category as ExtractionCategory,
    content: row.content, sourceQuote: row.source_quote ?? undefined,
    confidence: row.confidence as Confidence,
    status: row.status as ExtractionStatus,
    routedTo: (row.routed_to ?? undefined) as ExtractionDestination | undefined,
    createdAt: row.created_at,
  };
}

// ── Public API

export function listSources(workspaceId: string): DiscoverySource[] {
  return (s().listSources.all(workspaceId) as SourceRow[]).map(rowToSource);
}

export function listExtractions(workspaceId: string): DiscoveryExtraction[] {
  return (s().listExtractions.all(workspaceId) as ExtractionRow[]).map(rowToExtraction);
}

export function listExtractionsBySource(sourceId: string): DiscoveryExtraction[] {
  return (s().listExtractionsBySource.all(sourceId) as ExtractionRow[]).map(rowToExtraction);
}

export function addSource(workspaceId: string, filename: string, sourceType: SourceType, rawContent: string): DiscoverySource {
  const id = genId('src');
  const now = new Date().toISOString();
  s().insertSource.run({ id, workspace_id: workspaceId, filename, source_type: sourceType, raw_content: rawContent, created_at: now });
  return { id, workspaceId, filename, sourceType, rawContent, createdAt: now };
}

export function deleteSource(workspaceId: string, id: string): boolean {
  return s().deleteSource.run(id, workspaceId).changes > 0;
}

export function updateExtractionStatus(
  workspaceId: string, id: string, status: ExtractionStatus, routedTo?: ExtractionDestination,
): boolean {
  return s().updateExtractionStatus.run({ id, workspace_id: workspaceId, status, routed_to: routedTo ?? null }).changes > 0;
}

export function updateExtractionContent(workspaceId: string, id: string, content: string): boolean {
  return s().updateExtractionContent.run({ id, workspace_id: workspaceId, content }).changes > 0;
}

// ── AI: Process a source and extract voice patterns + story elements
export async function processSource(workspaceId: string, sourceId: string): Promise<DiscoveryExtraction[]> {
  const row = s().getSource.get(sourceId, workspaceId) as SourceRow | undefined;
  if (!row) throw new Error('Source not found');

  const source = rowToSource(row);
  const confidence = confidenceForSourceType(source.sourceType);
  const { fullContext } = buildSeoContext(workspaceId);

  const sourceLabel = source.sourceType === 'transcript'
    ? 'a discovery call transcript'
    : source.sourceType === 'competitor'
      ? 'competitor materials (extract what to AVOID, not emulate)'
      : source.sourceType === 'website_crawl'
        ? 'existing website copy (may reflect a previous copywriter, not the client\'s authentic voice)'
        : 'a brand document';

  const prompt = `You are a brand strategist analyzing ${sourceLabel} to extract brand intelligence.

BUSINESS CONTEXT:
${fullContext}

SOURCE CONTENT (${source.filename}):
${source.rawContent.slice(0, 12000)}

Extract two categories of intelligence:

1. VOICE PATTERNS — how the brand naturally communicates:
   - signature_phrase: memorable lines, catchphrases, repeated formulations
   - vocabulary: specific words they favor or avoid
   - tone_marker: humor style, formality level, energy
   - metaphor: analogies and comparisons they use to explain things
   - sentence_pattern: rhythm, length, structure preferences

2. STORY ELEMENTS — the narrative building blocks:
   - origin_story: why they started, founding motivation
   - customer_problem: pain points (external, internal, philosophical)
   - solution_framing: how they describe what they do differently
   - authority_marker: credentials, experience, proof points
   - empathy_signal: how they relate to customer frustrations
   - success_story: transformations and outcomes they describe
   - values_in_action: principles they reference naturally

For each extraction include a brief source_quote (the original text that supports it).
${source.sourceType === 'transcript' ? 'For transcripts, focus on what the CLIENT said (not the interviewer). Ignore filler words and small talk.' : ''}

Return valid JSON:
{
  "extractions": [
    {
      "extraction_type": "voice_pattern" | "story_element",
      "category": "one of the categories above",
      "content": "the extracted insight in 1-3 sentences",
      "source_quote": "brief quote from the source"
    }
  ]
}

Extract 8-15 high-quality extractions. Quality over quantity — skip anything generic or not specific to this brand.`;

  const aiCall = isAnthropicConfigured() ? callAnthropic : callOpenAI;
  const result = await aiCall({
    model: isAnthropicConfigured() ? 'claude-sonnet-4-20250514' : 'gpt-4.1',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 4000,
    temperature: 0.3,
    feature: 'discovery-extraction',
    workspaceId,
  });

  const cleaned = (result.text || '{}').replace(/^```json?\s*/i, '').replace(/```\s*$/, '');
  const parsed = JSON.parse(cleaned) as {
    extractions: { extraction_type: string; category: string; content: string; source_quote?: string }[];
  };

  const now = new Date().toISOString();
  const extractions: DiscoveryExtraction[] = (parsed.extractions || []).map(ext => {
    const id = genId('ext');
    s().insertExtraction.run({
      id, source_id: sourceId, workspace_id: workspaceId,
      extraction_type: ext.extraction_type, category: ext.category,
      content: ext.content, source_quote: ext.source_quote ?? null,
      confidence, status: 'pending', created_at: now,
    });
    return {
      id, sourceId, workspaceId,
      extractionType: ext.extraction_type as ExtractionType,
      category: ext.category as ExtractionCategory,
      content: ext.content, sourceQuote: ext.source_quote,
      confidence, status: 'pending' as ExtractionStatus, createdAt: now,
    };
  });

  s().markProcessed.run(now, sourceId);
  return extractions;
}
```

- [ ] **Step 2: Write the routes file**

```typescript
// server/routes/discovery-ingestion.ts
import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { upload } from '../middleware.js';
import {
  listSources, addSource, deleteSource, processSource,
  listExtractions, listExtractionsBySource,
  updateExtractionStatus, updateExtractionContent,
} from '../discovery-ingestion.js';
import type { SourceType, ExtractionStatus, ExtractionDestination } from '../../shared/types/brand-engine.js';

const router = Router();

// List sources
router.get('/api/discovery/:wsId/sources', requireWorkspaceAccess('wsId'), (req, res) => {
  res.json(listSources(req.params.wsId));
});

// Upload source file
router.post('/api/discovery/:wsId/sources',
  requireWorkspaceAccess('wsId'),
  upload.array('files', 10),
  (req, res) => {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files?.length) return res.status(400).json({ error: 'No files uploaded' });

    const sourceType = (req.body.sourceType || 'brand_doc') as SourceType;
    const sources = [];

    for (const file of files) {
      const ext = file.originalname.split('.').pop()?.toLowerCase();
      if (ext !== 'txt' && ext !== 'md') continue;

      const content = Buffer.isBuffer(file.buffer)
        ? file.buffer.toString('utf-8')
        : require('fs').readFileSync(file.path, 'utf-8');

      const source = addSource(req.params.wsId, file.originalname, sourceType, content);
      sources.push(source);

      // Clean up temp file if multer stored to disk
      if (file.path) try { require('fs').unlinkSync(file.path); } catch { /* ok */ }
    }

    res.json({ sources });
  },
);

// Upload source from raw text (paste)
router.post('/api/discovery/:wsId/sources/text', requireWorkspaceAccess('wsId'), (req, res) => {
  const { filename, sourceType, rawContent } = req.body;
  if (!rawContent) return res.status(400).json({ error: 'rawContent required' });
  const source = addSource(req.params.wsId, filename || 'pasted-text.txt', sourceType || 'brand_doc', rawContent);
  res.json(source);
});

// Delete source
router.delete('/api/discovery/:wsId/sources/:id', requireWorkspaceAccess('wsId'), (req, res) => {
  const ok = deleteSource(req.params.wsId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

// Process source (AI extraction)
router.post('/api/discovery/:wsId/sources/:id/process', requireWorkspaceAccess('wsId'), async (req, res) => {
  try {
    const extractions = await processSource(req.params.wsId, req.params.id);
    res.json({ extractions });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Processing failed' });
  }
});

// List all extractions for workspace
router.get('/api/discovery/:wsId/extractions', requireWorkspaceAccess('wsId'), (req, res) => {
  res.json(listExtractions(req.params.wsId));
});

// List extractions for a specific source
router.get('/api/discovery/:wsId/sources/:id/extractions', requireWorkspaceAccess('wsId'), (req, res) => {
  res.json(listExtractionsBySource(req.params.id));
});

// Update extraction status (accept/dismiss + route)
router.patch('/api/discovery/:wsId/extractions/:id', requireWorkspaceAccess('wsId'), (req, res) => {
  const { status, routedTo, content } = req.body;

  if (content !== undefined) {
    updateExtractionContent(req.params.wsId, req.params.id, content);
  }
  if (status) {
    updateExtractionStatus(
      req.params.wsId, req.params.id,
      status as ExtractionStatus,
      routedTo as ExtractionDestination | undefined,
    );
  }
  res.json({ updated: true });
});

export default router;
```

- [ ] **Step 3: Register in app.ts**

Add import and `app.use(discoveryIngestionRoutes);` in `server/app.ts`.

- [ ] **Step 4: Build and verify**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add server/discovery-ingestion.ts server/routes/discovery-ingestion.ts server/app.ts
git commit -m "feat: add discovery ingestion service — upload, AI extraction, review workflow"
```

---

## Task 5: Voice Calibration Service (Backend)

**Files:**
- Create: `server/voice-calibration.ts`
- Create: `server/routes/voice-calibration.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Write the voice calibration service**

```typescript
// server/voice-calibration.ts
import db from './db/index.js';
import { callAnthropic, isAnthropicConfigured } from './anthropic-helpers.js';
import { callOpenAI } from './openai-helpers.js';
import { buildSeoContext } from './seo-context.js';
import type {
  VoiceProfile, VoiceSample, CalibrationSession, CalibrationVariation,
  VoiceDNA, VoiceGuardrails, ContextModifier, VoiceProfileStatus,
  VoiceSampleContext, VoiceSampleSource,
} from '../shared/types/brand-engine.js';

interface ProfileRow {
  id: string; workspace_id: string; status: string;
  voice_dna_json: string | null; guardrails_json: string | null;
  context_modifiers_json: string | null; created_at: string; updated_at: string;
}
interface SampleRow {
  id: string; voice_profile_id: string; content: string;
  context_tag: string | null; source: string | null;
  sort_order: number | null; created_at: string;
}
interface SessionRow {
  id: string; voice_profile_id: string; prompt_type: string;
  variations_json: string; steering_notes: string | null; created_at: string;
}

interface Stmts {
  getProfile: ReturnType<typeof db.prepare>;
  getProfileByWorkspace: ReturnType<typeof db.prepare>;
  insertProfile: ReturnType<typeof db.prepare>;
  updateProfile: ReturnType<typeof db.prepare>;
  listSamples: ReturnType<typeof db.prepare>;
  insertSample: ReturnType<typeof db.prepare>;
  deleteSample: ReturnType<typeof db.prepare>;
  listSessions: ReturnType<typeof db.prepare>;
  insertSession: ReturnType<typeof db.prepare>;
  updateSession: ReturnType<typeof db.prepare>;
}

let _s: Stmts | null = null;
function s(): Stmts {
  if (!_s) {
    _s = {
      getProfile: db.prepare(`SELECT * FROM voice_profiles WHERE id = ?`),
      getProfileByWorkspace: db.prepare(`SELECT * FROM voice_profiles WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 1`),
      insertProfile: db.prepare(`INSERT INTO voice_profiles (id, workspace_id, status, voice_dna_json, guardrails_json, context_modifiers_json, created_at, updated_at) VALUES (@id, @workspace_id, @status, @voice_dna_json, @guardrails_json, @context_modifiers_json, @created_at, @updated_at)`),
      updateProfile: db.prepare(`UPDATE voice_profiles SET status = @status, voice_dna_json = @voice_dna_json, guardrails_json = @guardrails_json, context_modifiers_json = @context_modifiers_json, updated_at = @updated_at WHERE id = @id`),
      listSamples: db.prepare(`SELECT * FROM voice_samples WHERE voice_profile_id = ? ORDER BY sort_order`),
      insertSample: db.prepare(`INSERT INTO voice_samples (id, voice_profile_id, content, context_tag, source, sort_order, created_at) VALUES (@id, @voice_profile_id, @content, @context_tag, @source, @sort_order, @created_at)`),
      deleteSample: db.prepare(`DELETE FROM voice_samples WHERE id = ? AND voice_profile_id = ?`),
      listSessions: db.prepare(`SELECT * FROM voice_calibration_sessions WHERE voice_profile_id = ? ORDER BY created_at DESC`),
      insertSession: db.prepare(`INSERT INTO voice_calibration_sessions (id, voice_profile_id, prompt_type, variations_json, steering_notes, created_at) VALUES (@id, @voice_profile_id, @prompt_type, @variations_json, @steering_notes, @created_at)`),
      updateSession: db.prepare(`UPDATE voice_calibration_sessions SET variations_json = @variations_json, steering_notes = @steering_notes WHERE id = @id`),
    };
  }
  return _s;
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function rowToProfile(row: ProfileRow): VoiceProfile {
  return {
    id: row.id, workspaceId: row.workspace_id,
    status: row.status as VoiceProfileStatus,
    voiceDNA: row.voice_dna_json ? JSON.parse(row.voice_dna_json) : undefined,
    guardrails: row.guardrails_json ? JSON.parse(row.guardrails_json) : undefined,
    contextModifiers: row.context_modifiers_json ? JSON.parse(row.context_modifiers_json) : undefined,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function rowToSample(row: SampleRow): VoiceSample {
  return {
    id: row.id, voiceProfileId: row.voice_profile_id, content: row.content,
    contextTag: (row.context_tag ?? undefined) as VoiceSampleContext | undefined,
    source: (row.source ?? undefined) as VoiceSampleSource | undefined,
    sortOrder: row.sort_order ?? undefined, createdAt: row.created_at,
  };
}

function rowToSession(row: SessionRow): CalibrationSession {
  return {
    id: row.id, voiceProfileId: row.voice_profile_id,
    promptType: row.prompt_type,
    variations: JSON.parse(row.variations_json),
    steeringNotes: row.steering_notes ?? undefined,
    createdAt: row.created_at,
  };
}

// ── Public API

export function getVoiceProfile(workspaceId: string): (VoiceProfile & { samples: VoiceSample[] }) | null {
  const row = s().getProfileByWorkspace.get(workspaceId) as ProfileRow | undefined;
  if (!row) return null;
  const profile = rowToProfile(row);
  const samples = (s().listSamples.all(row.id) as SampleRow[]).map(rowToSample);
  return { ...profile, samples };
}

export function getOrCreateVoiceProfile(workspaceId: string): VoiceProfile & { samples: VoiceSample[] } {
  const existing = getVoiceProfile(workspaceId);
  if (existing) return existing;

  const id = genId('vp');
  const now = new Date().toISOString();
  const defaultModifiers: ContextModifier[] = [
    { context: 'Headlines & CTAs', description: 'Maximum personality. Punchy. Humor welcome.' },
    { context: 'Service descriptions', description: 'Clear and warm. Less humor, more reassurance.' },
    { context: 'SEO meta titles/descriptions', description: 'Brand voice balanced with keyword requirements. Personality in the description, precision in the title.' },
    { context: 'Blog / long-form', description: 'Full voice. Narrative rhythm. Room for extended personality.' },
    { context: 'FAQ / educational', description: 'Accessible, helpful. Expertise without condescension.' },
  ];

  s().insertProfile.run({
    id, workspace_id: workspaceId, status: 'draft',
    voice_dna_json: null, guardrails_json: null,
    context_modifiers_json: JSON.stringify(defaultModifiers),
    created_at: now, updated_at: now,
  });

  return { id, workspaceId, status: 'draft', contextModifiers: defaultModifiers, samples: [], createdAt: now, updatedAt: now };
}

export function updateVoiceProfile(
  workspaceId: string,
  updates: { status?: VoiceProfileStatus; voiceDNA?: VoiceDNA; guardrails?: VoiceGuardrails; contextModifiers?: ContextModifier[] },
): VoiceProfile | null {
  const profile = getOrCreateVoiceProfile(workspaceId);
  const now = new Date().toISOString();
  s().updateProfile.run({
    id: profile.id,
    status: updates.status ?? profile.status,
    voice_dna_json: updates.voiceDNA ? JSON.stringify(updates.voiceDNA) : (profile.voiceDNA ? JSON.stringify(profile.voiceDNA) : null),
    guardrails_json: updates.guardrails ? JSON.stringify(updates.guardrails) : (profile.guardrails ? JSON.stringify(profile.guardrails) : null),
    context_modifiers_json: updates.contextModifiers ? JSON.stringify(updates.contextModifiers) : (profile.contextModifiers ? JSON.stringify(profile.contextModifiers) : null),
    updated_at: now,
  });
  return { ...profile, ...updates, updatedAt: now };
}

export function addVoiceSample(
  workspaceId: string, content: string,
  contextTag?: VoiceSampleContext, source?: VoiceSampleSource,
): VoiceSample {
  const profile = getOrCreateVoiceProfile(workspaceId);
  const id = genId('vs');
  const now = new Date().toISOString();
  const sortOrder = profile.samples.length;
  s().insertSample.run({
    id, voice_profile_id: profile.id, content,
    context_tag: contextTag ?? null, source: source ?? 'manual',
    sort_order: sortOrder, created_at: now,
  });
  return { id, voiceProfileId: profile.id, content, contextTag, source: source ?? 'manual', sortOrder, createdAt: now };
}

export function deleteVoiceSample(workspaceId: string, sampleId: string): boolean {
  const profile = getOrCreateVoiceProfile(workspaceId);
  return s().deleteSample.run(sampleId, profile.id).changes > 0;
}

// ── AI: Generate calibration variations
export async function generateCalibrationVariations(
  workspaceId: string, promptType: string, steeringNotes?: string,
): Promise<CalibrationSession> {
  const profile = getOrCreateVoiceProfile(workspaceId);
  const { fullContext } = buildSeoContext(workspaceId);

  const samplesText = profile.samples.length > 0
    ? `\nVOICE SAMPLES (write like these):\n${profile.samples.map(s => `  [${s.contextTag || 'general'}] "${s.content}"`).join('\n')}`
    : '';

  const dnaText = profile.voiceDNA
    ? `\nVOICE DNA:\n  Personality: ${profile.voiceDNA.personalityTraits.join('. ')}\n  Tone: formal↔casual ${profile.voiceDNA.toneSpectrum.formal_casual}/10, serious↔playful ${profile.voiceDNA.toneSpectrum.serious_playful}/10\n  Sentence style: ${profile.voiceDNA.sentenceStyle}\n  Humor: ${profile.voiceDNA.humorStyle}`
    : '';

  const guardrailsText = profile.guardrails
    ? `\nGUARDRAILS:\n  Forbidden: ${profile.guardrails.forbiddenWords.join(', ')}\n  Required terms: ${profile.guardrails.requiredTerminology.map(t => `"${t.use}" not "${t.insteadOf}"`).join(', ')}\n  Boundaries: ${profile.guardrails.toneBoundaries.join('. ')}`
    : '';

  const modifierText = profile.contextModifiers
    ? `\nCONTEXT: Writing ${promptType}. ${profile.contextModifiers.find(m => m.context.toLowerCase().includes(promptType.split('_')[0]))?.description || ''}`
    : '';

  const prompt = `You are a copywriter matching a specific brand voice. Generate exactly 3 variations of ${promptType.replace(/_/g, ' ')} copy.
${fullContext}${samplesText}${dnaText}${guardrailsText}${modifierText}
${steeringNotes ? `\nSTEERING DIRECTION: ${steeringNotes}` : ''}

Return valid JSON: { "variations": ["variation 1 text", "variation 2 text", "variation 3 text"] }

Each variation should be meaningfully different in approach while staying on-brand. Make them specific to this business, not generic.`;

  const aiCall = isAnthropicConfigured() ? callAnthropic : callOpenAI;
  const result = await aiCall({
    model: isAnthropicConfigured() ? 'claude-sonnet-4-20250514' : 'gpt-4.1',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 2000,
    temperature: 0.8,
    feature: 'voice-calibration',
    workspaceId,
  });

  const cleaned = (result.text || '{}').replace(/^```json?\s*/i, '').replace(/```\s*$/, '');
  const parsed = JSON.parse(cleaned) as { variations: string[] };

  const variations: CalibrationVariation[] = (parsed.variations || []).map(text => ({ text }));

  const id = genId('cal');
  const now = new Date().toISOString();
  s().insertSession.run({
    id, voice_profile_id: profile.id, prompt_type: promptType,
    variations_json: JSON.stringify(variations),
    steering_notes: steeringNotes ?? null, created_at: now,
  });

  return { id, voiceProfileId: profile.id, promptType, variations, steeringNotes, createdAt: now };
}

// ── AI: Refine a variation with steering direction
export async function refineVariation(
  workspaceId: string, sessionId: string, variationIndex: number, direction: string,
): Promise<CalibrationSession | null> {
  const profile = getOrCreateVoiceProfile(workspaceId);
  const row = s().listSessions.all(profile.id).find((r: any) => r.id === sessionId) as SessionRow | undefined;
  if (!row) return null;

  const session = rowToSession(row);
  const original = session.variations[variationIndex];
  if (!original) return null;

  const prompt = `Refine this copy based on the direction given. Keep the same general idea but adjust as directed.

ORIGINAL: "${original.text}"
DIRECTION: ${direction}

Return valid JSON: { "refined": "the refined text" }`;

  const aiCall = isAnthropicConfigured() ? callAnthropic : callOpenAI;
  const result = await aiCall({
    model: isAnthropicConfigured() ? 'claude-sonnet-4-20250514' : 'gpt-4.1',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 1000,
    temperature: 0.7,
    feature: 'voice-refinement',
    workspaceId,
  });

  const cleaned = (result.text || '{}').replace(/^```json?\s*/i, '').replace(/```\s*$/, '');
  const parsed = JSON.parse(cleaned) as { refined: string };

  // Add refined version as new variation
  session.variations.push({ text: parsed.refined });
  const newNotes = `${session.steeringNotes || ''}\n[Refined #${variationIndex}]: ${direction}`.trim();

  s().updateSession.run({
    id: sessionId,
    variations_json: JSON.stringify(session.variations),
    steering_notes: newNotes,
  });

  return { ...session, steeringNotes: newNotes };
}
```

- [ ] **Step 2: Write the routes file**

```typescript
// server/routes/voice-calibration.ts
import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import {
  getOrCreateVoiceProfile, updateVoiceProfile,
  addVoiceSample, deleteVoiceSample,
  generateCalibrationVariations, refineVariation,
} from '../voice-calibration.js';

const router = Router();

// Get or create voice profile
router.get('/api/voice/:wsId', requireWorkspaceAccess('wsId'), (req, res) => {
  res.json(getOrCreateVoiceProfile(req.params.wsId));
});

// Update voice profile (DNA, guardrails, modifiers, status)
router.patch('/api/voice/:wsId', requireWorkspaceAccess('wsId'), (req, res) => {
  const result = updateVoiceProfile(req.params.wsId, req.body);
  if (!result) return res.status(500).json({ error: 'Update failed' });
  res.json(result);
});

// Add voice sample
router.post('/api/voice/:wsId/samples', requireWorkspaceAccess('wsId'), (req, res) => {
  const { content, contextTag, source } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });
  res.json(addVoiceSample(req.params.wsId, content, contextTag, source));
});

// Delete voice sample
router.delete('/api/voice/:wsId/samples/:sampleId', requireWorkspaceAccess('wsId'), (req, res) => {
  const ok = deleteVoiceSample(req.params.wsId, req.params.sampleId);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

// Generate calibration variations
router.post('/api/voice/:wsId/calibrate', requireWorkspaceAccess('wsId'), async (req, res) => {
  const { promptType, steeringNotes } = req.body;
  if (!promptType) return res.status(400).json({ error: 'promptType required' });
  try {
    const session = await generateCalibrationVariations(req.params.wsId, promptType, steeringNotes);
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Calibration failed' });
  }
});

// Refine a specific variation
router.post('/api/voice/:wsId/calibrate/:sessionId/refine', requireWorkspaceAccess('wsId'), async (req, res) => {
  const { variationIndex, direction } = req.body;
  if (variationIndex === undefined || !direction) return res.status(400).json({ error: 'variationIndex and direction required' });
  try {
    const session = await refineVariation(req.params.wsId, req.params.sessionId, variationIndex, direction);
    if (!session) return res.status(404).json({ error: 'Session or variation not found' });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Refinement failed' });
  }
});

export default router;
```

- [ ] **Step 3: Register in app.ts, build, commit**

```bash
git add server/voice-calibration.ts server/routes/voice-calibration.ts server/app.ts
git commit -m "feat: add voice calibration service — profile, samples, calibration loop with steering"
```

---

## Task 6: Brand Identity Service (Backend)

**Files:**
- Create: `server/brand-identity.ts`
- Create: `server/routes/brand-identity.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Write the brand identity service**

This follows the same patterns as Tasks 3-5. Key functions:

- `listDeliverables(workspaceId, tier?)` — list all deliverables, optionally filtered by tier
- `getDeliverable(workspaceId, id)` — get single deliverable with version history
- `generateDeliverable(workspaceId, deliverableType)` — AI generates a deliverable using brandscript + voice profile + discovery extractions as context
- `refineDeliverable(workspaceId, id, direction)` — conversational steering, creates new version
- `approveDeliverable(workspaceId, id)` — mark as approved. **Spec Addendum §5:** When a tagline, elevator pitch, or tone example is approved, auto-call `addVoiceSample()` from `server/voice-calibration.ts` with `source: 'identity_approved'` and the appropriate `context_tag`:
  - Approved tagline → `context_tag: 'headline'`
  - Approved elevator pitch → `context_tag: 'body'`
  - Approved tone example → matching `context_tag`
  Import `addVoiceSample` from `./voice-calibration.js`. Keep it simple — one function call after status changes to `approved`.
- `exportDeliverables(workspaceId, tier?)` — export as markdown text

The AI prompt for generation should include:
- Full brandscript content
- Voice profile (DNA + samples + guardrails)
- Accepted discovery extractions
- Business context from `buildSeoContext()`

Each deliverable type has specific generation instructions (e.g., mission statement = 1-2 sentences, values = 3-5 with descriptions, elevator pitches = three lengths).

- [ ] **Step 2: Write the routes file**

Routes follow the same pattern:
- `GET /api/brand-identity/:wsId` — list deliverables
- `POST /api/brand-identity/:wsId/generate` — generate specific deliverable type
- `POST /api/brand-identity/:wsId/:id/refine` — refine with steering direction
- `PATCH /api/brand-identity/:wsId/:id` — update status (approve/draft)
- `GET /api/brand-identity/:wsId/export` — export markdown

- [ ] **Step 3: Register in app.ts, build, commit**

```bash
git add server/brand-identity.ts server/routes/brand-identity.ts server/app.ts
git commit -m "feat: add brand identity service — deliverable generation, refinement, versioning, export"
```

---

## Task 7: Enriched AI Context (seo-context.ts Integration)

**Files:**
- Modify: `server/seo-context.ts`

- [ ] **Step 1: Add new context builder functions**

Add three new functions to `seo-context.ts`:

```typescript
import { getBrandscript, listBrandscripts } from './brandscript.js';
import { getVoiceProfile } from './voice-calibration.js';
import { listDeliverables } from './brand-identity.js';

// Spec Addendum §3: All three builders accept optional emphasis parameter.
// 'full' = everything (default for Phase 1 callers).
// 'summary' = key items only (Phase 3: secondary context pages).
// 'minimal' = one-paragraph summary (Phase 3: background context).
import type { ContextEmphasis } from '../shared/types/brand-engine.js';

export function buildBrandscriptContext(workspaceId: string, emphasis: ContextEmphasis = 'full'): string {
  const scripts = listBrandscripts(workspaceId);
  if (scripts.length === 0) return '';

  const bs = scripts[0]; // Use most recent
  const filledSections = bs.sections.filter(sec => sec.content?.trim());

  if (filledSections.length === 0) return '';

  if (emphasis === 'minimal') {
    // One-paragraph summary: just the framework type and first section
    const first = filledSections[0];
    return `\n\nBRAND NARRATIVE (${bs.frameworkType}): ${first.title} — ${first.content?.slice(0, 200)}...`;
  }

  const sections = (emphasis === 'summary' ? filledSections.slice(0, 3) : filledSections)
    .map(sec => `  ${sec.title}: ${sec.content}`)
    .join('\n');

  return `\n\nBRAND NARRATIVE (${bs.frameworkType} framework):\n${sections}`;
}

export function buildVoiceProfileContext(workspaceId: string, emphasis: ContextEmphasis = 'full'): string {
  const profile = getVoiceProfile(workspaceId);
  if (!profile) return '';

  const parts: string[] = [];

  if (profile.voiceDNA) {
    parts.push(`VOICE DNA:`);
    parts.push(`  Personality: ${profile.voiceDNA.personalityTraits.join('. ')}`);
    parts.push(`  Tone: formal↔casual ${profile.voiceDNA.toneSpectrum.formal_casual}/10, serious↔playful ${profile.voiceDNA.toneSpectrum.serious_playful}/10, technical↔accessible ${profile.voiceDNA.toneSpectrum.technical_accessible}/10`);
    parts.push(`  Sentence style: ${profile.voiceDNA.sentenceStyle}`);
    parts.push(`  Humor: ${profile.voiceDNA.humorStyle}`);
  }

  if (profile.samples.length > 0) {
    parts.push(`\nVOICE SAMPLES (write like these):`);
    for (const sample of profile.samples.slice(0, 5)) {
      parts.push(`  [${sample.contextTag || 'general'}] "${sample.content}"`);
    }
  }

  if (profile.guardrails) {
    parts.push(`\nGUARDRAILS:`);
    if (profile.guardrails.forbiddenWords.length) parts.push(`  Never use: ${profile.guardrails.forbiddenWords.join(', ')}`);
    if (profile.guardrails.requiredTerminology.length) parts.push(`  Required: ${profile.guardrails.requiredTerminology.map(t => `"${t.use}" not "${t.insteadOf}"`).join(', ')}`);
    if (profile.guardrails.toneBoundaries.length) parts.push(`  Boundaries: ${profile.guardrails.toneBoundaries.join('. ')}`);
  }

  if (parts.length === 0) return '';
  return `\n\nBRAND VOICE PROFILE (you MUST match this voice — do not deviate):\n${parts.join('\n')}`;
}

export function buildIdentityContext(workspaceId: string, emphasis: ContextEmphasis = 'full'): string {
  const deliverables = listDeliverables(workspaceId).filter(d => d.status === 'approved');
  if (deliverables.length === 0) return '';

  if (emphasis === 'minimal') {
    // Just mission statement if available
    const mission = deliverables.find(d => d.deliverableType === 'mission');
    return mission ? `\n\nBRAND MISSION: ${mission.content.slice(0, 200)}` : '';
  }

  const selected = emphasis === 'summary'
    ? deliverables.filter(d => ['mission', 'messaging_pillars', 'tagline'].includes(d.deliverableType))
    : deliverables;

  const parts: string[] = [];
  for (const d of selected) {
    parts.push(`  ${d.deliverableType.replace(/_/g, ' ').toUpperCase()}: ${d.content.slice(0, 500)}`);
  }

  return `\n\nBRAND IDENTITY (approved deliverables):\n${parts.join('\n')}`;
}
```

- [ ] **Step 2: Extend buildSeoContext to include new blocks**

In the existing `buildSeoContext` function, add the new blocks to `fullContext`:

```typescript
// After existing blocks are built
const brandscriptBlock = buildBrandscriptContext(workspaceId);
const voiceProfileBlock = buildVoiceProfileContext(workspaceId);
const identityBlock = buildIdentityContext(workspaceId);

// Replace the existing brandVoiceBlock with the richer version if voice profile exists
const effectiveBrandVoice = voiceProfileBlock || brandVoiceBlock;

const fullContext = [keywordBlock, effectiveBrandVoice, brandscriptBlock, identityBlock, personasBlock, knowledgeBlock].filter(Boolean).join('');
```

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: No errors. Existing features continue to work (voice profile is additive — falls back to existing brandVoice if no profile exists).

- [ ] **Step 4: Commit**

```bash
git add server/seo-context.ts
git commit -m "feat: extend seo-context with brandscript, voice profile, and identity context builders"
```

---

## Task 8: Frontend API Client

**Files:**
- Create: `src/api/brand-engine.ts`

- [ ] **Step 1: Write the API client**

```typescript
// src/api/brand-engine.ts
import { get, post, put, patch, del, postForm } from './client';
import type {
  Brandscript, BrandscriptTemplate,
  DiscoverySource, DiscoveryExtraction,
  VoiceProfile, VoiceSample, CalibrationSession,
  BrandDeliverable,
} from '../../shared/types/brand-engine';

// ═══ BRANDSCRIPT ═══

export const brandscripts = {
  list: (wsId: string) => get<Brandscript[]>(`/api/brandscripts/${wsId}`),
  get: (wsId: string, id: string) => get<Brandscript>(`/api/brandscripts/${wsId}/${id}`),
  create: (wsId: string, body: { name: string; frameworkType?: string; sections?: { title: string; purpose?: string; content?: string }[] }) =>
    post<Brandscript>(`/api/brandscripts/${wsId}`, body),
  updateSections: (wsId: string, id: string, sections: { id?: string; title: string; purpose?: string; content?: string }[]) =>
    put<Brandscript>(`/api/brandscripts/${wsId}/${id}/sections`, { sections }),
  remove: (wsId: string, id: string) => del(`/api/brandscripts/${wsId}/${id}`),
  import: (wsId: string, body: { name?: string; rawText: string }) =>
    post<Brandscript>(`/api/brandscripts/${wsId}/import`, body),
  complete: (wsId: string, id: string) =>
    post<Brandscript>(`/api/brandscripts/${wsId}/${id}/complete`, {}),
  templates: () => get<BrandscriptTemplate[]>('/api/brandscript-templates'),
};

// ═══ DISCOVERY INGESTION ═══

export const discovery = {
  listSources: (wsId: string) => get<DiscoverySource[]>(`/api/discovery/${wsId}/sources`),
  uploadFiles: (wsId: string, files: File[], sourceType: string) => {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    fd.append('sourceType', sourceType);
    return postForm<{ sources: DiscoverySource[] }>(`/api/discovery/${wsId}/sources`, fd);
  },
  uploadText: (wsId: string, body: { filename?: string; sourceType?: string; rawContent: string }) =>
    post<DiscoverySource>(`/api/discovery/${wsId}/sources/text`, body),
  deleteSource: (wsId: string, id: string) => del(`/api/discovery/${wsId}/sources/${id}`),
  process: (wsId: string, sourceId: string) =>
    post<{ extractions: DiscoveryExtraction[] }>(`/api/discovery/${wsId}/sources/${sourceId}/process`, {}),
  listExtractions: (wsId: string) => get<DiscoveryExtraction[]>(`/api/discovery/${wsId}/extractions`),
  listExtractionsBySource: (wsId: string, sourceId: string) =>
    get<DiscoveryExtraction[]>(`/api/discovery/${wsId}/sources/${sourceId}/extractions`),
  updateExtraction: (wsId: string, id: string, body: { status?: string; routedTo?: string; content?: string }) =>
    patch<{ updated: boolean }>(`/api/discovery/${wsId}/extractions/${id}`, body),
};

// ═══ VOICE CALIBRATION ═══

export const voice = {
  getProfile: (wsId: string) => get<VoiceProfile & { samples: VoiceSample[] }>(`/api/voice/${wsId}`),
  updateProfile: (wsId: string, body: Record<string, unknown>) => patch<VoiceProfile>(`/api/voice/${wsId}`, body),
  addSample: (wsId: string, body: { content: string; contextTag?: string; source?: string }) =>
    post<VoiceSample>(`/api/voice/${wsId}/samples`, body),
  deleteSample: (wsId: string, sampleId: string) => del(`/api/voice/${wsId}/samples/${sampleId}`),
  calibrate: (wsId: string, body: { promptType: string; steeringNotes?: string }) =>
    post<CalibrationSession>(`/api/voice/${wsId}/calibrate`, body),
  refine: (wsId: string, sessionId: string, body: { variationIndex: number; direction: string }) =>
    post<CalibrationSession>(`/api/voice/${wsId}/calibrate/${sessionId}/refine`, body),
};

// ═══ BRAND IDENTITY ═══

export const identity = {
  list: (wsId: string) => get<BrandDeliverable[]>(`/api/brand-identity/${wsId}`),
  generate: (wsId: string, body: { deliverableType: string }) =>
    post<BrandDeliverable>(`/api/brand-identity/${wsId}/generate`, body),
  refine: (wsId: string, id: string, body: { direction: string }) =>
    post<BrandDeliverable>(`/api/brand-identity/${wsId}/${id}/refine`, body),
  updateStatus: (wsId: string, id: string, status: string) =>
    patch<BrandDeliverable>(`/api/brand-identity/${wsId}/${id}`, { status }),
  export: (wsId: string, tier?: string) =>
    get<{ markdown: string }>(`/api/brand-identity/${wsId}/export${tier ? `?tier=${tier}` : ''}`),
};
```

- [ ] **Step 2: Commit**

```bash
git add src/api/brand-engine.ts
git commit -m "feat: add frontend API client for brandscript engine"
```

---

## Task 9: Brand Hub Sub-Tab Navigation

**Files:**
- Modify: `src/components/BrandHub.tsx`

- [ ] **Step 1: Add sub-tab state and navigation to BrandHub**

Add a tab selector at the top of the Brand Hub that switches between:
- **Brandscript** (new)
- **Discovery** (new)
- **Voice** (new)
- **Identity** (new)
- **Knowledge Base** (existing — current brand voice + knowledge base sections)
- **Personas** (existing)
- **Brand Docs** (existing)

The existing Brand Hub content (brand voice textarea, knowledge base, personas, brand docs) moves under "Knowledge Base", "Personas", and "Brand Docs" tabs respectively. New tabs render placeholder components initially.

```typescript
// Add to BrandHub.tsx
const [activeTab, setActiveTab] = useState<string>('brandscript');

const tabs = [
  { id: 'brandscript', label: 'Brandscript', icon: BookOpen },
  { id: 'discovery', label: 'Discovery', icon: FileSearch },
  { id: 'voice', label: 'Voice', icon: MessageSquare },
  { id: 'identity', label: 'Identity', icon: Award },
  { id: 'knowledge', label: 'Knowledge Base', icon: Database },
  { id: 'personas', label: 'Personas', icon: Users },
  { id: 'brand-docs', label: 'Brand Docs', icon: FileText },
];
```

Render the tab bar after `PageHeader`, then conditionally render content based on `activeTab`. Existing sections move under their respective tabs. New tabs render `<BrandscriptTab>`, `<DiscoveryTab>`, `<VoiceTab>`, `<IdentityTab>` components (created in subsequent tasks).

- [ ] **Step 2: Commit**

```bash
git add src/components/BrandHub.tsx
git commit -m "feat: add sub-tab navigation to Brand Hub for new brandscript engine sections"
```

---

## Task 10: BrandscriptTab Component

**Files:**
- Create: `src/components/brand/BrandscriptTab.tsx`

- [ ] **Step 1: Build the brandscript tab component**

Features:
- List existing brandscripts for the workspace
- Create new brandscript (select framework template or custom)
- Section editor: expandable cards for each section, rich text editing per section
- Import mode: textarea to paste a brandscript doc, "Import" button calls `brandscripts.import()`
- AI-assist: "Complete empty sections" button calls `brandscripts.complete()`
- Save button per section, auto-save debounce

Follow BrandHub.tsx patterns: section cards with `bg-zinc-900 border border-zinc-800`, teal accent buttons, `Loader2` spinner states, `useToast()` for feedback.

- [ ] **Step 2: Commit**

```bash
git add src/components/brand/BrandscriptTab.tsx
git commit -m "feat: add BrandscriptTab — framework builder with import and AI completion"
```

---

## Task 11: DiscoveryTab Component

**Files:**
- Create: `src/components/brand/DiscoveryTab.tsx`

- [ ] **Step 1: Build the discovery tab component**

Features:
- File upload zone (drag-and-drop) for transcripts and brand docs
- Source type selector (transcript, brand doc, competitor, existing copy)
- List of uploaded sources with process/delete actions
- "Process" button triggers AI extraction, shows loading state
- Extraction review cards: each extraction shows content + source quote + confidence badge
- Accept/Edit/Dismiss buttons per extraction
- Routing indicator showing where accepted extractions will flow

- [ ] **Step 2: Commit**

```bash
git add src/components/brand/DiscoveryTab.tsx
git commit -m "feat: add DiscoveryTab — transcript upload, AI extraction, review workflow"
```

---

## Task 12: VoiceTab Component

**Files:**
- Create: `src/components/brand/VoiceTab.tsx`

- [ ] **Step 1: Build the voice tab component**

Three sub-sections:

**Samples:** List of voice samples with add/delete. Each sample has a context tag selector (headline, body, CTA, etc.).

**Voice DNA:** Editable personality traits list, tone spectrum sliders (1-10 scales), sentence style and humor style text fields.

**Guardrails:** Editable lists for forbidden words, required terminology (use/instead-of pairs), tone boundaries.

**Calibration Loop:** Prompt type selector, "Generate" button, displays 3 variations with On-brand/Close/Wrong rating buttons, free-text feedback, "Refine" button for steering, "Save as Sample" button to anchor good copy.

- [ ] **Step 2: Commit**

```bash
git add src/components/brand/VoiceTab.tsx
git commit -m "feat: add VoiceTab — samples, DNA editor, guardrails, calibration loop"
```

---

## Task 13: IdentityTab Component

**Files:**
- Create: `src/components/brand/IdentityTab.tsx`

- [ ] **Step 1: Build the identity tab component**

Features:
- Grid of deliverable cards organized by tier (Essentials / Professional / Premium)
- Each card shows: type name, status badge (draft/approved), current content preview
- "Generate" button per deliverable type
- Inline content display with "Refine" input for steering direction
- "Approve" button to mark as final
- "Export All" button at the top — generates markdown of all approved deliverables

- [ ] **Step 2: Commit**

```bash
git add src/components/brand/IdentityTab.tsx
git commit -m "feat: add IdentityTab — deliverable generation, refinement, approval, export"
```

---

## Task 14: SteeringChat Component (Shared)

**Files:**
- Create: `src/components/brand/SteeringChat.tsx`

- [ ] **Step 1: Build the reusable steering chat component**

A chat-style interface used by both VoiceTab (calibration refinement) and IdentityTab (deliverable refinement). Props:

```typescript
interface SteeringChatProps {
  content: string;                    // Current content being refined
  onRefine: (direction: string) => Promise<string>;  // Returns refined content
  versions: { content: string; steeringNotes?: string }[];  // Version history
  onSelectVersion: (index: number) => void;
}
```

Features:
- Text input for steering direction
- Submit sends direction, shows loading, displays refined result
- Version history sidebar/dropdown to revert to previous versions
- Extends the `PageRewriteChat.tsx` interaction pattern
- **Auto-summarization (Spec Addendum §1):** After 6 steering exchanges within a single session, auto-summarize prior exchanges (except the 3 most recent) into a condensed context block. The summary preserves: key directions given, what was rejected, what was approved, and the current trajectory. Summarization uses GPT-4.1-mini via `callOpenAI`. Store the summary on the session record (`steeringNotes` field). Reference implementation: `server/routes/rewrite-chat.ts` — look for the `summarizeConversation` pattern. **Do NOT just truncate old messages. Summarize them.** Truncation loses critical context like "we already tried a formal tone and the user hated it."

- [ ] **Step 2: Commit**

```bash
git add src/components/brand/SteeringChat.tsx
git commit -m "feat: add SteeringChat — reusable conversational refinement component"
```

---

## Task 15: Wire Components into BrandHub + Final Build

**Files:**
- Modify: `src/components/BrandHub.tsx` (import and render new tab components)

- [ ] **Step 1: Import and render the four new tab components**

```typescript
import { BrandscriptTab } from './brand/BrandscriptTab';
import { DiscoveryTab } from './brand/DiscoveryTab';
import { VoiceTab } from './brand/VoiceTab';
import { IdentityTab } from './brand/IdentityTab';

// In render, under activeTab conditionals:
{activeTab === 'brandscript' && <BrandscriptTab workspaceId={workspaceId} />}
{activeTab === 'discovery' && <DiscoveryTab workspaceId={workspaceId} />}
{activeTab === 'voice' && <VoiceTab workspaceId={workspaceId} />}
{activeTab === 'identity' && <IdentityTab workspaceId={workspaceId} />}
```

- [ ] **Step 2: Full build verification**

Run: `npm run build`
Expected: No TypeScript errors. Server starts cleanly.

- [ ] **Step 3: Manual smoke test**

Start the dev server, navigate to Brand Hub, verify:
1. Sub-tabs render and switch correctly
2. Existing Knowledge Base / Personas / Brand Docs sections still work
3. Brandscript tab can create a brandscript with StoryBrand template
4. Discovery tab can upload a text file
5. Voice tab shows empty profile with default context modifiers
6. Identity tab shows deliverable grid

- [ ] **Step 4: Commit**

```bash
git add src/components/BrandHub.tsx
git commit -m "feat: wire brandscript engine tabs into Brand Hub — complete Phase 1 UI"
```

---

## Task 16: Documentation Update

**Files:**
- Modify: `docs/FEATURE_VISION.md` or relevant docs

- [ ] **Step 1: Update feature docs**

Add the Brandscript Engine to the shipped features list. Note Phase 2 and Phase 3 as planned.

- [ ] **Step 2: Commit**

```bash
git add docs/
git commit -m "docs: add brandscript engine to feature documentation"
```

---

## Amendments (2026-03-28): Pattern Alignment Audit

> These amendments were identified by auditing the plan against the current codebase (migrations 001-040, 26+ server modules, 15+ route files). **Every agent dispatcher and implementer MUST apply these corrections.** The inline code blocks above reflect the original plan — these amendments override them.

### Amendment 1: Migration Number — 026 → 041

Migration 026 already exists (`026-missing-indexes.sql`). The current highest migration is 040.

**Change:** All references to `026-brandscript-engine.sql` become `041-brandscript-engine.sql`.

Affected locations:
- Task 1: filename, step descriptions, commit message
- Guardrails doc: file ownership map, task dependency graph, model assignments

Downstream impact: Phase 2 migration becomes **042**, Phase 3 becomes **043**.

### Amendment 2: ID Generation — `genId()` → `randomUUID()` Convention

The codebase uses `crypto.randomUUID()` with short prefixed IDs (e.g., `ab_${randomUUID().slice(0, 8)}`). The plan's `genId(prefix)` function (timestamp-based) does not exist anywhere in the codebase.

**Change:** Replace all `genId(prefix)` calls with the canonical pattern:

```typescript
import { randomUUID } from 'crypto';

// Use short prefixed UUIDs matching the codebase convention:
const id = `bs_${randomUUID().slice(0, 8)}`;   // brandscript
const id = `bss_${randomUUID().slice(0, 8)}`;  // brandscript section
const id = `src_${randomUUID().slice(0, 8)}`;  // discovery source
const id = `ext_${randomUUID().slice(0, 8)}`;  // discovery extraction
const id = `vp_${randomUUID().slice(0, 8)}`;   // voice profile
const id = `vs_${randomUUID().slice(0, 8)}`;   // voice sample
const id = `cal_${randomUUID().slice(0, 8)}`;  // calibration session
const id = `bid_${randomUUID().slice(0, 8)}`;  // brand identity deliverable
const id = `biv_${randomUUID().slice(0, 8)}`;  // brand identity version
```

Remove all `genId()` function definitions from Tasks 3, 4, 5, 6.

### Amendment 3: Prepared Statement Caching — Manual → `createStmtCache()`

The codebase uses `createStmtCache()` from `server/db/stmt-cache.ts` (26 files, 165 occurrences). The plan's manual `let _s: Stmts | null = null; function s()` pattern is non-canonical.

**Change:** Replace all manual stmt caching with:

```typescript
import { createStmtCache } from './db/stmt-cache.js';

const stmts = createStmtCache(() => ({
  listByWorkspace: db.prepare(`SELECT * FROM ...`),
  getById: db.prepare(`SELECT * FROM ...`),
  // etc.
}));

// Usage: stmts().listByWorkspace.all(workspaceId)
```

Remove the `Stmts` interface, `_s` variable, and `s()` function from Tasks 3, 4, 5, 6. The `createStmtCache` utility handles lazy initialization identically but with the canonical API.

### Amendment 4: Route Registration — Consolidate in Task 8

Tasks 3, 4, 5, and 6 each include a step to register their routes in `server/app.ts`. This violates the guardrails' file ownership map, which assigns `server/app.ts` exclusively to Task 8.

**Change:**
- **Tasks 3, 4, 5, 6:** Remove "Register in app.ts" steps. Remove `server/app.ts` from their commit file lists. These tasks only create their own files.
- **Task 8 (renamed from "Frontend API Client" to "Route Registration + API Client"):** This task now handles ALL four route registrations in `app.ts` AND creates the frontend API client. Alternatively, keep Task 8 as app.ts-only and Task 9 as API client — the key constraint is that app.ts is touched only once, after all four services are committed.

Updated Task 8 scope:
```typescript
// server/app.ts — add all four route imports + registrations in one commit
import brandscriptRoutes from './routes/brandscript.js';
import discoveryIngestionRoutes from './routes/discovery-ingestion.js';
import voiceCalibrationRoutes from './routes/voice-calibration.js';
import brandIdentityRoutes from './routes/brand-identity.js';

// In the app.use() section:
app.use(brandscriptRoutes);
app.use(discoveryIngestionRoutes);
app.use(voiceCalibrationRoutes);
app.use(brandIdentityRoutes);
```

### Amendment 5: Route Parameter Naming — `:wsId` → `:workspaceId`

The codebase universally uses `:workspaceId` with `requireWorkspaceAccess('workspaceId')`. The plan uses `:wsId` with `requireWorkspaceAccess('wsId')`.

**Change:** All route definitions in Tasks 3-6 route files must use `:workspaceId`:

```typescript
// Before (plan):
router.get('/api/brandscripts/:wsId', requireWorkspaceAccess('wsId'), ...)
// After (amended):
router.get('/api/brandscripts/:workspaceId', requireWorkspaceAccess('workspaceId'), ...)
```

Apply to ALL routes in: `server/routes/brandscript.ts`, `server/routes/discovery-ingestion.ts`, `server/routes/voice-calibration.ts`, `server/routes/brand-identity.ts`.

The frontend API client (Task 9) parameter names (`wsId` in function signatures) are fine — those are just internal JS variable names, not route params. But keep them consistent with codebase style if desired.

### Amendment 6: Structured Logging — Add `createLogger()`

All recent server modules use `createLogger()` from `server/logger.ts`. The plan's server modules omit logging entirely.

**Change:** Add to each server module (Tasks 3, 4, 5, 6, 7):

```typescript
import { createLogger } from './logger.js';
const log = createLogger('brandscript');        // Task 3
const log = createLogger('discovery-ingestion'); // Task 4
const log = createLogger('voice-calibration');   // Task 5
const log = createLogger('brand-identity');      // Task 6
```

Use `log.info()` for significant operations (AI calls, file processing), `log.debug()` for routine operations, and `log.error()` in catch blocks.

### Amendment 7: Safe JSON Column Parsing — `parseJsonFallback()`

The codebase uses `parseJsonFallback()` and `parseJsonSafe()` from `server/db/json-validation.ts` for all JSON column reads. The plan uses bare `JSON.parse()` in `rowToProfile()`, `rowToTemplate()`, `rowToSession()`.

**Change:** Replace bare `JSON.parse` on DB columns with safe parsing:

```typescript
import { parseJsonFallback } from './db/json-validation.js';

// Before (plan):
voiceDNA: row.voice_dna_json ? JSON.parse(row.voice_dna_json) : undefined,

// After (amended):
voiceDNA: row.voice_dna_json ? parseJsonFallback(row.voice_dna_json, null, 'voice_dna_json') ?? undefined : undefined,
```

Apply to all `rowToX()` converters that parse JSON columns: `rowToTemplate` (sections_json), `rowToProfile` (voice_dna_json, guardrails_json, context_modifiers_json), `rowToSession` (variations_json).

### Amendment 8: Task Numbering Realignment

The plan has 16 tasks but the guardrails list 15 in the file ownership map. The discrepancy:
- Plan Tasks 1-15 map to guardrails Tasks 1-15
- Plan Task 16 (Documentation Update) is not in guardrails but is required by CLAUDE.md quality gates

The guardrails plan-level task numbering is correct as a subset. Task 16 is post-implementation housekeeping. No structural change needed, just noting the discrepancy for dispatchers.

### Amendment 9: BrandHub.tsx — Tab Integration Pattern

The current BrandHub.tsx is a single-file component with inline brand voice, knowledge base, and personas sections. There is no existing tab system.

The plan's Task 9 (now Task 9/10 depending on renumbering) introduces sub-tab navigation. This is correct, but implementers should note:
- Use the existing `TabBar` component from `src/components/ui/` rather than hand-rolling tab markup
- Existing state (brandVoice, kbDraft, localPersonas, etc.) stays in BrandHub.tsx — new tabs receive `workspaceId` as a prop and manage their own data via React Query hooks
- The "Knowledge Base" tab wraps the existing brand voice textarea + knowledge base textarea + brand docs section
- The "Personas" tab wraps the existing personas section

### Summary of Amendments

| # | What | Where in plan | Impact |
|---|------|--------------|--------|
| 1 | Migration 026 → 041 | Task 1, guardrails | All references |
| 2 | `genId()` → `randomUUID()` | Tasks 3-6 | All ID generation |
| 3 | Manual stmt cache → `createStmtCache()` | Tasks 3-6 | All DB access |
| 4 | app.ts registration → Task 8 only | Tasks 3-6 steps removed, Task 8 expanded | File ownership |
| 5 | `:wsId` → `:workspaceId` | Tasks 3-6 route files | All route definitions |
| 6 | Add `createLogger()` | Tasks 3-7 | All server modules |
| 7 | `JSON.parse` → `parseJsonFallback()` | Tasks 3-6 row converters | All JSON column reads |
| 8 | Task 16 not in guardrails | Documentation only | No structural change |
| 9 | TabBar component for BrandHub | Task 9/15 | Use UI primitive |

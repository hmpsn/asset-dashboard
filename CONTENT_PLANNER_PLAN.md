# Content Planner — Architecture & Build Plan

> Planning features for templated, bulk content generation targeting location×service page matrices.

---

## Problem Statement

Currently, the content pipeline is designed for **one-off blog posts**: generate a brief → write a post → review → publish. This works for ongoing content marketing but fails for **site build planning** where you need:

- Dozens or hundreds of pages following the **same template** with variable-driven differences
- Each page targeting a **unique, pre-researched keyword**
- Content structured to match a **Webflow CMS collection** schema
- A bird's-eye view of **what's planned, what's written, what's published**
- Protection against **keyword cannibalization** across similar pages

### Use Case Examples

The system is **not locked to any specific site structure**. Templates and matrices are user-defined — variables, URL patterns, and section structures are entirely flexible.

| Use Case | Variables | URL Pattern | Keyword Pattern | Template Sections |
|----------|-----------|------------|-----------------|-------------------|
| **Location × Service** (dental, HVAC, legal) | `{city}`, `{service}` | `/services/{city}/{service}` | `{service} {city}` | Hero, What Is, Why Us, Process, FAQ, CTA |
| **Pillar × Subtopic** (content hubs) | `{pillar}`, `{subtopic}` | `/resources/{pillar}/{subtopic}` | `{subtopic} guide` | Overview, Key Concepts, How-To, Examples, FAQ |
| **Industry × Solution** (B2B SaaS) | `{industry}`, `{solution}` | `/solutions/{industry}/{solution}` | `{solution} for {industry}` | Problem, Solution, Features, Case Study, Pricing CTA |
| **Single dimension** (blog series) | `{topic}` | `/blog/{topic}` | `{topic}` | Intro, Deep Dive, Takeaways, Next Steps |
| **3+ dimensions** (franchise) | `{brand}`, `{city}`, `{service}` | `/{brand}/{city}/{service}` | `{brand} {service} {city}` | Brand Intro, Service Detail, Location Info, Reviews, CTA |
| **Non-hierarchical** (comparison pages) | `{product_a}`, `{product_b}` | `/compare/{product_a}-vs-{product_b}` | `{product_a} vs {product_b}` | Overview, Feature Comparison, Pricing, Verdict |

**Key design principle:** Nothing in the template or matrix system is hard-coded to "city" or "service". You name the variables, define the sections, set the URL pattern, and the system generates + manages the rest.

---

## Feature Overview (6 features, 3 phases)

### Phase 1: Foundation (Content Templates + Keyword Pre-Assignment)
1. **Content Templates** — Define reusable page structures with named sections
2. **Keyword Pre-Assignment** — Lock keywords to planned pages before writing

### Phase 2: Scale (Content Matrix + Smart Keywords + Cannibalization)
3. **Content Matrix** — Define variables (cities, services) → auto-generate page plans
4. **Smart Keyword Recommendations** — AI + SEMRush suggest the best keyword variant per cell
5. **Cannibalization Detection** — Flag overlapping keyword targets across pages

### Phase 3: Output (CSV Export + Site Architecture)
6. **CSV Export** — Download structured CSV matching Webflow CMS collection columns
7. **Site Architecture Planner** — Visual page hierarchy + internal linking plan

---

## Phase 1: Foundation

### Feature 1: Content Templates

#### What it is
A reusable page structure definition that tells the AI **exactly** what sections to generate, in what order, with what constraints. Templates are per-workspace, reusable across many briefs/posts.

#### Data Model

```typescript
// shared/types/content.ts (additions)

interface ContentTemplate {
  id: string;
  workspaceId: string;
  name: string;                    // e.g., "Location Service Page"
  description: string;             // What this template is for
  pageType: ContentBrief['pageType']; // 'service' | 'location' | etc.
  
  // Variable placeholders — replaced per-page
  variables: TemplateVariable[];   // e.g., [{name: 'city', label: 'City'}, {name: 'service', label: 'Service'}]
  
  // Section blueprint
  sections: TemplateSectionDef[];
  
  // Global constraints
  wordCountTarget: number;         // Total target
  toneAndStyle: string;            // Shared tone guidance
  schemaTypes: string[];           // e.g., ['LocalBusiness', 'FAQPage', 'Service']
  ctaGuidance: string;             // Shared CTA instructions
  
  // CMS field mapping (optional — for Phase 3)
  cmsFieldMap?: Record<string, string>; // section name → CMS field slug
  
  createdAt: string;
  updatedAt: string;
}

interface TemplateVariable {
  name: string;       // Variable key: 'city', 'service'
  label: string;      // Display: 'City', 'Service'
  description?: string; // Hint: 'The target city for this page'
}

interface TemplateSectionDef {
  name: string;                    // Internal key: 'hero', 'what_is', 'why_us'
  headingTemplate: string;         // "What is {service}?" — variables in {braces}
  required: boolean;
  wordCountTarget: number;
  guidance: string;                // Detailed instructions for this section
  subheadings?: string[];          // Optional H3s within this section
  includesFaq?: boolean;           // Whether this section contains FAQ items
}
```

#### Database

New migration `014-content-templates.sql`:

```sql
CREATE TABLE IF NOT EXISTS content_templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  page_type TEXT,
  variables TEXT NOT NULL DEFAULT '[]',    -- JSON array of TemplateVariable
  sections TEXT NOT NULL DEFAULT '[]',     -- JSON array of TemplateSectionDef
  word_count_target INTEGER NOT NULL DEFAULT 1200,
  tone_and_style TEXT NOT NULL DEFAULT '',
  schema_types TEXT NOT NULL DEFAULT '[]', -- JSON string array
  cta_guidance TEXT NOT NULL DEFAULT '',
  cms_field_map TEXT,                      -- JSON Record<string,string> or null
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_templates_workspace ON content_templates(workspace_id);
```

#### Backend (server/)

New files:
- `server/content-templates.ts` — CRUD: `listTemplates()`, `getTemplate()`, `createTemplate()`, `updateTemplate()`, `deleteTemplate()`
- `server/routes/content-templates.ts` — REST endpoints

Modify:
- `server/content-brief.ts` — `generateBrief()` accepts optional `templateId`. When present:
  - Loads the template
  - Replaces `{variables}` in heading templates with provided values
  - Passes section structure as a constraint to the AI prompt (instead of letting AI decide structure)
  - The prompt says: "You MUST use exactly these sections in this order: [sections]. Do NOT add or remove sections."
- `server/content-posts-ai.ts` — `generateSection()` receives template section guidance alongside the brief outline, producing more constrained output

API endpoints:
```
GET    /api/content-templates/:workspaceId           — list templates
GET    /api/content-templates/:workspaceId/:id        — get one
POST   /api/content-templates/:workspaceId            — create
PATCH  /api/content-templates/:workspaceId/:id        — update
DELETE /api/content-templates/:workspaceId/:id        — delete
```

#### Frontend (src/)

New files:
- `src/components/templates/TemplateEditor.tsx` — Full CRUD UI for building templates
  - Section builder with drag-to-reorder
  - Variable definition (name, label, description)
  - Live preview of heading templates with sample variable values
  - Word count targets per section with running total
  - Schema type selector
- `src/components/templates/TemplateList.tsx` — List view with template cards

Modify:
- `src/components/ContentPipeline.tsx` — Add "Templates" tab alongside Briefs/Posts/Subscriptions
- `src/components/ContentBriefs.tsx` — Brief generation form gets optional "Use template" dropdown. When selected:
  - Shows variable input fields (e.g., City: ___, Service: ___)
  - Section structure is locked (shown as preview, not editable)
  - Page type auto-set from template
- `src/api/content.ts` — Add `contentTemplates` API client

#### How templates modify the AI prompt

When a template is selected during brief generation, the existing `generateBrief()` prompt gets an additional block:

```
TEMPLATE CONSTRAINT: This content MUST follow the exact section structure below.
Do NOT add, remove, or reorder sections. Use the provided headings exactly as specified.

Sections:
1. H2: "What is {service}?" (150-200 words) — Explain the service clearly...
2. H2: "Why Choose Us for {service} in {city}" (100-150 words) — Benefits...
3. H2: "Our {service} Process" (150-200 words) — Step-by-step...
4. H2: "{service} FAQ in {city}" (200-250 words) — 4-5 questions...
5. H2: "Get Started with {service} in {city}" (80-100 words) — CTA...

Variables for this page:
- {city} = "Austin"
- {service} = "Roofing"
```

The brief's `outline` field is then pre-populated from the template sections (with variables replaced), and the AI fills in the detailed notes, keywords, and guidance per section.

---

### Feature 2: Keyword Pre-Assignment

#### What it is
Before generating any content, research and **lock in** the primary + secondary keywords for each planned page. This ensures every page targets a distinct, validated keyword rather than letting AI pick one.

#### Data Model

```typescript
// Extend ContentBrief to track keyword assignment source
interface ContentBrief {
  // ... existing fields ...
  keywordLocked?: boolean;              // Was keyword pre-assigned (not AI-chosen)?
  keywordSource?: 'manual' | 'semrush' | 'gsc' | 'matrix'; // How was it assigned?
  keywordValidation?: {
    volume: number;
    difficulty: number;
    cpc: number;
    validatedAt: string;
  };
}
```

This is lightweight — just add 3 columns to `content_briefs`:
```sql
-- In migration 014
ALTER TABLE content_briefs ADD COLUMN keyword_locked INTEGER DEFAULT 0;
ALTER TABLE content_briefs ADD COLUMN keyword_source TEXT;
ALTER TABLE content_briefs ADD COLUMN keyword_validation TEXT; -- JSON
```

#### Backend

Modify:
- `server/content-brief.ts` — When `keywordLocked: true`, the prompt emphasizes: "The primary keyword is PRE-ASSIGNED. Do NOT change it. Build the entire brief around this exact keyword."
- `server/routes/content-briefs.ts` — New endpoint:
  ```
  POST /api/content-briefs/:workspaceId/validate-keywords
  Body: { keywords: string[] }
  Response: { results: { keyword, volume, difficulty, cpc, competition }[] }
  ```
  Uses SEMRush `getKeywordOverview()` to validate a batch of keywords.

#### Frontend

Modify:
- `src/components/ContentBriefs.tsx` — Brief generation form shows a "Pre-assign keyword" toggle. When on:
  - Shows SEMRush validation: volume, KD%, CPC displayed inline
  - Green checkmark if keyword looks viable, amber warning if KD > 70 or volume < 50
  - User can still generate the brief — but the keyword won't be changed by AI

**Incremental upgrade:** When generating from a content matrix (Phase 2), keywords are auto-assigned per cell with validation.

---

## Phase 2: Scale

### Feature 3: Content Matrix

> **Note:** The matrix depends on Feature 4 (Smart Keyword Recommendations) for keyword optimization during the "Validate & Optimize Keywords" step.


#### What it is
Define variable dimensions (cities × services) and auto-generate a grid of planned pages. Each cell becomes a content brief with a pre-assigned keyword and template.

#### Data Model

```typescript
// shared/types/content.ts (additions)

interface ContentMatrix {
  id: string;
  workspaceId: string;
  name: string;                     // "Austin/Dallas/Houston Service Pages"
  templateId: string;               // Which template to use
  
  // Dimensions
  dimensions: MatrixDimension[];    // [{name: 'city', values: ['Austin','Dallas','Houston']}, {name: 'service', values: ['Roofing','Plumbing',...]}]
  
  // URL pattern
  urlPattern: string;               // "/services/{city}/{service}" — uses variable names
  
  // Keyword pattern (auto-generates target keywords)
  keywordPattern: string;           // "{service} {city}" → "roofing austin"
  
  // Generated cells (populated after creation)
  cells: MatrixCell[];
  
  // Progress tracking
  stats: {
    total: number;
    planned: number;
    briefGenerated: number;
    drafted: number;
    reviewed: number;
    published: number;
  };
  
  createdAt: string;
  updatedAt: string;
}

interface MatrixDimension {
  name: string;        // Must match a TemplateVariable name
  values: string[];    // The actual values: ['Austin', 'Dallas', 'Houston']
}

interface MatrixCell {
  id: string;                    // Unique cell ID
  variableValues: Record<string, string>; // { city: 'Austin', service: 'Roofing' }
  targetKeyword: string;         // Auto-generated from keywordPattern
  customKeyword?: string;        // Manual override
  plannedUrl: string;            // Generated from urlPattern
  
  // Linked content items
  briefId?: string;
  postId?: string;
  
  // Status
  status: 'planned' | 'keyword_validated' | 'brief_generated' | 'draft' | 'review' | 'approved' | 'published';
  
  // Keyword validation + recommendation
  keywordValidation?: {
    volume: number;
    difficulty: number;
    cpc: number;
    validatedAt: string;
  };
  
  // Smart keyword recommendation (from Feature 4)
  keywordCandidates?: KeywordCandidate[];  // All evaluated variants
  recommendedKeyword?: string;             // Best variant suggested by system
}

interface KeywordCandidate {
  keyword: string;
  volume: number;
  difficulty: number;
  cpc: number;
  source: 'pattern' | 'semrush_related' | 'ai_suggested';  // How it was discovered
  isRecommended: boolean;  // System pick
}

interface MatrixDimension {
  name: string;
  values: string[];
}
```

#### Database

```sql
-- In migration 014
CREATE TABLE IF NOT EXISTS content_matrices (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  template_id TEXT NOT NULL,
  dimensions TEXT NOT NULL DEFAULT '[]',
  url_pattern TEXT NOT NULL DEFAULT '',
  keyword_pattern TEXT NOT NULL DEFAULT '',
  cells TEXT NOT NULL DEFAULT '[]',       -- JSON array of MatrixCell
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (template_id) REFERENCES content_templates(id)
);
CREATE INDEX IF NOT EXISTS idx_content_matrices_workspace ON content_matrices(workspace_id);
```

#### Backend

New files:
- `server/content-matrices.ts` — CRUD + matrix operations:
  - `createMatrix()` — Creates matrix, auto-generates cells from dimension cross-product
  - `validateMatrixKeywords()` — Batch SEMRush lookup for all cell keywords
  - `generateMatrixBriefs()` — Batch-create briefs for selected cells (uses template + locked keywords)
  - `getMatrixStats()` — Aggregate status counts
- `server/routes/content-matrices.ts` — REST endpoints

API endpoints:
```
GET    /api/content-matrices/:workspaceId              — list matrices
GET    /api/content-matrices/:workspaceId/:id           — get one (with cells)
POST   /api/content-matrices/:workspaceId              — create matrix
PATCH  /api/content-matrices/:workspaceId/:id           — update
DELETE /api/content-matrices/:workspaceId/:id           — delete
POST   /api/content-matrices/:workspaceId/:id/optimize-keywords  — batch validate + recommend best variants
POST   /api/content-matrices/:workspaceId/:id/generate-briefs    — batch generate briefs
PATCH  /api/content-matrices/:workspaceId/:id/cells/:cellId      — update single cell
GET    /api/content-matrices/:workspaceId/:id/export-csv         — download CSV for Webflow CMS import
```

#### Frontend

New files:
- `src/components/matrix/MatrixBuilder.tsx` — Create/edit matrix:
  - Dimension editor (add/remove values with tag-style inputs)
  - URL pattern builder with live preview
  - Keyword pattern builder with live preview
  - "Generate Matrix" button
- `src/components/matrix/MatrixGrid.tsx` — The main grid view:
  - Rows = dimension 1 (e.g., services), Columns = dimension 2 (e.g., cities)
  - Each cell shows: status badge, keyword, volume/KD if validated
  - Color-coded by status (gray=planned, blue=brief, amber=draft, green=published)
  - Bulk actions: "Optimize Keywords", "Generate Briefs for Selected", "Export CSV"
  - Click cell → expand to show brief preview, link to post editor
- `src/components/matrix/MatrixProgress.tsx` — Progress dashboard:
  - Overall completion percentage
  - Status breakdown (planned/brief/draft/review/published)
  - Per-dimension breakdowns

Modify:
- `src/components/ContentPipeline.tsx` — Add "Planner" tab (Phase 2)
- `src/api/content.ts` — Add `contentMatrices` API client

#### Batch Brief Generation Flow

When user clicks "Generate Briefs" for selected cells:
1. Frontend sends cell IDs to `POST /api/content-matrices/:id/generate-briefs`
2. Backend creates a job (`createJob()`) for progress tracking
3. For each cell (sequentially to respect API rate limits):
   a. Load the template
   b. Replace variables: `{city}` → "Austin", `{service}` → "Roofing"
   c. Call `generateBrief()` with `templateId` + `keywordLocked: true` + variable values
   d. Store brief ID in the cell
   e. Update job progress
4. Frontend polls job status, updates matrix grid in real-time via WebSocket

---

### Feature 4: Smart Keyword Recommendations

#### What it is
Instead of blindly using the keyword pattern output (e.g., "preventative dentistry houston"), the system generates multiple keyword candidates per cell, validates them all via SEMRush, and recommends the best one.

#### How it works

For each matrix cell, given variables `{service}` = "Preventative Dentistry", `{city}` = "Houston":

**Step 1: Generate candidates** from multiple sources:

| Source | Example candidates |
|--------|-------------------|
| **Pattern variations** | "preventative dentistry houston", "houston preventative dentistry", "preventative dentistry houston tx" |
| **SEMRush related keywords** | Query SEMRush for the pattern keyword → get related: "preventive dentistry houston", "preventative dental care houston", "preventive dentist near me houston" |
| **AI-suggested variants** | Ask GPT-4.1-mini: "Given the service 'Preventative Dentistry' in 'Houston', what are 5 keyword variations a local searcher might use?" |

**Step 2: Batch validate** all candidates via SEMRush `getKeywordOverview()`:

| Candidate | Volume | KD% | CPC |
|-----------|:------:|:---:|:---:|
| preventative dentistry houston | 110 | 35 | $4.20 |
| preventive dentistry houston | 320 | 28 | $3.80 |
| preventive dentist houston tx | 210 | 22 | $5.10 |
| houston preventative dental care | 40 | 18 | $2.90 |

**Step 3: Score and recommend** using a weighted formula:
```
score = (volume × 0.5) + ((100 - difficulty) × 0.3) + (cpc × 20 × 0.2)
```
Highest score wins. In this example: **"preventive dentistry houston"** (320 vol, 28 KD) beats the original.

**Step 4: Show comparison in UI** — user sees all candidates ranked, with the recommendation highlighted. They can accept or override.

#### Backend

Modify `server/content-matrices.ts`:
- `optimizeMatrixKeywords(matrixId)` — for each cell:
  1. Generate pattern variations (word reorder, add "tx"/state, add "near me")
  2. Call SEMRush `getRelatedKeywords()` for the base keyword
  3. Call GPT-4.1-mini for AI variants (batch: send all cells in one prompt to minimize calls)
  4. Deduplicate all candidates
  5. Batch validate via `getKeywordOverview()` (SEMRush supports up to 100 keywords per call)
  6. Score, rank, store candidates + recommendation on each cell

New endpoint:
```
POST /api/content-matrices/:workspaceId/:id/optimize-keywords
Response: { cells: [{ cellId, candidates: KeywordCandidate[], recommended: string }] }
```

#### Frontend

- **MatrixGrid.tsx** — After optimization, each cell shows:
  - The recommended keyword (with volume/KD badge)
  - A small "↕" icon to view all candidates and pick a different one
  - Green highlight if recommendation accepted, amber if user overrode it
- **Keyword Picker modal** — Shows full candidate comparison table, click to select

---

### Feature 5: Cannibalization Detection

#### What it is
Analyzes all keyword assignments across a workspace to flag potential conflicts where two pages target overlapping search intents.

#### Backend

New file:
- `server/cannibalization.ts`:
  ```typescript
  interface CannibalizationWarning {
    pageA: { url: string; keyword: string; briefId?: string };
    pageB: { url: string; keyword: string; briefId?: string };
    overlapType: 'exact_match' | 'semantic_overlap' | 'intent_conflict';
    severity: 'high' | 'medium' | 'low';
    suggestion: string;  // AI-generated recommendation
  }
  
  function detectCannibalization(workspaceId: string): CannibalizationWarning[]
  ```
  
  Detection logic:
  1. **Exact match** — Two pages targeting the same primary keyword (high severity)
  2. **Semantic overlap** — Primary keyword of page A is a secondary of page B (medium)
  3. **Intent conflict** — AI check: send all keyword assignments to GPT-4.1-mini and ask "which of these pages might compete for the same search query?" (low-medium)

- `server/routes/content-matrices.ts` — Add endpoint:
  ```
  GET /api/content-matrices/:workspaceId/:id/cannibalization  — run detection
  ```

#### Frontend

- **MatrixGrid.tsx** — Show warning icons on cells with cannibalization issues
- **Cannibalization panel** — Expandable section showing all warnings with suggestions
  - "These pages may compete: [Roofing Austin] vs [Roof Repair Austin] — Consider merging or differentiating intent"

---

## Phase 3: Output

### Feature 6: CSV Export

#### What it is
Download a CSV file where each row = one page and each column = one Webflow CMS field. This CSV can be directly imported into Webflow's CMS collection, enabling rapid page building.

#### Why CSV instead of Webflow API push
- The pages don't exist yet — they need to be **designed and built** in Webflow first
- A CSV gives you a portable artifact you can review, edit in Google Sheets, share with collaborators
- Webflow's native CSV import handles collection item creation, field mapping, and rich text
- You can re-export and re-import as content gets revised

#### How the template's CMS field map drives columns

Templates define a `cmsFieldMap` mapping section names to CMS field slugs:
```json
{
  "hero_heading": "name",
  "hero_body": "hero-body-text",
  "what_is": "service-description",
  "why_us": "why-choose-us",
  "process": "our-process",
  "faq": "faq-richtext",
  "cta": "cta-text",
  "city_name": "city-name",
  "service_name": "service-name"
}
```

The export produces:

| slug | name | city-name | service-name | hero-body-text | service-description | why-choose-us | our-process | faq-richtext | cta-text | seo-title | meta-description |
|------|------|-----------|-------------|----------------|--------------------|--------------|-----------|-----------|---------|-----------|-----------------|
| /services/houston/preventive-dentistry | Preventive Dentistry in Houston | Houston | Preventive Dentistry | ... | ... | ... | ... | ... | ... | ... | ... |

Rich text fields contain HTML (Webflow's CSV import supports this).

#### Backend

New function in `server/content-matrices.ts`:
- `exportMatrixCsv(matrixId)` — for each cell with a generated post:
  1. Load the post and its sections
  2. Map each section to the CMS field slug via the template's `cmsFieldMap`
  3. Add variable values as plain-text columns (city, service)
  4. Add SEO fields (seo_title, meta_description, slug)
  5. Return CSV string

Endpoint (already listed in Feature 3):
```
GET /api/content-matrices/:workspaceId/:matrixId/export-csv
Headers: Content-Type: text/csv, Content-Disposition: attachment; filename="matrix-export.csv"
```

#### Frontend

- **MatrixGrid.tsx** — "Export" dropdown in the toolbar with options:
  - **Export CSV** — for Webflow CMS import
  - **Export Word Docs** — for client/stakeholder review in Google Drive
- Shows a pre-export summary: "42 of 54 pages have content. Export will include all pages with generated posts."
- Option to include only approved posts or all posts with content

---

### Feature 6b: Bulk Word Doc Export

#### What it is
Download all generated content as Word documents (.docx) for sharing with stakeholders who don't have platform access. Clients can upload to Google Drive, comment in Google Docs, and share with their team — no login required.

#### Export formats

**Option A: One doc per page** (zipped)
```
matrix-export/
  preventive-dentistry-houston.docx
  root-canal-houston.docx
  teeth-whitening-houston.docx
  ...
```
Each .docx contains the full post content with:
- Title (H1) + meta description at the top
- Target keyword + secondary keywords
- All sections with proper heading hierarchy (H2, H3)
- Branded header/footer with HMPSN Studio logo
- "Page X of Y in [Matrix Name]" footer

**Option B: Single combined doc** (all pages in one file)
```
Houston Area Service Pages — Content Review.docx
  Table of Contents
  Page 1: Preventive Dentistry in Houston ─────────── p.2
  Page 2: Root Canal Treatment in Houston ──────────── p.5
  ...
```
Each page starts on a new page break. Includes a cover page with matrix summary (total pages, status breakdown, keyword list) and a table of contents.

**Both options available** — admin chooses from the Export dropdown.

#### Backend

New dependency: `docx` npm package (pure JS, no native deps — generates .docx files programmatically).

New file: `server/content-export-docx.ts`:
```typescript
import { Document, Packer, Paragraph, HeadingLevel, PageBreak, Header, Footer, TextRun } from 'docx';

// Single page → docx buffer
export function renderPageDocx(post: GeneratedPost, brief: ContentBrief, variables: Record<string, string>): Buffer

// All pages → single combined docx buffer
export function renderMatrixDocx(matrix: ContentMatrix, posts: GeneratedPost[], briefs: ContentBrief[]): Buffer

// All pages → zip of individual docx files
export function renderMatrixDocxZip(matrix: ContentMatrix, posts: GeneratedPost[], briefs: ContentBrief[]): Buffer
```

New endpoints:
```
GET /api/content-matrices/:workspaceId/:matrixId/export-docx
  ?format=combined  → single .docx file (default)
  ?format=zip       → .zip of individual .docx files
  ?status=approved  → only approved pages (default: all with content)
```

#### Doc structure (per page)

```
┌─────────────────────────────────────────────┐
│  HMPSN Studio · Content Delivery            │  ← branded header
├─────────────────────────────────────────────┤
│                                             │
│  Preventive Dentistry in Houston            │  ← H1 (from post title)
│  ─────────────────────────────              │
│  Target Keyword: preventive dentistry       │
│  houston · 320/mo · KD 28                   │
│  URL: /services/houston/preventive-dentistry│
│                                             │
│  Meta Title: Preventive Dentistry Houston   │
│  | [Practice Name]                          │
│  Meta Description: Expert preventive dental │
│  care in Houston. Regular cleanings...      │
│                                             │
│  ─── Content ───                            │
│                                             │
│  What Is Preventive Dentistry?              │  ← H2
│  [section content...]                       │
│                                             │
│  Why Choose [Practice] for Preventive Care  │  ← H2
│  [section content...]                       │
│                                             │
│  ...                                        │
│                                             │
├─────────────────────────────────────────────┤
│  Page 1 of 54 · Houston Area Service Pages  │  ← footer
└─────────────────────────────────────────────┘
```

#### Use cases
- **Client review** — Upload to Google Drive, client comments inline in Google Docs
- **Team collaboration** — Share with copywriters, subject-matter experts who need to review/edit without platform access
- **Stakeholder sign-off** — Print-friendly format for executive review
- **Archive** — Offline record of all delivered content

#### Additional export options (incremental)
- **Google Sheets export** — same CSV data, pushed to a new Google Sheet via API (future)
- **Per-section CSV** — one CSV per template section, for bulk-updating a single CMS field (future)
- **Google Docs export** — push directly to Google Drive via API instead of downloading .docx (future, requires Google Drive OAuth)

---

### Feature 7: Site Architecture Planner

#### What it is
A visual planning layer showing the URL hierarchy, page relationships, and internal linking strategy before any content is written.

#### Data Model

This is primarily a **view** built from existing data:
- Matrix cells provide URLs and their hierarchy
- Template provides page type
- Keyword map provides link targets

#### Frontend

New file:
- `src/components/matrix/SiteArchitecture.tsx`:
  - **Tree view** — URL hierarchy as an expandable tree (`/services/` → `/services/austin/` → `/services/austin/roofing/`)
  - **Internal link matrix** — Grid showing which pages should link to which (auto-suggested based on template + keyword overlap)
  - **Hub-and-spoke visualization** — City hub pages linking down to service pages
  - Page type color coding

This is primarily a visualization feature — no new backend needed. It reads from the content matrix cells and renders the hierarchy.

---

## Context Integration — What the AI Sees

Template-driven briefs call the **same `generateBrief()` function** with an additional template constraint block. All existing context sources flow through automatically:

| Context Source | How It's Injected | Already Wired? |
|---|---|:---:|
| **Brand Voice** | `buildSeoContext()` → `brandVoiceBlock` | ✅ |
| **Business Context** | `context.businessContext` or strategy fallback | ✅ |
| **Knowledge Base** (brand-docs/) | `buildKnowledgeBase()` | ✅ |
| **Audience Personas** | `buildPersonasContext()` | ✅ |
| **Keyword Strategy** (site keywords, page assignments) | `buildSeoContext()` → `keywordBlock` | ✅ |
| **Full Keyword Map** (anti-cannibalization) | `buildKeywordMapContext()` | ✅ |
| **SEMRush Metrics** (volume, KD, CPC, trend) | Direct injection | ✅ |
| **SEMRush Related Keywords** (up to 15) | Direct injection | ✅ |
| **GSC Related Queries** (top 20 with CTR) | `context.relatedQueries` | ✅ |
| **GA4 Page Performance** (sessions, bounce, engagement) | `context.ga4PagePerformance` | ✅ |
| **Real SERP Data** (PAA + organic results) | `buildSerpContext()` | ✅ |
| **Reference URLs** (scraped competitor pages) | `buildReferenceContext()` | ✅ |
| **Style Examples** (top-performing site pages) | `buildStyleExampleContext()` | ✅ |
| **Page Type Config** (10 types with prompts) | `PAGE_TYPE_CONFIGS` | ✅ |
| **Existing Site Pages** (for internal links) | `context.existingPages` | ✅ |
| **Rewrite Playbook** | `ws.rewritePlaybook` | ✅ (for post gen) |

**What the template layer adds on top:**
- Enforced section structure (headings, order, word counts per section)
- Variable substitution in heading templates
- Template-level tone/style override (can supplement or replace workspace brand voice)
- CMS field mapping (for CSV export)

---

## Incremental Upgrades to Consider

### 1. Template Library (during Phase 1)
Pre-built templates for common page types:
- Location Service Page (the immediate use case)
- City Landing Page (hub page for a city)
- Service Pillar Page (comprehensive service overview)
- FAQ Page
- Comparison Page ("Service A vs Service B in City")

Store these as workspace-level templates that can be duplicated/modified.

### 2. Cross-Page Intelligence (during Phase 2)
When generating the 10th brief in a 54-page matrix, the AI should know about the other 9:
- **Sibling awareness** — "Here are 3 completed pages from this matrix for tone/quality reference"
- **Internal link to planned pages** — the brief can suggest links to OTHER matrix pages even if they aren't written yet (since we know the planned URLs)
- **Terminology consistency** — feed a glossary of terms used in previous pages so the AI doesn't call it "preventive" on one page and "preventative" on another

### 3. Content Diff View (during Phase 2)
When multiple pages use the same template, show a diff view:
- "Austin Roofing" vs "Dallas Roofing" — highlight what's unique vs duplicated
- Flag if two pages are too similar (thin content / duplicate content risk)

### 4. Batch Cost Estimate (during Phase 2)
Before generating 54 briefs + 54 posts, show an estimated AI cost:
- "Generating 54 briefs will use ~270K tokens (~$0.80). Generating 54 full posts will use ~1.6M tokens (~$12). Total estimated cost: ~$13."
- Uses the `logTokenUsage()` tracking data from previous generations to estimate per-brief/per-post costs

### 5. Progress Dashboard (during Phase 2)
A workspace-level content progress view:
- % completion across all matrices
- Estimated time to complete (based on generation speed)
- Bottleneck detection ("12 posts in review, 0 approved — review needed")

### 6. Template-Level Tone Override (during Phase 1)
Templates can optionally override the workspace brand voice:
- A workspace's brand voice might be "professional and authoritative"
- But a specific FAQ template might need "conversational and approachable"
- The template's `toneAndStyle` field takes precedence when set, otherwise falls back to workspace brand voice

### 7. Template Versioning (nice-to-have)
When you update a template, existing briefs/posts keep the old version. New generations use the updated template. Useful if you refine the template structure mid-project.

---

## UI/UX Integration

### Navigation Changes

**ContentPipeline.tsx** tabs evolve:

```
Current:   [Briefs] [Posts] [Subscriptions]
Phase 1:   [Briefs] [Posts] [Templates] [Subscriptions]
Phase 2:   [Planner] [Briefs] [Posts] [Templates] [Subscriptions]
```

The **Planner** tab becomes the entry point for site build projects:
1. Create a template (or pick from library)
2. Create a matrix using that template
3. Optimize keywords (Smart Keyword Recommendations)
4. Generate briefs in batch
5. Send to client for review (tiered review flow)
6. Generate posts from approved briefs
7. Export CSV for Webflow import

**Briefs** and **Posts** tabs continue to work for one-off content — the planner is additive.

### Admin Workflow (Planner Tab)

The admin's workflow through the Planner tab follows a clear pipeline:

```
┌─────────────┐   ┌──────────────┐   ┌─────────────────┐   ┌──────────────┐
│  Templates  │ → │ Build Matrix │ → │ Optimize KWs    │ → │ Generate     │
│  (create/   │   │ (dimensions, │   │ (SEMRush + AI   │   │ Briefs       │
│   pick)     │   │  URL pattern)│   │  recommendations)│   │ (batch)      │
└─────────────┘   └──────────────┘   └─────────────────┘   └──────┬───────┘
                                                                   │
┌─────────────┐   ┌──────────────┐   ┌─────────────────┐          │
│  Export CSV │ ← │ Generate     │ ← │ Client Review   │ ←────────┘
│  (Webflow   │   │ Posts        │   │ (tiered: template│
│   import)   │   │ (batch)      │   │  → sample → bulk)│
└─────────────┘   └──────────────┘   └─────────────────┘
```

The Planner tab shows:
- **Active matrices** at the top (cards with progress bars + status breakdown)
- **Matrix detail view** when you click in (the grid)
- **Action toolbar** with context-sensitive buttons based on matrix status

### Matrix Grid UX

The matrix grid is the centerpiece. Think of it like a spreadsheet:

```
                  Austin        Dallas        Houston
Roofing          [✓ Published] [◐ Draft]     [○ Planned]
Plumbing         [◐ Draft]     [◑ Brief]     [○ Planned]
HVAC             [◑ Brief]     [○ Planned]   [○ Planned]
Electrical       [○ Planned]   [○ Planned]   [○ Planned]
```

- Click a cell → slide-out panel with full details
- Multi-select cells → bulk actions (optimize, generate, send for review, export)
- Filter by status, city, service
- Sort by keyword difficulty, volume, completion status

### Template Editor UX

Visual section builder — similar to a form builder:
- Drag sections to reorder
- Click section to expand → edit heading template, guidance, word count
- Variable pills shown in heading templates (color-coded: `{city}` blue, `{service}` green)
- Live preview panel shows what a sample page would look like

---

### Client Review Flow — Tiered Review for Scale

The current client Content tab works for one-off briefs but breaks down at 54+ pages. Nobody wants to individually review 54 briefs that all follow the same template. The solution is **tiered review** — approve the approach once, spot-check a few pages, then batch-approve the rest.

#### Layer 1: Template Approval (review once)

Before generating any content, the admin sends the **template** for client review:

**What the client sees:**
```
┌─────────────────────────────────────────────────────────┐
│ 📋 Content Plan: Houston Area Service Pages             │
│                                                         │
│ Your team is planning 54 service pages across           │
│ 3 cities × 18 dental services.                          │
│                                                         │
│ ┌─────────────────────────────────────────────┐         │
│ │ Page Structure (every page will follow):    │         │
│ │                                             │         │
│ │  H1: {Service} in {City} — [practice name] │         │
│ │  § Hero intro (150 words)                   │         │
│ │  § What Is {Service}? (200 words)           │         │
│ │  § Why Choose Us for {Service} (200 words)  │         │
│ │  § Our {Service} Process (200 words)        │         │
│ │  § FAQ (150 words, 4-5 questions)           │         │
│ │  § Book Your {Service} Appointment (100 words)│       │
│ │                                             │         │
│ │  Total: ~1,000 words per page               │         │
│ └─────────────────────────────────────────────┘         │
│                                                         │
│ Keyword Targets (sample):                               │
│  • Preventive Dentistry Houston — 320/mo, KD 28        │
│  • Root Canal Dallas — 590/mo, KD 35                   │
│  • Teeth Whitening Austin — 880/mo, KD 22              │
│  [View all 54 keywords →]                              │
│                                                         │
│ [✓ Approve Plan]  [✎ Request Changes]  [✕ Decline]     │
└─────────────────────────────────────────────────────────┘
```

**Implementation:** This uses the existing **approval batch** system. The admin clicks "Send Plan to Client" in the Planner tab, which creates an approval batch containing:
- The template structure (sections, word counts)
- The full keyword list with metrics
- The URL structure
- A plain-English summary of the scope

The client sees this as a new item in their **Approvals** tab (or Content tab, depending on where we surface it). They approve/request changes on the plan as a whole.

#### Layer 2: Sample Review (review 2-3 pages)

After the plan is approved and briefs are generated, the admin selects 2-3 representative pages and sends them for review:

**What the client sees:**
```
┌─────────────────────────────────────────────────────────┐
│ 📄 Sample Pages Ready for Review (3 of 54)             │
│                                                         │
│ We've generated 3 sample pages for your review.         │
│ If the quality and approach look good, we'll            │
│ proceed with the remaining 51 pages.                    │
│                                                         │
│ ┌──────────────────────────────────────────────┐        │
│ │ ▶ Preventive Dentistry in Houston            │        │
│ │   KW: "preventive dentistry houston" · 320/mo│        │
│ │   [Expand to see full brief]                 │        │
│ └──────────────────────────────────────────────┘        │
│ ┌──────────────────────────────────────────────┐        │
│ │ ▶ Root Canal Treatment in Dallas             │        │
│ │   KW: "root canal dallas" · 590/mo           │        │
│ │   [Expand to see full brief]                 │        │
│ └──────────────────────────────────────────────┘        │
│ ┌──────────────────────────────────────────────┐        │
│ │ ▶ Teeth Whitening in Austin                  │        │
│ │   KW: "teeth whitening austin" · 880/mo      │        │
│ │   [Expand to see full brief]                 │        │
│ └──────────────────────────────────────────────┘        │
│                                                         │
│ [✓ Approve Samples — Proceed with All 54]               │
│ [✎ Request Changes to Approach]                         │
└─────────────────────────────────────────────────────────┘
```

**Implementation:** The admin multi-selects 2-3 cells in the matrix grid and clicks "Send Samples to Client". This creates content requests with `status: 'client_review'` for just those pages. The client reviews them in the existing Content tab expand-and-approve flow.

The key addition: a **"Approve Samples — Proceed with All"** button that batch-approves the remaining pages in the matrix.

#### Layer 3: Full Matrix View (optional spot-checking)

After samples are approved, the client gets a read-only version of the matrix grid in their portal:

**What the client sees:**
```
┌─────────────────────────────────────────────────────────┐
│ 📊 Content Progress: Houston Area Service Pages         │
│                                                         │
│ ██████████████████░░░░░░░░░░░░░  18 of 54 complete     │
│                                                         │
│               Austin      Dallas      Houston           │
│ Preventive   ✓ Approved   ◐ Draft    ○ In Progress     │
│ Root Canal   ◐ Draft      ✓ Approved  ○ Planned        │
│ Whitening    ✓ Approved   ○ Planned   ◐ Draft          │
│ Crowns       ○ Planned    ○ Planned   ○ Planned        │
│ ...                                                     │
│                                                         │
│ Click any cell to preview the content.                  │
│ Flag any page that needs changes.                       │
│                                                         │
│ [🚩 Flag for Changes]  [📥 Download Word Doc]  [📥 PDF] │
└─────────────────────────────────────────────────────────┘
```

**Implementation:** New component in `src/components/client/` — a simplified, read-only matrix grid. Client can:
- See overall progress at a glance
- Click any cell to preview the brief/post
- Flag individual cells that need changes (creates a comment thread)
- **Download all content as a Word doc** — single combined .docx for easy upload to Google Drive, where other stakeholders can comment inline without platform access
- Download all approved content as a bundled PDF

This gives the client visibility without requiring them to approve every page individually.

#### Layer 4: Exception Flagging

At any point, the client can flag individual pages for changes:
- Click a cell in the matrix view → "Flag for Changes" button
- Opens a comment form: "The FAQ section for 'Teeth Whitening Houston' should mention our Zoom whitening service specifically"
- This creates a `changes_requested` status on just that cell — doesn't block the rest of the matrix
- Admin sees flagged cells highlighted in amber on their matrix grid

#### Summary: Client Review Touchpoints

| Review Layer | When | Client Effort | What They Review |
|---|---|---|---|
| **Template Approval** | Before any generation | 5 minutes | Page structure, keywords, scope |
| **Sample Review** | After 2-3 briefs generated | 15-20 minutes | 2-3 representative pages in detail |
| **Batch Approve** | After samples approved | 1 click | "Proceed with all 54" |
| **Spot-Check** (optional) | Ongoing | As needed | Any individual page via matrix view |
| **Exception Flag** | Ongoing | Per-page | Flag specific pages for changes |

Total client review time for 54 pages: **~30 minutes** instead of ~5 hours reviewing each page individually.

#### Client Portal Changes Required

| Component | Change |
|---|---|
| `ContentTab.tsx` | Add "Content Plan" review section for template approval batches |
| New: `MatrixProgressView.tsx` | Read-only matrix grid for client portal (simplified version of admin's MatrixGrid) |
| `ApprovalsTab.tsx` | Handle template approval batches (new batch type: `content_plan`) |
| `ContentTab.tsx` | Add "Approve Samples — Proceed with All" batch action |
| New: `client/ContentPlanReview.tsx` | Dedicated review view combining plan summary + sample briefs + matrix progress |

---

## Build Order & Dependencies

```
Phase 1 (Foundation):
  1a. Content Templates (DB + backend + frontend)     ← START HERE
  1b. Keyword Pre-Assignment (brief modifications)     ← builds on template flow
  
Phase 2 (Scale):
  2a. Content Matrix (DB + backend + grid UI)          ← depends on templates
  2b. Smart Keyword Recommendations (SEMRush + AI)     ← integrated into matrix flow
  2c. Cannibalization Detection (analysis engine)      ← depends on matrix cells + keywords
  2d. Progress Dashboard (view layer)                  ← depends on matrix
  
Phase 3 (Output):
  3a. CSV Export (template field map → columns)        ← depends on matrix + template CMS field map
  3b. Site Architecture Planner (visualization)        ← depends on matrix cells
```

### File Changes Summary

**New files:**
| File | Purpose |
|------|---------|
| `server/db/migrations/014-content-planner.sql` | Tables: content_templates, content_matrices |
| `server/content-templates.ts` | Template CRUD + variable substitution |
| `server/content-matrices.ts` | Matrix CRUD + batch operations |
| `server/cannibalization.ts` | Keyword overlap detection |
| `server/routes/content-templates.ts` | Template REST endpoints |
| `server/routes/content-matrices.ts` | Matrix REST endpoints |
| `src/components/templates/TemplateEditor.tsx` | Template builder UI |
| `src/components/templates/TemplateList.tsx` | Template list/cards |
| `src/components/matrix/MatrixBuilder.tsx` | Matrix creation wizard |
| `src/components/matrix/MatrixGrid.tsx` | Main grid view |
| `src/components/matrix/MatrixProgress.tsx` | Progress dashboard |
| `src/components/matrix/SiteArchitecture.tsx` | URL hierarchy + link planning |
| `src/api/contentPlanner.ts` | API client for templates + matrices |

**Modified files:**
| File | Changes |
|------|---------|
| `shared/types/content.ts` | Add ContentTemplate, ContentMatrix, MatrixCell types |
| `server/content-brief.ts` | Template-aware brief generation |
| `server/content-posts-ai.ts` | Template section guidance in post generation |
| `server/routes/content-briefs.ts` | Keyword validation endpoint |
| `server/routes/content-publish.ts` | Batch publish from matrix |
| `server/app.ts` | Register new route modules |
| `src/components/ContentPipeline.tsx` | Add Templates + Planner tabs |
| `src/components/ContentBriefs.tsx` | Template selector in brief form |
| `src/api/content.ts` | Template + matrix API methods |

---

## Estimated Effort

| Phase | Feature | Effort |
|-------|---------|--------|
| 1a | Content Templates (full CRUD + UI) | ~3 sessions |
| 1b | Keyword Pre-Assignment | ~1 session |
| 2a | Content Matrix (core) | ~3 sessions |
| 2b | Smart Keyword Recommendations | ~1-2 sessions |
| 2c | Cannibalization Detection | ~1 session |
| 2d | Progress Dashboard | ~1 session |
| 3a | CSV Export | ~1 session |
| 3b | Site Architecture Planner | ~1 session |
| — | **Total** | **~12-13 sessions** |

Phase 1 alone (Templates + Keyword Pre-Assignment) delivers the core value: you can define a page structure once and generate consistent, keyword-targeted content at scale.

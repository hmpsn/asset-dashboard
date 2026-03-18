# Content Planner — Devin UI Handoff

> This document defines the UI components Devin should build for the Content Planner feature.
> Cascade is building the backend, DB migrations, and API routes in parallel.
> **Work on a separate branch: `devin/content-planner-ui`** (Cascade works on `cascade/content-planner-backend`).

---

## Branch Strategy — How We Avoid Conflicts

```
main
 ├── cascade/content-planner-backend   ← Cascade's branch (backend + DB + routes)
 └── devin/content-planner-ui          ← Devin's branch (UI components only)
```

**Rules:**
1. Devin creates NEW files only — do NOT modify existing files
2. All new components go in `src/components/matrix/` (new directory)
3. Cascade will handle all modifications to existing files (ContentPipeline.tsx, routes, App.tsx, etc.)
4. When both branches are ready, Cascade merges backend first, then Devin's UI branch on top
5. Cascade handles the final wiring (importing Devin's components into the existing app)

---

## Design System Reference

Before building any UI, read these files:
- `BRAND_DESIGN_LANGUAGE.md` — colors, typography, spacing, component patterns
- `src/components/ui/index.ts` — shared UI primitives (Badge, StatCard, SectionCard, TabBar, EmptyState, etc.)

### Key design tokens (dark theme)
- **Background:** `bg-[#0f1219]` (page), `bg-zinc-900` (cards), `bg-zinc-950` (inputs/nested)
- **Borders:** `border-zinc-800`
- **Text:** `text-zinc-200` (primary), `text-zinc-400` (secondary), `text-zinc-500` (muted)
- **Accent:** `text-teal-400`, `bg-teal-500/10`, `border-teal-500/20`
- **Status colors:** teal=success/active, amber=warning/pending, red=error, blue=info
- **Font:** D-DIN Pro (loaded via @font-face, use `font-sans`)
- **Radius:** `rounded-xl` for cards, `rounded-lg` for buttons/inputs
- **Max width:** `max-w-6xl mx-auto px-6` for page-level containers

### Shared UI primitives to use
```tsx
import { Badge, StatCard, SectionCard, TabBar, EmptyState, Skeleton, PageHeader } from '../ui';
```

---

## Component 1: Template Editor

**File:** `src/components/matrix/TemplateEditor.tsx`

### What it does
Visual editor for creating and editing Content Templates. A template defines the reusable page structure (sections, variable patterns, CMS field mapping) that a content matrix will use.

### Props interface
```tsx
interface TemplateEditorProps {
  workspaceId: string;
  templateId?: string;          // undefined = create new, string = edit existing
  onSave: (template: ContentTemplate) => void;
  onCancel: () => void;
}
```

### Data types (define in `src/components/matrix/types.ts`)
```tsx
export interface ContentTemplate {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  pageType: 'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource' | 'provider-profile' | 'procedure-guide' | 'pricing-page';
  variables: TemplateVariable[];
  sections: TemplateSection[];
  urlPattern: string;           // e.g. "/services/{city}/{service}"
  keywordPattern: string;       // e.g. "{service} in {city}"
  titlePattern?: string;        // e.g. "{service} in {city} | {brand}"
  metaDescPattern?: string;
  cmsFieldMap?: Record<string, string>;  // sectionName → CMS field slug
  toneAndStyle?: string;        // optional override of workspace brand voice
  createdAt: string;
  updatedAt: string;
}

export interface TemplateVariable {
  name: string;                 // e.g. "city"
  label: string;                // e.g. "City"
  description?: string;         // e.g. "Target metro area"
}

export interface TemplateSection {
  id: string;
  name: string;                 // e.g. "hero"
  headingTemplate: string;      // e.g. "{service} in {city}"
  guidance: string;             // AI guidance for this section
  wordCountTarget: number;
  order: number;
  cmsFieldSlug?: string;        // maps to Webflow CMS field
}
```

### UI Layout
```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back to Templates                                           │
│                                                                 │
│  Template Name: [____________________]                          │
│  Description:   [____________________]                          │
│  Page Type:     [▼ Service Page      ]                          │
│                                                                 │
│  ┌─────────────────────────┐  ┌───────────────────────────────┐ │
│  │  Variables              │  │  Preview                      │ │
│  │  ┌───────────────────┐  │  │                               │ │
│  │  │ {city}    [× Remove]│ │  │  H1: Roofing in Austin       │ │
│  │  │ Label: City        │  │  │                               │ │
│  │  └───────────────────┘  │  │  § Hero (150 words)           │ │
│  │  ┌───────────────────┐  │  │    "Roofing in Austin"        │ │
│  │  │ {service} [× Remove]│ │  │                               │ │
│  │  │ Label: Service     │  │  │  § What Is Roofing? (200w)   │ │
│  │  └───────────────────┘  │  │    "What Is Roofing?"         │ │
│  │  [+ Add Variable]      │  │  │                               │ │
│  │                         │  │  § Why Choose Us (200w)        │ │
│  │  URL Pattern:           │  │    "Why Choose Us for..."      │ │
│  │  [/services/{city}/{service}]│ │                             │ │
│  │                         │  │  § FAQ (150w)                  │ │
│  │  Keyword Pattern:       │  │                               │ │
│  │  [{service} in {city}]  │  │  Total: ~1,000 words          │ │
│  └─────────────────────────┘  └───────────────────────────────┘ │
│                                                                 │
│  Sections (drag to reorder)                                     │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ ≡ Hero                                    150 words    [▾] ││
│  │   Heading: [{service} in {city}]                           ││
│  │   Guidance: [Write an engaging intro that...]              ││
│  │   CMS Field: [hero_content          ]                      ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │ ≡ What Is {service}?                      200 words    [▾] ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │ ≡ Why Choose Us                           200 words    [▾] ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │ [+ Add Section]                                            ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  [Cancel]                                    [Save Template]    │
└─────────────────────────────────────────────────────────────────┘
```

### Key behaviors
1. **Variable pills** — In heading/pattern inputs, variables appear as colored pills: `{city}` in blue-500, `{service}` in green-500. Typing `{` opens an autocomplete dropdown of defined variables.
2. **Drag-to-reorder sections** — Use HTML5 drag-and-drop (no external lib needed). Each section has a drag handle (≡ icon).
3. **Live preview** — Right panel shows what a sample page would look like with example variable values (auto-fill first variable with "Austin", second with "Roofing", etc.).
4. **Section expand/collapse** — Sections are collapsed by default showing name + word count. Click to expand and edit guidance, heading template, CMS field.
5. **Word count total** — Show running total at bottom of preview: "Total: ~1,000 words (6 sections)"

### Data fetching
- On mount (if `templateId` provided): `GET /api/content-templates/:workspaceId/:templateId`
- On save: `POST /api/content-templates/:workspaceId` (create) or `PUT /api/content-templates/:workspaceId/:templateId` (update)
- **For now, mock these calls** — return dummy data. Cascade will build the real endpoints.

### Mocking helper (create this file)
**File:** `src/components/matrix/mockData.ts`
```tsx
import type { ContentTemplate, ContentMatrix, MatrixCell } from './types';

export const MOCK_TEMPLATE: ContentTemplate = {
  id: 'tpl_001',
  workspaceId: 'ws_test',
  name: 'Service × Location Page',
  description: 'Standard service page for each city',
  pageType: 'service',
  variables: [
    { name: 'city', label: 'City', description: 'Target metro area' },
    { name: 'service', label: 'Service', description: 'Service offering' },
  ],
  sections: [
    { id: 's1', name: 'hero', headingTemplate: '{service} in {city}', guidance: 'Write an engaging intro...', wordCountTarget: 150, order: 0 },
    { id: 's2', name: 'what_is', headingTemplate: 'What Is {service}?', guidance: 'Explain the service...', wordCountTarget: 200, order: 1 },
    { id: 's3', name: 'why_us', headingTemplate: 'Why Choose Us for {service}', guidance: 'Differentiators...', wordCountTarget: 200, order: 2 },
    { id: 's4', name: 'process', headingTemplate: 'Our {service} Process', guidance: 'Step-by-step...', wordCountTarget: 200, order: 3 },
    { id: 's5', name: 'faq', headingTemplate: 'FAQ', guidance: '4-5 common questions...', wordCountTarget: 150, order: 4 },
    { id: 's6', name: 'cta', headingTemplate: 'Book Your {service} Appointment', guidance: 'Strong CTA...', wordCountTarget: 100, order: 5 },
  ],
  urlPattern: '/services/{city}/{service}',
  keywordPattern: '{service} in {city}',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
```

---

## Component 2: Matrix Grid

**File:** `src/components/matrix/MatrixGrid.tsx`

### What it does
The centerpiece spreadsheet-style grid showing all pages in a content matrix. Rows and columns are the variable dimensions. Each cell represents one planned page.

### Props interface
```tsx
interface MatrixGridProps {
  workspaceId: string;
  matrix: ContentMatrix;
  onCellClick: (cell: MatrixCell) => void;
  onBulkAction: (action: 'optimize' | 'generate_briefs' | 'generate_posts' | 'send_review' | 'export_csv' | 'export_docx', cellIds: string[]) => void;
  onCellUpdate: (cellId: string, updates: Partial<MatrixCell>) => void;
}
```

### Data types (add to `src/components/matrix/types.ts`)
```tsx
export interface ContentMatrix {
  id: string;
  workspaceId: string;
  name: string;
  templateId: string;
  dimensions: MatrixDimension[];
  urlPattern: string;
  keywordPattern: string;
  cells: MatrixCell[];
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

export interface MatrixDimension {
  name: string;           // e.g. "city"
  label: string;          // e.g. "City"
  values: string[];       // e.g. ["Austin", "Dallas", "Houston"]
}

export interface MatrixCell {
  id: string;
  variableValues: Record<string, string>;  // e.g. { city: "Austin", service: "Roofing" }
  targetKeyword: string;
  customKeyword?: string;
  plannedUrl: string;
  briefId?: string;
  postId?: string;
  status: 'planned' | 'keyword_optimized' | 'brief_generated' | 'client_review' | 'approved' | 'draft' | 'published';
  keywordValidation?: {
    volume: number;
    difficulty: number;
    cpc: number;
    validatedAt: string;
  };
  keywordCandidates?: KeywordCandidate[];
  recommendedKeyword?: string;
}

export interface KeywordCandidate {
  keyword: string;
  volume: number;
  difficulty: number;
  cpc: number;
  source: 'pattern' | 'semrush_related' | 'ai_suggested';
  isRecommended: boolean;
}
```

### UI Layout (2-dimension example)
```
┌─────────────────────────────────────────────────────────────────┐
│  Houston Area Service Pages                    54 pages total   │
│  ████████████████░░░░░░░░░░░░  33% complete                    │
│                                                                 │
│  [Filter ▾]  [Sort ▾]        [☑ 3 selected]  [Actions ▾]      │
│                                                                 │
│  ┌───────────────┬──────────┬──────────┬──────────┐            │
│  │               │ Austin   │ Dallas   │ Houston  │            │
│  ├───────────────┼──────────┼──────────┼──────────┤            │
│  │ Roofing       │ ✓ 320/mo │ ◐ 280/mo│ ○ 410/mo │            │
│  │               │ KD 28    │ KD 32   │ KD 25    │            │
│  ├───────────────┼──────────┼──────────┼──────────┤            │
│  │ Plumbing      │ ◐ 250/mo │ ◑ 190/mo│ ○ 340/mo │            │
│  │               │ KD 35    │ KD 30   │ KD 28    │            │
│  ├───────────────┼──────────┼──────────┼──────────┤            │
│  │ HVAC          │ ◑ 180/mo │ ○ 220/mo│ ○ 290/mo │            │
│  │               │ KD 40    │ KD 38   │ KD 33    │            │
│  └───────────────┴──────────┴──────────┴──────────┘            │
│                                                                 │
│  Status: ● Published  ◐ Draft  ◑ Brief  ○ Planned  🚩 Flagged  │
└─────────────────────────────────────────────────────────────────┘
```

### Key behaviors
1. **Cell selection** — Click to select one cell. Ctrl/Cmd+click for multi-select. Click+drag to select a range. Shift+click for range selection. Selected cells get `ring-2 ring-teal-400`.
2. **Status colors per cell:**
   - `planned` → `bg-zinc-800 text-zinc-500`
   - `keyword_optimized` → `bg-blue-500/10 text-blue-400 border-blue-500/20`
   - `brief_generated` → `bg-amber-500/10 text-amber-400 border-amber-500/20`
   - `client_review` → `bg-purple-500/10 text-purple-400 border-purple-500/20`
   - `approved` → `bg-teal-500/10 text-teal-400 border-teal-500/20`
   - `draft` → `bg-orange-500/10 text-orange-400 border-orange-500/20`
   - `published` → `bg-green-500/10 text-green-400 border-green-500/20`
3. **Cell content** — Each cell shows: status icon, keyword (truncated), volume badge, KD badge
4. **Bulk action toolbar** — Appears when cells are selected. Actions: Optimize Keywords, Generate Briefs, Send for Review, Export CSV, Export Word Doc
5. **Filter bar** — Filter by status, dimension values, keyword difficulty range
6. **Sort** — By status, volume, difficulty, alphabetical
7. **Responsive** — On small screens, collapse to a list view grouped by one dimension

### Cell detail (slide-out panel)
When a cell is clicked, show a slide-out panel on the right:
```
┌──────────────────────────────┐
│ ← Roofing in Austin          │
│                              │
│ Status: ◑ Brief Generated    │
│ URL: /services/austin/roofing│
│                              │
│ ─── Keyword ───              │
│ Target: "roofing austin"     │
│ Volume: 320/mo               │
│ Difficulty: 28/100           │
│ CPC: $4.50                   │
│                              │
│ Recommended: "roofing        │
│ services austin tx" (380/mo) │
│ [Accept Recommendation]      │
│                              │
│ ─── Content ───              │
│ Brief: [View Brief →]        │
│ Post:  [View Post →]         │
│                              │
│ ─── Actions ───              │
│ [Generate Brief]             │
│ [Send for Review]            │
│ [Flag for Changes]           │
└──────────────────────────────┘
```

---

## Component 3: Client Matrix Progress View

**File:** `src/components/client/MatrixProgressView.tsx`

### What it does
Read-only, simplified version of the Matrix Grid for the client portal. Shows progress and allows spot-checking/flagging.

### Props interface
```tsx
interface MatrixProgressViewProps {
  workspaceId: string;
  matrix: ContentMatrix;
  onCellPreview: (cell: MatrixCell) => void;
  onFlagCell: (cellId: string, comment: string) => void;
  onDownload: (format: 'docx' | 'pdf') => void;
}
```

### Key differences from admin MatrixGrid
- **No selection/bulk actions** — read-only
- **No keyword metrics** — client doesn't need to see KD/volume
- **Simpler cell content** — just status icon + page name
- **Progress bar** at the top showing overall completion
- **Download buttons** — "Download Word Doc" and "Download PDF"
- **Flag button** — per-cell, opens a comment form
- **Flagged cells** show amber border + flag icon

### UI Layout
Same grid structure as MatrixGrid but simpler cells and no toolbar. Follow the mockup from CONTENT_PLANNER_PLAN.md Layer 3.

---

## Component 4: Matrix Builder (Create Matrix Wizard)

**File:** `src/components/matrix/MatrixBuilder.tsx`

### What it does
Step-by-step wizard for creating a new content matrix from a template.

### Props interface
```tsx
interface MatrixBuilderProps {
  workspaceId: string;
  templates: ContentTemplate[];      // available templates to choose from
  onComplete: (matrix: ContentMatrix) => void;
  onCancel: () => void;
}
```

### Steps
1. **Choose Template** — Card grid of available templates. Each card shows name, page type, variable count, section count.
2. **Define Values** — For each variable in the template, enter the values:
   - "Cities: Austin, Dallas, Houston" (comma-separated or one per line)
   - "Services: Roofing, Plumbing, HVAC, Electrical" 
   - Show preview: "This will generate 3 × 4 = 12 pages"
3. **Review & Customize** — Show the generated matrix preview. Allow editing individual cell keywords if needed. Show URL preview for each cell.
4. **Confirm** — Summary card: "12 pages, estimated 12,000 words, targeting 12 keywords. [Create Matrix]"

---

## What NOT to Build

Devin should NOT modify any of these existing files — Cascade handles them:
- `src/components/ContentPipeline.tsx` — Cascade adds the Planner tab
- `src/App.tsx` — Cascade adds routes
- `server/*` — all backend files
- `shared/types/*` — Cascade extends shared types
- `src/api/*` — Cascade adds API client methods
- `src/components/client/ContentTab.tsx` — Cascade modifies for plan review

---

## File Checklist

Devin creates these NEW files only:

```
src/components/matrix/
  types.ts                    ← shared type definitions
  mockData.ts                 ← mock data for development
  TemplateEditor.tsx          ← Component 1
  MatrixGrid.tsx              ← Component 2
  MatrixBuilder.tsx           ← Component 4
  CellDetailPanel.tsx         ← slide-out panel (used by MatrixGrid)
  index.ts                    ← barrel export

src/components/client/
  MatrixProgressView.tsx      ← Component 3
```

---

## Testing

Use mock data during development. Each component should render independently with mock props. Create a simple test harness if helpful:

```tsx
// Temporary: src/components/matrix/DevPreview.tsx
// Delete before merge — just for visual testing during development
```

---

## Timeline

Estimated effort: ~20-25 hours total
- TemplateEditor: ~8-10 hrs (most complex — drag-and-drop, variable pills, live preview)
- MatrixGrid: ~6-8 hrs (selection logic, status colors, responsive)
- MatrixBuilder: ~3-4 hrs (wizard steps, straightforward)
- MatrixProgressView: ~2-3 hrs (simplified read-only grid)
- Types + mocks: ~1 hr

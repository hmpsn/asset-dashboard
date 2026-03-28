# Feature Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin dashboard page at `/features` that renders a curated `data/features.json` with toggleable views (by pain point, by platform area) and instant search — an internal sales cheat sheet.

**Architecture:** Static JSON file served via Express route (same pattern as roadmap.json). Single React component with search + view toggle. No database, no WebSocket, no mutations.

**Tech Stack:** React 19, React Query, Tailwind 4, Lucide icons, shared UI primitives (PageHeader, SectionCard, Badge, EmptyState).

---

## File Structure

| File | Responsibility |
|------|---------------|
| `data/features.json` | Curated feature data (~50-60 entries) |
| `shared/types/features.ts` | TypeScript interfaces for Feature, Category, PainPoint |
| `server/routes/features.ts` | GET `/api/features` — reads and serves features.json |
| `src/api/misc.ts` | Add `features.get()` API client method |
| `src/components/FeatureLibrary.tsx` | Main page component with search, toggle, grouped cards |
| `src/routes.ts` | Add `'features'` to Page type and GLOBAL_TABS |
| `src/App.tsx` | Lazy import + renderContent case + GLOBAL_TABS |
| `src/components/WorkspaceOverview.tsx` | Add "Features" button to Command Center header nav |
| `src/components/CommandPalette.tsx` | Add Features to NAV_ITEMS |

---

### Task 1: Shared Types

**Files:**
- Create: `shared/types/features.ts`

- [ ] **Step 1: Create the types file**

```ts
// shared/types/features.ts

export type FeatureCategory =
  | 'seo' | 'content' | 'analytics' | 'ai'
  | 'client' | 'monetization' | 'auth' | 'platform' | 'infra';

export type PainPoint =
  | 'site-health' | 'technical-seo' | 'content-production'
  | 'keyword-strategy' | 'competitive-intel' | 'reporting'
  | 'client-transparency' | 'ai-seo' | 'schema'
  | 'payments' | 'onboarding' | 'scale';

export type FeatureTier = 'free' | 'growth' | 'premium' | 'admin';

export type FeatureImpact = 'high' | 'medium' | 'low';

export interface Feature {
  id: number;
  title: string;
  oneLiner: string;
  category: FeatureCategory;
  painPoints: PainPoint[];
  tier: FeatureTier;
  impact: FeatureImpact;
  clientFacing: boolean;
}

export interface FeaturesData {
  features: Feature[];
}

export const CATEGORY_LABELS: Record<FeatureCategory, string> = {
  seo: 'SEO & Technical',
  content: 'Content & Strategy',
  analytics: 'Analytics & Tracking',
  ai: 'AI & Intelligence',
  client: 'Client Portal',
  monetization: 'Monetization',
  auth: 'Auth & Security',
  platform: 'Platform & UX',
  infra: 'Architecture & Infrastructure',
};

export const PAIN_POINT_LABELS: Record<PainPoint, string> = {
  'site-health': 'When they ask about site health',
  'technical-seo': 'When they need a technical audit',
  'content-production': 'When they need content / blog posts',
  'keyword-strategy': 'When they ask about keywords',
  'competitive-intel': 'When they ask about competitors',
  'reporting': 'When they want reports',
  'client-transparency': 'When they ask what you\'re doing for them',
  'ai-seo': 'When they ask about AI search / ChatGPT',
  'schema': 'When they need structured data / rich snippets',
  'payments': 'When they ask about billing',
  'onboarding': 'When they ask how to get started',
  'scale': 'When they have 100+ pages',
};
```

- [ ] **Step 2: Commit**

```bash
git add shared/types/features.ts
git commit -m "feat(types): add Feature Library shared types"
```

---

### Task 2: Curate `data/features.json`

**Files:**
- Create: `data/features.json`

This is the most labor-intensive task — curating ~50-60 entries from the 252 in FEATURE_AUDIT.md. The engineer should read FEATURE_AUDIT.md and select features that are sales-relevant (client-facing capabilities, differentiating admin tools, revenue-driving workflows). Exclude bug fixes, refactors, infrastructure, and React Query migrations.

- [ ] **Step 1: Create `data/features.json`**

Read through `FEATURE_AUDIT.md` and create the JSON file. Here's the structure with the first 10 entries as a starting template — the engineer should continue with ~40-50 more:

```json
{
  "features": [
    {
      "id": 1,
      "title": "Site Health Audit",
      "oneLiner": "20+ check SEO audit with weighted scoring, traffic intelligence, and one-click Fix→ routing to every tool",
      "category": "seo",
      "painPoints": ["site-health", "technical-seo", "reporting"],
      "tier": "free",
      "impact": "high",
      "clientFacing": true
    },
    {
      "id": 2,
      "title": "Scheduled Recurring Audits",
      "oneLiner": "Automated SEO audits on a schedule with email alerts when scores drop below threshold",
      "category": "seo",
      "painPoints": ["site-health", "reporting"],
      "tier": "growth",
      "impact": "medium",
      "clientFacing": true
    },
    {
      "id": 3,
      "title": "AEO — Answer Engine Optimization",
      "oneLiner": "8 trust audit checks, healthcare schema types, AEO content rules, and recommendation engine for AI search visibility",
      "category": "seo",
      "painPoints": ["ai-seo", "technical-seo"],
      "tier": "growth",
      "impact": "high",
      "clientFacing": true
    },
    {
      "id": 4,
      "title": "Schema Generator + Publish to Webflow",
      "oneLiner": "AI-generated JSON-LD schemas with Google validation, CMS templates, diff view, and one-click Webflow publishing",
      "category": "seo",
      "painPoints": ["schema", "technical-seo"],
      "tier": "growth",
      "impact": "high",
      "clientFacing": true
    },
    {
      "id": 5,
      "title": "SEO Editor + Bulk AI Rewrite",
      "oneLiner": "Edit titles/descriptions via Webflow API with AI suggestions, 3-variation bulk rewrites, and per-page client approval",
      "category": "seo",
      "painPoints": ["technical-seo", "scale"],
      "tier": "free",
      "impact": "high",
      "clientFacing": false
    },
    {
      "id": 6,
      "title": "Keyword Strategy Engine",
      "oneLiner": "AI-driven keyword mapping with SEMRush/DataForSEO data, content gaps, quick wins, and conversion-aware prioritization",
      "category": "content",
      "painPoints": ["keyword-strategy", "competitive-intel"],
      "tier": "growth",
      "impact": "high",
      "clientFacing": true
    },
    {
      "id": 7,
      "title": "Content Brief Generator",
      "oneLiner": "AI briefs with real SERP data, competitor analysis, audience personas, and 7 page-type templates",
      "category": "content",
      "painPoints": ["content-production", "keyword-strategy"],
      "tier": "growth",
      "impact": "high",
      "clientFacing": true
    },
    {
      "id": 8,
      "title": "AI Content Post Generator",
      "oneLiner": "Full blog posts from briefs with Claude prose, GPT unification, brand voice scoring, and auto-publish to Webflow CMS",
      "category": "content",
      "painPoints": ["content-production", "scale"],
      "tier": "premium",
      "impact": "high",
      "clientFacing": false
    },
    {
      "id": 9,
      "title": "Client Portal",
      "oneLiner": "White-labeled dashboard with search data, health scores, strategy, content hub, approvals, and AI chatbot",
      "category": "client",
      "painPoints": ["client-transparency", "reporting"],
      "tier": "free",
      "impact": "high",
      "clientFacing": true
    },
    {
      "id": 10,
      "title": "AI Insights Engine (Client Chatbot)",
      "oneLiner": "GPT-4o advisor using full dashboard data — GSC, GA4, audit, strategy, ranks — with conversation memory and revenue hooks",
      "category": "ai",
      "painPoints": ["client-transparency", "reporting"],
      "tier": "growth",
      "impact": "high",
      "clientFacing": true
    }
  ]
}
```

Continue adding entries for: Asset Manager, Dead Link Checker, PageSpeed, Redirect Manager, Internal Links, Content Decay, Page Intelligence, Site Architecture, LLMs.txt, Rank Tracker, Analytics Hub, Approval Workflow, Client Request System, Content Subscriptions, Content Matrices, Content Templates, Competitive Intelligence Hub, Backlink Profile, Automated Monthly Reports, Stripe Payments, Client Onboarding Welcome, In-Portal Plans Page, Beta Feedback Widget, Client Keyword Feedback, Strategy Participation, Sales Report (Prospect Audit), Admin AI Chat, Knowledge Base, Brand Voice Auto-Generation, AI Recommendations Engine, SEO Change Tracker, Schema Impact Tracking, Data Export, Shareable Reports, Email Notifications, and other sales-relevant features.

- [ ] **Step 2: Validate JSON**

```bash
python3 -c "import json; d=json.load(open('data/features.json')); print(f'{len(d[\"features\"])} features loaded')"
```

Expected: `50-60 features loaded`

- [ ] **Step 3: Commit**

```bash
git add data/features.json
git commit -m "feat(data): curate features.json with ~55 sales-relevant features"
```

---

### Task 3: Server Route

**Files:**
- Create: `server/routes/features.ts`
- Modify: `server/app.ts` (add route mount)

- [ ] **Step 1: Create the route file**

```ts
// server/routes/features.ts
import { Router } from 'express';
import path from 'path';
import fs from 'fs';

const router = Router();

const FEATURES_FILE = path.join(__dirname, '..', '..', 'data', 'features.json');

router.get('/api/features', (_req, res) => {
  try {
    const raw = fs.readFileSync(FEATURES_FILE, 'utf-8');
    const data = JSON.parse(raw);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load features data' });
  }
});

export default router;
```

- [ ] **Step 2: Mount the route in `server/app.ts`**

Find the route-mounting section in `server/app.ts` and add:

```ts
import featuresRouter from './routes/features.js';
// ... in the route mounting section:
app.use(featuresRouter);
```

- [ ] **Step 3: Commit**

```bash
git add server/routes/features.ts server/app.ts
git commit -m "feat(api): add GET /api/features endpoint serving features.json"
```

---

### Task 4: API Client

**Files:**
- Modify: `src/api/misc.ts`

- [ ] **Step 1: Add features API client**

In `src/api/misc.ts`, add after the existing `roadmap` export:

```ts
import type { FeaturesData } from '../../shared/types/features';

export const features = {
  get: () => get<FeaturesData>('/api/features'),
};
```

- [ ] **Step 2: Commit**

```bash
git add src/api/misc.ts
git commit -m "feat(api): add features.get() API client"
```

---

### Task 5: Route Wiring

**Files:**
- Modify: `src/routes.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add `'features'` to Page type in `src/routes.ts`**

Add `'features'` to the `Page` type union (after `'revenue'`):

```ts
export type Page =
  // ... existing entries ...
  | 'revenue'
  | 'features';
```

Add `'features'` to the `GLOBAL_TABS` set:

```ts
const GLOBAL_TABS = new Set<string>(['settings', 'roadmap', 'prospect', 'ai-usage', 'revenue', 'features']);
```

- [ ] **Step 2: Add lazy import in `src/App.tsx`**

Near the other lazy imports (around line 41-60):

```ts
const FeatureLibrary = lazyWithRetry(() => import('./components/FeatureLibrary'));
```

- [ ] **Step 3: Add renderContent case in `src/App.tsx`**

In the `renderContent()` function (around line 298-304), after the `revenue` case:

```ts
if (tab === 'features') return <FeatureLibrary />;
```

- [ ] **Step 4: Add `'features'` to GLOBAL_TABS in `src/App.tsx`**

Find the `useMemo` for `GLOBAL_TABS` (around line 136) and add `'features'`:

```ts
const GLOBAL_TABS = useMemo(() => new Set(['settings', 'roadmap', 'prospect', 'ai-usage', 'revenue', 'features']), []);
```

- [ ] **Step 5: Commit**

```bash
git add src/routes.ts src/App.tsx
git commit -m "feat(routing): wire /features route with lazy-loaded FeatureLibrary"
```

---

### Task 6: FeatureLibrary Component

**Files:**
- Create: `src/components/FeatureLibrary.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/FeatureLibrary.tsx
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Layers, Eye } from 'lucide-react';
import { PageHeader, Badge, EmptyState } from './ui';
import { features as featuresApi } from '../api/misc';
import type {
  Feature, FeatureCategory, PainPoint, FeatureTier,
  CATEGORY_LABELS, PAIN_POINT_LABELS,
} from '../../shared/types/features';
// Re-import the actual objects (not just types)
import { CATEGORY_LABELS as catLabels, PAIN_POINT_LABELS as ppLabels } from '../../shared/types/features';

type ViewMode = 'painPoint' | 'category';

const TIER_STYLES: Record<FeatureTier, string> = {
  free: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/20',
  growth: 'bg-teal-500/15 text-teal-400 border-teal-500/20',
  premium: 'bg-violet-500/15 text-violet-400 border-violet-500/20',
  admin: 'bg-purple-500/15 text-purple-400 border-purple-500/20',
};

const TIER_LABELS: Record<FeatureTier, string> = {
  free: 'Free',
  growth: 'Growth',
  premium: 'Premium',
  admin: 'Admin',
};

const IMPACT_DOT: Record<string, string> = {
  high: 'bg-emerald-400',
  medium: 'bg-amber-400',
};

function FeatureCard({ feature }: { feature: Feature }) {
  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 hover:border-zinc-700 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold text-zinc-100 leading-tight">{feature.title}</h3>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {feature.impact !== 'low' && (
            <span className={`w-2 h-2 rounded-full ${IMPACT_DOT[feature.impact]}`} title={`${feature.impact} impact`} />
          )}
          {feature.clientFacing && (
            <Eye className="w-3 h-3 text-zinc-500" title="Client-facing" />
          )}
        </div>
      </div>
      <p className="text-xs text-zinc-400 leading-relaxed mb-3">{feature.oneLiner}</p>
      <span className={`inline-flex px-2 py-0.5 text-[10px] font-medium rounded-md border ${TIER_STYLES[feature.tier]}`}>
        {TIER_LABELS[feature.tier]}
      </span>
    </div>
  );
}

export default function FeatureLibrary() {
  const [search, setSearch] = useState('');
  const [view, setView] = useState<ViewMode>('painPoint');

  const { data, isLoading } = useQuery({
    queryKey: ['features'],
    queryFn: featuresApi.get,
    staleTime: 5 * 60 * 1000, // 5 min
  });

  const allFeatures = data?.features ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return allFeatures;
    const q = search.toLowerCase();
    return allFeatures.filter(f =>
      f.title.toLowerCase().includes(q) ||
      f.oneLiner.toLowerCase().includes(q) ||
      f.painPoints.some(pp => ppLabels[pp].toLowerCase().includes(q)) ||
      catLabels[f.category].toLowerCase().includes(q)
    );
  }, [allFeatures, search]);

  const grouped = useMemo(() => {
    if (view === 'category') {
      const groups: Record<string, Feature[]> = {};
      for (const f of filtered) {
        const key = f.category;
        if (!groups[key]) groups[key] = [];
        groups[key].push(f);
      }
      return Object.entries(groups)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, items]) => ({
          label: catLabels[key as FeatureCategory],
          features: items,
        }));
    }
    // painPoint view — features appear under each matching pain point
    const groups: Record<string, Feature[]> = {};
    for (const f of filtered) {
      for (const pp of f.painPoints) {
        if (!groups[pp]) groups[pp] = [];
        groups[pp].push(f);
      }
    }
    // Sort pain points by number of features (most relevant first)
    return Object.entries(groups)
      .sort(([, a], [, b]) => b.length - a.length)
      .map(([key, items]) => ({
        label: ppLabels[key as PainPoint],
        features: items,
      }));
  }, [filtered, view]);

  if (isLoading) {
    return (
      <div className="p-6">
        <PageHeader title="Feature Library" subtitle="Loading..." icon={<Layers className="w-5 h-5 text-teal-400" />} />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Feature Library"
        subtitle={`${allFeatures.length} curated features — internal sales reference`}
        icon={<Layers className="w-5 h-5 text-teal-400" />}
      />

      {/* Controls */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search features..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-teal-500/50"
          />
        </div>
        <div className="flex rounded-lg border border-zinc-800 overflow-hidden">
          <button
            onClick={() => setView('painPoint')}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              view === 'painPoint'
                ? 'bg-teal-500/15 text-teal-400'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            By Pain Point
          </button>
          <button
            onClick={() => setView('category')}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              view === 'category'
                ? 'bg-teal-500/15 text-teal-400'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            By Platform Area
          </button>
        </div>
      </div>

      {/* Content */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<Search className="w-8 h-8 text-zinc-600" />}
          title="No features match your search"
          description="Try a different search term"
        />
      ) : (
        <div className="space-y-8">
          {grouped.map(group => (
            <div key={group.label}>
              <h2 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
                <span className="w-1 h-4 bg-teal-500 rounded-full" />
                {group.label}
                <span className="text-zinc-600 font-normal">({group.features.length})</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {group.features.map(f => (
                  <FeatureCard key={`${group.label}-${f.id}`} feature={f} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build compiles**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/FeatureLibrary.tsx
git commit -m "feat: FeatureLibrary component with search + pain point / category views"
```

---

### Task 7: Navigation Wiring

**Files:**
- Modify: `src/components/WorkspaceOverview.tsx` (~line 114-123)
- Modify: `src/components/CommandPalette.tsx` (~line 47-49)

- [ ] **Step 1: Add Features button to Command Center header nav**

In `src/components/WorkspaceOverview.tsx`, find the header nav buttons (around line 114-123, after the Revenue button). Add:

```tsx
<button onClick={() => navigate('/features')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-teal-400/80 hover:text-teal-300 bg-teal-500/5 hover:bg-teal-500/10 border border-teal-500/20 transition-all">
  <Layers className="w-3.5 h-3.5" /> Features
</button>
```

Add `Layers` to the Lucide import at the top of the file.

- [ ] **Step 2: Add Features to CommandPalette NAV_ITEMS**

In `src/components/CommandPalette.tsx`, add to the `NAV_ITEMS` array (around line 48, after roadmap):

```ts
{ id: 'features', label: 'Feature Library', icon: Layers, group: '' },
```

Add `Layers` to the Lucide import at the top of the file.

- [ ] **Step 3: Commit**

```bash
git add src/components/WorkspaceOverview.tsx src/components/CommandPalette.tsx
git commit -m "feat: wire Feature Library into Command Center nav + Command Palette"
```

---

### Task 8: CLAUDE.md + Cascade Update

**Files:**
- Modify: `CLAUDE.md`
- Modify: `FEATURE_AUDIT.md` (Cascade Update Prompt section)

- [ ] **Step 1: Update CLAUDE.md post-task checklist**

In `CLAUDE.md`, find the "After completing a task" section and add item 6 (renumber existing items if needed):

```markdown
6. **`data/features.json`** — if the completed feature is client-impactful or sales-relevant, add/update its entry. Not every feature belongs here — only ones you'd mention on a sales call.
```

- [ ] **Step 2: Update FEATURE_AUDIT.md Cascade Update Prompt**

In `FEATURE_AUDIT.md`, find the "Cascade Update Prompt" section and add step 9:

```markdown
9. **Update data/features.json**: If any new/updated features are sales-relevant, add or update their entry in features.json (title, oneLiner, category, painPoints, tier, impact).
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md FEATURE_AUDIT.md
git commit -m "docs: add features.json to post-task checklist and cascade update prompt"
```

---

### Task 9: Build Verification

- [ ] **Step 1: Type-check**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: zero errors

- [ ] **Step 2: Build**

```bash
npx vite build
```

Expected: builds successfully, FeatureLibrary appears as a lazy chunk

- [ ] **Step 3: Manual smoke test**

```bash
npm run dev:all
```

Navigate to `/features` in the browser. Verify:
- Page loads with feature cards
- Search filters instantly
- Pain Point / Platform Area toggle works
- Tier badges show correct colors
- Command Center header shows "Features" button
- Cmd+K palette includes "Feature Library"

- [ ] **Step 4: Update FEATURE_AUDIT.md with this new feature**

Add a new entry to FEATURE_AUDIT.md for the Feature Library feature itself:

```markdown
### 253. Feature Library Dashboard
**What it does:** Admin-facing internal sales reference page at `/features` powered by `data/features.json`. Shows ~55 curated, sales-relevant features with two toggleable views: By Pain Point (groups features under common prospect questions like "When they ask about site health") and By Platform Area (groups by category). Instant search across titles, descriptions, and tags. Feature cards show tier badges (free/growth/premium/admin), impact indicators, and client-facing flags. Accessible from Command Center header nav and Command Palette (Cmd+K).

**Agency value:** During sales calls, instantly find the right feature to mention for any prospect question. No more scrolling through 2,900 lines of FEATURE_AUDIT.md — search or browse by pain point.

**Client value:** N/A — internal agency tool.

**Mutual:** Better sales conversations lead to better-matched clients who actually use the platform's capabilities.
```

- [ ] **Step 5: Final commit**

```bash
git add FEATURE_AUDIT.md
git commit -m "docs: add Feature Library to FEATURE_AUDIT.md"
```

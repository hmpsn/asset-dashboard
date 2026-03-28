# Feature Library — Design Spec

**Date:** 2026-03-28
**Purpose:** Internal sales cheat sheet — a searchable, toggleable admin dashboard page powered by a curated JSON data file.

---

## Problem

FEATURE_AUDIT.md is 330KB / 252 features. It's a comprehensive reference but too large to scan during a sales call. There's no quick way to answer "what do we have for X?" without Cmd+F through 2,900 lines.

## Solution

A `data/features.json` file containing ~50-60 curated, sales-relevant features, rendered as an admin dashboard page at `/features` with two view modes and instant search.

---

## Data Structure

### `data/features.json`

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
    }
  ]
}
```

### Field definitions

| Field | Type | Description |
|-------|------|-------------|
| `id` | number | Sequential ID, unique |
| `title` | string | Feature name (matches FEATURE_AUDIT heading) |
| `oneLiner` | string | Single punchy sentence for sales context |
| `category` | enum | `seo`, `content`, `analytics`, `ai`, `client`, `monetization`, `auth`, `platform`, `infra` |
| `painPoints` | string[] | Tags from the pain point taxonomy (see below) |
| `tier` | enum | `free`, `growth`, `premium`, `admin` |
| `impact` | enum | `high`, `medium`, `low` |
| `clientFacing` | boolean | Whether the client sees this feature in their portal |

### Pain point taxonomy

These map to common prospect questions and objections:

| Tag | "When they ask about..." |
|-----|--------------------------|
| `site-health` | "How's my site doing?" |
| `technical-seo` | "We need a technical audit" |
| `content-production` | "We need blog posts / content" |
| `keyword-strategy` | "What keywords should we target?" |
| `competitive-intel` | "How do we compare to competitors?" |
| `reporting` | "Can we see reports?" |
| `client-transparency` | "What are you doing for us?" |
| `ai-seo` | "What about AI search / ChatGPT?" |
| `schema` | "We need structured data / rich snippets" |
| `payments` | "How does billing work?" |
| `onboarding` | "How do we get started?" |
| `scale` | "We have 100+ pages" |

### Category labels (for UI display)

| Key | Display Label |
|-----|---------------|
| `seo` | SEO & Technical |
| `content` | Content & Strategy |
| `analytics` | Analytics & Tracking |
| `ai` | AI & Intelligence |
| `client` | Client Portal |
| `monetization` | Monetization |
| `auth` | Auth & Security |
| `platform` | Platform & UX |
| `infra` | Architecture & Infrastructure |

### Curation criteria

**Include:** Features you'd mention on a sales call — client-facing capabilities, differentiating admin tools, revenue-driving workflows.

**Exclude:** Bug fixes, internal refactors, architecture improvements, React Query migrations, lint cleanups, infrastructure that's invisible to clients. These stay in FEATURE_AUDIT.md as the detailed record but don't belong in a sales reference.

Target: ~50-60 entries. Quality over quantity.

---

## Dashboard Page

### Route

- Page type: `'features'` added to `Page` union in `src/routes.ts`
- Added to `GLOBAL_TABS` set
- Accessible from Command Center header nav (teal button, `Layers` icon) alongside Prospect, Roadmap, Revenue, AI Usage
- Lazy-loaded via `lazyWithRetry`

### Component: `FeatureLibrary.tsx`

**Header:** `PageHeader` with title "Feature Library", subtitle showing curated feature count.

**Controls bar:**
- Search input (instant filter across title, oneLiner, painPoint tags)
- View toggle: `By Pain Point` (default) | `By Platform Area` — using a segmented toggle

**By Pain Point view (default):**
- Groups features by pain point tag
- Section headers use the human-readable label from the taxonomy ("When they ask about site health")
- Features that have multiple pain points appear under each relevant group
- Empty groups are hidden

**By Platform Area view:**
- Groups features by `category`
- Section headers use the category display labels
- Single appearance per feature (no duplication)

**Feature cards:**
- Compact card in a responsive grid (3-col desktop, 2-col tablet, 1-col mobile)
- Title (bold)
- One-liner (zinc-400 text)
- Tier badge: zinc for free, teal for growth, violet for premium, purple for admin
- Impact indicator: green dot for high, amber for medium (low gets no dot)
- Client-facing indicator: small eye icon when `clientFacing: true`

**Empty state:** If search returns no results, show standard EmptyState with "No features match your search" message.

### Data loading

Static JSON fetch from `/data/features.json` — same pattern as roadmap.json. No API endpoint needed. React Query with `STALE_TIMES.STABLE` (5 min) since the data rarely changes.

---

## Keeping It Current

### CLAUDE.md update

Add to the "After completing a task" checklist (item 6):

```
6. **`data/features.json`** — if the completed feature is client-impactful or sales-relevant,
   add/update its entry. Not every feature belongs here — only ones you'd mention on a sales call.
```

### FEATURE_AUDIT.md Cascade Update Prompt

Add step 9:

```
9. **Update data/features.json**: If any new/updated features are sales-relevant,
   add or update their entry in features.json (title, oneLiner, category, painPoints, tier, impact).
```

### What triggers an update

- New client-facing features
- New admin tools that are sales-differentiating
- Tier changes on existing features
- Features that address a new pain point

### What does NOT trigger an update

- Infrastructure/architecture features
- Bug fixes
- Internal-only DX improvements
- React Query migrations, server refactors, etc.

---

## Implementation scope

1. Create `data/features.json` with ~50-60 curated entries (sourced from FEATURE_AUDIT.md)
2. Create `src/components/FeatureLibrary.tsx` following existing page patterns
3. Wire route in `src/routes.ts`, `src/App.tsx`, `src/components/layout/Sidebar.tsx` (or Command Center header)
4. Add to `CommandPalette.tsx`
5. Update `CLAUDE.md` post-task checklist
6. Update `FEATURE_AUDIT.md` Cascade Update Prompt

No backend changes. No new API endpoints. No database changes.

# Meeting Brief — Design Spec

**Date:** 2026-04-07
**Status:** Approved
**Phase:** Phase 1 of 2 (Meeting Brief; Phase 2 = Site Architecture Intelligence)

---

## Overview

The Meeting Brief is an on-demand, AI-synthesized workspace briefing — admin-only, generated in ~10 seconds, designed to be screen-shared with a client during a strategy or review call.

It answers three questions every time:
1. **What's the story right now?** — One narrative paragraph covering site state and momentum
2. **What matters most?** — Prioritized signal from all intelligence slices, in client-friendly language (no admin jargon, no internal scores)
3. **What's the recommendation?** — 3–5 concrete actions with rationale, ordered by impact

When a Site Blueprint exists, it adds a fourth layer: **How does the current site compare to the plan?** — gap analysis framed as progress, not deficit.

This is Phase 1 of a two-phase Strategic Intelligence Layer:
- **Phase 1 (this spec):** Meeting Brief — on-demand narrative synthesis
- **Phase 2 (future):** Site Architecture Intelligence — persistent structural analysis (topic coverage, keyword distribution, cannibalization clusters, orphaned pages, missing pillar pages). Phase 2 gets dramatically stronger when Voice Intelligence lands.

---

## Problem

Preparing for a client meeting requires synthesizing data from multiple views: site health, strategy, GA4, GSC. This takes time the admin often doesn't have. Without prep, the call either leans on live impressions or relies on tactical insight cards that don't tell a cohesive story.

The brief compresses 20–30 minutes of tab-hopping into a single screen-ready view — generated before the call, refreshable on demand.

---

## Non-Goals (Phase 1)

- No client-facing export or sharing (Phase 2)
- No email delivery or scheduling
- No per-section editing or manual overrides
- No voice/tone calibration (waits for Voice Intelligence unlock)
- Site Architecture structural analysis is Phase 2

---

## UI Placement

**Route:** `/ws/:workspaceId/brief` — a dedicated `brief` tab in the admin workspace sidebar.

**Full-page view** — not a modal or side panel. The view fills the screen so it's clean for screen-sharing without admin chrome cluttering the background.

**States:**
1. **No brief yet** — Empty state with headline "Generate your first meeting brief" and a single CTA button
2. **Brief exists** — Renders immediately (no loading). Timestamp in top-right: "Generated 3 hours ago · Regenerate"
3. **Generating** — Skeleton layout with contextual loading message ("Analyzing site performance...")

**Regenerate interaction:** Secondary button, not a prominent CTA — deliberate, not fat-fingerable mid-call.

---

## Output Structure

### Section 1 — Situation Summary *(AI-generated, 2–3 sentences)*
Narrative opening that sets the tone for the meeting. Written as a human analyst would write it:
> "Your site is gaining momentum in local search, with 3 pages moving into top-5 positions this month. The main challenge right now is a content gap around [topic] that's letting competitors capture traffic you should own."

### Section 2 — Wins Since Last Review *(AI-generated, 3–5 bullets)*
Concrete positive signal: ranking movers up, CTR improvements, converting pages, actions that produced outcomes. Framed as accomplishments, not metrics.

### Section 3 — What Needs Attention *(AI-generated, 3–5 bullets)*
Top critical/warning insights translated into plain language — no severity labels, no impact scores exposed to client. Ordered by impact score under the hood.
> "Your [page] is losing traffic to [competing page] for the query [keyword]."

### Section 4 — Recommendations for This Period *(AI-generated, 3–5 items)*
Concrete next steps with a one-line rationale each. AI picks these from highest-impact open insights + any blueprint gaps + content pipeline status.

### Section 5 — Blueprint Progress *(conditional — only when blueprint exists)*
How many blueprint pages are live, in-progress, or unstarted. 1–2 sentences on what the gap means strategically. Framed as progress toward the plan, not a deficit.

### Section 6 — At a Glance *(data-driven, NOT AI-generated)*
A metric strip assembled directly from raw data:
- Site health score
- Open ranking opportunities (count)
- Content pieces in pipeline (count)
- Top position (best-ranking page/query)
- Clicks vs. prior period (% delta)

**Critical separation:** Sections 1–4 (and 5 if applicable) are AI-written. Section 6 is always data-direct. This keeps the factual numbers trustworthy and the narrative honest — the numbers are the receipts that back up the story.

---

## Data Architecture

### Server Endpoints
- `GET /api/workspaces/:workspaceId/meeting-brief` — returns the stored brief (or `null` if none exists yet)
- `POST /api/workspaces/:workspaceId/meeting-brief/generate` — generates a new brief, upserts to DB, returns the result

Auth on both: standard admin auth (HMAC `x-auth-token` via global gate — do NOT add `requireAuth`).

### Intelligence Assembly
Reuses existing `WorkspaceIntelligence` assembler (`server/workspace-intelligence.ts`). No new data fetching.

Slices used:
- `insights` — prioritized by impact score, filtered to critical/warning/opportunity
- `learnings` — recent wins, action outcomes, win rate
- `siteHealth` — audit score, dead links, CWV
- `contentPipeline` — briefs in progress, posts published
- `clientSignals` — approval patterns, feedback themes
- Blueprint data (if the Site Blueprint feature is shipped) — page counts by status, queried separately from `site_blueprints` + `blueprint_entries` tables. If the blueprint feature isn't yet built, this slice is omitted and Section 5 is hidden.

### Prompt Construction
Same pattern as admin chat context assembly (`server/admin-chat-context.ts`), but with a **structured output prompt** instead of conversational. The AI returns a JSON object:

```typescript
interface MeetingBriefAIOutput {
  situationSummary: string;        // 2-3 sentences
  wins: string[];                  // 3-5 bullets
  attention: string[];             // 3-5 bullets
  recommendations: Array<{
    action: string;
    rationale: string;
  }>;
  blueprintProgress?: string;      // null if no blueprint
}
```

The "At a Glance" metric strip is assembled server-side from raw data and never sent to the AI.

**Framing instructions in the system prompt:**
- Write for a client audience — no admin jargon, no internal scoring language
- Be specific and concrete (name pages, queries, numbers)
- Narrative tone, not bullet-point data dump
- Wins first, then challenges — the meeting should feel constructive

**Model:** GPT-4.1 via `callOpenAI()` — same model as admin chat.

### Storage
New `meeting_briefs` table — one row per workspace (upsert on regenerate):

```sql
CREATE TABLE meeting_briefs (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  generated_at TEXT NOT NULL,
  situation_summary TEXT NOT NULL,
  wins TEXT NOT NULL,           -- JSON array of strings
  attention TEXT NOT NULL,      -- JSON array of strings
  recommendations TEXT NOT NULL, -- JSON array of {action, rationale}
  blueprint_progress TEXT,      -- nullable
  prompt_hash TEXT              -- optional: detect unchanged data
);
```

`prompt_hash` is an optional optimization — if the assembled intelligence hash matches the last generation, skip the AI call and return the cached brief.

### Frontend
- **Hook:** `useAdminMeetingBrief(workspaceId)` — `useQuery` reads stored brief, `useMutation` triggers generate endpoint
- **Query key:** `['admin-meeting-brief', workspaceId]`
- **WebSocket:** Handle `MEETING_BRIEF_UPDATED` broadcast → invalidate query cache
- **Broadcast:** Server calls `broadcastToWorkspace(workspaceId, 'MEETING_BRIEF_UPDATED', {})` after upsert

### Generation Flow
1. Assemble WorkspaceIntelligence (uses existing LRU cache — fast)
2. Check `prompt_hash` — if unchanged, return cached brief (skip AI call)
3. Build structured prompt with client-friendly framing
4. `callOpenAI()` → parse + validate JSON response
5. Upsert to `meeting_briefs`
6. `broadcastToWorkspace()` with `MEETING_BRIEF_UPDATED`
7. Return `{ brief, generatedAt }`

---

## DB Migration

New migration file: `server/db/migrations/048-meeting-briefs.ts`

```sql
CREATE TABLE IF NOT EXISTS meeting_briefs (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  generated_at TEXT NOT NULL,
  situation_summary TEXT NOT NULL,
  wins TEXT NOT NULL DEFAULT '[]',
  attention TEXT NOT NULL DEFAULT '[]',
  recommendations TEXT NOT NULL DEFAULT '[]',
  blueprint_progress TEXT,
  prompt_hash TEXT
);
```

---

## Routing Changes

Per route removal checklist pattern, adding `'brief'` to the `Page` type requires updates to:
1. `src/routes.ts` — add `'brief'` to admin `Page` union
2. `src/App.tsx` — add `renderContent()` case
3. `src/components/layout/Sidebar.tsx` — add sidebar entry
4. `src/components/layout/Breadcrumbs.tsx` — add `TAB_LABELS` entry
5. `src/components/CommandPalette.tsx` — add to `NAV_ITEMS`

---

## Component Structure

```
src/components/admin/MeetingBrief/
  MeetingBriefPage.tsx       — top-level page, handles empty/loading/populated states
  BriefHeader.tsx            — timestamp + regenerate button
  SituationSummary.tsx       — narrative paragraph
  BriefSection.tsx           — reusable section wrapper (title + bullet list)
  RecommendationsList.tsx    — action + rationale pairs
  BlueprintProgress.tsx      — conditional, only renders when data present
  AtAGlanceStrip.tsx         — metric strip from raw data
```

All use existing `SectionCard`, `Skeleton`, `EmptyState` primitives from `src/components/ui/`.

---

## Color + Design Rules

- **No purple** — this is a client-presentable view
- Section headers: standard text hierarchy, no colored badges
- At a Glance numbers: blue (`text-blue-400`) — data metrics follow Law 2
- Regenerate button: teal (action, Law 1)
- Loading skeleton: `<Skeleton>` component with layout-preserving shimmer
- Empty state: `<EmptyState>` with teal CTA

---

## Phase 2 Forward Compatibility

When Site Architecture Intelligence ships (Phase 2), the brief gains:
- A **"Structure Opportunities"** section (biggest structural gap, framed as an upsell opportunity)
- Blueprint gap analysis becomes richer (page-by-page status, not just counts)

When Voice Intelligence ships, the framing instructions in the system prompt can be replaced with calibrated voice context from the brandscript/voice DNA — making the brief sound like *your* agency's voice, not a generic AI.

No schema changes needed for these extensions — `blueprint_progress` is already nullable and extensible, and the prompt construction is modular.

---

## Acceptance Criteria

- [ ] `POST /api/workspaces/:workspaceId/meeting-brief/generate` returns structured brief in < 15s
- [ ] Brief renders immediately on tab open when one exists (no loading)
- [ ] Regenerate button produces updated brief and updates timestamp
- [ ] "At a Glance" numbers match raw data (spot-check 3 metrics against source views)
- [ ] Blueprint Progress section hidden when no blueprint exists
- [ ] No purple in any component
- [ ] Skeleton renders during generation (not a spinner)
- [ ] Empty state shown on first visit with working CTA
- [ ] `npx tsc --noEmit --skipLibCheck` passes
- [ ] `npx vite build` succeeds
- [ ] `npx vitest run` passes (full suite)

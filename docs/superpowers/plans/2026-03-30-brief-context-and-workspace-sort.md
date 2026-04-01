# Brief Context Passthrough & Workspace Sorting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Pass full Page Intelligence analysis context through to brief generation and auto-trigger it, (2) Sort workspaces alphabetically everywhere.

**Architecture:** Extend `FixContext` with optional analysis fields. PageIntelligence populates them when navigating to briefs. ContentBriefs auto-triggers generation when `autoGenerate` flag is set. Backend accepts and injects the analysis context into the AI prompt. Workspace sorting is a one-line change in the `useWorkspaces` hook.

**Tech Stack:** React 19, React Router DOM 7, Express, TypeScript

---

### Task 1: Extend FixContext with analysis fields

**Files:**
- Modify: `src/App.tsx:69-75`

- [ ] **Step 1: Add analysis fields to FixContext**

In `src/App.tsx`, extend the `FixContext` interface:

```typescript
export interface FixContext {
  pageId?: string;
  pageSlug?: string;
  pageName?: string;
  issueCheck?: string;
  issueMessage?: string;
  // Brief generation context from Page Intelligence
  primaryKeyword?: string;
  searchIntent?: string;
  optimizationScore?: number;
  optimizationIssues?: string[];
  recommendations?: string[];
  contentGaps?: string[];
  autoGenerate?: boolean;
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: No new errors (existing consumers use optional fields, so no breakage).

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: extend FixContext with Page Intelligence analysis fields"
```

---

### Task 2: Pass analysis context from PageIntelligence "Create Brief" button

**Files:**
- Modify: `src/components/PageIntelligence.tsx:1165-1166`

The "Create Brief" button at line 1165-1166 currently passes only `pageSlug` and `pageName`. The variables `kw` and `sp` are already in scope at this point — they hold the keyword strategy page data with all analysis fields.

- [ ] **Step 1: Update the Create Brief navigation to pass full context**

At line 1165-1166 in `src/components/PageIntelligence.tsx`, replace the existing `onClick` handler:

Old code (line 1165-1166):
```tsx
<button
  onClick={() => navigate(adminPath(workspaceId, 'seo-briefs'), { state: { fixContext: { pageSlug: page.slug, pageName: page.title } } })}
```

New code:
```tsx
<button
  onClick={() => {
    const analysis = sp || kw;
    navigate(adminPath(workspaceId, 'seo-briefs'), {
      state: {
        fixContext: {
          pageSlug: page.slug,
          pageName: page.title,
          primaryKeyword: analysis?.primaryKeyword || undefined,
          searchIntent: analysis?.searchIntent || undefined,
          optimizationScore: analysis?.optimizationScore ?? undefined,
          optimizationIssues: analysis?.optimizationIssues?.length ? analysis.optimizationIssues : undefined,
          recommendations: analysis?.recommendations?.length ? analysis.recommendations : undefined,
          contentGaps: analysis?.contentGaps?.length ? analysis.contentGaps : undefined,
          autoGenerate: true,
        },
      },
    });
  }}
```

Note: `sp` is the strategy page entry (from `pageMap`), `kw` is the keyword map entry. Both have the same analysis fields. `sp` is preferred as it's the richer source.

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/PageIntelligence.tsx
git commit -m "feat: pass full analysis context from Page Intelligence to brief generator"
```

---

### Task 3: Auto-generate brief and pass analysis context to API

**Files:**
- Modify: `src/components/ContentBriefs.tsx:102-110,290-302`

- [ ] **Step 1: Update fixContext consumption to use primaryKeyword and auto-generate**

In `src/components/ContentBriefs.tsx`, replace the existing fixContext effect (lines 102-110):

Old code:
```typescript
  // Auto-fill keyword from audit Fix→
  const fixConsumed = useRef(false);
  useEffect(() => {
    if (fixContext && !fixConsumed.current) {
      fixConsumed.current = true;
      const prefill = fixContext.pageName || fixContext.pageSlug || '';
      if (prefill) setKeyword(prefill.replace(/-/g, ' '));
    }
  }, [fixContext]);
```

New code:
```typescript
  // Auto-fill keyword from Page Intelligence context and optionally auto-generate
  const fixConsumed = useRef(false);
  useEffect(() => {
    if (fixContext && !fixConsumed.current) {
      fixConsumed.current = true;
      // Prefer the actual primary keyword over page name
      const prefill = fixContext.primaryKeyword || fixContext.pageName || fixContext.pageSlug || '';
      if (prefill) setKeyword(prefill.replace(/-/g, ' '));
    }
  }, [fixContext]);

  // Auto-generate when arriving from Page Intelligence with autoGenerate flag
  const autoGenTriggered = useRef(false);
  useEffect(() => {
    if (fixContext?.autoGenerate && !autoGenTriggered.current && keyword.trim() && !generating) {
      autoGenTriggered.current = true;
      handleGenerate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, fixContext?.autoGenerate]);
```

Note: The auto-generate effect depends on `keyword` being set first (by the previous effect), so it fires on the next render after keyword is populated. The `autoGenTriggered` ref prevents re-firing.

- [ ] **Step 2: Pass analysis context in the API call**

In the same file, update `handleGenerate` (lines 290-302) to include the analysis context:

Old code:
```typescript
  const handleGenerate = async () => {
    if (!keyword.trim()) return;
    setGenerating(true);
    setError('');
    try {
      const brief = await post<ContentBrief>(`/api/content-briefs/${workspaceId}/generate`, {
        targetKeyword: keyword.trim(),
        businessContext: businessCtx.trim() || undefined,
        targetPageId: fixContext?.pageId,
        targetPageSlug: fixContext?.pageSlug,
        pageType: pageType || undefined,
        referenceUrls: refUrls.trim() ? refUrls.split('\n').map(u => u.trim()).filter(u => u.startsWith('http')) : undefined,
      });
```

New code:
```typescript
  const handleGenerate = async () => {
    if (!keyword.trim()) return;
    setGenerating(true);
    setError('');
    try {
      const brief = await post<ContentBrief>(`/api/content-briefs/${workspaceId}/generate`, {
        targetKeyword: keyword.trim(),
        businessContext: businessCtx.trim() || undefined,
        targetPageId: fixContext?.pageId,
        targetPageSlug: fixContext?.pageSlug,
        pageType: pageType || undefined,
        referenceUrls: refUrls.trim() ? refUrls.split('\n').map(u => u.trim()).filter(u => u.startsWith('http')) : undefined,
        pageAnalysisContext: fixContext?.optimizationIssues || fixContext?.recommendations || fixContext?.contentGaps
          ? {
              optimizationScore: fixContext.optimizationScore,
              optimizationIssues: fixContext.optimizationIssues,
              recommendations: fixContext.recommendations,
              contentGaps: fixContext.contentGaps,
              searchIntent: fixContext.searchIntent,
            }
          : undefined,
      });
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ContentBriefs.tsx
git commit -m "feat: auto-generate brief with analysis context from Page Intelligence"
```

---

### Task 4: Accept and forward analysis context on the backend

**Files:**
- Modify: `server/routes/content-briefs.ts:77,171-183`
- Modify: `server/content-brief.ts:720-742,869-877`

- [ ] **Step 1: Accept `pageAnalysisContext` in the route handler**

In `server/routes/content-briefs.ts`, update line 77 to destructure the new field:

Old code:
```typescript
    const { targetKeyword, businessContext, pageType, referenceUrls } = req.body;
```

New code:
```typescript
    const { targetKeyword, businessContext, pageType, referenceUrls, pageAnalysisContext } = req.body;
```

Then pass it through to `generateBrief` at line 171-183. Add `pageAnalysisContext` to the context object:

Old code:
```typescript
    const brief = await generateBrief(req.params.workspaceId, targetKeyword, {
      relatedQueries,
      businessContext: adaptedBusinessContext,
      existingPages,
      semrushMetrics,
      semrushRelated,
      pageType: resolvedPageType,
      referenceUrls: refUrlList.length > 0 ? refUrlList : undefined,
      scrapedReferences: scrapedRefs.length > 0 ? scrapedRefs : undefined,
      serpData: serpData ? { peopleAlsoAsk: serpData.peopleAlsoAsk, organicResults: serpData.organicResults } : undefined,
      ga4PagePerformance: ga4Performance.length > 0 ? ga4Performance : undefined,
      styleExamples: stylePages.length > 0 ? stylePages : undefined,
    });
```

New code:
```typescript
    const brief = await generateBrief(req.params.workspaceId, targetKeyword, {
      relatedQueries,
      businessContext: adaptedBusinessContext,
      existingPages,
      semrushMetrics,
      semrushRelated,
      pageType: resolvedPageType,
      referenceUrls: refUrlList.length > 0 ? refUrlList : undefined,
      scrapedReferences: scrapedRefs.length > 0 ? scrapedRefs : undefined,
      serpData: serpData ? { peopleAlsoAsk: serpData.peopleAlsoAsk, organicResults: serpData.organicResults } : undefined,
      ga4PagePerformance: ga4Performance.length > 0 ? ga4Performance : undefined,
      styleExamples: stylePages.length > 0 ? stylePages : undefined,
      pageAnalysisContext: pageAnalysisContext || undefined,
    });
```

- [ ] **Step 2: Add `pageAnalysisContext` to the `generateBrief` context type**

In `server/content-brief.ts`, add the field to the context parameter type (after line 741, before the closing `}`):

```typescript
    // Pre-computed page analysis from Page Intelligence (avoids re-lookup)
    pageAnalysisContext?: {
      optimizationScore?: number;
      optimizationIssues?: string[];
      recommendations?: string[];
      contentGaps?: string[];
      searchIntent?: string;
    };
```

- [ ] **Step 3: Inject `pageAnalysisContext` into the AI prompt**

In `server/content-brief.ts`, find where `pageAnalysisBlock` is built (around line 763). Add a fallback that uses the passed context when the auto-lookup doesn't find a match. Replace:

Old code (lines 758-765):
```typescript
  // Find if any page in the strategy targets this keyword — inject its analysis data
  const matchedPage = strategy?.pageMap?.find(p =>
    p.primaryKeyword?.toLowerCase() === targetKeyword.toLowerCase()
    || p.secondaryKeywords?.some(sk => sk.toLowerCase() === targetKeyword.toLowerCase())
  );
  const pageAnalysisBlock = matchedPage
    ? buildPageAnalysisContext(workspaceId, matchedPage.pagePath)
    : '';
```

New code:
```typescript
  // Find if any page in the strategy targets this keyword — inject its analysis data
  const matchedPage = strategy?.pageMap?.find(p =>
    p.primaryKeyword?.toLowerCase() === targetKeyword.toLowerCase()
    || p.secondaryKeywords?.some(sk => sk.toLowerCase() === targetKeyword.toLowerCase())
  );
  let pageAnalysisBlock = matchedPage
    ? buildPageAnalysisContext(workspaceId, matchedPage.pagePath)
    : '';

  // If no match found via keyword lookup, use pre-computed analysis from Page Intelligence
  if (!pageAnalysisBlock && context.pageAnalysisContext) {
    const pac = context.pageAnalysisContext;
    const parts: string[] = [];
    if (pac.optimizationScore !== undefined) parts.push(`Optimization score: ${pac.optimizationScore}/100`);
    if (pac.searchIntent) parts.push(`Search intent: ${pac.searchIntent}`);
    if (pac.optimizationIssues?.length) parts.push(`Issues to address:\n${pac.optimizationIssues.map(i => `- ${i}`).join('\n')}`);
    if (pac.contentGaps?.length) parts.push(`Content gaps to fill:\n${pac.contentGaps.map(g => `- ${g}`).join('\n')}`);
    if (pac.recommendations?.length) parts.push(`Recommendations from page analysis:\n${pac.recommendations.map(r => `- ${r}`).join('\n')}`);
    if (parts.length > 0) {
      pageAnalysisBlock = `\n\nPAGE ANALYSIS CONTEXT (from prior Page Intelligence analysis — address these specific issues in the brief):\n${parts.join('\n')}`;
    }
  }
```

- [ ] **Step 4: Verify types compile and build succeeds**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`
Expected: No errors, successful build.

- [ ] **Step 5: Commit**

```bash
git add server/routes/content-briefs.ts server/content-brief.ts
git commit -m "feat: accept and inject page analysis context in brief generation"
```

---

### Task 5: Alphabetically sort workspaces

**Files:**
- Modify: `src/hooks/admin/useWorkspaces.ts:10-14`

- [ ] **Step 1: Sort workspaces by name in the hook**

In `src/hooks/admin/useWorkspaces.ts`, update the `useWorkspaces` function:

Old code:
```typescript
export function useWorkspaces() {
  return useQuery<Workspace[]>({
    queryKey: WORKSPACES_KEY,
    queryFn: () => get<Workspace[]>('/api/workspaces'),
    staleTime: STALE_TIMES.STABLE,
  });
}
```

New code:
```typescript
export function useWorkspaces() {
  return useQuery<Workspace[]>({
    queryKey: WORKSPACES_KEY,
    queryFn: async () => {
      const data = await get<Workspace[]>('/api/workspaces');
      return data.sort((a, b) => a.name.localeCompare(b.name));
    },
    staleTime: STALE_TIMES.STABLE,
  });
}
```

- [ ] **Step 2: Verify types compile and build succeeds**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`
Expected: No errors, successful build.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/admin/useWorkspaces.ts
git commit -m "feat: sort workspaces alphabetically in useWorkspaces hook"
```

---

### Task 6: Final verification

- [ ] **Step 1: Full build check**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`
Expected: Clean compilation and build.

- [ ] **Step 2: Run test suite**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 3: Run pr-check**

Run: `npx tsx scripts/pr-check.ts`
Expected: Zero errors.

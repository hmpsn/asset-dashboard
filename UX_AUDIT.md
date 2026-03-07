# UX Audit — Full Component Review

## Audit Date: March 6, 2026

---

## 1. Accessibility Fixes (Already Completed)
- ✅ `text-zinc-600` → `text-zinc-500` (contrast 2.6:1 → 3.8:1)
- ✅ `text-[9px]` → `text-[11px]` (minimum readable size)
- ✅ `text-[10px]` → `text-[11px]` (modest readability bump)
- 🔴 `text-[8px]` still exists in 8 places (ContentBriefs, ClientDashboard) — needs fix

## 2. Empty States — Missing or Weak

| Component | Has Empty State? | Notes |
|-----------|-----------------|-------|
| SearchConsole | ❌ | Shows spinner then nothing if no GSC property configured |
| GoogleAnalytics | ❌ | Shows spinner then nothing if no GA4 property configured |
| CompetitorAnalysis | ⚠️ | Has input form but no guidance text when no results |
| InternalLinks | ❌ | Shows nothing when no internal link data exists |
| RedirectManager | ❌ | Shows nothing when no redirect scan has been run |
| SchemaSuggester | ❌ | Shows nothing when no schema data exists |
| MediaTab | ⚠️ | Has drop zones but no onboarding text for new workspaces |
| Performance | ⚠️ | Sub-tabs exist but PageWeight/PageSpeed lack empty guidance |
| SeoAudit | ✅ | Good empty state with "Run SEO Audit" CTA |
| RankTracker | ✅ | Good empty state with guidance |
| KeywordStrategy | ✅ | Good empty state with "Generate Strategy" CTA |
| ContentBriefs | ✅ | Good empty state with guidance |
| RequestManager | ✅ | Good empty state |
| ClientDashboard | ✅ | Good empty states across all tabs |

## 3. Cross-Linking Between Tools — Gaps

### Admin Panel
The sidebar navigation allows switching between all tools, but **no tool contextually references related tools**. This means users must discover connections themselves.

**Missing cross-links:**
- **Site Audit results** → Should suggest "Fix these in SEO Editor" for title/meta issues
- **Site Audit** → Should link to "Check Redirects" when 404s are found
- **Strategy** → Should mention "Create Content Briefs" for content gap topics
- **SearchConsole** → Should hint at "Build a Strategy" if no strategy exists
- **RankTracker** → Should reference Strategy for keyword context
- **InternalLinks** → Should reference SEO Editor for implementing suggestions
- **Performance** → Should reference Site Audit for related health issues

### Client Dashboard
- ✅ Overview → already cross-links to Search, Health, Analytics, Strategy
- ✅ Strategy → already links to Content tab for content gaps
- ✅ Content → already links to Strategy tab
- ✅ Health → links back to overview context

## 4. Data Display Assessment

### Charts & Visualization
- ✅ SVG sparklines in overview cards — effective
- ✅ Trend charts with hover details — good interactivity
- ✅ Score gauges with color coding — clear
- ✅ Mini sparklines in metric cards — good density

### Tables & Lists
- ✅ Most tables support sorting
- ✅ Search/filter available in key views (Strategy page map, Redirects, Internal Links)
- ⚠️ SearchConsole query table — could benefit from sparkline trends per query
- ⚠️ Some tables lack clear "sort by" visual indicators

### Loading States
- ✅ Most components use Loader2 spinner
- ⚠️ No skeleton loading — could improve perceived performance
- ⚠️ Some components show nothing during load (no "loading" text)

## 5. Priority Implementation Plan

### P0 — Fix Now
1. Fix `text-[8px]` → `text-[11px]` (accessibility)
2. Add empty states to SearchConsole, GoogleAnalytics, and other admin tools
3. Add contextual cross-link hints between related admin tools

### P1 — Next Sprint
4. Add aria-labels to icon-only buttons
5. Add skeleton loading states
6. Add tooltips for metric abbreviations (CTR, KD, etc.)

### P2 — Future
7. Add keyboard navigation improvements
8. Add per-query sparkline trends in SearchConsole
9. Add export capabilities to more views

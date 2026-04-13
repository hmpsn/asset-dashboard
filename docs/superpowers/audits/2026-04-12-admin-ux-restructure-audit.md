# Admin UX Restructure — Pre-Plan Audit

> **Date:** 2026-04-12
> **Method:** 8 parallel explore agents + 1 pre-plan file-mapping agent
> **Scope:** All 22+ admin pages, sidebar navigation, 4 nav groups, global tabs, client handoff

---

## Audit Summary

**Total files affected:** 26+ across 5 PR gates

### PR 1: Navigation Restructure (5 files)
| File | Change |
|---|---|
| `src/components/layout/Sidebar.tsx` | Rename groups, split SEO, add ADMIN section, remove brief/calendar from nav |
| `src/components/layout/Breadcrumbs.tsx` | Update TAB_LABELS display names |
| `src/components/CommandPalette.tsx` | Update group labels, add ADMIN items |
| `src/App.tsx` | Update keyboard shortcuts, GLOBAL_TABS, SEO_TABS |
| `src/routes.ts` | No route ID changes (display-only rename) |

### PR 2: Per-Page Layout (12 files)
| File | Change |
|---|---|
| `src/components/WorkspaceHome.tsx` | Add tab bar, embed Meeting Brief as tab |
| `src/components/ContentPipeline.tsx` | Add Calendar tab, remove Arch/LLMs tabs |
| `src/components/SeoAudit.tsx` | Remove Dead Links tab |
| `src/components/LinksPanel.tsx` | Add Dead Links tab |
| `src/components/KeywordStrategy.tsx` | Reorder: settings up, Quick Wins first |
| `src/components/admin/outcomes/OutcomeDashboard.tsx` | Reorder tabs: wins first |
| `src/components/AnalyticsHub.tsx` | Reorder tabs: annotations second |
| `src/components/MediaTab.tsx` | Reorder tabs: audit first |
| `src/App.tsx` | Route cleanup, redirects, Requests tab split |
| `src/components/PageIntelligence.tsx` | Add Architecture subtab |
| `src/components/WorkspaceSettings.tsx` | Add LLMs.txt section |
| `src/components/ContentCalendar.tsx` | No changes (imported into Pipeline) |

### PR 3: Shared UX Components (10+ files)
| File | Change |
|---|---|
| `src/components/ui/NextStepsCard.tsx` | NEW — post-action guidance |
| `src/components/ui/ProgressIndicator.tsx` | NEW — standardized async progress |
| `src/components/ui/ErrorRecoveryCard.tsx` | NEW — guided error recovery |
| `src/components/SeoAudit.tsx` | Integrate NextSteps + Progress + Error |
| `src/components/KeywordStrategy.tsx` | Integrate NextSteps + Error |
| `src/components/SchemaSuggester.tsx` | Integrate NextSteps + Progress + Error |
| `src/components/ContentPipeline.tsx` | Integrate NextSteps |
| `src/components/BrandHub.tsx` | Integrate NextSteps + Error |
| `src/components/PageIntelligence.tsx` | Integrate NextSteps + Error |
| Multiple files | Empty state CTA audit |

### PR 4: Onboarding & Guided Flows (10+ files)
| File | Change |
|---|---|
| `src/components/ui/OnboardingChecklist.tsx` | NEW |
| `src/components/ui/WorkflowStepper.tsx` | NEW |
| `src/components/ui/WorkspaceHealthBar.tsx` | NEW |
| `src/components/schema/SchemaWorkflowGuide.tsx` | NEW |
| `src/components/audit/SeoAuditGuide.tsx` | NEW |
| `src/components/strategy/KeywordStrategyGuide.tsx` | NEW |
| `src/components/PageIntelligenceGuide.tsx` | NEW |
| `src/components/WorkspaceHome.tsx` | Integrate Onboarding + HealthBar |
| `src/components/ContentPipeline.tsx` | Integrate WorkflowStepper |
| `src/components/SchemaSuggester.tsx` | Integrate WorkflowStepper |

### PR 5: Client Handoff & Cohesion (10+ files)
| File | Change |
|---|---|
| `src/components/ui/ApprovalModal.tsx` | NEW |
| `src/components/admin/ClientPreview.tsx` | NEW |
| `src/components/ui/ApprovalTimeline.tsx` | NEW |
| `src/components/SeoEditor.tsx` | Wire to ApprovalModal |
| `src/components/schema/SchemaPlanPanel.tsx` | Wire to ApprovalModal |
| `src/components/brand/CopyReviewPanel.tsx` | Wire to ApprovalModal |
| `src/components/ContentBriefs.tsx` | Wire to ApprovalModal |
| `src/components/editor/ApprovalPanel.tsx` | Delegate to ApprovalModal |
| `src/components/ContentPerformance.tsx` | Add "Edit Post" cross-link |
| `src/components/WorkspaceHome.tsx` | Command palette search + quick actions |

---

## Approval Pattern Locations (5 found)

1. `src/components/SeoEditor.tsx` — `sendPageToClient()` + ApprovalPanel
2. `src/components/schema/SchemaPlanPanel.tsx` — `schemaPlan.sendToClient(siteId)`
3. `src/components/brand/CopyReviewPanel.tsx` — "Send to Client Review" button
4. `src/components/ContentBriefs.tsx` — POST to `/api/content-briefs/{wid}/{id}/send-to-client`
5. `src/components/editor/ApprovalPanel.tsx` — standalone button component

---

## Key Design Decisions

1. **Route IDs stay the same** — `analytics-hub`, `seo-strategy`, etc. Only display labels change. Avoids breaking bookmarks/deep links.
2. **Architecture → PageIntelligence subtab** (site structure is per-page analysis)
3. **LLMs.txt → WorkspaceSettings** (it's a deploy config tool, not daily workflow)
4. **Brief route stays for backward compat** — renders MeetingBriefPage, but nav discovery is via Home tab
5. **Calendar route redirects** to Pipeline with tab=calendar

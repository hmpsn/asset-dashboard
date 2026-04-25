# UI Primitive Audit — Phase 2 Findings

> Generated 2026-04-23. Migration checklist for Phase 3.
> Decision key: **default** = SectionCard default, **subtle** = SectionCard subtle, **hatch** = keep with `// pr-check-disable-next-line` justification comment.

## Summary

| Cluster | Files | Default | Subtle | Hatch | Total instances |
|---------|-------|---------|--------|-------|----------------|
| brand/ | 5 | 11 | 4 | 0 | 15 |
| client/ | 10 | 10 | 5 | 4 | 19 |
| settings/ | 5 | 14 | 2 | 0 | 16 |
| post-editor/ | 5 | 8 | 1 | 1 | 10 |
| content/top-level | 9 | 4 | 1 | 3 | 8 |
| scattered | 10 | 5 | 3 | 9 | 17 |
| **Total** | **47** | **52** | **16** | **17** | **85** |

## Per-File Detail

### brand/BrandscriptTab.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 52 | `<form ...className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">` | default | New brandscript form with "New Brandscript" heading |
| 136 | `<form ...className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">` | default | Import brandscript form with heading |
| 240 | `<div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">` | default | Expandable section wrapper with title button |
| 540 | `className="w-full text-left bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 ..."` | subtle | List item button row inside list container |

### brand/DiscoveryTab.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 101 | `<div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">` | default | Extraction detail card with header row |
| 335 | `<form ...className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">` | default | "Paste Text Source" form with heading |
| 454 | `<div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">` | default | "Upload Files" section with heading |
| 547 | `<div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 flex items-center ...">` | subtle | Source list row — compact item inside list |

### brand/VoiceTab.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 150 | `<form ...className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">` | default | "Add Voice Sample" form with heading |
| 221 | `<div ...className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-start gap-3">` | subtle | Voice sample list item inside list map |
| 871 | `className={`bg-zinc-900 border rounded-xl p-4 space-y-3 ...`}` | default | Variation card with "Variation N" header |
| 975 | `<div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">` | default | "Refine" panel with heading |

### brand/PageStrategyTab.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 102 | `<div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">` | default | "New Blueprint" create form with heading |
| 200 | `className="group flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 ..."` | subtle | Blueprint list item row |

### brand/CopyReviewPanel.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 391 | `<div className="bg-zinc-900 border border-red-900/40 rounded-xl p-6 text-center">` | default | Error state card with heading ("Failed to load copy sections") |

### client/DataSnapshots.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 279 | `<div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">` | default | Organic overview top-level section |
| 325 | `<div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">` | default | "New vs Returning Visitors" panel with heading |
| 358 | `<div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">` | default | "Top Organic Landing Pages" panel with heading |

### client/HealthTab.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 180 | `<div className="absolute right-0 top-full mt-2 w-80 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl z-50 overflow-hidden">` | hatch | Shareable Reports popover dropdown |
| 265 | `<div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-[12px]">` | subtle | Compact audit-delta status bar, no header |

### client/PlansTab.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 227 | `<div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">` | default | "Content Services" section with heading |
| 273 | `<div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">` | default | "Monthly Content Packages" section with heading |
| 376 | `<div className="text-center py-6 bg-zinc-900/50 rounded-xl border border-zinc-800">` | subtle | Contact CTA strip, no section header |

### client/SearchTab.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 88 | `<div className="bg-zinc-900/60 border border-zinc-800 rounded-xl px-5 py-3.5 flex items-start gap-3">` | subtle | AI takeaway summary bar — compact, no heading |
| 105 | `<div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">` | default | "Search Health Summary" section with heading |
| 144 | `<div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">` | default | "Performance Trend" chart section with heading |
| 158 | `<div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">` | default | "Timeline Annotations" section with heading |
| 178 | `<div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">` | subtle | "Raw Data" collapsible table wrapper |

### client/StrategyTab.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 1198 | `<div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 w-full max-w-md shadow-2xl" ...>` | hatch | Decline Reason modal dialog |

### client/FixRecommendations.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 414 | `<div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">` | default | "Recommended Fixes" top-level panel with header |

### client/SeoGlossary.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 171 | `<div className="absolute z-50 bottom-full ... w-72 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl p-3 ...">` | hatch | Glossary term tooltip/popover |

### client/OutcomeSummary.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 165 | `<div className="border border-zinc-700/50 rounded-xl p-4 space-y-3 bg-zinc-900/50">` | subtle | Detailed breakdown panel nested inside scorecard |

### client/OrderStatus.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 75 | `<div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">` | default | "Your Fix Orders" top-level section with header |

### client/ClientHeader.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 106 | `<div className="relative flex items-center gap-1 bg-zinc-900 rounded-lg border border-zinc-800 p-0.5">` | hatch | Date-range segmented control toolbar, not a card |
| 132 | `<div className="fixed sm:absolute inset-x-0 bottom-0 ... bg-zinc-900 border-t sm:border border-zinc-700 rounded-t-2xl sm:rounded-xl shadow-2xl p-4 sm:w-72" ...>` | hatch | Custom date picker popover/bottom-sheet |

### settings/ConnectionsTab.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 47 | `<section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">` | default | "Webflow Site" section with header |
| 98 | `<section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">` | default | "Google Auth" section with header |
| 126 | `<section className="rounded-xl bg-zinc-900 border border-zinc-800">` | default | "Search Console Property" section with header |
| 147 | `<section className="rounded-xl bg-zinc-900 border border-zinc-800">` | default | "GA4 Property" section with header |

### settings/FeaturesTab.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 38 | `<section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">` | default | "Workspace Tier" section with header |
| 89 | `<section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">` | default | "Client Portal Toggles" section with header |
| 229 | `<section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">` | default | "Automated Reports" section with header |
| 303 | `<section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">` | default | "Branding" section with header |

### settings/ClientDashboardTab.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 243 | `<section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">` | default | "Client Access" section with header |
| 326 | `<section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">` | default | "Client Users" section with header |
| 487 | `<section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">` | default | "Content Pricing" section with header |
| 611 | `<section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">` | default | "Event Display & Pinning" section with header |

### settings/BusinessProfileTab.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 123 | `<div className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">` | default | "Business Profile" top-level section with header |
| 316 | `<div className="rounded-xl bg-zinc-900/50 border border-zinc-800 px-4 py-3 text-[11px] text-zinc-500 space-y-1">` | subtle | "How this is used" context note, no formal header |

### settings/IntelligenceProfileTab.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 81 | `<div className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">` | default | "Business Intelligence Profile" top-level section with header |
| 161 | `<div className="rounded-xl bg-zinc-900/50 border border-zinc-800 px-4 py-3 text-[11px] text-zinc-500 space-y-1">` | subtle | "How this is used" context note, no formal header |

### post-editor/PostPreview.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 30 | `<div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 prose prose-invert ...">` | default | Post preview article container (title rendered inside as H1) |

### post-editor/ReviewChecklist.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 85 | `<div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">` | default | "Review Checklist" collapsible section with header button |

### post-editor/SectionEditor.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 48 | `<div className={`bg-zinc-900 rounded-xl border overflow-hidden ${...}`}>` | default | Editable section card with title/status header |

### post-editor/VersionHistory.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 28 | `<div className="bg-zinc-900 rounded-xl border border-teal-500/20 overflow-hidden">` | default | "Version History" panel with header |

### PostEditor.tsx (top-level)
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 261 | `<div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">` | hatch | Delete confirmation modal |
| 363 | `<div className="bg-zinc-900 rounded-xl border border-amber-500/20 p-4">` | default | Generation progress panel with status header |
| 409 | `<div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">` | default | "Introduction" editor section with header |
| 458 | `<div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">` | default | "Conclusion" editor section with header |
| 492 | `<div className="bg-zinc-900 rounded-xl border border-teal-500/30 p-4 space-y-3">` | default | Publish confirmation dialog-style inline panel with header |
| 537 | `<div className="bg-zinc-900/50 rounded-xl border border-zinc-800/50 px-4 py-3 space-y-3">` | subtle | SEO Metadata summary strip, no header |

### ContentPipeline.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 203 | `<div className="absolute right-0 top-full mt-1 w-56 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl z-20 py-1 overflow-hidden">` | hatch | Export menu dropdown |

### ContentBriefs.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 402 | `<div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">` | hatch | Delete confirmation modal |

### CmsEditor.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 588 | `<div key={coll.collectionId} className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">` | default | Collection panel with toggleable header |

### RankTracker.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 453 | `<div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-3">` | subtle | "Tracked but no rank data" compact list wrapper, no header |

### RevenueDashboard.tsx
_No hand-rolled card instances found._ (Line 82 is a loading skeleton placeholder, not a card instance.)

### SalesReport.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 156 | `<div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 text-center">` | default | Report URL input panel (empty state) |
| 183 | `<div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-4">` | default | Report summary panel |

### MediaTab.tsx
_No hand-rolled card instances found._ (Lines 69 and 82 are 12x12 icon-wrapper divs, not cards.)

### PublishSettings.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 183 | `<div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-4">` | default | "CMS Collection" selector section with header |

### RequestManager.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 307 | `<div className="rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap bg-zinc-900 border-2 border-teal-400" style={{ boxShadow: '0 0 12px rgba(45,212,191,0.1)' }}>` | hatch | Floating bulk-action toolbar, not a content card |

### audit/AuditReportExport.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 164 | `<div className="relative max-w-md w-full mx-4 bg-zinc-900 rounded-xl border border-zinc-700 p-6" ...>` | hatch | Export report modal dialog |

### charts/AnnotatedTrendChart.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 171 | `<div className="bg-zinc-900 border border-zinc-700 rounded-lg p-2 shadow-lg text-center">` | hatch | Chart-dot hover tooltip rendered inside SVG foreignObject |
| 229 | `<div ref={popoverRef} className="absolute z-50 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl p-3 w-64" ...>` | hatch | Annotation edit popover |

### editor/BulkOperations.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 80 | `<div className="bg-zinc-900 rounded-xl border border-teal-500/30 p-4 space-y-3">` | default | "Pattern Apply" operation panel with heading |
| 129 | `<div className="bg-zinc-900 rounded-xl border border-teal-500/30 overflow-hidden">` | default | "Preview Changes" operation panel with heading |

### editor/PageEditRow.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 98 | `<div id={`seo-editor-page-${page.id}`} className={`bg-zinc-900 rounded-xl border overflow-hidden ${...}`}>` | default | Page edit row — top-level per-page card with header row |

### schema/PagePicker.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 26 | `<div className="absolute right-0 top-full mt-1 w-72 bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-xl z-20">` | hatch | Page picker dropdown popover |
| 90 | `<div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mt-2">` | subtle | Inline page picker panel (not floating, nested in form) |

### briefs/RequestList.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 114 | `<div className="bg-zinc-900 rounded-xl border border-amber-500/20 p-4 space-y-3">` | default | "Client Content Requests" top-level panel with header |
| 142 | `<div key={req.id} className="rounded-xl bg-zinc-900 border border-zinc-800 overflow-hidden">` | subtle | Per-request expandable row nested inside list |

### shared/RankTable.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 138 | `<div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">` | default | "Keyword Rank Tracking" section with header |

### Toast.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 70 | `className={`pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-xl bg-zinc-900 border ${borders[item.type]} shadow-2xl ...`}` | hatch | Toast notification element |

### WorkspaceSelector.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 110 | `<div className="absolute top-full left-0 mt-2 w-80 rounded-xl shadow-2xl z-50 overflow-hidden bg-zinc-900 border border-zinc-700">` | hatch | Workspace selector dropdown |
| 160 | `<div className="absolute right-0 top-full mt-1 w-36 rounded-lg shadow-xl z-50 py-1 bg-zinc-900 border border-zinc-700">` | hatch | Per-workspace actions menu (MoreHorizontal popover) |
| 174 | `<div className="mx-2 mb-1 p-2 rounded-lg bg-zinc-900 border border-zinc-800">` | subtle | Inline site-linking panel nested in dropdown row |
| 276 | `<div className="w-80 rounded-xl p-5 shadow-2xl bg-zinc-900 border border-zinc-700" ...>` | hatch | Delete workspace confirmation modal |

### CommandPalette.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 324 | `<div className="relative w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden" ...>` | hatch | Command palette modal container |

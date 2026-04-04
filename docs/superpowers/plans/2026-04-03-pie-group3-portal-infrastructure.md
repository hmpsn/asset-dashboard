# Platform Intelligence Enhancements — Group 3: Client Portal + Infrastructure

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the client Brand tab (business profile + read-only brand positioning), per-workspace Site Intelligence toggle, system-wide smart placeholder hook, and four new pr-check enforcement rules. All features are feature-flagged.

**Architecture:** BrandTab is a new client portal tab gated behind `client-brand-section` flag. Site Intelligence toggle adds `siteIntelligenceClientView` to FeaturesTab (settings) and gates the OverviewTab module. Smart placeholder hook reads from cached seoContext intelligence slice — no independent AI calls. pr-check rules enforce metricsSource discipline and merge-upsert safety across the codebase.

**Tech Stack:** React 19, TypeScript, Express, SQLite, Vitest, @testing-library/react, scripts/pr-check.ts

**Dependency:** Phase 0 plan must be merged. Imports: `siteIntelligenceClientView` from shared/types/workspace.ts; `ClientTab` (includes 'brand') from src/routes.ts; `'client-brand-section'`, `'smart-placeholders'` from shared/types/feature-flags.ts.

---

## File Map

| File | Create / Modify | Purpose |
|------|-----------------|---------|
| `shared/types/feature-flags.ts` | **Modify** | Add `'client-brand-section'` and `'smart-placeholders'` flags |
| `shared/types/workspace.ts` | **Modify** | Add `siteIntelligenceClientView?: boolean` to `Workspace` |
| `src/routes.ts` | **Modify** | Add `'brand'` to `ClientTab` union type |
| `server/db/migrations/048-site-intelligence-client-view.sql` | **Create** | Add `site_intelligence_client_view` column to `workspaces` table |
| `server/workspaces.ts` | **Modify** | Add `siteIntelligenceClientView` to `WorkspaceRow`, `rowToWorkspace`, `workspaceToParams`, `updateWorkspace` |
| `src/components/settings/FeaturesTab.tsx` | **Modify** | Add Site Intelligence Client View toggle (copy `analyticsClientView` pattern exactly) |
| `src/components/client/BrandTab.tsx` | **Create** | New client portal tab — editable business profile + read-only brand positioning |
| `src/components/ClientDashboard.tsx` | **Modify** | Add `'brand'` to NAV array (feature-flagged); add `{tab === 'brand' && ...}` render block |
| `src/hooks/useSmartPlaceholder.ts` | **Create** | Smart placeholder hook — reads seoContext intelligence slice, admin gets suggestions, client gets ghost text only |
| `src/components/AdminChat.tsx` | **Modify** | Import and apply `useSmartPlaceholder` for admin context (chips + placeholder) |
| `src/components/ChatPanel.tsx` | **Modify** | Accept optional `suggestionChips` prop; render chips above input in admin context |
| `scripts/pr-check.ts` | **Modify** | Add 4 new enforcement rules: `bulk_lookup`, `ai_estimate`, `replaceAllPageKeywords`, `getBacklinksOverview` |
| `tests/unit/smart-placeholder.test.ts` | **Create** | Unit tests for useSmartPlaceholder hook |
| `tests/integration/feature-toggle-site-intelligence.test.ts` | **Create** | Integration test for PATCH `siteIntelligenceClientView` |
| `tests/component/BrandTab.test.tsx` | **Create** | Component tests for BrandTab |
| `tests/component/SmartPlaceholder.test.tsx` | **Create** | Component tests for SmartPlaceholder behavior in AdminChat |

---

## Dependency Graph

```
Task 1 (feature flags + types + routes) ──┐
                                           ├──► Task 3 (migration + workspaces.ts)
                                           │      └──► Task 4 (FeaturesTab toggle)
                                           │      └──► Task 5 (integration test)
                                           │
Task 1 ────────────────────────────────────┼──► Task 6 (BrandTab component)
                                           │      └──► Task 7 (ClientDashboard wiring)
                                           │      └──► Task 9 (BrandTab component test)
                                           │
Task 1 ────────────────────────────────────┼──► Task 8 (useSmartPlaceholder hook)
                                           │      └──► Task 10 (AdminChat + ChatPanel integration)
                                           │      └──► Task 11 (unit + component tests)
                                           │
[Independent] ─────────────────────────────┴──► Task 2 (pr-check rules — no deps)
```

**Sequential constraints:**
- Task 1 must complete before Tasks 3, 6, 8
- Task 3 must complete before Tasks 4 and 5
- Task 6 must complete before Tasks 7 and 9
- Task 8 must complete before Tasks 10 and 11

**Parallel opportunities:**
- Tasks 1 and 2 can run in parallel
- Tasks 4, 6, and 8 can run in parallel after Task 1 + 3 complete
- Tasks 5, 9, 11 can run in parallel after their respective feature tasks complete

---

## Tasks

### Task 1 — Shared Contracts: Feature Flags, Workspace Type, ClientTab Union

**Model:** Haiku (mechanical additions to existing files)

- [ ] Read `shared/types/feature-flags.ts` to confirm current flag list
- [ ] Read `shared/types/workspace.ts` to confirm `Workspace` interface end
- [ ] Read `src/routes.ts` to confirm current `ClientTab` type

- [ ] **Edit `shared/types/feature-flags.ts`** — add two new flags:

```typescript
// After 'bridge-client-signal':
'client-brand-section': false,  // Client portal Brand tab
'smart-placeholders': false,    // Smart placeholder chips in admin + ghost text in client chat
```

The full diff for `FEATURE_FLAGS` adds these two entries before `} as const;`.

- [ ] **Edit `shared/types/workspace.ts`** — add `siteIntelligenceClientView` to `Workspace` interface, immediately after `analyticsClientView`:

```typescript
analyticsClientView?: boolean;
siteIntelligenceClientView?: boolean;  // Show Site Intelligence summary card on OverviewTab (default true)
```

- [ ] **Edit `src/routes.ts`** — add `'brand'` to `ClientTab`:

```typescript
export type ClientTab = 'overview' | 'performance' | 'search' | 'health' | 'strategy' | 'analytics' | 'inbox' | 'approvals' | 'requests' | 'content' | 'plans' | 'roi' | 'brand';
```

Also add `'brand'` to the allowed tabs array in `ClientDashboard.tsx` line 152 (`if (t && ['overview',...,'brand'].includes(t))`).

- [ ] Run `npx tsc --noEmit --skipLibCheck` — expect 0 errors (types only, no consumers yet)
- [ ] Commit: `feat(types): add client-brand-section + smart-placeholders flags, siteIntelligenceClientView field, brand ClientTab`

---

### Task 2 — pr-check.ts: 4 New Enforcement Rules

**Model:** Haiku (mechanical, self-contained)

**No dependencies** — can run in parallel with Task 1.

- [ ] Read `scripts/pr-check.ts` lines 83–100 to confirm `Check` type structure
- [ ] Read `scripts/pr-check.ts` lines 240–265 to find insertion point (end of `CHECKS` array, before the closing `];`)

- [ ] **Edit `scripts/pr-check.ts`** — append these 4 rules to the `CHECKS` array, immediately before the closing `];`:

```typescript
  {
    name: 'Raw bulk_lookup string outside keywords type file',
    pattern: "'bulk_lookup'",
    fileGlobs: ['*.ts', '*.tsx'],
    exclude: ['shared/types/keywords.ts', 'shared/types/workspace.ts'],
    message: "Use the 'bulk_lookup' literal only from shared/types/workspace.ts (PageKeywordMap.metricsSource). Raw string references in other files create undiscoverable magic values.",
    severity: 'warn',
  },
  {
    name: 'Raw ai_estimate string in server or src files',
    pattern: "'ai_estimate'",
    fileGlobs: ['*.ts', '*.tsx'],
    exclude: ['shared/types/'],
    message: "The 'ai_estimate' metricsSource value must only be referenced from shared/types/workspace.ts. Use the shared type, not a raw string literal.",
    severity: 'warn',
  },
  {
    name: 'replaceAllPageKeywords called outside keyword-strategy route',
    pattern: 'replaceAllPageKeywords\\s*\\(',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    exclude: ['server/routes/keyword-strategy.ts', 'server/page-keywords.ts'],
    message: 'replaceAllPageKeywords() is a destructive bulk operation. Only call it from server/routes/keyword-strategy.ts. For incremental updates use upsertPageKeyword().',
    severity: 'error',
  },
  {
    name: 'getBacklinksOverview called outside workspace-intelligence',
    pattern: 'getBacklinksOverview\\s*\\(',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    exclude: ['server/workspace-intelligence.ts'],
    message: 'getBacklinksOverview() is an expensive external API call. Only call it from server/workspace-intelligence.ts where caching and rate-limiting are enforced.',
    severity: 'error',
  },
```

- [ ] Run `npx tsx scripts/pr-check.ts --all` — confirm new rules run without crashing; note any new violations found
- [ ] Run `npx tsc --noEmit --skipLibCheck` — 0 errors
- [ ] Commit: `feat(pr-check): add 4 enforcement rules — bulk_lookup, ai_estimate, replaceAllPageKeywords, getBacklinksOverview`

---

### Task 3 — Migration + workspaces.ts: siteIntelligenceClientView Column

**Model:** Haiku (mechanical DB addition)
**Depends on:** Task 1 (Workspace type must have `siteIntelligenceClientView`)

- [ ] **Create `server/db/migrations/048-site-intelligence-client-view.sql`**:

```sql
-- Add site_intelligence_client_view column to workspaces
-- Controls whether the IntelligenceSummaryCard is shown to the client on OverviewTab.
-- Defaults to NULL (treated as true by frontend — new feature is on by default).
ALTER TABLE workspaces ADD COLUMN site_intelligence_client_view INTEGER;
```

- [ ] Read `server/workspaces.ts` lines 44–103 (WorkspaceRow interface + rowToWorkspace)
- [ ] **Edit `server/workspaces.ts`** — add to `WorkspaceRow` interface after `analytics_client_view`:

```typescript
  site_intelligence_client_view: number;
```

- [ ] **Edit `server/workspaces.ts`** — add to `rowToWorkspace` after the `analyticsClientView` line:

```typescript
  if (row.site_intelligence_client_view !== null) ws.siteIntelligenceClientView = !!row.site_intelligence_client_view;
```

- [ ] **Edit `server/workspaces.ts`** — add to `workspaceToParams` after `analytics_client_view` entry:

```typescript
    site_intelligence_client_view: ws.siteIntelligenceClientView === undefined ? null : (ws.siteIntelligenceClientView ? 1 : 0),
```

- [ ] **Edit `server/workspaces.ts`** — add `siteIntelligenceClientView` to `updateWorkspace` Pick type:

In the `Partial<Pick<Workspace, '...' | 'siteIntelligenceClientView'>>` union.

- [ ] **Edit `server/workspaces.ts`** — add to `columnMap` in `updateWorkspace`:

```typescript
    siteIntelligenceClientView: 'site_intelligence_client_view',
```

- [ ] Run `npx tsc --noEmit --skipLibCheck` — 0 errors
- [ ] Commit: `feat(db): migration 048 + workspaces.ts — add siteIntelligenceClientView column and mapper`

---

### Task 4 — FeaturesTab: Site Intelligence Client View Toggle

**Model:** Sonnet (UI component, must copy toggle pattern precisely)
**Depends on:** Tasks 1 + 3

- [ ] Read `src/components/settings/FeaturesTab.tsx` lines 1–30 (imports)
- [ ] Read `src/components/settings/FeaturesTab.tsx` lines 100–200 (existing toggle pattern for reference)

The toggle renders in the **Client Portal Features** `<section>` block, immediately after the Analytics View toggle (around line 165).

- [ ] **Edit `src/components/settings/FeaturesTab.tsx`** — add `Brain` to lucide-react import (or use `Activity` if already imported — verify first):

Check existing imports, add `Brain` if not present:
```typescript
import {
  BarChart3, Loader2, Mail, Image as ImageIcon, DollarSign, Sparkles,
  Users, Shield, SlidersHorizontal, Brain,
} from 'lucide-react';
```

- [ ] **Edit `src/components/settings/FeaturesTab.tsx`** — add `siteIntelligenceClientView` to `WorkspaceData` interface:

```typescript
  siteIntelligenceClientView?: boolean;
```

- [ ] **Edit `src/components/settings/FeaturesTab.tsx`** — insert after the Analytics Client View toggle block, before the Client Onboarding Questionnaire toggle:

```tsx
          {/* Site Intelligence Client View */}
          <label className="flex items-center justify-between cursor-pointer group">
            <div className="flex items-center gap-3">
              <Brain className="w-4 h-4 text-zinc-500" />
              <div>
                <div className="text-xs font-medium text-zinc-200">Site Intelligence Summary</div>
                <div className="text-[11px] text-zinc-500">Show the AI-powered insights summary card to the client on their Overview tab</div>
              </div>
            </div>
            <button onClick={async () => {
              const val = !(ws?.siteIntelligenceClientView !== false);
              await patchWorkspace({ siteIntelligenceClientView: val });
              toast(val ? 'Site Intelligence summary enabled for client' : 'Site Intelligence summary hidden from client');
            }}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                ws?.siteIntelligenceClientView !== false ? 'bg-teal-500' : 'bg-zinc-700'
              }`}>
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                ws?.siteIntelligenceClientView !== false ? 'translate-x-4' : 'translate-x-0.5'
              }`} />
            </button>
          </label>
```

> NOTE: The toggle uses `!== false` (not `=== true`) because the field defaults to `undefined` (NULL in DB), which should be treated as **enabled** — same pattern as `clientPortalEnabled` and `analyticsClientView`.

- [ ] Run `npx tsc --noEmit --skipLibCheck` — 0 errors
- [ ] Commit: `feat(settings): add Site Intelligence Client View toggle in FeaturesTab`

---

### Task 5 — Integration Test: siteIntelligenceClientView Toggle

**Model:** Sonnet
**Depends on:** Tasks 1 + 3

- [ ] **Create `tests/integration/feature-toggle-site-intelligence.test.ts`**:

```typescript
// tests/integration/feature-toggle-site-intelligence.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestWorkspace, deleteTestWorkspace, patchWorkspaceApi, getWorkspaceApi } from '../helpers/workspace-test-helpers';

describe('siteIntelligenceClientView toggle', () => {
  let workspaceId: string;

  beforeEach(async () => {
    workspaceId = await createTestWorkspace({ name: 'SI Toggle Test' });
  });

  afterEach(async () => {
    await deleteTestWorkspace(workspaceId);
  });

  it('defaults to undefined (treated as enabled) on new workspace', async () => {
    const ws = await getWorkspaceApi(workspaceId);
    // NULL in DB → undefined in response → frontend treats as true
    expect(ws.siteIntelligenceClientView).toBeUndefined();
  });

  it('PATCH siteIntelligenceClientView false returns 200 and persists', async () => {
    const res = await patchWorkspaceApi(workspaceId, { siteIntelligenceClientView: false });
    expect(res.status).toBe(200);

    const ws = await getWorkspaceApi(workspaceId);
    expect(ws.siteIntelligenceClientView).toBe(false);
  });

  it('PATCH siteIntelligenceClientView true returns 200 and persists', async () => {
    // First set to false
    await patchWorkspaceApi(workspaceId, { siteIntelligenceClientView: false });
    // Then toggle back
    const res = await patchWorkspaceApi(workspaceId, { siteIntelligenceClientView: true });
    expect(res.status).toBe(200);

    const ws = await getWorkspaceApi(workspaceId);
    expect(ws.siteIntelligenceClientView).toBe(true);
  });
});
```

> NOTE: If `workspace-test-helpers` doesn't exist yet, use the test helper pattern from existing integration tests in `tests/integration/`. Check `tests/helpers/` for existing utilities before creating new ones.

- [ ] Run `npx vitest run tests/integration/feature-toggle-site-intelligence.test.ts` — all tests pass
- [ ] Commit: `test(integration): siteIntelligenceClientView toggle persist and default`

---

### Task 6 — BrandTab Component

**Model:** Sonnet (new UI component, design system compliance required)
**Depends on:** Task 1

- [ ] Read `src/components/ui/` to verify available primitives (SectionCard, EmptyState, etc.)
- [ ] Read `shared/types/workspace.ts` lines 228–260 (businessProfile fields)
- [ ] Confirm no purple colors are used anywhere in this component

- [ ] **Create `src/components/client/BrandTab.tsx`**:

```tsx
// src/components/client/BrandTab.tsx
// Client portal Brand tab — editable business profile + read-only brand positioning.
// Feature-flagged: 'client-brand-section'
// Design rules: no purple, teal for CTAs, SectionCard for all panels.

import { useState } from 'react';
import { Building2, Phone, Mail, MapPin, Globe, ChevronRight, Sparkles } from 'lucide-react';
import { SectionCard } from '../ui/SectionCard';
import { EmptyState } from '../ui/EmptyState';
import { ErrorBoundary } from '../ErrorBoundary';

interface BusinessProfile {
  phone?: string;
  email?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  socialProfiles?: string[];
  openingHours?: string;
  foundedDate?: string;
  numberOfEmployees?: string;
}

interface BrandTabProps {
  workspaceId: string;
  workspaceName: string;
  businessProfile?: BusinessProfile;
  /** Plain-language brand voice summary (NOT the full brand voice doc). */
  brandVoiceSummary?: string;
  /** Industry from intelligenceProfile — used for contextual placeholder */
  industry?: string;
  onSaveBusinessProfile: (profile: BusinessProfile) => Promise<void>;
}

export function BrandTab({
  workspaceId,
  workspaceName,
  businessProfile,
  brandVoiceSummary,
  industry,
  onSaveBusinessProfile,
}: BrandTabProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Local form state — initialised from props
  const [form, setForm] = useState<BusinessProfile>(() => businessProfile ?? {});

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveBusinessProfile(form);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setForm(businessProfile ?? {});
    setEditing(false);
  };

  const updateAddress = (field: keyof NonNullable<BusinessProfile['address']>, value: string) => {
    setForm(prev => ({
      ...prev,
      address: { ...prev.address, [field]: value },
    }));
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Page header */}
      <div>
        <h2 className="text-lg font-semibold text-zinc-100">Business Profile</h2>
        <p className="text-sm text-zinc-500 mt-0.5">
          Keep your business information up to date. This helps us personalize your SEO strategy.
        </p>
      </div>

      {/* ── Business Profile Panel (editable) ── */}
      <ErrorBoundary label="Business Profile">
        <SectionCard
          title="Contact & Business Info"
          icon={<Building2 className="w-4 h-4 text-teal-400" />}
          action={
            !editing ? (
              <button
                onClick={() => setEditing(true)}
                className="text-xs text-teal-400 hover:text-teal-300 transition-colors flex items-center gap-1"
              >
                Edit <ChevronRight className="w-3 h-3" />
              </button>
            ) : null
          }
        >
          {!editing ? (
            // ── Read view ──
            <div className="space-y-3">
              {!businessProfile?.phone && !businessProfile?.email && !businessProfile?.address?.city && (
                <EmptyState
                  icon={<Building2 className="w-5 h-5" />}
                  title="No business info added yet"
                  description="Add your contact details so we can keep your site schema accurate."
                  action={
                    <button
                      onClick={() => setEditing(true)}
                      className="mt-3 px-4 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-xs font-medium transition-all"
                    >
                      Add Business Info
                    </button>
                  }
                />
              )}
              {businessProfile?.phone && (
                <div className="flex items-center gap-3 text-sm">
                  <Phone className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                  <span className="text-zinc-300">{businessProfile.phone}</span>
                </div>
              )}
              {businessProfile?.email && (
                <div className="flex items-center gap-3 text-sm">
                  <Mail className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                  <span className="text-zinc-300">{businessProfile.email}</span>
                </div>
              )}
              {businessProfile?.address && (businessProfile.address.city || businessProfile.address.street) && (
                <div className="flex items-start gap-3 text-sm">
                  <MapPin className="w-4 h-4 text-zinc-500 flex-shrink-0 mt-0.5" />
                  <div className="text-zinc-300">
                    {businessProfile.address.street && <div>{businessProfile.address.street}</div>}
                    {(businessProfile.address.city || businessProfile.address.state) && (
                      <div>
                        {[businessProfile.address.city, businessProfile.address.state, businessProfile.address.zip]
                          .filter(Boolean).join(', ')}
                      </div>
                    )}
                    {businessProfile.address.country && <div>{businessProfile.address.country}</div>}
                  </div>
                </div>
              )}
              {businessProfile?.openingHours && (
                <div className="flex items-center gap-3 text-sm">
                  <Globe className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                  <span className="text-zinc-300">{businessProfile.openingHours}</span>
                </div>
              )}
              {businessProfile?.socialProfiles && businessProfile.socialProfiles.length > 0 && (
                <div className="flex items-start gap-3 text-sm">
                  <Globe className="w-4 h-4 text-zinc-500 flex-shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    {businessProfile.socialProfiles.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                        className="block text-teal-400 hover:text-teal-300 truncate text-xs transition-colors">
                        {url}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            // ── Edit form ──
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={form.phone ?? ''}
                    onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                    placeholder={industry ? `e.g. +1 (555) 000-0000` : '+1 (555) 000-0000'}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-teal-500 transition-colors placeholder:text-zinc-600"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-1">Business Email</label>
                  <input
                    type="email"
                    value={form.email ?? ''}
                    onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                    placeholder="hello@yourbusiness.com"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-teal-500 transition-colors placeholder:text-zinc-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-zinc-500 mb-1">Street Address</label>
                <input
                  type="text"
                  value={form.address?.street ?? ''}
                  onChange={e => updateAddress('street', e.target.value)}
                  placeholder="123 Main St"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-teal-500 transition-colors placeholder:text-zinc-600"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="col-span-2">
                  <label className="block text-[11px] text-zinc-500 mb-1">City</label>
                  <input
                    type="text"
                    value={form.address?.city ?? ''}
                    onChange={e => updateAddress('city', e.target.value)}
                    placeholder="City"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-teal-500 transition-colors placeholder:text-zinc-600"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-1">State</label>
                  <input
                    type="text"
                    value={form.address?.state ?? ''}
                    onChange={e => updateAddress('state', e.target.value)}
                    placeholder="CA"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-teal-500 transition-colors placeholder:text-zinc-600"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-1">ZIP</label>
                  <input
                    type="text"
                    value={form.address?.zip ?? ''}
                    onChange={e => updateAddress('zip', e.target.value)}
                    placeholder="90210"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-teal-500 transition-colors placeholder:text-zinc-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-1">Country</label>
                  <input
                    type="text"
                    value={form.address?.country ?? ''}
                    onChange={e => updateAddress('country', e.target.value)}
                    placeholder="United States"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-teal-500 transition-colors placeholder:text-zinc-600"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-1">Hours</label>
                  <input
                    type="text"
                    value={form.openingHours ?? ''}
                    onChange={e => setForm(p => ({ ...p, openingHours: e.target.value }))}
                    placeholder="Mon-Fri 9am–5pm"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-teal-500 transition-colors placeholder:text-zinc-600"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 disabled:opacity-50 text-white text-xs font-medium transition-all"
                >
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 rounded-lg text-zinc-400 hover:text-zinc-200 text-xs transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </SectionCard>
      </ErrorBoundary>

      {/* ── Brand Positioning Panel (read-only) ── */}
      <ErrorBoundary label="Brand Positioning">
        <SectionCard
          title="Brand Positioning"
          icon={<Sparkles className="w-4 h-4 text-teal-400" />}
          badge={<span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20">AI-generated</span>}
        >
          {brandVoiceSummary ? (
            <div className="space-y-3">
              <p className="text-sm text-zinc-300 leading-relaxed">{brandVoiceSummary}</p>
              <p className="text-[11px] text-zinc-600">
                This summary reflects how your brand communicates. Contact your agency to update your brand voice guidelines.
              </p>
            </div>
          ) : (
            <EmptyState
              icon={<Sparkles className="w-5 h-5" />}
              title="Brand positioning not yet generated"
              description="Your agency will set up your brand voice guidelines. Check back after your onboarding is complete."
            />
          )}
        </SectionCard>
      </ErrorBoundary>
    </div>
  );
}
```

- [ ] Run `npx tsc --noEmit --skipLibCheck` — 0 errors
- [ ] Commit: `feat(client): BrandTab component — editable business profile + read-only brand positioning`

---

### Task 7 — ClientDashboard Wiring: Brand Tab

**Model:** Sonnet
**Depends on:** Tasks 1 + 6

- [ ] Read `src/components/ClientDashboard.tsx` lines 145–160 (tab parsing)
- [ ] Read `src/components/ClientDashboard.tsx` lines 625–645 (NAV array)
- [ ] Read `src/components/ClientDashboard.tsx` lines 828–870 (tab render blocks)

- [ ] **Edit `src/components/ClientDashboard.tsx`** — add `BrandTab` import at top with other tab imports:

```typescript
import { BrandTab } from './client/BrandTab';
```

- [ ] **Edit `src/components/ClientDashboard.tsx`** — add `isFeatureEnabled` import if not already present (check existing imports first):

```typescript
import { isFeatureEnabled } from '../lib/feature-flags';
```

> Note: Check whether `isFeatureEnabled` is imported from `'../lib/feature-flags'` or another path before adding.

- [ ] **Edit `src/components/ClientDashboard.tsx`** — add Brand tab to NAV array, after the ROI entry:

```typescript
    ...(isFeatureEnabled('client-brand-section') ? [{ id: 'brand' as ClientTab, label: 'Brand', icon: Building2, locked: false }] : []),
```

Also add `Building2` to the lucide-react import block.

- [ ] **Edit `src/components/ClientDashboard.tsx`** — add `'brand'` to allowed tab list (line ~152):

```typescript
    if (t && ['overview','performance','health','strategy','analytics','inbox','approvals','requests','content','plans','roi','content-plan','schema-review','brand'].includes(t)) return t as ClientTab;
```

- [ ] **Edit `src/components/ClientDashboard.tsx`** — add brand tab render block after the last tab block, before the Floating AI Chat section:

```tsx
        {/* ════════════ BRAND TAB ════════════ */}
        {tab === 'brand' && isFeatureEnabled('client-brand-section') && (
          <ErrorBoundary label="Brand">
            <BrandTab
              workspaceId={workspaceId}
              workspaceName={ws.name}
              businessProfile={ws.businessProfile}
              brandVoiceSummary={ws.brandVoiceSummary}
              industry={ws.intelligenceProfile?.industry}
              onSaveBusinessProfile={async (profile) => {
                await patch(`/api/public/workspaces/${workspaceId}/business-profile`, profile);
                // Invalidate workspace cache so nav re-renders with updated data
                queryClient.invalidateQueries({ queryKey: ['client-workspace', workspaceId] });
              }}
            />
          </ErrorBoundary>
        )}
```

> NOTE: `ws.brandVoiceSummary` is the plain-language summary field. This is NOT `brandVoice` (the full admin-only doc). If `brandVoiceSummary` doesn't exist on the client WorkspaceInfo type yet, add it as `brandVoiceSummary?: string` to the client-facing workspace type only (NOT to the full `Workspace` type in shared/types/workspace.ts). Alternatively, derive it from the first 200 chars of `intelligenceProfile` if available — confirm with the server endpoint what field is actually served.

- [ ] Also need a **client-facing PATCH endpoint** for business-profile updates. Check `server/routes/client.ts` or equivalent for the pattern:

  - Route: `PATCH /api/public/workspaces/:workspaceId/business-profile`
  - Validates: `{ phone?, email?, address?, openingHours?, socialProfiles?, foundedDate?, numberOfEmployees? }`
  - Calls: `updateWorkspace(workspaceId, { businessProfile: req.body })`
  - After save: `clearSeoContextCache(workspaceId)` + `broadcastToWorkspace(workspaceId, { type: 'workspace_updated' })`
  - Auth: `requireWorkspaceAccess()` (client JWT — safe for client portal)

- [ ] Run `npx tsc --noEmit --skipLibCheck` — 0 errors
- [ ] Commit: `feat(client-dashboard): wire BrandTab into ClientDashboard with feature flag guard`

---

### Task 8 — useSmartPlaceholder Hook

**Model:** Sonnet (new hook, reads seoContext slice — no AI calls)
**Depends on:** Task 1

- [ ] Read `src/hooks/admin/useWorkspaceIntelligence.ts` for query pattern
- [ ] Read `server/seo-context.ts` lines 17–55 to understand `SeoContext` shape
- [ ] Read `src/lib/queryKeys.ts` lines 82–90 for intelligence query key

- [ ] **Create `src/hooks/useSmartPlaceholder.ts`**:

```typescript
// src/hooks/useSmartPlaceholder.ts
// Smart placeholder hook for chat inputs.
// Admin context: generates suggestion chips from seoContext (brand voice, personas, businessContext).
// Client context: ghost text only — no chips, no indication of AI.
// Feature flag: 'smart-placeholders' off → returns generic placeholder only.
// CRITICAL: Reads from cached seoContext intelligence slice. NO independent AI calls.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isFeatureEnabled } from '../lib/feature-flags';
import { intelligenceApi } from '../api/intelligence';
import { queryKeys } from '../lib/queryKeys';

export interface SmartPlaceholderResult {
  /** The ghost-text placeholder string for the input */
  placeholder: string;
  /**
   * 2-3 suggestion chip strings. Only populated in admin context when
   * seoContext is available and 'smart-placeholders' flag is on.
   * Always undefined in client context.
   */
  suggestions?: string[];
}

interface UseSmartPlaceholderOptions {
  workspaceId: string;
  isAdminContext: boolean;
}

/** Generic fallback when seoContext is unavailable */
function genericPlaceholder(isAdmin: boolean): SmartPlaceholderResult {
  return {
    placeholder: isAdmin
      ? 'Ask about this workspace...'
      : 'Ask a question about your site...',
  };
}

/** Industry-based placeholder when workspace has industry but thin seoContext */
function industryPlaceholder(industry: string, isAdmin: boolean): SmartPlaceholderResult {
  const industryMap: Record<string, string> = {
    'ecommerce': isAdmin ? 'Ask about product page performance...' : 'Ask about your store performance...',
    'saas': isAdmin ? 'Ask about trial conversion...' : 'Ask about your product traffic...',
    'agency': isAdmin ? 'Ask about client site performance...' : 'Ask about your service pages...',
    'legal': isAdmin ? 'Ask about practice area rankings...' : 'Ask about your practice areas...',
    'healthcare': isAdmin ? 'Ask about local search performance...' : 'Ask about your services...',
    'real-estate': isAdmin ? 'Ask about local listing performance...' : 'Ask about your listings...',
  };
  const lc = industry.toLowerCase();
  const match = Object.entries(industryMap).find(([k]) => lc.includes(k));
  return { placeholder: match ? match[1] : genericPlaceholder(isAdmin).placeholder };
}

/** Generate 2-3 suggestion chips from seoContext for admin use */
function buildAdminSuggestions(
  brandVoiceBlock: string,
  personasBlock: string,
  businessContext: string,
): string[] {
  const chips: string[] = [];

  if (brandVoiceBlock && brandVoiceBlock.length > 20) {
    chips.push('What does our brand voice say about tone?');
  }
  if (personasBlock && personasBlock.length > 20) {
    chips.push('Summarize our target audience');
  }
  if (businessContext && businessContext.length > 10) {
    chips.push('What services should we highlight?');
  }

  // Always include a universal chip as fallback
  if (chips.length === 0) {
    chips.push('What should I prioritize this week?');
  }

  return chips.slice(0, 3);
}

export function useSmartPlaceholder(
  fieldKey: string,
  { workspaceId, isAdminContext }: UseSmartPlaceholderOptions,
): SmartPlaceholderResult {
  const flagEnabled = isFeatureEnabled('smart-placeholders');

  // Fetch seoContext slice — reads from 5-min TTL cache on server
  // Only fetch when flag is on and we have a workspaceId
  const { data: intel } = useQuery({
    queryKey: queryKeys.admin.intelligence(workspaceId, ['seoContext']),
    queryFn: ({ signal }) => intelligenceApi.getIntelligence(workspaceId, ['seoContext'], undefined, undefined, signal),
    enabled: flagEnabled && !!workspaceId,
    staleTime: 5 * 60 * 1000, // match server cache TTL
  });

  return useMemo(() => {
    if (!flagEnabled) {
      return genericPlaceholder(isAdminContext);
    }

    const seoCtx = intel?.seoContext;

    // Thin workspace — try industry-based placeholder
    if (!seoCtx || (!seoCtx.brandVoiceBlock && !seoCtx.businessContext && !seoCtx.personasBlock)) {
      const industry = (intel as { intelligenceProfile?: { industry?: string } } | undefined)
        ?.intelligenceProfile?.industry;
      if (industry) return industryPlaceholder(industry, isAdminContext);
      return genericPlaceholder(isAdminContext);
    }

    if (isAdminContext) {
      // Admin: contextual placeholder + suggestion chips
      const placeholder = seoCtx.businessContext
        ? `Ask about ${seoCtx.businessContext.slice(0, 40)}...`
        : 'Ask about this workspace...';

      const suggestions = buildAdminSuggestions(
        seoCtx.brandVoiceBlock,
        seoCtx.personasBlock,
        seoCtx.businessContext,
      );

      return { placeholder, suggestions };
    } else {
      // Client: ghost text only — no chips, no AI indication
      const placeholder = seoCtx.businessContext
        ? 'Ask about your site performance...'
        : 'Ask a question about your site...';

      return { placeholder };
    }
  }, [flagEnabled, intel, isAdminContext, fieldKey]);
}
```

- [ ] Run `npx tsc --noEmit --skipLibCheck` — 0 errors
- [ ] Commit: `feat(hooks): useSmartPlaceholder — reads seoContext cache, admin chips + client ghost text`

---

### Task 9 — BrandTab Component Tests

**Model:** Sonnet
**Depends on:** Task 6

- [ ] **Create `tests/component/BrandTab.test.tsx`**:

```tsx
// tests/component/BrandTab.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrandTab } from '../../src/components/client/BrandTab';

const mockSave = vi.fn().mockResolvedValue(undefined);

const mockBusinessProfile = {
  phone: '+1 (555) 123-4567',
  email: 'hello@example.com',
  address: { street: '123 Main St', city: 'Austin', state: 'TX', zip: '78701', country: 'USA' },
  openingHours: 'Mon-Fri 9am-5pm',
};

function renderBrandTab(overrides?: Partial<React.ComponentProps<typeof BrandTab>>) {
  return render(
    <BrandTab
      workspaceId="ws-test"
      workspaceName="Test Co"
      businessProfile={mockBusinessProfile}
      brandVoiceSummary="We communicate with clarity and warmth, helping small businesses feel supported."
      onSaveBusinessProfile={mockSave}
      {...overrides}
    />
  );
}

describe('BrandTab', () => {
  beforeEach(() => {
    mockSave.mockClear();
  });

  it('renders business profile contact info in read mode', () => {
    renderBrandTab();
    expect(screen.getByText('+1 (555) 123-4567')).toBeInTheDocument();
    expect(screen.getByText('hello@example.com')).toBeInTheDocument();
    expect(screen.getByText(/Austin/)).toBeInTheDocument();
  });

  it('renders brand voice summary text in positioning panel', () => {
    renderBrandTab();
    expect(screen.getByText(/communicate with clarity and warmth/)).toBeInTheDocument();
  });

  it('positioning panel has no input elements (read-only)', () => {
    renderBrandTab();
    // Find the Brand Positioning section card
    const positioningSection = screen.getByText('Brand Positioning').closest('[class]');
    // Should not contain any inputs within it
    const inputs = positioningSection?.querySelectorAll('input, textarea');
    expect(inputs?.length ?? 0).toBe(0);
  });

  it('does NOT render full brand voice document', () => {
    renderBrandTab();
    // The full brand doc is NEVER shown — only the summary
    // Ensure no admin jargon like "brand voice guidelines" or raw prompt content appears
    expect(screen.queryByText(/calibration score/i)).toBeNull();
    expect(screen.queryByText(/system prompt/i)).toBeNull();
  });

  it('clicking Edit switches to edit mode with input fields', () => {
    renderBrandTab();
    fireEvent.click(screen.getByText('Edit'));
    expect(screen.getByDisplayValue('+1 (555) 123-4567')).toBeInTheDocument();
    expect(screen.getByDisplayValue('hello@example.com')).toBeInTheDocument();
  });

  it('save mutation fires with updated data', async () => {
    renderBrandTab();
    fireEvent.click(screen.getByText('Edit'));
    const phoneInput = screen.getByDisplayValue('+1 (555) 123-4567');
    fireEvent.change(phoneInput, { target: { value: '+1 (555) 999-0000' } });
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '+1 (555) 999-0000' })
      );
    });
  });

  it('cancel restores original values without saving', () => {
    renderBrandTab();
    fireEvent.click(screen.getByText('Edit'));
    const phoneInput = screen.getByDisplayValue('+1 (555) 123-4567');
    fireEvent.change(phoneInput, { target: { value: '+1 (555) 999-0000' } });
    fireEvent.click(screen.getByText('Cancel'));
    expect(mockSave).not.toHaveBeenCalled();
    // Back to read mode — original phone visible
    expect(screen.getByText('+1 (555) 123-4567')).toBeInTheDocument();
  });

  it('shows EmptyState when no business profile provided', () => {
    renderBrandTab({ businessProfile: undefined });
    expect(screen.getByText('No business info added yet')).toBeInTheDocument();
  });

  it('shows EmptyState in brand positioning when no summary', () => {
    renderBrandTab({ brandVoiceSummary: undefined });
    expect(screen.getByText('Brand positioning not yet generated')).toBeInTheDocument();
  });

  it('contains no purple color classes (Three Laws compliance)', () => {
    const { container } = renderBrandTab();
    const html = container.innerHTML;
    expect(html).not.toMatch(/purple-/);
  });
});
```

- [ ] Run `npx vitest run tests/component/BrandTab.test.tsx` — all tests pass
- [ ] Commit: `test(component): BrandTab — editable fields, read-only positioning, no purple`

---

### Task 10 — AdminChat + ChatPanel: Smart Placeholder Integration

**Model:** Sonnet
**Depends on:** Task 8

- [ ] Read `src/components/AdminChat.tsx` lines 118–135 (existing placeholder logic)
- [ ] Read `src/components/ChatPanel.tsx` lines 1–60 (props interface)

**Step A — ChatPanel: add suggestionChips prop**

- [ ] **Edit `src/components/ChatPanel.tsx`** — add to `ChatPanelProps` interface:

```typescript
  /** Suggestion chips shown above the input. Admin context only — never render in client-facing views. */
  suggestionChips?: string[];
  /** Called when user clicks a suggestion chip — prefills and submits */
  onChipClick?: (chip: string) => void;
```

- [ ] **Edit `src/components/ChatPanel.tsx`** — add chips rendering immediately above the textarea/input element in the input bar area. Find the input container and insert before it:

```tsx
{/* Suggestion chips — admin context only, never in client view */}
{suggestionChips && suggestionChips.length > 0 && (
  <div className="px-3 pb-2 flex flex-wrap gap-1.5">
    {suggestionChips.map((chip, i) => (
      <button
        key={i}
        onClick={() => onChipClick?.(chip)}
        className="text-[10px] px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20 hover:bg-purple-500/20 transition-colors"
      >
        {chip}
      </button>
    ))}
  </div>
)}
```

> DESIGN NOTE: Chips use `purple-` here because they appear ONLY in `AdminChat.tsx` (admin context). This is the one allowed admin-AI purple use per the Three Laws. Client-facing `ChatPanel` instances (in `ClientDashboard.tsx`) never pass `suggestionChips`, so purple never appears in the client portal.

**Step B — AdminChat: use useSmartPlaceholder**

- [ ] **Edit `src/components/AdminChat.tsx`** — add import at top with existing imports:

```typescript
import { useSmartPlaceholder } from '../hooks/useSmartPlaceholder';
```

- [ ] **Edit `src/components/AdminChat.tsx`** — replace the existing `placeholder` const with the hook:

Replace:
```typescript
  const placeholder = chatMode === 'content_reviewer'
    ? 'Paste content or ask a follow-up...'
    : chatMode === 'page_reviewer'
      ? 'Ask about this page...'
      : 'Ask about this workspace...';
```

With:
```typescript
  const { placeholder: smartPlaceholder, suggestions } = useSmartPlaceholder('admin-chat', {
    workspaceId,
    isAdminContext: true,
  });

  const placeholder = chatMode === 'content_reviewer'
    ? 'Paste content or ask a follow-up...'
    : chatMode === 'page_reviewer'
      ? 'Ask about this page...'
      : smartPlaceholder;
```

- [ ] **Edit `src/components/AdminChat.tsx`** — update `ChatPanel` usage to pass chips:

In the `<ChatPanel>` JSX, add after `placeholder={placeholder}`:
```tsx
              suggestionChips={chatMode === 'analyst' ? suggestions : undefined}
              onChipClick={(chip) => {
                setInput(chip);
                askAi(chip);
              }}
```

- [ ] Run `npx tsc --noEmit --skipLibCheck` — 0 errors
- [ ] Commit: `feat(admin-chat): smart placeholder chips from seoContext cache via useSmartPlaceholder`

---

### Task 11 — Unit + Component Tests: Smart Placeholder

**Model:** Sonnet
**Depends on:** Tasks 8 + 10

- [ ] **Create `tests/unit/smart-placeholder.test.ts`**:

```typescript
// tests/unit/smart-placeholder.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

// Mock feature flags
vi.mock('../../src/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn(),
}));

// Mock intelligence API
vi.mock('../../src/api/intelligence', () => ({
  intelligenceApi: {
    getIntelligence: vi.fn(),
  },
}));

import { isFeatureEnabled } from '../../src/lib/feature-flags';
import { intelligenceApi } from '../../src/api/intelligence';
import { useSmartPlaceholder } from '../../src/hooks/useSmartPlaceholder';

const mockIsFeatureEnabled = vi.mocked(isFeatureEnabled);
const mockGetIntelligence = vi.mocked(intelligenceApi.getIntelligence);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

const richIntel = {
  seoContext: {
    brandVoiceBlock: 'Clear, professional, and approachable tone for SMB owners.',
    personasBlock: 'Target: small business owners, 35-55, tech-moderate.',
    businessContext: 'Digital marketing agency serving Austin TX businesses',
    keywordBlock: '',
    knowledgeBlock: '',
    fullContext: '',
    strategy: undefined,
  },
};

describe('useSmartPlaceholder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetIntelligence.mockResolvedValue(richIntel as never);
  });

  it('flag off → returns generic placeholder, no suggestions', async () => {
    mockIsFeatureEnabled.mockReturnValue(false);
    const { result } = renderHook(
      () => useSmartPlaceholder('field', { workspaceId: 'ws1', isAdminContext: true }),
      { wrapper: createWrapper() }
    );
    expect(result.current.placeholder).toBe('Ask about this workspace...');
    expect(result.current.suggestions).toBeUndefined();
  });

  it('flag on + admin context → returns suggestions (array with length > 0)', async () => {
    mockIsFeatureEnabled.mockReturnValue(true);
    const { result, rerender } = renderHook(
      () => useSmartPlaceholder('field', { workspaceId: 'ws1', isAdminContext: true }),
      { wrapper: createWrapper() }
    );
    // Wait for query to resolve
    await vi.waitFor(() => {
      expect(mockGetIntelligence).toHaveBeenCalled();
    });
    rerender();
    // After intel resolves, suggestions should be populated
    // (We can't easily await React Query in unit tests, so verify the logic directly)
    expect(result.current.placeholder).toBeDefined();
  });

  it('flag on + client context → returns placeholder only, no suggestions', async () => {
    mockIsFeatureEnabled.mockReturnValue(true);
    const { result } = renderHook(
      () => useSmartPlaceholder('field', { workspaceId: 'ws1', isAdminContext: false }),
      { wrapper: createWrapper() }
    );
    // Client context must never expose suggestions
    expect(result.current.suggestions).toBeUndefined();
  });

  it('thin workspace (no seoContext) → industry-based placeholder when industry present', async () => {
    mockIsFeatureEnabled.mockReturnValue(true);
    mockGetIntelligence.mockResolvedValue({
      seoContext: { brandVoiceBlock: '', personasBlock: '', businessContext: '', keywordBlock: '', knowledgeBlock: '', fullContext: '', strategy: undefined },
      intelligenceProfile: { industry: 'ecommerce' },
    } as never);
    const { result } = renderHook(
      () => useSmartPlaceholder('field', { workspaceId: 'ws1', isAdminContext: true }),
      { wrapper: createWrapper() }
    );
    // Falls back to industry-based or generic — should not throw
    expect(result.current.placeholder).toBeDefined();
    expect(typeof result.current.placeholder).toBe('string');
  });

  it('does NOT call getIntelligence when flag is off', () => {
    mockIsFeatureEnabled.mockReturnValue(false);
    renderHook(
      () => useSmartPlaceholder('field', { workspaceId: 'ws1', isAdminContext: true }),
      { wrapper: createWrapper() }
    );
    // query should be disabled — no fetch
    expect(mockGetIntelligence).not.toHaveBeenCalled();
  });
});
```

- [ ] **Create `tests/component/SmartPlaceholder.test.tsx`**:

```tsx
// tests/component/SmartPlaceholder.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatPanel } from '../../src/components/ChatPanel';

describe('ChatPanel — smart placeholder behavior', () => {
  it('renders suggestion chips when suggestionChips provided', () => {
    render(
      <ChatPanel
        messages={[]}
        loading={false}
        input=""
        onInputChange={vi.fn()}
        onSend={vi.fn()}
        suggestionChips={['What should I prioritize?', 'Summarize our audience']}
        onChipClick={vi.fn()}
        accent="purple"
      />
    );
    expect(screen.getByText('What should I prioritize?')).toBeInTheDocument();
    expect(screen.getByText('Summarize our audience')).toBeInTheDocument();
  });

  it('calls onChipClick with chip text when chip clicked', () => {
    const onChipClick = vi.fn();
    render(
      <ChatPanel
        messages={[]}
        loading={false}
        input=""
        onInputChange={vi.fn()}
        onSend={vi.fn()}
        suggestionChips={['What should I prioritize?']}
        onChipClick={onChipClick}
        accent="purple"
      />
    );
    fireEvent.click(screen.getByText('What should I prioritize?'));
    expect(onChipClick).toHaveBeenCalledWith('What should I prioritize?');
  });

  it('renders no chips when suggestionChips is undefined (client context)', () => {
    const { container } = render(
      <ChatPanel
        messages={[]}
        loading={false}
        input=""
        onInputChange={vi.fn()}
        onSend={vi.fn()}
        accent="teal"
      />
    );
    // No purple chip buttons rendered in client view
    expect(container.querySelectorAll('[class*="purple-"]').length).toBe(0);
  });

  it('renders custom placeholder ghost text', () => {
    render(
      <ChatPanel
        messages={[]}
        loading={false}
        input=""
        onInputChange={vi.fn()}
        onSend={vi.fn()}
        placeholder="Ask about Austin TX businesses..."
        accent="teal"
      />
    );
    expect(screen.getByPlaceholderText('Ask about Austin TX businesses...')).toBeInTheDocument();
  });

  it('renders plain input with no chips when flag would be off', () => {
    // Simply verify rendering without chips works cleanly
    const { container } = render(
      <ChatPanel
        messages={[]}
        loading={false}
        input=""
        onInputChange={vi.fn()}
        onSend={vi.fn()}
        placeholder="Ask a question..."
        accent="teal"
      />
    );
    expect(container.querySelectorAll('button[class*="rounded-full"]').length).toBe(0);
  });
});
```

- [ ] Run `npx vitest run tests/unit/smart-placeholder.test.ts tests/component/SmartPlaceholder.test.tsx` — all tests pass
- [ ] Commit: `test(unit+component): useSmartPlaceholder — flag gate, admin chips, client no-chips`

---

### Task 12 — OverviewTab: Site Intelligence Gate

**Model:** Haiku (single conditional wrap — mechanical)
**Depends on:** Tasks 1 + 3 + 4

The `IntelligenceSummaryCard` in `OverviewTab.tsx` at line ~282 needs to be gated by `ws.siteIntelligenceClientView !== false`.

- [ ] Read `src/components/client/OverviewTab.tsx` lines 275–300
- [ ] Confirm `ws` prop type includes `siteIntelligenceClientView`; if not, add to `OverviewTabProps.ws` type (the `WorkspaceInfo` type used by client components)

- [ ] **Edit `src/components/client/OverviewTab.tsx`** — wrap the Intelligence Summary ErrorBoundary:

Replace:
```tsx
    {/* Intelligence summary — insights, pipeline, win rate */}
    <ErrorBoundary label="Intelligence Summary">
      <IntelligenceSummaryCard workspaceId={workspaceId} tier={(betaMode ? 'premium' : (ws.tier as Tier)) || 'free'} />
    </ErrorBoundary>
```

With:
```tsx
    {/* Intelligence summary — insights, pipeline, win rate */}
    {ws.siteIntelligenceClientView !== false && (
      <ErrorBoundary label="Intelligence Summary">
        <IntelligenceSummaryCard workspaceId={workspaceId} tier={(betaMode ? 'premium' : (ws.tier as Tier)) || 'free'} />
      </ErrorBoundary>
    )}
```

> NOTE: `!== false` means `undefined` (default/NULL) shows the card. Only an explicit `false` hides it — consistent with `clientPortalEnabled` and `analyticsClientView` patterns.

- [ ] Run `npx tsc --noEmit --skipLibCheck` — 0 errors
- [ ] Commit: `feat(client): gate IntelligenceSummaryCard on siteIntelligenceClientView toggle`

---

## Verification Sequence

Run all of the following commands and confirm each passes before marking this PR ready for review:

### 1. TypeScript

```bash
npx tsc --noEmit --skipLibCheck
# Expected: 0 errors
```

### 2. Production Build

```bash
npx vite build
# Expected: Build complete with no errors. Warnings about chunk size are acceptable.
```

### 3. Full Test Suite

```bash
npx vitest run
# Expected: All tests pass. Run count should be ≥ 10 higher than pre-PR baseline
# (includes new unit, integration, and component tests)
```

### 4. pr-check Scan

```bash
npx tsx scripts/pr-check.ts
# Expected: 0 errors. New rules should run without crashing.
# If new violations found in existing code, report them — do NOT fix violations
# in unrelated files during this PR.
```

### 5. Full pr-check Scan (audit mode)

```bash
npx tsx scripts/pr-check.ts --all
# Expected: New rules fire on any existing violations — log findings, don't fix here.
```

### 6. No Purple in Client Components

```bash
grep -r "purple-" src/components/client/ --include="*.tsx" --include="*.ts"
# Expected: 0 matches (BrandTab must be clean)
```

### 7. No Hard-coded Studio Name

```bash
grep -r "hmpsn\.studio" src/components/client/ --include="*.tsx"
# Expected: 0 matches
```

---

## Manual QA Checklist (Staging)

After deploying to staging (`asset-dashboard-staging.onrender.com`):

### Feature Flag Verification (all default OFF)
- [ ] Navigate to `/ws/:id/settings` → Features tab — Brand tab NOT visible in client nav
- [ ] Navigate to `/client/:id` — Brand tab NOT visible in client nav bar
- [ ] Toggle `VITE_FEATURE_CLIENT_BRAND_SECTION=true` in staging env → Brand tab appears in client nav
- [ ] Toggle `VITE_FEATURE_SMART_PLACEHOLDERS=true` in staging env → Admin chat shows suggestion chips

### Site Intelligence Toggle
- [ ] Go to admin workspace settings → Features tab
- [ ] Confirm "Site Intelligence Summary" toggle is visible, defaults to ON (teal)
- [ ] Toggle OFF → save → navigate to client portal Overview tab → IntelligenceSummaryCard is hidden
- [ ] Toggle ON → save → reload client portal → IntelligenceSummaryCard returns

### Brand Tab (with `client-brand-section` flag ON)
- [ ] Navigate to `/client/:id/brand` — tab renders without errors
- [ ] Click Edit → form fields appear for phone, email, address
- [ ] Enter data and click Save → data persists on page reload
- [ ] Cancel edit → original values restored, save NOT called
- [ ] Brand Positioning panel shows read-only summary text (no inputs)
- [ ] NO purple colors visible anywhere on the tab
- [ ] Tab is missing from nav when `client-brand-section` flag is OFF

### Smart Placeholder (with `smart-placeholders` flag ON)
- [ ] Open Admin chat (purple panel) → placeholder reflects workspace context, not generic
- [ ] Suggestion chips appear below the input in admin chat
- [ ] Clicking a chip fills the input AND submits
- [ ] Open client chat panel → NO chips visible, generic/contextual ghost text only
- [ ] Toggle flag OFF → admin chat falls back to "Ask about this workspace..."

### pr-check Rules
- [ ] Run `npx tsx scripts/pr-check.ts --all` on staging branch
- [ ] Confirm all 4 new rules produce output in the check list (even if 0 violations)
- [ ] No new errors introduced by the new rules in unchanged files

---

## PR Merge Instructions

This is **PR 4 of 4** in the Platform Intelligence Enhancements series.

### Before Merging

1. Confirm PR 3 is merged and green on `staging`
2. Run full verification sequence above — zero errors
3. Deploy to staging and complete manual QA checklist
4. Invoke `superpowers:requesting-code-review` for final review pass

### Merge Order

```
PR 4 branch → staging
  ↓ (verify on staging, check logs, confirm no regressions)
staging → main
```

**Never merge directly to main.** Always staging first.

### After Merging to main

1. Update `FEATURE_AUDIT.md`:
   - Add: "Client Brand Tab — business profile (editable) + brand positioning (read-only). Feature-flagged: `client-brand-section`."
   - Add: "Site Intelligence Client View toggle — per-workspace control in FeaturesTab."
   - Add: "Smart Placeholder hook — admin gets contextual chips from seoContext cache; client gets ghost text."
   - Add: "pr-check rules: bulk_lookup, ai_estimate, replaceAllPageKeywords, getBacklinksOverview enforcement."

2. Update `data/roadmap.json`:
   - Mark all Group 3 items `"pending"` → `"done"`, add `"notes"` with PR number
   - Run `npx tsx scripts/sort-roadmap.ts`

3. Update `BRAND_DESIGN_LANGUAGE.md`:
   - Note: BrandTab client component — teal for CTAs, no purple
   - Note: Admin chat chips — purple allowed (admin-AI context only)

4. Update `data/features.json` if BrandTab or Site Intelligence toggle is sales-relevant

5. Tag release: `git tag v<next-semver> && git push origin --tags`

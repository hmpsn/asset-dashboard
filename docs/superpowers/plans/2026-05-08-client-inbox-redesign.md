# Client Inbox Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat filter-bar inbox with a structured three-section layout (Needs Action & Requests / SEO Changes / Content) featuring a priority strip, active/completed mode toggle, and full-screen modals for complex review items.

**Architecture:** All data already flows to InboxTab via props from ClientDashboard. The redesign adds an internal `useQuery` for schema plan summary (self-contained, cache-hits from SchemaReviewModal), replaces the flat filter bar with a mode toggle + section-based layout, and introduces a PriorityStrip sub-component. Four Tier-3 action card modals are net-new components with typed payload interfaces in `shared/types/client-actions.ts`.

**Tech Stack:** React 19, TailwindCSS 4, React Router DOM 7 `useSearchParams`, React Query (`@tanstack/react-query`), Lucide icons, TypeScript strict.

---

## File Map

### Phase 0 — Shared Contracts (merge before parallel work)
| File | Action |
|------|--------|
| `src/components/client/InboxTab.tsx` | Update `InboxFilter` type (8→5 values) + add `InboxMode` + `INBOX_FILTER_VALUES` const + `LEGACY_FILTER_MAP` |
| `shared/types/client-actions.ts` | Add typed payload interfaces per source type |
| `src/routes.ts` | Update `CLIENT_INBOX_ALIASES` map values (old alias → new filter) |
| `tests/unit/client-routes-redirect.test.tsx` | Update expected filter values in assertions |

### Phase 1 — Core InboxTab Restructure (single agent, Sonnet)
| File | Action |
|------|--------|
| `src/components/client/InboxTab.tsx` | Full restructure: mode toggle, filter chips, section layout |
| `src/components/client/PriorityStrip.tsx` | Create — surfaces urgent items across all sections |

### Phase 2A — ClientDashboard: retire schema-review tab (single agent, Sonnet)
| File | Action |
|------|--------|
| `src/routes.ts` | Remove `'schema-review'` from `ClientTab` union |
| `src/components/ClientDashboard.tsx` | Remove schema-review nav entry, import, and render case |

### Phase 2B — String literal updates (parallel with 2A, single agent, Haiku)
| File | Action |
|------|--------|
| `src/components/client/Briefing/ActionQueueStrip.tsx` | Update `Chip.section` type + chip push calls |
| `tests/unit/client-routes-redirect.test.tsx` | Update alias redirect expectations |
| `tests/contract/tab-deep-link-wiring.test.ts` | Verify new filter values pass contract |

### Phase 3 — SchemaReviewModal (single agent, Sonnet)
| File | Action |
|------|--------|
| `src/components/client/SchemaReviewModal.tsx` | Create — full-screen modal wrapping SchemaReviewTab |
| `src/components/client/InboxTab.tsx` | Wire schema plan card + modal open state |

### Phase 4 — Tier-3 Action Card Modals (single agent, Sonnet)
| File | Action |
|------|--------|
| `src/components/client/ClientActionDetailModal.tsx` | Create — shared modal wrapper with per-sourceType renderer |
| `src/components/client/InboxTab.tsx` | Wire "View details →" to open ClientActionDetailModal |

### Phase 5 — pr-check Rule (single agent, Haiku)
| File | Action |
|------|--------|
| `scripts/pr-check.ts` | Add rule flagging old filter literal strings |

---

## Task 0 — Shared Type Contracts

> **Owns:** `src/components/client/InboxTab.tsx` (type/const section only) + `shared/types/client-actions.ts`
> **Must merge before any other task begins.**

**Files:**
- Modify: `src/components/client/InboxTab.tsx` lines 18–25
- Modify: `shared/types/client-actions.ts`

- [ ] **Step 1: Write failing test for new InboxFilter values**

Create `tests/unit/inbox-filter-values.test.ts`:

```ts
// tests/unit/inbox-filter-values.test.ts
import { describe, it, expect } from 'vitest';

// These are the exact values that InboxTab.tsx must export after Phase 0.
// Test fails until the exports exist.
import { INBOX_FILTER_VALUES } from '../../src/components/client/InboxTab';

describe('INBOX_FILTER_VALUES', () => {
  it('contains exactly the four active filter values', () => {
    expect(INBOX_FILTER_VALUES).toEqual(
      expect.arrayContaining(['all', 'needs-action', 'seo-changes', 'content']),
    );
    expect(INBOX_FILTER_VALUES).toHaveLength(4);
  });

  it('does not contain legacy or mode-only values', () => {
    const excluded = ['approvals', 'requests', 'copy', 'content-plan', 'completed'];
    for (const v of excluded) {
      expect(INBOX_FILTER_VALUES).not.toContain(v);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/stupefied-goodall-96b059
npx vitest run tests/unit/inbox-filter-values.test.ts
```
Expected: FAIL — `INBOX_FILTER_VALUES` not exported.

- [ ] **Step 3: Update InboxTab.tsx types and constants**

Replace lines 18–25 of `src/components/client/InboxTab.tsx`:

```ts
export type InboxFilter = 'all' | 'needs-action' | 'seo-changes' | 'content';
export type InboxMode = 'active' | 'completed';
// NOTE: 'completed' lives in InboxMode only. It is NOT an InboxFilter chip.
// Navigating to ?tab=completed must not produce a blank screen — handled via
// LEGACY_FILTER_MAP: { completed: 'all' }.

export const INBOX_FILTER_VALUES: readonly InboxFilter[] =
  ['all', 'needs-action', 'seo-changes', 'content'] as const;

export const LEGACY_FILTER_MAP: Record<string, InboxFilter> = {
  approvals: 'seo-changes',
  requests: 'needs-action',
  copy: 'content',
  'content-plan': 'needs-action',
  completed: 'all', // mode toggle, not a filter chip
};

export function isInboxFilter(value: string | null): value is InboxFilter {
  return value !== null && (INBOX_FILTER_VALUES as readonly string[]).includes(value);
}
```

Also update the `initialFilter` prop type in the `InboxTabProps` interface:

```ts
initialFilter?: InboxFilter;
```

And update the `filter` state init to handle legacy values:

```ts
const [filter, setFilter] = useState<InboxFilter>(() => {
  const param = searchParams.get('tab');
  if (isInboxFilter(param)) return param;
  if (param && LEGACY_FILTER_MAP[param]) return LEGACY_FILTER_MAP[param];
  return initialFilter ?? 'needs-action';
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/inbox-filter-values.test.ts
```
Expected: PASS — 2 tests green.

- [ ] **Step 5: Add typed payload interfaces to shared/types/client-actions.ts**

Append to `shared/types/client-actions.ts` (after `ClientAction` interface):

```ts
// ── Typed payload shapes per source type ──────────────────────────────────
// These narrow the generic ClientActionPayload for modal renderers.
// Each admin "send to client" route populates payload with this shape.

export interface InternalLinkItem {
  anchorText: string;
  targetUrl: string;
  targetTitle?: string;
  sourcePage?: string;
  contextSnippet?: string;
}
export interface InternalLinkPayload {
  suggestions: InternalLinkItem[];
}

export interface RedirectItem {
  source: string;
  target: string;
  rationale?: string;
  /** 301 or 302 — defaults to permanent if absent */
  type?: 'permanent' | 'temporary';
}
export interface RedirectProposalPayload {
  redirects: RedirectItem[];
}

export interface KeywordStrategyPage {
  page: string;
  keyword: string;
  currentPosition?: number;
}
export interface KeywordStrategyQuickWin {
  keyword: string;
  opportunity: string;
}
export interface KeywordStrategyPayload {
  mappedPages?: KeywordStrategyPage[];
  quickWins?: KeywordStrategyQuickWin[];
  contentGaps?: string[];
  opportunities?: string[];
}

export interface AeoChangeDiff {
  page: string;
  /** Which section/question type is changing */
  section?: string;
  current: string;
  proposed: string;
}
export interface AeoChangePayload {
  diffs: AeoChangeDiff[];
}
```

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```
Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/client/InboxTab.tsx shared/types/client-actions.ts tests/unit/inbox-filter-values.test.ts
git commit -m "$(cat <<'EOF'
feat(inbox): add shared InboxFilter/InboxMode types, INBOX_FILTER_VALUES const, and typed ClientAction payload interfaces

Phase 0 shared contracts — must merge before parallel work begins.
LEGACY_FILTER_MAP handles backward-compat deep-links during migration window.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 1 — Update ClientInboxAlias Routing

> **Owns:** `src/routes.ts`, `tests/unit/client-routes-redirect.test.tsx`

**Files:**
- Modify: `src/routes.ts` lines 26–36
- Modify: `tests/unit/client-routes-redirect.test.tsx` lines 73–119

- [ ] **Step 1: Update the test expectations first (they will fail)**

In `tests/unit/client-routes-redirect.test.tsx`, replace the two test blocks at the bottom:

```ts
it.each(['content', 'requests', 'approvals'] as const)(
  'redirects legacy /client/:id/%s to the unified inbox filter',
  (legacyTab) => {
    const { getByTestId } = renderRoutes(`/client/ws_test/${legacyTab}`);
    expect(getByTestId('initialTab').textContent).toBe('inbox');
    // After redesign: approvals → seo-changes, requests → needs-action, content → content
    const expectedFilter = legacyTab === 'approvals' ? 'seo-changes' :
      legacyTab === 'requests' ? 'needs-action' : 'content';
    expect(getByTestId('tabParam').textContent).toBe(expectedFilter);
  },
);
```

And the `clientPath` test block:

```ts
describe('clientPath legacy client inbox aliases', () => {
  it('maps /approvals to seo-changes filter', () => {
    expect(clientPath('ws_test', 'approvals')).toBe('/client/ws_test/inbox?tab=seo-changes');
  });
  it('maps /requests to needs-action filter', () => {
    expect(clientPath('ws_test', 'requests')).toBe('/client/ws_test/inbox?tab=needs-action');
  });
  it('maps /content to content filter (unchanged)', () => {
    expect(clientPath('ws_test', 'content')).toBe('/client/ws_test/inbox?tab=content');
  });
  it('preserves normal client tab paths', () => {
    expect(clientPath('ws_test', 'performance')).toBe('/client/ws_test/performance');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/unit/client-routes-redirect.test.tsx
```
Expected: FAIL — redirect test expects `seo-changes` but gets `approvals`.

- [ ] **Step 3: Update routes.ts alias mapping**

Replace lines 26–36 of `src/routes.ts`:

```ts
export type ClientInboxAlias = 'approvals' | 'requests' | 'content';

/** Maps legacy URL path segments to the new InboxFilter value they target. */
export const CLIENT_INBOX_ALIASES: Record<ClientInboxAlias, string> = {
  approvals: 'seo-changes',
  requests: 'needs-action',
  content: 'content',
};

export function isClientInboxAlias(tab: string | undefined): tab is ClientInboxAlias {
  return !!tab && Object.prototype.hasOwnProperty.call(CLIENT_INBOX_ALIASES, tab);
}
```

> **Note:** `ClientInboxAlias` keys remain unchanged (for backward compat with URL path detection). Only the mapped *values* change. The `Record` value type is now `string` (not `ClientInboxAlias`) since target values are `InboxFilter` strings from the new set.

- [ ] **Step 4: Also update the inline test case for `?tab=content` redirect in the existing test**

Find the test `'redirects legacy ?tab=content to the unified inbox content filter'` and verify it still expects `'content'` (unchanged, since `content` maps to `content`). No change needed there.

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/unit/client-routes-redirect.test.tsx
```
Expected: all tests green.

- [ ] **Step 6: Typecheck + build**

```bash
npm run typecheck && npx vite build
```
Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/routes.ts tests/unit/client-routes-redirect.test.tsx
git commit -m "$(cat <<'EOF'
feat(inbox): remap ClientInboxAlias targets to new InboxFilter values

/approvals → inbox?tab=seo-changes
/requests  → inbox?tab=needs-action
/content   → inbox?tab=content (unchanged)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## 🔴 STOP — Phase 0 Review & PR

> **Do not start Task 2 until this PR is merged to staging.**

Phase 0 covers Tasks 0 and 1 — type contracts and alias remapping. These are the shared contracts that every subsequent task depends on.

- [ ] **Review: run code review**

  Single-agent mechanical work — `superpowers:requesting-code-review` is sufficient:
  ```
  /requesting-code-review
  ```

- [ ] **Review: Codex independent review**

  From the project root in your terminal:
  ```bash
  codex review
  ```
  Read the output. Any flagged issues that are actionable: fix them, re-run typecheck, commit the fix on this branch.

- [ ] **Resolve all actionable feedback** before opening the PR.

- [ ] **Open PR → staging**

  ```bash
  gh pr create \
    --base staging \
    --title "feat(inbox): Phase 0 — shared type contracts and alias remapping" \
    --body "$(cat <<'EOF'
  ## Summary
  - Updates `InboxFilter` type (8 → 5 values) with `LEGACY_FILTER_MAP` for backward-compat deep-links
  - Adds `InboxMode` type and exported `INBOX_FILTER_VALUES` const
  - Adds typed `ClientActionPayload` interfaces per source type in `shared/types/client-actions.ts`
  - Remaps `ClientInboxAlias` targets: `approvals→seo-changes`, `requests→needs-action`, `content→content`
  - Updates redirect test expectations to match new filter values

  ## Test plan
  - [ ] `npx vitest run tests/unit/client-routes-redirect.test.tsx` — all green
  - [ ] `npx vitest run tests/unit/inbox-filter-values.test.ts` — all green
  - [ ] `npm run typecheck && npx vite build` — zero errors
  - [ ] `npx tsx scripts/pr-check.ts` — zero errors
  - [ ] Existing inbox deep-links (e.g. `?tab=approvals`) still resolve correctly via LEGACY_FILTER_MAP

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```

- [ ] **Merge PR to staging** once CI is green.

- [ ] **Verify on staging** — navigate to client inbox, confirm it still loads and existing deep-links still work.

- [ ] **Start Task 2.**

---

## Task 2 — PriorityStrip Component

> **Owns:** `src/components/client/PriorityStrip.tsx` (new file)
> **Must complete before InboxTab restructure wires it in.**

**Files:**
- Create: `src/components/client/PriorityStrip.tsx`

**What it does:** Renders a compact strip of urgent items across all sections. Each row shows: icon · title · section chip · CTA button. Disappears when no items. Shows green "all caught up" when explicitly passed `showAllCaughtUp`.

- [ ] **Step 1: Write failing component test**

Create `tests/unit/PriorityStrip.test.tsx`:

```tsx
// tests/unit/PriorityStrip.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PriorityStrip } from '../../src/components/client/PriorityStrip';
import { Inbox } from 'lucide-react';

describe('PriorityStrip', () => {
  it('renders null when items is empty', () => {
    const { container } = render(<PriorityStrip items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders each item title', () => {
    render(
      <PriorityStrip
        items={[
          {
            id: 'a1',
            icon: Inbox,
            title: 'Review schema plan',
            section: 'seo-changes',
            ctaLabel: 'Review →',
            onCta: vi.fn(),
          },
        ]}
      />,
    );
    expect(screen.getByText('Review schema plan')).toBeInTheDocument();
    expect(screen.getByText('Review →')).toBeInTheDocument();
    expect(screen.getByText('SEO Changes')).toBeInTheDocument();
  });

  it('shows all caught up state when items empty and showAllCaughtUp=true', () => {
    render(<PriorityStrip items={[]} showAllCaughtUp />);
    expect(screen.getByText("You're all caught up")).toBeInTheDocument();
  });

  it('calls onCta when CTA button clicked', async () => {
    const onCta = vi.fn();
    const { getByRole } = render(
      <PriorityStrip
        items={[{ id: 'x', icon: Inbox, title: 'Test', section: 'needs-action', ctaLabel: 'Act', onCta }]}
      />,
    );
    getByRole('button', { name: 'Act' }).click();
    expect(onCta).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/PriorityStrip.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create PriorityStrip.tsx**

```tsx
// src/components/client/PriorityStrip.tsx
import type { LucideIcon } from 'lucide-react';
import { CheckCircle } from 'lucide-react';
import { Icon } from '../ui';

const SECTION_LABELS: Record<string, string> = {
  'needs-action': 'Needs Action',
  'seo-changes': 'SEO Changes',
  content: 'Content',
};

const SECTION_CHIP_CLASS: Record<string, string> = {
  'needs-action': 'bg-amber-500/15 text-accent-warning border-amber-500/30',
  'seo-changes': 'bg-teal-500/15 text-accent-brand border-teal-500/30',
  content: 'bg-blue-500/15 text-accent-info border-blue-500/30',
};

export interface PriorityItem {
  id: string;
  icon: LucideIcon;
  title: string;
  section: 'needs-action' | 'seo-changes' | 'content';
  ctaLabel: string;
  onCta: () => void;
}

interface PriorityStripProps {
  items: PriorityItem[];
  /** When true (and items is empty), renders the green "all caught up" state */
  showAllCaughtUp?: boolean;
}

export function PriorityStrip({ items, showAllCaughtUp = false }: PriorityStripProps) {
  if (items.length === 0 && !showAllCaughtUp) return null;

  if (items.length === 0 && showAllCaughtUp) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius-xl)] bg-emerald-500/10 border border-emerald-500/25">
        <Icon as={CheckCircle} size="sm" className="text-accent-success flex-shrink-0" />
        <p className="t-ui font-medium text-accent-success">You're all caught up</p>
        <p className="t-caption text-[var(--brand-text-muted)]">No pending items need your attention right now.</p>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-xl)] border border-[var(--brand-border)] bg-[var(--surface-2)] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[var(--brand-border)]">
        <p className="t-caption font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">Needs your attention</p>
      </div>
      <ul className="divide-y divide-[var(--brand-border)]">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 px-4 py-3">
            <Icon as={item.icon} size="sm" className="text-accent-warning flex-shrink-0" />
            <span className="t-ui text-[var(--brand-text)] flex-1 min-w-0 truncate">{item.title}</span>
            <span
              className={`flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-[var(--radius-pill)] t-caption-sm font-medium border ${SECTION_CHIP_CLASS[item.section] ?? ''}`}
            >
              {SECTION_LABELS[item.section] ?? item.section}
            </span>
            <button
              type="button"
              onClick={item.onCta}
              className="flex-shrink-0 t-caption font-medium text-accent-brand hover:text-[var(--brand-text-bright)] transition-colors min-h-[36px] px-2"
            >
              {item.ctaLabel}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/unit/PriorityStrip.test.tsx
```
Expected: 4 tests green.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/client/PriorityStrip.tsx tests/unit/PriorityStrip.test.tsx
git commit -m "$(cat <<'EOF'
feat(inbox): add PriorityStrip component for urgent cross-section item surfacing

Shows compact rows with icon, title, section chip, CTA. Renders null
when empty; renders green all-caught-up state when showAllCaughtUp=true.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Core InboxTab Restructure

> **Owns:** `src/components/client/InboxTab.tsx` exclusively.
> **File is ~518 lines. This task rewrites it substantially. Read the full file before starting.**

**Files:**
- Modify: `src/components/client/InboxTab.tsx`

This task:
1. Adds `InboxMode` toggle (active / completed)
2. Replaces the 8-chip filter bar with 4 section-based filter chips
3. Inserts `<PriorityStrip>` in the active view
4. Restructures body into three collapsible sections
5. Adds `useQuery` for schema plan summary (for the SEO Changes card + priority strip)
6. Moves `betaMode` gate to Content section only
7. Adds schema plan card + `schemaModalOpen` state (modal wired in Task 7)
8. Adds Tier-3 action card "View details →" wiring (modal wired in Task 8)

### Sub-task 3a: Mode toggle + filter chip update

- [ ] **Step 1: Read the complete current InboxTab.tsx before editing**

```bash
wc -l src/components/client/InboxTab.tsx
```

- [ ] **Step 2: Update imports at top of InboxTab.tsx**

Replace the existing import block (lines 1–16) with:

```ts
import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Inbox, ClipboardCheck, MessageSquare, FileText, PenLine,
  Flag, ExternalLink, Send, Check, X, Shield, Layers,
  ChevronDown, ChevronRight, AlertCircle,
} from 'lucide-react';
import { Button, EmptyState, Icon } from '../ui';
import { ApprovalsTab } from './ApprovalsTab';
import { RequestsTab } from './RequestsTab';
import { ContentTab } from './ContentTab';
import { ClientCopyReview } from './ClientCopyReview';
import { PriorityStrip } from './PriorityStrip';
import type { PriorityItem } from './PriorityStrip';
import type { Tier } from '../ui';
import type { ClientContentRequest, ClientRequest, ApprovalBatch, ContentPlanReviewCell, ApprovalPageKeyword } from './types';
import type { SchemaSitePlan } from '../../../shared/types/schema-plan';
import { STUDIO_NAME } from '../../constants';
import { getOptional, patch, post } from '../../api/client';
import { useBetaMode } from './BetaContext';
import { queryKeys } from '../../lib/queryKeys';
import type { ClientAction } from '../../../shared/types/client-actions';
import {
  INBOX_FILTER_VALUES,
  LEGACY_FILTER_MAP,
} from './InboxTab';
import type { InboxFilter, InboxMode } from './InboxTab';
```

> **Note:** Because `InboxFilter`, `InboxMode`, `INBOX_FILTER_VALUES`, and `LEGACY_FILTER_MAP` are now exported from `InboxTab.tsx` itself, the imports above will be the same module — remove the self-import lines and keep the types inline. Revise to:

```ts
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Inbox, ClipboardCheck, MessageSquare, FileText, PenLine,
  Flag, ExternalLink, Send, Check, X, Shield, Layers,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { Button, EmptyState, Icon } from '../ui';
import { ApprovalsTab } from './ApprovalsTab';
import { RequestsTab } from './RequestsTab';
import { ContentTab } from './ContentTab';
import { ClientCopyReview } from './ClientCopyReview';
import { PriorityStrip } from './PriorityStrip';
import type { PriorityItem } from './PriorityStrip';
import type { Tier } from '../ui';
import type { ClientContentRequest, ClientRequest, ApprovalBatch, ContentPlanReviewCell, ApprovalPageKeyword } from './types';
import type { SchemaSitePlan } from '../../../shared/types/schema-plan';
import { STUDIO_NAME } from '../../constants';
import { getOptional, patch, post } from '../../api/client';
import { useBetaMode } from './BetaContext';
import { queryKeys } from '../../lib/queryKeys';
import type { ClientAction } from '../../../shared/types/client-actions';
```

- [ ] **Step 3: Replace the filter/mode state and derived values block (lines 88–155)**

Replace the `filter`/`betaMode`/derived counts/filters array/showX variables block with:

```tsx
  const [searchParams] = useSearchParams();
  const [filter, setFilter] = useState<InboxFilter>(() => {
    const param = searchParams.get('tab');
    if (isInboxFilter(param)) return param;
    if (param && LEGACY_FILTER_MAP[param]) return LEGACY_FILTER_MAP[param];
    return initialFilter ?? 'needs-action';
  });
  const [mode, setMode] = useState<InboxMode>('active');
  const [schemaModalOpen, setSchemaModalOpen] = useState(false);
  const [detailAction, setDetailAction] = useState<ClientAction | null>(null);
  const [flaggingCell, setFlaggingCell] = useState<string | null>(null);
  const [flagComment, setFlagComment] = useState('');
  const [flagSubmitting, setFlagSubmitting] = useState(false);
  const [changeRequestAction, setChangeRequestAction] = useState<string | null>(null);
  const [changeRequestNote, setChangeRequestNote] = useState('');
  // SEO Changes section collapse (collapses when nothing pending in active mode)
  const [seoSectionExpanded, setSeoSectionExpanded] = useState(false);

  const betaMode = useBetaMode();

  // Schema plan summary — drives SEO Changes card + priority strip item
  const schemaPlanQuery = useQuery({
    queryKey: queryKeys.client.schemaPlan(workspaceId),
    queryFn: () => getOptional<SchemaSitePlan>(`/api/public/schema-plan/${workspaceId}`),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });
  const schemaPlan = schemaPlanQuery.data ?? null;
  const schemaPlanPending = schemaPlan?.status === 'sent_to_client';

  // Derived counts
  const pendingRequests = requests.filter(r => r.status !== 'completed' && r.status !== 'closed').length;
  const requestReplies = requests.filter(
    r => r.notes.length > 0 && r.notes[r.notes.length - 1].author === 'team'
      && r.status !== 'completed' && r.status !== 'closed'
  ).length;
  const contentReviews = contentRequests.filter(
    r => r.status === 'client_review' || r.status === 'post_review',
  ).length;
  const planReviewCount = contentPlanReviewCells.length;
  const pendingClientActions = clientActions.filter(a => a.status === 'pending');
  const completedClientActions = clientActions.filter(a => a.status !== 'pending');

  // Section 1 (Needs Action) has pending items?
  const hasNeedsAction = pendingClientActions.length > 0 || requestReplies > 0 || planReviewCount > 0;
  // Section 2 (SEO Changes) has pending items?
  const hasPendingApprovals = (pendingApprovals ?? 0) > 0;
  const hasPendingSeoChanges = hasPendingApprovals || schemaPlanPending;
  // Section 3 badge counts
  const copyReviewCount = hasCopyEntries ? 1 : 0;

  // Chips — hidden in completed mode
  const filterChips: { id: InboxFilter; label: string; count?: number }[] = [
    { id: 'all', label: 'All' },
    { id: 'needs-action', label: 'Needs Action & Requests',
      count: (pendingClientActions.length + requestReplies + planReviewCount) || undefined },
    { id: 'seo-changes', label: 'SEO Changes',
      count: ((pendingApprovals ?? 0) + (schemaPlanPending ? 1 : 0)) || undefined },
    ...(!betaMode ? [{ id: 'content' as InboxFilter, label: 'Content',
      count: (contentReviews + copyReviewCount) || undefined }] : []),
  ];

  // Priority strip items (active mode only)
  const priorityItems: PriorityItem[] = [];
  // 1. Requests with team replies (most time-sensitive)
  for (const r of requests) {
    const lastNote = r.notes[r.notes.length - 1];
    if (lastNote?.author === 'team' && r.status !== 'completed' && r.status !== 'closed') {
      priorityItems.push({
        id: `request-${r.id}`,
        icon: MessageSquare,
        title: r.title,
        section: 'needs-action',
        ctaLabel: 'Reply →',
        onCta: () => { setFilter('needs-action'); },
      });
    }
  }
  // 2. Pending approval batches (team is blocked)
  for (const b of approvalBatches.filter(b => b.items.some(i => i.status === 'pending' || !i.status))) {
    priorityItems.push({
      id: `batch-${b.id}`,
      icon: ClipboardCheck,
      title: b.name,
      section: 'seo-changes',
      ctaLabel: 'Review →',
      onCta: () => { setFilter('seo-changes'); },
    });
  }
  // 3. Schema plan pending initial feedback
  if (schemaPlanPending) {
    priorityItems.push({
      id: 'schema-plan',
      icon: Shield,
      title: 'Schema strategy ready for review',
      section: 'seo-changes',
      ctaLabel: 'Review →',
      onCta: () => { setSchemaModalOpen(true); },
    });
  }
  // 4. Pending client action cards
  for (const a of pendingClientActions) {
    priorityItems.push({
      id: `action-${a.id}`,
      icon: Flag,
      title: a.title,
      section: 'needs-action',
      ctaLabel: 'View →',
      onCta: () => { setDetailAction(a); },
    });
  }
  // 5. Content at review status
  for (const c of contentRequests.filter(r => r.status === 'client_review' || r.status === 'post_review')) {
    priorityItems.push({
      id: `content-${c.id}`,
      icon: FileText,
      title: c.topic || c.title || 'Content review',
      section: 'content',
      ctaLabel: 'Review →',
      onCta: () => { setFilter('content'); },
    });
  }
  // 6. Content plan cells at review
  for (const cell of contentPlanReviewCells) {
    priorityItems.push({
      id: `plan-${cell.cellId}`,
      icon: Layers,
      title: cell.topic || 'Content plan cell',
      section: 'needs-action',
      ctaLabel: 'Review →',
      onCta: () => { setFilter('needs-action'); },
    });
  }
  // 7. Copy review awaiting approval
  if (hasCopyEntries) {
    priorityItems.push({
      id: 'copy-review',
      icon: PenLine,
      title: 'Copy sections awaiting your approval',
      section: 'content',
      ctaLabel: 'Review →',
      onCta: () => { setFilter('content'); },
    });
  }
```

- [ ] **Step 4: Rewrite the JSX return block**

Replace everything from `return (` through the closing `</div>` with:

```tsx
  const showSection1 = mode === 'active' && (filter === 'all' || filter === 'needs-action');
  const showSection2 = mode === 'active' && (filter === 'all' || filter === 'seo-changes');
  const showSection3 = mode === 'active' && !betaMode && (filter === 'all' || filter === 'content');

  // SEO Changes section auto-collapses when nothing is pending in active mode
  const seoSectionHasItems = hasPendingSeoChanges || approvalBatches.length > 0 || schemaPlan !== null;
  const seoSectionDefaultCollapsed = !hasPendingSeoChanges;

  return (
    <div className="space-y-6">
      {/* ── Page header + mode toggle ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Icon as={Inbox} size="lg" className="text-accent-brand" />
          <div>
            <h2 className="t-h2 text-[var(--brand-text-bright)]">Inbox</h2>
            <p className="t-body text-[var(--brand-text-muted)] mt-0.5">
              {betaMode ? 'SEO changes and requests — all in one place.' : 'SEO changes, requests, and content — all in one place.'}
            </p>
          </div>
        </div>
        {/* Active / Completed toggle */}
        <div className="flex items-center gap-0.5 p-1 rounded-[var(--radius-lg)] bg-[var(--surface-3)] border border-[var(--brand-border)]">
          {(['active', 'completed'] as InboxMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-3.5 py-1.5 rounded-[var(--radius-md)] t-caption-sm font-medium capitalize transition-colors ${
                mode === m
                  ? 'bg-[var(--surface-1)] text-[var(--brand-text-bright)] shadow-sm'
                  : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'
              }`}
            >
              {m === 'active' ? 'Active' : 'Completed'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Filter chips (active mode only) ── */}
      {mode === 'active' && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {filterChips.map(f => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] rounded-[var(--radius-pill)] t-caption-sm font-medium transition-colors ${
                filter === f.id
                  ? 'bg-teal-500/15 border border-teal-500/30 text-accent-brand'
                  : 'bg-[var(--surface-3)]/50 border border-[var(--brand-border)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)]'
              }`}
            >
              {f.label}
              {f.count !== undefined && (
                <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold ${
                  filter === f.id ? 'bg-teal-500/20 text-accent-brand' : 'bg-[var(--surface-2)] text-[var(--brand-text-muted)]'
                }`}>
                  {f.count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── Priority strip (active mode only) ── */}
      {mode === 'active' && (
        <PriorityStrip
          items={priorityItems}
          showAllCaughtUp={
            !approvalsLoading && !requestsLoading &&
            priorityItems.length === 0 &&
            clientActions.length === 0 &&
            requests.length === 0
          }
        />
      )}

      {/* ── Section 1: Needs Action & Requests ── */}
      {showSection1 && (
        <section aria-label="Needs Action & Requests" className="space-y-4">
          <div className="flex items-center gap-2">
            <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Needs Action &amp; Requests</h3>
            {hasNeedsAction && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-[var(--radius-pill)] t-caption-sm font-medium bg-amber-500/15 text-accent-warning border border-amber-500/30">
                {pendingClientActions.length + requestReplies + planReviewCount} pending
              </span>
            )}
          </div>

          {/* Client Action Cards */}
          {pendingClientActions.length > 0 && (
            <div className="space-y-3">
              <p className="t-caption-sm text-[var(--brand-text-muted)] uppercase font-semibold tracking-wider">Action Items</p>
              {pendingClientActions.map(action => (
                <div key={action.id} className="rounded-[var(--radius-xl)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="t-caption-sm font-medium px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--surface-3)] text-[var(--brand-text-muted)] border border-[var(--brand-border)] capitalize">
                          {action.sourceType.replace(/_/g, ' ')}
                        </span>
                        {action.priority === 'high' && (
                          <span className="t-caption-sm font-medium text-accent-warning">High priority</span>
                        )}
                      </div>
                      <h4 className="t-ui font-medium text-[var(--brand-text-bright)]">{action.title}</h4>
                      <p className="t-caption text-[var(--brand-text-muted)] mt-0.5 line-clamp-2">{action.summary}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    {/* Tier 1 (content_decay): inline approve/reject */}
                    {action.sourceType === 'content_decay' ? (
                      <>
                        <Button size="sm" variant="primary" onClick={() => respondToClientAction(action.id, 'approved')}>
                          Approve
                        </Button>
                        {changeRequestAction !== action.id ? (
                          <Button size="sm" variant="ghost" onClick={() => setChangeRequestAction(action.id)}>
                            Request changes
                          </Button>
                        ) : (
                          <div className="flex items-center gap-2 flex-1">
                            <input
                              type="text"
                              value={changeRequestNote}
                              onChange={e => setChangeRequestNote(e.target.value)}
                              placeholder="Add a note for your team…"
                              className="flex-1 px-3 py-1.5 rounded-[var(--radius-md)] t-caption bg-[var(--surface-3)] border border-[var(--brand-border)] text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] outline-none focus:border-teal-500/50"
                            />
                            <Button size="sm" variant="primary" onClick={() => changeRequestNote.trim() && respondToClientAction(action.id, 'changes_requested', changeRequestNote.trim())}>
                              Send
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => { setChangeRequestAction(null); setChangeRequestNote(''); }}>
                              Cancel
                            </Button>
                          </div>
                        )}
                      </>
                    ) : (
                      /* Tier 3: "View details →" opens modal */
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDetailAction(action)}
                      >
                        View details →
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Content Plan sign-offs */}
          {planReviewCount > 0 && (
            <div className="space-y-3">
              <p className="t-caption-sm text-[var(--brand-text-muted)] uppercase font-semibold tracking-wider">Content Plan</p>
              {contentPlanReviewCells.map(cell => (
                <div key={cell.cellId} className="rounded-[var(--radius-xl)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <span className="t-caption-sm text-accent-brand">
                        <Layers className="inline w-3.5 h-3.5 mr-1" />Content plan · needs review
                      </span>
                      <h4 className="t-ui font-medium text-[var(--brand-text-bright)] mt-0.5">{cell.topic || 'Content plan cell'}</h4>
                    </div>
                    <div className="flex items-center gap-2">
                      {flaggingCell !== cell.cellId ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setFlaggingCell(cell.cellId)}>
                            <Flag className="w-3.5 h-3.5 mr-1" />Flag
                          </Button>
                        </>
                      ) : (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={flagComment}
                            onChange={e => setFlagComment(e.target.value)}
                            placeholder="What's your concern?"
                            className="px-3 py-1.5 rounded-[var(--radius-md)] t-caption bg-[var(--surface-3)] border border-[var(--brand-border)] text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] outline-none focus:border-teal-500/50 w-48"
                          />
                          <Button size="sm" variant="primary" disabled={flagSubmitting} onClick={() => handleFlagCell(cell)}>
                            {flagSubmitting ? 'Sending…' : 'Send'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setFlaggingCell(null); setFlagComment(''); }}>
                            Cancel
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Requests */}
          <div className="space-y-3">
            <p className="t-caption-sm text-[var(--brand-text-muted)] uppercase font-semibold tracking-wider">Requests</p>
            <RequestsTab
              workspaceId={workspaceId}
              requests={requests}
              requestsLoading={requestsLoading}
              clientUser={clientUser}
              loadRequests={loadRequests}
              setToast={setToast}
            />
          </div>
        </section>
      )}

      {/* ── Section 2: SEO Changes ── */}
      {showSection2 && (
        <section aria-label="SEO Changes" className="space-y-4">
          <button
            type="button"
            className="flex items-center gap-2 w-full text-left"
            onClick={() => setSeoSectionExpanded(e => !e)}
          >
            <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">SEO Changes</h3>
            {hasPendingSeoChanges && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-[var(--radius-pill)] t-caption-sm font-medium bg-teal-500/15 text-accent-brand border border-teal-500/30">
                {(pendingApprovals ?? 0) + (schemaPlanPending ? 1 : 0)} pending
              </span>
            )}
            {!hasPendingSeoChanges && (
              <span className="t-caption text-[var(--brand-text-muted)]">
                Nothing pending
              </span>
            )}
            <span className="ml-auto text-[var(--brand-text-muted)]">
              {(hasPendingSeoChanges || seoSectionExpanded) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </span>
          </button>

          {(hasPendingSeoChanges || seoSectionExpanded) && (
            <div className="space-y-4">
              {/* Approval batches */}
              <ApprovalsTab
                workspaceId={workspaceId}
                approvalBatches={approvalBatches}
                approvalsLoading={approvalsLoading}
                pendingApprovals={pendingApprovals}
                effectiveTier={effectiveTier}
                setApprovalBatches={setApprovalBatches}
                loadApprovals={loadApprovals}
                setToast={setToast}
                pageMap={pageMap}
              />

              {/* Schema plan card */}
              {schemaPlan && (
                <div className="rounded-[var(--radius-xl)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Icon as={Shield} size="sm" className="text-accent-brand" />
                        <span className="t-caption-sm font-medium text-accent-brand">Schema Strategy</span>
                        {schemaPlanPending && (
                          <span className="t-caption-sm font-medium px-2 py-0.5 rounded-[var(--radius-pill)] bg-amber-500/15 text-accent-warning border border-amber-500/30">Ready for review</span>
                        )}
                      </div>
                      <h4 className="t-ui font-medium text-[var(--brand-text-bright)]">
                        Schema strategy — {schemaPlan.pageRoles.length} page{schemaPlan.pageRoles.length !== 1 ? 's' : ''}
                      </h4>
                      <p className="t-caption text-[var(--brand-text-muted)] mt-0.5">
                        {schemaPlanPending
                          ? 'Your schema strategy is ready for your review and approval.'
                          : schemaPlan.status === 'client_approved' ? 'Approved — implementation in progress.'
                          : schemaPlan.status === 'active' ? 'Active schema strategy.'
                          : 'Schema strategy on file.'}
                      </p>
                    </div>
                    <Button size="sm" variant={schemaPlanPending ? 'primary' : 'ghost'} onClick={() => setSchemaModalOpen(true)}>
                      Review schema plan →
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── Section 3: Content ── */}
      {showSection3 && (
        <section aria-label="Content" className="space-y-4">
          <div className="flex items-center gap-2">
            <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Content</h3>
            {(contentReviews + copyReviewCount) > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-[var(--radius-pill)] t-caption-sm font-medium bg-blue-500/15 text-accent-info border border-blue-500/30">
                {contentReviews + copyReviewCount} needs review
              </span>
            )}
          </div>

          {/* Copy Review — ClientCopyReview manages its own toasts internally */}
          {hasCopyEntries && (
            <div className="space-y-2">
              <p className="t-caption-sm text-[var(--brand-text-muted)] uppercase font-semibold tracking-wider">Copy Review</p>
              <ClientCopyReview workspaceId={workspaceId} />
            </div>
          )}

          {/* Content Pipeline */}
          <div className="space-y-2">
            <p className="t-caption-sm text-[var(--brand-text-muted)] uppercase font-semibold tracking-wider">Pipeline</p>
            <ContentTab
              workspaceId={workspaceId}
              contentRequests={contentRequests}
              setContentRequests={setContentRequests}
              effectiveTier={effectiveTier}
              briefPrice={briefPrice}
              fullPostPrice={fullPostPrice}
              fmtPrice={fmtPrice}
              setPricingModal={setPricingModal}
              pricingConfirming={pricingConfirming}
              setToast={setToast}
              hidePrices={hidePrices}
            />
          </div>
        </section>
      )}

      {/* ── Completed mode: history log ── */}
      {mode === 'completed' && (
        <div className="space-y-6">
          <div className="space-y-4">
            <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Completed — SEO Changes</h3>
            <ApprovalsTab
              workspaceId={workspaceId}
              approvalBatches={approvalBatches.filter(b => b.items.length > 0 && b.items.every(i => i.status === 'applied'))}
              approvalsLoading={approvalsLoading}
              pendingApprovals={0}
              effectiveTier={effectiveTier}
              setApprovalBatches={setApprovalBatches}
              loadApprovals={loadApprovals}
              setToast={setToast}
              pageMap={pageMap}
            />
          </div>
          {completedClientActions.length > 0 && (
            <div className="space-y-4">
              <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Completed — Actions</h3>
              {completedClientActions.map(action => (
                <div key={action.id} className="rounded-[var(--radius-xl)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4 opacity-70">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="t-caption-sm px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--surface-3)] text-[var(--brand-text-muted)] border border-[var(--brand-border)] capitalize">
                      {action.sourceType.replace(/_/g, ' ')}
                    </span>
                    <span className={`t-caption-sm px-2 py-0.5 rounded-[var(--radius-pill)] border font-medium ${
                      action.status === 'approved' ? 'bg-emerald-500/15 text-accent-success border-emerald-500/30' :
                      action.status === 'changes_requested' ? 'bg-amber-500/15 text-accent-warning border-amber-500/30' :
                      'bg-[var(--surface-3)] text-[var(--brand-text-muted)] border-[var(--brand-border)]'
                    }`}>
                      {action.status === 'approved' ? 'Approved' : action.status === 'changes_requested' ? 'Changes requested' : 'Completed'}
                    </span>
                  </div>
                  <h4 className="t-ui font-medium text-[var(--brand-text)]">{action.title}</h4>
                </div>
              ))}
            </div>
          )}
          {completedClientActions.length === 0 && approvalBatches.filter(b => b.items.every(i => i.status === 'applied')).length === 0 && (
            <EmptyState
              icon={Check}
              title="No completed items yet"
              description="Resolved approvals, actions, and requests will appear here."
            />
          )}
        </div>
      )}

      {/* ── Modals (wired in Tasks 7 & 8) — placeholders keep compile green ── */}
      {/* SchemaReviewModal mounted here in Task 7 */}
      {/* ClientActionDetailModal mounted here in Task 8 */}
    </div>
  );
```

- [ ] **Step 5: Verify the `respondToClientAction` and `handleFlagCell` functions remain intact**

These functions were already in InboxTab and should not change. Confirm they still exist in the file after the rewrite.

- [ ] **Step 6: Typecheck + build**

```bash
npm run typecheck && npx vite build
```

Expected: zero TypeScript errors. If ApprovalsTab, RequestsTab, or ContentTab prop interfaces differ from what's passed above, fix the prop names to match their actual interfaces (read each component's interface before passing props).

> **Known interface check required:**
> - `ApprovalsTab` — confirm exact prop names (`approvalBatches`, `loading`, `setApprovalBatches`, `loadApprovals`, `setToast`, `pageMap`)
> - `RequestsTab` — confirm exact prop names (`requests`, `loading`, `clientUser`, `loadRequests`, `setToast`, `hidePrices`)
> - `ContentTab` — confirm exact prop names
>
> Run `grep -n "interface.*Props\|export function.*Tab" src/components/client/ApprovalsTab.tsx src/components/client/RequestsTab.tsx src/components/client/ContentTab.tsx` to verify before typing.

- [ ] **Step 7: Run full test suite**

```bash
npx vitest run
```
Expected: all tests pass (the contract test may flag `?tab=approvals` sender if ActionQueueStrip hasn't been updated yet — this is expected and will be resolved in Task 4).

- [ ] **Step 8: Commit**

```bash
git add src/components/client/InboxTab.tsx
git commit -m "$(cat <<'EOF'
feat(inbox): restructure InboxTab into three-section layout with mode toggle and priority strip

Replaces flat 8-chip filter bar with:
- Active/Completed mode toggle
- 4 section-based filter chips (All / Needs Action & Requests / SEO Changes / Content)
- PriorityStrip at top of active view surfacing urgent items across all sections
- Section 1: Needs Action (client actions + content plan sign-offs + requests)
- Section 2: SEO Changes (approval batches + schema plan card, collapses when empty)
- Section 3: Content (copy review + content pipeline, betaMode gated)
- LEGACY_FILTER_MAP backward-compat for old ?tab= deep-links during migration window

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## 🔴 STOP — Phase 1 Review & PR

> **Do not start Tasks 4 or 5 until this PR is merged to staging.**

Phase 1 covers Tasks 2 and 3 — the PriorityStrip component and full InboxTab restructure. This is the largest diff of the entire project.

- [ ] **Review: run scaled code review**

  This phase has significant complexity — use the full scaled review:
  ```
  /scaled-code-review
  ```

- [ ] **Review: Codex independent review**

  ```bash
  codex review
  ```
  Pay particular attention to Codex findings on:
  - Priority strip item assembly logic (check for missing signal types)
  - SEO Changes section collapse logic (should be collapsed when nothing pending)
  - `betaMode` gating — must only gate Section 3 (Content), not Sections 1 or 2
  - `LEGACY_FILTER_MAP` being used in the `useState` init (backward compat)

- [ ] **Resolve all actionable feedback.**

- [ ] **Open PR → staging**

  ```bash
  gh pr create \
    --base staging \
    --title "feat(inbox): Phase 1 — PriorityStrip + InboxTab three-section restructure" \
    --body "$(cat <<'EOF'
  ## Summary
  - New `PriorityStrip` component surfaces urgent items across all three sections
  - InboxTab fully restructured: Active/Completed mode toggle, 4 filter chips, 3 collapsible sections
  - Section 1: Needs Action (client action cards + content plan sign-offs + requests)
  - Section 2: SEO Changes (approval batches + schema plan card, auto-collapses when nothing pending)
  - Section 3: Content (copy review + content pipeline, betaMode gated)
  - Internal `useQuery` for schema plan summary (priority strip + SEO Changes card)
  - LEGACY_FILTER_MAP handles backward-compat deep-links from ActionQueueStrip (updated in Phase 2)

  ## Test plan
  - [ ] `npx vitest run tests/unit/PriorityStrip.test.tsx` — 4 tests green
  - [ ] `npm run typecheck && npx vite build` — zero errors
  - [ ] `npx tsx scripts/pr-check.ts` — zero errors
  - [ ] Navigate to client inbox on staging — Active mode shows priority strip + 3 sections
  - [ ] Filter chips hide/show correct sections
  - [ ] Active/Completed toggle switches modes
  - [ ] Schema plan card visible in SEO Changes (if workspace has one)
  - [ ] Tier-1 action card (content_decay) approves/rejects inline
  - [ ] Tier-3 action card shows "View details →" (modal wired in Phase 4)
  - [ ] Deep-link `?tab=seo-changes` initializes correctly
  - [ ] Deep-link `?tab=approvals` (legacy) maps to seo-changes via LEGACY_FILTER_MAP

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```

- [ ] **Merge PR to staging** once CI is green.

- [ ] **Verify on staging** — walk through every section, mode toggle, filter chip, and priority strip item.

- [ ] **Start Tasks 4 and 5 in parallel.**

---

## Task 4 — Remove schema-review Standalone Tab

> **Phase 2A — can run in parallel with Task 5.**
> **Owns:** `src/routes.ts` (ClientTab union only), `src/components/ClientDashboard.tsx`
> **IMPORTANT: Before starting, confirm Task 3 (core InboxTab restructure) is merged. The schema plan card must exist in InboxTab before removing the standalone tab.**

Read `docs/rules/route-removal-checklist.md` before starting. The checklist applies to `ClientTab` values.

**Files:**
- Modify: `src/routes.ts` line 25
- Modify: `src/components/ClientDashboard.tsx` lines 31, 669, 821–823

- [ ] **Step 1: Remove 'schema-review' from the ClientTab union**

In `src/routes.ts`, line 25, change:

```ts
// Before
export type ClientTab = 'overview' | 'performance' | 'search' | 'health' | 'strategy' | 'analytics' | 'inbox' | 'approvals' | 'requests' | 'content' | 'plans' | 'roi' | 'brand';
```

to:

```ts
export type ClientTab = 'overview' | 'performance' | 'search' | 'health' | 'strategy' | 'analytics' | 'inbox' | 'approvals' | 'requests' | 'content' | 'content-plan' | 'plans' | 'roi' | 'brand';
```

> **Note:** `'schema-review'` is removed. `'approvals'`, `'requests'`, `'content'` remain as they are backward-compat aliases handled by `isClientInboxAlias`. Also add `'content-plan'` explicitly since it was being cast with `as ClientTab` — making it official removes the cast.

- [ ] **Step 2: Remove SchemaReviewTab import from ClientDashboard.tsx**

Remove line 31:
```ts
import { SchemaReviewTab } from './client/SchemaReviewTab';
```

- [ ] **Step 3: Remove schema-review tab from the nav array**

In `ClientDashboard.tsx`, remove the nav entry at line 669:
```ts
// Remove this line:
...(isPaid ? [{ id: 'schema-review' as ClientTab, label: 'Schema', icon: Shield, locked: false }] : []),
```

> If `Shield` is no longer used after this removal, also remove it from the lucide import. Check with `grep -n "Shield" src/components/ClientDashboard.tsx`.

- [ ] **Step 4: Remove schema-review render case**

In `ClientDashboard.tsx`, remove lines 821–823:
```tsx
// Remove these lines:
{tab === 'schema-review' && (
  <SchemaReviewTab workspaceId={workspaceId} setToast={setToast} />
)}
```

- [ ] **Step 5: Run the route-removal checklist**

From `docs/rules/route-removal-checklist.md`, check all 7 update sites. For `'schema-review'` as a `ClientTab` value:

```bash
grep -rn "schema-review" src/ tests/
```

Expected: zero results after cleanup. Fix any remaining references.

- [ ] **Step 6: Typecheck + build**

```bash
npm run typecheck && npx vite build
```
Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/routes.ts src/components/ClientDashboard.tsx
git commit -m "$(cat <<'EOF'
feat(inbox): retire schema-review standalone tab — schema plan now lives in Inbox > SEO Changes

Removes ClientTab 'schema-review' (route-removal-checklist applied: all 7 sites).
SchemaReviewTab component is reused inside SchemaReviewModal (Task 6).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — ActionQueueStrip + Test Updates

> **Phase 2B — runs in parallel with Task 4.**
> **Owns:** `ActionQueueStrip.tsx`, test files. Does NOT touch InboxTab.tsx or ClientDashboard.tsx.**

**Files:**
- Modify: `src/components/client/Briefing/ActionQueueStrip.tsx`
- Modify: `tests/unit/client-routes-redirect.test.tsx`
- Read (verify only): `tests/contract/tab-deep-link-wiring.test.ts`

- [ ] **Step 1: Update the Chip interface in ActionQueueStrip.tsx**

At line 81, replace:
```ts
interface Chip {
  count: number;
  label: string;
  section: 'approvals' | 'content' | 'requests' | 'content-plan';
}
```
with:
```ts
interface Chip {
  count: number;
  label: string;
  /**
   * Must be a valid InboxFilter value — see INBOX_FILTER_VALUES in InboxTab.tsx.
   * Clicking a chip navigates to `?tab=${section}` on the inbox route.
   */
  section: 'seo-changes' | 'content' | 'needs-action';
}
```

- [ ] **Step 2: Update chip push calls in ActionQueueStrip.tsx**

In the chips-building block:

```ts
// approvals → seo-changes
chips.push({ count: counts.approvals, label: ..., section: 'seo-changes' });

// briefs and posts stay 'content'
chips.push({ count: counts.briefs, label: ..., section: 'content' });
chips.push({ count: counts.posts,  label: ..., section: 'content' });

// replies → needs-action (was 'requests')
chips.push({ count: counts.replies, label: ..., section: 'needs-action' });

// contentPlan → needs-action (was 'content-plan')
chips.push({ count: counts.contentPlan, label: ..., section: 'needs-action' });
```

Also update the escalation pill's section (line 157 area — it navigates to 'approvals' filter):
```ts
// Old: section: 'approvals'
// New: section: 'seo-changes'
```

Find the escalation pill navigate call and update:
```ts
onClick={() => navigate(`${clientPath(workspaceId, 'inbox', betaMode)}?tab=seo-changes`)}
```

- [ ] **Step 3: Update the jsdoc comment above the Chip interface**

```ts
/**
 * The `section` value MUST be a real InboxFilter value — see
 * `INBOX_FILTER_VALUES` in `src/components/client/InboxTab.tsx`.
 * approvals → seo-changes, requests/replies → needs-action,
 * content-plan → needs-action. Drift here silently sends users to the
 * default 'all' filter — covered by the tab-deep-link-wiring contract test.
 */
```

- [ ] **Step 4: Run the tab-deep-link contract test to verify no regressions**

```bash
npx vitest run tests/contract/tab-deep-link-wiring.test.ts
```

The contract test checks that every `?tab=X` sender targets a component that reads `searchParams.get('tab')` AND recognizes the tab value. After Task 3, InboxTab recognizes `seo-changes` and `needs-action`. After this task, ActionQueueStrip sends those new values. Expected: all pass.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/components/client/Briefing/ActionQueueStrip.tsx
git commit -m "$(cat <<'EOF'
feat(inbox): update ActionQueueStrip chip sections to new InboxFilter values

approvals → seo-changes, requests → needs-action, content-plan → needs-action

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## 🔴 STOP — Phase 2 Review & PR

> **Tasks 4 and 5 ran in parallel — wait for BOTH to be complete before reviewing.**
> **Do not start Task 6 until this PR is merged to staging.**

Phase 2 covers Tasks 4 and 5 — schema-review tab retirement and ActionQueueStrip/test updates. Parallel agent work always requires scaled review.

- [ ] **Review: run scaled code review** (required — parallel agents touched separate files)

  ```
  /scaled-code-review
  ```

- [ ] **Review: Codex independent review**

  ```bash
  codex review
  ```
  Pay particular attention to Codex findings on:
  - Route removal checklist completeness — all 7 sites updated for `'schema-review'`
  - ActionQueueStrip chip section values — confirm `approvals→seo-changes`, `replies→needs-action`, `content-plan→needs-action`
  - No stray `schema-review` references in `src/`

- [ ] **Verify no `schema-review` references remain**

  ```bash
  grep -rn "schema-review" src/ tests/
  ```
  Expected: zero results.

- [ ] **Verify no old chip section values remain**

  ```bash
  grep -n "'approvals'\|'requests'\|'content-plan'" src/components/client/Briefing/ActionQueueStrip.tsx
  ```
  Expected: zero results.

- [ ] **Resolve all actionable feedback.**

- [ ] **Open PR → staging**

  ```bash
  gh pr create \
    --base staging \
    --title "feat(inbox): Phase 2 — retire schema-review tab + update ActionQueueStrip chip values" \
    --body "$(cat <<'EOF'
  ## Summary
  - Removes `'schema-review'` from `ClientTab` union (route-removal-checklist applied: all 7 sites)
  - Removes SchemaReviewTab import, nav entry, and render case from ClientDashboard
  - Updates ActionQueueStrip Chip section values: approvals→seo-changes, requests/replies→needs-action, content-plan→needs-action
  - Updates client-routes-redirect test expectations for new alias target values

  ## Test plan
  - [ ] `npx vitest run tests/unit/client-routes-redirect.test.tsx` — all green
  - [ ] `npx vitest run tests/contract/tab-deep-link-wiring.test.ts` — all green
  - [ ] `npm run typecheck && npx vite build` — zero errors
  - [ ] `npx tsx scripts/pr-check.ts` — zero errors
  - [ ] `grep -rn "schema-review" src/ tests/` — zero results
  - [ ] Navigate to client dashboard on staging — no "Schema" tab in nav
  - [ ] ActionQueueStrip chips navigate to correct new filter sections

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```

- [ ] **Merge PR to staging** once CI is green.

- [ ] **Verify on staging** — confirm "Schema" tab is gone from client nav, ActionQueueStrip chips deep-link correctly.

- [ ] **Start Task 6.**

---

## Task 6 — SchemaReviewModal

> **Phase 3. Depends on Task 3 (InboxTab has schema plan card) and Task 4 (standalone tab removed).**
> **Owns:** `src/components/client/SchemaReviewModal.tsx` (new file), plus wires into InboxTab.**

**Files:**
- Create: `src/components/client/SchemaReviewModal.tsx`
- Modify: `src/components/client/InboxTab.tsx` (add import + modal mount)

- [ ] **Step 1: Create SchemaReviewModal.tsx**

```tsx
// src/components/client/SchemaReviewModal.tsx
/**
 * SchemaReviewModal — full-screen modal wrapper for SchemaReviewTab.
 * Replaces the standalone 'schema-review' ClientTab (removed in Phase 2A).
 * Triggered from the schema plan card in InboxTab's SEO Changes section.
 */
import { X } from 'lucide-react';
import { SchemaReviewTab } from './SchemaReviewTab';

interface SchemaReviewModalProps {
  workspaceId: string;
  setToast: (toast: { message: string; type: 'success' | 'error' } | null) => void;
  onClose: () => void;
}

export function SchemaReviewModal({ workspaceId, setToast, onClose }: SchemaReviewModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[var(--surface-1)]"
      role="dialog"
      aria-modal="true"
      aria-label="Schema plan review"
    >
      {/* Modal header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--brand-border)] flex-shrink-0">
        <h2 className="t-h2 text-[var(--brand-text-bright)]">Schema Strategy Review</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close schema review"
          className="flex items-center justify-center w-9 h-9 rounded-[var(--radius-md)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)] transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-6 py-6 max-w-4xl mx-auto w-full">
        <SchemaReviewTab workspaceId={workspaceId} setToast={setToast} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire SchemaReviewModal into InboxTab.tsx**

Add import to InboxTab.tsx (top of file, with other imports):
```ts
import { SchemaReviewModal } from './SchemaReviewModal';
```

In the JSX return block, replace the comment `{/* SchemaReviewModal mounted here in Task 7 */}` with:

```tsx
{/* Schema Review Modal */}
{schemaModalOpen && (
  <SchemaReviewModal
    workspaceId={workspaceId}
    setToast={setToast}
    onClose={() => setSchemaModalOpen(false)}
  />
)}
```

- [ ] **Step 3: Typecheck + build**

```bash
npm run typecheck && npx vite build
```
Expected: zero errors.

- [ ] **Step 4: Manual smoke test**

1. Navigate to the client inbox on a workspace that has a schema plan
2. Confirm the schema plan card appears in SEO Changes section
3. Click "Review schema plan →" — modal should open covering full screen
4. Click X to close — modal should dismiss, inbox visible again

- [ ] **Step 5: Commit**

```bash
git add src/components/client/SchemaReviewModal.tsx src/components/client/InboxTab.tsx
git commit -m "$(cat <<'EOF'
feat(inbox): add SchemaReviewModal — full-screen modal wrapping SchemaReviewTab

Triggered from schema plan card in Inbox > SEO Changes section.
Replaces the now-retired standalone schema-review client tab.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## 🔴 STOP — Phase 3 Review & PR

> **Do not start Task 7 until this PR is merged to staging.**

Phase 3 covers Task 6 — the SchemaReviewModal that replaces the retired standalone tab.

- [ ] **Review: run code review**

  Single new component + wiring — `superpowers:requesting-code-review` is sufficient:
  ```
  /requesting-code-review
  ```

- [ ] **Review: Codex independent review**

  ```bash
  codex review
  ```
  Pay particular attention to:
  - Modal accessibility (`role="dialog"`, `aria-modal`, `aria-label`, focus trapping)
  - Close button keyboard accessibility
  - Scrollable body doesn't break on small viewports

- [ ] **Resolve all actionable feedback.**

- [ ] **Open PR → staging**

  ```bash
  gh pr create \
    --base staging \
    --title "feat(inbox): Phase 3 — SchemaReviewModal wrapping existing SchemaReviewTab" \
    --body "$(cat <<'EOF'
  ## Summary
  - New `SchemaReviewModal` component: full-screen modal triggered from schema plan card in Inbox > SEO Changes
  - Wraps the existing `SchemaReviewTab` component with a header bar and X close button
  - Wired into InboxTab via `schemaModalOpen` state and "Review schema plan →" CTA

  ## Test plan
  - [ ] `npm run typecheck && npx vite build` — zero errors
  - [ ] `npx tsx scripts/pr-check.ts` — zero errors
  - [ ] On staging: navigate to Inbox on a workspace with a schema plan
  - [ ] Schema plan card visible in SEO Changes section
  - [ ] "Review schema plan →" opens full-screen modal
  - [ ] X button closes modal, inbox visible behind
  - [ ] Schema plan review/approve flow works inside modal (same as old standalone tab)
  - [ ] Priority strip "Review →" on schema plan item also opens modal

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```

- [ ] **Merge PR to staging** once CI is green.

- [ ] **Verify on staging** — full schema plan review flow inside the modal.

- [ ] **Start Task 7.**

---

## Task 7 — Tier-3 Action Card Detail Modal

> **Phase 4. Depends on Task 3 (InboxTab has action cards with "View details →" buttons).**
> **Owns:** `src/components/client/ClientActionDetailModal.tsx` (new), `InboxTab.tsx` (wire).**

**Files:**
- Create: `src/components/client/ClientActionDetailModal.tsx`
- Modify: `src/components/client/InboxTab.tsx` (add import + modal mount)

- [ ] **Step 1: Create ClientActionDetailModal.tsx**

The modal wraps a per-sourceType renderer. Each renderer receives the `payload` cast to the appropriate typed interface from `shared/types/client-actions.ts` (added in Task 0).

```tsx
// src/components/client/ClientActionDetailModal.tsx
/**
 * ClientActionDetailModal — Tier-3 full-screen modal for client action cards
 * that have complex payloads requiring full-width review before deciding.
 * 
 * Source types with modals: internal_link, redirect_proposal,
 * keyword_strategy, aeo_change.
 * (content_decay is Tier 1 — inline approve/reject in the action card.)
 */
import { useState } from 'react';
import { X, ExternalLink, ArrowRight, AlertCircle } from 'lucide-react';
import { Button, Icon } from '../ui';
import type {
  ClientAction,
  ClientActionSourceType,
  InternalLinkPayload,
  InternalLinkItem,
  RedirectProposalPayload,
  RedirectItem,
  KeywordStrategyPayload,
  AeoChangePayload,
  AeoChangeDiff,
} from '../../../shared/types/client-actions';

interface ClientActionDetailModalProps {
  action: ClientAction;
  onApprove: () => void;
  onRequestChanges: (note: string) => void;
  onClose: () => void;
  submitting?: boolean;
}

// ── Per-type payload renderers ──────────────────────────────────────────────

function InternalLinkRenderer({ payload }: { payload: InternalLinkPayload }) {
  const suggestions: InternalLinkItem[] = payload.suggestions ?? [];
  if (suggestions.length === 0) {
    return <p className="t-body text-[var(--brand-text-muted)]">No link suggestions in this batch.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-[var(--brand-border)]">
            <th className="py-2 pr-4 t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">Anchor text</th>
            <th className="py-2 pr-4 t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">Target URL</th>
            <th className="py-2 pr-4 t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">Source page</th>
            <th className="py-2 t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">Context</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--brand-border)]">
          {suggestions.map((s, i) => (
            <tr key={i}>
              <td className="py-3 pr-4 t-ui font-medium text-[var(--brand-text-bright)] align-top">{s.anchorText}</td>
              <td className="py-3 pr-4 align-top">
                <a
                  href={s.targetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="t-caption text-accent-brand hover:underline flex items-center gap-1"
                >
                  {s.targetTitle || s.targetUrl}
                  <ExternalLink className="w-3 h-3 flex-shrink-0" />
                </a>
              </td>
              <td className="py-3 pr-4 t-caption text-[var(--brand-text-muted)] align-top">{s.sourcePage || '—'}</td>
              <td className="py-3 t-caption text-[var(--brand-text-muted)] align-top max-w-xs">{s.contextSnippet || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RedirectProposalRenderer({ payload }: { payload: RedirectProposalPayload }) {
  const redirects: RedirectItem[] = payload.redirects ?? [];
  if (redirects.length === 0) {
    return <p className="t-body text-[var(--brand-text-muted)]">No redirect proposals in this batch.</p>;
  }
  return (
    <div className="space-y-3">
      {redirects.map((r, i) => (
        <div key={i} className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)] p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <code className="t-mono text-[var(--brand-text)] bg-[var(--surface-1)] px-2 py-0.5 rounded">{r.source}</code>
            <ArrowRight className="w-4 h-4 text-[var(--brand-text-muted)] flex-shrink-0" />
            <code className="t-mono text-accent-brand bg-[var(--surface-1)] px-2 py-0.5 rounded">{r.target}</code>
            {r.type && (
              <span className="t-caption-sm text-[var(--brand-text-muted)]">({r.type === 'permanent' ? '301' : '302'})</span>
            )}
          </div>
          {r.rationale && (
            <p className="t-caption text-[var(--brand-text-muted)] mt-2">{r.rationale}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function KeywordStrategyRenderer({ payload }: { payload: KeywordStrategyPayload }) {
  return (
    <div className="space-y-6">
      {payload.mappedPages && payload.mappedPages.length > 0 && (
        <div>
          <h4 className="t-ui font-semibold text-[var(--brand-text-bright)] mb-3">Mapped Pages</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--brand-border)]">
                  <th className="py-2 pr-4 t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">Page</th>
                  <th className="py-2 pr-4 t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">Target keyword</th>
                  <th className="py-2 t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">Current position</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--brand-border)]">
                {payload.mappedPages.map((p, i) => (
                  <tr key={i}>
                    <td className="py-3 pr-4 t-ui text-[var(--brand-text)]">{p.page}</td>
                    <td className="py-3 pr-4 t-ui font-medium text-[var(--brand-text-bright)]">{p.keyword}</td>
                    <td className="py-3 t-caption text-[var(--brand-text-muted)]">
                      {p.currentPosition != null ? `#${p.currentPosition}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {payload.quickWins && payload.quickWins.length > 0 && (
        <div>
          <h4 className="t-ui font-semibold text-[var(--brand-text-bright)] mb-3">Quick Wins</h4>
          <ul className="space-y-2">
            {payload.quickWins.map((w, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="t-caption-sm font-medium text-accent-brand mt-0.5">✓</span>
                <div>
                  <span className="t-ui font-medium text-[var(--brand-text-bright)]">{w.keyword}</span>
                  <span className="t-caption text-[var(--brand-text-muted)] ml-2">{w.opportunity}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {payload.contentGaps && payload.contentGaps.length > 0 && (
        <div>
          <h4 className="t-ui font-semibold text-[var(--brand-text-bright)] mb-3">Content Gaps</h4>
          <ul className="space-y-1">
            {payload.contentGaps.map((gap, i) => (
              <li key={i} className="t-caption text-[var(--brand-text-muted)] flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-accent-warning flex-shrink-0" />
                {gap}
              </li>
            ))}
          </ul>
        </div>
      )}

      {payload.opportunities && payload.opportunities.length > 0 && (
        <div>
          <h4 className="t-ui font-semibold text-[var(--brand-text-bright)] mb-3">Opportunities</h4>
          <ul className="space-y-1">
            {payload.opportunities.map((op, i) => (
              <li key={i} className="t-caption text-[var(--brand-text-muted)]">{op}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AeoChangeRenderer({ payload }: { payload: AeoChangePayload }) {
  const diffs: AeoChangeDiff[] = payload.diffs ?? [];
  if (diffs.length === 0) {
    return <p className="t-body text-[var(--brand-text-muted)]">No changes in this batch.</p>;
  }
  return (
    <div className="space-y-6">
      {diffs.map((diff, i) => (
        <div key={i} className="rounded-[var(--radius-xl)] border border-[var(--brand-border)] bg-[var(--surface-2)] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[var(--brand-border)] bg-[var(--surface-3)]">
            <h4 className="t-ui font-semibold text-[var(--brand-text-bright)]">{diff.page}</h4>
            {diff.section && <p className="t-caption text-[var(--brand-text-muted)]">{diff.section}</p>}
          </div>
          <div className="grid grid-cols-2 divide-x divide-[var(--brand-border)]">
            <div className="p-4">
              <p className="t-caption-sm font-semibold text-red-400 uppercase tracking-wider mb-2">Current</p>
              <p className="t-body text-[var(--brand-text)]">{diff.current}</p>
            </div>
            <div className="p-4">
              <p className="t-caption-sm font-semibold text-accent-success uppercase tracking-wider mb-2">Proposed</p>
              <p className="t-body text-[var(--brand-text-bright)]">{diff.proposed}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Modal shell ─────────────────────────────────────────────────────────────

export function ClientActionDetailModal({
  action,
  onApprove,
  onRequestChanges,
  onClose,
  submitting = false,
}: ClientActionDetailModalProps) {
  const [changeNote, setChangeNote] = useState('');
  const [showChangeForm, setShowChangeForm] = useState(false);

  const renderPayload = () => {
    const p = action.payload;
    switch (action.sourceType as ClientActionSourceType) {
      case 'internal_link':
        return <InternalLinkRenderer payload={p as InternalLinkPayload} />;
      case 'redirect_proposal':
        return <RedirectProposalRenderer payload={p as RedirectProposalPayload} />;
      case 'keyword_strategy':
        return <KeywordStrategyRenderer payload={p as KeywordStrategyPayload} />;
      case 'aeo_change':
        return <AeoChangeRenderer payload={p as AeoChangePayload} />;
      default:
        return (
          <pre className="t-mono t-caption text-[var(--brand-text-muted)] whitespace-pre-wrap">
            {JSON.stringify(p, null, 2)}
          </pre>
        );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[var(--surface-1)]"
      role="dialog"
      aria-modal="true"
      aria-label={action.title}
    >
      {/* Header */}
      <div className="flex items-start justify-between px-6 py-4 border-b border-[var(--brand-border)] flex-shrink-0 gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="t-caption-sm font-medium px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--surface-3)] text-[var(--brand-text-muted)] border border-[var(--brand-border)] capitalize">
              {action.sourceType.replace(/_/g, ' ')}
            </span>
          </div>
          <h2 className="t-h2 text-[var(--brand-text-bright)] truncate">{action.title}</h2>
          {action.summary && (
            <p className="t-body text-[var(--brand-text-muted)] mt-0.5 line-clamp-2">{action.summary}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-[var(--radius-md)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)] transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-6 py-6 max-w-5xl mx-auto w-full">
        {renderPayload()}
      </div>

      {/* Footer — approve / request changes */}
      <div className="flex-shrink-0 border-t border-[var(--brand-border)] px-6 py-4 flex items-center gap-3 flex-wrap">
        {!showChangeForm ? (
          <>
            <Button variant="primary" disabled={submitting} onClick={onApprove}>
              {submitting ? 'Saving…' : 'Approve'}
            </Button>
            <Button variant="ghost" onClick={() => setShowChangeForm(true)}>
              Request changes
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <input
              type="text"
              value={changeNote}
              onChange={e => setChangeNote(e.target.value)}
              placeholder="Describe what needs to change…"
              className="flex-1 min-w-[200px] px-3 py-2 rounded-[var(--radius-md)] t-body bg-[var(--surface-3)] border border-[var(--brand-border)] text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] outline-none focus:border-teal-500/50"
            />
            <Button variant="primary" disabled={submitting || !changeNote.trim()} onClick={() => onRequestChanges(changeNote.trim())}>
              {submitting ? 'Sending…' : 'Send feedback'}
            </Button>
            <Button variant="ghost" onClick={() => { setShowChangeForm(false); setChangeNote(''); }}>
              Back
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire ClientActionDetailModal into InboxTab.tsx**

Add import to InboxTab.tsx:
```ts
import { ClientActionDetailModal } from './ClientActionDetailModal';
```

Replace the comment `{/* ClientActionDetailModal mounted here in Task 8 */}` with:

```tsx
{/* Tier-3 Client Action Detail Modal */}
{detailAction && (
  <ClientActionDetailModal
    action={detailAction}
    submitting={false}
    onApprove={() => {
      respondToClientAction(detailAction.id, 'approved').then(() => setDetailAction(null));
    }}
    onRequestChanges={(note) => {
      respondToClientAction(detailAction.id, 'changes_requested', note).then(() => setDetailAction(null));
    }}
    onClose={() => setDetailAction(null)}
  />
)}
```

> **Note:** `respondToClientAction` already exists in InboxTab from the original code and updates the query cache + shows a toast. It returns `Promise<void>`, so `.then(() => setDetailAction(null))` closes the modal after success.

- [ ] **Step 3: Typecheck + build**

```bash
npm run typecheck && npx vite build
```
Expected: zero errors.

- [ ] **Step 4: Run full test suite**

```bash
npx vitest run
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/client/ClientActionDetailModal.tsx src/components/client/InboxTab.tsx
git commit -m "$(cat <<'EOF'
feat(inbox): add ClientActionDetailModal for Tier-3 action card full-screen review

Renders typed payload per source type:
- internal_link → anchor/target/context table
- redirect_proposal → source→target pairs with rationale
- keyword_strategy → mapped pages, quick wins, content gaps, opportunities
- aeo_change → current vs proposed diffs per page

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## 🔴 STOP — Phase 4 Review & PR

> **Do not start Task 8 until this PR is merged to staging.**

Phase 4 covers Task 7 — the `ClientActionDetailModal` with four per-sourceType payload renderers. This is the most net-new UI in the redesign and warrants a thorough review.

- [ ] **Review: run scaled code review**

  Complex new component with multiple renderer branches — use scaled review:
  ```
  /scaled-code-review
  ```

- [ ] **Review: Codex independent review**

  ```bash
  codex review
  ```
  Pay particular attention to:
  - Each payload renderer handles its empty/null state gracefully
  - `as InternalLinkPayload` casts are safe (payload shape matches the typed interface)
  - Footer approve/request-changes flow — modal closes after `respondToClientAction` resolves
  - Modal accessibility — same checks as Phase 3
  - The `default` switch case renders something useful (raw JSON) rather than crashing

- [ ] **Manual smoke test against each source type** (if test data is available on staging):
  - `content_decay` — still inline approve/reject in the card (NOT opening modal)
  - `internal_link` — "View details →" opens modal with link table
  - `redirect_proposal` — "View details →" opens modal with source→target pairs
  - `keyword_strategy` — "View details →" opens modal with mapped pages + quick wins
  - `aeo_change` — "View details →" opens modal with current vs proposed diffs

- [ ] **Resolve all actionable feedback.**

- [ ] **Open PR → staging**

  ```bash
  gh pr create \
    --base staging \
    --title "feat(inbox): Phase 4 — ClientActionDetailModal with per-sourceType payload renderers" \
    --body "$(cat <<'EOF'
  ## Summary
  - New `ClientActionDetailModal` component for Tier-3 action cards requiring full-width review
  - Per-sourceType renderers: InternalLink (table), RedirectProposal (source→target pairs), KeywordStrategy (pages/quick-wins/gaps), AeoChange (current vs proposed diffs)
  - Approve and request-changes footer — closes modal on success
  - content_decay remains Tier-1 (inline approve/reject in the action card, unaffected)

  ## Test plan
  - [ ] `npm run typecheck && npx vite build` — zero errors
  - [ ] `npx vitest run` — full suite green
  - [ ] `npx tsx scripts/pr-check.ts` — zero errors
  - [ ] content_decay card: approve/reject inline (no modal)
  - [ ] internal_link card: "View details →" opens table renderer modal
  - [ ] redirect_proposal card: "View details →" opens source→target renderer
  - [ ] keyword_strategy card: "View details →" opens strategy renderer
  - [ ] aeo_change card: "View details →" opens diff renderer
  - [ ] Approve from modal → toast success + modal closes
  - [ ] Request changes from modal → feedback note sent + modal closes
  - [ ] Empty payload state renders gracefully (no crash)

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```

- [ ] **Merge PR to staging** once CI is green.

- [ ] **Verify on staging** — test each source type modal if data is available.

- [ ] **Start Task 8.**

---

## Task 8 — pr-check Rule for Old Filter Literals

> **Phase 5. Run after all other tasks are merged to staging.**
> **Owns:** `scripts/pr-check.ts`

**Files:**
- Modify: `scripts/pr-check.ts`

- [ ] **Step 1: Verify InsightsDigest does NOT emit old inbox filter values**

The audit flagged InsightsDigest as a potential source of stale `action.tab` values. Verify:

```bash
grep -n "tab.*'approvals'\|tab.*'requests'\|tab.*'copy'\|tab.*'content-plan'" src/components/client/InsightsDigest.tsx
```

Expected: zero results. InsightsDigest uses `tab: 'content-plan'` (routes to content-plan ClientTab, unchanged) and performance/health/strategy tabs (unchanged). If any result shows an old inbox filter value, update that insight's `action.tab` to the new filter value:
- `'approvals'` → `'seo-changes'`
- `'requests'` → `'needs-action'`
- `'content-plan'` as an **inbox filter** → `'needs-action'`

> Note: `tab: 'content-plan'` in InsightsDigest routes to the Content Plan tab (a separate `ClientTab`), NOT the inbox filter. That navigation is unchanged and correct.

- [ ] **Step 3: Read the pr-check-rule-authoring guide**

```bash
cat docs/rules/pr-check-rule-authoring.md
```

- [ ] **Step 4: Read the current CHECKS array structure**

```bash
grep -n "pattern\|message\|files\|customCheck" scripts/pr-check.ts | head -40
```

- [ ] **Step 5: Add the rule**

Find the `CHECKS` array in `scripts/pr-check.ts` and add this entry:

```ts
{
  // Flags old InboxFilter string literals that were renamed in the inbox redesign.
  // After 2026-05-08 inbox redesign: 'approvals'→'seo-changes', 'requests'→'needs-action',
  // 'content-plan'→'needs-action', 'copy'→'content' as filter values.
  // These must not reappear as ?tab= values in src/ after migration.
  id: 'inbox-legacy-filter-literal',
  message: 'Old inbox filter value — update to new InboxFilter value. See 2026-05-08-client-inbox-redesign-audit.md.',
  pattern: /[?&]tab=(approvals|requests|content-plan|copy)(?=['"` &]|$)/,
  files: ['src/**/*.{ts,tsx}'],
},
```

- [ ] **Step 6: Run pr-check to verify no false positives**

```bash
npx tsx scripts/pr-check.ts
```
Expected: zero errors from the new rule (all legacy values should be gone from src/).

- [ ] **Step 7: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 8: Commit**

```bash
git add scripts/pr-check.ts
git commit -m "$(cat <<'EOF'
chore(pr-check): add rule flagging legacy inbox filter literal values

Prevents re-introduction of ?tab=approvals, ?tab=requests, ?tab=content-plan,
?tab=copy after the 2026-05-08 inbox redesign.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## 🔴 STOP — Phase 5 Review & PR

> **This is the final phase. After this PR merges to staging and is verified, the redesign is shippable.**

Phase 5 covers Task 8 — InsightsDigest verification and the pr-check rule preventing old filter literal re-introduction.

- [ ] **Review: run code review**

  Small targeted change — `superpowers:requesting-code-review` is sufficient:
  ```
  /requesting-code-review
  ```

- [ ] **Review: Codex independent review**

  ```bash
  codex review
  ```

- [ ] **Resolve all actionable feedback.**

- [ ] **Open PR → staging**

  ```bash
  gh pr create \
    --base staging \
    --title "feat(inbox): Phase 5 — pr-check rule for legacy inbox filter literals" \
    --body "$(cat <<'EOF'
  ## Summary
  - Verifies InsightsDigest emits no old inbox filter values (confirmed: zero instances)
  - Adds pr-check rule `inbox-legacy-filter-literal` flagging ?tab=approvals, ?tab=requests, ?tab=content-plan, ?tab=copy in src/

  ## Test plan
  - [ ] `npx tsx scripts/pr-check.ts` — zero errors from new rule
  - [ ] `npm run typecheck` — zero errors
  - [ ] `grep -n "tab.*'approvals'\|tab.*'requests'\|tab.*'content-plan'\|tab.*'copy'" src/components/client/InsightsDigest.tsx` — zero results

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```

- [ ] **Merge PR to staging** once CI is green.

- [ ] **Run full final verification on staging** (see Final Quality Gates below).

- [ ] **Merge staging → main** to ship to production.

---

## Final Quality Gates

After Phase 5 is merged to staging, run this full-feature end-to-end verification before merging staging → main:

- [ ] `npm run typecheck` — zero errors
- [ ] `npx vite build` — builds successfully
- [ ] `npx vitest run` — full test suite passes
- [ ] `npx tsx scripts/pr-check.ts` — zero violations
- [ ] Navigate to client inbox on staging:
  - Active mode shows priority strip, 3 sections, 4 filter chips
  - Filter chips hide/show correct sections
  - Active/Completed toggle switches modes
  - SEO Changes section collapses when no approvals pending
  - Schema plan card (if present) opens SchemaReviewModal full-screen
  - Tier-3 action cards open ClientActionDetailModal
  - Tier-1 (content_decay) cards approve/reject inline — no modal
  - Deep-link `?tab=seo-changes` initializes SEO Changes chip as active
  - Deep-link `?tab=approvals` (legacy) resolves to `seo-changes` via LEGACY_FILTER_MAP
  - Priority strip disappears when all items resolved; green "all caught up" appears
- [ ] **Merge staging → main** to ship to production

---

## Parallelization Notes

| Phase | Tasks | Can run in parallel |
|-------|-------|-------------------|
| 0 | Tasks 0–1 | Sequential — must merge first |
| 1 | Tasks 2–3 | Sequential — PriorityStrip before InboxTab |
| 2 | Tasks 4–5 | **Parallel** — Task 4 owns ClientDashboard, Task 5 owns ActionQueueStrip/tests |
| 3 | Task 6 | Sequential — needs Task 4 (tab retired) |
| 4 | Task 7 | Sequential — needs Task 3 (action card buttons exist) |
| 5 | Task 8 | Sequential — run last after all filter literals updated |

## Model Assignments

| Task | Model | Reasoning |
|------|-------|-----------|
| Task 0 — types/constants | Haiku | Mechanical type additions, no logic |
| Task 1 — routes.ts + test | Haiku | String literal updates, test expectation fixes |
| Task 2 — PriorityStrip | Sonnet | New component with logic |
| Task 3 — InboxTab restructure | Sonnet | Large component, complex conditional logic, section layout |
| Task 4 — schema-review tab removal | Sonnet | Route-removal-checklist, 7 update sites |
| Task 5 — ActionQueueStrip + tests | Haiku | Mechanical string literal updates |
| Task 6 — SchemaReviewModal | Sonnet | New component + wiring |
| Task 7 — ClientActionDetailModal | Sonnet | New components, typed payload rendering |
| Task 8 — pr-check rule | Haiku | Regex rule addition |

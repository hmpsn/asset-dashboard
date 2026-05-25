# MCP Actions — Phase 1 + Phase 3-UI: Shared Infra and Activity Feed Badge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the shared MCP infrastructure that every Phase 2 write tool will depend on (handle store, Zod schemas, three pr-check rules, contract test) AND the activity-feed chat badge that renders when `metadata.source === 'mcp-chat'`. Bundled into one PR because the two work streams touch disjoint files and are individually small.

**Architecture:** Six independent components in a single PR. Backend infra (handles, schemas, pr-check rules, contract test) is exported but unused — Phase 2 tools will consume it. The activity feed badge renders against the `metadata` field already plumbed in Phase 0 (PR #925); it's a no-op for live data until Phase 2 tools start writing `source: 'mcp-chat'` entries.

**Tech Stack:** TypeScript, Vitest, `@testing-library/react`, Zod v3, ripgrep (for pr-check), `node:crypto.randomUUID`.

**Phase status:** Phase 1 + 3-UI of 4. Predecessor: Phase 0 (PR #925, merged). **Phase 2 (10 tool implementation) cannot start until this PR merges to `staging`** — the tools import from `handles.ts` and `mcp-action-schemas.ts`.

**Predecessor docs:**
- [Spec](../specs/2026-05-25-mcp-actions-keyword-and-content-design.md)
- [Audit](../audits/2026-05-25-mcp-actions-audit.md)
- [Phase 0 plan](./2026-05-25-mcp-actions-phase-0-platform-prep.md)
- [PR #925 (Phase 0, merged)](https://github.com/hmpsn/asset-dashboard/pull/925)

---

## File structure

| File | Action | Purpose |
|---|---|---|
| `server/mcp/handles.ts` | Create | In-memory TTL handle store. `issueHandle()`, `consumeHandle()`. Workspace-scoped. |
| `shared/types/mcp-action-schemas.ts` | Create | Zod schemas for all 10 Phase 2 tool inputs + shared layout/outline schemas. |
| `scripts/pr-check.ts` | Modify (add 3 entries to `CHECKS`) | `mcp-action-must-route-through-service`, `mcp-action-must-tag-source`, `mcp-action-must-broadcast`. |
| `tests/contract/mcp-tool-job-name-lockstep.test.ts` | Create | Contract test asserting every `start_*` MCP tool's job-type matches `BACKGROUND_JOB_TYPES`. Activates with Phase 2. |
| `tests/unit/mcp-handles.test.ts` | Create | TDD tests for the handle store. |
| `tests/unit/mcp-action-schemas.test.ts` | Create | Smoke tests for schemas. |
| `src/components/workspace-home/ActivityFeed.tsx` | Modify (line 5 import; line ~55 render) | Add `Badge` import; render zinc `chat` badge when `metadata.source === 'mcp-chat'`. |
| `tests/unit/ActivityFeed.test.tsx` | Create | Component test for the badge. |

**Total:** 4 source files created, 2 modified, 3 test files created.

---

## Task 1: Create handle store with TDD

**Files:**
- Create: `server/mcp/handles.ts`
- Create: `tests/unit/mcp-handles.test.ts`

The handle store is the spine of every chained MCP write — `research_keyword` returns a handle, `add_keyword_to_strategy` consumes it. Workspace scoping prevents an attacker (or buggy chat) from issuing a handle in workspace A and consuming it in workspace B.

**Design constraints:**
- TTL default 15 min.
- Handle id format: `${kind}_${randomUUID}` so the kind is visible in logs without consuming.
- Workspace verified on consume.
- Consume is single-use — handle deleted on success.
- Expired handles return a distinguishable error from "wrong workspace" / "wrong kind" / "unknown id".

- [ ] **Step 1: Write the failing test**

Create `tests/unit/mcp-handles.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  issueHandle,
  consumeHandle,
  HandleExpiredError,
  HandleNotFoundError,
  HandleKindMismatchError,
  HandleWorkspaceMismatchError,
  __resetHandleStoreForTests,
} from '../../server/mcp/handles.js';

describe('mcp handles', () => {
  beforeEach(() => {
    __resetHandleStoreForTests();
  });

  it('issues a handle and consumes it with matching kind + workspace', () => {
    const id = issueHandle('keyword-research', 'ws-1', { term: 'test' });
    expect(id).toMatch(/^keyword-research_[0-9a-f-]{36}$/);
    const payload = consumeHandle<{ term: string }>(id, 'keyword-research', 'ws-1');
    expect(payload).toEqual({ term: 'test' });
  });

  it('consume is single-use — handle deleted after consumption', () => {
    const id = issueHandle('keyword-research', 'ws-1', { term: 'test' });
    consumeHandle(id, 'keyword-research', 'ws-1');
    expect(() => consumeHandle(id, 'keyword-research', 'ws-1')).toThrow(HandleNotFoundError);
  });

  it('rejects wrong workspace with HandleWorkspaceMismatchError', () => {
    const id = issueHandle('keyword-research', 'ws-1', { term: 'test' });
    expect(() => consumeHandle(id, 'keyword-research', 'ws-2')).toThrow(HandleWorkspaceMismatchError);
  });

  it('rejects wrong kind with HandleKindMismatchError', () => {
    const id = issueHandle('keyword-research', 'ws-1', { term: 'test' });
    expect(() => consumeHandle(id, 'brief-request', 'ws-1')).toThrow(HandleKindMismatchError);
  });

  it('rejects unknown id with HandleNotFoundError', () => {
    expect(() => consumeHandle('keyword-research_does-not-exist', 'keyword-research', 'ws-1')).toThrow(HandleNotFoundError);
  });

  it('rejects expired handle with HandleExpiredError', () => {
    vi.useFakeTimers();
    const id = issueHandle('keyword-research', 'ws-1', { term: 'test' }, { ttlMs: 1000 });
    vi.advanceTimersByTime(1500);
    expect(() => consumeHandle(id, 'keyword-research', 'ws-1')).toThrow(HandleExpiredError);
    vi.useRealTimers();
  });

  it('default TTL is 15 minutes', () => {
    vi.useFakeTimers();
    const id = issueHandle('keyword-research', 'ws-1', { term: 'test' });
    vi.advanceTimersByTime(14 * 60 * 1000);
    expect(consumeHandle(id, 'keyword-research', 'ws-1')).toBeDefined();

    const id2 = issueHandle('keyword-research', 'ws-1', { term: 'test' });
    vi.advanceTimersByTime(16 * 60 * 1000);
    expect(() => consumeHandle(id2, 'keyword-research', 'ws-1')).toThrow(HandleExpiredError);
    vi.useRealTimers();
  });

  it('supports all six handle kinds', () => {
    const kinds = [
      'keyword-research',
      'keyword-research-bulk',
      'brief-request',
      'brief',
      'post-request',
      'post',
    ] as const;
    for (const kind of kinds) {
      const id = issueHandle(kind, 'ws-1', { sample: kind });
      expect(consumeHandle(id, kind, 'ws-1')).toEqual({ sample: kind });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/mcp-handles.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement the handle store**

Create `server/mcp/handles.ts`:

```typescript
import { randomUUID } from 'node:crypto';

export type HandleKind =
  | 'keyword-research'
  | 'keyword-research-bulk'
  | 'brief-request'
  | 'brief'
  | 'post-request'
  | 'post';

const DEFAULT_TTL_MS = 15 * 60 * 1000;

interface HandleRecord {
  kind: HandleKind;
  workspaceId: string;
  payload: unknown;
  expiresAt: number;
}

const handles = new Map<string, HandleRecord>();

export class HandleNotFoundError extends Error {
  constructor(id: string) {
    super(`Handle not found or already consumed: ${id}`);
    this.name = 'HandleNotFoundError';
  }
}

export class HandleExpiredError extends Error {
  constructor(id: string) {
    super(`Handle expired (TTL exceeded): ${id}. Re-run the producing tool.`);
    this.name = 'HandleExpiredError';
  }
}

export class HandleKindMismatchError extends Error {
  constructor(id: string, expected: HandleKind, actual: HandleKind) {
    super(`Handle ${id} is kind '${actual}', expected '${expected}'`);
    this.name = 'HandleKindMismatchError';
  }
}

export class HandleWorkspaceMismatchError extends Error {
  constructor(id: string, expected: string, actual: string) {
    super(`Handle ${id} belongs to workspace '${actual}', not '${expected}'`);
    this.name = 'HandleWorkspaceMismatchError';
  }
}

export function issueHandle(
  kind: HandleKind,
  workspaceId: string,
  payload: unknown,
  opts?: { ttlMs?: number },
): string {
  const id = `${kind}_${randomUUID()}`;
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  handles.set(id, {
    kind,
    workspaceId,
    payload,
    expiresAt: Date.now() + ttlMs,
  });
  return id;
}

export function consumeHandle<T = unknown>(
  id: string,
  expectedKind: HandleKind,
  expectedWorkspaceId: string,
): T {
  const record = handles.get(id);
  if (!record) {
    throw new HandleNotFoundError(id);
  }
  if (Date.now() > record.expiresAt) {
    handles.delete(id);
    throw new HandleExpiredError(id);
  }
  if (record.kind !== expectedKind) {
    throw new HandleKindMismatchError(id, expectedKind, record.kind);
  }
  if (record.workspaceId !== expectedWorkspaceId) {
    throw new HandleWorkspaceMismatchError(id, expectedWorkspaceId, record.workspaceId);
  }
  handles.delete(id);
  return record.payload as T;
}

/** Test-only: clear the handle store between tests. Do not call in production code. */
export function __resetHandleStoreForTests(): void {
  handles.clear();
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run tests/unit/mcp-handles.test.ts`
Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/mcp/handles.ts tests/unit/mcp-handles.test.ts
git commit -m "feat(mcp): add in-memory TTL handle store

Workspace-scoped short-lived handles for chaining MCP write tools.
Returns kind-prefixed UUIDs so the kind is visible in logs. Five
distinct error classes (NotFound, Expired, KindMismatch,
WorkspaceMismatch) so MCP tool handlers can return clear error
messages to chat.

Phase 1 of MCP actions implementation."
```

---

## Task 2: Create per-tool Zod schemas

**Files:**
- Create: `shared/types/mcp-action-schemas.ts`
- Create: `tests/unit/mcp-action-schemas.test.ts`

Co-locate input schemas + payload schemas for every Phase 2 tool. Phase 2 tools import these. JSON-Schema for `inputSchema` on each MCP tool is derived from the Zod schema at registration time.

- [ ] **Step 1: Write the smoke test**

Create `tests/unit/mcp-action-schemas.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  researchKeywordsInputSchema,
  addKeywordToStrategyInputSchema,
  prepareBriefContextInputSchema,
  saveBriefInputSchema,
  preparePostContextInputSchema,
  savePostInputSchema,
  sendToClientInputSchema,
  startKeywordStrategyGenerationInputSchema,
  startSeoAuditInputSchema,
  startLocalSeoRefreshInputSchema,
  layoutSchema,
  typedOutlineSchema,
} from '../../shared/types/mcp-action-schemas.js';

describe('mcp-action-schemas', () => {
  describe('researchKeywordsInputSchema', () => {
    it('accepts a single term', () => {
      expect(researchKeywordsInputSchema.safeParse({ workspace_id: 'ws-1', terms: ['solo crm'] }).success).toBe(true);
    });
    it('accepts multiple terms', () => {
      expect(researchKeywordsInputSchema.safeParse({ workspace_id: 'ws-1', terms: ['a', 'b', 'c'] }).success).toBe(true);
    });
    it('rejects empty terms array', () => {
      expect(researchKeywordsInputSchema.safeParse({ workspace_id: 'ws-1', terms: [] }).success).toBe(false);
    });
    it('rejects missing workspace_id', () => {
      expect(researchKeywordsInputSchema.safeParse({ terms: ['x'] }).success).toBe(false);
    });
  });

  describe('addKeywordToStrategyInputSchema', () => {
    it('accepts existing_page target with research_handle', () => {
      expect(addKeywordToStrategyInputSchema.safeParse({
        workspace_id: 'ws-1',
        research_handle: `keyword-research_${'a'.repeat(8)}-${'b'.repeat(4)}-${'c'.repeat(4)}-${'d'.repeat(4)}-${'e'.repeat(12)}`,
        target: { kind: 'existing_page', page_url: 'https://example.com/blog/x' },
      }).success).toBe(true);
    });
    it('accepts new_page target with raw term', () => {
      expect(addKeywordToStrategyInputSchema.safeParse({
        workspace_id: 'ws-1',
        term: 'solo crm',
        target: { kind: 'new_page', topic: 'Best CRMs', intent: 'commercial' },
      }).success).toBe(true);
    });
    it('rejects neither research_handle nor term', () => {
      expect(addKeywordToStrategyInputSchema.safeParse({
        workspace_id: 'ws-1',
        target: { kind: 'new_page', topic: 'x' },
      }).success).toBe(false);
    });
  });

  describe('layoutSchema', () => {
    it('accepts CMS layout', () => {
      expect(layoutSchema.safeParse({ type: 'cms', collection_id: 'col-1' }).success).toBe(true);
    });
    it('accepts outline layout with typed sections', () => {
      expect(layoutSchema.safeParse({
        type: 'outline',
        structure: {
          sections: [
            { heading: { level: 1, text: 'H1' } },
            { heading: { level: 2, text: 'H2' }, bullets: ['a', 'b'], media: { type: 'image', placeholder: 'hero' } },
          ],
        },
      }).success).toBe(true);
    });
    it('rejects freeform string structure', () => {
      expect(layoutSchema.safeParse({ type: 'outline', structure: 'H1, H2, H3' }).success).toBe(false);
    });
  });

  describe('startSeoAuditInputSchema', () => {
    it('requires site_id', () => {
      expect(startSeoAuditInputSchema.safeParse({ workspace_id: 'ws-1' }).success).toBe(false);
      expect(startSeoAuditInputSchema.safeParse({ workspace_id: 'ws-1', site_id: 'site-1' }).success).toBe(true);
    });
    it('accepts optional skip_link_check', () => {
      expect(startSeoAuditInputSchema.safeParse({
        workspace_id: 'ws-1',
        site_id: 'site-1',
        options: { skip_link_check: true },
      }).success).toBe(true);
    });
  });

  describe('sendToClientInputSchema', () => {
    const validBriefHandle = `brief_${'a'.repeat(8)}-${'b'.repeat(4)}-${'c'.repeat(4)}-${'d'.repeat(4)}-${'e'.repeat(12)}`;
    const validPostHandle = `post_${'a'.repeat(8)}-${'b'.repeat(4)}-${'c'.repeat(4)}-${'d'.repeat(4)}-${'e'.repeat(12)}`;

    it('accepts brief_handle', () => {
      expect(sendToClientInputSchema.safeParse({ workspace_id: 'ws-1', brief_handle: validBriefHandle }).success).toBe(true);
    });
    it('accepts post_handle with note', () => {
      expect(sendToClientInputSchema.safeParse({ workspace_id: 'ws-1', post_handle: validPostHandle, note: 'ready' }).success).toBe(true);
    });
    it('rejects providing both brief_handle and post_handle', () => {
      expect(sendToClientInputSchema.safeParse({
        workspace_id: 'ws-1',
        brief_handle: validBriefHandle,
        post_handle: validPostHandle,
      }).success).toBe(false);
    });
  });

  describe('all schemas export', () => {
    it('every Phase 2 tool has an input schema exported', () => {
      const schemas = [
        researchKeywordsInputSchema,
        addKeywordToStrategyInputSchema,
        prepareBriefContextInputSchema,
        saveBriefInputSchema,
        preparePostContextInputSchema,
        savePostInputSchema,
        sendToClientInputSchema,
        startKeywordStrategyGenerationInputSchema,
        startSeoAuditInputSchema,
        startLocalSeoRefreshInputSchema,
      ];
      expect(schemas).toHaveLength(10);
      for (const schema of schemas) {
        expect(schema).toBeDefined();
        expect(typeof schema.safeParse).toBe('function');
      }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/mcp-action-schemas.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement the schemas module**

Create `shared/types/mcp-action-schemas.ts`:

```typescript
import { z } from 'zod';

// ─── Shared building blocks ─────────────────────────────────────────────────

const workspaceIdSchema = z.string().min(1, 'workspace_id is required');

const handleIdSchema = z.string().regex(
  /^(keyword-research|keyword-research-bulk|brief-request|brief|post-request|post)_[0-9a-f-]{36}$/,
  'must be a valid handle id of the form `<kind>_<uuid>`',
);

// ─── Layout schemas ─────────────────────────────────────────────────────────

const mediaSlotSchema = z.object({
  type: z.enum(['image', 'video', 'embed']),
  placeholder: z.string().min(1),
});

const outlineSectionSchema = z.object({
  heading: z.object({
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    text: z.string().min(1),
  }),
  description: z.string().optional(),
  bullets: z.array(z.string()).optional(),
  callout: z.enum(['info', 'cta', 'quote']).optional(),
  media: mediaSlotSchema.optional(),
});

export const typedOutlineSchema = z.object({
  sections: z.array(outlineSectionSchema).min(1),
});

export const layoutSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('cms'), collection_id: z.string().min(1) }),
  z.object({ type: z.literal('outline'), structure: typedOutlineSchema }),
]);

// ─── Keyword tool input schemas ─────────────────────────────────────────────

export const researchKeywordsInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  terms: z.array(z.string().min(1)).min(1).max(50, 'max 50 terms per call'),
  market: z.string().optional(),
});

export const addKeywordToStrategyInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  research_handle: handleIdSchema.optional(),
  term: z.string().min(1).optional(),
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('existing_page'), page_url: z.string().url() }),
    z.object({
      kind: z.literal('new_page'),
      topic: z.string().min(1),
      intent: z.enum(['informational', 'commercial', 'transactional', 'navigational']).optional(),
    }),
  ]),
}).refine(
  (data) => data.research_handle != null || data.term != null,
  { message: 'must provide either research_handle or term' },
);

// ─── Content tool input schemas ─────────────────────────────────────────────

export const prepareBriefContextInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  topic: z.string().min(1),
  layout: layoutSchema,
});

const briefContentSchema = z.object({
  targetKeyword: z.string().min(1),
  secondaryKeywords: z.array(z.string()),
  suggestedTitle: z.string().min(1),
  suggestedMetaDesc: z.string().min(1),
  outline: z.array(z.object({
    heading: z.string(),
    subheadings: z.array(z.string()).optional(),
    notes: z.string().optional(),
    wordCount: z.number().int().nonnegative().optional(),
    keywords: z.array(z.string()).optional(),
  })),
  wordCountTarget: z.number().int().positive(),
  intent: z.string(),
  audience: z.string(),
  competitorInsights: z.string(),
  internalLinkSuggestions: z.array(z.unknown()),
  pageType: z.enum(['blog', 'landing', 'service', 'location', 'product', 'pillar', 'resource']).optional(),
  executiveSummary: z.string().optional(),
}).passthrough();

export const saveBriefInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  brief_request_handle: handleIdSchema,
  content: briefContentSchema,
  parent_request_id: z.string().optional(),
});

export const preparePostContextInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  brief_id: z.string().min(1),
});

const postContentSchema = z.object({
  briefId: z.string().min(1),
  targetKeyword: z.string().min(1),
  title: z.string().min(1),
  metaDescription: z.string().min(1),
  introduction: z.string(),
  sections: z.array(z.object({
    index: z.number().int().nonnegative(),
    heading: z.string(),
    content: z.string(),
    wordCount: z.number().int().nonnegative(),
    targetWordCount: z.number().int().positive(),
    keywords: z.array(z.string()),
    status: z.enum(['pending', 'generating', 'complete', 'error']),
    error: z.string().optional(),
  })),
  conclusion: z.string(),
  totalWordCount: z.number().int().nonnegative(),
  targetWordCount: z.number().int().positive(),
}).passthrough();

export const savePostInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  post_request_handle: handleIdSchema,
  content: postContentSchema,
});

export const sendToClientInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  brief_handle: handleIdSchema.optional(),
  post_handle: handleIdSchema.optional(),
  note: z.string().optional(),
}).refine(
  (data) => (data.brief_handle != null) !== (data.post_handle != null),
  { message: 'must provide exactly one of brief_handle or post_handle' },
);

// ─── Job tool input schemas ─────────────────────────────────────────────────

export const startKeywordStrategyGenerationInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  options: z.object({
    mode: z.enum(['full', 'incremental']).optional(),
    seoDataProvider: z.enum(['dataforseo', 'semrush']).optional(),
    competitorDomains: z.array(z.string()).optional(),
    maxPages: z.number().int().positive().optional(),
  }).optional(),
});

export const startSeoAuditInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  site_id: z.string().min(1, 'site_id (Webflow site) is required'),
  options: z.object({
    skip_link_check: z.boolean().optional(),
  }).optional(),
});

export const startLocalSeoRefreshInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  refresh_body: z.unknown(),
});

// ─── Type exports ───────────────────────────────────────────────────────────

export type ResearchKeywordsInput = z.infer<typeof researchKeywordsInputSchema>;
export type AddKeywordToStrategyInput = z.infer<typeof addKeywordToStrategyInputSchema>;
export type PrepareBriefContextInput = z.infer<typeof prepareBriefContextInputSchema>;
export type SaveBriefInput = z.infer<typeof saveBriefInputSchema>;
export type PreparePostContextInput = z.infer<typeof preparePostContextInputSchema>;
export type SavePostInput = z.infer<typeof savePostInputSchema>;
export type SendToClientInput = z.infer<typeof sendToClientInputSchema>;
export type StartKeywordStrategyGenerationInput = z.infer<typeof startKeywordStrategyGenerationInputSchema>;
export type StartSeoAuditInput = z.infer<typeof startSeoAuditInputSchema>;
export type StartLocalSeoRefreshInput = z.infer<typeof startLocalSeoRefreshInputSchema>;
```

- [ ] **Step 4: Run schema tests**

Run: `npx vitest run tests/unit/mcp-action-schemas.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add shared/types/mcp-action-schemas.ts tests/unit/mcp-action-schemas.test.ts
git commit -m "feat(mcp): add per-tool Zod schemas for Phase 2

Co-located Zod schemas for all 10 Phase 2 MCP write tool inputs plus
shared layout/outline schemas (cms|outline discriminated union, typed
outline with media slot). Type aliases exported via z.infer.

Phase 1 of MCP actions implementation."
```

---

## Task 3: Add `mcp-action-must-route-through-service` pr-check rule

**Files:**
- Modify: `scripts/pr-check.ts` (add to `CHECKS` array)

Fail if a file under `server/mcp/tools/` calls `stmts().*.run()` directly. Persistence must route through service functions. Trips zero offenders today; activates with Phase 2.

- [ ] **Step 1: Add the rule**

In `scripts/pr-check.ts`, append to the `CHECKS` array (before the closing `];`):

```typescript
  {
    name: 'mcp-action-must-route-through-service',
    pattern: 'stmts\\(\\)\\.[a-zA-Z_]+\\.run\\(',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/mcp/tools/',
    message: 'MCP write tools must route persistence through service functions (e.g. upsertBrief, savePost, upsertPageKeyword). Do not call stmts().*.run() directly from server/mcp/tools/ — that bypasses broadcasts, activity logging, and state-machine guards.',
    severity: 'error',
    rationale: 'MCP write tools must go through service functions so broadcasts, activity logging, and state-machine guards all fire.',
    claudeMdRef: '#mcp-actions',
  },
```

- [ ] **Step 2: Verify the rule passes**

Run: `npx tsx scripts/pr-check.ts`
Expected: `✓ mcp-action-must-route-through-service` in the passing list.

- [ ] **Step 3: Commit**

```bash
git add scripts/pr-check.ts
git commit -m "feat(pr-check): add mcp-action-must-route-through-service rule

Fails if any file under server/mcp/tools/ calls stmts().*.run() directly.
Phase 2 write tools must route through service functions so broadcasts,
activity logging, and state-machine guards all fire.

Phase 1 of MCP actions implementation."
```

---

## Task 4: Add `mcp-action-must-tag-source` pr-check rule

**Files:**
- Modify: `scripts/pr-check.ts` (add to `CHECKS` array)

Fail if `addActivity(` from `server/mcp/tools/` is missing `{ source: 'mcp-chat' }` in args. Multi-line `customCheck`.

- [ ] **Step 1: Verify `readFileSync` is imported**

Run: `grep "readFileSync" scripts/pr-check.ts | head -3`
Expected: at least one import line. If absent, add `readFileSync` to the existing `fs` import at the top of the file.

- [ ] **Step 2: Add the rule**

In `scripts/pr-check.ts`, append to the `CHECKS` array:

```typescript
  {
    name: 'mcp-action-must-tag-source',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/mcp/tools/',
    message: 'MCP write tools must tag activity with { source: \'mcp-chat\' } in the metadata arg. Every addActivity() call from server/mcp/tools/ must include "source: \'mcp-chat\'" in its arguments.',
    severity: 'error',
    rationale: 'mcp-chat-tagged activity entries get a "chat" badge in the activity feed so operators can audit chat-driven mutations.',
    claudeMdRef: '#mcp-actions',
    customCheck: (files) => {
      const matches: { file: string; line: number; text: string }[] = [];
      for (const file of files) {
        let text: string;
        try {
          text = readFileSync(file, 'utf8');
        } catch {
          continue;
        }
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!/\baddActivity\(/.test(line)) continue;
          let depth = 0;
          let foundCloseParen = false;
          let foundSourceTag = false;
          for (let j = i; j < Math.min(i + 20, lines.length); j++) {
            const segment = lines[j];
            for (const ch of segment) {
              if (ch === '(') depth++;
              else if (ch === ')') {
                depth--;
                if (depth === 0) {
                  foundCloseParen = true;
                  break;
                }
              }
            }
            if (/source\s*:\s*['"]mcp-chat['"]/.test(segment)) foundSourceTag = true;
            if (foundCloseParen) break;
          }
          if (foundCloseParen && !foundSourceTag) {
            matches.push({ file, line: i + 1, text: line.trim() });
          }
        }
      }
      return matches;
    },
  },
```

- [ ] **Step 3: Verify the rule passes**

Run: `npx tsx scripts/pr-check.ts`
Expected: `✓ mcp-action-must-tag-source` in the passing list.

- [ ] **Step 4: Commit**

```bash
git add scripts/pr-check.ts
git commit -m "feat(pr-check): add mcp-action-must-tag-source rule

Fails if any addActivity() call from server/mcp/tools/ is missing
{ source: 'mcp-chat' } in its metadata argument. Multi-line customCheck
scans up to 20 lines ahead from the addActivity( opening to find the
matching close paren and verify the source tag is present.

Phase 1 of MCP actions implementation."
```

---

## Task 5: Add `mcp-action-must-broadcast` pr-check rule

**Files:**
- Modify: `scripts/pr-check.ts` (add to `CHECKS` array)

Fail if a file under `server/mcp/tools/` calls a mutation service function but does not also call `broadcastToWorkspace(`.

- [ ] **Step 1: Add the rule**

In `scripts/pr-check.ts`, append to the `CHECKS` array:

```typescript
  {
    name: 'mcp-action-must-broadcast',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/mcp/tools/',
    message: 'MCP write tool file calls a mutation service (upsertBrief / savePost / upsertPageKeyword / notifyContentUpdated) but never calls broadcastToWorkspace(). Every persistence path from server/mcp/tools/ must broadcast a workspace event so the frontend invalidates its caches.',
    severity: 'error',
    rationale: 'broadcast pairs every write so React Query caches stay fresh; MCP tools own this since the underlying service functions are unbroadcast.',
    claudeMdRef: '#mcp-actions',
    customCheck: (files) => {
      const matches: { file: string; line: number; text: string }[] = [];
      const MUTATION_FNS = /\b(upsertBrief|savePost|upsertPageKeyword|notifyContentUpdated)\(/;
      for (const file of files) {
        let text: string;
        try {
          text = readFileSync(file, 'utf8');
        } catch {
          continue;
        }
        const lines = text.split('\n');
        let mutationLine = -1;
        let hasBroadcast = false;
        for (let i = 0; i < lines.length; i++) {
          if (mutationLine === -1 && MUTATION_FNS.test(lines[i])) {
            mutationLine = i + 1;
          }
          if (/\bbroadcastToWorkspace\(/.test(lines[i])) {
            hasBroadcast = true;
          }
        }
        if (mutationLine !== -1 && !hasBroadcast) {
          matches.push({ file, line: mutationLine, text: lines[mutationLine - 1].trim() });
        }
      }
      return matches;
    },
  },
```

- [ ] **Step 2: Verify the rule passes**

Run: `npx tsx scripts/pr-check.ts`
Expected: `✓ mcp-action-must-broadcast` in the passing list.

- [ ] **Step 3: Commit**

```bash
git add scripts/pr-check.ts
git commit -m "feat(pr-check): add mcp-action-must-broadcast rule

Fails if any file under server/mcp/tools/ calls a mutation service
(upsertBrief, savePost, upsertPageKeyword, notifyContentUpdated) but
never calls broadcastToWorkspace(). MCP wrappers own the broadcast
since the underlying service functions don't broadcast themselves.

Phase 1 of MCP actions implementation."
```

---

## Task 6: Add job-name lockstep contract test

**Files:**
- Create: `tests/contract/mcp-tool-job-name-lockstep.test.ts`

Scan `server/mcp/tools/job-actions.ts` (when it exists) and verify every `createJob(JOB_TYPE, ...)` uses a job-type string in `BACKGROUND_JOB_TYPES`. Vacuous today.

- [ ] **Step 1: Write the contract test**

Create `tests/contract/mcp-tool-job-name-lockstep.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';

/**
 * Contract: every job-type string referenced inside server/mcp/tools/job-actions.ts
 * must exist in BACKGROUND_JOB_TYPES. Prevents spec-invented job names from
 * landing in MCP tools (e.g. 'site-health-audit' instead of 'seo-audit').
 *
 * Today this test is vacuous — job-actions.ts doesn't exist yet (Phase 2 work).
 * The moment Phase 2 creates the file, the test starts asserting.
 */
describe('mcp-tool-job-name-lockstep', () => {
  const JOB_ACTIONS_PATH = path.join(__dirname, '..', '..', 'server', 'mcp', 'tools', 'job-actions.ts');

  it('every job-type string in job-actions.ts exists in BACKGROUND_JOB_TYPES', () => {
    if (!existsSync(JOB_ACTIONS_PATH)) {
      // Vacuous pass — Phase 2 hasn't landed yet. Document the expected state.
      expect(existsSync(JOB_ACTIONS_PATH)).toBe(false);
      return;
    }
    const source = readFileSync(JOB_ACTIONS_PATH, 'utf8');
    const createJobCalls = [...source.matchAll(/createJob\(\s*['"]([\w-]+)['"]/g)];
    expect(createJobCalls.length).toBeGreaterThan(0);

    const validJobTypes = new Set<string>(Object.values(BACKGROUND_JOB_TYPES));
    for (const match of createJobCalls) {
      const jobType = match[1];
      expect(validJobTypes, `job-actions.ts uses job-type '${jobType}' which is not in BACKGROUND_JOB_TYPES`).toContain(jobType);
    }
  });
});
```

- [ ] **Step 2: Run the contract test**

Run: `npx vitest run tests/contract/mcp-tool-job-name-lockstep.test.ts`
Expected: PASS (vacuous).

- [ ] **Step 3: Verify pr-check doesn't flag the vacuous branch**

Run: `npx tsx scripts/pr-check.ts`
Expected: passes. The "Placeholder test assertion" rule should not fire because the assertion is `expect(existsSync(JOB_ACTIONS_PATH)).toBe(false)` — a real claim about current state, not a `expect(true).toBe(true)` placeholder.

If pr-check does flag the assertion, replace the vacuous branch with `expect(existsSync(JOB_ACTIONS_PATH)).toBe(false); return;` (already written this way above).

- [ ] **Step 4: Commit**

```bash
git add tests/contract/mcp-tool-job-name-lockstep.test.ts
git commit -m "feat(contract): add MCP job-name lockstep test

Verifies every job-type string in server/mcp/tools/job-actions.ts exists
in BACKGROUND_JOB_TYPES. Prevents spec-invented job names from landing in
MCP tools — exactly the bug class the pre-plan audit caught when 3 of 4
proposed names didn't match real platform keys.

Vacuous pass today; activates with Phase 2's job-actions.ts.

Phase 1 of MCP actions implementation."
```

---

## Task 7: Render the activity feed chat badge (TDD)

**Files:**
- Create: `tests/unit/ActivityFeed.test.tsx`
- Modify: `src/components/workspace-home/ActivityFeed.tsx`

The `metadata` field was plumbed through `ActivityFeed`'s local interface in Phase 0 (PR #925). This task adds the conditional render.

**Design choice — zinc badge, not teal:** The Four Laws reserve teal for interactive actions/CTAs. The chat badge is informational provenance (read-only), so zinc (neutral) is semantically correct.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ActivityFeed.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ActivityFeed from '../../src/components/workspace-home/ActivityFeed';

const baseEntry = {
  id: 'a1',
  type: 'brief_generated',
  title: 'Brief generated',
  description: undefined,
  createdAt: new Date().toISOString(),
};

describe('ActivityFeed chat badge', () => {
  it('renders a chat badge for entries with metadata.source = "mcp-chat"', () => {
    render(<ActivityFeed activity={[{ ...baseEntry, metadata: { source: 'mcp-chat' } }]} />);
    expect(screen.getByText('chat')).toBeInTheDocument();
  });

  it('does NOT render a chat badge for entries without that metadata source', () => {
    render(<ActivityFeed activity={[{ ...baseEntry, metadata: { source: 'local_seo' } }]} />);
    expect(screen.queryByText('chat')).not.toBeInTheDocument();
  });

  it('does NOT render a chat badge for entries with no metadata at all', () => {
    render(<ActivityFeed activity={[baseEntry]} />);
    expect(screen.queryByText('chat')).not.toBeInTheDocument();
  });

  it('renders multiple chat badges when multiple chat-sourced entries are present', () => {
    render(
      <ActivityFeed
        activity={[
          { ...baseEntry, id: 'a1', metadata: { source: 'mcp-chat' } },
          { ...baseEntry, id: 'a2', metadata: { source: 'admin' } },
          { ...baseEntry, id: 'a3', metadata: { source: 'mcp-chat' } },
        ]}
      />,
    );
    expect(screen.getAllByText('chat')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ActivityFeed.test.tsx`
Expected: FAIL — `screen.getByText('chat')` throws because the badge isn't rendered yet.

- [ ] **Step 3: Add the badge import and render**

In `src/components/workspace-home/ActivityFeed.tsx`:

Modify the import line at the top (currently: `import { SectionCard, EmptyState, Icon } from '../ui';`) to add `Badge`:

```typescript
import { SectionCard, EmptyState, Icon, Badge } from '../ui';
```

Then, in the entry render around line 55, locate the title line:

```tsx
<div className="t-caption text-[var(--brand-text-bright)]">{entry.title}</div>
```

Replace it with:

```tsx
<div className="t-caption text-[var(--brand-text-bright)] flex items-center gap-1.5">
  <span>{entry.title}</span>
  {entry.metadata?.source === 'mcp-chat' && (
    <Badge tone="zinc" size="sm" variant="soft">chat</Badge>
  )}
</div>
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run tests/unit/ActivityFeed.test.tsx`
Expected: all 4 tests pass.

- [ ] **Step 5: Spot-check in dev preview**

Start `npm run dev:all` if not running. Navigate to an admin workspace home page; the activity feed should look identical (no live entries have `metadata.source = 'mcp-chat'` yet).

To verify the badge actually renders, temporarily inject one synthetic entry by editing a row in the local DB:

```bash
sqlite3 ~/.local/share/hmpsn-studio/dashboard.db "UPDATE activity_log SET metadata = '{\"source\":\"mcp-chat\"}' WHERE id = (SELECT id FROM activity_log WHERE workspace_id IN (SELECT id FROM workspaces LIMIT 1) ORDER BY created_at DESC LIMIT 1);"
```

Reload the workspace home page; the most recent activity entry should show a small `chat` badge next to its title. Revert:

```bash
sqlite3 ~/.local/share/hmpsn-studio/dashboard.db "UPDATE activity_log SET metadata = NULL WHERE id = (SELECT id FROM activity_log WHERE workspace_id IN (SELECT id FROM workspaces LIMIT 1) ORDER BY created_at DESC LIMIT 1);"
```

(Adjust the DB path if `DATA_BASE` is set differently in your env.)

- [ ] **Step 6: Commit**

```bash
git add src/components/workspace-home/ActivityFeed.tsx tests/unit/ActivityFeed.test.tsx
git commit -m "feat(activity-feed): render chat badge for mcp-chat mutations

Reads metadata.source from each activity entry; when the value is
'mcp-chat', renders a small zinc 'chat' badge next to the title. Lets
operators audit at a glance which mutations came from a Claude chat
session via the MCP vs the admin UI.

Zinc (not teal) because the badge is informational provenance — read-only
— and teal is reserved for interactive actions per the Four Laws.

Phase 3-UI of MCP actions implementation."
```

---

## Task 8: Final verification gate + PR

**Files:** none modified — verification only.

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 2: Run pr-check**

Run: `npx tsx scripts/pr-check.ts`
Expected: all automated checks pass, INCLUDING the three new MCP rules.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: all tests pass (including new handle, schema, lockstep, and ActivityFeed tests).

- [ ] **Step 4: Run production build**

Run: `npx vite build`
Expected: build succeeds.

- [ ] **Step 5: Confirm staged commits**

Run: `git log --oneline staging..HEAD`
Expected: 7 commits, one per Task 1-7.

- [ ] **Step 6: Open PR to `staging`**

```bash
git push -u origin HEAD
gh pr create --base staging --title "feat(mcp-actions): phase 1 shared infra + phase 3-UI badge" --body "$(cat <<'EOF'
## Summary
Shared MCP infrastructure that every Phase 2 write tool will depend on, plus the activity-feed chat badge that renders when \`metadata.source === 'mcp-chat'\`. Bundled because the work streams touch disjoint files and are individually small.

### Phase 1 — shared infra
1. \`server/mcp/handles.ts\` — workspace-scoped TTL handle store with 5 error classes, 15-min default TTL
2. \`shared/types/mcp-action-schemas.ts\` — Zod schemas for all 10 Phase 2 tool inputs + shared layout/outline schemas
3. Three new pr-check rules: \`mcp-action-must-route-through-service\`, \`mcp-action-must-tag-source\` (multi-line customCheck), \`mcp-action-must-broadcast\` (mutation-fn detection)
4. One new contract test: \`mcp-tool-job-name-lockstep\` (vacuous today, activates with Phase 2)
5. Unit tests for handle store (8 tests) and schemas (smoke coverage)

### Phase 3-UI — chat badge
6. \`ActivityFeed.tsx\` renders zinc \`chat\` badge when \`metadata.source === 'mcp-chat'\` (Four Laws: zinc not teal because read-only provenance)
7. Component test (4 assertions)

The new pr-check rules and contract test pass trivially today because \`server/mcp/tools/*-actions.ts\` files don't exist yet — they activate the moment Phase 2 lands its first tool. The badge render is a visual no-op for live data until Phase 2 starts writing chat-sourced entries.

## Test plan
- [x] \`npm run typecheck\` passes
- [x] \`npx tsx scripts/pr-check.ts\` passes (all 3 new rules in the passing list)
- [x] \`npx vitest run\` passes (including new handle, schema, lockstep, ActivityFeed tests)
- [x] \`npx vite build\` succeeds
- [x] Spot-check: badge renders when \`metadata.source = 'mcp-chat'\` is injected into a live activity row; absent otherwise

## Phase
This is Phase 1 + 3-UI of 4 for the MCP actions feature. Phase 0 (#925) merged 2026-05-25. After this merges to \`staging\` and CI is green, Phase 2 (10 tool implementation across 3 parallel agents) unblocks. Phase 4 verification gates the final ship.

See [docs/superpowers/specs/2026-05-25-mcp-actions-keyword-and-content-design.md](docs/superpowers/specs/2026-05-25-mcp-actions-keyword-and-content-design.md).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review (completed)

**Spec coverage:** Every audit-identified Phase 1 infra item maps to a task (handles, schemas, three pr-check rules, contract test). The Phase 3-UI badge implements the spec's "Activity log clarity" section.

**Placeholder scan:** No TBDs. The vacuous branch in Task 6 asserts `existsSync(...).toBe(false)` (real claim about current state) rather than `expect(true).toBe(true)`.

**Type consistency:** `HandleKind` union members are used identically in `issueHandle`, `consumeHandle`, schemas test, and `handleIdSchema` regex. The 10 schema exports listed in the Task 2 smoke test match the 10 tools in the spec. `Badge` props (`tone`, `size`, `variant`) match the actual primitive at `src/components/ui/Badge.tsx`.

**Scope check:** Phase 1 + 3-UI only. No Phase 2 tools. No Phase 4 verification.

**Phase 0 lessons applied:** Phase 1 + 3-UI changes don't add new WS events or activity types, so the contract-test allowlist gotcha that bit Phase 0 (3 separate allowlists for new constants) doesn't apply here. Future phases adding constants must remember to update all three allowlists.

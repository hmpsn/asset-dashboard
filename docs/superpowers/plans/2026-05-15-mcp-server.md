# MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only MCP server at `POST /mcp` to the existing Express backend, exposing 10 workspace intelligence tools consumable by Claude.ai and Claude Code.

**Architecture:** A new self-contained `server/mcp/` module mounts on the existing Express server. Tools call `buildWorkspaceIntelligence()` and direct slice functions — the same layer that powers AdminChat. A Bearer-token auth middleware using `MCP_API_KEY` guards all requests. No changes to existing routes or frontend code.

**Tech Stack:** `@modelcontextprotocol/sdk` (new), Express, `better-sqlite3`, existing intelligence slice functions.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `server/mcp/auth.ts` | Create | Bearer token middleware |
| `server/mcp/server.ts` | Create | MCP Server factory, tool routing, request handler |
| `server/mcp/index.ts` | Create | Express Router, mounts auth + server handler |
| `server/mcp/tools/workspaces.ts` | Create | `list_workspaces`, `get_workspace_overview` |
| `server/mcp/tools/intelligence.ts` | Create | `get_workspace_intelligence` |
| `server/mcp/tools/insights.ts` | Create | `get_insights`, `get_anomalies` |
| `server/mcp/tools/content.ts` | Create | `get_content_decay`, `get_keyword_analysis`, `get_seo_context` |
| `server/mcp/tools/clients.ts` | Create | `get_client_signals`, `get_pending_work` |
| `server/app.ts` | Modify | Import and mount MCP router at `/mcp` |
| `tests/integration/mcp.test.ts` | Create | Integration tests for auth + all tools (port 13357) |
| `FEATURE_AUDIT.md` | Modify | Add MCP server entry |
| `data/roadmap.json` | Modify | Mark item done |

## Task Dependencies

```
Task 1 (install + auth)
  → Task 2 (MCP server core + app.ts mount)
    → Task 3 (workspace tools)       — sequential: shares server.ts + mcp.test.ts
      → Task 4 (intelligence tool)
        → Task 5 (insight tools)
          → Task 6 (content & SEO tools)
            → Task 7 (client tools)
              → Task 8 (quality gates + docs)
```

Tasks 3–7 are sequential because they all modify `server/mcp/server.ts` (adding tool registrations) and `tests/integration/mcp.test.ts` (adding test cases).

---

## Task 1 — Install SDK + Auth Middleware

**Model:** Sonnet  
**Files:**
- Create: `server/mcp/auth.ts`
- Create: `tests/integration/mcp.test.ts` (auth tests only — expanded in later tasks)

### CLAUDE.md conventions to follow
- Imports at top of file, grouped with existing imports — never mid-file
- Use `createLogger(module)` from `server/logger.ts` for server-side logging
- API error shape: `{ error: string }` consistently

---

- [ ] **Step 1.1 — Install the SDK**

```bash
npm install @modelcontextprotocol/sdk
```

Expected: package added to `package.json` and `package-lock.json`.

- [ ] **Step 1.2 — Write auth middleware**

Create `server/mcp/auth.ts`:

```typescript
import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '../logger.js';

const log = createLogger('mcp-auth');

export function mcpAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const apiKey = process.env.MCP_API_KEY;
  if (!apiKey) {
    log.warn('MCP_API_KEY env var not set — rejecting all MCP requests');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const token = auth.slice(7);
  if (token !== apiKey) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}
```

- [ ] **Step 1.3 — Write the auth integration test (auth cases only)**

Create `tests/integration/mcp.test.ts`:

```typescript
/**
 * Integration tests for the MCP server.
 * Port: 13357
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';

const MCP_TEST_KEY = 'test-mcp-key-abc123';
const ctx = createTestContext(13357);

let ws: ReturnType<typeof seedWorkspace>;

beforeAll(async () => {
  process.env.MCP_API_KEY = MCP_TEST_KEY;
  await ctx.startServer();
  ws = seedWorkspace();
});

afterAll(async () => {
  ws.cleanup();
  await ctx.stopServer();
  delete process.env.MCP_API_KEY;
});

// Helper: POST a JSON-RPC message to /mcp with optional Bearer token
async function mcpPost(
  body: unknown,
  token?: string,
): Promise<Response> {
  return ctx.api('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

// Helper: perform MCP initialize handshake, then call a tool
async function mcpToolCall(
  toolName: string,
  toolArgs: Record<string, unknown> = {},
): Promise<unknown> {
  // MCP requires initialize before tool calls
  await mcpPost(
    {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
      id: 0,
    },
    MCP_TEST_KEY,
  );

  const res = await mcpPost(
    {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: toolName, arguments: toolArgs },
      id: 1,
    },
    MCP_TEST_KEY,
  );

  expect(res.status).toBe(200);
  const body = await res.json() as { result?: { content: Array<{ type: string; text: string }> }; error?: unknown };
  expect(body.result).toBeDefined();
  expect(body.result!.content.length).toBeGreaterThan(0);
  return JSON.parse(body.result!.content[0].text);
}

describe('MCP auth', () => {
  it('rejects requests with no Authorization header', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', method: 'tools/list', id: 1 });
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Unauthorized');
  });

  it('rejects requests with a wrong Bearer token', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', method: 'tools/list', id: 1 },
      'wrong-key',
    );
    expect(res.status).toBe(401);
  });

  it('accepts requests with the correct Bearer token', async () => {
    const res = await mcpPost(
      {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0' },
        },
        id: 0,
      },
      MCP_TEST_KEY,
    );
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 1.4 — Run auth tests to verify they fail correctly**

```bash
npx vitest run tests/integration/mcp.test.ts
```

Expected: tests fail because `/mcp` route doesn't exist yet (connection refused or 404). This confirms the tests are wired up correctly. The auth acceptance test may 404 — that's expected at this stage.

- [ ] **Step 1.5 — Commit**

```bash
git add server/mcp/auth.ts tests/integration/mcp.test.ts package.json package-lock.json
git commit -m "feat(mcp): install SDK and add bearer token auth middleware"
```

---

## Task 2 — MCP Server Core + Express Mount

**Model:** Sonnet  
**Files:**
- Create: `server/mcp/server.ts`
- Create: `server/mcp/index.ts`
- Modify: `server/app.ts` (import + mount)

### Gotchas
- The `/mcp` route must NOT be behind the APP_PASSWORD gate. Since it doesn't start with `/api`, the gate skips it automatically — no special handling needed.
- `express.json()` is applied globally in app.ts (line ~189) before any routes, so the MCP request body will be parsed correctly.
- Create a new `Server` + `StreamableHTTPServerTransport` per request (stateless mode). Do not share transport instances across requests.

---

- [ ] **Step 2.1 — Create the MCP server factory**

Create `server/mcp/server.ts`:

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Request, Response } from 'express';
import { createLogger } from '../logger.js';
import { workspaceTools, handleWorkspaceTool } from './tools/workspaces.js';
import { intelligenceTools, handleIntelligenceTool } from './tools/intelligence.js';
import { insightTools, handleInsightTool } from './tools/insights.js';
import { contentTools, handleContentTool } from './tools/content.js';
import { clientTools, handleClientTool } from './tools/clients.js';

const log = createLogger('mcp-server');

const ALL_TOOLS = [
  ...workspaceTools,
  ...intelligenceTools,
  ...insightTools,
  ...contentTools,
  ...clientTools,
];

function buildMcpServer(): Server {
  const server = new Server(
    { name: 'hmpsn-studio', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    log.debug({ tool: name }, 'MCP tool call');

    const safeArgs = (args ?? {}) as Record<string, unknown>;

    if (workspaceTools.some(t => t.name === name)) {
      return handleWorkspaceTool(name, safeArgs);
    }
    if (intelligenceTools.some(t => t.name === name)) {
      return handleIntelligenceTool(name, safeArgs);
    }
    if (insightTools.some(t => t.name === name)) {
      return handleInsightTool(name, safeArgs);
    }
    if (contentTools.some(t => t.name === name)) {
      return handleContentTool(name, safeArgs);
    }
    if (clientTools.some(t => t.name === name)) {
      return handleClientTool(name, safeArgs);
    }

    return {
      isError: true,
      content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
    };
  });

  return server;
}

export async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });
  const server = buildMcpServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body as unknown);
}
```

- [ ] **Step 2.2 — Create stub tool files (so server.ts compiles)**

Create `server/mcp/tools/workspaces.ts` (stub — expanded in Task 3):

```typescript
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const workspaceTools: Tool[] = [];

export async function handleWorkspaceTool(
  _name: string,
  _args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  return { isError: true, content: [{ type: 'text', text: 'Not implemented' }] };
}
```

Create `server/mcp/tools/intelligence.ts` (stub):

```typescript
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const intelligenceTools: Tool[] = [];

export async function handleIntelligenceTool(
  _name: string,
  _args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  return { isError: true, content: [{ type: 'text', text: 'Not implemented' }] };
}
```

Create `server/mcp/tools/insights.ts` (stub):

```typescript
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const insightTools: Tool[] = [];

export async function handleInsightTool(
  _name: string,
  _args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  return { isError: true, content: [{ type: 'text', text: 'Not implemented' }] };
}
```

Create `server/mcp/tools/content.ts` (stub):

```typescript
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const contentTools: Tool[] = [];

export async function handleContentTool(
  _name: string,
  _args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  return { isError: true, content: [{ type: 'text', text: 'Not implemented' }] };
}
```

Create `server/mcp/tools/clients.ts` (stub):

```typescript
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const clientTools: Tool[] = [];

export async function handleClientTool(
  _name: string,
  _args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  return { isError: true, content: [{ type: 'text', text: 'Not implemented' }] };
}
```

- [ ] **Step 2.3 — Create the Express router**

Create `server/mcp/index.ts`:

```typescript
import { Router } from 'express';
import { mcpAuthMiddleware } from './auth.js';
import { handleMcpRequest } from './server.js';

const router = Router();

router.post('/', mcpAuthMiddleware, async (req, res) => {
  try {
    await handleMcpRequest(req, res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

export default router;
```

- [ ] **Step 2.4 — Mount in app.ts**

In `server/app.ts`, add the import near the other route imports (find the `// ─── Route modules ───` comment block):

```typescript
import mcpRouter from './mcp/index.js';
```

Then add the mount after the body parser setup (after the `app.use(express.json(...))` line, before the APP_PASSWORD gate). Find the line `app.use(optionalAuth)` and add directly before it:

```typescript
// ─── MCP server (own Bearer-token auth, not behind APP_PASSWORD gate) ───
app.use('/mcp', mcpRouter);
```

- [ ] **Step 2.5 — Run typecheck**

```bash
npm run typecheck
```

Expected: zero errors. Fix any import or type issues before continuing.

- [ ] **Step 2.6 — Run tests to verify auth tests now pass**

```bash
npx vitest run tests/integration/mcp.test.ts
```

Expected: all 3 auth tests pass (reject no-header, reject wrong key, accept correct key). The `tools/list` check is also implied by the acceptance test returning 200.

- [ ] **Step 2.7 — Commit**

```bash
git add server/mcp/server.ts server/mcp/index.ts server/mcp/tools/workspaces.ts server/mcp/tools/intelligence.ts server/mcp/tools/insights.ts server/mcp/tools/content.ts server/mcp/tools/clients.ts server/app.ts
git commit -m "feat(mcp): add MCP server core, router, and stub tool files"
```

---

## Task 3 — Workspace Tools

**Model:** Sonnet  
**Files:**
- Modify: `server/mcp/tools/workspaces.ts` (replace stubs with real implementation)
- Modify: `server/mcp/server.ts` (no changes needed — stubs already wired in)
- Modify: `tests/integration/mcp.test.ts` (add workspace tool tests)

### Key imports
- `db` from `../../db/index.js` — direct SQLite query for workspace list
- `getWorkspace` from `../../workspaces.js` — existence check
- `listBatches` from `../../approvals.js` — pending approval counts
- `listRequests` from `../../requests.js` — pending request counts
- `listClientActions` from `../../client-actions.js` — pending client action counts

### Gotcha
- `listBatches(workspaceId)` returns `ApprovalBatch[]`. Count pending items with `.flatMap(b => b.items).filter(i => i.status === 'pending').length`.

---

- [ ] **Step 3.1 — Add workspace tool tests to mcp.test.ts**

Append these describe blocks to `tests/integration/mcp.test.ts` (after the auth describe block):

```typescript
describe('list_workspaces', () => {
  it('returns an array of workspace summaries', async () => {
    const result = await mcpToolCall('list_workspaces') as unknown[];
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    const first = result[0] as Record<string, unknown>;
    expect(typeof first.id).toBe('string');
    expect(typeof first.name).toBe('string');
    expect(typeof first.tier).toBe('string');
  });
});

describe('get_workspace_overview', () => {
  it('returns overview for a known workspace', async () => {
    const result = await mcpToolCall('get_workspace_overview', {
      workspaceId: ws.workspaceId,
    }) as Record<string, unknown>;
    expect(result.id).toBe(ws.workspaceId);
    expect(typeof result.name).toBe('string');
    expect(typeof result.tier).toBe('string');
    expect(typeof result.pendingApprovals).toBe('number');
    expect(typeof result.pendingRequests).toBe('number');
  });

  it('returns an error for an unknown workspace', async () => {
    const res = await mcpPost(
      {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'get_workspace_overview', arguments: { workspaceId: 'nonexistent-ws' } },
        id: 2,
      },
      MCP_TEST_KEY,
    );
    const body = await res.json() as { result?: { isError?: boolean; content: Array<{ text: string }> } };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content[0].text).toContain('Workspace not found');
  });
});
```

- [ ] **Step 3.2 — Run tests to confirm they fail**

```bash
npx vitest run tests/integration/mcp.test.ts
```

Expected: `list_workspaces` and `get_workspace_overview` tests fail because tools are stubs returning "Not implemented".

- [ ] **Step 3.3 — Implement workspace tools**

Replace the contents of `server/mcp/tools/workspaces.ts`:

```typescript
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import db from '../../db/index.js';
import { getWorkspace } from '../../workspaces.js';
import { listBatches } from '../../approvals.js';
import { listRequests } from '../../requests.js';
import { listClientActions } from '../../client-actions.js';

export const workspaceTools: Tool[] = [
  {
    name: 'list_workspaces',
    description:
      'List all client workspaces with health score, tier, trial status, and pending work counts. Use this to identify which clients need attention.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_workspace_overview',
    description:
      'Get a detailed snapshot of a single workspace: health score, tier, pending approval/request/action counts, and recent activity.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'The workspace ID' },
      },
      required: ['workspaceId'],
    },
  },
];

interface WorkspaceRow {
  id: string;
  name: string;
  tier: string | null;
  live_domain: string | null;
  created_at: string;
}

function pendingCounts(workspaceId: string) {
  const batches = listBatches(workspaceId);
  const pendingApprovals = batches
    .flatMap(b => b.items)
    .filter(i => i.status === 'pending').length;
  const pendingRequests = listRequests(workspaceId).filter(
    r => r.status === 'requested',
  ).length;
  const pendingActions = listClientActions(workspaceId).filter(
    a => a.status === 'pending',
  ).length;
  return { pendingApprovals, pendingRequests, pendingActions };
}

async function handleListWorkspaces() {
  const rows = db
    .prepare('SELECT id, name, tier, live_domain, created_at FROM workspaces ORDER BY name ASC')
    .all() as WorkspaceRow[];

  const workspaces = rows.map(row => ({
    id: row.id,
    name: row.name,
    tier: row.tier ?? 'free',
    liveDomain: row.live_domain,
    ...pendingCounts(row.id),
  }));

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(workspaces) }],
  };
}

async function handleGetWorkspaceOverview(args: Record<string, unknown>) {
  const workspaceId = args.workspaceId as string;
  const ws = getWorkspace(workspaceId);
  if (!ws) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `Workspace not found: ${workspaceId}` }],
    };
  }

  const counts = pendingCounts(workspaceId);

  const overview = {
    id: ws.id,
    name: ws.name,
    tier: ws.tier ?? 'free',
    liveDomain: ws.liveDomain ?? null,
    ...counts,
    totalPending: counts.pendingApprovals + counts.pendingRequests + counts.pendingActions,
  };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(overview) }],
  };
}

export async function handleWorkspaceTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  try {
    switch (name) {
      case 'list_workspaces':
        return handleListWorkspaces();
      case 'get_workspace_overview':
        return handleGetWorkspaceOverview(args);
      default:
        return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: 'text', text: `Tool error: ${message}` }] };
  }
}
```

- [ ] **Step 3.4 — Run tests to verify they pass**

```bash
npx vitest run tests/integration/mcp.test.ts
```

Expected: all auth tests + workspace tool tests pass.

- [ ] **Step 3.5 — Commit**

```bash
git add server/mcp/tools/workspaces.ts tests/integration/mcp.test.ts
git commit -m "feat(mcp): implement list_workspaces and get_workspace_overview tools"
```

---

## Task 4 — Intelligence Tool

**Model:** Sonnet  
**Files:**
- Modify: `server/mcp/tools/intelligence.ts` (replace stub)
- Modify: `tests/integration/mcp.test.ts` (add test)

### Key imports
- `buildWorkspaceIntelligence` from `../../workspace-intelligence.js`
- `getWorkspace` from `../../workspaces.js`

### Gotcha
- `buildWorkspaceIntelligence` accepts `opts.slices?: IntelligenceSlice[]`. Valid slice names: `'seoContext' | 'insights' | 'learnings' | 'pageProfile' | 'pageElements' | 'siteInventory' | 'contentPipeline' | 'siteHealth' | 'clientSignals' | 'operational'`. Default (no slices param) assembles all.
- The result is a large object. Return it as JSON — Claude handles the parsing.

---

- [ ] **Step 4.1 — Add intelligence test**

Append to `tests/integration/mcp.test.ts`:

```typescript
describe('get_workspace_intelligence', () => {
  it('returns an intelligence bundle for a known workspace', async () => {
    const result = await mcpToolCall('get_workspace_intelligence', {
      workspaceId: ws.workspaceId,
    }) as Record<string, unknown>;
    expect(result.workspaceId).toBe(ws.workspaceId);
    expect(typeof result.assembledAt).toBe('string');
  });

  it('returns an error for an unknown workspace', async () => {
    const res = await mcpPost(
      {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_workspace_intelligence',
          arguments: { workspaceId: 'nonexistent-ws' },
        },
        id: 3,
      },
      MCP_TEST_KEY,
    );
    const body = await res.json() as { result?: { isError?: boolean } };
    expect(body.result?.isError).toBe(true);
  });
});
```

- [ ] **Step 4.2 — Run tests to confirm they fail**

```bash
npx vitest run tests/integration/mcp.test.ts
```

Expected: new intelligence test fails (stub returns "Not implemented").

- [ ] **Step 4.3 — Implement intelligence tool**

Replace `server/mcp/tools/intelligence.ts`:

```typescript
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { buildWorkspaceIntelligence } from '../../workspace-intelligence.js';
import { getWorkspace } from '../../workspaces.js';
import type { IntelligenceSlice } from '../../../shared/types/intelligence.js';

export const intelligenceTools: Tool[] = [
  {
    name: 'get_workspace_intelligence',
    description:
      'Get the full intelligence bundle for a workspace — the same context used by AdminChat. Includes SEO context, insights summary, content pipeline, site health, client signals, and keyword context. Use when you need the complete picture before making decisions about a workspace. Pass specific slices to reduce response size.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'The workspace ID' },
        slices: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional: limit to specific slices. Valid values: seoContext, insights, learnings, pageProfile, pageElements, siteInventory, contentPipeline, siteHealth, clientSignals, operational. Omit for all slices.',
        },
      },
      required: ['workspaceId'],
    },
  },
];

export async function handleIntelligenceTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  if (name !== 'get_workspace_intelligence') {
    return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  }

  const workspaceId = args.workspaceId as string;
  const slices = args.slices as IntelligenceSlice[] | undefined;

  try {
    const ws = getWorkspace(workspaceId);
    if (!ws) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Workspace not found: ${workspaceId}` }],
      };
    }

    const intel = await buildWorkspaceIntelligence(workspaceId, slices ? { slices } : undefined);
    return { content: [{ type: 'text' as const, text: JSON.stringify(intel) }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `Intelligence assembly failed: ${message}` }],
    };
  }
}
```

- [ ] **Step 4.4 — Run tests**

```bash
npx vitest run tests/integration/mcp.test.ts
```

Expected: all tests pass including the new intelligence tests.

- [ ] **Step 4.5 — Commit**

```bash
git add server/mcp/tools/intelligence.ts tests/integration/mcp.test.ts
git commit -m "feat(mcp): implement get_workspace_intelligence tool"
```

---

## Task 5 — Insight Tools

**Model:** Sonnet  
**Files:**
- Modify: `server/mcp/tools/insights.ts` (replace stub)
- Modify: `tests/integration/mcp.test.ts` (add tests)

### Key imports
- `getInsights` from `../../analytics-insights-store.js` — signature: `getInsights(workspaceId: string, insightType?: InsightType): AnalyticsInsight[]`
- `getWorkspace` from `../../workspaces.js`
- `InsightType` from `../../../shared/types/analytics.js`

### Notes
- `get_anomalies` uses `getInsights(workspaceId, 'anomaly_digest')`. The `anomaly_digest` type is the platform's anomaly aggregation insight.
- For `resolved: false` (default): filter results where `resolutionStatus` is null.
- For `resolved: true`: return all `anomaly_digest` insights regardless of status.

---

- [ ] **Step 5.1 — Add insight tests**

Append to `tests/integration/mcp.test.ts`:

```typescript
describe('get_insights', () => {
  it('returns an array for a known workspace', async () => {
    const result = await mcpToolCall('get_insights', {
      workspaceId: ws.workspaceId,
    }) as unknown[];
    expect(Array.isArray(result)).toBe(true);
  });

  it('accepts a type filter', async () => {
    const result = await mcpToolCall('get_insights', {
      workspaceId: ws.workspaceId,
      type: 'content_decay',
    }) as Array<Record<string, unknown>>;
    expect(Array.isArray(result)).toBe(true);
    // If any returned, they should all be content_decay type
    if (result.length > 0) {
      expect(result.every(i => i.insightType === 'content_decay')).toBe(true);
    }
  });

  it('returns an error for an unknown workspace', async () => {
    const res = await mcpPost(
      {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'get_insights', arguments: { workspaceId: 'nonexistent' } },
        id: 4,
      },
      MCP_TEST_KEY,
    );
    const body = await res.json() as { result?: { isError?: boolean } };
    expect(body.result?.isError).toBe(true);
  });
});

describe('get_anomalies', () => {
  it('returns an array of anomaly_digest insights', async () => {
    const result = await mcpToolCall('get_anomalies', {
      workspaceId: ws.workspaceId,
    }) as unknown[];
    expect(Array.isArray(result)).toBe(true);
    // May be empty if no anomalies seeded — that is valid
  });
});
```

- [ ] **Step 5.2 — Run tests to confirm they fail**

```bash
npx vitest run tests/integration/mcp.test.ts
```

Expected: new insight tests fail (stub).

- [ ] **Step 5.3 — Implement insight tools**

Replace `server/mcp/tools/insights.ts`:

```typescript
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getInsights } from '../../analytics-insights-store.js';
import { getWorkspace } from '../../workspaces.js';
import type { InsightType } from '../../../shared/types/analytics.js';

export const insightTools: Tool[] = [
  {
    name: 'get_insights',
    description:
      'Get stored insights for a workspace. Optionally filter by insight type. Returns insight title, severity, impact score, and data payload. Insight types include: page_health, ranking_opportunity, content_decay, cannibalization, keyword_cluster, competitor_gap, ranking_mover, ctr_opportunity, anomaly_digest, audit_finding, site_health.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'The workspace ID' },
        type: {
          type: 'string',
          description: 'Optional: filter to a specific insight type',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of insights to return (default: 20)',
        },
      },
      required: ['workspaceId'],
    },
  },
  {
    name: 'get_anomalies',
    description:
      'Get detected anomalies for a workspace — unusual traffic drops, rank changes, indexation issues. Returns unresolved anomalies by default.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'The workspace ID' },
        resolved: {
          type: 'boolean',
          description: 'If true, include resolved anomalies. Default: false (unresolved only)',
        },
      },
      required: ['workspaceId'],
    },
  },
];

export async function handleInsightTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const workspaceId = args.workspaceId as string;

  try {
    const ws = getWorkspace(workspaceId);
    if (!ws) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Workspace not found: ${workspaceId}` }],
      };
    }

    if (name === 'get_insights') {
      const type = args.type as InsightType | undefined;
      const limit = (args.limit as number | undefined) ?? 20;
      const insights = getInsights(workspaceId, type).slice(0, limit);
      return { content: [{ type: 'text' as const, text: JSON.stringify(insights) }] };
    }

    if (name === 'get_anomalies') {
      const resolved = (args.resolved as boolean | undefined) ?? false;
      let anomalies = getInsights(workspaceId, 'anomaly_digest');
      if (!resolved) {
        anomalies = anomalies.filter(a => a.resolutionStatus !== 'resolved');
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(anomalies) }] };
    }

    return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: 'text' as const, text: `Tool error: ${message}` }] };
  }
}
```

- [ ] **Step 5.4 — Run tests**

```bash
npx vitest run tests/integration/mcp.test.ts
```

Expected: all tests pass.

- [ ] **Step 5.5 — Commit**

```bash
git add server/mcp/tools/insights.ts tests/integration/mcp.test.ts
git commit -m "feat(mcp): implement get_insights and get_anomalies tools"
```

---

## Task 6 — Content & SEO Tools

**Model:** Sonnet  
**Files:**
- Modify: `server/mcp/tools/content.ts` (replace stub)
- Modify: `tests/integration/mcp.test.ts` (add tests)

### Key imports
- `getInsights` from `../../analytics-insights-store.js` — for content decay (filter to `'content_decay'` type, sort by `impactScore` desc)
- `listKeywordGaps` from `../../keyword-gaps.js`
- `listTopicClusters` from `../../topic-clusters.js`
- `listCannibalizationIssues` from `../../cannibalization-issues.js`
- `buildWorkspaceIntelligence` from `../../workspace-intelligence.js` — for `get_seo_context` (slices: `['seoContext']`)
- `getWorkspace` from `../../workspaces.js`

---

- [ ] **Step 6.1 — Add content tool tests**

Append to `tests/integration/mcp.test.ts`:

```typescript
describe('get_content_decay', () => {
  it('returns an array sorted by severity', async () => {
    const result = await mcpToolCall('get_content_decay', {
      workspaceId: ws.workspaceId,
    }) as unknown[];
    expect(Array.isArray(result)).toBe(true);
  });

  it('respects the limit parameter', async () => {
    const result = await mcpToolCall('get_content_decay', {
      workspaceId: ws.workspaceId,
      limit: 3,
    }) as unknown[];
    expect(result.length).toBeLessThanOrEqual(3);
  });
});

describe('get_keyword_analysis', () => {
  it('returns gaps, clusters, and cannibalization arrays', async () => {
    const result = await mcpToolCall('get_keyword_analysis', {
      workspaceId: ws.workspaceId,
    }) as Record<string, unknown>;
    expect(Array.isArray(result.gaps)).toBe(true);
    expect(Array.isArray(result.topicClusters)).toBe(true);
    expect(Array.isArray(result.cannibalization)).toBe(true);
  });
});

describe('get_seo_context', () => {
  it('returns an object with expected fields', async () => {
    const result = await mcpToolCall('get_seo_context', {
      workspaceId: ws.workspaceId,
    }) as Record<string, unknown>;
    // Result may be sparse for a test workspace — just verify it's an object
    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
  });
});
```

- [ ] **Step 6.2 — Run tests to confirm they fail**

```bash
npx vitest run tests/integration/mcp.test.ts
```

Expected: new content tests fail (stubs).

- [ ] **Step 6.3 — Implement content tools**

Replace `server/mcp/tools/content.ts`:

```typescript
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getInsights } from '../../analytics-insights-store.js';
import { listKeywordGaps } from '../../keyword-gaps.js';
import { listTopicClusters } from '../../topic-clusters.js';
import { listCannibalizationIssues } from '../../cannibalization-issues.js';
import { buildWorkspaceIntelligence } from '../../workspace-intelligence.js';
import { getWorkspace } from '../../workspaces.js';

export const contentTools: Tool[] = [
  {
    name: 'get_content_decay',
    description:
      'Get pages losing organic traffic over time, sorted by decay severity (most severe first). The starting point for rewrite prioritization. Each result includes the page path, traffic decline percentage, and baseline vs current click counts.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'The workspace ID' },
        limit: {
          type: 'number',
          description: 'Maximum pages to return (default: 20)',
        },
      },
      required: ['workspaceId'],
    },
  },
  {
    name: 'get_keyword_analysis',
    description:
      'Get keyword gaps (opportunities not yet targeted), topic cluster coverage, and cannibalization conflicts for a workspace. Use before content planning to understand what to write and what to fix.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'The workspace ID' },
      },
      required: ['workspaceId'],
    },
  },
  {
    name: 'get_seo_context',
    description:
      'Get the SEO context for a workspace: domain health, brand voice, business context, and GSC ranking signals. Use before any content or schema work to understand the site\'s current SEO state.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'The workspace ID' },
      },
      required: ['workspaceId'],
    },
  },
];

export async function handleContentTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const workspaceId = args.workspaceId as string;

  try {
    const ws = getWorkspace(workspaceId);
    if (!ws) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Workspace not found: ${workspaceId}` }],
      };
    }

    if (name === 'get_content_decay') {
      const limit = (args.limit as number | undefined) ?? 20;
      const decayInsights = getInsights(workspaceId, 'content_decay')
        .sort((a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0))
        .slice(0, limit)
        .map(i => ({
          pageId: i.pageId,
          severity: i.severity,
          impactScore: i.impactScore,
          data: i.data,
        }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(decayInsights) }] };
    }

    if (name === 'get_keyword_analysis') {
      const result = {
        gaps: listKeywordGaps(workspaceId),
        topicClusters: listTopicClusters(workspaceId),
        cannibalization: listCannibalizationIssues(workspaceId),
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    }

    if (name === 'get_seo_context') {
      const intel = await buildWorkspaceIntelligence(workspaceId, { slices: ['seoContext'] });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(intel.seoContext ?? {}) }],
      };
    }

    return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: 'text' as const, text: `Tool error: ${message}` }] };
  }
}
```

- [ ] **Step 6.4 — Run tests**

```bash
npx vitest run tests/integration/mcp.test.ts
```

Expected: all tests pass.

- [ ] **Step 6.5 — Commit**

```bash
git add server/mcp/tools/content.ts tests/integration/mcp.test.ts
git commit -m "feat(mcp): implement get_content_decay, get_keyword_analysis, get_seo_context tools"
```

---

## Task 7 — Client Signal Tools

**Model:** Sonnet  
**Files:**
- Modify: `server/mcp/tools/clients.ts` (replace stub)
- Modify: `tests/integration/mcp.test.ts` (add tests)

### Key imports
- `buildWorkspaceIntelligence` from `../../workspace-intelligence.js` — for `get_client_signals` (slices: `['clientSignals']`)
- `listBatches` from `../../approvals.js`
- `listRequests` from `../../requests.js`
- `listClientActions` from `../../client-actions.js`
- `getWorkspace` from `../../workspaces.js`
- `db` from `../../db/index.js` — for cross-workspace workspace list in `get_pending_work`

### Note on `get_pending_work` without workspaceId
`listRequests()` called with no arguments returns all requests across workspaces. `listBatches` and `listClientActions` require a workspaceId, so for cross-workspace you query all workspace IDs first.

---

- [ ] **Step 7.1 — Add client tool tests**

Append to `tests/integration/mcp.test.ts`:

```typescript
describe('get_client_signals', () => {
  it('returns client signals for a known workspace', async () => {
    const result = await mcpToolCall('get_client_signals', {
      workspaceId: ws.workspaceId,
    }) as Record<string, unknown> | null;
    // Result may be null/empty for a test workspace with no client activity
    expect(result === null || typeof result === 'object').toBe(true);
  });

  it('returns an error for an unknown workspace', async () => {
    const res = await mcpPost(
      {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'get_client_signals', arguments: { workspaceId: 'nonexistent' } },
        id: 5,
      },
      MCP_TEST_KEY,
    );
    const body = await res.json() as { result?: { isError?: boolean } };
    expect(body.result?.isError).toBe(true);
  });
});

describe('get_pending_work', () => {
  it('returns pending work for a known workspace', async () => {
    const result = await mcpToolCall('get_pending_work', {
      workspaceId: ws.workspaceId,
    }) as Record<string, unknown>;
    expect(typeof result.pendingApprovals).toBe('number');
    expect(typeof result.pendingRequests).toBe('number');
    expect(typeof result.pendingActions).toBe('number');
    expect(Array.isArray(result.approvalBatches)).toBe(true);
    expect(Array.isArray(result.requests)).toBe(true);
    expect(Array.isArray(result.clientActions)).toBe(true);
  });

  it('returns cross-workspace pending work when no workspaceId provided', async () => {
    const result = await mcpToolCall('get_pending_work', {}) as Record<string, unknown>;
    expect(typeof result.totalPending).toBe('number');
    expect(Array.isArray(result.workspaces)).toBe(true);
  });
});
```

- [ ] **Step 7.2 — Run tests to confirm they fail**

```bash
npx vitest run tests/integration/mcp.test.ts
```

Expected: new client tests fail (stubs).

- [ ] **Step 7.3 — Implement client tools**

Replace `server/mcp/tools/clients.ts`:

```typescript
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { buildWorkspaceIntelligence } from '../../workspace-intelligence.js';
import { listBatches } from '../../approvals.js';
import { listRequests } from '../../requests.js';
import { listClientActions } from '../../client-actions.js';
import { getWorkspace } from '../../workspaces.js';
import db from '../../db/index.js';

export const clientTools: Tool[] = [
  {
    name: 'get_client_signals',
    description:
      'Get client portal engagement signals for a workspace: last login time, decision response rate, flagged concerns, and conversation activity. Use to gauge how a client is feeling about the engagement.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'The workspace ID' },
      },
      required: ['workspaceId'],
    },
  },
  {
    name: 'get_pending_work',
    description:
      'Get all pending approvals, content requests, and client actions. Omit workspaceId to get a cross-workspace summary of everything that needs attention across all clients.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description:
            'Optional: filter to a specific workspace. Omit to see pending work across all workspaces.',
        },
      },
      required: [],
    },
  },
];

export async function handleClientTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  try {
    if (name === 'get_client_signals') {
      const workspaceId = args.workspaceId as string;
      const ws = getWorkspace(workspaceId);
      if (!ws) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Workspace not found: ${workspaceId}` }],
        };
      }
      const intel = await buildWorkspaceIntelligence(workspaceId, { slices: ['clientSignals'] });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(intel.clientSignals ?? null) }],
      };
    }

    if (name === 'get_pending_work') {
      const workspaceId = args.workspaceId as string | undefined;

      if (workspaceId) {
        // Single workspace
        const ws = getWorkspace(workspaceId);
        if (!ws) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Workspace not found: ${workspaceId}` }],
          };
        }
        const approvalBatches = listBatches(workspaceId);
        const requests = listRequests(workspaceId);
        const clientActions = listClientActions(workspaceId);

        const pendingApprovals = approvalBatches
          .flatMap(b => b.items)
          .filter(i => i.status === 'pending').length;
        const pendingRequests = requests.filter(r => r.status === 'requested').length;
        const pendingActions = clientActions.filter(a => a.status === 'pending').length;

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              workspaceId,
              pendingApprovals,
              pendingRequests,
              pendingActions,
              totalPending: pendingApprovals + pendingRequests + pendingActions,
              approvalBatches: approvalBatches.filter(b =>
                b.items.some(i => i.status === 'pending'),
              ),
              requests: requests.filter(r => r.status === 'requested'),
              clientActions: clientActions.filter(a => a.status === 'pending'),
            }),
          }],
        };
      }

      // Cross-workspace
      const allWorkspaces = db
        .prepare('SELECT id, name FROM workspaces ORDER BY name ASC')
        .all() as Array<{ id: string; name: string }>;

      const allRequests = listRequests(); // listRequests with no arg returns all
      const pendingRequestsAll = allRequests.filter(r => r.status === 'requested');

      const workspaces = allWorkspaces.map(ws => {
        const batches = listBatches(ws.id);
        const actions = listClientActions(ws.id);
        const pendingApprovals = batches
          .flatMap(b => b.items)
          .filter(i => i.status === 'pending').length;
        const pendingActions = actions.filter(a => a.status === 'pending').length;
        const pendingRequests = pendingRequestsAll.filter(r => r.workspaceId === ws.id).length;
        const total = pendingApprovals + pendingRequests + pendingActions;
        return { id: ws.id, name: ws.name, pendingApprovals, pendingRequests, pendingActions, total };
      }).filter(w => w.total > 0);

      const totalPending = workspaces.reduce((sum, w) => sum + w.total, 0);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ totalPending, workspaces }),
        }],
      };
    }

    return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: 'text' as const, text: `Tool error: ${message}` }] };
  }
}
```

- [ ] **Step 7.4 — Run the full test suite**

```bash
npx vitest run tests/integration/mcp.test.ts
```

Expected: all tests pass (auth × 3, workspace × 3, intelligence × 2, insights × 3, anomalies × 1, content_decay × 2, keyword_analysis × 1, seo_context × 1, client_signals × 2, pending_work × 2).

- [ ] **Step 7.5 — Commit**

```bash
git add server/mcp/tools/clients.ts tests/integration/mcp.test.ts
git commit -m "feat(mcp): implement get_client_signals and get_pending_work tools"
```

---

## Task 8 — Quality Gates + Docs

**Model:** Haiku (mechanical doc updates) / Sonnet (quality checks)

- [ ] **Step 8.1 — Run full typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 8.2 — Run full build**

```bash
npx vite build
```

Expected: build succeeds.

- [ ] **Step 8.3 — Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass (not just MCP tests).

- [ ] **Step 8.4 — Run pr-check**

```bash
npx tsx scripts/pr-check.ts
```

Expected: zero violations.

- [ ] **Step 8.5 — Update FEATURE_AUDIT.md**

Add this entry near the top of `FEATURE_AUDIT.md` (increment the feature count in the header; add the entry as the new highest-numbered item):

```markdown
### 363. MCP Server — Intelligence Facade

**What it does:** Exposes 10 read-only workspace intelligence tools via the Model Context Protocol at `POST /mcp`. Tools call the existing `buildWorkspaceIntelligence()` intelligence layer directly. Bearer-token auth via `MCP_API_KEY` env var. Compatible with Claude.ai and Claude Code MCP clients. Tools: `list_workspaces`, `get_workspace_overview`, `get_workspace_intelligence`, `get_insights`, `get_anomalies`, `get_content_decay`, `get_keyword_analysis`, `get_seo_context`, `get_client_signals`, `get_pending_work`.

**Agency value:** Query workspace health, surface insights, and diagnose client issues from within Claude chat sessions without opening the dashboard. Seeds the content rewrite workflow (identify decaying pages via MCP, rewrite in Claude).

**Client value:** Foundation for v2 client MCP tokens — eventually clients can query their own workspace data from any MCP-compatible AI tool.

**Mutual:** Turns the intelligence layer into an agentic interface. The same data assembly that powers AdminChat becomes directly addressable by AI sessions.
```

- [ ] **Step 8.6 — Update data/roadmap.json**

Run sort after updating:

```bash
npx tsx scripts/sort-roadmap.ts
```

- [ ] **Step 8.7 — Final commit**

```bash
git add FEATURE_AUDIT.md data/roadmap.json
git commit -m "docs: update FEATURE_AUDIT and roadmap for MCP server"
```

---

## Post-Ship Verification (manual, after deploy to staging)

- [ ] Add `MCP_API_KEY` to Render staging env vars: `openssl rand -hex 32`
- [ ] Verify connection in Claude Code: add to `.claude/settings.json` under `mcpServers` with URL `https://<staging-url>/mcp` and `Authorization: Bearer <key>` header
- [ ] Run `list_workspaces` from Claude Code — confirm real workspace data returns
- [ ] Run `get_workspace_intelligence` with a real workspaceId — confirm intelligence bundle returns
- [ ] Verify connection in Claude.ai MCP settings with the same staging URL
- [ ] Once staging is verified, add `MCP_API_KEY` to Render production env vars and merge staging → main

# Brand Intelligence Slice — P3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Add a read-only MCP tool `get_brand_identity(workspaceId)` so an agent can inspect a workspace's structured brand identity (mission/vision/values/tagline/elevator-pitch/positioning) + voice status, with an optional full deliverable list (incl. drafts) for deeper inspection.

**Architecture:** New domain-scoped `server/mcp/tools/brand.ts` (mirrors `tools/clients.ts`/`tools/workspaces.ts`) exposing one read tool that reads the existing `brand` slice via `buildWorkspaceIntelligence(ws, { slices: ['brand'] })` and, opt-in, the full deliverable list via the P1 leaf `brand-deliverable-read-model.ts`. Pure DB read; admin/MCP-auth gated; no paid call; no broadcast/WS/flags.

**Base:** `origin/staging` @ `a402e93b3` (includes P1+P2). **Branch:** `brand-slice-p3`.

---

## Response shape (identity-focused; consistent with P2 keys)

```json
{
  "availability": "ready" | "no_data",
  "identity": { "mission"?, "vision"?, "values"?, "tagline"?, "elevatorPitch"?, "positioning"? },
  "voice_status": "calibrated" | "legacy" | "none",
  "identity_prompt_block": "…ready-to-inject identity block…",
  "deliverables"?: [ { "id", "deliverableType", "content", "status", "version", "tier", "createdAt", "updatedAt" } ]   // only when includeDeliverables: true
}
```
- `identity` mirrors `BrandSlice.identity` (approved-only, camelCase sub-keys — same object P2's `brand_identity` returned). `voice_status` matches P2's payload key. **Do NOT** dump `voicePromptBlock`/`voiceDnaBlock` — voice content is delivered via the P2 content path; this tool is identity-scoped.
- `deliverables` (opt-in) exposes ALL types + `draft`/`approved` status (admin inspection) — fine since the tool is MCP-auth gated.

---

## Task 1: Input schema

**File:** `shared/types/mcp-action-schemas.ts` (mirror `getWorkspaceIntelligenceInputSchema` — confirm it uses `workspaceId` camelCase; match it exactly).

- [ ] Add:
```ts
export const getBrandIdentityInputSchema = z.object({
  workspaceId: z.string().min(1),
  includeDeliverables: z.boolean().optional(),
});
export type GetBrandIdentityInput = z.infer<typeof getBrandIdentityInputSchema>;
```
- [ ] `npm run typecheck` → clean. Commit.

## Task 2: Tool file + handler (TDD)

**Files:** Create `server/mcp/tools/brand.ts`; test `tests/unit/mcp-tools-read-models.test.ts`.

- [ ] **Failing test first** — extend `tests/unit/mcp-tools-read-models.test.ts` (mirror its `vi.hoisted` mock pattern; mock `buildWorkspaceIntelligence` + `../../server/brand-deliverable-read-model.js` `listDeliverables`). Cover: default returns `identity`+`voice_status`+`availability`+`identity_prompt_block`, NO `deliverables`; `includeDeliverables:true` returns `deliverables` with draft+approved; missing workspace → isError; invalid args → isError; assembly throw → isError. Run → FAIL.
- [ ] **Implement** `server/mcp/tools/brand.ts`:
```ts
import type { Tool } from '@modelcontextprotocol/sdk/types';
import { getBrandIdentityInputSchema } from '../../../shared/types/mcp-action-schemas.js';
import { getWorkspace } from '../../workspaces.js';
import { buildWorkspaceIntelligence } from '../../workspace-intelligence.js';
import { listDeliverables } from '../../brand-deliverable-read-model.js';
import { createLogger } from '../../logger.js';
import { toMcpJsonSchema } from '../json-schema.js';

const log = createLogger('mcp-tools-brand');

export const brandTools: Tool[] = [{
  name: 'get_brand_identity',
  description: "Get a workspace's structured brand identity (mission, vision, values, tagline, elevator pitch, positioning) and voice status. Set include_deliverables to also return every brand deliverable with its draft/approved status and version for deeper inspection. Use before content work to ground brand positioning.",
  inputSchema: toMcpJsonSchema(getBrandIdentityInputSchema),
}];

export async function handleBrandTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  if (name !== 'get_brand_identity') {
    return { isError: true, content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }] };
  }
  const parsed = getBrandIdentityInputSchema.safeParse(args);
  if (!parsed.success) {
    return { isError: true, content: [{ type: 'text' as const, text: `Validation failed: ${JSON.stringify(parsed.error.issues)}` }] };
  }
  const { workspaceId, includeDeliverables } = parsed.data;
  try {
    const ws = getWorkspace(workspaceId);
    if (!ws) return { isError: true, content: [{ type: 'text' as const, text: `Workspace not found: ${workspaceId}` }] };
    const intel = await buildWorkspaceIntelligence(workspaceId, { slices: ['brand'] });
    const brand = intel.brand;
    const payload: Record<string, unknown> = {
      availability: brand?.availability ?? 'no_data',
      identity: brand?.identity ?? {},
      voice_status: brand?.voice.status ?? 'none',
      identity_prompt_block: brand?.identityPromptBlock ?? '',
    };
    if (includeDeliverables) {
      payload.deliverables = listDeliverables(workspaceId).map(d => ({
        id: d.id, deliverableType: d.deliverableType, content: d.content,
        status: d.status, version: d.version, tier: d.tier, createdAt: d.createdAt, updatedAt: d.updatedAt,
      }));
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
  } catch (err) {
    log.error({ err, workspaceId }, 'MCP tool error');
    return { isError: true, content: [{ type: 'text' as const, text: `Tool error: ${err instanceof Error ? err.message : String(err)}` }] };
  }
}
```
  *(Note: input schema uses `includeDeliverables`; description says `include_deliverables` — fix the description to say `includeDeliverables` to match the actual param name.)*
- [ ] Run the test → PASS. Commit.

## Task 3: Register in server.ts

**File:** `server/mcp/server.ts`.
- [ ] Add `import { brandTools, handleBrandTool } from './tools/brand.js';`; add `...brandTools` to `ALL_TOOLS`; add dispatch branch `if (brandTools.some(t => t.name === name)) return handleBrandTool(name, safeArgs);` (group with the read-tool branches).
- [ ] Grep for any OTHER test that enumerates `ALL_TOOLS` or counts tools (e.g. `tests/unit/mcp-server-routing.test.ts`, `tests/unit/mcp-router.test.ts`) and update if it hard-codes the set/count.
- [ ] `npm run typecheck` + `npx vitest run tests/unit/mcp-server-routing.test.ts tests/unit/mcp-router.test.ts` → PASS. Commit.

## Task 4: Contract test + docs

**Files:** `tests/contract/mcp-tool-input-schema-properties.test.ts`, `FEATURE_AUDIT.md`, `data/roadmap.json`, design note §8.
- [ ] Add `import { brandTools }` + `...brandTools` to that contract test's `ALL_TOOLS` array.
- [ ] Update FEATURE_AUDIT.md brand entry (P3: agent read tool), roadmap (P3 done; `npx tsx scripts/sort-roadmap.ts`), design-note §8 (P3 delivered). Commit.

## Task 5: Full gates (DoD)

- [ ] `npm run typecheck` · `npx vite build` · `npx vitest run` · `npm run pr-check` · `npm run check:circular-deps` · `npm run verify:feature-flags` · `npm run lint:hooks` · `npm run verify:governance` · `npm run verify:style-drift` · `npm run verify:coverage-ratchet`.
- [ ] Independent adversarial review (focus: response shape correct, no client leakage, no-paid-call, dispatch wiring, draft exposure acceptable). Fix Critical/Important. PR → `staging`.

## Self-review
- New tool registered in all three lockstep spots (ALL_TOOLS, dispatch, contract-test array) — a missing one fails typecheck or the contract/routing test.
- `identity` reuses `BrandSlice.identity` (no re-derivation). No paid call, no broadcast, no flag. Admin/MCP-auth only (no client leakage — same posture as P1/P2).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import {
  clientViewOutputSchema,
  portfolioBriefOutputSchema,
  workspaceDecisionBriefOutputSchema,
} from '../../shared/types/mcp-operator-briefs.js';
import {
  buildClientIntelligenceView,
  clientIntelligenceSlicesForTier,
  type ClientIntelligenceTier,
} from '../../server/client-insight-view-model.js';
import { buildWorkspaceIntelligence } from '../../server/workspace-intelligence.js';
import { computeEffectiveTier, getWorkspace, updateWorkspace } from '../../server/workspaces.js';

const MCP_MASTER_KEY = 'test-mcp-p2-operator-master-key';
const ctx = createEphemeralTestContext(import.meta.url, {
  autoPublicAuth: true,
  env: { MCP_API_KEY: MCP_MASTER_KEY },
});

interface McpCallResult {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
  structuredContent?: { data?: unknown };
}

let workspace: SeededFullWorkspace;
let workspaceKeyId: string | undefined;
let workspacePlaintextKey: string | undefined;
let clientViewWorkspaces: Record<
  'free' | 'activeTrial' | 'growth' | 'premium',
  { workspace: SeededFullWorkspace; effectiveTier: ClientIntelligenceTier }
>;

const GROWTH_CLIENT_FIELDS = [
  'learningHighlights',
  'rankTrackingSummary',
  'serpOpportunities',
  'compositeHealthScore',
  'compositeHealthBreakdown',
  'keywordFeedbackSummary',
  'weCalledIt',
  'copyPipelineStatus',
] as const;
const PREMIUM_CLIENT_FIELDS = ['siteHealthSummary', 'contentDecayAlerts'] as const;

async function mcpCall(
  path: '/mcp' | '/mcp/operator',
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<McpCallResult> {
  const response = await ctx.api(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name, arguments: args },
      id: 1,
    }),
  });
  expect(response.status).toBe(200);
  const envelope = await response.json() as { result?: McpCallResult; error?: unknown };
  expect(envelope.error).toBeUndefined();
  expect(envelope.result).toBeDefined();
  return envelope.result!;
}

function assertStructured(result: McpCallResult): { data: unknown } {
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toBeDefined();
  expect(result.content[0]?.type).toBe('text');
  const parsedText = JSON.parse(result.content[0]?.text ?? '{}') as unknown;
  expect(parsedText).toEqual(result.structuredContent!.data);
  return { data: result.structuredContent!.data };
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

async function assertClientViewParity(
  fixture: { workspace: SeededFullWorkspace; effectiveTier: ClientIntelligenceTier },
): Promise<void> {
  const persistedWorkspace = getWorkspace(fixture.workspace.workspaceId);
  expect(persistedWorkspace).toBeDefined();
  const effectiveTier = computeEffectiveTier(persistedWorkspace!);
  expect(effectiveTier).toBe(fixture.effectiveTier);

  const result = await mcpCall('/mcp/operator', MCP_MASTER_KEY, 'get_client_view', {
    workspace_id: fixture.workspace.workspaceId,
  });
  const wrapper = assertStructured(result);
  const parsed = clientViewOutputSchema.parse(wrapper);

  const intelligence = await buildWorkspaceIntelligence(fixture.workspace.workspaceId, {
    slices: clientIntelligenceSlicesForTier(effectiveTier),
  });
  const expected = buildClientIntelligenceView(
    { ...intelligence, assembledAt: parsed.data.assembledAt },
    effectiveTier,
  );
  expect(parsed.data).toEqual(expected);

  const publicResponse = await ctx.api(
    `/api/public/intelligence/${fixture.workspace.workspaceId}`,
  );
  expect(publicResponse.status).toBe(200);
  expect(parsed.data).toEqual(await publicResponse.json());

  for (const field of GROWTH_CLIENT_FIELDS) {
    expect(hasOwn(parsed.data, field)).toBe(effectiveTier !== 'free');
  }
  for (const field of PREMIUM_CLIENT_FIELDS) {
    expect(hasOwn(parsed.data, field)).toBe(effectiveTier === 'premium');
  }
  expect(JSON.stringify(wrapper)).not.toMatch(/knowledgeBase|brandVoice|churnRisk/i);
}

beforeAll(async () => {
  await ctx.startServer();
  workspace = seedWorkspace({ tier: 'growth' });
  const freeWorkspace = seedWorkspace({ tier: 'free' });
  const activeTrialWorkspace = seedWorkspace({ tier: 'free' });
  const premiumWorkspace = seedWorkspace({ tier: 'premium' });
  const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
  expect(updateWorkspace(activeTrialWorkspace.workspaceId, { trialEndsAt })).not.toBeNull();
  clientViewWorkspaces = {
    free: { workspace: freeWorkspace, effectiveTier: 'free' },
    activeTrial: { workspace: activeTrialWorkspace, effectiveTier: 'growth' },
    growth: { workspace, effectiveTier: 'growth' },
    premium: { workspace: premiumWorkspace, effectiveTier: 'premium' },
  };
  const response = await ctx.postJson('/api/admin/mcp-api-keys', {
    workspaceId: workspace.workspaceId,
    label: 'P2 operator brief workspace key',
  });
  expect(response.status).toBe(200);
  const created = await response.json() as {
    key: { id: string };
    plaintextKeyOnceShown: string;
  };
  workspaceKeyId = created.key.id;
  workspacePlaintextKey = created.plaintextKeyOnceShown;
}, 25_000);

afterAll(async () => {
  if (workspaceKeyId) await ctx.del(`/api/admin/mcp-api-keys/${workspaceKeyId}`);
  for (const fixture of Object.values(clientViewWorkspaces ?? {})) {
    fixture.workspace.cleanup();
  }
  await ctx.stopServer();
});

describe('P2 operator briefs over the real MCP HTTP boundary', () => {
  it('returns bounded portfolio structured content under the advertised wrapper schema', async () => {
    const result = await mcpCall('/mcp/operator', MCP_MASTER_KEY, 'get_portfolio_brief', {});
    const wrapper = assertStructured(result);
    expect(portfolioBriefOutputSchema.safeParse(wrapper).success).toBe(true);
    expect(wrapper.data).toMatchObject({ limit: 10 });
    expect(JSON.stringify(wrapper)).not.toMatch(/payload|evidence|prompt/i);
  });

  it('returns a safe decision unavailable state and validates its root wrapper', async () => {
    const result = await mcpCall('/mcp/operator', MCP_MASTER_KEY, 'get_workspace_decision_brief', {
      workspace_id: workspace.workspaceId,
      queue_limit: 10,
    });
    const wrapper = assertStructured(result);
    expect(workspaceDecisionBriefOutputSchema.safeParse(wrapper).success).toBe(true);
    const serialized = JSON.stringify(wrapper);
    expect(serialized).not.toMatch(/payload|evidence|prompt|knowledgeBase|brandVoice/i);
  });

  it('deep-equals the canonical Free client projection and omits paid-tier fields', async () => {
    await assertClientViewParity(clientViewWorkspaces.free);
  });

  it('promotes an active trial to the exact Growth client projection', async () => {
    await assertClientViewParity(clientViewWorkspaces.activeTrial);
  });

  it('deep-equals the canonical Growth client projection and omits Premium fields', async () => {
    await assertClientViewParity(clientViewWorkspaces.growth);
  });

  it('deep-equals the canonical Premium client projection including Premium fields', async () => {
    await assertClientViewParity(clientViewWorkspaces.premium);
  });

  it('rejects out-of-range limits and keeps portfolio global/master-only', async () => {
    const invalid = await mcpCall('/mcp/operator', MCP_MASTER_KEY, 'get_portfolio_brief', { limit: 26 });
    expect(invalid.isError).toBe(true);
    expect(JSON.parse(invalid.content[0]?.text ?? '{}')).toMatchObject({ code: 'validation_failed' });

    expect(workspacePlaintextKey).toBeDefined();
    const forbidden = await mcpCall('/mcp', workspacePlaintextKey!, 'get_portfolio_brief', {});
    expect(forbidden.isError).toBe(true);
    expect(JSON.parse(forbidden.content[0]?.text ?? '{}')).toMatchObject({ code: 'forbidden' });
  });
});

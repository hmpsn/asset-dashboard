/**
 * Client-boundary regression coverage for action-catalog visibility.
 *
 * A `voice_calibrated` outcome is a durable internal workflow milestone. Even if
 * it is scored as a strong win, it must not become a client learning, a "we
 * called it" proof point, or public-chat grounding. A catalog-visible outcome
 * remains available through both client seams.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';

const aiCapture = vi.hoisted(() => ({
  promptsByWorkspace: new Map<string, string>(),
}));

vi.mock('../../server/ai.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/ai.js')>();
  return {
    ...original,
    callAI: vi.fn(async (opts: { operation?: string; system?: string; workspaceId?: string }) => {
      if (opts.operation === 'client-search-chat' && opts.workspaceId) {
        aiCapture.promptsByWorkspace.set(opts.workspaceId, opts.system ?? '');
      }
      return {
        text: 'Here is the grounded outcome summary.',
        tokens: { prompt: 0, completion: 0, total: 0 },
      };
    }),
  };
});

vi.mock('../../server/email.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/email.js')>();
  return { ...original, notifyTeamClientSignal: vi.fn() };
});

import db from '../../server/db/index.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { signAdminToken } from '../../server/middleware.js';
import { buildWorkspaceIntelligence } from '../../server/workspace-intelligence.js';
import { buildSeoPromptContext } from '../../server/intelligence/generation-context-builders.js';

let server: http.Server | undefined;
let baseUrl = '';
let hiddenOnlyWorkspace: SeededFullWorkspace;
let mixedWorkspace: SeededFullWorkspace;
let historicalWorkspace: SeededFullWorkspace;
let adminToken = '';
const originalOpenAiKey = process.env.OPENAI_API_KEY;

const hiddenOnlyPath = `/internal-voice-proof-${randomUUID()}`;
const mixedHiddenPath = `/mixed-internal-voice-proof-${randomUUID()}`;
const historicalVisiblePath = `/historical-visible-proof-${randomUUID()}`;
const visiblePaths = Array.from(
  { length: 3 },
  (_, index) => `/visible-meta-loss-${index}-${randomUUID()}`,
);

function seedScoredOutcome(
  workspaceId: string,
  actionType: string,
  pageUrl: string,
  score: 'strong_win' | 'loss',
): void {
  const actionId = `action-${randomUUID()}`;
  db.prepare(`
    INSERT INTO tracked_actions
      (id, workspace_id, action_type, source_type, source_id, page_url, target_keyword,
       baseline_snapshot, trailing_history, attribution, measurement_window,
       measurement_complete, source_flag, baseline_confidence, context, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 'platform_executed', 90, 1, 'live', 'exact', ?, datetime('now'), datetime('now'))
  `).run(
    actionId,
    workspaceId,
    actionType,
    'client-visibility-regression',
    `source-${randomUUID()}`,
    pageUrl,
    JSON.stringify({ captured_at: '2026-01-01T00:00:00.000Z', clicks: 10 }),
    JSON.stringify({ metric: 'clicks', dataPoints: [] }),
    JSON.stringify({ notes: 'Client visibility regression fixture' }),
  );

  db.prepare(`
    INSERT INTO action_outcomes
      (id, action_id, checkpoint_days, metrics_snapshot, score, early_signal,
       delta_summary, competitor_context, measured_at)
    VALUES (?, ?, 90, ?, ?, NULL, ?, '{}', datetime('now'))
  `).run(
    `outcome-${randomUUID()}`,
    actionId,
    JSON.stringify({
      captured_at: '2026-04-01T00:00:00.000Z',
      clicks: score === 'strong_win' ? 25 : 5,
    }),
    score,
    JSON.stringify({
      primary_metric: 'clicks',
      baseline_value: 10,
      current_value: score === 'strong_win' ? 25 : 5,
      delta_absolute: score === 'strong_win' ? 15 : -5,
      delta_percent: score === 'strong_win' ? 150 : -50,
      direction: score === 'strong_win' ? 'improved' : 'declined',
    }),
  );
}

async function getPublicIntelligence(workspaceId: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}/api/public/intelligence/${workspaceId}`, {
    headers: { 'x-auth-token': adminToken },
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, unknown>>;
}

async function getClientChatPrompt(workspaceId: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/public/search-chat/${workspaceId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-auth-token': adminToken },
    body: JSON.stringify({
      question: 'Which measured outcomes have worked?',
      betaMode: true,
    }),
  });
  expect(response.status).toBe(200);
  return aiCapture.promptsByWorkspace.get(workspaceId) ?? '';
}

beforeAll(async () => {
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'client-hidden-learning-test-key';
  adminToken = signAdminToken();

  const { createApp } = await import('../../server/app.js');
  server = http.createServer(createApp());
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  hiddenOnlyWorkspace = seedWorkspace({ tier: 'growth', clientPassword: '' });
  mixedWorkspace = seedWorkspace({ tier: 'growth', clientPassword: '' });
  historicalWorkspace = seedWorkspace({ tier: 'growth', clientPassword: '' });

  seedScoredOutcome(hiddenOnlyWorkspace.workspaceId, 'voice_calibrated', hiddenOnlyPath, 'strong_win');
  seedScoredOutcome(mixedWorkspace.workspaceId, 'voice_calibrated', mixedHiddenPath, 'strong_win');
  for (const visiblePath of visiblePaths) {
    seedScoredOutcome(mixedWorkspace.workspaceId, 'meta_updated', visiblePath, 'loss');
  }
  // Unknown historical values fail open for compatibility. Explicit
  // `clientVisible: false` catalog entries are the only hidden values.
  seedScoredOutcome(
    historicalWorkspace.workspaceId,
    'historical_custom_action',
    historicalVisiblePath,
    'strong_win',
  );
}, 40_000);

afterAll(async () => {
  for (const workspace of [hiddenOnlyWorkspace, mixedWorkspace, historicalWorkspace]) {
    if (!workspace) continue;
    db.prepare('DELETE FROM workspace_learnings WHERE workspace_id = ?').run(workspace.workspaceId);
    db.prepare(`
      DELETE FROM action_outcomes
      WHERE action_id IN (SELECT id FROM tracked_actions WHERE workspace_id = ?)
    `).run(workspace.workspaceId);
    db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(workspace.workspaceId);
    workspace.cleanup();
  }

  if (server) {
    await new Promise<void>((resolve, reject) => server!.close(error => (error ? reject(error) : resolve())));
  }

  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
});

describe('client-hidden outcome learning boundary', () => {
  it('returns null learningHighlights for hidden-only history and omits it from client chat', async () => {
    const intelligence = await getPublicIntelligence(hiddenOnlyWorkspace.workspaceId);

    // Null means "no client-eligible learning yet". A synthetic 0% would wrongly
    // imply the private strong win was a visible loss/no-win denominator.
    expect(intelligence.learningHighlights).toBeNull();
    expect(intelligence.weCalledIt).toEqual([]);
    const serialized = JSON.stringify(intelligence).toLowerCase();
    expect(serialized).not.toContain(hiddenOnlyPath.toLowerCase());
    expect(serialized).not.toContain('voice calibration');
    expect(serialized).not.toContain('voice_calibrated');

    const clientContext = await buildSeoPromptContext(hiddenOnlyWorkspace.workspaceId, {
      slices: ['learnings'],
      audience: 'client',
    });
    expect(clientContext.learningsAvailability).toBe('no_data');
    expect(clientContext.intelligence.learnings).toBeUndefined();
    expect(clientContext.seoPromptContext).not.toContain('## Outcome Learnings');

    const prompt = await getClientChatPrompt(hiddenOnlyWorkspace.workspaceId);
    expect(prompt.toLowerCase()).not.toContain(hiddenOnlyPath.toLowerCase());
    expect(prompt.toLowerCase()).not.toContain('voice calibration');
    expect(prompt.toLowerCase()).not.toContain('voice_calibrated');
    expect(prompt).not.toContain('## Outcome Learnings');
  });

  it('keeps admin evidence intact while projecting only visible losses to JSON and chat grounding', async () => {
    const internal = await buildWorkspaceIntelligence(mixedWorkspace.workspaceId, {
      slices: ['learnings'],
    });

    // Internal/admin consumers retain the complete ledger: three visible losses
    // plus the internal voice strong win. Only the audience projection is scrubbed.
    expect(internal.learnings?.summary?.totalScoredActions).toBe(4);
    expect(internal.learnings?.overallWinRate).toBeCloseTo(0.25, 5);
    expect(internal.learnings?.weCalledIt).toEqual([
      expect.objectContaining({ pageUrl: mixedHiddenPath, score: 'strong_win' }),
    ]);
    expect(JSON.stringify(internal.learnings).toLowerCase()).toContain('voice calibration');
    expect(internal.learnings?.clientProjection?.summary?.totalScoredActions).toBe(3);
    expect(internal.learnings?.clientProjection?.overallWinRate).toBe(0);
    expect(internal.learnings?.clientProjection?.weCalledIt).toEqual([]);
    expect(JSON.stringify(internal.learnings?.clientProjection).toLowerCase()).not.toContain('voice calibration');
    expect(JSON.stringify(internal.learnings?.clientProjection).toLowerCase()).not.toContain('voice_calibrated');

    const clientContext = await buildSeoPromptContext(mixedWorkspace.workspaceId, {
      slices: ['learnings'],
      audience: 'client',
    });
    expect(clientContext.learningsAvailability).toBe('ready');
    expect(clientContext.intelligence.learnings?.summary?.totalScoredActions).toBe(3);
    expect(clientContext.seoPromptContext).toContain('## Outcome Learnings (3 tracked outcomes');
    expect(clientContext.seoPromptContext.toLowerCase()).not.toContain('voice calibration');
    expect(clientContext.seoPromptContext.toLowerCase()).not.toContain('voice_calibrated');

    const intelligence = await getPublicIntelligence(mixedWorkspace.workspaceId);

    expect(intelligence.learningHighlights).toEqual({
      overallWinRate: 0,
      topActionType: 'meta_updated',
      recentWins: 0,
    });
    expect(intelligence.weCalledIt).toEqual([]);
    const serialized = JSON.stringify(intelligence).toLowerCase();
    expect(serialized).toContain('meta_updated');
    expect(serialized).not.toContain(mixedHiddenPath.toLowerCase());
    expect(serialized).not.toContain('voice calibration');
    expect(serialized).not.toContain('voice_calibrated');

    const prompt = await getClientChatPrompt(mixedWorkspace.workspaceId);
    expect(prompt.toLowerCase()).not.toContain(mixedHiddenPath.toLowerCase());
    expect(prompt.toLowerCase()).not.toContain('voice calibration');
    expect(prompt.toLowerCase()).not.toContain('voice_calibrated');
    expect(prompt).toContain('## Outcome Learnings (3 tracked outcomes');
    expect(prompt).toContain('meta_updated: 0% (3 actions)');
    expect(prompt).not.toContain('## Outcome Learnings (4 tracked outcomes');
  });

  it('keeps an unknown historical action client-visible for compatibility', async () => {
    const intelligence = await getPublicIntelligence(historicalWorkspace.workspaceId);

    expect(intelligence.learningHighlights).toEqual({
      overallWinRate: 1,
      topActionType: null,
      recentWins: 1,
    });
    expect(intelligence.weCalledIt).toEqual([
      expect.objectContaining({
        pageUrl: historicalVisiblePath,
        score: 'strong_win',
      }),
    ]);

    const prompt = await getClientChatPrompt(historicalWorkspace.workspaceId);
    expect(prompt).toContain(historicalVisiblePath);
    expect(prompt).toContain('## Outcome Learnings (1 tracked outcomes');
  });
});

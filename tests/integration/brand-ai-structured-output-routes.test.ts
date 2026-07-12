import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const aiState = vi.hoisted(() => ({
  callAI: vi.fn(),
  callCreativeAI: vi.fn(),
}));

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: unknown }>,
  throwOnBroadcast: false,
}));

const freshnessState = vi.hoisted(() => ({
  invalidateIntelligenceCache: vi.fn(),
  throwOnInvalidate: false,
}));

const activityState = vi.hoisted(() => ({
  attempts: 0,
  throwOnAdd: false,
}));

const usageState = vi.hoisted(() => ({
  incrementIfAllowed: vi.fn(),
  decrementUsage: vi.fn(),
}));

vi.mock('../../server/ai.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../server/ai.js')>(),
  callAI: aiState.callAI,
}));

vi.mock('../../server/content-posts-ai.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../server/content-posts-ai.js')>(),
  callCreativeAI: aiState.callCreativeAI,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: unknown) => {
    broadcastState.calls.push({ workspaceId, event, payload });
    if (broadcastState.throwOnBroadcast) throw new Error('broadcast unavailable');
  }),
}));

vi.mock('../../server/intelligence/cache-invalidation.js', () => ({
  invalidateIntelligenceCache: (...args: unknown[]) => {
    freshnessState.invalidateIntelligenceCache(...args);
    if (freshnessState.throwOnInvalidate) throw new Error('cache invalidation unavailable');
  },
}));

vi.mock('../../server/activity-log.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/activity-log.js')>();
  return {
    ...actual,
    addActivity: (...args: Parameters<typeof actual.addActivity>) => {
      activityState.attempts += 1;
      if (activityState.throwOnAdd) throw new Error('activity log unavailable');
      return actual.addActivity(...args);
    },
  };
});

vi.mock('../../server/usage-tracking.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/usage-tracking.js')>();
  return {
    ...actual,
    incrementIfAllowed: (...args: Parameters<typeof actual.incrementIfAllowed>) => {
      usageState.incrementIfAllowed(...args);
      return actual.incrementIfAllowed(...args);
    },
    decrementUsage: (...args: Parameters<typeof actual.decrementUsage>) => {
      usageState.decrementUsage(...args);
      return actual.decrementUsage(...args);
    },
  };
});

import db from '../../server/db/index.js';
import { listActivity } from '../../server/activity-log.js';
import {
  createBrandscript,
  getBrandscript,
  listBrandscripts,
  updateBrandscriptSections,
} from '../../server/brandscript.js';
import { getDeliverable } from '../../server/brand-identity.js';
import { addSource, listSources } from '../../server/discovery-ingestion.js';
import { getUsageCount } from '../../server/usage-tracking.js';
import { createVoiceProfile, listCalibrationSessions } from '../../server/voice-calibration.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { WS_EVENTS } from '../../server/ws-events.js';

let server: http.Server | undefined;
let baseUrl = '';
const cleanups: Array<() => void> = [];

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function growthWorkspace(): string {
  const seeded = seedWorkspace({ tier: 'growth' });
  cleanups.push(seeded.cleanup);
  return seeded.workspaceId;
}

function activityCount(workspaceId: string, type: string): number {
  return listActivity(workspaceId, 100).filter(activity => activity.type === type).length;
}

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  server = http.createServer(createApp());
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 40_000);

beforeEach(() => {
  vi.clearAllMocks();
  aiState.callAI.mockReset();
  aiState.callCreativeAI.mockReset();
  broadcastState.calls = [];
  broadcastState.throwOnBroadcast = false;
  freshnessState.throwOnInvalidate = false;
  activityState.attempts = 0;
  activityState.throwOnAdd = false;
});

afterAll(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  if (server) {
    await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  }
});

describe('Brand Engine AI routes fail closed on provider and structured-output errors', () => {
  it('keeps a discovery source retryable and emits no success effects when the provider throws', async () => {
    const workspaceId = growthWorkspace();
    const source = addSource(workspaceId, 'transcript.txt', 'transcript', 'Customer interview content');
    const activityBefore = activityCount(workspaceId, 'discovery_processed');
    aiState.callAI.mockRejectedValueOnce(new Error('provider unavailable'));

    const response = await postJson(`/api/discovery/${workspaceId}/sources/${source.id}/process`, {});

    expect(response.status).toBe(500);
    expect(listSources(workspaceId).find(item => item.id === source.id)?.processedAt).toBeUndefined();
    expect(activityCount(workspaceId, 'discovery_processed')).toBe(activityBefore);
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.DISCOVERY_UPDATED)).toBe(false);
    expect(freshnessState.invalidateIntelligenceCache).not.toHaveBeenCalledWith(workspaceId);
  });

  it('keeps a discovery source retryable when the provider returns a wrong JSON shape', async () => {
    const workspaceId = growthWorkspace();
    const source = addSource(workspaceId, 'brand.txt', 'brand_doc', 'Brand document content');
    aiState.callAI.mockResolvedValueOnce({ text: '{}', tokens: { prompt: 1, completion: 1, total: 2 } });

    const response = await postJson(`/api/discovery/${workspaceId}/sources/${source.id}/process`, {});

    expect(response.status).toBe(500);
    expect(listSources(workspaceId).find(item => item.id === source.id)?.processedAt).toBeUndefined();
    expect(activityCount(workspaceId, 'discovery_processed')).toBe(0);
  });

  it('preserves intentional empty discovery success when the envelope is valid', async () => {
    const workspaceId = growthWorkspace();
    const source = addSource(workspaceId, 'sparse.txt', 'brand_doc', 'No reusable signal here');
    aiState.callAI.mockResolvedValueOnce({
      text: JSON.stringify({ extractions: [] }),
      tokens: { prompt: 1, completion: 1, total: 2 },
    });

    const response = await postJson(`/api/discovery/${workspaceId}/sources/${source.id}/process`, {});

    expect(response.status).toBe(200);
    expect(listSources(workspaceId).find(item => item.id === source.id)?.processedAt).toBeTruthy();
    expect(activityCount(workspaceId, 'discovery_processed')).toBe(1);
  });

  it('does not create an imported brandscript or consume quota on invalid output', async () => {
    const workspaceId = growthWorkspace();
    const scriptsBefore = listBrandscripts(workspaceId).length;
    const usageBefore = getUsageCount(workspaceId, 'brandscript_generations');
    const activityBefore = activityCount(workspaceId, 'brandscript_imported');
    aiState.callAI.mockResolvedValueOnce({ text: '{}', tokens: { prompt: 1, completion: 1, total: 2 } });

    const response = await postJson(`/api/brandscripts/${workspaceId}/import`, {
      name: 'Invalid import',
      rawText: 'A real brand document with enough source content to process.',
    });

    expect(response.status).toBe(500);
    expect(listBrandscripts(workspaceId)).toHaveLength(scriptsBefore);
    expect(getUsageCount(workspaceId, 'brandscript_generations')).toBe(usageBefore);
    expect(activityCount(workspaceId, 'brandscript_imported')).toBe(activityBefore);
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.BRANDSCRIPT_UPDATED)).toBe(false);
  });

  it('returns 404 before quota or AI work when importing into a missing workspace', async () => {
    const missingWorkspaceId = `missing-brand-${Date.now()}`;

    const response = await postJson(`/api/brandscripts/${missingWorkspaceId}/import`, {
      name: 'Missing workspace import',
      rawText: 'A real brand document that must never reach the provider.',
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Workspace not found' });
    expect(usageState.incrementIfAllowed).not.toHaveBeenCalled();
    expect(aiState.callAI).not.toHaveBeenCalled();
    expect(getUsageCount(missingWorkspaceId, 'brandscript_generations')).toBe(0);
  });

  it('keeps a durably imported brandscript successful when every post-commit effect fails', async () => {
    const workspaceId = growthWorkspace();
    const scriptsBefore = listBrandscripts(workspaceId).length;
    const usageBefore = getUsageCount(workspaceId, 'brandscript_generations');
    aiState.callAI.mockResolvedValueOnce({
      text: JSON.stringify({
        frameworkType: 'custom',
        sections: [{ title: 'Promise', purpose: 'State the promise.', content: 'A clear promise.' }],
      }),
      tokens: { prompt: 1, completion: 1, total: 2 },
    });
    activityState.throwOnAdd = true;
    broadcastState.throwOnBroadcast = true;
    freshnessState.throwOnInvalidate = true;

    const response = await postJson(`/api/brandscripts/${workspaceId}/import`, {
      name: 'Durable import',
      rawText: 'A complete source document.',
    });
    const body = await response.json() as { id?: string };

    expect(response.status).toBe(200);
    expect(body.id).toBeTruthy();
    expect(listBrandscripts(workspaceId)).toHaveLength(scriptsBefore + 1);
    expect(getUsageCount(workspaceId, 'brandscript_generations')).toBe(usageBefore + 1);
    expect(usageState.decrementUsage).not.toHaveBeenCalled();
    expect(activityState.attempts).toBe(1);
    expect(broadcastState.calls).toHaveLength(1);
    expect(freshnessState.invalidateIntelligenceCache).toHaveBeenCalledWith(workspaceId);
  });

  it('requires completion output for every empty title before changing any section', async () => {
    const workspaceId = growthWorkspace();
    const brandscript = createBrandscript(workspaceId, 'Incomplete completion', 'custom', [
      { title: 'Problem', content: '' },
      { title: 'Plan', content: '' },
    ]);
    const usageBefore = getUsageCount(workspaceId, 'brandscript_generations');
    const activityBefore = activityCount(workspaceId, 'brandscript_completed');
    aiState.callCreativeAI.mockResolvedValueOnce(JSON.stringify({
      sections: [{ title: 'Problem', content: 'The problem is clear.' }],
    }));

    const response = await postJson(`/api/brandscripts/${workspaceId}/${brandscript.id}/complete`, {});

    expect(response.status).toBe(500);
    expect(getBrandscript(workspaceId, brandscript.id)?.sections.map(section => section.content ?? ''))
      .toEqual(['', '']);
    expect(getUsageCount(workspaceId, 'brandscript_generations')).toBe(usageBefore);
    expect(activityCount(workspaceId, 'brandscript_completed')).toBe(activityBefore);
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.BRANDSCRIPT_UPDATED)).toBe(false);
  });

  it('keeps durable completion successful when every post-commit effect fails', async () => {
    const workspaceId = growthWorkspace();
    const brandscript = createBrandscript(workspaceId, 'Durable completion', 'custom', [
      { title: 'Problem', content: '' },
    ]);
    const usageBefore = getUsageCount(workspaceId, 'brandscript_generations');
    aiState.callCreativeAI.mockResolvedValueOnce(JSON.stringify({
      sections: [{ title: 'Problem', content: 'The persisted AI draft.' }],
    }));
    activityState.throwOnAdd = true;
    broadcastState.throwOnBroadcast = true;
    freshnessState.throwOnInvalidate = true;

    const response = await postJson(`/api/brandscripts/${workspaceId}/${brandscript.id}/complete`, {});

    expect(response.status).toBe(200);
    expect(getBrandscript(workspaceId, brandscript.id)?.sections[0].content).toBe('The persisted AI draft.');
    expect(getUsageCount(workspaceId, 'brandscript_generations')).toBe(usageBefore + 1);
    expect(usageState.decrementUsage).not.toHaveBeenCalled();
    expect(activityState.attempts).toBe(1);
    expect(broadcastState.calls).toHaveLength(1);
    expect(freshnessState.invalidateIntelligenceCache).toHaveBeenCalledWith(workspaceId);
  });

  it('maps repeated completion titles by the requested section order', async () => {
    const workspaceId = growthWorkspace();
    const brandscript = createBrandscript(workspaceId, 'Repeated completion titles', 'custom', [
      { title: 'Problem', purpose: 'Name the external problem.', content: '' },
      { title: 'Problem', purpose: 'Name the internal problem.', content: '' },
    ]);
    aiState.callCreativeAI.mockResolvedValueOnce(JSON.stringify({
      sections: [
        { title: 'Problem', content: 'The external problem.' },
        { title: 'Problem', content: 'The internal problem.' },
      ],
    }));

    const response = await postJson(`/api/brandscripts/${workspaceId}/${brandscript.id}/complete`, {});

    expect(response.status).toBe(200);
    expect(getBrandscript(workspaceId, brandscript.id)?.sections.map(section => section.content))
      .toEqual(['The external problem.', 'The internal problem.']);
    expect(aiState.callCreativeAI).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'brandscript-complete',
      userPrompt: expect.stringMatching(/same order/i),
    }));
  });

  it('does not reserve quota or emit completion effects when every section is already filled', async () => {
    const workspaceId = growthWorkspace();
    const brandscript = createBrandscript(workspaceId, 'Already complete', 'custom', [
      { title: 'Problem', content: 'The customer has a costly problem.' },
      { title: 'Plan', content: 'Follow the three-step plan.' },
    ]);
    const usageBefore = getUsageCount(workspaceId, 'brandscript_generations');
    const activityBefore = activityCount(workspaceId, 'brandscript_completed');

    const response = await postJson(`/api/brandscripts/${workspaceId}/${brandscript.id}/complete`, {});
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.id).toBe(brandscript.id);
    expect(body).not.toHaveProperty('brandscript');
    expect(body).not.toHaveProperty('didGenerate');
    expect(aiState.callCreativeAI).not.toHaveBeenCalled();
    expect(usageState.incrementIfAllowed).not.toHaveBeenCalled();
    expect(usageState.decrementUsage).not.toHaveBeenCalled();
    expect(getUsageCount(workspaceId, 'brandscript_generations')).toBe(usageBefore);
    expect(activityCount(workspaceId, 'brandscript_completed')).toBe(activityBefore);
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.BRANDSCRIPT_UPDATED)).toBe(false);
    expect(freshnessState.invalidateIntelligenceCache).not.toHaveBeenCalledWith(workspaceId);
  });

  it('merges AI drafts by original section id without undoing concurrent section changes', async () => {
    const workspaceId = growthWorkspace();
    const brandscript = createBrandscript(workspaceId, 'Concurrent completion', 'custom', [
      { title: 'Problem', content: '' },
      { title: 'Plan', content: '' },
      { title: 'Success', purpose: 'Describe the desired outcome.', content: '' },
      { title: 'Guide', purpose: 'Explain how the business guides customers.', content: '' },
      { title: 'Proof', content: 'Existing proof stays.' },
    ]);
    const [problem, plan, success, guide, proof] = brandscript.sections;
    let resolveCompletion!: (output: string) => void;
    aiState.callCreativeAI.mockImplementationOnce(() => new Promise<string>((resolve) => {
      resolveCompletion = resolve;
    }));

    const responsePromise = postJson(`/api/brandscripts/${workspaceId}/${brandscript.id}/complete`, {});
    await vi.waitFor(() => expect(aiState.callCreativeAI).toHaveBeenCalledTimes(1));

    const concurrent = updateBrandscriptSections(workspaceId, brandscript.id, [
      { ...success, content: '' },
      {
        ...guide,
        title: 'Authority',
        purpose: 'Show the evidence that establishes authority.',
        content: '',
      },
      { ...proof, content: 'Existing proof stays.' },
      { ...problem, content: 'A strategist wrote this while AI was running.' },
      { title: 'New section', purpose: 'Added while AI was running.', content: '' },
    ]);
    expect(concurrent).not.toBeNull();
    const concurrentIds = concurrent!.sections.map(section => section.id);
    const futureConcurrentUpdatedAt = '2031-07-11T12:00:00.000Z';
    db.prepare('UPDATE brandscripts SET updated_at = ? WHERE id = ? AND workspace_id = ?')
      .run(futureConcurrentUpdatedAt, brandscript.id, workspaceId);

    resolveCompletion(JSON.stringify({
      sections: [
        { title: 'Problem', content: 'AI problem draft.' },
        { title: 'Plan', content: 'AI plan draft.' },
        { title: 'Success', content: 'AI success draft.' },
        { title: 'Guide', content: 'AI guide draft for the old purpose.' },
      ],
    }));
    const response = await responsePromise;

    expect(response.status).toBe(200);
    const stored = getBrandscript(workspaceId, brandscript.id);
    expect(stored?.sections.map(section => section.id)).toEqual(concurrentIds);
    expect(stored?.sections.map(section => section.title)).toEqual([
      'Success',
      'Authority',
      'Proof',
      'Problem',
      'New section',
    ]);
    expect(stored?.sections.map(section => section.content ?? '')).toEqual([
      'AI success draft.',
      '',
      'Existing proof stays.',
      'A strategist wrote this while AI was running.',
      '',
    ]);
    expect(stored?.sections.some(section => section.id === plan.id)).toBe(false);
    expect(stored?.updatedAt).toBe(futureConcurrentUpdatedAt);
    expect(activityCount(workspaceId, 'brandscript_completed')).toBe(1);
    expect(broadcastState.calls.filter(call => call.event === WS_EVENTS.BRANDSCRIPT_UPDATED)).toHaveLength(1);
    expect(freshnessState.invalidateIntelligenceCache).toHaveBeenCalledWith(workspaceId);
  });

  it('returns a charged conflict without success effects when every AI target changed', async () => {
    const workspaceId = growthWorkspace();
    const brandscript = createBrandscript(workspaceId, 'Fully conflicted completion', 'custom', [
      { title: 'Problem', purpose: 'Name the customer problem.', content: '' },
      { title: 'Plan', purpose: 'Describe the path forward.', content: '' },
    ]);
    const [problem] = brandscript.sections;
    const usageBefore = getUsageCount(workspaceId, 'brandscript_generations');
    const activityBefore = activityCount(workspaceId, 'brandscript_completed');
    let resolveCompletion!: (output: string) => void;
    aiState.callCreativeAI.mockImplementationOnce(() => new Promise<string>((resolve) => {
      resolveCompletion = resolve;
    }));

    const responsePromise = postJson(`/api/brandscripts/${workspaceId}/${brandscript.id}/complete`, {});
    await vi.waitFor(() => expect(aiState.callCreativeAI).toHaveBeenCalledTimes(1));

    const concurrent = updateBrandscriptSections(workspaceId, brandscript.id, [
      { ...problem, content: 'A strategist completed this while AI was running.' },
      { title: 'New direction', purpose: 'Added while AI was running.', content: '' },
    ]);
    expect(concurrent).not.toBeNull();

    resolveCompletion(JSON.stringify({
      sections: [
        { title: 'Problem', content: 'AI problem draft.' },
        { title: 'Plan', content: 'AI plan draft.' },
      ],
    }));
    const response = await responsePromise;
    const body = await response.json() as { error?: string; code?: string };

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: 'Brandscript changed while AI was working. Your edits were preserved; review them before retrying.',
      code: 'brandscript_changed',
    });
    expect(getBrandscript(workspaceId, brandscript.id)?.sections.map(section => ({
      title: section.title,
      content: section.content ?? '',
    }))).toEqual([
      { title: 'Problem', content: 'A strategist completed this while AI was running.' },
      { title: 'New direction', content: '' },
    ]);
    expect(getUsageCount(workspaceId, 'brandscript_generations')).toBe(usageBefore + 1);
    expect(usageState.decrementUsage).not.toHaveBeenCalled();
    expect(activityCount(workspaceId, 'brandscript_completed')).toBe(activityBefore);
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.BRANDSCRIPT_UPDATED)).toBe(false);
    expect(freshnessState.invalidateIntelligenceCache).not.toHaveBeenCalledWith(workspaceId);
  });

  it('keeps durable identity generation and refinement successful when post-commit effects fail', async () => {
    const workspaceId = growthWorkspace();
    const usageBefore = getUsageCount(workspaceId, 'brandscript_generations');
    aiState.callCreativeAI
      .mockResolvedValueOnce('Generated mission content.')
      .mockResolvedValueOnce('Refined mission content.');
    activityState.throwOnAdd = true;
    broadcastState.throwOnBroadcast = true;
    freshnessState.throwOnInvalidate = true;

    const generateResponse = await postJson(`/api/brand-identity/${workspaceId}/generate`, {
      deliverableType: 'mission',
    });
    const generated = await generateResponse.json() as { id: string };
    const refineResponse = await postJson(`/api/brand-identity/${workspaceId}/${generated.id}/refine`, {
      direction: 'Make the mission more direct.',
    });

    expect(generateResponse.status).toBe(200);
    expect(refineResponse.status).toBe(200);
    expect(getDeliverable(workspaceId, generated.id)?.content).toBe('Refined mission content.');
    expect(getDeliverable(workspaceId, generated.id)?.version).toBe(2);
    expect(getUsageCount(workspaceId, 'brandscript_generations')).toBe(usageBefore + 2);
    expect(usageState.decrementUsage).not.toHaveBeenCalled();
    expect(activityState.attempts).toBe(2);
    expect(broadcastState.calls).toHaveLength(2);
    expect(freshnessState.invalidateIntelligenceCache).toHaveBeenCalledTimes(2);
  });

  it('keeps durable voice calibration and refinement successful when post-commit effects fail', async () => {
    const workspaceId = growthWorkspace();
    createVoiceProfile(workspaceId);
    const usageBefore = getUsageCount(workspaceId, 'voice_calibrations');
    aiState.callCreativeAI
      .mockResolvedValueOnce(JSON.stringify({ variations: ['One.', 'Two.', 'Three.'] }))
      .mockResolvedValueOnce(JSON.stringify({ refined: 'Refined variation.' }));
    activityState.throwOnAdd = true;
    broadcastState.throwOnBroadcast = true;
    freshnessState.throwOnInvalidate = true;

    const calibrateResponse = await postJson(`/api/voice/${workspaceId}/calibrate`, {
      promptType: 'headline',
    });
    const calibration = await calibrateResponse.json() as { id: string };
    const refineResponse = await postJson(`/api/voice/${workspaceId}/calibrate/${calibration.id}/refine`, {
      variationIndex: 0,
      direction: 'Make it more direct.',
    });

    expect(calibrateResponse.status).toBe(200);
    expect(refineResponse.status).toBe(200);
    expect(listCalibrationSessions(workspaceId)[0]?.variations.map(variation => variation.text))
      .toEqual(['One.', 'Two.', 'Three.', 'Refined variation.']);
    expect(getUsageCount(workspaceId, 'voice_calibrations')).toBe(usageBefore + 2);
    expect(usageState.decrementUsage).not.toHaveBeenCalled();
    expect(activityState.attempts).toBe(2);
    expect(broadcastState.calls).toHaveLength(2);
    expect(freshnessState.invalidateIntelligenceCache).toHaveBeenCalledTimes(2);
  });

  it('does not persist or charge for a calibration session with fewer than three variations', async () => {
    const workspaceId = growthWorkspace();
    createVoiceProfile(workspaceId);
    const usageBefore = getUsageCount(workspaceId, 'voice_calibrations');
    const activityBefore = activityCount(workspaceId, 'voice_calibrated');
    aiState.callCreativeAI.mockResolvedValueOnce(JSON.stringify({ variations: ['One.', 'Two.'] }));

    const response = await postJson(`/api/voice/${workspaceId}/calibrate`, { promptType: 'headline' });

    expect(response.status).toBe(500);
    expect(listCalibrationSessions(workspaceId)).toEqual([]);
    expect(getUsageCount(workspaceId, 'voice_calibrations')).toBe(usageBefore);
    expect(activityCount(workspaceId, 'voice_calibrated')).toBe(activityBefore);
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.VOICE_PROFILE_UPDATED)).toBe(false);
  });

  it('does not append an empty refinement or consume quota', async () => {
    const workspaceId = growthWorkspace();
    const profile = createVoiceProfile(workspaceId);
    const sessionId = `cal_route_${workspaceId.slice(-6)}`;
    db.prepare(`
      INSERT INTO voice_calibration_sessions
        (id, voice_profile_id, prompt_type, variations_json, steering_notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sessionId, profile.id, 'headline', JSON.stringify([{ text: 'Original variation.' }]), null, new Date().toISOString());
    const usageBefore = getUsageCount(workspaceId, 'voice_calibrations');
    const activityBefore = activityCount(workspaceId, 'voice_refined');
    aiState.callCreativeAI.mockResolvedValueOnce(JSON.stringify({ refined: '   ' }));

    const response = await postJson(`/api/voice/${workspaceId}/calibrate/${sessionId}/refine`, {
      variationIndex: 0,
      direction: 'Make it more direct.',
    });

    expect(response.status).toBe(500);
    expect(listCalibrationSessions(workspaceId)[0]?.variations).toEqual([{ text: 'Original variation.' }]);
    expect(getUsageCount(workspaceId, 'voice_calibrations')).toBe(usageBefore);
    expect(activityCount(workspaceId, 'voice_refined')).toBe(activityBefore);
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.VOICE_PROFILE_UPDATED)).toBe(false);
  });
});

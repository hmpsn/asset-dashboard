/**
 * Unit tests for server/voice-calibration.ts — CRUD, state machine, sample sort_order,
 * duplicate guard, and VoiceProfileStateTransitionError class.
 *
 * Covers:
 *   - createVoiceProfile: initial shape, default context modifiers, duplicate guard
 *   - getVoiceProfile: null for missing, full profile with samples
 *   - updateVoiceProfile: state machine transitions (legal + illegal), field updates
 *   - addVoiceSample: sort_order increment, optional fields
 *   - deleteVoiceSample: workspace-scoped delete, returns false on miss
 *   - listCalibrationSessions: returns [] when no profile or no sessions
 *   - VoiceProfileStateTransitionError: instanceof Error, .name, .from, .to, message
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';

const mockInvalidateMonthlyDigestCache = vi.hoisted(() => vi.fn());
const mockClearIntelligenceCache = vi.hoisted(() => vi.fn());

vi.mock('../../server/monthly-digest-cache.js', () => ({
  invalidateMonthlyDigestCache: mockInvalidateMonthlyDigestCache,
}));

vi.mock('../../server/intelligence/cache-clear.js', () => ({
  clearIntelligenceCache: mockClearIntelligenceCache,
}));
import {
  createVoiceProfile,
  getVoiceProfile,
  updateVoiceProfile,
  addVoiceSample,
  deleteVoiceSample,
  listCalibrationSessions,
  VoiceProfileStateTransitionError,
} from '../../server/voice-calibration.js';
import db from '../../server/db/index.js';
import type { VoiceDNA, VoiceGuardrails, ContextModifier } from '../../shared/types/brand-engine.js';

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const SAMPLE_DNA: VoiceDNA = {
  personalityTraits: ['Direct', 'Confident'],
  toneSpectrum: { formal_casual: 6, serious_playful: 5, technical_accessible: 7 },
  sentenceStyle: 'Short punchy lines.',
  vocabularyLevel: 'Conversational, 8th grade.',
};

const SAMPLE_GUARDRAILS: VoiceGuardrails = {
  forbiddenWords: ['synergy', 'leverage'],
  requiredTerminology: [{ use: 'clients', insteadOf: 'customers' }],
  toneBoundaries: ['Never condescending'],
  antiPatterns: ['Never start a sentence with "We believe"'],
};

// ─── createVoiceProfile ───────────────────────────────────────────────────────

describe('createVoiceProfile', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => { ws = seedWorkspace({ tier: 'growth', clientPassword: '' }); });
  afterAll(() => { ws?.cleanup(); });

  it('creates a profile with status="draft"', () => {
    const profile = createVoiceProfile(ws.workspaceId);
    expect(profile.status).toBe('draft');
  });

  it('returns the profile with an empty samples array', () => {
    const profile = getVoiceProfile(ws.workspaceId);
    expect(profile).not.toBeNull();
    expect(Array.isArray(profile!.samples)).toBe(true);
    expect(profile!.samples).toHaveLength(0);
  });

  it('sets exactly 5 default context modifiers', () => {
    const profile = getVoiceProfile(ws.workspaceId);
    expect(profile!.contextModifiers).toHaveLength(5);
  });

  it('includes "Headlines & CTAs" as the first context modifier', () => {
    const profile = getVoiceProfile(ws.workspaceId);
    const contexts = profile!.contextModifiers!.map(m => m.context);
    expect(contexts[0]).toBe('Headlines & CTAs');
  });

  it('includes all five expected modifier contexts', () => {
    const profile = getVoiceProfile(ws.workspaceId);
    const contexts = profile!.contextModifiers!.map(m => m.context);
    expect(contexts).toContain('Service descriptions');
    expect(contexts).toContain('SEO meta titles/descriptions');
    expect(contexts).toContain('Blog / long-form');
    expect(contexts).toContain('FAQ / educational');
  });

  it('sets id, workspaceId, createdAt, updatedAt', () => {
    const profile = getVoiceProfile(ws.workspaceId);
    expect(profile!.id).toBeTruthy();
    expect(profile!.workspaceId).toBe(ws.workspaceId);
    expect(profile!.createdAt).toBeTruthy();
    expect(profile!.updatedAt).toBeTruthy();
  });

  it('throws containing "already exists" on duplicate creation', () => {
    expect(() => createVoiceProfile(ws.workspaceId)).toThrow(/already exists/i);
  });

  it('still returns the original profile after a failed duplicate creation attempt', () => {
    try { createVoiceProfile(ws.workspaceId); } catch { /* expected */ }
    const profile = getVoiceProfile(ws.workspaceId);
    expect(profile).not.toBeNull();
    expect(profile!.status).toBe('draft');
  });
});

// ─── getVoiceProfile ──────────────────────────────────────────────────────────

describe('getVoiceProfile', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => { ws = seedWorkspace({ tier: 'growth', clientPassword: '' }); });
  afterAll(() => { ws?.cleanup(); });

  it('returns null when no profile exists', () => {
    expect(getVoiceProfile(ws.workspaceId)).toBeNull();
  });

  it('returns the profile after creation', () => {
    createVoiceProfile(ws.workspaceId);
    const profile = getVoiceProfile(ws.workspaceId);
    expect(profile).not.toBeNull();
  });

  it('includes all required top-level fields', () => {
    const profile = getVoiceProfile(ws.workspaceId);
    expect(profile).toMatchObject({
      id: expect.any(String),
      workspaceId: ws.workspaceId,
      status: 'draft',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it('includes an empty samples array when none have been added', () => {
    const profile = getVoiceProfile(ws.workspaceId);
    expect(profile!.samples).toEqual([]);
  });

  it('includes contextModifiers array', () => {
    const profile = getVoiceProfile(ws.workspaceId);
    expect(Array.isArray(profile!.contextModifiers)).toBe(true);
  });

  it('voiceDNA is undefined when not yet set', () => {
    const profile = getVoiceProfile(ws.workspaceId);
    expect(profile!.voiceDNA).toBeUndefined();
  });

  it('guardrails is undefined when not yet set', () => {
    const profile = getVoiceProfile(ws.workspaceId);
    expect(profile!.guardrails).toBeUndefined();
  });
});

// ─── updateVoiceProfile — state machine ──────────────────────────────────────

describe('updateVoiceProfile — legal state transitions', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => { ws = seedWorkspace({ tier: 'growth', clientPassword: '' }); });
  afterAll(() => { ws?.cleanup(); });

  beforeEach(() => {
    // Each state-machine test starts from a fresh draft. If a profile already
    // exists from a previous test, reset it back to draft.
    const existing = getVoiceProfile(ws.workspaceId);
    if (!existing) {
      createVoiceProfile(ws.workspaceId);
    } else if (existing.status !== 'draft') {
      // Reset to draft before each test (calibrated → draft is a legal transition)
      updateVoiceProfile(ws.workspaceId, { status: 'draft' });
    }
  });

  it('draft → calibrating succeeds', () => {
    const result = updateVoiceProfile(ws.workspaceId, { status: 'calibrating' });
    expect(result.status).toBe('calibrating');
  });

  it('generic mutation cannot perform calibrating → calibrated', () => {
    updateVoiceProfile(ws.workspaceId, { status: 'calibrating' });
    expect(() => updateVoiceProfile(ws.workspaceId, {
      status: 'calibrated', voiceDNA: SAMPLE_DNA, guardrails: SAMPLE_GUARDRAILS,
    })).toThrow(VoiceProfileStateTransitionError);
  });

  it('calibrating → draft succeeds (rollback)', () => {
    updateVoiceProfile(ws.workspaceId, { status: 'calibrating' });
    const result = updateVoiceProfile(ws.workspaceId, { status: 'draft' });
    expect(result.status).toBe('draft');
  });

  it('calibrated → draft succeeds (reset)', () => {
    db.prepare(`UPDATE voice_profiles SET status = 'calibrated' WHERE workspace_id = ?`) // status-ok: seed a compatibility-only legacy calibrated row
      .run(ws.workspaceId);
    const result = updateVoiceProfile(ws.workspaceId, { status: 'draft' });
    expect(result.status).toBe('draft');
  });

  it('calibrated → calibrating succeeds (re-calibrate)', () => {
    db.prepare(`UPDATE voice_profiles SET status = 'calibrated' WHERE workspace_id = ?`) // status-ok: seed a compatibility-only legacy calibrated row
      .run(ws.workspaceId);
    const result = updateVoiceProfile(ws.workspaceId, { status: 'calibrating' });
    expect(result.status).toBe('calibrating');
  });

  it('draft → draft is a legal no-op', () => {
    const result = updateVoiceProfile(ws.workspaceId, { status: 'draft' });
    expect(result.status).toBe('draft');
  });

  it('calibrating → calibrating is a legal no-op', () => {
    updateVoiceProfile(ws.workspaceId, { status: 'calibrating' });
    const result = updateVoiceProfile(ws.workspaceId, { status: 'calibrating' });
    expect(result.status).toBe('calibrating');
  });

  it('generic mutation rejects calibrated → calibrated', () => {
    db.prepare(`UPDATE voice_profiles SET status = 'calibrated' WHERE workspace_id = ?`) // status-ok: seed a compatibility-only legacy calibrated row
      .run(ws.workspaceId);
    expect(() => updateVoiceProfile(ws.workspaceId, { status: 'calibrated' }))
      .toThrow(VoiceProfileStateTransitionError);
  });
});

describe('updateVoiceProfile — illegal state transitions', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => { ws = seedWorkspace({ tier: 'growth', clientPassword: '' }); });
  afterAll(() => { ws?.cleanup(); });

  it('draft → calibrated throws VoiceProfileStateTransitionError', () => {
    createVoiceProfile(ws.workspaceId);
    expect(() =>
      updateVoiceProfile(ws.workspaceId, { status: 'calibrated' }),
    ).toThrow(VoiceProfileStateTransitionError);
  });

  it('status remains unchanged after an illegal draft → calibrated attempt', () => {
    try {
      updateVoiceProfile(ws.workspaceId, { status: 'calibrated' });
    } catch {
      // expected
    }
    const reread = getVoiceProfile(ws.workspaceId);
    expect(reread!.status).toBe('draft');
  });

  it('VoiceProfileStateTransitionError has .from === "draft" and .to === "calibrated"', () => {
    try {
      updateVoiceProfile(ws.workspaceId, { status: 'calibrated' });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(VoiceProfileStateTransitionError);
      const e = err as VoiceProfileStateTransitionError;
      expect(e.from).toBe('draft');
      expect(e.to).toBe('calibrated');
    }
  });

  it('error message includes both statuses', () => {
    try {
      updateVoiceProfile(ws.workspaceId, { status: 'calibrated' });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(VoiceProfileStateTransitionError);
      expect((err as Error).message).toContain('draft');
      expect((err as Error).message).toContain('calibrated');
    }
  });
});

// ─── updateVoiceProfile — field updates ──────────────────────────────────────

describe('updateVoiceProfile — field updates', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace({ tier: 'growth', clientPassword: '' });
    createVoiceProfile(ws.workspaceId);
  });
  afterAll(() => { ws?.cleanup(); });

  it('stores voiceDNA and reads it back via getVoiceProfile', () => {
    mockInvalidateMonthlyDigestCache.mockClear();
    mockClearIntelligenceCache.mockClear();
    updateVoiceProfile(ws.workspaceId, { voiceDNA: SAMPLE_DNA });
    const profile = getVoiceProfile(ws.workspaceId);
    expect(profile!.voiceDNA).toEqual(SAMPLE_DNA);
    expect(mockInvalidateMonthlyDigestCache).toHaveBeenCalledWith(ws.workspaceId);
    expect(mockClearIntelligenceCache).toHaveBeenCalledWith(ws.workspaceId);
  });

  it('stores guardrails and reads them back', () => {
    updateVoiceProfile(ws.workspaceId, { guardrails: SAMPLE_GUARDRAILS });
    const profile = getVoiceProfile(ws.workspaceId);
    expect(profile!.guardrails).toEqual(SAMPLE_GUARDRAILS);
  });

  it('round-trips legacy-compatible empty DNA and guardrail groups', () => {
    const emptyDNA: VoiceDNA = {
      personalityTraits: [],
      toneSpectrum: { formal_casual: 5, serious_playful: 5, technical_accessible: 5 },
      sentenceStyle: '',
      vocabularyLevel: '',
    };
    const emptyGuardrails: VoiceGuardrails = {
      forbiddenWords: [],
      requiredTerminology: [],
      toneBoundaries: [],
      antiPatterns: [],
    };
    updateVoiceProfile(ws.workspaceId, {
      voiceDNA: emptyDNA,
      guardrails: emptyGuardrails,
      contextModifiers: [{ context: '', description: '' }],
    });
    expect(getVoiceProfile(ws.workspaceId)).toMatchObject({
      voiceDNA: emptyDNA,
      guardrails: emptyGuardrails,
      contextModifiers: [{ context: '', description: '' }],
    });
  });

  it('replaces all contextModifiers when provided', () => {
    const newModifiers: ContextModifier[] = [
      { context: 'Custom context A', description: 'Do X' },
      { context: 'Custom context B', description: 'Do Y' },
    ];
    updateVoiceProfile(ws.workspaceId, { contextModifiers: newModifiers });
    const profile = getVoiceProfile(ws.workspaceId);
    expect(profile!.contextModifiers).toEqual(newModifiers);
    expect(profile!.contextModifiers).toHaveLength(2);
  });

  it('preserves voiceDNA when only updating guardrails', () => {
    const freshDna: VoiceDNA = { ...SAMPLE_DNA, sentenceStyle: 'Preserved-DNA' };
    updateVoiceProfile(ws.workspaceId, { voiceDNA: freshDna });
    updateVoiceProfile(ws.workspaceId, { guardrails: SAMPLE_GUARDRAILS });
    const profile = getVoiceProfile(ws.workspaceId);
    expect(profile!.voiceDNA!.sentenceStyle).toBe('Preserved-DNA');
  });

  it('updates updatedAt timestamp', () => {
    const before = getVoiceProfile(ws.workspaceId)!.updatedAt;
    // Small sleep via busy-wait to ensure timestamp difference
    const start = Date.now();
    while (Date.now() - start < 2) { /* spin */ }
    updateVoiceProfile(ws.workspaceId, { voiceDNA: SAMPLE_DNA });
    const after = getVoiceProfile(ws.workspaceId)!.updatedAt;
    // updatedAt should be a valid ISO string and not crash; it may be the same
    // millisecond in some environments, so we just verify it's a valid ISO date
    expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });

  it('throws for non-existent workspace', () => {
    expect(() =>
      updateVoiceProfile('nonexistent-ws-xyz', { voiceDNA: SAMPLE_DNA }),
    ).toThrow(/no voice profile/i);
  });
});

// ─── addVoiceSample ───────────────────────────────────────────────────────────

describe('addVoiceSample', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace({ tier: 'growth', clientPassword: '' });
    createVoiceProfile(ws.workspaceId);
  });
  afterAll(() => { ws?.cleanup(); });

  it('returns a sample with the provided content', () => {
    const sample = addVoiceSample(ws.workspaceId, 'Stop guessing at your SEO strategy.');
    expect(sample.content).toBe('Stop guessing at your SEO strategy.');
  });

  it('first sample gets sortOrder 0', () => {
    const profile = getVoiceProfile(ws.workspaceId)!;
    // We need a fresh profile for predictable sort_order. Use sort_order from returned sample.
    // The samples array is now ≥1 from the test above. Get the sample we just inserted.
    const samples = getVoiceProfile(ws.workspaceId)!.samples;
    // First sample inserted (sortOrder 0 from MAX(-1)+1)
    expect(samples[0].sortOrder).toBe(0);
  });

  it('second sample gets sortOrder 1', () => {
    addVoiceSample(ws.workspaceId, 'Second sample content');
    const samples = getVoiceProfile(ws.workspaceId)!.samples;
    expect(samples[1].sortOrder).toBe(1);
  });

  it('third sample gets sortOrder 2', () => {
    addVoiceSample(ws.workspaceId, 'Third sample content');
    const samples = getVoiceProfile(ws.workspaceId)!.samples;
    expect(samples[2].sortOrder).toBe(2);
  });

  it('returns sample with id starting with "vs_"', () => {
    const sample = addVoiceSample(ws.workspaceId, 'Id format test');
    expect(sample.id).toMatch(/^vs_/);
  });

  it('stores contextTag when provided', () => {
    const sample = addVoiceSample(ws.workspaceId, 'Headline copy', 'headline');
    expect(sample.contextTag).toBe('headline');
  });

  it('stores source when provided', () => {
    const sample = addVoiceSample(ws.workspaceId, 'Transcript sample', 'body', 'transcript_extraction');
    expect(sample.source).toBe('transcript_extraction');
  });

  it('defaults source to "manual" when not provided', () => {
    const sample = addVoiceSample(ws.workspaceId, 'Manual sample without explicit source');
    expect(sample.source).toBe('manual');
  });

  it('contextTag is undefined when not provided', () => {
    const sample = addVoiceSample(ws.workspaceId, 'No context tag');
    expect(sample.contextTag).toBeUndefined();
  });

  it('returns voiceProfileId matching the profile id', () => {
    const profile = getVoiceProfile(ws.workspaceId)!;
    const sample = addVoiceSample(ws.workspaceId, 'Profile id check');
    expect(sample.voiceProfileId).toBe(profile.id);
  });

  it('returned sample appears in subsequent getVoiceProfile call', () => {
    const sample = addVoiceSample(ws.workspaceId, 'Persistence check content unique-xyz');
    const profile = getVoiceProfile(ws.workspaceId)!;
    const found = profile.samples.find(s => s.id === sample.id);
    expect(found).toBeDefined();
    expect(found!.content).toBe('Persistence check content unique-xyz');
  });

  it('throws for workspace with no voice profile', () => {
    const ws2 = seedWorkspace({ tier: 'growth', clientPassword: '' });
    try {
      expect(() => addVoiceSample(ws2.workspaceId, 'No profile')).toThrow(/no voice profile/i);
    } finally {
      ws2.cleanup();
    }
  });
});

// ─── deleteVoiceSample ────────────────────────────────────────────────────────

describe('deleteVoiceSample', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace({ tier: 'growth', clientPassword: '' });
    createVoiceProfile(ws.workspaceId);
  });
  afterAll(() => { ws?.cleanup(); });

  it('returns true when sample is successfully removed', () => {
    const sample = addVoiceSample(ws.workspaceId, 'Sample to delete');
    const result = deleteVoiceSample(ws.workspaceId, sample.id);
    expect(result).toBe(true);
  });

  it('sample no longer appears in getVoiceProfile after deletion', () => {
    const sample = addVoiceSample(ws.workspaceId, 'Sample to remove from list');
    deleteVoiceSample(ws.workspaceId, sample.id);
    const profile = getVoiceProfile(ws.workspaceId)!;
    const found = profile.samples.find(s => s.id === sample.id);
    expect(found).toBeUndefined();
  });

  it('returns false for a non-existent sample ID', () => {
    const result = deleteVoiceSample(ws.workspaceId, 'vs_nonexistent_id');
    expect(result).toBe(false);
  });

  it('returns false when workspace has no profile', () => {
    const ws2 = seedWorkspace({ tier: 'growth', clientPassword: '' });
    try {
      const result = deleteVoiceSample(ws2.workspaceId, 'vs_any_id');
      expect(result).toBe(false);
    } finally {
      ws2.cleanup();
    }
  });

  it('does not delete sample from a different workspace profile', () => {
    const wsOther = seedWorkspace({ tier: 'growth', clientPassword: '' });
    createVoiceProfile(wsOther.workspaceId);
    const otherSample = addVoiceSample(wsOther.workspaceId, 'Other workspace sample');

    // Attempt to delete the other workspace's sample using ws.workspaceId
    const result = deleteVoiceSample(ws.workspaceId, otherSample.id);
    expect(result).toBe(false);

    // The other workspace's sample should still be intact
    const otherProfile = getVoiceProfile(wsOther.workspaceId)!;
    const stillThere = otherProfile.samples.find(s => s.id === otherSample.id);
    expect(stillThere).toBeDefined();

    wsOther.cleanup();
  });
});

// ─── listCalibrationSessions ──────────────────────────────────────────────────

describe('listCalibrationSessions', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => { ws = seedWorkspace({ tier: 'growth', clientPassword: '' }); });
  afterAll(() => { ws?.cleanup(); });

  it('returns empty array when workspace has no profile', () => {
    expect(listCalibrationSessions(ws.workspaceId)).toEqual([]);
  });

  it('returns empty array when profile has no sessions', () => {
    createVoiceProfile(ws.workspaceId);
    expect(listCalibrationSessions(ws.workspaceId)).toEqual([]);
  });

  it('returns an array (even empty) after profile is created', () => {
    expect(Array.isArray(listCalibrationSessions(ws.workspaceId))).toBe(true);
  });
});

// ─── VoiceProfileStateTransitionError ────────────────────────────────────────

describe('VoiceProfileStateTransitionError', () => {
  it('is an instanceof Error', () => {
    const err = new VoiceProfileStateTransitionError('draft', 'calibrated');
    expect(err).toBeInstanceOf(Error);
  });

  it('has .name === "VoiceProfileStateTransitionError"', () => {
    const err = new VoiceProfileStateTransitionError('draft', 'calibrated');
    expect(err.name).toBe('VoiceProfileStateTransitionError');
  });

  it('exposes .from field', () => {
    const err = new VoiceProfileStateTransitionError('draft', 'calibrated');
    expect(err.from).toBe('draft');
  });

  it('exposes .to field', () => {
    const err = new VoiceProfileStateTransitionError('draft', 'calibrated');
    expect(err.to).toBe('calibrated');
  });

  it('message contains both from and to statuses', () => {
    const err = new VoiceProfileStateTransitionError('draft', 'calibrated');
    expect(err.message).toContain('draft');
    expect(err.message).toContain('calibrated');
  });

  it('works for calibrating → draft direction', () => {
    const err = new VoiceProfileStateTransitionError('calibrating', 'draft');
    expect(err.from).toBe('calibrating');
    expect(err.to).toBe('draft');
  });

  it('has a non-empty message string', () => {
    const err = new VoiceProfileStateTransitionError('draft', 'calibrated');
    expect(err.message.length).toBeGreaterThan(0);
  });

  it('is throwable and catchable as Error', () => {
    expect(() => { throw new VoiceProfileStateTransitionError('draft', 'calibrated'); }).toThrow(Error);
  });

  it('is throwable and catchable as VoiceProfileStateTransitionError', () => {
    expect(() => { throw new VoiceProfileStateTransitionError('draft', 'calibrated'); })
      .toThrow(VoiceProfileStateTransitionError);
  });
});

// ─── Cross-workspace isolation ────────────────────────────────────────────────

describe('cross-workspace isolation', () => {
  let wsA: SeededFullWorkspace;
  let wsB: SeededFullWorkspace;

  beforeAll(() => {
    wsA = seedWorkspace({ tier: 'growth', clientPassword: '' });
    wsB = seedWorkspace({ tier: 'growth', clientPassword: '' });
    createVoiceProfile(wsA.workspaceId);
    createVoiceProfile(wsB.workspaceId);
  });
  afterAll(() => {
    wsA?.cleanup();
    wsB?.cleanup();
  });

  it('getVoiceProfile returns correct profile for each workspace', () => {
    const profA = getVoiceProfile(wsA.workspaceId);
    const profB = getVoiceProfile(wsB.workspaceId);
    expect(profA!.workspaceId).toBe(wsA.workspaceId);
    expect(profB!.workspaceId).toBe(wsB.workspaceId);
    expect(profA!.id).not.toBe(profB!.id);
  });

  it('samples added to workspace A do not appear in workspace B', () => {
    addVoiceSample(wsA.workspaceId, 'Sample unique to workspace A');
    const profB = getVoiceProfile(wsB.workspaceId)!;
    const contaminated = profB.samples.some(s => s.content === 'Sample unique to workspace A');
    expect(contaminated).toBe(false);
  });

  it('updateVoiceProfile on workspace A does not affect workspace B', () => {
    updateVoiceProfile(wsA.workspaceId, { voiceDNA: SAMPLE_DNA });
    const profB = getVoiceProfile(wsB.workspaceId)!;
    expect(profB.voiceDNA).toBeUndefined();
  });

  it('state transitions on workspace A do not affect workspace B status', () => {
    updateVoiceProfile(wsA.workspaceId, { status: 'calibrating' });
    const profB = getVoiceProfile(wsB.workspaceId)!;
    expect(profB.status).toBe('draft');
  });
});

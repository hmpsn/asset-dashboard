import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import db from '../../server/db/index.js';
import {
  addPattern,
  extractPatterns,
  getActivePatterns,
  getAllPatterns,
  getPatternsForPromotion,
  promoteToGuardrail,
  removePattern,
  togglePattern,
  updatePatternText,
} from '../../server/copy-intelligence.js';
import { createVoiceProfile, getVoiceProfile, updateVoiceProfile } from '../../server/voice-calibration.js';
import { callOpenAI } from '../../server/openai-helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';

vi.mock('../../server/openai-helpers.js', () => ({
  callOpenAI: vi.fn(),
}));

const mockCallOpenAI = vi.mocked(callOpenAI);

let wsId = '';
let otherWsId = '';
let cleanupA: (() => void) | undefined;
let cleanupB: (() => void) | undefined;

function clearWorkspaceData(...workspaceIds: string[]): void {
  if (workspaceIds.length === 0) return;
  const placeholders = workspaceIds.map(() => '?').join(', ');
  db.prepare(`
    DELETE FROM copy_intelligence
    WHERE workspace_id IN (${placeholders})
  `).run(...workspaceIds);
  db.prepare(`
    DELETE FROM voice_samples
    WHERE voice_profile_id IN (
      SELECT id FROM voice_profiles WHERE workspace_id IN (${placeholders})
    )
  `).run(...workspaceIds);
  db.prepare(`
    DELETE FROM voice_profiles
    WHERE workspace_id IN (${placeholders})
  `).run(...workspaceIds);
}

function calibrateVoiceProfile(workspaceId: string): void {
  createVoiceProfile(workspaceId);
  updateVoiceProfile(workspaceId, { status: 'calibrating' });
  updateVoiceProfile(workspaceId, {
    status: 'calibrated',
    guardrails: {
      forbiddenWords: [],
      requiredTerminology: [],
      toneBoundaries: [],
      antiPatterns: [],
    },
  });
}

beforeEach(() => {
  const wsA = seedWorkspace({ clientPassword: '' });
  const wsB = seedWorkspace({ clientPassword: '' });
  wsId = wsA.workspaceId;
  otherWsId = wsB.workspaceId;
  cleanupA = wsA.cleanup;
  cleanupB = wsB.cleanup;
  mockCallOpenAI.mockReset();
});

afterEach(() => {
  clearWorkspaceData(wsId, otherWsId);
  cleanupA?.();
  cleanupB?.();
  cleanupA = undefined;
  cleanupB = undefined;
});

describe('copy-intelligence store', () => {
  it('adds patterns, deduplicates per workspace, and lists by frequency', () => {
    const first = addPattern(wsId, {
      patternType: 'tone',
      pattern: 'Use concrete proof before claims',
      source: 'manual',
    });
    const duplicate = addPattern(wsId, {
      patternType: 'tone',
      pattern: 'Use concrete proof before claims',
      source: 'ignored-on-dedupe',
    });
    addPattern(wsId, {
      patternType: 'structure',
      pattern: 'Lead with outcome, then explain mechanics',
    });
    const other = addPattern(otherWsId, {
      patternType: 'tone',
      pattern: 'Use concrete proof before claims',
    });

    expect(duplicate.id).toBe(first.id);
    expect(duplicate.frequency).toBe(2);
    expect(duplicate.source).toBe('manual');
    expect(other.workspaceId).toBe(otherWsId);

    expect(getAllPatterns(wsId).map(pattern => [pattern.pattern, pattern.frequency])).toEqual([
      ['Use concrete proof before claims', 2],
      ['Lead with outcome, then explain mechanics', 1],
    ]);
  });

  it('toggles, updates, and removes patterns with workspace scoping', () => {
    const pattern = addPattern(wsId, {
      patternType: 'terminology',
      pattern: 'Say clients, not customers',
    });

    togglePattern(pattern.id, otherWsId, false);
    expect(getActivePatterns(wsId)).toHaveLength(1);

    updatePatternText(pattern.id, wsId, 'Say partners, not customers', 'tone');
    expect(getAllPatterns(wsId)[0]).toMatchObject({
      id: pattern.id,
      pattern: 'Say partners, not customers',
      patternType: 'tone',
    });

    togglePattern(pattern.id, wsId, false);
    expect(getActivePatterns(wsId)).toHaveLength(0);
    expect(getAllPatterns(wsId)[0].active).toBe(false);

    removePattern(pattern.id, otherWsId);
    expect(getAllPatterns(wsId)).toHaveLength(1);

    removePattern(pattern.id, wsId);
    expect(getAllPatterns(wsId)).toHaveLength(0);
  });

  it('returns only active high-frequency promotion candidates', () => {
    const promotable = addPattern(wsId, {
      patternType: 'tone',
      pattern: 'Keep CTAs direct',
    });
    addPattern(wsId, { patternType: 'tone', pattern: 'Keep CTAs direct' });
    addPattern(wsId, { patternType: 'tone', pattern: 'Keep CTAs direct' });

    const belowThreshold = addPattern(wsId, {
      patternType: 'structure',
      pattern: 'Use proof bullets',
    });
    const inactive = addPattern(wsId, {
      patternType: 'keyword_usage',
      pattern: 'Mention primary keyword in the opening section',
    });
    addPattern(wsId, {
      patternType: 'keyword_usage',
      pattern: 'Mention primary keyword in the opening section',
    });
    addPattern(wsId, {
      patternType: 'keyword_usage',
      pattern: 'Mention primary keyword in the opening section',
    });
    togglePattern(inactive.id, wsId, false);

    expect(getPatternsForPromotion(wsId).map(pattern => pattern.id)).toEqual([promotable.id]);
    expect(getPatternsForPromotion(wsId)).not.toContainEqual(expect.objectContaining({ id: belowThreshold.id }));
    expect(getPatternsForPromotion(wsId)).not.toContainEqual(expect.objectContaining({ id: inactive.id }));
  });
});

describe('copy-intelligence guardrail promotion', () => {
  it('rejects missing, inactive, low-frequency, and uncalibrated patterns', () => {
    expect(promoteToGuardrail('missing', wsId)).toEqual({
      success: false,
      error: 'Pattern not found',
    });

    const lowFrequency = addPattern(wsId, {
      patternType: 'tone',
      pattern: 'Use active voice',
    });
    expect(promoteToGuardrail(lowFrequency.id, wsId)).toEqual({
      success: false,
      error: 'Pattern frequency (1) is below the promotion threshold of 3',
    });

    addPattern(wsId, { patternType: 'tone', pattern: 'Use active voice' });
    addPattern(wsId, { patternType: 'tone', pattern: 'Use active voice' });
    togglePattern(lowFrequency.id, wsId, false);
    expect(promoteToGuardrail(lowFrequency.id, wsId)).toEqual({
      success: false,
      error: 'Pattern is already inactive (may have been promoted previously)',
    });

    const noProfile = addPattern(wsId, {
      patternType: 'structure',
      pattern: 'Open with the client outcome',
    });
    addPattern(wsId, { patternType: 'structure', pattern: 'Open with the client outcome' });
    addPattern(wsId, { patternType: 'structure', pattern: 'Open with the client outcome' });
    expect(promoteToGuardrail(noProfile.id, wsId)).toEqual({
      success: false,
      error: 'No voice profile exists for this workspace',
    });
  });

  it('promotes tone patterns to tone boundaries and deactivates the source pattern', () => {
    calibrateVoiceProfile(wsId);
    const pattern = addPattern(wsId, {
      patternType: 'tone',
      pattern: 'Sound precise without getting stiff',
    });
    addPattern(wsId, { patternType: 'tone', pattern: 'Sound precise without getting stiff' });
    addPattern(wsId, { patternType: 'tone', pattern: 'Sound precise without getting stiff' });

    expect(promoteToGuardrail(pattern.id, wsId)).toEqual({
      success: true,
      guardrailText: 'Sound precise without getting stiff',
    });

    expect(getAllPatterns(wsId)[0].active).toBe(false);
    expect(getVoiceProfile(wsId)?.guardrails?.toneBoundaries).toEqual([
      'Sound precise without getting stiff',
    ]);
  });

  it('promotes non-tone patterns to anti-pattern guardrails without duplicating existing text', () => {
    calibrateVoiceProfile(wsId);
    updateVoiceProfile(wsId, {
      guardrails: {
        forbiddenWords: [],
        requiredTerminology: [],
        toneBoundaries: [],
        antiPatterns: ['Avoid vague proof points'],
      },
    });
    const pattern = addPattern(wsId, {
      patternType: 'structure',
      pattern: 'Avoid vague proof points',
    });
    addPattern(wsId, { patternType: 'structure', pattern: 'Avoid vague proof points' });
    addPattern(wsId, { patternType: 'structure', pattern: 'Avoid vague proof points' });

    expect(promoteToGuardrail(pattern.id, wsId)).toEqual({
      success: true,
      guardrailText: 'Avoid vague proof points',
    });

    expect(getAllPatterns(wsId)[0].active).toBe(false);
    expect(getVoiceProfile(wsId)?.guardrails?.antiPatterns).toEqual(['Avoid vague proof points']);
  });
});

describe('copy-intelligence extraction', () => {
  it('returns early for empty steering notes', async () => {
    await expect(extractPatterns(wsId, [])).resolves.toEqual([]);
    expect(mockCallOpenAI).not.toHaveBeenCalled();
  });

  it('returns no patterns when the AI call fails', async () => {
    mockCallOpenAI.mockRejectedValue(new Error('model unavailable'));

    await expect(extractPatterns(wsId, ['Make this sound less generic'])).resolves.toEqual([]);
    expect(getAllPatterns(wsId)).toHaveLength(0);
  });

  it('persists valid extracted patterns and ignores malformed pattern types', async () => {
    mockCallOpenAI.mockResolvedValue({
      text: JSON.stringify({
        patterns: [
          { patternType: 'tone', pattern: 'Use warmer proof language' },
          { patternType: 'unsupported', pattern: 'This should not persist' },
          { patternType: 'keyword_usage', pattern: '' },
        ],
      }),
      promptTokens: 12,
      completionTokens: 8,
      totalTokens: 20,
    });

    const patterns = await extractPatterns(wsId, ['Can we make the proof feel warmer?']);

    expect(mockCallOpenAI).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'copy-intelligence',
      workspaceId: wsId,
      responseFormat: { type: 'json_object' },
    }));
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({
      patternType: 'tone',
      pattern: 'Use warmer proof language',
      source: 'extracted',
      frequency: 1,
      active: true,
    });
    expect(getAllPatterns(wsId).map(pattern => pattern.pattern)).toEqual([
      'Use warmer proof language',
    ]);
  });
});

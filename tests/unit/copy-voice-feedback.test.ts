import { describe, it, expect, vi, beforeEach } from 'vitest';

const callAI = vi.fn();
const getVoiceProfile = vi.fn();

vi.mock('../../server/ai.js', () => ({
  callAI: (...args: unknown[]) => callAI(...args),
}));

vi.mock('../../server/voice-calibration.js', () => ({
  getVoiceProfile: (...args: unknown[]) => getVoiceProfile(...args),
}));

import {
  classifySteeringFeedback,
  processSteeringFeedback,
  suggestVoiceProfileUpdate,
} from '../../server/copy-voice-feedback.js';

const WORKSPACE_ID = 'ws_voice_feedback_test';

function aiJson(value: unknown) {
  return {
    text: JSON.stringify(value),
    tokens: { prompt: 10, completion: 5, total: 15 },
  };
}

function profile() {
  return {
    id: 'vp_test',
    workspaceId: WORKSPACE_ID,
    status: 'calibrated',
    voiceDNA: {
      personalityTraits: ['Clear', 'Confident'],
      toneSpectrum: { formal_casual: 6, serious_playful: 4, technical_accessible: 8 },
      sentenceStyle: 'Short, direct sentences',
      vocabularyLevel: 'Plainspoken',
    },
    guardrails: {
      forbiddenWords: ['synergy'],
      requiredTerminology: [],
      toneBoundaries: ['No hype'],
      antiPatterns: ['Corporate jargon'],
    },
    contextModifiers: [
      { context: 'Hero sections', description: 'Lead with the outcome.' },
    ],
    samples: [],
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  };
}

describe('copy voice feedback loop', () => {
  beforeEach(() => {
    callAI.mockReset();
    getVoiceProfile.mockReset();
  });

  it('returns empty buckets for empty notes without calling AI', async () => {
    const result = await classifySteeringFeedback([], WORKSPACE_ID);

    expect(result).toEqual({ content: [], voice: [] });
    expect(callAI).not.toHaveBeenCalled();
  });

  it('classifies content and voice notes from AI JSON', async () => {
    callAI.mockResolvedValue(aiJson({
      content_feedback: ['Add pricing detail.'],
      voice_feedback: ['Make this less corporate.'],
    }));

    const result = await classifySteeringFeedback(
      ['Add pricing detail.', 'Make this less corporate.'],
      WORKSPACE_ID,
    );

    expect(result).toEqual({
      content: ['Add pricing detail.'],
      voice: ['Make this less corporate.'],
    });
    expect(callAI).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'voice-feedback-classify',
      responseFormat: { type: 'json_object' },
      workspaceId: WORKSPACE_ID,
    }));
  });

  it('falls back to all content feedback when classification AI fails', async () => {
    callAI.mockRejectedValue(new Error('rate limited'));

    const notes = ['Add a CTA.', 'Too stiff.'];
    const result = await classifySteeringFeedback(notes, WORKSPACE_ID);

    expect(result).toEqual({ content: notes, voice: [] });
  });

  it('does not suggest profile updates when voice notes are empty', async () => {
    const result = await suggestVoiceProfileUpdate(WORKSPACE_ID, []);

    expect(result).toBeNull();
    expect(getVoiceProfile).not.toHaveBeenCalled();
    expect(callAI).not.toHaveBeenCalled();
  });

  it('returns null when no voice profile exists', async () => {
    getVoiceProfile.mockReturnValue(null);

    const result = await suggestVoiceProfileUpdate(WORKSPACE_ID, ['Too casual.']);

    expect(result).toBeNull();
    expect(callAI).not.toHaveBeenCalled();
  });

  it('returns a guardrail suggestion with source notes', async () => {
    getVoiceProfile.mockReturnValue(profile());
    callAI.mockResolvedValue(aiJson({
      suggestedGuardrail: 'Avoid corporate jargon in service copy.',
      suggestedModifier: null,
      reasoning: 'Repeated voice feedback mentions corporate phrasing.',
    }));

    const result = await suggestVoiceProfileUpdate(WORKSPACE_ID, ['Make this less corporate.']);

    expect(result).toEqual({
      sourceNotes: ['Make this less corporate.'],
      suggestedGuardrail: 'Avoid corporate jargon in service copy.',
    });
    expect(callAI).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'voice-feedback-suggest',
      responseFormat: { type: 'json_object' },
      workspaceId: WORKSPACE_ID,
    }));
  });

  it('processes steering feedback and only asks for suggestions when voice notes exist', async () => {
    getVoiceProfile.mockReturnValue(profile());
    callAI
      .mockResolvedValueOnce(aiJson({
        content_feedback: ['Add a proof point.'],
        voice_feedback: ['Make the tone warmer.'],
      }))
      .mockResolvedValueOnce(aiJson({
        suggestedGuardrail: null,
        suggestedModifier: 'Warm up proof-heavy sections with plain-language transitions.',
        reasoning: 'Voice feedback is context-specific.',
      }));

    const result = await processSteeringFeedback(
      WORKSPACE_ID,
      'section_hero',
      ['Add a proof point.', 'Make the tone warmer.'],
    );

    expect(result).toEqual({
      classification: {
        content: ['Add a proof point.'],
        voice: ['Make the tone warmer.'],
      },
      voiceSuggestion: {
        sourceNotes: ['Make the tone warmer.'],
        suggestedModifier: 'Warm up proof-heavy sections with plain-language transitions.',
      },
    });
    expect(callAI).toHaveBeenCalledTimes(2);
  });
});

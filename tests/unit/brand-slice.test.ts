import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrandDeliverable, DeliverableType, DeliverableStatus } from '../../shared/types/brand-engine.js';

const mocks = vi.hoisted(() => ({
  buildEffectiveBrandVoiceBlock: vi.fn(),
  getRawBrandVoice: vi.fn(),
  getVoiceProfile: vi.fn(),
  listDeliverables: vi.fn(),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../server/intelligence/seo-context-source.js', () => ({
  buildEffectiveBrandVoiceBlock: mocks.buildEffectiveBrandVoiceBlock,
  getRawBrandVoice: mocks.getRawBrandVoice,
  // Pass-through: the slice wraps its reads in safeBrandEngineRead; the mock just invokes fn().
  safeBrandEngineRead: (_ctx: string, _ws: string, fn: () => unknown) => fn(),
}));

vi.mock('../../server/voice-profile-read-model.js', () => ({
  getVoiceProfile: mocks.getVoiceProfile,
}));

vi.mock('../../server/brand-deliverable-read-model.js', () => ({
  listDeliverables: mocks.listDeliverables,
}));

const { assembleBrand } = await import('../../server/intelligence/brand-slice.js');

function makeDeliverable(
  deliverableType: DeliverableType,
  content: string,
  status: DeliverableStatus,
): BrandDeliverable {
  return {
    id: `bid_${deliverableType}`,
    workspaceId: 'ws-test',
    deliverableType,
    content,
    status,
    version: 1,
    tier: 'professional',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buildEffectiveBrandVoiceBlock.mockReturnValue('');
  mocks.getRawBrandVoice.mockReturnValue('');
  mocks.getVoiceProfile.mockReturnValue(null);
  mocks.listDeliverables.mockReturnValue([]);
});

describe('assembleBrand', () => {
  it('reports calibrated voice and parity with buildEffectiveBrandVoiceBlock', async () => {
    const voiceBlock = '\n\nBRAND VOICE PROFILE (you MUST match this voice — do not deviate):\nVOICE DNA: confident';
    mocks.buildEffectiveBrandVoiceBlock.mockReturnValue(voiceBlock);
    mocks.getVoiceProfile.mockReturnValue({ status: 'calibrated' });

    const result = await assembleBrand('ws-calibrated');

    expect(result.voice.status).toBe('calibrated');
    expect(result.voicePromptBlock).toBe(voiceBlock);
    expect(result.voicePromptBlock).toBe(mocks.buildEffectiveBrandVoiceBlock('ws-calibrated'));
    expect(result.availability).toBe('ready');
  });

  it('populates voiceDnaBlock from Layer-2 DNA + guardrails for a calibrated profile', async () => {
    mocks.buildEffectiveBrandVoiceBlock.mockReturnValue('\n\nBRAND VOICE PROFILE:\nsamples');
    mocks.getVoiceProfile.mockReturnValue({
      status: 'calibrated',
      voiceDNA: {
        personalityTraits: ['Witty', 'Direct'],
        toneSpectrum: { formal_casual: 8, serious_playful: 8, technical_accessible: 8 },
        sentenceStyle: 'Short punchy lines',
        vocabularyLevel: 'Conversational',
        humorStyle: 'Dry',
      },
      guardrails: {
        forbiddenWords: ['synergy'],
        requiredTerminology: [],
        toneBoundaries: ['Never condescending'],
        antiPatterns: [],
      },
    });

    const result = await assembleBrand('ws-calibrated-dna');

    expect(result.voiceDnaBlock).not.toBe('');
    // Contains a guardrail token (forbidden word) and a DNA-derived directive.
    expect(result.voiceDnaBlock).toContain('synergy');
    expect(result.voiceDnaBlock).toContain('Never condescending');
    expect(result.voiceDnaBlock).toContain('Voice profile for this client:');
  });

  it('leaves voiceDnaBlock empty for a non-calibrated profile (DNA already in voicePromptBlock)', async () => {
    mocks.getVoiceProfile.mockReturnValue(null);
    mocks.getRawBrandVoice.mockReturnValue('We sound friendly and direct.');
    mocks.buildEffectiveBrandVoiceBlock.mockReturnValue('\n\nBRAND VOICE & STYLE:\nWe sound friendly and direct.');

    const result = await assembleBrand('ws-legacy-dna');

    expect(result.voice.status).toBe('legacy');
    expect(result.voiceDnaBlock).toBe('');
  });

  it('reports legacy voice when no calibrated profile but raw voice text exists', async () => {
    mocks.getVoiceProfile.mockReturnValue(null);
    mocks.getRawBrandVoice.mockReturnValue('We sound friendly and direct.');
    mocks.buildEffectiveBrandVoiceBlock.mockReturnValue('\n\nBRAND VOICE & STYLE:\nWe sound friendly and direct.');

    const result = await assembleBrand('ws-legacy');

    expect(result.voice.status).toBe('legacy');
    expect(result.availability).toBe('ready');
  });

  it('reports no_data when there is no voice and no deliverables', async () => {
    const result = await assembleBrand('ws-empty');

    expect(result.voice.status).toBe('none');
    expect(result.availability).toBe('no_data');
    expect(result.identity).toEqual({});
    expect(result.voicePromptBlock).toBe('');
    expect(result.identityPromptBlock).toBe('');
  });

  it('surfaces approved-only identity content and excludes drafts', async () => {
    mocks.listDeliverables.mockReturnValue([
      makeDeliverable('mission', 'Draft mission text', 'draft'),
      makeDeliverable('values', 'Be bold. Be kind.', 'approved'),
    ]);

    const result = await assembleBrand('ws-identity');

    expect(result.identity.mission).toBeUndefined();
    expect(result.identity.values).toBe('Be bold. Be kind.');
    expect(result.identityPromptBlock).toContain('Values: Be bold. Be kind.');
    expect(result.identityPromptBlock).not.toContain('Draft mission text');
    expect(result.availability).toBe('ready');
  });

  it('maps deliverable types to camelCase identity keys', async () => {
    mocks.listDeliverables.mockReturnValue([
      makeDeliverable('elevator_pitch', 'In 30 seconds...', 'approved'),
      makeDeliverable('positioning_matrix', 'We sit premium vs. value.', 'approved'),
    ]);

    const result = await assembleBrand('ws-keys');

    expect(result.identity.elevatorPitch).toBe('In 30 seconds...');
    expect(result.identity.positioning).toBe('We sit premium vs. value.');
    expect(result.identityPromptBlock).toContain('Elevator pitch: In 30 seconds...');
    expect(result.identityPromptBlock).toContain('Positioning: We sit premium vs. value.');
  });
});

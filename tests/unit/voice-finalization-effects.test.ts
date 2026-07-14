import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FinalizeBrandVoiceResult } from '../../shared/types/voice-finalization.js';
import {
  applyVoiceFinalizationPostCommitEffects,
  type VoiceFinalizationEffectDependencies,
} from '../../server/domains/brand/voice-finalization-effects.js';

const result: FinalizeBrandVoiceResult = {
  snapshot: {
    id: 'vpf_effect_1',
    workspaceId: 'ws_effect_1',
    voiceProfileId: 'vp_effect_1',
    voiceVersion: 2,
    profileRevision: 7,
    voiceDNA: {
      personalityTraits: ['Clear'],
      toneSpectrum: { formal_casual: 5, serious_playful: 4, technical_accessible: 8 },
      sentenceStyle: 'Lead with the answer.',
      vocabularyLevel: 'Plain language.',
    },
    guardrails: {
      forbiddenWords: ['miracle'],
      requiredTerminology: [],
      toneBoundaries: ['No pressure.'],
      antiPatterns: [],
    },
    contextModifiers: [],
    anchors: [{
      selector: { kind: 'voice_sample', voiceSampleId: 'sample_effect_1' },
      content: 'We explain the tradeoff before asking you to decide.',
      context: 'body',
      evidenceRef: {
        sourceType: 'voice_sample',
        sourceId: 'sample_effect_1',
        voiceSampleSource: 'manual',
        capturedAt: '2026-07-13T10:00:00.000Z',
        selectedBy: { actorType: 'operator', actorId: 'operator_effect_1' },
        selectedAt: '2026-07-13T11:00:00.000Z',
      },
    }],
    calibrationSelections: [],
    finalizedBy: {
      actorType: 'operator',
      actorId: 'operator_effect_1',
      actorLabel: 'Voice Operator',
    },
    executionActor: {
      actorType: 'mcp',
      actorId: 'private_mcp_key_id',
      actorLabel: 'Private MCP key label',
    },
    finalizedAt: '2026-07-13T11:00:00.000Z',
    createdAt: '2026-07-13T11:00:00.000Z',
    fingerprint: 'a'.repeat(64),
    anchorEvidenceRefs: [{
      sourceType: 'voice_sample',
      sourceId: 'sample_effect_1',
      voiceSampleSource: 'manual',
      capturedAt: '2026-07-13T10:00:00.000Z',
      selectedBy: { actorType: 'operator', actorId: 'operator_effect_1' },
      selectedAt: '2026-07-13T11:00:00.000Z',
    }],
  },
  readiness: {
    state: 'finalized',
    snapshot: {
      voiceProfileId: 'vp_effect_1',
      voiceVersion: 2,
      finalizedBy: {
        actorType: 'operator',
        actorId: 'operator_effect_1',
        actorLabel: 'Voice Operator',
      },
      finalizedAt: '2026-07-13T11:00:00.000Z',
      fingerprint: 'a'.repeat(64),
      anchorEvidenceRefs: [{
        sourceType: 'voice_sample',
        sourceId: 'sample_effect_1',
        voiceSampleSource: 'manual',
        capturedAt: '2026-07-13T10:00:00.000Z',
        selectedBy: { actorType: 'operator', actorId: 'operator_effect_1' },
        selectedAt: '2026-07-13T11:00:00.000Z',
      }],
    },
    blockingReasons: [],
  },
  profileRevision: 7,
  created: true,
  replayed: false,
};

function dependencies(): VoiceFinalizationEffectDependencies {
  return {
    addActivity: vi.fn(),
    broadcastToWorkspace: vi.fn(),
    invalidateIntelligenceCache: vi.fn(),
    invalidateMonthlyDigestCache: vi.fn(),
    recordAction: vi.fn(() => ({ id: 'action_effect_1' }) as never),
  };
}

describe('voice finalization post-commit effects', () => {
  let deps: VoiceFinalizationEffectDependencies;

  beforeEach(() => {
    deps = dependencies();
  });

  it('records one truthful activity/outcome and emits redacted workspace events', () => {
    applyVoiceFinalizationPostCommitEffects('ws_effect_1', result, deps);

    expect(deps.addActivity).toHaveBeenCalledTimes(1);
    expect(deps.recordAction).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_effect_1',
      actionType: 'voice_calibrated',
      sourceType: 'brand_voice',
      sourceId: 'ws_effect_1',
      attribution: 'platform_executed',
      baselineSnapshot: { captured_at: result.snapshot.finalizedAt },
      context: {
        notes: 'voiceFinalizationId=vpf_effect_1;voiceVersion=2;profileRevision=7',
      },
    }));
    expect(deps.broadcastToWorkspace).toHaveBeenCalledWith(
      'ws_effect_1',
      'outcome:action_recorded',
      {},
    );
    expect(deps.broadcastToWorkspace).toHaveBeenCalledWith(
      'ws_effect_1',
      'voice:updated',
      expect.objectContaining({
        workspaceId: 'ws_effect_1',
        finalizationId: 'vpf_effect_1',
        voiceVersion: 2,
      }),
    );
    expect(JSON.stringify(vi.mocked(deps.broadcastToWorkspace).mock.calls))
      .not.toContain('private_mcp_key');
    expect(deps.invalidateIntelligenceCache).toHaveBeenCalledWith('ws_effect_1');
    expect(deps.invalidateMonthlyDigestCache).toHaveBeenCalledWith('ws_effect_1');
  });

  it('does nothing for an exact replay', () => {
    applyVoiceFinalizationPostCommitEffects('ws_effect_1', {
      ...result,
      created: false,
      replayed: true,
    }, deps);

    expect(deps.addActivity).not.toHaveBeenCalled();
    expect(deps.recordAction).not.toHaveBeenCalled();
    expect(deps.broadcastToWorkspace).not.toHaveBeenCalled();
    expect(deps.invalidateIntelligenceCache).not.toHaveBeenCalled();
    expect(deps.invalidateMonthlyDigestCache).not.toHaveBeenCalled();
  });

  it('records later immutable voice versions as distinct actions on the canonical workspace self-reference', () => {
    applyVoiceFinalizationPostCommitEffects('ws_effect_1', result, deps);
    applyVoiceFinalizationPostCommitEffects('ws_effect_1', {
      ...result,
      snapshot: {
        ...result.snapshot,
        id: 'vpf_effect_2',
        voiceVersion: 3,
        profileRevision: 8,
      },
      profileRevision: 8,
    }, deps);

    expect(deps.recordAction).toHaveBeenNthCalledWith(1, expect.objectContaining({
      sourceType: 'brand_voice',
      sourceId: 'ws_effect_1',
      context: {
        notes: 'voiceFinalizationId=vpf_effect_1;voiceVersion=2;profileRevision=7',
      },
    }));
    expect(deps.recordAction).toHaveBeenNthCalledWith(2, expect.objectContaining({
      sourceType: 'brand_voice',
      sourceId: 'ws_effect_1',
      context: {
        notes: 'voiceFinalizationId=vpf_effect_2;voiceVersion=3;profileRevision=8',
      },
    }));
  });

  it('isolates a failed outcome effect from event and cache invalidation', () => {
    vi.mocked(deps.recordAction).mockImplementation(() => {
      throw new Error('outcome unavailable');
    });

    expect(() => applyVoiceFinalizationPostCommitEffects('ws_effect_1', result, deps))
      .not.toThrow();
    expect(deps.broadcastToWorkspace).toHaveBeenCalledWith(
      'ws_effect_1',
      'voice:updated',
      expect.any(Object),
    );
    expect(deps.invalidateIntelligenceCache).toHaveBeenCalledWith('ws_effect_1');
    expect(deps.invalidateMonthlyDigestCache).toHaveBeenCalledWith('ws_effect_1');
  });
});

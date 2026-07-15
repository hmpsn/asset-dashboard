import { describe, expect, it } from 'vitest';

import type {
  FinalizedVoiceSnapshot,
  VoiceAnchorSelector,
} from '../../shared/types/voice-finalization.js';
import {
  finalizeBrandVoiceBodySchema,
  finalizedVoiceSnapshotRefSchema,
  voiceGuardrailsSchema,
} from '../../shared/types/voice-finalization-schemas.js';
import {
  finalizeBrandVoiceMcpInputSchema,
  getBrandVoiceInputSchema,
} from '../../shared/types/mcp-brand-voice-schemas.js';

const validBody = {
  expectedProfileRevision: 4,
  voiceDNA: {
    personalityTraits: ['Warm and exact'],
    toneSpectrum: {
      formal_casual: 6,
      serious_playful: 4,
      technical_accessible: 8,
    },
    sentenceStyle: 'Short sentences with a calm cadence.',
    vocabularyLevel: 'Plain language without flattening expertise.',
  },
  guardrails: {
    forbiddenWords: ['miracle'],
    requiredTerminology: [],
    toneBoundaries: ['Never pressure the reader.'],
    antiPatterns: [],
  },
  contextModifiers: [],
  anchorSelectors: [{ kind: 'voice_sample', voiceSampleId: 'vs-1' }],
  calibrationSelections: [{
    sessionId: 'cal-1',
    variationIndex: 0,
    rating: 'on_brand',
    selected: true,
  }],
  idempotencyKey: 'voice-finalize-1',
} as const;

describe('voice finalization shared contract', () => {
  it('accepts a bounded exact command and preserves durable selector identity', () => {
    const parsed = finalizeBrandVoiceBodySchema.parse(validBody);
    const selector: VoiceAnchorSelector = parsed.anchorSelectors[0];
    expect(selector).toEqual({ kind: 'voice_sample', voiceSampleId: 'vs-1' });
  });

  it('rejects blank DNA, empty guardrails, missing anchors, and duplicate evidence', () => {
    expect(finalizeBrandVoiceBodySchema.safeParse({
      ...validBody,
      voiceDNA: { ...validBody.voiceDNA, personalityTraits: [' '] },
    }).success).toBe(false);
    expect(voiceGuardrailsSchema.safeParse({
      forbiddenWords: [], requiredTerminology: [], toneBoundaries: [], antiPatterns: [],
    }).success).toBe(false);
    expect(finalizeBrandVoiceBodySchema.safeParse({
      ...validBody,
      anchorSelectors: [],
    }).success).toBe(false);
    expect(finalizeBrandVoiceBodySchema.safeParse({
      ...validBody,
      anchorSelectors: [
        { kind: 'voice_sample', voiceSampleId: 'vs-1' },
        { kind: 'voice_sample', voiceSampleId: 'vs-1' },
      ],
    }).success).toBe(false);
    expect(finalizeBrandVoiceBodySchema.safeParse({
      ...validBody,
      calibrationSelections: [
        validBody.calibrationSelections[0],
        validBody.calibrationSelections[0],
      ],
    }).success).toBe(false);
  });

  it('requires operator attribution and authentic sample provenance in snapshot refs', () => {
    const ref = {
      voiceProfileId: 'vp-1',
      voiceVersion: 1,
      finalizedBy: { actorType: 'operator', actorId: 'operator-1' },
      finalizedAt: '2026-07-13T12:00:00.000Z',
      fingerprint: 'a'.repeat(64),
      anchorEvidenceRefs: [{
        sourceType: 'voice_sample',
        sourceId: 'vs-1',
        voiceSampleSource: 'manual',
        capturedAt: '2026-07-13T11:00:00.000Z',
        selectedBy: { actorType: 'operator', actorId: 'operator-1' },
        selectedAt: '2026-07-13T12:00:00.000Z',
      }],
    };
    expect(finalizedVoiceSnapshotRefSchema.safeParse(ref).success).toBe(true);
    expect(finalizedVoiceSnapshotRefSchema.safeParse({
      ...ref,
      finalizedBy: { actorType: 'mcp', actorId: 'key-1' },
    }).success).toBe(false);
    expect(finalizedVoiceSnapshotRefSchema.safeParse({
      ...ref,
      anchorEvidenceRefs: [{
        ...ref.anchorEvidenceRefs[0],
        voiceSampleSource: 'calibration_loop',
      }],
    }).success).toBe(false);
    expect(finalizedVoiceSnapshotRefSchema.safeParse({
      ...ref,
      fingerprint: 'not-a-fingerprint',
    }).success).toBe(false);
  });

  it('keeps MCP finalization bound to an operator authorization instead of caller identity', () => {
    expect(getBrandVoiceInputSchema.parse({ workspace_id: 'ws-1' })).toEqual({
      workspace_id: 'ws-1',
    });
    expect(finalizeBrandVoiceMcpInputSchema.parse({
      workspace_id: 'ws-1',
      authorization_token: 'opaque-one-time-secret',
    })).toEqual({
      workspace_id: 'ws-1',
      authorization_token: 'opaque-one-time-secret',
    });
    expect(finalizeBrandVoiceMcpInputSchema.safeParse({
      workspace_id: 'ws-1',
      operator_id: 'forged-operator',
      authorization_token: 'opaque-one-time-secret',
    }).success).toBe(false);
  });

  it('freezes full snapshot content rather than relying on mutable profile fields', () => {
    type SnapshotRequiresFrozenDNA = FinalizedVoiceSnapshot['voiceDNA'];
    type SnapshotRequiresFrozenAnchors = FinalizedVoiceSnapshot['anchors'];
    const frozenDNA: SnapshotRequiresFrozenDNA = validBody.voiceDNA;
    const frozenAnchors: SnapshotRequiresFrozenAnchors = [{
      selector: { kind: 'voice_sample', voiceSampleId: 'vs-1' },
      content: 'A real client-authored line.',
      context: 'body',
      evidenceRef: {
        sourceType: 'voice_sample',
        sourceId: 'vs-1',
        voiceSampleSource: 'manual',
        capturedAt: '2026-07-13T11:00:00.000Z',
        selectedBy: { actorType: 'operator', actorId: 'operator-1' },
        selectedAt: '2026-07-13T12:00:00.000Z',
      },
    }];
    expect(frozenDNA.personalityTraits).toHaveLength(1);
    expect(frozenAnchors).toHaveLength(1);
  });
});

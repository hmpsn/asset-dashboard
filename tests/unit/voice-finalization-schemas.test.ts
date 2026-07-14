import { describe, expect, it } from 'vitest';

import { VOICE_FINALIZATION_LIMITS } from '../../shared/types/voice-finalization.js';
import {
  createVoiceFinalizationAuthorizationBodySchema,
  finalizeBrandVoiceBodySchema,
  finalizedVoiceSnapshotSchema,
  voiceGuardrailsSchema,
  voiceDNASchema,
} from '../../shared/types/voice-finalization-schemas.js';

const encoder = new TextEncoder();
const JSON_LIMITS = {
  profileColumn: 128 * 1024,
  snapshotArray: VOICE_FINALIZATION_LIMITS.maxSnapshotJsonBytes,
  authorizationRequest: VOICE_FINALIZATION_LIMITS.maxAuthorizationJsonBytes,
} as const;
const timestamp = '2026-07-13T12:00:00.000Z';
const operator = { actorType: 'operator' as const, actorId: 'operator-1' };

function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

interface MutableStringField {
  get(): string;
  set(value: string): void;
  maxLength: number;
}

function rawUtf8Filler(byteLength: number): string {
  const threeByteCharacters = Math.floor(byteLength / 3);
  const remainder = byteLength % 3;
  return '界'.repeat(threeByteCharacters)
    + (remainder === 2 ? 'é' : remainder === 1 ? 'x' : '');
}

function escapedJsonFiller(byteLength: number): string {
  const escapedCharacters = Math.floor(byteLength / 6);
  return '\u0001'.repeat(escapedCharacters) + 'x'.repeat(byteLength % 6);
}

function growJsonToExactBytes(
  value: unknown,
  target: number,
  fields: MutableStringField[],
  mode: 'ascii' | 'multibyte' | 'json-escaped',
): void {
  let remaining = target - jsonBytes(value);
  if (remaining < 0) throw new Error(`Fixture already exceeds ${target} bytes`);

  for (const field of fields) {
    if (remaining === 0) break;
    const capacity = field.maxLength - field.get().length;
    const bytesPerCharacter = mode === 'ascii' ? 1 : mode === 'multibyte' ? 3 : 6;
    const addedBytes = Math.min(remaining, capacity * bytesPerCharacter);
    const filler = mode === 'ascii'
      ? 'x'.repeat(addedBytes)
      : mode === 'multibyte'
        ? rawUtf8Filler(addedBytes)
        : escapedJsonFiller(addedBytes);
    if (filler.length > capacity) {
      throw new Error(`Cannot represent ${addedBytes} bytes in ${capacity} characters`);
    }
    field.set(field.get() + filler);
    remaining -= addedBytes;
  }

  if (remaining !== 0 || jsonBytes(value) !== target) {
    throw new Error(`Could not build exact ${target}-byte JSON fixture`);
  }
}

function expectByteLimitFailure(
  schemaResult: ReturnType<typeof finalizeBrandVoiceBodySchema.safeParse>,
  message: string,
): void {
  expect(schemaResult.success).toBe(false);
  if (schemaResult.success) return;
  expect(schemaResult.error.issues.map(issue => issue.message)).toContain(message);
}

function makeDNA() {
  return {
    personalityTraits: Array.from({ length: 20 }, () => 'x'),
    toneSpectrum: {
      formal_casual: 6,
      serious_playful: 4,
      technical_accessible: 8,
    },
    sentenceStyle: 'x',
    vocabularyLevel: 'x',
    humorStyle: 'x',
  };
}

function dnaFields(dna: ReturnType<typeof makeDNA>): MutableStringField[] {
  return [
    ...dna.personalityTraits.map((_, index) => ({
      get: () => dna.personalityTraits[index],
      set: (value: string) => { dna.personalityTraits[index] = value; },
      maxLength: VOICE_FINALIZATION_LIMITS.maxShortTextLength,
    })),
    {
      get: () => dna.sentenceStyle,
      set: (value: string) => { dna.sentenceStyle = value; },
      maxLength: VOICE_FINALIZATION_LIMITS.maxTextLength,
    },
    {
      get: () => dna.vocabularyLevel,
      set: (value: string) => { dna.vocabularyLevel = value; },
      maxLength: VOICE_FINALIZATION_LIMITS.maxTextLength,
    },
    {
      get: () => dna.humorStyle,
      set: (value: string) => { dna.humorStyle = value; },
      maxLength: VOICE_FINALIZATION_LIMITS.maxTextLength,
    },
  ];
}

function makeGuardrails() {
  return {
    forbiddenWords: [] as string[],
    requiredTerminology: [] as Array<{ use: string; insteadOf: string }>,
    toneBoundaries: Array.from({ length: 20 }, (_, index) => index === 0 ? '界' : 'x'),
    antiPatterns: [] as string[],
  };
}

function guardrailFields(guardrails: ReturnType<typeof makeGuardrails>): MutableStringField[] {
  return guardrails.toneBoundaries.map((_, index) => ({
    get: () => guardrails.toneBoundaries[index],
    set: (value: string) => { guardrails.toneBoundaries[index] = value; },
    maxLength: VOICE_FINALIZATION_LIMITS.maxTextLength,
  }));
}

function makeContextModifiers() {
  return Array.from({ length: VOICE_FINALIZATION_LIMITS.maxContextModifiers }, (_, index) => ({
    context: `context-${index}`,
    description: index === 0 ? '界' : 'x',
  }));
}

function contextModifierFields(
  modifiers: ReturnType<typeof makeContextModifiers>,
): MutableStringField[] {
  return modifiers.map(modifier => ({
    get: () => modifier.description,
    set: (value: string) => { modifier.description = value; },
    maxLength: VOICE_FINALIZATION_LIMITS.maxTextLength,
  }));
}

function evidenceRef(index: number) {
  return {
    sourceType: 'voice_sample' as const,
    sourceId: `sample-${index}`,
    voiceSampleSource: 'manual' as const,
    capturedAt: timestamp,
    selectedBy: operator,
    selectedAt: timestamp,
  };
}

function makeAnchors() {
  return Array.from({ length: VOICE_FINALIZATION_LIMITS.maxAnchors }, (_, index) => ({
    selector: { kind: 'voice_sample' as const, voiceSampleId: `sample-${index}` },
    content: 'x',
    context: 'body' as const,
    evidenceRef: evidenceRef(index),
  }));
}

function anchorFields(anchors: ReturnType<typeof makeAnchors>): MutableStringField[] {
  return anchors.map(anchor => ({
    get: () => anchor.content,
    set: (value: string) => { anchor.content = value; },
    maxLength: VOICE_FINALIZATION_LIMITS.maxTextLength,
  }));
}

function makeCalibrationSnapshots() {
  return Array.from(
    { length: VOICE_FINALIZATION_LIMITS.maxCalibrationSelections },
    (_, index) => ({
      sessionId: `session-${index}`,
      variationIndex: 0,
      rating: 'on_brand' as const,
      selected: true,
      promptType: 'body',
      variationText: 'x',
    }),
  );
}

function calibrationSnapshotFields(
  selections: ReturnType<typeof makeCalibrationSnapshots>,
): MutableStringField[] {
  return selections.map(selection => ({
    get: () => selection.variationText,
    set: (value: string) => { selection.variationText = value; },
    maxLength: VOICE_FINALIZATION_LIMITS.maxTextLength,
  }));
}

function makeSnapshot(overrides: Record<string, unknown> = {}) {
  const anchors = makeAnchors().slice(0, 1);
  return {
    id: 'finalization-1',
    workspaceId: 'workspace-1',
    voiceProfileId: 'profile-1',
    voiceVersion: 1,
    profileRevision: 2,
    voiceDNA: {
      personalityTraits: ['Warm and exact'],
      toneSpectrum: {
        formal_casual: 6,
        serious_playful: 4,
        technical_accessible: 8,
      },
      sentenceStyle: 'Short sentences.',
      vocabularyLevel: 'Plain language.',
    },
    guardrails: {
      forbiddenWords: ['miracle'],
      requiredTerminology: [],
      toneBoundaries: ['Never pressure the reader.'],
      antiPatterns: [],
    },
    contextModifiers: [],
    anchors,
    calibrationSelections: [],
    finalizedBy: operator,
    executionActor: operator,
    finalizedAt: timestamp,
    createdAt: timestamp,
    fingerprint: 'a'.repeat(64),
    anchorEvidenceRefs: anchors.map(anchor => anchor.evidenceRef),
    ...overrides,
  };
}

function makeAuthorizationBody() {
  return {
    expectedProfileRevision: 4,
    voiceDNA: {
      personalityTraits: ['Warm and exact'],
      toneSpectrum: {
        formal_casual: 6,
        serious_playful: 4,
        technical_accessible: 8,
      },
      sentenceStyle: 'Short sentences.',
      vocabularyLevel: 'Plain language.',
    },
    guardrails: {
      forbiddenWords: ['miracle'],
      requiredTerminology: [],
      toneBoundaries: ['Never pressure the reader.'],
      antiPatterns: [],
    },
    contextModifiers: [],
    anchorSelectors: [{ kind: 'voice_sample' as const, voiceSampleId: 'sample-1' }],
    calibrationSelections: Array.from(
      { length: VOICE_FINALIZATION_LIMITS.maxCalibrationSelections },
      (_, index) => ({
        sessionId: `session-${index}`,
        variationIndex: 0,
        rating: 'on_brand' as const,
        selected: true,
        feedback: 'x',
      }),
    ),
    idempotencyKey: 'finalize-1',
  };
}

function authorizationFeedbackFields(
  body: ReturnType<typeof makeAuthorizationBody>,
): MutableStringField[] {
  return body.calibrationSelections.map(selection => ({
    get: () => selection.feedback,
    set: (value: string) => { selection.feedback = value; },
    maxLength: 2_000,
  }));
}

describe('voice finalization UTF-8 JSON storage limits', () => {
  it('matches the 128 KiB voice DNA column boundary after JSON escaping', () => {
    const dna = makeDNA();
    growJsonToExactBytes(
      dna,
      JSON_LIMITS.profileColumn,
      dnaFields(dna),
      'json-escaped',
    );

    expect(jsonBytes(dna)).toBe(JSON_LIMITS.profileColumn);
    expect(voiceDNASchema.safeParse(dna).success).toBe(true);

    const field = dnaFields(dna).find(candidate => candidate.get().length < candidate.maxLength);
    expect(field).toBeDefined();
    field?.set(`${field.get()}x`);
    const over = voiceDNASchema.safeParse(dna);
    expect(over.success).toBe(false);
    if (!over.success) {
      expect(over.error.issues.map(issue => issue.message)).toContain(
        'Voice DNA JSON exceeds 131072 UTF-8 JSON bytes.',
      );
    }
  });

  it('matches the 128 KiB guardrail and context-modifier column boundaries', () => {
    const guardrails = makeGuardrails();
    growJsonToExactBytes(
      guardrails,
      JSON_LIMITS.profileColumn,
      guardrailFields(guardrails),
      'ascii',
    );
    expect(jsonBytes(guardrails)).toBe(JSON_LIMITS.profileColumn);
    expect(voiceGuardrailsSchema.safeParse(guardrails).success).toBe(true);
    const guardrailField = guardrailFields(guardrails)
      .find(candidate => candidate.get().length < candidate.maxLength);
    guardrailField?.set(`${guardrailField.get()}x`);
    const guardrailOver = voiceGuardrailsSchema.safeParse(guardrails);
    expect(guardrailOver.success).toBe(false);
    if (!guardrailOver.success) {
      expect(guardrailOver.error.issues.map(issue => issue.message)).toContain(
        'Voice guardrails JSON exceeds 131072 UTF-8 JSON bytes.',
      );
    }

    const contextModifiers = makeContextModifiers();
    growJsonToExactBytes(
      contextModifiers,
      JSON_LIMITS.profileColumn,
      contextModifierFields(contextModifiers),
      'ascii',
    );
    const exactBody = { ...makeAuthorizationBody(), contextModifiers, calibrationSelections: [] };
    expect(jsonBytes(contextModifiers)).toBe(JSON_LIMITS.profileColumn);
    expect(finalizeBrandVoiceBodySchema.safeParse(exactBody).success).toBe(true);
    const modifierField = contextModifierFields(contextModifiers)
      .find(candidate => candidate.get().length < candidate.maxLength);
    modifierField?.set(`${modifierField.get()}x`);
    expectByteLimitFailure(
      finalizeBrandVoiceBodySchema.safeParse(exactBody),
      'Voice context modifiers JSON exceeds 131072 UTF-8 JSON bytes.',
    );
  });

  it('matches the 512 KiB multibyte anchor-snapshot column boundary', () => {
    const anchors = makeAnchors();
    growJsonToExactBytes(
      anchors,
      JSON_LIMITS.snapshotArray,
      anchorFields(anchors),
      'multibyte',
    );
    const snapshot = makeSnapshot({
      anchors,
      anchorEvidenceRefs: anchors.map(anchor => anchor.evidenceRef),
    });

    expect(anchors.some(anchor => anchor.content.includes('界'))).toBe(true);
    expect(jsonBytes(anchors)).toBe(JSON_LIMITS.snapshotArray);
    expect(finalizedVoiceSnapshotSchema.safeParse(snapshot).success).toBe(true);

    const field = anchorFields(anchors).find(candidate => candidate.get().length < candidate.maxLength);
    field?.set(`${field.get()}x`);
    const over = finalizedVoiceSnapshotSchema.safeParse(snapshot);
    expect(over.success).toBe(false);
    if (!over.success) {
      expect(over.error.issues.map(issue => issue.message)).toContain(
        'Finalized voice anchors JSON exceeds 524288 UTF-8 JSON bytes.',
      );
    }
  });

  it('matches the 512 KiB calibration-snapshot column boundary', () => {
    const calibrationSelections = makeCalibrationSnapshots();
    growJsonToExactBytes(
      calibrationSelections,
      JSON_LIMITS.snapshotArray,
      calibrationSnapshotFields(calibrationSelections),
      'ascii',
    );
    const snapshot = makeSnapshot({ calibrationSelections });

    expect(jsonBytes(calibrationSelections)).toBe(JSON_LIMITS.snapshotArray);
    expect(finalizedVoiceSnapshotSchema.safeParse(snapshot).success).toBe(true);

    const field = calibrationSnapshotFields(calibrationSelections)
      .find(candidate => candidate.get().length < candidate.maxLength);
    field?.set(`${field.get()}x`);
    const over = finalizedVoiceSnapshotSchema.safeParse(snapshot);
    expect(over.success).toBe(false);
    if (!over.success) {
      expect(over.error.issues.map(issue => issue.message)).toContain(
        'Voice calibration selections JSON exceeds 524288 UTF-8 JSON bytes.',
      );
    }
  });

  it('matches the 512 KiB stored authorization-request boundary with multibyte input', () => {
    const body = makeAuthorizationBody();
    growJsonToExactBytes(
      body,
      JSON_LIMITS.authorizationRequest,
      authorizationFeedbackFields(body),
      'multibyte',
    );

    expect(body.calibrationSelections.some(selection => selection.feedback.includes('界')))
      .toBe(true);
    expect(jsonBytes(body)).toBe(JSON_LIMITS.authorizationRequest);
    expect(createVoiceFinalizationAuthorizationBodySchema.safeParse(body).success).toBe(true);

    const field = authorizationFeedbackFields(body)
      .find(candidate => candidate.get().length < candidate.maxLength);
    field?.set(`${field.get()}x`);
    expectByteLimitFailure(
      createVoiceFinalizationAuthorizationBodySchema.safeParse(body),
      'Voice finalization authorization request JSON exceeds 524288 UTF-8 JSON bytes.',
    );
    expect(finalizeBrandVoiceBodySchema.safeParse(body).success).toBe(true);
  });
});

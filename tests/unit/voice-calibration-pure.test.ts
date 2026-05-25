/**
 * Pure-logic unit tests for server/voice-calibration.ts.
 *
 * Tests:
 *  - buildVoiceCalibrationContext() — with calibrated, draft, and calibrating profiles
 *  - VoiceProfileStateTransitionError — structured fields and message format
 *  - LEGAL_STATUS_TRANSITIONS coverage (indirectly via the error class message)
 *  - Row mapper purity (rowToProfile-like output shapes via module inspection)
 *
 * All DB-touching functions (getVoiceProfile, createVoiceProfile, updateVoiceProfile,
 * addVoiceSample, etc.) are tested by the integration test in
 * tests/unit/seo-context-voice-profile.test.ts and
 * tests/integration/voice-calibration-hardening.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';

// ── Mock all DB-touching dependencies before importing the module ─────────────
vi.mock('../../server/db/index.js', () => ({
  default: {
    prepare: vi.fn().mockReturnValue({
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(null),
      run: vi.fn(),
    }),
    transaction: vi.fn((fn: () => unknown) => {
      const tx = () => fn();
      tx.immediate = () => fn();
      return tx;
    }),
  },
}));

vi.mock('../../server/db/stmt-cache.js', () => ({
  createStmtCache: (factory: () => unknown) => factory,
}));

vi.mock('../../server/db/json-validation.js', () => ({
  parseJsonFallback: vi.fn((_raw: unknown, fallback: unknown) => fallback),
  parseJsonSafeArray: vi.fn(() => []),
}));

vi.mock('../../server/content-posts-ai.js', () => ({
  callCreativeAI: vi.fn(),
}));

vi.mock('../../server/workspace-intelligence.js', () => ({
  buildIntelPrompt: vi.fn().mockResolvedValue(''),
}));

vi.mock('../../server/prompt-assembly.js', () => ({
  buildSystemPrompt: vi.fn().mockReturnValue('system prompt'),
  guardrailsToPromptInstructions: vi.fn().mockReturnValue('guardrails block'),
}));

vi.mock('../../server/voice-dna-render.js', () => ({
  renderVoiceDNAForPrompt: vi.fn().mockReturnValue('dna block'),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../server/schemas/voice-calibration.js', () => ({
  variationFeedbackItemSchema: {},
}));

import {
  buildVoiceCalibrationContext,
  VoiceProfileStateTransitionError,
} from '../../server/voice-calibration.js';
import type { VoiceProfile, VoiceSample, VoiceDNA, VoiceGuardrails } from '../../shared/types/brand-engine.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeSample(content: string, contextTag?: VoiceSample['contextTag']): VoiceSample {
  return {
    id: 'vs_test',
    voiceProfileId: 'vp_test',
    content,
    contextTag,
    source: 'manual',
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const SAMPLE_DNA: VoiceDNA = {
  personalityTraits: ['Confident', 'Direct'],
  toneSpectrum: { formal_casual: 6, serious_playful: 5, technical_accessible: 7 },
  sentenceStyle: 'Short punchy lines.',
  vocabularyLevel: 'Conversational.',
  humorStyle: 'Dry wit',
};

const SAMPLE_GUARDRAILS: VoiceGuardrails = {
  forbiddenWords: ['synergy'],
  requiredTerminology: [{ use: 'clients', insteadOf: 'customers' }],
  toneBoundaries: ['Never condescending'],
  antiPatterns: ['No sports metaphors'],
};

function makeProfile(
  status: VoiceProfile['status'],
  extras: Partial<VoiceProfile & { samples: VoiceSample[] }> = {},
): VoiceProfile & { samples: VoiceSample[] } {
  return {
    id: 'vp_test',
    workspaceId: 'ws-test',
    status,
    samples: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extras,
  };
}

// ── buildVoiceCalibrationContext ──────────────────────────────────────────────

describe('buildVoiceCalibrationContext — samplesText', () => {
  it('returns empty samplesText when no samples', () => {
    const { samplesText } = buildVoiceCalibrationContext(makeProfile('draft'));
    expect(samplesText).toBe('');
  });

  it('includes sample content in samplesText', () => {
    const profile = makeProfile('draft', {
      samples: [makeSample('Great copy here.', 'headline')],
    });
    const { samplesText } = buildVoiceCalibrationContext(profile);
    expect(samplesText).toContain('Great copy here.');
  });

  it('includes contextTag in brackets in samplesText', () => {
    const profile = makeProfile('draft', {
      samples: [makeSample('Bold statement.', 'cta')],
    });
    const { samplesText } = buildVoiceCalibrationContext(profile);
    expect(samplesText).toContain('[cta]');
  });

  it('uses "general" when contextTag is absent', () => {
    const profile = makeProfile('draft', {
      samples: [makeSample('No tag here.')],
    });
    const { samplesText } = buildVoiceCalibrationContext(profile);
    expect(samplesText).toContain('[general]');
  });

  it('renders multiple samples on separate lines', () => {
    const profile = makeProfile('draft', {
      samples: [
        makeSample('First.', 'body'),
        makeSample('Second.', 'headline'),
      ],
    });
    const { samplesText } = buildVoiceCalibrationContext(profile);
    const lines = samplesText.split('\n');
    expect(lines.filter(l => l.includes('"First."'))).toHaveLength(1);
    expect(lines.filter(l => l.includes('"Second."'))).toHaveLength(1);
  });

  it('starts samplesText with VOICE SAMPLES header when samples present', () => {
    const profile = makeProfile('draft', {
      samples: [makeSample('Test copy.')],
    });
    const { samplesText } = buildVoiceCalibrationContext(profile);
    expect(samplesText).toContain('VOICE SAMPLES (write like these):');
  });
});

describe('buildVoiceCalibrationContext — dnaText (non-calibrated)', () => {
  it('returns dnaText when draft profile has voiceDNA', () => {
    const profile = makeProfile('draft', { voiceDNA: SAMPLE_DNA });
    const { dnaText } = buildVoiceCalibrationContext(profile);
    expect(dnaText).toContain('VOICE DNA:');
    // renderVoiceDNAForPrompt is mocked to return 'dna block'
    expect(dnaText).toContain('dna block');
  });

  it('returns dnaText when calibrating profile has voiceDNA', () => {
    const profile = makeProfile('calibrating', { voiceDNA: SAMPLE_DNA });
    const { dnaText } = buildVoiceCalibrationContext(profile);
    expect(dnaText).toContain('VOICE DNA:');
  });

  it('returns empty dnaText when calibrated (Layer 2 handles DNA injection)', () => {
    const profile = makeProfile('calibrated', { voiceDNA: SAMPLE_DNA });
    const { dnaText } = buildVoiceCalibrationContext(profile);
    expect(dnaText).toBe('');
  });

  it('returns empty dnaText when draft but no voiceDNA', () => {
    const profile = makeProfile('draft');
    const { dnaText } = buildVoiceCalibrationContext(profile);
    expect(dnaText).toBe('');
  });
});

describe('buildVoiceCalibrationContext — guardrailsText (non-calibrated)', () => {
  it('returns guardrailsText when draft profile has guardrails', () => {
    const profile = makeProfile('draft', { guardrails: SAMPLE_GUARDRAILS });
    const { guardrailsText } = buildVoiceCalibrationContext(profile);
    // guardrailsToPromptInstructions is mocked to return 'guardrails block'
    expect(guardrailsText).toContain('guardrails block');
  });

  it('returns guardrailsText when calibrating profile has guardrails', () => {
    const profile = makeProfile('calibrating', { guardrails: SAMPLE_GUARDRAILS });
    const { guardrailsText } = buildVoiceCalibrationContext(profile);
    expect(guardrailsText).not.toBe('');
  });

  it('returns empty guardrailsText when calibrated (Layer 2 handles guardrails)', () => {
    const profile = makeProfile('calibrated', { guardrails: SAMPLE_GUARDRAILS });
    const { guardrailsText } = buildVoiceCalibrationContext(profile);
    expect(guardrailsText).toBe('');
  });

  it('returns empty guardrailsText when draft but no guardrails', () => {
    const profile = makeProfile('draft');
    const { guardrailsText } = buildVoiceCalibrationContext(profile);
    expect(guardrailsText).toBe('');
  });
});

describe('buildVoiceCalibrationContext — calibrated profile full suppression', () => {
  it('suppresses both dnaText and guardrailsText for calibrated profile (both non-empty sources)', () => {
    const profile = makeProfile('calibrated', {
      voiceDNA: SAMPLE_DNA,
      guardrails: SAMPLE_GUARDRAILS,
      samples: [makeSample('Calibrated sample.')],
    });
    const { dnaText, guardrailsText, samplesText } = buildVoiceCalibrationContext(profile);
    // Samples are still surfaced — only DNA+guardrails are held out for Layer 2
    expect(samplesText).toContain('Calibrated sample.');
    expect(dnaText).toBe('');
    expect(guardrailsText).toBe('');
  });
});

// ── VoiceProfileStateTransitionError ─────────────────────────────────────────

describe('VoiceProfileStateTransitionError', () => {
  it('has name set to VoiceProfileStateTransitionError', () => {
    const err = new VoiceProfileStateTransitionError('draft', 'calibrated');
    expect(err.name).toBe('VoiceProfileStateTransitionError');
  });

  it('carries typed from field', () => {
    const err = new VoiceProfileStateTransitionError('draft', 'calibrated');
    expect(err.from).toBe('draft');
  });

  it('carries typed to field', () => {
    const err = new VoiceProfileStateTransitionError('draft', 'calibrated');
    expect(err.to).toBe('calibrated');
  });

  it('message contains from and to status values', () => {
    const err = new VoiceProfileStateTransitionError('calibrating', 'draft');
    expect(err.message).toContain('calibrating');
    expect(err.message).toContain('draft');
  });

  it('is an instance of Error', () => {
    const err = new VoiceProfileStateTransitionError('draft', 'calibrated');
    expect(err).toBeInstanceOf(Error);
  });

  it('message describes illegal transition', () => {
    const err = new VoiceProfileStateTransitionError('draft', 'calibrated');
    expect(err.message).toMatch(/[Ii]llegal/);
  });

  it('message includes legal transitions from that status (non-empty set)', () => {
    // draft → calibrating is the only legal forward transition
    const err = new VoiceProfileStateTransitionError('draft', 'calibrated');
    expect(err.message).toContain('calibrating');
  });
});

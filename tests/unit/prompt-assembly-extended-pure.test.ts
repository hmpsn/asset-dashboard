/**
 * Extended pure-logic unit tests for server/prompt-assembly.ts.
 *
 * Coverage adds: voiceDNAToPromptInstructions edge cases (tone spectrum
 * boundaries, missing optional fields), guardrailsToPromptInstructions
 * with empty/populated arrays, buildSystemPrompt with pre-fetched notes
 * and skipProseRules flag.
 *
 * Avoids duplication with server/__tests__/prompt-assembly.test.ts (which
 * tests buildSystemPrompt with a real DB workspace row).
 */
import { describe, it, expect, vi } from 'vitest';

// ── DB mock (module-level lazy stmtCache must be satisfied) ─────────────────
vi.mock('../../server/db/index.js', () => ({
  default: {
    prepare: vi.fn().mockReturnValue({
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(null),
      run: vi.fn(),
    }),
  },
}));

vi.mock('../../server/db/stmt-cache.js', () => ({
  createStmtCache: (factory: () => unknown) => factory,
}));

vi.mock('../../server/db/json-validation.js', () => ({
  parseJsonFallback: vi.fn((_raw: unknown, fallback: unknown) => fallback),
}));

vi.mock('../../server/errors.js', () => ({
  isProgrammingError: vi.fn().mockReturnValue(false),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('../../server/writing-quality.js', () => ({
  PROSE_QUALITY_RULES: 'PROSE QUALITY',
}));

import {
  voiceDNAToPromptInstructions,
  guardrailsToPromptInstructions,
  buildSystemPrompt,
} from '../../server/prompt-assembly.js';
import type { VoiceDNA, VoiceGuardrails } from '../../shared/types/brand-engine.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeDNA(overrides: Partial<VoiceDNA> = {}): VoiceDNA {
  return {
    personalityTraits: ['Confident', 'Direct'],
    toneSpectrum: { formal_casual: 5, serious_playful: 5, technical_accessible: 5 },
    sentenceStyle: 'Short punchy lines.',
    vocabularyLevel: 'Conversational, 8th grade.',
    ...overrides,
  };
}

function makeGuardrails(overrides: Partial<VoiceGuardrails> = {}): VoiceGuardrails {
  return {
    forbiddenWords: [],
    requiredTerminology: [],
    toneBoundaries: [],
    antiPatterns: [],
    ...overrides,
  };
}

// ── voiceDNAToPromptInstructions ─────────────────────────────────────────────

describe('voiceDNAToPromptInstructions — tone spectrum boundary mappings', () => {
  it('maps formal_casual >= 7 to "conversational and casual"', () => {
    const result = voiceDNAToPromptInstructions(makeDNA({ toneSpectrum: { formal_casual: 7, serious_playful: 5, technical_accessible: 5 } }));
    expect(result).toContain('conversational and casual');
  });

  it('maps formal_casual <= 3 to "formal and professional"', () => {
    const result = voiceDNAToPromptInstructions(makeDNA({ toneSpectrum: { formal_casual: 3, serious_playful: 5, technical_accessible: 5 } }));
    expect(result).toContain('formal and professional');
  });

  it('maps formal_casual 4-6 to "professional but approachable"', () => {
    const result = voiceDNAToPromptInstructions(makeDNA({ toneSpectrum: { formal_casual: 5, serious_playful: 5, technical_accessible: 5 } }));
    expect(result).toContain('professional but approachable');
  });

  it('maps serious_playful >= 7 to "playful — humor welcome"', () => {
    const result = voiceDNAToPromptInstructions(makeDNA({ toneSpectrum: { formal_casual: 5, serious_playful: 8, technical_accessible: 5 } }));
    expect(result).toContain('playful — humor welcome');
  });

  it('maps serious_playful <= 3 to "serious — no jokes"', () => {
    const result = voiceDNAToPromptInstructions(makeDNA({ toneSpectrum: { formal_casual: 5, serious_playful: 2, technical_accessible: 5 } }));
    expect(result).toContain('serious — no jokes');
  });

  it('maps serious_playful 4-6 to "measured — light warmth only"', () => {
    const result = voiceDNAToPromptInstructions(makeDNA({ toneSpectrum: { formal_casual: 5, serious_playful: 5, technical_accessible: 5 } }));
    expect(result).toContain('measured — light warmth only');
  });

  it('maps technical_accessible >= 7 to "plain language — avoid jargon"', () => {
    const result = voiceDNAToPromptInstructions(makeDNA({ toneSpectrum: { formal_casual: 5, serious_playful: 5, technical_accessible: 9 } }));
    expect(result).toContain('plain language — avoid jargon');
  });

  it('maps technical_accessible <= 3 to "technical — assume domain expertise"', () => {
    const result = voiceDNAToPromptInstructions(makeDNA({ toneSpectrum: { formal_casual: 5, serious_playful: 5, technical_accessible: 1 } }));
    expect(result).toContain('technical — assume domain expertise');
  });

  it('maps technical_accessible 4-6 to "balanced — define terms where helpful"', () => {
    const result = voiceDNAToPromptInstructions(makeDNA({ toneSpectrum: { formal_casual: 5, serious_playful: 5, technical_accessible: 5 } }));
    expect(result).toContain('balanced — define terms where helpful');
  });
});

describe('voiceDNAToPromptInstructions — optional and required fields', () => {
  it('includes humorStyle line when humorStyle is present', () => {
    const result = voiceDNAToPromptInstructions(makeDNA({ humorStyle: 'Self-deprecating, dry' }));
    expect(result).toContain('Humor: Self-deprecating, dry');
  });

  it('omits humorStyle line when humorStyle is absent', () => {
    const dna = makeDNA();
    delete dna.humorStyle;
    const result = voiceDNAToPromptInstructions(dna);
    expect(result).not.toContain('Humor:');
  });

  it('includes personality traits when present', () => {
    const result = voiceDNAToPromptInstructions(makeDNA({ personalityTraits: ['Witty', 'Direct'] }));
    expect(result).toContain('Personality: Witty, Direct');
  });

  it('omits personality line when personalityTraits is empty', () => {
    const result = voiceDNAToPromptInstructions(makeDNA({ personalityTraits: [] }));
    expect(result).not.toContain('Personality:');
  });

  it('includes sentenceStyle and vocabularyLevel always', () => {
    const result = voiceDNAToPromptInstructions(makeDNA({ sentenceStyle: 'Mix short and long.', vocabularyLevel: 'Technical' }));
    expect(result).toContain('Sentence style: Mix short and long.');
    expect(result).toContain('Vocabulary: Technical');
  });

  it('starts with voice profile header line', () => {
    const result = voiceDNAToPromptInstructions(makeDNA());
    expect(result.startsWith('Voice profile for this client:')).toBe(true);
  });
});

// ── guardrailsToPromptInstructions ────────────────────────────────────────────

describe('guardrailsToPromptInstructions — empty arrays', () => {
  it('returns only the header when all arrays are empty', () => {
    const result = guardrailsToPromptInstructions(makeGuardrails());
    expect(result.trim()).toBe('Voice guardrails:');
  });
});

describe('guardrailsToPromptInstructions — populated arrays', () => {
  it('includes forbidden words joined by comma', () => {
    const result = guardrailsToPromptInstructions(makeGuardrails({ forbiddenWords: ['synergy', 'disruptive'] }));
    expect(result).toContain('Never use: synergy, disruptive');
  });

  it('includes required terminology in "use (not insteadOf)" format', () => {
    const result = guardrailsToPromptInstructions(makeGuardrails({
      requiredTerminology: [{ use: 'clients', insteadOf: 'customers' }],
    }));
    expect(result).toContain('"clients" (not "customers")');
  });

  it('includes multiple required terminology entries comma-separated', () => {
    const result = guardrailsToPromptInstructions(makeGuardrails({
      requiredTerminology: [
        { use: 'clients', insteadOf: 'customers' },
        { use: 'strategy', insteadOf: 'plan' },
      ],
    }));
    expect(result).toContain('"clients" (not "customers"), "strategy" (not "plan")');
  });

  it('includes tone boundaries joined by semicolon', () => {
    const result = guardrailsToPromptInstructions(makeGuardrails({ toneBoundaries: ['Never condescending', 'Avoid fear-based copy'] }));
    expect(result).toContain('Tone boundaries: Never condescending; Avoid fear-based copy');
  });

  it('includes anti-patterns joined by semicolon', () => {
    const result = guardrailsToPromptInstructions(makeGuardrails({ antiPatterns: ['No sports metaphors', 'No military language'] }));
    expect(result).toContain('Avoid: No sports metaphors; No military language');
  });

  it('renders all sections together in correct order', () => {
    const result = guardrailsToPromptInstructions(makeGuardrails({
      forbiddenWords: ['synergy'],
      requiredTerminology: [{ use: 'clients', insteadOf: 'customers' }],
      toneBoundaries: ['Never condescending'],
      antiPatterns: ['No jargon'],
    }));
    const lines = result.split('\n');
    expect(lines[0]).toBe('Voice guardrails:');
    expect(result).toContain('Never use:');
    expect(result).toContain('Preferred terms:');
    expect(result).toContain('Tone boundaries:');
    expect(result).toContain('Avoid:');
  });
});

// ── buildSystemPrompt — pre-fetched notes and skipProseRules ─────────────────

describe('buildSystemPrompt — pre-fetched customNotes', () => {
  it('uses pre-fetched notes string without querying DB again', () => {
    const result = buildSystemPrompt('ws-test', 'Base instructions', 'Pre-fetched ROI framing');
    expect(result).toContain('Pre-fetched ROI framing');
    expect(result).toContain('Base instructions');
  });

  it('ignores null pre-fetched notes gracefully', () => {
    const result = buildSystemPrompt('ws-test', 'Base instructions', null);
    expect(result).toContain('Base instructions');
    expect(result).not.toContain('Additional context');
  });

  it('ignores empty string pre-fetched notes', () => {
    const result = buildSystemPrompt('ws-test', 'Base instructions', '');
    expect(result).not.toContain('Additional context');
  });
});

describe('buildSystemPrompt — skipProseRules option', () => {
  it('injects PROSE_QUALITY_RULES by default', () => {
    const result = buildSystemPrompt('ws-test', 'Base instructions');
    expect(result).toContain('PROSE QUALITY');
  });

  it('omits PROSE_QUALITY_RULES when skipProseRules is true', () => {
    const result = buildSystemPrompt('ws-test', 'Base instructions', null, { skipProseRules: true });
    expect(result).not.toContain('PROSE QUALITY');
  });

  it('includes PROSE_QUALITY_RULES when skipProseRules is false', () => {
    const result = buildSystemPrompt('ws-test', 'Base instructions', null, { skipProseRules: false });
    expect(result).toContain('PROSE QUALITY');
  });
});

describe('buildSystemPrompt — part joining', () => {
  it('joins parts with double newline separator', () => {
    const result = buildSystemPrompt('ws-test', 'Base instructions', 'Notes here', { skipProseRules: true });
    // Each part is separated by \n\n
    expect(result).toContain('Base instructions\n\n');
    expect(result).toContain('Notes here');
  });

  it('always starts with base instructions', () => {
    const result = buildSystemPrompt('ws-test', 'MY BASE', 'extra notes', { skipProseRules: true });
    expect(result.startsWith('MY BASE')).toBe(true);
  });
});

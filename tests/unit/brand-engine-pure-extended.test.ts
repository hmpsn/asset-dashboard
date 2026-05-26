/**
 * Extended pure-logic tests for brand engine helper functions.
 *
 * Covers:
 *  - renderVoiceDNAForPrompt() — all field rendering paths (server/voice-dna-render.ts)
 *  - renderVoiceDNASummary()   — compact one-liner rendering
 *
 * Row-mapper and DB-touching logic is covered by integration tests.
 * Existing coverage in tests/unit/seo-context-voice-profile.test.ts and
 * tests/integration/brand-engine-routes.test.ts is not duplicated here.
 */
import { describe, it, expect } from 'vitest';

import {
  renderVoiceDNAForPrompt,
  renderVoiceDNASummary,
} from '../../server/voice-dna-render.js';
import type { VoiceDNA } from '../../shared/types/brand-engine.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeDNA(overrides: Partial<VoiceDNA> = {}): VoiceDNA {
  return {
    personalityTraits: ['Confident', 'Direct'],
    toneSpectrum: { formal_casual: 6, serious_playful: 5, technical_accessible: 7 },
    sentenceStyle: 'Short punchy lines.',
    vocabularyLevel: 'Conversational, 8th grade.',
    ...overrides,
  };
}

// ── renderVoiceDNAForPrompt ───────────────────────────────────────────────────

describe('renderVoiceDNAForPrompt — required fields', () => {
  it('renders Personality line with joined traits', () => {
    const result = renderVoiceDNAForPrompt(makeDNA({ personalityTraits: ['Witty', 'Warm'] }));
    expect(result).toContain('Personality: Witty. Warm');
  });

  it('renders Tone line with all three spectrum values', () => {
    const dna = makeDNA({ toneSpectrum: { formal_casual: 3, serious_playful: 8, technical_accessible: 2 } });
    const result = renderVoiceDNAForPrompt(dna);
    expect(result).toContain('formal↔casual 3/10');
    expect(result).toContain('serious↔playful 8/10');
    expect(result).toContain('technical↔accessible 2/10');
  });

  it('renders Sentence style line', () => {
    const result = renderVoiceDNAForPrompt(makeDNA({ sentenceStyle: 'Mix of short and long.' }));
    expect(result).toContain('Sentence style: Mix of short and long.');
  });

  it('renders Vocabulary line when vocabularyLevel is non-empty', () => {
    const result = renderVoiceDNAForPrompt(makeDNA({ vocabularyLevel: 'Technical, 12th grade.' }));
    expect(result).toContain('Vocabulary: Technical, 12th grade.');
  });

  it('omits Vocabulary line when vocabularyLevel is empty string', () => {
    const result = renderVoiceDNAForPrompt(makeDNA({ vocabularyLevel: '' }));
    expect(result).not.toContain('Vocabulary:');
  });
});

describe('renderVoiceDNAForPrompt — optional humorStyle field', () => {
  it('renders Humor line when humorStyle is present', () => {
    const result = renderVoiceDNAForPrompt(makeDNA({ humorStyle: 'Dry wit, self-deprecating' }));
    expect(result).toContain('Humor: Dry wit, self-deprecating');
  });

  it('omits Humor line when humorStyle is absent', () => {
    const dna = makeDNA();
    delete dna.humorStyle;
    const result = renderVoiceDNAForPrompt(dna);
    expect(result).not.toContain('Humor:');
  });

  it('omits Humor line when humorStyle is empty string', () => {
    const result = renderVoiceDNAForPrompt(makeDNA({ humorStyle: '' }));
    expect(result).not.toContain('Humor:');
  });
});

describe('renderVoiceDNAForPrompt — output format', () => {
  it('returns a newline-joined block of indented lines', () => {
    const result = renderVoiceDNAForPrompt(makeDNA());
    const lines = result.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(3); // at minimum: Personality, Tone, Sentence style
    // All lines are indented with two spaces
    for (const line of lines) {
      expect(line.startsWith('  ')).toBe(true);
    }
  });

  it('renders personality traits joined by period-space', () => {
    const result = renderVoiceDNAForPrompt(makeDNA({ personalityTraits: ['A', 'B', 'C'] }));
    expect(result).toContain('Personality: A. B. C');
  });
});

describe('renderVoiceDNAForPrompt — boundary values', () => {
  it('handles single personality trait without separator', () => {
    const result = renderVoiceDNAForPrompt(makeDNA({ personalityTraits: ['Confident'] }));
    expect(result).toContain('Personality: Confident');
    // No trailing period-space when only one trait
    expect(result).not.toContain('Confident. ');
  });

  it('handles all spectrum values at 1 (minimum)', () => {
    const dna = makeDNA({ toneSpectrum: { formal_casual: 1, serious_playful: 1, technical_accessible: 1 } });
    const result = renderVoiceDNAForPrompt(dna);
    expect(result).toContain('formal↔casual 1/10');
    expect(result).toContain('serious↔playful 1/10');
    expect(result).toContain('technical↔accessible 1/10');
  });

  it('handles all spectrum values at 10 (maximum)', () => {
    const dna = makeDNA({ toneSpectrum: { formal_casual: 10, serious_playful: 10, technical_accessible: 10 } });
    const result = renderVoiceDNAForPrompt(dna);
    expect(result).toContain('formal↔casual 10/10');
    expect(result).toContain('serious↔playful 10/10');
    expect(result).toContain('technical↔accessible 10/10');
  });
});

// ── renderVoiceDNASummary ─────────────────────────────────────────────────────

describe('renderVoiceDNASummary', () => {
  it('returns a single line without newlines', () => {
    const result = renderVoiceDNASummary(makeDNA());
    expect(result.includes('\n')).toBe(false);
  });

  it('includes personality traits (first 3)', () => {
    const dna = makeDNA({ personalityTraits: ['A', 'B', 'C', 'D', 'E'] });
    const result = renderVoiceDNASummary(dna);
    expect(result).toContain('A, B, C');
    expect(result).not.toContain('D');
  });

  it('includes sentenceStyle after em-dash separator', () => {
    const result = renderVoiceDNASummary(makeDNA({ sentenceStyle: 'Short. Punchy.' }));
    expect(result).toContain('Short. Punchy.');
  });

  it('includes vocabulary level when present', () => {
    const result = renderVoiceDNASummary(makeDNA({ vocabularyLevel: 'Technical' }));
    expect(result).toContain('Technical vocabulary');
  });

  it('omits vocabulary level when absent', () => {
    const dna = makeDNA({ vocabularyLevel: '' });
    const result = renderVoiceDNASummary(dna);
    expect(result).not.toContain('vocabulary');
  });

  it('separates traits from sentenceStyle with " — "', () => {
    const result = renderVoiceDNASummary(makeDNA({
      personalityTraits: ['Direct'],
      sentenceStyle: 'Punchy.',
    }));
    expect(result).toContain('Direct — Punchy.');
  });

  it('handles single trait with no comma', () => {
    const result = renderVoiceDNASummary(makeDNA({ personalityTraits: ['Bold'] }));
    expect(result.startsWith('Bold')).toBe(true);
    expect(result).not.toContain('Bold,');
  });
});

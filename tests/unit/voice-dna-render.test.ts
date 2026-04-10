import { describe, it, expect } from 'vitest';
import { renderVoiceDNAForPrompt, renderVoiceDNASummary } from '../../server/voice-dna-render.js';
import type { VoiceDNA } from '../../shared/types/brand-engine.js';

/**
 * Contract test for the voice DNA prompt renderer.
 *
 * The point of this file is NOT to assert a specific output format — the
 * formatting is free to evolve. The point is to prevent the "silently dropped
 * field" class of bug where a renderer forgets to include a VoiceDNA field
 * (the `vocabularyLevel` bug that shipped to production for months).
 *
 * How the protection works:
 *   1. `voice-dna-render.ts` has a compile-time `Record<keyof VoiceDNA, true>`
 *      guard that fails `tsc` if a new VoiceDNA field is added without being
 *      handled there.
 *   2. This test uses a sentinel-value fixture where every field has a
 *      unique, recognizable string. The test asserts every sentinel appears
 *      in the rendered output. If a sentinel goes missing, the field is
 *      being silently dropped.
 *   3. The `coversAllDnaFields` helper iterates every key of the fixture and
 *      asserts presence, so adding a key to the fixture (driven by adding a
 *      key to the VoiceDNA type) automatically extends coverage.
 */

const FIXTURE: VoiceDNA = {
  personalityTraits: ['SENTINEL_PERSONALITY_A', 'SENTINEL_PERSONALITY_B'],
  toneSpectrum: {
    formal_casual: 7,       // SENTINEL numbers: 7, 6, 8 chosen to be distinct
    serious_playful: 6,
    technical_accessible: 8,
  },
  sentenceStyle: 'SENTINEL_SENTENCE_STYLE',
  vocabularyLevel: 'SENTINEL_VOCABULARY_LEVEL',
  humorStyle: 'SENTINEL_HUMOR_STYLE',
};

describe('renderVoiceDNAForPrompt', () => {
  it('renders all personalityTraits', () => {
    const out = renderVoiceDNAForPrompt(FIXTURE);
    expect(out).toContain('SENTINEL_PERSONALITY_A');
    expect(out).toContain('SENTINEL_PERSONALITY_B');
  });

  it('renders every toneSpectrum axis value', () => {
    const out = renderVoiceDNAForPrompt(FIXTURE);
    expect(out).toMatch(/formal.*casual.*7\/10/);
    expect(out).toMatch(/serious.*playful.*6\/10/);
    expect(out).toMatch(/technical.*accessible.*8\/10/);
  });

  it('renders sentenceStyle', () => {
    expect(renderVoiceDNAForPrompt(FIXTURE)).toContain('SENTINEL_SENTENCE_STYLE');
  });

  it('renders vocabularyLevel (regression guard — this field was silently dropped for months)', () => {
    expect(renderVoiceDNAForPrompt(FIXTURE)).toContain('SENTINEL_VOCABULARY_LEVEL');
  });

  it('renders humorStyle when present', () => {
    expect(renderVoiceDNAForPrompt(FIXTURE)).toContain('SENTINEL_HUMOR_STYLE');
  });

  it('omits humorStyle when absent (optional field)', () => {
    const { humorStyle: _omit, ...rest } = FIXTURE;
    void _omit;
    const out = renderVoiceDNAForPrompt(rest as VoiceDNA);
    expect(out).not.toContain('Humor:');
  });

  it('covers every key in the VoiceDNA fixture — adding a key to VoiceDNA should fail this test until handled', () => {
    // This loop is the structural guarantee. If someone adds a field to
    // VoiceDNA, they must also add a sentinel to FIXTURE (or the type check
    // on FIXTURE fails). That sentinel then flows through this assertion.
    const out = renderVoiceDNAForPrompt(FIXTURE);

    for (const key of Object.keys(FIXTURE) as (keyof VoiceDNA)[]) {
      const value = FIXTURE[key];
      if (typeof value === 'string' && value.startsWith('SENTINEL_')) {
        expect(out, `Field "${key}" is missing from renderVoiceDNAForPrompt output`).toContain(value);
      } else if (Array.isArray(value)) {
        // personalityTraits — assert at least the first sentinel entry is present
        for (const item of value) {
          if (typeof item === 'string' && item.startsWith('SENTINEL_')) {
            expect(out, `Array field "${key}" item "${item}" is missing from output`).toContain(item);
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        // toneSpectrum — every numeric axis is checked via the regex assertions above
        // so we don't need to duplicate here.
      }
    }
  });
});

describe('renderVoiceDNASummary', () => {
  it('includes personality traits, sentence style, and vocabulary level', () => {
    const out = renderVoiceDNASummary(FIXTURE);
    expect(out).toContain('SENTINEL_PERSONALITY_A');
    expect(out).toContain('SENTINEL_SENTENCE_STYLE');
    expect(out).toContain('SENTINEL_VOCABULARY_LEVEL');
  });

  it('omits vocabulary level when absent', () => {
    const out = renderVoiceDNASummary({ ...FIXTURE, vocabularyLevel: '' });
    expect(out).not.toContain('vocabulary');
  });
});

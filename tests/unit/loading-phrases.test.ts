import { describe, it, expect } from 'vitest';
import { LOADING_PHRASES, pickPhrase } from '../../src/lib/loadingPhrases.js';

describe('loadingPhrases', () => {
  it('exports exactly 9 phrases', () => {
    expect(LOADING_PHRASES).toHaveLength(9);
  });

  it('every phrase ends with the ellipsis character …', () => {
    expect(LOADING_PHRASES.length).toBeGreaterThan(0);
    expect(LOADING_PHRASES.every(p => p.endsWith('…'))).toBe(true);
  });

  it('all 9 phrases are reachable over 50 random picks', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      seen.add(pickPhrase());
    }
    // All 9 should appear at least once in 50 tries
    expect(seen.size).toBe(9);
  });

  it('pickPhrase returns a string that is in LOADING_PHRASES', () => {
    const phrase = pickPhrase();
    expect(LOADING_PHRASES).toContain(phrase);
  });

  it('no two consecutive pickPhrase() calls return the same phrase (50 runs)', () => {
    let prev = pickPhrase();
    for (let i = 0; i < 50; i++) {
      const next = pickPhrase(prev);
      expect(next).not.toBe(prev);
      prev = next;
    }
  });
});

import { describe, it, expect } from 'vitest';
import { LOADING_PHRASES, pickPhrase } from '../../src/lib/loadingPhrases.js';

describe('loadingPhrases', () => {
  it('exports exactly 9 phrases', () => {
    expect(LOADING_PHRASES).toHaveLength(9);
  });

  it('every phrase ends with the ellipsis character …', () => {
    expect(LOADING_PHRASES.length > 0 && LOADING_PHRASES.every(p => p.endsWith('…'))).toBe(true);
  });

  it('all 9 phrases are reachable over 500 random picks', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      seen.add(pickPhrase());
    }
    // 500 uniform picks from 9 options: P(missing any one) ≈ (8/9)^500 < 10^-24 — not flaky
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

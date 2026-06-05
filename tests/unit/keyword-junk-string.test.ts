/**
 * isJunkKeywordString — the Tier-1 malformed-string gate for the keyword universe.
 *
 * Strips boolean/quoted/research-syntax junk (the owner-observed
 * `"teeth whitening" "new patient" discount or special or package or offer`)
 * WITHOUT false-positiving on legitimate keywords that merely contain the
 * substrings "or"/"and" inside words, or a single conjunction.
 */
import { describe, it, expect } from 'vitest';
import { isJunkKeywordString } from '../../shared/keyword-normalization';

describe('isJunkKeywordString', () => {
  it('passes a normal keyword', () => {
    expect(isJunkKeywordString('teeth whitening').isJunk).toBe(false);
    expect(isJunkKeywordString('teeth cleaning sarasota').isJunk).toBe(false);
  });

  it('rejects a quoted boolean research query (the owner example)', () => {
    const r = isJunkKeywordString('"teeth whitening" "new patient" discount or special or package or offer');
    expect(r.isJunk).toBe(true);
    expect(r.reason).toBe('quoted_phrases');
  });

  it('rejects advanced search syntax', () => {
    expect(isJunkKeywordString('site:example.com pricing')).toEqual({ isJunk: true, reason: 'research_syntax' });
    expect(isJunkKeywordString('intitle: dentist').isJunk).toBe(true);
  });

  it('rejects >=2 boolean operator tokens', () => {
    expect(isJunkKeywordString('tea or coffee or cocoa')).toEqual({ isJunk: true, reason: 'boolean_operator' });
  });

  it('does NOT false-positive on words containing or/and, or a single conjunction', () => {
    expect(isJunkKeywordString('organic android repair').isJunk).toBe(false); // "or"/"and" inside words
    expect(isJunkKeywordString('bed and breakfast').isJunk).toBe(false);      // single conjunction
    expect(isJunkKeywordString('best dentist near me').isJunk).toBe(false);
    expect(isJunkKeywordString("men's haircut").isJunk).toBe(false);          // apostrophe is not a double-quote
  });

  it('rejects too-short and too-long strings', () => {
    expect(isJunkKeywordString('a').reason).toBe('too_short');
    expect(isJunkKeywordString('  ').isJunk).toBe(true);
    expect(isJunkKeywordString('x'.repeat(220)).reason).toBe('too_long');
  });

  it('is defensive against null/undefined', () => {
    expect(isJunkKeywordString(null).isJunk).toBe(true);
    expect(isJunkKeywordString(undefined).isJunk).toBe(true);
  });
});

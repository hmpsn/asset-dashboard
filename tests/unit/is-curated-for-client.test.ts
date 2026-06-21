import { describe, it, expect } from 'vitest';
import { isCuratedForClient, isActiveRec } from '../../server/recommendations.js';
import type { Recommendation } from '../../shared/types/recommendations.js';

const rec = (clientStatus: string, lifecycle: string = 'active'): Recommendation =>
  ({ clientStatus, lifecycle } as unknown as Recommendation);

describe('isCuratedForClient (the client-curated set)', () => {
  it('includes sent / approved / discussing', () => {
    expect(isCuratedForClient(rec('sent'))).toBe(true);
    expect(isCuratedForClient(rec('approved'))).toBe(true);
    expect(isCuratedForClient(rec('discussing'))).toBe(true);
  });

  it('excludes system / curated / declined (not yet sent, or client said no)', () => {
    expect(isCuratedForClient(rec('system'))).toBe(false);
    expect(isCuratedForClient(rec('curated'))).toBe(false);
    expect(isCuratedForClient(rec('declined'))).toBe(false);
  });

  it('excludes struck recs even if sent (must never read as live to the client)', () => {
    expect(isCuratedForClient(rec('sent', 'struck'))).toBe(false);
  });

  it('relates to the active set correctly — sent is curated-not-active; discussing is BOTH (deliberate overlap, NOT complements)', () => {
    // a sent rec leaves the active set but enters the curated set
    expect(isActiveRec(rec('sent'))).toBe(false);
    expect(isCuratedForClient(rec('sent'))).toBe(true);
    // a discussing rec is BOTH active (operator still working it) AND curated (client sees it) —
    // the two predicates are NOT complements; never assume isActiveRec === !isCuratedForClient
    expect(isActiveRec(rec('discussing'))).toBe(true);
    expect(isCuratedForClient(rec('discussing'))).toBe(true);
  });
});

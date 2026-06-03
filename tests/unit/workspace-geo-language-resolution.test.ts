/**
 * Unit tests for the workspace geo + language resolvers (P1 #3).
 *
 *   resolveWorkspaceLocationCode — existing (returns the primary-market code)
 *   resolveWorkspaceLanguageCode — NEW (returns the primary market's most-recent
 *     snapshot language, falling back to 'en'). The markets table has no language
 *     column, so a workspace with no primary-market snapshot resolves to 'en'.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { setBroadcast } from '../../server/broadcast.js';
import {
  resolveWorkspaceLocationCode,
  resolveWorkspaceLanguageCode,
  updateLocalSeoConfiguration,
  setPrimaryMarket,
  listLocalSeoMarkets,
} from '../../server/local-seo.js';
import { LOCAL_SEO_MARKET_STATUS, LOCAL_SEO_POSTURE } from '../../shared/types/local-seo.js';

beforeAll(() => {
  setBroadcast(vi.fn(), vi.fn());
});

const cleanup = new Set<string>();
afterEach(() => {
  for (const id of cleanup) deleteWorkspace(id);
  cleanup.clear();
});

describe('resolveWorkspaceLanguageCode', () => {
  it('falls back to en when the workspace has no primary-market snapshot', () => {
    const ws = createWorkspace(`Geo Lang Fallback ${Date.now()}`);
    cleanup.add(ws.id);
    expect(resolveWorkspaceLanguageCode(ws.id)).toBe('en');
  });

  it('falls back to en for an unknown workspace id', () => {
    expect(resolveWorkspaceLanguageCode('does-not-exist')).toBe('en');
  });
});

describe('resolveWorkspaceLocationCode', () => {
  it('returns null with no primary market and the seeded code once a primary market is set', () => {
    const ws = createWorkspace(`Geo Loc ${Date.now()}`);
    cleanup.add(ws.id);
    expect(resolveWorkspaceLocationCode(ws.id)).toBeNull();

    updateLocalSeoConfiguration(ws.id, {
      posture: LOCAL_SEO_POSTURE.LOCAL,
      markets: [{
        label: 'Berlin, DE',
        city: 'Berlin',
        country: 'DE',
        providerLocationCode: 2276, // Germany
        status: LOCAL_SEO_MARKET_STATUS.ACTIVE,
      }],
    }, true);
    const market = listLocalSeoMarkets(ws.id).find(m => m.providerLocationCode === 2276);
    expect(market).toBeDefined();
    setPrimaryMarket(ws.id, market!.id);

    expect(resolveWorkspaceLocationCode(ws.id)).toBe(2276);
    // No snapshot yet → language still falls back to 'en'.
    expect(resolveWorkspaceLanguageCode(ws.id)).toBe('en');
  });
});

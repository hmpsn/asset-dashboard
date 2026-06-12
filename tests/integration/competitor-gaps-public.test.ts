/**
 * Integration tests for the public competitor-gaps endpoint.
 *
 * GET /api/public/competitor-gaps/:workspaceId
 *   - 404 when workspace doesn't exist
 *   - 402 when effective tier !== 'premium' (free AND growth are gated out —
 *     this is a Premium-exclusive surface, Client Revenue R2 §3 / §4a)
 *   - 200 + projected gaps for a Premium workspace
 *   - the projection carries NO money/EMV field AND NO raw volume/difficulty
 *     (leak-style test, mirroring recommendations-public-emv-leak)
 *   - empty array when the workspace has no gaps
 *   - pagination via the shared helper
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { replaceAllKeywordGaps, deleteAllKeywordGaps } from '../../server/keyword-gaps.js';
import type { KeywordGapItem } from '../../shared/types/workspace.js';
import type { ClientCompetitorGapsResponse } from '../../shared/types/competitor-gaps.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api } = ctx;

let premiumWsId = '';
let growthWsId = '';
let freeWsId = '';
let emptyPremiumWsId = '';
const cleanups: Array<() => void> = [];

function makeGap(overrides: Partial<KeywordGapItem> = {}): KeywordGapItem {
  return {
    keyword: 'emergency plumber riverside',
    volume: 1800,
    difficulty: 32,
    competitorPosition: 2,
    competitorDomain: 'rivalplumbing.com',
    ...overrides,
  };
}

beforeAll(async () => {
  await ctx.startServer();
  const premium = seedWorkspace({ tier: 'premium', clientPassword: '' });
  premiumWsId = premium.workspaceId;
  cleanups.push(premium.cleanup);
  replaceAllKeywordGaps(premiumWsId, [
    makeGap(),
    makeGap({ keyword: 'drain cleaning service', volume: 90, difficulty: 80, competitorPosition: 14, competitorDomain: 'bigdrain.com' }),
    makeGap({ keyword: 'water heater repair', volume: 600, difficulty: 38, competitorPosition: 5, competitorDomain: 'rivalplumbing.com' }),
  ]);

  const growth = seedWorkspace({ tier: 'growth', clientPassword: '' });
  growthWsId = growth.workspaceId;
  cleanups.push(growth.cleanup);
  replaceAllKeywordGaps(growthWsId, [makeGap()]);

  const free = seedWorkspace({ tier: 'free', clientPassword: '' });
  freeWsId = free.workspaceId;
  cleanups.push(free.cleanup);

  const emptyPremium = seedWorkspace({ tier: 'premium', clientPassword: '' });
  emptyPremiumWsId = emptyPremium.workspaceId;
  cleanups.push(emptyPremium.cleanup);
});

afterAll(async () => {
  deleteAllKeywordGaps(premiumWsId);
  deleteAllKeywordGaps(growthWsId);
  cleanups.forEach((c) => c());
  await ctx.stopServer();
});

describe('GET /api/public/competitor-gaps/:workspaceId — gating', () => {
  it('returns 404 for an unknown workspace', async () => {
    const res = await api('/api/public/competitor-gaps/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns 402 for a free-tier workspace', async () => {
    const res = await api(`/api/public/competitor-gaps/${freeWsId}`);
    expect(res.status).toBe(402);
  });

  it('returns 402 for a growth-tier workspace (Premium-exclusive)', async () => {
    const res = await api(`/api/public/competitor-gaps/${growthWsId}`);
    expect(res.status).toBe(402);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/premium/i);
  });
});

describe('GET /api/public/competitor-gaps/:workspaceId — Premium read path', () => {
  it('returns projected gaps for a Premium workspace', async () => {
    const res = await api(`/api/public/competitor-gaps/${premiumWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as ClientCompetitorGapsResponse;
    expect(body.total).toBe(3);
    expect(body.gaps).toHaveLength(3);
    // High-opportunity rows (high demand + reachable difficulty) lead.
    expect(body.gaps[0].opportunityBand).toBe('high');
    // The named competitor (the Premium wedge) is present.
    expect(body.gaps[0].competitorDomain).toBe('rivalplumbing.com');
    // Narrative fields are present.
    expect(body.gaps[0].demandLabel).toMatch(/demand/i);
    expect(body.gaps[0].benchmark.length).toBeGreaterThan(0);
  });

  it('projection carries NO money/EMV field and NO raw volume/difficulty (leak gate)', async () => {
    const res = await api(`/api/public/competitor-gaps/${premiumWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as ClientCompetitorGapsResponse;
    const serialized = JSON.stringify(body);
    // No raw provider numbers — banded/labeled only.
    expect(serialized).not.toMatch(/"volume"/);
    expect(serialized).not.toMatch(/"difficulty"/);
    // No money / EMV exposure of any flavor.
    expect(serialized).not.toMatch(/emv/i);
    expect(serialized).not.toMatch(/perWeek/i);
    for (const gap of body.gaps) {
      const keys = Object.keys(gap);
      expect(keys).not.toContain('volume');
      expect(keys).not.toContain('difficulty');
      expect(keys).not.toContain('emvPerWeek');
    }
  });

  it('returns an empty array for a Premium workspace with no gaps', async () => {
    const res = await api(`/api/public/competitor-gaps/${emptyPremiumWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as ClientCompetitorGapsResponse;
    expect(body.total).toBe(0);
    expect(body.gaps).toEqual([]);
  });

  it('paginates via the shared helper when limit/offset are present', async () => {
    const res = await api(`/api/public/competitor-gaps/${premiumWsId}?limit=2&offset=0`);
    expect(res.status).toBe(200);
    const body = await res.json() as ClientCompetitorGapsResponse;
    expect(body.gaps).toHaveLength(2);
    expect(body.pageInfo).toEqual({ total: 3, limit: 2, offset: 0, hasMore: true });
  });
});

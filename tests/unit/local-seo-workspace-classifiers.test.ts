/**
 * Per-workspace classifier tests for server/local-seo.ts
 *
 * Proves that classifier-derived geo/service term matching is per-workspace
 * (derived from each workspace's own markets and business profile), and that
 * the original hardcoded Texas city names and dental/legal vocabulary no longer
 * leak into workspaces that have nothing to do with Texas or dentistry.
 *
 * Coverage:
 *  - Chicago HVAC workspace: classifies Chicago markets and HVAC services correctly.
 *  - Non-dental workspace with no markets: does NOT classify dental terms as
 *    service keywords or Texas cities as geo-local signals.
 *  - Dental workspace with Austin markets: continues to work (regression guard).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import db from '../../server/db/index.js';
import {
  buildLocalSeoKeywordCandidates,
  iterateLocalCandidateSignals,
  listLocalSeoMarkets,
  loadCandidateIterationContext,
  titleLooksLikeServiceKeyword,
  updateLocalSeoConfiguration,
} from '../../server/local-seo.js';
import { setBroadcast } from '../../server/broadcast.js';
import { upsertPageKeyword } from '../../server/page-keywords.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import {
  LOCAL_SEO_MARKET_STATUS,
  LOCAL_SEO_POSTURE,
} from '../../shared/types/local-seo.js';
import type { LocalSeoMarket } from '../../shared/types/local-seo.js';

// ─── DB setup (mirrors local-seo.test.ts) ────────────────────────────────────

const cleanupWorkspaceIds = new Set<string>();

beforeEach(() => {
  setBroadcast(vi.fn(), vi.fn());
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_seo_workspace_settings (
      workspace_id TEXT PRIMARY KEY,
      posture TEXT NOT NULL DEFAULT 'unknown',
      posture_source TEXT NOT NULL DEFAULT 'unknown',
      suggested_posture TEXT,
      suggestion_reasons TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      keywords_per_refresh INTEGER
    );
  `);
  try {
    db.exec(`ALTER TABLE local_seo_workspace_settings ADD COLUMN keywords_per_refresh INTEGER`);
  } catch (err) {
    if (!(err instanceof Error) || !/duplicate column name/i.test(err.message)) throw err;
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_seo_markets (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      label TEXT NOT NULL,
      city TEXT NOT NULL,
      state_or_region TEXT,
      country TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      provider_location_code INTEGER,
      provider_location_name TEXT,
      source TEXT NOT NULL DEFAULT 'unknown',
      status TEXT NOT NULL DEFAULT 'needs_review',
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  try {
    db.exec(`ALTER TABLE local_seo_markets ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0`);
  } catch (err) {
    if (!(err instanceof Error) || !/duplicate column name/i.test(err.message)) throw err;
  }
});

afterEach(() => {
  for (const workspaceId of cleanupWorkspaceIds) {
    deleteWorkspace(workspaceId);
  }
  cleanupWorkspaceIds.clear();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeChicagoHvacWorkspace() {
  const ws = createWorkspace('Chicago HVAC Co');
  cleanupWorkspaceIds.add(ws.id);
  updateWorkspace(ws.id, {
    name: 'Chicago HVAC Co',
    businessProfile: {
      address: { street: '100 W Adams St', city: 'Chicago', state: 'IL', country: 'US' },
    },
    keywordStrategy: {
      siteKeywords: ['hvac repair', 'furnace installation', 'air conditioning service'],
      opportunities: [],
      businessContext: 'HVAC contractor serving Chicago and surrounding suburbs. Services include heating, cooling, and ventilation.',
      generatedAt: '2026-06-01T00:00:00.000Z',
    },
    intelligenceProfile: { industry: 'hvac' },
  });
  updateLocalSeoConfiguration(ws.id, {
    posture: LOCAL_SEO_POSTURE.LOCAL,
    markets: [
      { label: 'Chicago, IL', city: 'Chicago', stateOrRegion: 'IL', country: 'US', providerLocationCode: 1016367, status: LOCAL_SEO_MARKET_STATUS.ACTIVE },
      { label: 'Naperville, IL', city: 'Naperville', stateOrRegion: 'IL', country: 'US', providerLocationCode: 1016999, status: LOCAL_SEO_MARKET_STATUS.ACTIVE },
    ],
  }, true);
  return ws;
}

function makeTexasDentalWorkspace() {
  const ws = createWorkspace('Swish Dental');
  cleanupWorkspaceIds.add(ws.id);
  updateWorkspace(ws.id, {
    name: 'Swish Dental',
    businessProfile: {
      address: { street: '123 Congress Ave', city: 'Austin', state: 'TX', country: 'US' },
    },
    keywordStrategy: {
      siteKeywords: ['cosmetic dentist', 'dental implants'],
      opportunities: [],
      businessContext: 'Dental office providing cosmetic dentistry, implants, and general dental care.',
      generatedAt: '2026-06-01T00:00:00.000Z',
    },
    intelligenceProfile: { industry: 'dental' },
  });
  updateLocalSeoConfiguration(ws.id, {
    posture: LOCAL_SEO_POSTURE.LOCAL,
    markets: [
      { label: 'Austin, TX', city: 'Austin', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1026201, status: LOCAL_SEO_MARKET_STATUS.ACTIVE },
    ],
  }, true);
  return ws;
}

function makeGenericB2BWorkspace() {
  // No industry, no markets, no dental/legal vocabulary — nothing that should
  // cause Texas or dental terms to appear as local signals.
  const ws = createWorkspace('Generic B2B SaaS');
  cleanupWorkspaceIds.add(ws.id);
  updateWorkspace(ws.id, {
    name: 'Generic B2B SaaS',
    businessProfile: {
      address: { street: '1 Market St', city: 'San Francisco', state: 'CA', country: 'US' },
    },
    keywordStrategy: {
      siteKeywords: ['project management software', 'team collaboration'],
      opportunities: [],
      businessContext: 'B2B software platform for project management and team collaboration.',
      generatedAt: '2026-06-01T00:00:00.000Z',
    },
  });
  return ws;
}

// ─── titleLooksLikeServiceKeyword (backward compat — no serviceTermRegex) ────

describe('titleLooksLikeServiceKeyword (no workspace context — backward compat)', () => {
  it('still recognises dental terms via the built-in fallback regex', () => {
    expect(titleLooksLikeServiceKeyword('dental implants')).toBe(true);
    expect(titleLooksLikeServiceKeyword('Cosmetic Dentistry')).toBe(true);
    expect(titleLooksLikeServiceKeyword('emergency dental care')).toBe(true);
  });

  it('still recognises legal/contractor terms via the built-in fallback regex', () => {
    expect(titleLooksLikeServiceKeyword('personal injury attorney')).toBe(true);
    expect(titleLooksLikeServiceKeyword('roof replacement service')).toBe(true);
    expect(titleLooksLikeServiceKeyword('plumbing repair')).toBe(true);
  });

  it('returns false for generic non-service page titles', () => {
    expect(titleLooksLikeServiceKeyword('About Our Team')).toBe(false);
    expect(titleLooksLikeServiceKeyword('Contact Us')).toBe(false);
  });

  it('returns false for titles longer than 6 tokens', () => {
    expect(titleLooksLikeServiceKeyword('the best local restaurant for every occasion in town')).toBe(false);
  });
});

// ─── Chicago HVAC workspace — classifies its own geo/services correctly ───────

describe('Chicago HVAC workspace — per-workspace classifiers', () => {
  it('classifies "hvac repair chicago" as having a market modifier (chicago is a configured market)', () => {
    const ws = makeChicagoHvacWorkspace();
    const markets = listLocalSeoMarkets(ws.id).filter(m => m.status === LOCAL_SEO_MARKET_STATUS.ACTIVE);
    expect(markets.length).toBeGreaterThan(0);
    // The HVAC workspace has Chicago as a market; keywords containing "chicago" should be detected
    const ctx = loadCandidateIterationContext(ws.id, []);
    expect(ctx).not.toBeNull();
    // geoTermRegex should match Chicago (the market) but NOT Austin or Dallas
    const { geoTermRegex } = ctx!.classifiers;
    expect(geoTermRegex.test('hvac repair chicago')).toBe(true);
    expect(geoTermRegex.test('furnace installation naperville')).toBe(true);
    // Texas cities must NOT appear — they are not markets for this workspace
    expect(geoTermRegex.test('austin')).toBe(false);
    expect(geoTermRegex.test('dallas')).toBe(false);
    expect(geoTermRegex.test('houston')).toBe(false);
  });

  it('classifies HVAC service keywords as service terms using workspace data', () => {
    const ws = makeChicagoHvacWorkspace();
    const ctx = loadCandidateIterationContext(ws.id, []);
    expect(ctx).not.toBeNull();
    const { serviceTermRegex } = ctx!.classifiers;
    // HVAC-specific terms from strategy keywords and business context
    expect(serviceTermRegex.test('hvac repair near me')).toBe(true);
    expect(serviceTermRegex.test('furnace installation chicago')).toBe(true);
    expect(serviceTermRegex.test('air conditioning service')).toBe(true);
    // Dental terms must NOT match — this workspace has nothing to do with dentistry
    expect(serviceTermRegex.test('dental implants')).toBe(false);
    expect(serviceTermRegex.test('invisalign chicago')).toBe(false);
    expect(serviceTermRegex.test('orthodontist near me')).toBe(false);
  });

  it('titleLooksLikeServiceKeyword with HVAC serviceTermRegex matches HVAC service pages', () => {
    const ws = makeChicagoHvacWorkspace();
    const ctx = loadCandidateIterationContext(ws.id, []);
    expect(ctx).not.toBeNull();
    const { serviceTermRegex } = ctx!.classifiers;
    expect(titleLooksLikeServiceKeyword('HVAC Repair Service', serviceTermRegex)).toBe(true);
    expect(titleLooksLikeServiceKeyword('Furnace Installation', serviceTermRegex)).toBe(true);
    // Generic page titles are not service keywords
    expect(titleLooksLikeServiceKeyword('About Us', serviceTermRegex)).toBe(false);
  });

  it('titleLooksLikeServiceKeyword with HVAC serviceTermRegex does NOT match dental page titles', () => {
    const ws = makeChicagoHvacWorkspace();
    const ctx = loadCandidateIterationContext(ws.id, []);
    expect(ctx).not.toBeNull();
    const { serviceTermRegex } = ctx!.classifiers;
    // A dental page title must NOT be treated as an HVAC service keyword
    expect(titleLooksLikeServiceKeyword('Dental Implants', serviceTermRegex)).toBe(false);
    expect(titleLooksLikeServiceKeyword('Cosmetic Dentistry', serviceTermRegex)).toBe(false);
    expect(titleLooksLikeServiceKeyword('Emergency Dental Care', serviceTermRegex)).toBe(false);
  });

  it('generates local variants for HVAC page titles in Chicago context', () => {
    const ws = makeChicagoHvacWorkspace();
    upsertPageKeyword(ws.id, {
      pagePath: '/services/hvac-repair',
      pageTitle: 'HVAC Repair',
      primaryKeyword: 'hvac repair',
      secondaryKeywords: [],
      searchIntent: 'transactional',
    });

    const candidates = buildLocalSeoKeywordCandidates(ws.id);
    const keywords = candidates.map(c => c.keyword.toLowerCase());

    // Should produce local variants using Chicago and Naperville, NOT Austin/Dallas
    const hasChicagoVariant = keywords.some(kw => kw.includes('chicago'));
    const hasNapervilleVariant = keywords.some(kw => kw.includes('naperville'));
    const hasDentalVariant = keywords.some(kw => kw.includes('dental'));
    const hasAustinVariant = keywords.some(kw => kw.includes('austin'));
    const hasDallasVariant = keywords.some(kw => kw.includes('dallas'));

    expect(hasChicagoVariant).toBe(true);
    expect(hasNapervilleVariant).toBe(true);
    expect(hasDentalVariant).toBe(false);
    expect(hasAustinVariant).toBe(false);
    expect(hasDallasVariant).toBe(false);
  });

  it('pageLooksLocal is true for pages mentioning Chicago (the configured market)', () => {
    const ws = makeChicagoHvacWorkspace();
    upsertPageKeyword(ws.id, {
      pagePath: '/location/chicago',
      pageTitle: 'HVAC Service Chicago',
      primaryKeyword: 'hvac chicago',
      secondaryKeywords: [],
      searchIntent: 'transactional',
    });

    const ctx = loadCandidateIterationContext(ws.id, []);
    expect(ctx).not.toBeNull();
    const signals = [...iterateLocalCandidateSignals(ctx!)];
    // The page with "chicago" in title/path should force=true for its signal
    const chicagoPageSignal = signals.find(s => s.pagePath === '/location/chicago' && s.source === 'page_assignment');
    expect(chicagoPageSignal?.force).toBe(true);
  });
});

// ─── Hardcoded leakage guard — dental/Texas terms must NOT leak ───────────────

describe('non-dental non-Texas workspace — hardcoded leakage prevention', () => {
  it('generic B2B workspace serviceTermRegex does NOT match dental terms', () => {
    const ws = makeGenericB2BWorkspace();
    const ctx = loadCandidateIterationContext(ws.id, []);
    expect(ctx).not.toBeNull();
    const { serviceTermRegex } = ctx!.classifiers;
    expect(serviceTermRegex.test('dental implants')).toBe(false);
    expect(serviceTermRegex.test('dentist near me')).toBe(false);
    expect(serviceTermRegex.test('invisalign')).toBe(false);
    expect(serviceTermRegex.test('orthodontist')).toBe(false);
    expect(serviceTermRegex.test('attorney')).toBe(false);
    expect(serviceTermRegex.test('personal injury lawyer')).toBe(false);
  });

  it('generic B2B workspace geoTermRegex does NOT match Texas cities', () => {
    const ws = makeGenericB2BWorkspace();
    const ctx = loadCandidateIterationContext(ws.id, []);
    expect(ctx).not.toBeNull();
    const { geoTermRegex } = ctx!.classifiers;
    // Business profile has San Francisco — the workspace has no Texas markets
    expect(geoTermRegex.test('austin')).toBe(false);
    expect(geoTermRegex.test('dallas')).toBe(false);
    expect(geoTermRegex.test('houston')).toBe(false);
    expect(geoTermRegex.test('san antonio')).toBe(false);
    // But San Francisco (from business profile) IS detected
    expect(geoTermRegex.test('project management san francisco')).toBe(true);
  });

  it('pure dental terms are not classified as service keywords for a non-dental workspace', () => {
    const ws = makeGenericB2BWorkspace();
    const ctx = loadCandidateIterationContext(ws.id, []);
    expect(ctx).not.toBeNull();
    const { serviceTermRegex } = ctx!.classifiers;
    // The OLD hardcoded regex matched "dental implants" for ANY workspace via /dent|dental|implant|.../.
    // The per-workspace classifier should NOT match dental-specific terms for a non-dental workspace.
    expect(serviceTermRegex.test('dental implants')).toBe(false);
    expect(serviceTermRegex.test('invisalign near me')).toBe(false);
    expect(serviceTermRegex.test('orthodontist clinic')).toBe(false);
    expect(serviceTermRegex.test('tooth implant cost')).toBe(false);
    // Legal terms: these must not match for a B2B SaaS workspace
    expect(serviceTermRegex.test('personal injury attorney')).toBe(false);
    expect(serviceTermRegex.test('estate planning lawyer')).toBe(false);
  });
});

// ─── Texas dental workspace regression guard ──────────────────────────────────

describe('Texas dental workspace — regression: still works after per-workspace derivation', () => {
  it('classifies Austin as a geo-local market (regression guard)', () => {
    const ws = makeTexasDentalWorkspace();
    const ctx = loadCandidateIterationContext(ws.id, []);
    expect(ctx).not.toBeNull();
    const { geoTermRegex } = ctx!.classifiers;
    expect(geoTermRegex.test('dentist austin')).toBe(true);
    expect(geoTermRegex.test('austin tx dentist')).toBe(true);
  });

  it('classifies dental service terms correctly (regression guard)', () => {
    const ws = makeTexasDentalWorkspace();
    const ctx = loadCandidateIterationContext(ws.id, []);
    expect(ctx).not.toBeNull();
    const { serviceTermRegex } = ctx!.classifiers;
    expect(serviceTermRegex.test('dental implants')).toBe(true);
    expect(serviceTermRegex.test('cosmetic dentist near me')).toBe(true);
  });

  it('produces local candidates for dental service pages in Austin (regression guard)', () => {
    const ws = makeTexasDentalWorkspace();
    upsertPageKeyword(ws.id, {
      pagePath: '/services/dental-implants',
      pageTitle: 'Dental Implants',
      primaryKeyword: 'dental implants',
      secondaryKeywords: [],
      searchIntent: 'commercial',
    });

    const candidates = buildLocalSeoKeywordCandidates(ws.id);
    const keywords = candidates.map(c => c.keyword.toLowerCase());
    // Should produce local variants mentioning Austin
    expect(keywords.some(kw => kw.includes('austin'))).toBe(true);
    // Dental terms should appear
    expect(keywords.some(kw => kw.includes('dental'))).toBe(true);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from '../integration/helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { resolveSegmentProfile, getWorkspace } from '../../server/workspaces.js';
import { createClientLocation } from '../../server/client-locations.js';

const ctx = createEphemeralTestContext(import.meta.url);
let wsId: string;
let cleanup: (() => void) | undefined;

beforeAll(async () => {
  await ctx.startServer();
  const s = seedWorkspace();
  wsId = s.workspaceId;
  cleanup = s.cleanup;
}, 30_000);
afterAll(async () => {
  cleanup?.();
  await ctx.stopServer();
});

describe('resolveSegmentProfile', () => {
  it('one client_locations row → local_smb, local insert ON, competitor OFF', () => {
    createClientLocation(wsId, { name: 'Main St Dental', isPrimary: true });
    const p = resolveSegmentProfile(getWorkspace(wsId)!);
    expect(p.segment).toBe('local_smb');
    expect(p.showLocalMapAndReviews).toBe(true);
    expect(p.showCompetitorAuthority).toBe(false);
    expect(p.moneyFrameAltitude).toBe('production_vs_retainer');
  });
  it('two+ rows → multi_location with portfolio rollup ON', () => {
    createClientLocation(wsId, { name: 'Second Office', isPrimary: false });
    const p = resolveSegmentProfile(getWorkspace(wsId)!);
    expect(p.segment).toBe('multi_location');
    expect(p.showPortfolioRollup).toBe(true);
  });
  it('zero locations + admin-set segmentConfig=b2b_saas → competitor ON, pipeline_ratio', () => {
    const s2 = seedWorkspace();
    const ws = { ...getWorkspace(s2.workspaceId)!, segmentConfig: { segment: 'b2b_saas' as const } };
    const p = resolveSegmentProfile(ws);
    expect(p.segment).toBe('b2b_saas');
    expect(p.showCompetitorAuthority).toBe(true);
    expect(p.moneyFrameAltitude).toBe('pipeline_ratio');
    s2.cleanup();
  });
  it('zero locations + no segmentConfig → safe non-local default (b2b_saas), never throws', () => {
    const s3 = seedWorkspace();
    const p = resolveSegmentProfile(getWorkspace(s3.workspaceId)!);
    expect(p.segment).toBe('b2b_saas');
    s3.cleanup();
  });
});

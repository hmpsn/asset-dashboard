/**
 * Unit tests for server/workspace-authority.ts (PR5 · Spine C).
 *
 * Covers:
 *  - getOrCreateWorkspaceAuthority returns non-nullable + default 0 when no data
 *  - upsertWorkspaceAuthority maps referring-domains → authority-strength bucket
 *  - resolveOvAuthorityStrength maps an injected referring-domains profile
 *    correctly and degrades to persisted/default authority when absent
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import db from '../../server/db/index.js';
import {
  getOrCreateWorkspaceAuthority,
  upsertWorkspaceAuthority,
  resolveOvAuthorityStrength,
} from '../../server/workspace-authority.js';
import type { BacklinkProfile } from '../../shared/types/intelligence.js';

const WS = 'wa-test-ws';
const WS2 = 'wa-test-ws-2';
const WS3 = 'wa-test-ws-3';
const WS4 = 'wa-test-ws-4';

function cleanup() {
  db.prepare("DELETE FROM workspace_authority WHERE workspace_id LIKE 'wa-test-%'").run();
}

function profile(referringDomains: number): BacklinkProfile {
  return { totalBacklinks: referringDomains * 5, referringDomains };
}

beforeEach(cleanup);
afterAll(cleanup);

describe('getOrCreateWorkspaceAuthority', () => {
  it('returns a non-null record with default 0 when no data exists', () => {
    const rec = getOrCreateWorkspaceAuthority(WS);
    expect(rec).not.toBeNull();
    expect(rec.workspaceId).toBe(WS);
    expect(rec.referringDomains).toBe(0);
    expect(rec.authorityStrength).toBe(0);
    expect(typeof rec.capturedAt).toBe('string');
  });

  it('returns the persisted record when one exists', () => {
    upsertWorkspaceAuthority(WS2, 150);
    const rec = getOrCreateWorkspaceAuthority(WS2);
    expect(rec.referringDomains).toBe(150);
    expect(rec.authorityStrength).toBe(80);
  });
});

describe('upsertWorkspaceAuthority — referring-domains → authority bucket', () => {
  it('maps >=120 referring domains to strength 80', () => {
    expect(upsertWorkspaceAuthority(WS, 120).authorityStrength).toBe(80);
    expect(upsertWorkspaceAuthority(WS, 5000).authorityStrength).toBe(80);
  });
  it('maps >=30 (and <120) to strength 50', () => {
    expect(upsertWorkspaceAuthority(WS, 30).authorityStrength).toBe(50);
    expect(upsertWorkspaceAuthority(WS, 119).authorityStrength).toBe(50);
  });
  it('maps 1..29 to strength 20', () => {
    expect(upsertWorkspaceAuthority(WS, 1).authorityStrength).toBe(20);
    expect(upsertWorkspaceAuthority(WS, 29).authorityStrength).toBe(20);
  });
  it('maps 0/negative referring domains to strength 0 (authority unknown)', () => {
    expect(upsertWorkspaceAuthority(WS, 0).authorityStrength).toBe(0);
    expect(upsertWorkspaceAuthority(WS, -10).authorityStrength).toBe(0);
    expect(upsertWorkspaceAuthority(WS, -10).referringDomains).toBe(0);
  });
  it('upsert overwrites the prior row in place', () => {
    upsertWorkspaceAuthority(WS, 200);
    upsertWorkspaceAuthority(WS, 10);
    const rec = getOrCreateWorkspaceAuthority(WS);
    expect(rec.referringDomains).toBe(10);
    expect(rec.authorityStrength).toBe(20);
  });
});

describe('resolveOvAuthorityStrength — injected backlink profile', () => {
  it('maps a high-authority profile and persists the mapped authority', () => {
    const strength = resolveOvAuthorityStrength(WS, profile(140));
    expect(strength).toBe(80);
    expect(getOrCreateWorkspaceAuthority(WS).referringDomains).toBe(140);
  });

  it('maps a mid-authority profile to strength 50', () => {
    expect(resolveOvAuthorityStrength(WS, profile(45))).toBe(50);
  });

  it('maps a low-authority profile to strength 20', () => {
    expect(resolveOvAuthorityStrength(WS, profile(10))).toBe(20);
  });

  it('degrades to last-persisted authority when the profile is null', () => {
    upsertWorkspaceAuthority(WS3, 200); // strength 80 persisted
    expect(resolveOvAuthorityStrength(WS3, null)).toBe(80);
  });

  it('returns the non-nullable default 0 when profile is absent and nothing persisted', () => {
    expect(resolveOvAuthorityStrength(WS4, undefined)).toBe(0);
  });
});

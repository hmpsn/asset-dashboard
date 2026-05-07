import { describe, it, expect, beforeEach } from 'vitest';
import db from '../../server/db/index.js';
import {
  getRedirectSnapshot,
  saveRedirectSnapshot,
} from '../../server/redirect-store.js';
import type { RedirectScanResult } from '../../server/redirect-scanner.js';

const SITE_ID = 'redirect-store-site';

const scanResult: RedirectScanResult = {
  chains: [{
    originalUrl: 'https://example.com/old',
    hops: [{ url: 'https://example.com/old', status: 301 }],
    finalUrl: 'https://example.com/new',
    totalHops: 1,
    isLoop: false,
    foundOn: ['/'],
    type: 'internal',
  }],
  pageStatuses: [{
    url: 'https://example.com/old',
    path: '/old',
    title: 'Old',
    status: 301,
    statusText: 'Moved Permanently',
    redirectsTo: 'https://example.com/new',
    source: 'static',
  }],
  summary: { totalPages: 1, healthy: 0, redirecting: 1, notFound: 0, errors: 0, chainsDetected: 1, longestChain: 1 },
  scannedAt: '2026-05-05T00:00:00.000Z',
};

describe('redirect-store', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM redirect_snapshots WHERE site_id = ?').run(SITE_ID);
  });

  it('saves and retrieves the latest redirect snapshot', () => {
    const saved = saveRedirectSnapshot(SITE_ID, scanResult);

    expect(saved.id).toContain(`redirect-${SITE_ID}`);
    expect(getRedirectSnapshot(SITE_ID)?.result.summary.redirecting).toBe(1);
  });

  it('returns null when no redirect snapshot exists', () => {
    expect(getRedirectSnapshot(SITE_ID)).toBeNull();
  });

  it('degrades malformed JSON rows to an empty redirect result', () => {
    db.prepare(`
      INSERT INTO redirect_snapshots (id, site_id, created_at, result)
      VALUES (?, ?, ?, ?)
    `).run('redirect-malformed', SITE_ID, '2026-05-05T00:00:00.000Z', '{bad json');

    const snapshot = getRedirectSnapshot(SITE_ID);
    expect(snapshot?.result.summary.totalPages).toBe(0);
    expect(snapshot?.result.chains).toEqual([]);
  });
});

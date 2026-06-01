// tests/unit/effective-business-priorities.test.ts
// Tests for the authority-layered effectiveBusinessPriorities resolver.
//
// Two siloed stores feed one resolved representation:
//   (a) CLIENT store: client_business_priorities table (migration 021) — JSON array of
//       {text, category}, entered by the client via the portal.
//   (b) ADMIN store: workspaces.business_priorities column (migration 048) — array of
//       admin-set goal strings.
//
// PRECEDENCE: client-entered priorities first (the customer's own stated goals),
// admin-set priorities as a supplement, with case-insensitive de-duplication.
// Mirrors the buildEffectiveBrandVoiceBlock authority-layer pattern.

import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import db from '../../server/db/index.js';
import { buildWorkspaceIntelligence, invalidateIntelligenceCache } from '../../server/workspace-intelligence.js';
import { buildEffectiveBusinessPriorities } from '../../server/intelligence/business-priorities-source.js';
import type { ClientSignalsSlice } from '../../shared/types/intelligence.js';

interface SeededWs {
  workspaceId: string;
  cleanup: () => void;
}

function seedWorkspace(opts: {
  adminPriorities?: string[];
  clientPriorities?: Array<{ text: string; category?: string } | string>;
}): SeededWs {
  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `test-ws-bizprio-${suffix}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO workspaces (id, name, folder, webflow_site_id, webflow_token, business_priorities, tier, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    workspaceId,
    `Biz Prio Test ${suffix}`,
    `biz-prio-test-${suffix}`,
    `biz-prio-site-${suffix}`,
    `biz-prio-token-${suffix}`,
    opts.adminPriorities ? JSON.stringify(opts.adminPriorities) : null,
    'free',
    now,
  );

  if (opts.clientPriorities) {
    db.prepare(`
      INSERT INTO client_business_priorities (workspace_id, priorities, updated_at)
      VALUES (?, ?, datetime('now'))
    `).run(workspaceId, JSON.stringify(opts.clientPriorities));
  }

  const cleanup = () => {
    db.prepare('DELETE FROM client_business_priorities WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);
    invalidateIntelligenceCache(workspaceId);
  };

  return { workspaceId, cleanup };
}

describe('buildEffectiveBusinessPriorities — authority-layered resolver', () => {
  let seeded: SeededWs | null = null;

  afterEach(() => {
    seeded?.cleanup();
    seeded = null;
  });

  it('merges client store first, admin store as supplement', () => {
    seeded = seedWorkspace({
      clientPriorities: [
        { text: 'Launch APAC market', category: 'growth' },
        { text: 'Expand brand awareness', category: 'brand' },
      ],
      adminPriorities: ['Grow patient appointments by 25% in Q3'],
    });

    const resolved = buildEffectiveBusinessPriorities(seeded.workspaceId);

    // Client priorities come first (formatted with their category prefix),
    // admin priorities appended as supplement.
    expect(resolved).toEqual([
      '[growth] Launch APAC market',
      '[brand] Expand brand awareness',
      'Grow patient appointments by 25% in Q3',
    ]);
  });

  it('de-duplicates admin priorities that restate a client priority (case-insensitive)', () => {
    seeded = seedWorkspace({
      clientPriorities: [{ text: 'Increase Organic Traffic' }],
      // Admin restates the same goal with different casing/whitespace — must be dropped.
      adminPriorities: ['  increase organic traffic  ', 'Reduce churn'],
    });

    const resolved = buildEffectiveBusinessPriorities(seeded.workspaceId);

    expect(resolved).toEqual([
      'Increase Organic Traffic',
      'Reduce churn',
    ]);
  });

  it('returns client-only priorities when no admin store exists', () => {
    seeded = seedWorkspace({
      clientPriorities: [{ text: 'Win local SEO', category: 'competitive' }],
    });

    const resolved = buildEffectiveBusinessPriorities(seeded.workspaceId);
    expect(resolved).toEqual(['[competitive] Win local SEO']);
  });

  it('returns admin-only priorities when no client store exists', () => {
    seeded = seedWorkspace({
      adminPriorities: ['Grow MRR to $50k'],
    });

    const resolved = buildEffectiveBusinessPriorities(seeded.workspaceId);
    expect(resolved).toEqual(['Grow MRR to $50k']);
  });

  it('drops blank/whitespace-only entries from both stores', () => {
    seeded = seedWorkspace({
      clientPriorities: [
        { text: 'Real client goal', category: 'growth' },
        { text: '   ', category: 'other' },
      ],
      adminPriorities: ['', '   ', 'Real admin goal'],
    });

    const resolved = buildEffectiveBusinessPriorities(seeded.workspaceId);
    expect(resolved).toEqual([
      '[growth] Real client goal',
      'Real admin goal',
    ]);
  });

  it('exposes the resolved list on ClientSignalsSlice.effectiveBusinessPriorities', async () => {
    seeded = seedWorkspace({
      clientPriorities: [{ text: 'Client goal', category: 'growth' }],
      adminPriorities: ['Admin goal'],
    });
    invalidateIntelligenceCache(seeded.workspaceId);

    const intel = await buildWorkspaceIntelligence(seeded.workspaceId, { slices: ['clientSignals'] });
    const cs = intel.clientSignals as ClientSignalsSlice;

    expect(cs.effectiveBusinessPriorities).toEqual([
      '[growth] Client goal',
      'Admin goal',
    ]);
  });
});

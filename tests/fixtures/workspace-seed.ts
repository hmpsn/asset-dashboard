// tests/fixtures/workspace-seed.ts
// Shared workspace fixture for integration tests.
// Creates a fully-configured workspace row with Webflow integration defaults.

import { randomUUID } from 'crypto';
import db from '../../server/db/index.js';

export interface SeededFullWorkspace {
  workspaceId: string;
  webflowSiteId: string;
  webflowToken: string;
  cleanup: () => void;
}

interface SeedWorkspaceOverrides {
  tier?: string;
  webflowToken?: string;
  clientPassword?: string;
  gscPropertyUrl?: string;
  ga4PropertyId?: string;
  seoDataProvider?: string;
}

/**
 * Creates a workspace with Webflow integration configured.
 * Defaults: tier='free', webflow_token/site_id auto-generated, client_password set, live_domain set.
 */
export function seedWorkspace(overrides?: SeedWorkspaceOverrides): SeededFullWorkspace {
  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `test-ws-${suffix}`;
  const webflowSiteId = `test-site-${suffix}`;
  const webflowToken = overrides?.webflowToken ?? `test-wf-token-${suffix}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO workspaces (id, name, folder, webflow_site_id, webflow_token,
      gsc_property_url, ga4_property_id, client_password, live_domain, tier, seo_data_provider, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    workspaceId,
    `Test Workspace ${suffix}`,
    `test-workspace-${suffix}`,
    webflowSiteId,
    webflowToken,
    overrides?.gscPropertyUrl ?? null,
    overrides?.ga4PropertyId ?? null,
    overrides?.clientPassword ?? 'test-password',
    'test.example.com',
    overrides?.tier ?? 'free',
    overrides?.seoDataProvider ?? null,
    now,
  );

  const cleanup = () => {
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);
  };

  return { workspaceId, webflowSiteId, webflowToken, cleanup };
}

/**
 * Creates TWO workspaces for cross-workspace isolation tests.
 * Returns both workspaces and a combined cleanup function.
 */
export function seedTwoWorkspaces(): { wsA: SeededFullWorkspace; wsB: SeededFullWorkspace; cleanup: () => void } {
  const wsA = seedWorkspace();
  const wsB = seedWorkspace();

  const cleanup = () => {
    wsA.cleanup();
    wsB.cleanup();
  };

  return { wsA, wsB, cleanup };
}

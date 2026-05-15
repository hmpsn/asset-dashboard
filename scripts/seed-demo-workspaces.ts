#!/usr/bin/env tsx

import { pathToFileURL } from 'url';
import db from '../server/db/index.js';

interface DemoWorkspaceSeed {
  id: string;
  name: string;
  folder: string;
  tier: 'free' | 'growth' | 'premium';
  domain: string;
  webflowSiteId: string;
  webflowSiteName: string;
  webflowToken: string;
  clientPassword: string;
  gscPropertyUrl: string;
  ga4PropertyId: string;
  seoDataProvider: 'dataforseo' | 'semrush';
}

const DEMO_PASSWORD = 'demo-client';

const DEMO_WORKSPACES: DemoWorkspaceSeed[] = [
  {
    id: 'ws_demo_growth',
    name: 'Demo Growth Workspace',
    folder: 'demo-growth-workspace',
    tier: 'growth',
    domain: 'growth-demo.local',
    webflowSiteId: 'site_demo_growth',
    webflowSiteName: 'Demo Growth Site',
    webflowToken: 'demo-webflow-token-growth',
    clientPassword: DEMO_PASSWORD,
    gscPropertyUrl: 'sc-domain:growth-demo.local',
    ga4PropertyId: 'properties/100001',
    seoDataProvider: 'dataforseo',
  },
  {
    id: 'ws_demo_premium',
    name: 'Demo Premium Workspace',
    folder: 'demo-premium-workspace',
    tier: 'premium',
    domain: 'premium-demo.local',
    webflowSiteId: 'site_demo_premium',
    webflowSiteName: 'Demo Premium Site',
    webflowToken: 'demo-webflow-token-premium',
    clientPassword: DEMO_PASSWORD,
    gscPropertyUrl: 'sc-domain:premium-demo.local',
    ga4PropertyId: 'properties/100002',
    seoDataProvider: 'dataforseo',
  },
  {
    id: 'ws_demo_free',
    name: 'Demo Free Workspace',
    folder: 'demo-free-workspace',
    tier: 'free',
    domain: 'free-demo.local',
    webflowSiteId: 'site_demo_free',
    webflowSiteName: 'Demo Free Site',
    webflowToken: 'demo-webflow-token-free',
    clientPassword: DEMO_PASSWORD,
    gscPropertyUrl: 'sc-domain:free-demo.local',
    ga4PropertyId: 'properties/100003',
    seoDataProvider: 'dataforseo',
  },
];

const NON_LOCAL_DEMO_SEED_OVERRIDE = 'ALLOW_NON_LOCAL_DEMO_SEED';

function upsertDemoWorkspace(seed: DemoWorkspaceSeed): 'created' | 'updated' {
  const existing = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(seed.id) as { id: string } | undefined;
  const now = new Date().toISOString();

  if (!existing) {
    db.prepare(`
      INSERT INTO workspaces (
        id, name, folder, webflow_site_id, webflow_site_name, webflow_token,
        gsc_property_url, ga4_property_id, client_password, live_domain,
        tier, seo_data_provider, client_portal_enabled, seo_client_view,
        analytics_client_view, site_intelligence_client_view, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1, ?)
    `).run(
      seed.id,
      seed.name,
      seed.folder,
      seed.webflowSiteId,
      seed.webflowSiteName,
      seed.webflowToken,
      seed.gscPropertyUrl,
      seed.ga4PropertyId,
      seed.clientPassword,
      seed.domain,
      seed.tier,
      seed.seoDataProvider,
      now,
    );
    return 'created';
  }

  db.prepare(`
    UPDATE workspaces
    SET
      name = ?,
      folder = ?,
      webflow_site_id = ?,
      webflow_site_name = ?,
      webflow_token = ?,
      gsc_property_url = ?,
      ga4_property_id = ?,
      client_password = ?,
      live_domain = ?,
      tier = ?,
      seo_data_provider = ?,
      client_portal_enabled = 1,
      seo_client_view = 1,
      analytics_client_view = 1,
      site_intelligence_client_view = 1
    WHERE id = ?
  `).run(
    seed.name,
    seed.folder,
    seed.webflowSiteId,
    seed.webflowSiteName,
    seed.webflowToken,
    seed.gscPropertyUrl,
    seed.ga4PropertyId,
    seed.clientPassword,
    seed.domain,
    seed.tier,
    seed.seoDataProvider,
    seed.id,
  );
  return 'updated';
}

function main(): void {
  assertDemoSeedEnvironmentSafe();
  const results = DEMO_WORKSPACES.map(seed => ({ seed, status: upsertDemoWorkspace(seed) }));

  console.log('\nDemo workspace seeding complete:\n');
  for (const { seed, status } of results) {
    console.log(`- ${status.toUpperCase()}  ${seed.id} (${seed.tier})`);
    console.log(`  admin:  /ws/${seed.id}`);
    console.log(`  client: /client/${seed.id}`);
    console.log(`  client password: ${seed.clientPassword}`);
  }
  console.log('\nTip: set LOCAL_FAKE_PROVIDERS=true for provider-safe local onboarding.\n');
}

export function assertDemoSeedEnvironmentSafe(): void {
  const nodeEnv = (process.env.NODE_ENV || '').trim().toLowerCase();
  if (nodeEnv === 'production') {
    throw new Error('seed:demo is blocked in production.');
  }

  const isLocalLike = nodeEnv === '' || nodeEnv === 'development' || nodeEnv === 'test';
  if (isLocalLike) return;

  const override = (process.env[NON_LOCAL_DEMO_SEED_OVERRIDE] || '').trim().toLowerCase();
  if (override === 'true') return;

  throw new Error(
    `seed:demo is restricted to local/test environments. Set ${NON_LOCAL_DEMO_SEED_OVERRIDE}=true only for intentional shared-environment runs.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

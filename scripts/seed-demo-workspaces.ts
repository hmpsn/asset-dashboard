#!/usr/bin/env tsx

import { pathToFileURL } from 'url';
import db from '../server/db/index.js';
import {
  DEMO_WORKSPACE_SCENARIOS,
  type DemoScenario,
} from '../shared/demo-workspace-scenarios.js';

interface DemoWorkspaceSeed {
  id: string;
  name: string;
  folder: string;
  tier: 'free' | 'growth' | 'premium';
  scenario: DemoScenario;
  domain: string;
  webflowSiteId: string | null;
  webflowSiteName: string | null;
  webflowToken: string | null;
  clientPassword: string;
  gscPropertyUrl: string | null;
  ga4PropertyId: string | null;
  seoDataProvider: 'dataforseo' | 'semrush';
}

const DEMO_PASSWORD = 'demo-client';
const DEMO_NOW = '2026-05-16T00:00:00.000Z';
const NON_LOCAL_DEMO_SEED_OVERRIDE = 'ALLOW_NON_LOCAL_DEMO_SEED';

function inferDemoWebflowToken(webflowSiteId: string | null): string | null {
  if (!webflowSiteId) return null;
  const suffix = webflowSiteId.replace(/^site_demo_/, '').replace(/_/g, '-');
  return `demo-webflow-token-${suffix}`;
}

export const DEMO_WORKSPACES: DemoWorkspaceSeed[] = DEMO_WORKSPACE_SCENARIOS.map((scenario) => ({
  id: scenario.id,
  name: scenario.name,
  folder: scenario.folder,
  tier: scenario.tier,
  scenario: scenario.scenario,
  domain: scenario.domain,
  webflowSiteId: scenario.integrations.webflowSiteId,
  webflowSiteName: scenario.integrations.webflowSiteName,
  webflowToken: inferDemoWebflowToken(scenario.integrations.webflowSiteId),
  clientPassword: DEMO_PASSWORD,
  gscPropertyUrl: scenario.integrations.gscPropertyUrl,
  ga4PropertyId: scenario.integrations.ga4PropertyId,
  seoDataProvider: scenario.integrations.seoDataProvider,
}));

function upsertDemoWorkspace(seed: DemoWorkspaceSeed): 'created' | 'updated' {
  const existing = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(seed.id) as { id: string } | undefined;

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
      DEMO_NOW,
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

function resetWorkspaceDemoData(workspaceId: string): void {
  db.prepare('DELETE FROM page_edit_states WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM schema_publish_history WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM schema_snapshots WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM schema_site_plans WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM content_posts WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM content_briefs WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM approval_batches WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM client_actions WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM work_orders WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM requests WHERE workspace_id = ?').run(workspaceId);
}

function seedGrowthActiveWorkspace(seed: DemoWorkspaceSeed): void {
  db.prepare(`
    INSERT INTO requests (
      id, workspace_id, title, description, category, priority, status, submitted_by, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'req_demo_growth_1',
    seed.id,
    'Refresh location landing pages',
    'Need SEO copy and metadata refresh across top 5 service-area pages.',
    'content',
    'high',
    'in_progress',
    'Client Team',
    JSON.stringify([]),
    DEMO_NOW,
    DEMO_NOW,
  );

  db.prepare(`
    INSERT INTO work_orders (
      id, workspace_id, payment_id, product_type, status, page_ids, quantity, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'wo_demo_growth_1',
    seed.id,
    'pay_demo_growth_1',
    'seo_fix_pack',
    'in_progress',
    JSON.stringify(['page-home', 'page-services']),
    1,
    'Wave seed: active fulfillment item for workflow smoke checks.',
    DEMO_NOW,
    DEMO_NOW,
  );
}

function seedPremiumHistoryWorkspace(seed: DemoWorkspaceSeed): void {
  const siteId = seed.webflowSiteId ?? 'site_demo_premium';

  db.prepare(`
    INSERT INTO content_briefs (
      id, workspace_id, target_keyword, secondary_keywords, suggested_title, suggested_meta_desc,
      outline, word_count_target, intent, audience, competitor_insights, internal_link_suggestions,
      created_at, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'brief_demo_premium_1',
    seed.id,
    'houston hvac maintenance checklist',
    JSON.stringify(['hvac tune-up checklist', 'seasonal hvac maintenance']),
    'The HVAC Maintenance Checklist Homeowners Actually Use',
    'A practical, step-by-step HVAC checklist for every season.',
    JSON.stringify(['Intro', 'Spring checklist', 'Summer checklist', 'Fall checklist', 'Winter checklist']),
    1600,
    'informational',
    'Homeowners',
    'Seeded historical brief for QA/demo validation.',
    JSON.stringify(['/services', '/maintenance-plans']),
    DEMO_NOW,
    'approved',
  );

  db.prepare(`
    INSERT INTO content_posts (
      id, workspace_id, brief_id, target_keyword, title, meta_description, introduction, sections,
      conclusion, seo_title, seo_meta_description, total_word_count, target_word_count,
      status, created_at, updated_at, published_at, published_slug
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'post_demo_premium_1',
    seed.id,
    'brief_demo_premium_1',
    'houston hvac maintenance checklist',
    'The HVAC Maintenance Checklist Homeowners Actually Use',
    'A practical, step-by-step HVAC checklist for every season.',
    'Keeping your HVAC system healthy starts with repeatable habits.',
    JSON.stringify([{ heading: 'Spring', content: 'Inspect filters and condenser coils.' }]),
    'Consistent maintenance lowers emergency repair risk and utility waste.',
    'HVAC Maintenance Checklist for Homeowners',
    'Use this seasonal HVAC checklist to keep your system efficient all year.',
    1240,
    1600,
    'published',
    DEMO_NOW,
    DEMO_NOW,
    DEMO_NOW,
    '/blog/hvac-maintenance-checklist',
  );

  db.prepare(`
    INSERT INTO approval_batches (
      id, workspace_id, site_id, name, items, status, created_at, updated_at, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'approval_demo_premium_1',
    seed.id,
    siteId,
    'SEO metadata rollout',
    JSON.stringify([{ pageId: 'home', field: 'metaDescription', current: 'Old copy', suggested: 'Improved client-facing copy' }]),
    'pending',
    DEMO_NOW,
    DEMO_NOW,
    'Please review before Friday publish.',
  );

  db.prepare(`
    INSERT INTO client_actions (
      id, workspace_id, source_type, source_id, title, summary, payload, status, priority, client_note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'client_action_demo_premium_1',
    seed.id,
    'content_post',
    'post_demo_premium_1',
    'Approve final CTA block',
    'Choose between two CTA variants before publishing.',
    JSON.stringify({ options: ['Book a spring tune-up', 'Start a maintenance plan'] }),
    'completed',
    'medium',
    'Variant A approved last week.',
    DEMO_NOW,
    DEMO_NOW,
  );

  db.prepare(`
    INSERT INTO schema_site_plans (
      id, site_id, workspace_id, site_url, canonical_entities, page_roles, status, generated_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'schema_plan_demo_premium_1',
    siteId,
    seed.id,
    `https://${seed.domain}`,
    JSON.stringify([{ id: 'brand', label: 'Premium Demo HVAC', type: 'Organization' }]),
    JSON.stringify([{ pageId: 'home', role: 'homepage', schemaType: 'Organization' }]),
    'sent_to_client',
    DEMO_NOW,
    DEMO_NOW,
  );

  db.prepare(`
    INSERT INTO schema_snapshots (
      id, site_id, workspace_id, created_at, results, page_count, schema_org_validation_status, schema_org_validation_details
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'schema_snapshot_demo_premium_1',
    siteId,
    seed.id,
    DEMO_NOW,
    JSON.stringify([{ pageId: 'home', type: 'Organization', valid: true }]),
    1,
    'valid',
    JSON.stringify({ warnings: [] }),
  );
}

function seedRichCmsWorkspace(seed: DemoWorkspaceSeed): void {
  const siteId = seed.webflowSiteId ?? 'site_demo_rich_cms';

  db.prepare(`
    INSERT INTO requests (
      id, workspace_id, title, description, category, priority, status, submitted_by, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'req_demo_rich_1',
    seed.id,
    'Bulk alt-text pass',
    'Need alt text and compression on image-heavy CMS inventory.',
    'seo',
    'medium',
    'new',
    'Client Team',
    JSON.stringify([]),
    DEMO_NOW,
    DEMO_NOW,
  );

  db.prepare(`
    INSERT INTO page_edit_states (
      workspace_id, page_id, slug, status, audit_issues, fields, source, updated_at, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    seed.id,
    'cms-page-1',
    '/guides/spring-maintenance',
    'pending',
    JSON.stringify(['title_length']),
    JSON.stringify(['seoTitle']),
    'seo-audit',
    DEMO_NOW,
    'system-seed',
  );

  db.prepare(`
    INSERT INTO page_edit_states (
      workspace_id, page_id, slug, status, audit_issues, fields, source, updated_at, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    seed.id,
    'cms-page-2',
    '/guides/filter-replacement',
    'in_review',
    JSON.stringify(['meta_description_missing']),
    JSON.stringify(['seoDescription']),
    'seo-editor',
    DEMO_NOW,
    'system-seed',
  );

  db.prepare(`
    INSERT INTO content_topic_requests (
      id, workspace_id, topic, target_keyword, intent, priority, rationale, status, source, service_type,
      page_type, comments, requested_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'topic_demo_rich_1',
    seed.id,
    'Duct cleaning myths',
    'does duct cleaning improve air quality',
    'informational',
    'medium',
    'Populate content planner lane with realistic CMS pipeline history.',
    'requested',
    'strategy',
    'brief_only',
    'blog',
    JSON.stringify([]),
    DEMO_NOW,
    DEMO_NOW,
  );

  db.prepare(`
    INSERT INTO schema_site_plans (
      id, site_id, workspace_id, site_url, canonical_entities, page_roles, status, generated_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'schema_plan_demo_rich_1',
    siteId,
    seed.id,
    `https://${seed.domain}`,
    JSON.stringify([{ id: 'org', label: 'Rich CMS Demo', type: 'Organization' }]),
    JSON.stringify([
      { pageId: 'cms-page-1', role: 'article', schemaType: 'Article' },
      { pageId: 'cms-page-2', role: 'article', schemaType: 'Article' },
    ]),
    'active',
    DEMO_NOW,
    DEMO_NOW,
  );
}

function seedScenarioData(seed: DemoWorkspaceSeed): void {
  if (seed.scenario === 'growth-active') {
    seedGrowthActiveWorkspace(seed);
    return;
  }

  if (seed.scenario === 'premium-history') {
    seedPremiumHistoryWorkspace(seed);
    return;
  }

  if (seed.scenario === 'rich-cms') {
    seedRichCmsWorkspace(seed);
  }
}

function runSeed(): Array<{ seed: DemoWorkspaceSeed; status: 'created' | 'updated' }> {
  const tx = db.transaction(() => {
    const results = DEMO_WORKSPACES.map(seed => ({ seed, status: upsertDemoWorkspace(seed) }));
    for (const seed of DEMO_WORKSPACES) resetWorkspaceDemoData(seed.id);
    for (const seed of DEMO_WORKSPACES) seedScenarioData(seed);
    return results;
  });

  return tx();
}

function main(): void {
  assertDemoSeedEnvironmentSafe();
  const results = runSeed();

  console.log('\nDemo workspace seeding complete:\n');
  for (const { seed, status } of results) {
    console.log(`- ${status.toUpperCase()}  ${seed.id} (${seed.tier}, ${seed.scenario})`);
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

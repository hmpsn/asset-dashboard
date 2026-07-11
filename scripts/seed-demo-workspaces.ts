#!/usr/bin/env tsx

import { pathToFileURL } from 'url';
import db from '../server/db/index.js';
import {
  DEMO_WORKSPACE_SCENARIOS,
  type DemoScenario,
} from '../shared/demo-workspace-scenarios.js';
import {
  createLocalSiteSpeedFixture,
  LOCAL_PROVIDER_FIXTURE,
} from '../server/providers/local-provider-fixtures.js';

interface DemoWorkspaceSeed {
  id: string;
  name: string;
  folder: string;
  tier: 'free' | 'growth' | 'premium';
  scenario: DemoScenario | 'provider-rich';
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

export const PROVIDER_RICH_DEMO_WORKSPACE: DemoWorkspaceSeed = {
  id: LOCAL_PROVIDER_FIXTURE.workspaceId,
  name: 'Provider Rich Studio',
  folder: 'provider-rich-demo',
  tier: 'premium',
  scenario: 'provider-rich',
  domain: LOCAL_PROVIDER_FIXTURE.domain,
  webflowSiteId: LOCAL_PROVIDER_FIXTURE.siteId,
  webflowSiteName: LOCAL_PROVIDER_FIXTURE.businessName,
  webflowToken: 'demo-webflow-token-provider-rich',
  clientPassword: DEMO_PASSWORD,
  gscPropertyUrl: LOCAL_PROVIDER_FIXTURE.gscPropertyUrl,
  ga4PropertyId: LOCAL_PROVIDER_FIXTURE.ga4PropertyId,
  seoDataProvider: 'dataforseo',
};

const ALL_DEMO_WORKSPACES = [...DEMO_WORKSPACES, PROVIDER_RICH_DEMO_WORKSPACE];

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

function resetProviderRichData(workspaceId: string): void {
  db.prepare('DELETE FROM local_visibility_snapshots WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM business_listing_snapshots WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM serp_snapshots WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM llm_mention_snapshots WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM competitor_alerts WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM competitor_snapshots WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM rank_snapshots WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM tracked_keywords WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM rank_tracking_config WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM performance_snapshots WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM client_locations WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM local_seo_markets WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM local_seo_workspace_settings WHERE workspace_id = ?').run(workspaceId);
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
    'aeo_change',
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

function seedProviderRichLocalSeo(seed: DemoWorkspaceSeed): void {
  const marketId = 'market_provider_rich_austin';
  const locationId = 'location_provider_rich_austin';
  db.prepare(`
    UPDATE workspaces
    SET competitor_domains = ?, competitor_domains_at_last_fetch = ?, competitor_last_fetched_at = ?
    WHERE id = ?
  `).run(
    JSON.stringify(['signal-studio.example', 'north-loop-growth.example']),
    JSON.stringify(['signal-studio.example', 'north-loop-growth.example']),
    LOCAL_PROVIDER_FIXTURE.capturedAt,
    seed.id,
  );
  db.prepare(`
    INSERT INTO local_seo_workspace_settings (
      workspace_id, posture, posture_source, suggested_posture, suggestion_reasons, updated_at, keywords_per_refresh
    ) VALUES (?, 'local', 'business_profile', NULL, ?, ?, 100)
  `).run(seed.id, JSON.stringify(['Primary market and verified business identity are configured.']), LOCAL_PROVIDER_FIXTURE.capturedAt);
  db.prepare(`
    INSERT INTO local_seo_markets (
      id, workspace_id, label, city, state_or_region, country, latitude, longitude,
      provider_location_code, provider_location_name, source, status, created_at, updated_at, is_primary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'business_profile', 'active', ?, ?, 1)
  `).run(
    marketId,
    seed.id,
    'Austin, TX',
    'Austin',
    'TX',
    'US',
    30.2672,
    -97.7431,
    1026201,
    'Austin,Texas,United States',
    LOCAL_PROVIDER_FIXTURE.capturedAt,
    LOCAL_PROVIDER_FIXTURE.capturedAt,
  );
  db.prepare(`
    INSERT INTO client_locations (
      id, workspace_id, name, domain, phone, street_address, city, state_or_region, country,
      is_primary, status, gbp_place_id, primary_market_id, page_target_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'confirmed', ?, ?, ?, ?, ?)
  `).run(
    locationId,
    seed.id,
    LOCAL_PROVIDER_FIXTURE.businessName,
    LOCAL_PROVIDER_FIXTURE.domain,
    '+1-512-555-0142',
    '600 Congress Ave',
    'Austin',
    'TX',
    'US',
    LOCAL_PROVIDER_FIXTURE.gbpPlaceId,
    marketId,
    '/services/seo',
    LOCAL_PROVIDER_FIXTURE.capturedAt,
    LOCAL_PROVIDER_FIXTURE.capturedAt,
  );

  const dates = ['2026-06-12', '2026-06-26', '2026-07-10'];
  const keywords = [
    { keyword: 'seo agency austin', rank: 2 },
    { keyword: 'technical seo austin', rank: 3 },
    { keyword: 'content strategy austin', rank: 5 },
    { keyword: 'webflow seo agency', rank: 4 },
    { keyword: 'organic growth consultant', rank: 6 },
  ];
  const insert = db.prepare(`
    INSERT INTO local_visibility_snapshots (
      id, workspace_id, keyword, normalized_keyword, market_id, market_label, captured_at,
      local_pack_present, business_found, business_match_confidence, business_match_reason,
      local_rank, top_competitors, source_endpoint, provider, device, language_code, status,
      degraded_reason, matched_location_id, matched_location_name, raw_results
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 'verified', ?, ?, ?, 'google_local_finder',
      'fake-seo-provider', 'desktop', 'en', 'success', NULL, ?, ?, ?)
  `);
  for (const [dateIndex, date] of dates.entries()) {
    for (const [keywordIndex, fixture] of keywords.entries()) {
      const rank = fixture.rank + (dates.length - dateIndex - 1);
      const competitors = [
        { title: 'Signal Studio', rank: 1, domain: 'signal-studio.example', address: 'Austin, TX' },
        { title: 'North Loop Growth', rank: 3 + keywordIndex, domain: 'north-loop-growth.example', address: 'Austin, TX' },
      ];
      const owned = {
        title: LOCAL_PROVIDER_FIXTURE.businessName,
        rank,
        domain: LOCAL_PROVIDER_FIXTURE.domain,
        url: `https://${LOCAL_PROVIDER_FIXTURE.domain}/services/seo`,
        address: '600 Congress Ave, Austin, TX',
      };
      insert.run(
        `local_provider_${date.replaceAll('-', '')}_${keywordIndex}`,
        seed.id,
        fixture.keyword,
        fixture.keyword,
        marketId,
        'Austin, TX',
        `${date}T12:00:00.000Z`,
        `Matched verified domain and place ID at local rank ${rank}.`,
        rank,
        JSON.stringify(competitors),
        locationId,
        LOCAL_PROVIDER_FIXTURE.businessName,
        JSON.stringify([owned, ...competitors]),
      );
    }
  }
}

function seedProviderRichSearchEvidence(seed: DemoWorkspaceSeed): void {
  const keywords = [
    { query: 'seo agency austin', position: 3, volume: 1_300, difficulty: 42, path: '/services/seo', title: 'SEO Services' },
    { query: 'technical seo studio', position: 5, volume: 720, difficulty: 36, path: '/services/seo', title: 'SEO Services' },
    { query: 'organic growth strategy', position: 9, volume: 1_000, difficulty: 48, path: '/insights/organic-growth', title: 'Organic Growth Insights' },
    { query: 'seo reporting agency', position: 7, volume: 590, difficulty: 34, path: '/work', title: 'Selected Work' },
    { query: 'content strategy austin', position: 11, volume: 480, difficulty: 31, path: '/services/seo', title: 'SEO Services' },
  ];
  db.prepare(`
    INSERT INTO rank_tracking_config (workspace_id, tracked_keywords) VALUES (?, '[]')
  `).run(seed.id);
  const insertTracked = db.prepare(`
    INSERT INTO tracked_keywords (
      workspace_id, normalized_query, query, pinned, added_at, source, status,
      page_path, page_title, intent, volume, difficulty, baseline_position,
      baseline_clicks, baseline_impressions
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const [index, keyword] of keywords.entries()) {
    insertTracked.run(
      seed.id,
      keyword.query,
      keyword.query,
      index < 2 ? 1 : 0,
      '2026-05-29T12:00:00.000Z',
      index === 0 ? 'strategy_primary' : 'strategy_site_keyword',
      keyword.path,
      keyword.title,
      index < 2 ? 'commercial' : 'informational',
      keyword.volume,
      keyword.difficulty,
      keyword.position + 6,
      32 + index * 7,
      640 + index * 120,
    );
  }

  const dates = ['2026-05-29', '2026-06-05', '2026-06-12', '2026-06-19', '2026-06-26', '2026-07-03', '2026-07-10'];
  const insertRank = db.prepare('INSERT INTO rank_snapshots (workspace_id, date, queries) VALUES (?, ?, ?)');
  const insertSerp = db.prepare(`
    INSERT INTO serp_snapshots (
      workspace_id, date, query, position, matched_url, features, ai_overview_cited, ai_overview_present
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const [dateIndex, date] of dates.entries()) {
    const queries = keywords.map((keyword, keywordIndex) => {
      const position = keyword.position + (dates.length - dateIndex - 1);
      const clicks = 38 + dateIndex * 9 + keywordIndex * 5;
      const impressions = 690 + dateIndex * 74 + keywordIndex * 93;
      return {
        query: keyword.query,
        position,
        clicks,
        impressions,
        ctr: Number(((clicks / impressions) * 100).toFixed(1)),
      };
    });
    insertRank.run(seed.id, date, JSON.stringify(queries));
    for (const [keywordIndex, keyword] of keywords.entries()) {
      const position = keyword.position + (dates.length - dateIndex - 1);
      const aiOverviewPresent = keywordIndex < 3 ? 1 : 0;
      const aiOverviewCited = keywordIndex < 2 && dateIndex >= 4 ? 1 : 0;
      insertSerp.run(
        seed.id,
        date,
        keyword.query,
        position,
        `https://${LOCAL_PROVIDER_FIXTURE.domain}${keyword.path}`,
        JSON.stringify(aiOverviewPresent
          ? ['ai_overview', 'people_also_ask', 'organic']
          : ['featured_snippet', 'organic']),
        aiOverviewPresent ? aiOverviewCited : null,
        aiOverviewPresent,
      );
    }
  }
}

function seedProviderRichProviderSnapshots(seed: DemoWorkspaceSeed): void {
  const marketId = 'market_provider_rich_austin';
  const locationId = 'location_provider_rich_austin';
  const listingDates = ['2026-06-12', '2026-06-26', '2026-07-10'];
  const insertListing = db.prepare(`
    INSERT INTO business_listing_snapshots (
      workspace_id, place_id, snapshot_date, is_owned, location_id, market_id, title,
      domain, cid, category, rating_value, review_count, rating_distribution,
      attributes, total_photos, claimed, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const [dateIndex, date] of listingDates.entries()) {
    insertListing.run(
      seed.id,
      LOCAL_PROVIDER_FIXTURE.gbpPlaceId,
      date,
      1,
      locationId,
      marketId,
      LOCAL_PROVIDER_FIXTURE.businessName,
      LOCAL_PROVIDER_FIXTURE.domain,
      'cid_provider_rich_primary',
      'Marketing agency',
      4.8,
      159 + dateIndex * 14,
      JSON.stringify({ '1': 2, '2': 1, '3': 5, '4': 24, '5': 127 + dateIndex * 14 }),
      JSON.stringify(['has_wheelchair_accessible_entrance', 'offers_online_appointments', 'identifies_as_women_owned']),
      54 + dateIndex * 5,
      1,
      `${date}T12:00:00.000Z`,
    );
    insertListing.run(
      seed.id,
      'place_signal_studio',
      date,
      0,
      null,
      marketId,
      'Signal Studio',
      'signal-studio.example',
      'cid_signal_studio',
      'Marketing agency',
      4.9,
      242 + dateIndex * 11,
      null,
      JSON.stringify(['offers_online_appointments']),
      83 + dateIndex * 4,
      1,
      `${date}T12:00:00.000Z`,
    );
    insertListing.run(
      seed.id,
      'place_north_loop_growth',
      date,
      0,
      null,
      marketId,
      'North Loop Growth',
      'north-loop-growth.example',
      'cid_north_loop_growth',
      'Internet marketing service',
      4.6,
      129 + dateIndex * 7,
      null,
      JSON.stringify(['has_wheelchair_accessible_entrance']),
      32 + dateIndex * 3,
      1,
      `${date}T12:00:00.000Z`,
    );
  }

  const mentionDates = ['2026-05-29', '2026-06-12', '2026-06-26', '2026-07-10'];
  const insertMentions = db.prepare(`
    INSERT INTO llm_mention_snapshots (
      workspace_id, snapshot_date, platform, domain, mentions, ai_search_volume,
      share_of_voice, competitor_brands, source_domains, fetched_at
    ) VALUES (?, ?, 'chat_gpt', ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const [index, date] of mentionDates.entries()) {
    insertMentions.run(
      seed.id,
      date,
      LOCAL_PROVIDER_FIXTURE.domain,
      24 + index * 6,
      6_120 + index * 780,
      0.31 + index * 0.037,
      JSON.stringify([
        { name: 'Signal Studio', mentions: 34 - index, aiSearchVolume: 6_240 },
        { name: 'North Loop Growth', mentions: 21 - index, aiSearchVolume: 3_710 },
      ]),
      JSON.stringify([
        { domain: LOCAL_PROVIDER_FIXTURE.domain, mentions: 15 + index * 4 },
        { domain: 'clutch.co', mentions: 8 + index },
        { domain: 'austinbusinessjournal.com', mentions: 4 + index },
      ]),
      `${date}T12:00:00.000Z`,
    );
  }

  const insertCompetitor = db.prepare(`
    INSERT INTO competitor_snapshots (
      id, workspace_id, competitor_domain, snapshot_date, keyword_count, organic_traffic, top_keywords, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const competitors = [
    { domain: 'signal-studio.example', keywordCount: 4_620, traffic: 18_900 },
    { domain: 'north-loop-growth.example', keywordCount: 3_280, traffic: 12_440 },
  ];
  for (const [competitorIndex, competitor] of competitors.entries()) {
    for (const [dateIndex, date] of listingDates.entries()) {
      insertCompetitor.run(
        `competitor_provider_${competitorIndex}_${date.replaceAll('-', '')}`,
        seed.id,
        competitor.domain,
        date,
        competitor.keywordCount + dateIndex * 90,
        competitor.traffic + dateIndex * 520,
        JSON.stringify([
          { keyword: 'seo agency austin', position: 1 + competitorIndex, volume: 1_300 },
          { keyword: 'technical seo studio', position: 4 + competitorIndex, volume: 720 },
          { keyword: 'organic growth strategy', position: 6 + competitorIndex, volume: 1_000 },
        ]),
        `${date}T12:00:00.000Z`,
      );
    }
  }

  const insertPerformance = db.prepare(`
    INSERT INTO performance_snapshots (sub, site_id, workspace_id, created_at, result)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const strategy of ['mobile', 'desktop'] as const) {
    insertPerformance.run(
      `pagespeed:${strategy}`,
      LOCAL_PROVIDER_FIXTURE.siteId,
      seed.id,
      LOCAL_PROVIDER_FIXTURE.capturedAt,
      JSON.stringify(createLocalSiteSpeedFixture(strategy)),
    );
  }
}

function seedProviderRichWorkspace(seed: DemoWorkspaceSeed): void {
  seedProviderRichLocalSeo(seed);
  seedProviderRichSearchEvidence(seed);
  seedProviderRichProviderSnapshots(seed);
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
    return;
  }

  if (seed.scenario === 'provider-rich') {
    seedProviderRichWorkspace(seed);
  }
}

function runSeed(): Array<{ seed: DemoWorkspaceSeed; status: 'created' | 'updated' }> {
  const tx = db.transaction(() => {
    const results = ALL_DEMO_WORKSPACES.map(seed => ({ seed, status: upsertDemoWorkspace(seed) }));
    for (const seed of ALL_DEMO_WORKSPACES) resetWorkspaceDemoData(seed.id);
    resetProviderRichData(PROVIDER_RICH_DEMO_WORKSPACE.id);
    for (const seed of ALL_DEMO_WORKSPACES) seedScenarioData(seed);
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

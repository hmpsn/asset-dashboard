/**
 * Comprehensive shape and uniqueness tests for `queryKeys`.
 *
 * The existing useWsInvalidation tests use queryKeys as a helper but don't
 * systematically validate the shapes of every factory. This file covers the
 * rest of the key builders.
 */
import { describe, it, expect } from 'vitest';
import { queryKeys } from '../../src/lib/queryKeys.js';

const WS = 'ws-test';
const SITE = 'site-abc';
const ID = 'item-1';

// ── Admin — analytics ──────────────────────────────────────────────────────────

describe('queryKeys.admin analytics keys', () => {
  it('ga4 key contains namespace, wsId, metric, days', () => {
    const key = queryKeys.admin.ga4(WS, 'sessions', 30);
    expect(key).toEqual(['admin-ga4', WS, 'sessions', 30]);
  });

  it('ga4All is a prefix of ga4', () => {
    const all = queryKeys.admin.ga4All(WS);
    const specific = queryKeys.admin.ga4(WS, 'pageviews', 7);
    expect(specific.slice(0, all.length)).toEqual([...all]);
  });

  it('gsc key contains namespace, siteId, url, metric, days', () => {
    const key = queryKeys.admin.gsc(SITE, 'https://x.com/', 'clicks', 90);
    expect(key).toEqual(['admin-gsc', SITE, 'https://x.com/', 'clicks', 90]);
  });

  it('gscAll is a prefix of gsc', () => {
    const all = queryKeys.admin.gscAll(SITE);
    const specific = queryKeys.admin.gsc(SITE, '/', 'impressions', 28);
    expect(specific.slice(0, all.length)).toEqual([...all]);
  });

  it('gscAny returns global admin GSC namespace', () => {
    expect(queryKeys.admin.gscAny()).toEqual(['admin-gsc']);
  });
});

// ── Admin — content ────────────────────────────────────────────────────────────

describe('queryKeys.admin content keys', () => {
  it('briefs key shape', () => {
    expect(queryKeys.admin.briefs(WS)).toEqual(['admin-briefs', WS]);
  });

  it('brief key includes briefId', () => {
    expect(queryKeys.admin.brief(WS, ID)).toEqual(['admin-brief', WS, ID]);
  });

  it('posts key shape', () => {
    expect(queryKeys.admin.posts(WS)).toEqual(['admin-posts', WS]);
  });

  it('post key includes postId', () => {
    expect(queryKeys.admin.post(WS, ID)).toEqual(['admin-post', WS, ID]);
  });

  it('postsDetailAll is a prefix of post', () => {
    const all = queryKeys.admin.postsDetailAll(WS);
    const specific = queryKeys.admin.post(WS, ID);
    expect(specific.slice(0, all.length)).toEqual([...all]);
  });

  it('postVersions key includes wsId and postId', () => {
    expect(queryKeys.admin.postVersions(WS, ID)).toEqual(['admin-post-versions', WS, ID]);
  });

  it('contentCalendar key shape', () => {
    expect(queryKeys.admin.contentCalendar(WS)).toEqual(['content-calendar', WS]);
  });

  it('contentPipeline key shape', () => {
    expect(queryKeys.admin.contentPipeline(WS)).toEqual(['content-pipeline', WS]);
  });

  it('roi key shape', () => {
    expect(queryKeys.admin.roi(WS)).toEqual(['admin-roi', WS]);
  });
});

// ── Admin — SEO / Audit ────────────────────────────────────────────────────────

describe('queryKeys.admin SEO keys', () => {
  it('auditAll returns array without wsId', () => {
    expect(queryKeys.admin.auditAll()).toEqual(['admin-audit']);
  });

  it('auditTraffic includes siteId', () => {
    expect(queryKeys.admin.auditTraffic(SITE)).toEqual(['admin-audit-traffic', SITE]);
  });

  it('auditTrafficAll returns audit traffic namespace', () => {
    expect(queryKeys.admin.auditTrafficAll()).toEqual(['admin-audit-traffic']);
  });

  it('schemaSnapshot without wsId', () => {
    const key = queryKeys.admin.schemaSnapshot(SITE);
    expect(key).toEqual(['admin-schema-snapshot', SITE]);
  });

  it('schemaSnapshot with wsId is longer key', () => {
    const key = queryKeys.admin.schemaSnapshot(SITE, WS);
    expect(key).toEqual(['admin-schema-snapshot', SITE, WS]);
  });

  it('webflowPages without wsId', () => {
    expect(queryKeys.admin.webflowPages(SITE)).toEqual(['admin-webflow-pages', SITE]);
  });

  it('webflowPages with wsId', () => {
    expect(queryKeys.admin.webflowPages(SITE, WS)).toEqual(['admin-webflow-pages', SITE, WS]);
  });

  it('keywordStrategy key shape', () => {
    expect(queryKeys.admin.keywordStrategy(WS)).toEqual(['keyword-strategy', WS]);
  });

  it('keywordCommandCenterDetail includes keyword', () => {
    const key = queryKeys.admin.keywordCommandCenterDetail(WS, 'seo agency');
    expect(key).toEqual(['admin-keyword-command-center', WS, 'detail', 'seo agency']);
  });

  it('keywordCommandCenterSummary is prefix of detail key', () => {
    const summary = queryKeys.admin.keywordCommandCenterSummary(WS);
    const detail = queryKeys.admin.keywordCommandCenterDetail(WS, 'x');
    expect(detail.slice(0, summary.length - 1)).toEqual(summary.slice(0, -1));
  });

  it('seoEditor without wsId', () => {
    expect(queryKeys.admin.seoEditor(SITE)).toEqual(['seo-editor', SITE]);
  });

  it('seoEditor with wsId', () => {
    expect(queryKeys.admin.seoEditor(SITE, WS)).toEqual(['seo-editor', SITE, WS]);
  });

  it('seoEditorAll returns base prefix', () => {
    expect(queryKeys.admin.seoEditorAll()).toEqual(['seo-editor']);
  });

  it('anomalyAlerts key shape', () => {
    expect(queryKeys.admin.anomalyAlerts(WS)).toEqual(['anomaly-alerts', WS]);
  });

  it('rankTrackingKeywords key shape', () => {
    expect(queryKeys.admin.rankTrackingKeywords(WS)).toEqual(['admin-rank-tracking-keywords', WS]);
  });

  it('competitorIntel includes competitorKey', () => {
    const key = queryKeys.admin.competitorIntel(WS, 'competitor-a');
    expect(key).toEqual(['admin-competitive-intel', WS, 'competitor-a']);
  });

  it('competitorIntelAll is a prefix of competitorIntel', () => {
    const all = queryKeys.admin.competitorIntelAll(WS);
    const specific = queryKeys.admin.competitorIntel(WS, 'comp-x');
    expect(specific.slice(0, all.length)).toEqual([...all]);
  });
});

// ── Admin — Brand Engine ───────────────────────────────────────────────────────

describe('queryKeys.admin brand engine keys', () => {
  it('brandscripts key shape', () => {
    expect(queryKeys.admin.brandscripts(WS)).toEqual(['admin-brandscripts', WS]);
  });

  it('brandscriptTemplates has no params', () => {
    expect(queryKeys.admin.brandscriptTemplates()).toEqual(['admin-brandscript-templates']);
  });

  it('voiceProfile key shape', () => {
    expect(queryKeys.admin.voiceProfile(WS)).toEqual(['admin-voice-profile', WS]);
  });

  it('blueprints key shape', () => {
    expect(queryKeys.admin.blueprints(WS)).toEqual(['admin-blueprints', WS]);
  });

  it('blueprint includes blueprintId', () => {
    expect(queryKeys.admin.blueprint(WS, ID)).toEqual(['admin-blueprint', WS, ID]);
  });

  it('discoveryExtractions includes sourceId', () => {
    const key = queryKeys.admin.discoveryExtractions(WS, 'src-1');
    expect(key).toEqual(['admin-discovery-extractions', WS, 'src-1']);
  });

  it('discoveryExtractionsAll is a prefix of discoveryExtractions', () => {
    const all = queryKeys.admin.discoveryExtractionsAll(WS);
    const specific = queryKeys.admin.discoveryExtractions(WS, 'src-1');
    expect(specific.slice(0, all.length)).toEqual([...all]);
  });
});

// ── Admin — intelligence ────────────────────────────────────────────────────────

describe('queryKeys.admin intelligence keys', () => {
  it('intelligence with minimal params', () => {
    const key = queryKeys.admin.intelligence(WS);
    // must contain 'admin-intelligence' and wsId
    expect(key[0]).toBe('admin-intelligence');
    expect(key[1]).toBe(WS);
  });

  it('intelligence with slices sorts them', () => {
    const key1 = queryKeys.admin.intelligence(WS, ['seo', 'brand'] as const);
    const key2 = queryKeys.admin.intelligence(WS, ['brand', 'seo'] as const);
    expect(key1).toEqual(key2);
  });

  it('intelligence with different slices differ', () => {
    const key1 = queryKeys.admin.intelligence(WS, ['seo'] as const);
    const key2 = queryKeys.admin.intelligence(WS, ['brand'] as const);
    expect(key1).not.toEqual(key2);
  });

  it('intelligenceAll is a prefix of intelligence', () => {
    const all = queryKeys.admin.intelligenceAll(WS);
    const specific = queryKeys.admin.intelligence(WS);
    expect(specific.slice(0, all.length)).toEqual([...all]);
  });

  it('insightFeed key shape', () => {
    expect(queryKeys.admin.insightFeed(WS)).toEqual(['admin-insight-feed', WS]);
  });

  it('meetingBrief key shape', () => {
    expect(queryKeys.admin.meetingBrief(WS)).toEqual(['admin-meeting-brief', WS]);
  });
});

// ── Admin — Outcomes ───────────────────────────────────────────────────────────

describe('queryKeys.admin outcome keys', () => {
  it('outcomeActions key shape', () => {
    expect(queryKeys.admin.outcomeActions(WS)).toEqual(['admin-outcome-actions', WS]);
  });

  it('outcomeScorecard key shape', () => {
    expect(queryKeys.admin.outcomeScorecard(WS)).toEqual(['admin-outcome-scorecard', WS]);
  });

  it('outcomeLearnings key shape', () => {
    expect(queryKeys.admin.outcomeLearnings(WS)).toEqual(['admin-outcome-learnings', WS]);
  });

  it('outcomeOverview has no params', () => {
    expect(queryKeys.admin.outcomeOverview()).toEqual(['admin-outcome-overview']);
  });
});

// ── Admin — Workspace / Global ─────────────────────────────────────────────────

describe('queryKeys.admin workspace keys', () => {
  it('workspaces has no params', () => {
    expect(queryKeys.admin.workspaces()).toEqual(['admin-workspaces']);
  });

  it('workspaceDetail includes wsId', () => {
    expect(queryKeys.admin.workspaceDetail(WS)).toEqual(['admin-workspace-detail', WS]);
  });

  it('health has no params', () => {
    expect(queryKeys.admin.health()).toEqual(['admin-health']);
  });

  it('featureFlags has no params', () => {
    expect(queryKeys.admin.featureFlags()).toEqual(['admin-feature-flags']);
  });

  it('notifications has no params', () => {
    expect(queryKeys.admin.notifications()).toEqual(['admin-notifications']);
  });

  it('diagnostics key includes wsId', () => {
    expect(queryKeys.admin.diagnostics(WS)).toEqual(['admin-diagnostics', WS]);
  });

  it('diagnosticDetail includes reportId', () => {
    expect(queryKeys.admin.diagnosticDetail(WS, 'report-1')).toEqual(['admin-diagnostics', WS, 'report-1']);
  });
});

// ── Client keys ────────────────────────────────────────────────────────────────

describe('queryKeys.client keys', () => {
  it('ga4 key contains namespace, wsId, metric, days, dr', () => {
    const key = queryKeys.client.ga4(WS, 'pageviews', 30, undefined);
    expect(key).toEqual(['client-ga4', WS, 'pageviews', 30, undefined]);
  });

  it('ga4All is a prefix of ga4', () => {
    const all = queryKeys.client.ga4All(WS);
    const specific = queryKeys.client.ga4(WS, 'sessions', 7, undefined);
    expect(specific.slice(0, all.length)).toEqual([...all]);
  });

  it('gsc key uses client-search namespace', () => {
    const key = queryKeys.client.gsc(WS, 'clicks', 28, undefined);
    expect(key[0]).toBe('client-search');
  });

  it('gscAll key is a prefix of gsc', () => {
    const all = queryKeys.client.gscAll(WS);
    const specific = queryKeys.client.gsc(WS, 'impressions', 28, undefined);
    expect(specific.slice(0, all.length)).toEqual([...all]);
  });

  it('approvals key shape', () => {
    expect(queryKeys.client.approvals(WS)).toEqual(['client-approvals', WS]);
  });

  it('activity key shape', () => {
    expect(queryKeys.client.activity(WS)).toEqual(['client-activity', WS]);
  });

  it('strategy key shape', () => {
    expect(queryKeys.client.strategy(WS)).toEqual(['client-strategy', WS]);
  });

  it('insights key shape', () => {
    expect(queryKeys.client.insights(WS)).toEqual(['client-insights', WS]);
  });

  it('postPreview includes wsId and postId', () => {
    const key = queryKeys.client.postPreview(WS, 'post-1');
    expect(key).toEqual(['client', 'post-preview', WS, 'post-1']);
  });

  it('postPreview handles undefined postId', () => {
    const key = queryKeys.client.postPreview(WS, undefined);
    expect(key).toEqual(['client', 'post-preview', WS, undefined]);
  });

  it('copyEntriesCount is distinct from copyEntries', () => {
    const count = queryKeys.client.copyEntriesCount(WS);
    const entries = queryKeys.client.copyEntries(WS);
    expect(count).not.toEqual(entries);
  });

  it('copySections includes entryId', () => {
    const key = queryKeys.client.copySections(WS, ID);
    expect(key).toEqual(['client-copy-sections', WS, ID]);
  });

  it('copySectionsAll is a prefix of copySections', () => {
    const all = queryKeys.client.copySectionsAll(WS);
    const specific = queryKeys.client.copySections(WS, ID);
    expect(specific.slice(0, all.length)).toEqual([...all]);
  });

  it('monthlyDigest key shape', () => {
    expect(queryKeys.client.monthlyDigest(WS)).toEqual(['client-monthly-digest', WS]);
  });

  it('outcomeSummary key shape', () => {
    expect(queryKeys.client.outcomeSummary(WS)).toEqual(['client-outcome-summary', WS]);
  });
});

// ── Shared keys ─────────────────────────────────────────────────────────────────

describe('queryKeys.shared keys', () => {
  it('auditSummary key shape', () => {
    expect(queryKeys.shared.auditSummary(WS)).toEqual(['audit-summary', WS]);
  });

  it('recommendations key shape', () => {
    expect(queryKeys.shared.recommendations(WS)).toEqual(['recommendations', WS]);
  });

  it('pageEditStates public flag in key', () => {
    const pub = queryKeys.shared.pageEditStates(WS, true);
    const adm = queryKeys.shared.pageEditStates(WS, false);
    expect(pub).toEqual(['page-edit-states', WS, 'public']);
    expect(adm).toEqual(['page-edit-states', WS, 'admin']);
    expect(pub).not.toEqual(adm);
  });

  it('features has no params', () => {
    expect(queryKeys.shared.features()).toEqual(['features']);
  });

  it('featureFlags has no params', () => {
    expect(queryKeys.shared.featureFlags()).toEqual(['feature-flags']);
  });

  it('shared.featureFlags is distinct from admin.featureFlags', () => {
    expect(queryKeys.shared.featureFlags()).not.toEqual(queryKeys.admin.featureFlags());
  });
});

// ── Key uniqueness ──────────────────────────────────────────────────────────────

describe('queryKeys uniqueness across different params', () => {
  it('admin and client ga4 keys differ', () => {
    expect(queryKeys.admin.ga4All(WS)).not.toEqual(queryKeys.client.ga4All(WS));
  });

  it('admin and client approvals keys differ', () => {
    expect(queryKeys.admin.approvals(WS)).not.toEqual(queryKeys.client.approvals(WS));
  });

  it('admin copy-sections and client copy-sections differ', () => {
    expect(queryKeys.admin.copySections(WS, ID)).not.toEqual(queryKeys.client.copySections(WS, ID));
  });

  it('different workspace IDs produce different keys', () => {
    expect(queryKeys.admin.workspaceDetail('ws-a')).not.toEqual(queryKeys.admin.workspaceDetail('ws-b'));
  });
});

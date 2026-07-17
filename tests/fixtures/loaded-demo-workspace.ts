import db from '../../server/db/index.js';
import { createContentRequest } from '../../server/content-requests.js';
import { createPost } from '../../server/content-posts-db.js';
import { recordAction, recordOutcome } from '../../server/outcome-tracking.js';
import { replaceAllPageKeywords } from '../../server/page-keywords.js';
import { saveRedirectSnapshot } from '../../server/redirect-store.js';
import { saveSnapshot } from '../../server/reports.js';
import { addNote, createRequest } from '../../server/requests.js';
import { createWorkOrder } from '../../server/work-orders.js';
import type { ContentBrief, GeneratedPost } from '../../shared/types/content.js';
import type { PageKeywordMap } from '../../shared/types/workspace.js';
import {
  LOADED_DEMO_AUDIT_FIXTURE,
  LOADED_DEMO_REDIRECT_FIXTURE,
} from './loaded-demo-snapshots.js';

export const LOADED_DEMO_WORKSPACE_ID = 'ws_demo_loaded';
export const LOADED_DEMO_SITE_ID = 'site_demo_loaded';
export const LOADED_DEMO_NOW = '2026-07-16T12:00:00.000Z';

const BOARD_BRIEF_COUNT = 20;
const BOARD_DRAFT_COUNT = 15;
const BOARD_REVIEW_COUNT = 15;
const PAGE_KEYWORD_COUNT = 520;

function seedContentPipeline(workspaceId: string): void {
  const totalBriefs = BOARD_BRIEF_COUNT + BOARD_DRAFT_COUNT + BOARD_REVIEW_COUNT;
  const briefs: ContentBrief[] = Array.from({ length: totalBriefs }, (_, index) => {
    const item = index + 1;
    const targetKeyword = `enterprise seo workflow ${item}`;
    return {
      id: `brief_demo_loaded_${item}`,
      workspaceId,
      targetKeyword,
      secondaryKeywords: [`seo operations ${item}`, `organic growth system ${item}`],
      suggestedTitle: `Enterprise SEO Workflow ${item}: An Operator's Guide`,
      suggestedMetaDesc: `A practical guide to enterprise SEO workflow ${item}, with measurable steps for busy operators.`,
      outline: [{
        heading: 'What to decide first',
        notes: 'Lead with the operator decision and the evidence required to make it.',
        wordCount: 700,
        keywords: [targetKeyword],
      }],
      wordCountTarget: 1_600 + (index % 4) * 200,
      intent: index % 3 === 0 ? 'commercial' : 'informational',
      audience: 'SEO directors and growth operators',
      competitorInsights: 'Competing pages explain tactics but rarely connect them to an operating decision.',
      internalLinkSuggestions: ['/services/enterprise-seo', '/insights', '/case-studies'],
      pageType: index % 5 === 0 ? 'service' : 'blog',
      keywordSource: 'matrix',
      keywordLocked: true,
      createdAt: new Date(Date.parse(LOADED_DEMO_NOW) - index * 86_400_000).toISOString(),
    };
  });

  // The canonical writer lives in content-brief.ts, whose generation imports load
  // ai-deduplication.ts and start its ref'ed 60-second cleanup interval at module
  // evaluation. A one-shot seed must not start that server-lifetime resource, so
  // this deterministic fixture persists only the fields it owns directly.
  const insertBrief = db.prepare(`
    INSERT INTO content_briefs (
      id, workspace_id, target_keyword, secondary_keywords, suggested_title,
      suggested_meta_desc, outline, word_count_target, intent, audience,
      competitor_insights, internal_link_suggestions, created_at, page_type,
      keyword_locked, keyword_source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const brief of briefs) {
    insertBrief.run(
      brief.id,
      workspaceId,
      brief.targetKeyword,
      JSON.stringify(brief.secondaryKeywords),
      brief.suggestedTitle,
      brief.suggestedMetaDesc,
      JSON.stringify(brief.outline),
      brief.wordCountTarget,
      brief.intent,
      brief.audience,
      brief.competitorInsights,
      JSON.stringify(brief.internalLinkSuggestions),
      brief.createdAt,
      brief.pageType ?? null,
      brief.keywordLocked ? 1 : 0,
      brief.keywordSource ?? null,
    );
  }

  const postBriefs = briefs.slice(BOARD_BRIEF_COUNT);
  for (const [index, brief] of postBriefs.entries()) {
    const status: GeneratedPost['status'] = index < BOARD_DRAFT_COUNT ? 'draft' : 'review';
    const post: GeneratedPost = {
      id: `post_demo_loaded_${index + 1}`,
      workspaceId,
      briefId: brief.id,
      targetKeyword: brief.targetKeyword,
      title: brief.suggestedTitle,
      metaDescription: brief.suggestedMetaDesc,
      introduction: `<p>This loaded demo draft shows how ${brief.targetKeyword} moves from evidence to execution.</p>`,
      sections: [{
        index: 0,
        heading: 'From signal to decision',
        content: '<p>Review the signal, choose the responsible owner, and make the next action explicit.</p>',
        wordCount: 14,
        targetWordCount: 700,
        keywords: [brief.targetKeyword],
        status: 'done',
      }],
      conclusion: '<p>Keep the workflow measurable and close the loop with a recorded outcome.</p>',
      totalWordCount: 1_050 + index * 13,
      targetWordCount: brief.wordCountTarget,
      status,
      createdAt: brief.createdAt,
      updatedAt: new Date(Date.parse(LOADED_DEMO_NOW) - index * 3_600_000).toISOString(),
    };
    createPost(workspaceId, post);
  }
}

function seedCockpitProducers(workspaceId: string): void {
  const unanswered = createRequest(workspaceId, {
    title: 'Can we prioritize the migration guide?',
    description: 'The client needs the guide ready before the next product launch.',
    category: 'content',
    priority: 'urgent',
    submittedBy: 'Morgan Lee',
    pageUrl: '/guides/technical-seo-migration',
  });
  addNote(workspaceId, unanswered.id, 'team', 'We are checking the production schedule.');
  addNote(workspaceId, unanswered.id, 'client', 'Please confirm whether Friday is still realistic.');

  const seoRequest = createRequest(workspaceId, {
    title: 'Investigate rankings on location pages',
    description: 'Several location pages slipped after the navigation update.',
    category: 'seo',
    priority: 'high',
    submittedBy: 'Jordan Patel',
  });
  addNote(workspaceId, seoRequest.id, 'client', 'Austin and Denver are the most urgent markets.');

  const replied = createRequest(workspaceId, {
    title: 'Add a board-ready traffic export',
    description: 'Please include a concise organic performance summary for the board deck.',
    category: 'feature',
    priority: 'medium',
    submittedBy: 'Avery Chen',
  });
  addNote(workspaceId, replied.id, 'client', 'A PDF is fine for this month.');
  addNote(workspaceId, replied.id, 'team', 'The export is queued for Thursday delivery.');

  createContentRequest(workspaceId, {
    topic: 'Enterprise SEO operating model',
    targetKeyword: 'enterprise seo operating model',
    intent: 'commercial',
    priority: 'urgent',
    rationale: 'High-value full-post request awaiting purchase confirmation.',
    source: 'client',
    serviceType: 'full_post',
    pageType: 'pillar',
    initialStatus: 'pending_payment',
    dedupe: false,
  });
  for (let index = 0; index < 3; index++) {
    createContentRequest(workspaceId, {
      topic: `Technical SEO playbook ${index + 1}`,
      targetKeyword: `technical seo playbook ${index + 1}`,
      intent: 'informational',
      priority: index === 0 ? 'high' : 'medium',
      rationale: 'Seeded review-ready content request for Cockpit send-stream coverage.',
      source: index === 0 ? 'client' : 'strategy',
      serviceType: 'brief_only',
      pageType: 'blog',
      initialStatus: index === 0 ? 'brief_generated' : 'requested',
      dedupe: false,
    });
  }

  createWorkOrder(workspaceId, {
    paymentId: 'pay_demo_loaded_fix_pack',
    productType: 'fix_meta_10',
    status: 'in_progress',
    pageIds: ['loaded-services', 'loaded-location'],
    issueChecks: ['title-missing', 'meta-description'],
    quantity: 2,
  });

  const churnSignals = [
    ['no_login_14d', 'critical', 'Client sponsor has not logged in for 21 days'],
    ['chat_dropoff', 'warning', 'Advisor conversations dropped this month'],
    ['no_requests_30d', 'warning', 'A stakeholder group has gone quiet'],
    ['health_score_drop', 'critical', 'Site health fell after the latest release'],
    ['payment_failed', 'warning', 'A content purchase needs payment follow-up'],
  ] as const;
  const insertSignal = db.prepare(`
    INSERT INTO churn_signals (
      id, workspace_id, workspace_name, type, severity, title, description, detected_at, dismissed_at
    ) VALUES (?, ?, 'Loaded Demo Workspace', ?, ?, ?, ?, ?, NULL)
  `);
  for (const [index, [type, severity, title]] of churnSignals.entries()) {
    insertSignal.run(
      `churn_demo_loaded_${index + 1}`,
      workspaceId,
      type,
      severity,
      title,
      'Seeded client-risk producer for the loaded Cockpit work queue.',
      new Date(Date.parse(LOADED_DEMO_NOW) - index * 3_600_000).toISOString(),
    );
  }
}

function seedPageKeywords(workspaceId: string): void {
  const entries: PageKeywordMap[] = Array.from({ length: PAGE_KEYWORD_COUNT }, (_, index) => ({
    pagePath: `/library/seo-resource-${index + 1}`,
    pageTitle: `SEO Resource ${index + 1}`,
    primaryKeyword: `enterprise seo resource ${index + 1}`,
    secondaryKeywords: [`seo guide ${index + 1}`, `organic growth resource ${index + 1}`],
    searchIntent: index % 4 === 0 ? 'commercial' : 'informational',
    currentPosition: 2 + (index % 58),
    previousPosition: 3 + (index % 62),
    impressions: 180 + index * 9,
    clicks: 8 + (index % 71),
    volume: 90 + (index % 30) * 70,
    difficulty: 18 + (index % 63),
    cpc: index % 3 === 0 ? 0 : Number((1.25 + (index % 17) * 0.45).toFixed(2)),
    cpcSource: 'dataforseo',
    metricsSource: 'dataforseo',
    validated: true,
    topicCluster: `Cluster ${(index % 12) + 1}`,
  }));
  replaceAllPageKeywords(workspaceId, entries);

  // The production writer deliberately normalizes non-positive CPC to NULL. This
  // volume fixture needs explicit zero-vs-positive rows to exercise UI filtering,
  // so restore only the known zero fixture values after the canonical batch write.
  const setZeroCpc = db.prepare(`
    UPDATE page_keywords SET cpc = 0, cpc_source = 'dataforseo'
    WHERE workspace_id = ? AND page_path = ?
  `);
  for (let index = 0; index < PAGE_KEYWORD_COUNT; index += 3) {
    setZeroCpc.run(workspaceId, `/library/seo-resource-${index + 1}`);
  }
}

function seedWins(workspaceId: string): void {
  const fixtures = [
    { actionType: 'content_published', pageUrl: '/guides/technical-seo-migration', keyword: 'technical seo migration', score: 'strong_win', current: 164, value: 2_460 },
    { actionType: 'meta_updated', pageUrl: '/services/enterprise-seo', keyword: 'enterprise seo services', score: 'win', current: 112, value: 1_260 },
    { actionType: 'internal_link_added', pageUrl: '/locations/austin', keyword: 'austin seo consulting', score: 'win', current: 88, value: 940 },
  ] as const;
  for (const [index, fixture] of fixtures.entries()) {
    const action = recordAction({
      workspaceId,
      actionType: fixture.actionType,
      sourceType: index === 0 ? 'post' : 'audit',
      sourceId: `loaded-win-source-${index + 1}`,
      pageUrl: fixture.pageUrl,
      targetKeyword: fixture.keyword,
      baselineSnapshot: { captured_at: '2026-06-16T12:00:00.000Z', clicks: 40, impressions: 1_200, position: 14 },
      attribution: index === 2 ? 'externally_executed' : 'platform_executed',
      source: { label: `Loaded demo win ${index + 1}`, snapshot: { title: fixture.keyword, page: fixture.pageUrl } },
    });
    recordOutcome({
      actionId: action.id,
      checkpointDays: 30,
      metricsSnapshot: { captured_at: LOADED_DEMO_NOW, clicks: fixture.current, impressions: 4_800, position: 5 },
      score: fixture.score,
      deltaSummary: {
        primary_metric: 'clicks',
        baseline_value: 40,
        current_value: fixture.current,
        delta_absolute: fixture.current - 40,
        delta_percent: Number((((fixture.current - 40) / 40) * 100).toFixed(1)),
        direction: 'improved',
      },
      attributedValue: fixture.value,
      valueBasis: 'clicks_delta_x_cpc',
      provenance: 'measured_action',
    });
  }
}

export function resetLoadedDemoWorkspaceData(workspaceId: string, siteId: string): void {
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM analytics_insights WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM churn_signals WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM work_orders WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM requests WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM content_posts WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM content_briefs WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM page_keyword_score_history WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM page_keywords WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM audit_snapshots WHERE workspace_id = ? OR site_id = ?').run(workspaceId, siteId);
  db.prepare('DELETE FROM redirect_snapshots WHERE workspace_id = ? OR site_id = ?').run(workspaceId, siteId);
}

export function seedLoadedDemoWorkspaceData(workspaceId: string, siteId: string, siteName: string): void {
  seedContentPipeline(workspaceId);
  seedCockpitProducers(workspaceId);
  seedPageKeywords(workspaceId);
  saveSnapshot(siteId, siteName, LOADED_DEMO_AUDIT_FIXTURE);
  saveRedirectSnapshot(siteId, LOADED_DEMO_REDIRECT_FIXTURE);
  seedWins(workspaceId);
}

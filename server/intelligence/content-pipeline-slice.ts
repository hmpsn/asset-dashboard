import type {
  ContentPipelineSlice,
  ContentPipelineSummary,
  CopyPipelineSummary,
  CannibalizationWarning,
  DecayAlert,
} from '../../shared/types/intelligence.js';
import type { ContentSubscription, ContentMatrix } from '../../shared/types/content.js';
import type { SchemaSitePlan } from '../../shared/types/schema-plan.js';
import type { CannibalizationReport } from '../cannibalization-detection.js';
import type { DecayAnalysis } from '../content-decay.js';
import { createLogger } from '../logger.js';
import db from '../db/index.js';
import { createStmtCache } from '../db/stmt-cache.js';
import { parseJsonSafe } from '../db/json-validation.js';
import { z } from '../middleware/validate.js';

const log = createLogger('workspace-intelligence/content-pipeline');

const copyStmts = createStmtCache(() => ({
  sectionCounts: db.prepare(
    `SELECT status, COUNT(*) as cnt, COALESCE(SUM(CASE WHEN version = 1 THEN 1 ELSE 0 END), 0) as first_version_cnt
     FROM copy_sections WHERE workspace_id = ? GROUP BY status`,
  ),
  entryCounts: db.prepare(
    `SELECT entry_id,
       COUNT(*) as total,
       COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) as approved
     FROM copy_sections WHERE workspace_id = ? GROUP BY entry_id`,
  ),
  lastBatchJob: db.prepare(
    `SELECT status, progress_json, created_at
     FROM copy_batch_jobs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1`,
  ),
  activePatternCount: db.prepare(
    `SELECT COUNT(*) as cnt FROM copy_intelligence WHERE workspace_id = ? AND active = 1`,
  ),
}));

export async function assembleContentPipeline(workspaceId: string): Promise<ContentPipelineSlice> {
  let summary: ContentPipelineSummary = {
    briefs: { total: 0, byStatus: {} },
    posts: { total: 0, byStatus: {} },
    matrices: { total: 0, cellsPlanned: 0, cellsPublished: 0 },
    requests: { pending: 0, inProgress: 0, delivered: 0 },
    workOrders: { active: 0 },
    seoEdits: { pending: 0, applied: 0, inReview: 0 },
  };
  try {
    const { getContentPipelineSummary } = await import('../workspace-data.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    summary = getContentPipelineSummary(workspaceId);
  } catch (err) {
    log.warn({ err, workspaceId }, 'assembleContentPipeline: getContentPipelineSummary failed, degrading to empty slice');
  }

  // Coverage gaps: strategy keywords without any brief
  let coverageGaps: string[] = [];
  try {
    const { getWorkspace } = await import('../workspaces.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const ws = getWorkspace(workspaceId);
    const strategyKeywords: string[] = ws?.keywordStrategy?.siteKeywords?.map((k: string | { keyword: string }) =>
      typeof k === 'string' ? k : k.keyword,
    ) ?? [];
    const { listBriefs } = await import('../content-brief.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const briefs = listBriefs(workspaceId);
    const briefKeywords = new Set(briefs.map(b => b.targetKeyword?.trim().toLowerCase()));
    coverageGaps = strategyKeywords
      .filter(kw => !briefKeywords.has(kw.trim().toLowerCase()))
      .slice(0, 10);
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleContentPipeline: coverage gaps optional, degrading gracefully');
  }

  // Subscriptions
  let subscriptions: ContentPipelineSlice['subscriptions'];
  try {
    const { listContentSubscriptions } = await import('../content-subscriptions.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const subs: ContentSubscription[] = listContentSubscriptions(workspaceId);
    const activeSubs = subs.filter(s => s.status === 'active');
    const totalPages = activeSubs.reduce((sum, s) => sum + (s.postsPerMonth ?? 0), 0);
    subscriptions = { active: activeSubs.length, totalPages };
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleContentPipeline: subscriptions optional, degrading gracefully');
  }

  // Schema deployment
  let schemaDeployment: ContentPipelineSlice['schemaDeployment'];
  try {
    const { getWorkspace } = await import('../workspaces.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const ws = getWorkspace(workspaceId);
    if (ws?.webflowSiteId) {
      const { getSchemaPlan } = await import('../schema-store.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const { listPendingSchemas } = await import('../schema-queue.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const plan: SchemaSitePlan | null = getSchemaPlan(ws.webflowSiteId);
      const pending = listPendingSchemas(workspaceId);
      const planned = plan?.pageRoles?.length ?? 0;
      const deployed = Math.max(0, planned - pending.length);
      const types = [...new Set((plan?.pageRoles ?? []).map(p => p.primaryType).filter(Boolean))];
      schemaDeployment = { planned, deployed, types };
    }
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleContentPipeline: schema deployment optional, degrading gracefully');
  }

  // Cannibalization warnings
  let cannibalizationWarnings: CannibalizationWarning[] = [];
  try {
    const { listMatrices } = await import('../content-matrices.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const { detectMatrixCannibalization } = await import('../cannibalization-detection.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const matrices: ContentMatrix[] = listMatrices(workspaceId);
    for (const matrix of matrices.slice(0, 5)) {
      const report: CannibalizationReport = detectMatrixCannibalization(workspaceId, matrix.id);
      if (report?.conflicts) {
        for (const conflict of report.conflicts.slice(0, 10)) {
          cannibalizationWarnings.push({
            keyword: conflict.keyword ?? '',
            pages: [conflict.sourceId, conflict.conflictsWith?.identifier].filter((p): p is string => Boolean(p)),
            severity: conflict.severity ?? 'low',
          });
        }
      }
    }
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleContentPipeline: cannibalization detection optional, degrading gracefully');
  }

  // Decay alerts
  let decayAlerts: DecayAlert[] = [];
  try {
    const { loadDecayAnalysis } = await import('../content-decay.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const decay: DecayAnalysis | null = loadDecayAnalysis(workspaceId);
    if (decay?.decayingPages) {
      decayAlerts = decay.decayingPages.slice(0, 20).map(p => ({
        pageUrl: p.page ?? '',
        clickDrop: p.clickDeclinePct ?? 0,
        detectedAt: decay.analyzedAt ?? new Date().toISOString(),
        hasRefreshBrief: !!p.refreshRecommendation,
        isRepeatDecay: p.isRepeatDecay ?? false,
      }));
    }
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleContentPipeline: decay data optional, degrading gracefully');
  }

  // Suggested briefs count
  let suggestedBriefs = 0;
  try {
    const { listSuggestedBriefs } = await import('../suggested-briefs-store.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const briefs = listSuggestedBriefs(workspaceId);
    suggestedBriefs = briefs.filter(b => b.status === 'pending').length;
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleContentPipeline: suggested briefs optional, degrading gracefully');
  }

  // Copy pipeline (copy_sections, copy_intelligence, copy_batch_jobs)
  let copyPipeline: CopyPipelineSummary | undefined;
  try {
    copyPipeline = assembleCopyPipeline(workspaceId);
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleContentPipeline: copy pipeline optional, degrading gracefully');
  }

  let rewritePlaybook: ContentPipelineSlice['rewritePlaybook'];
  let contentPricing: ContentPipelineSlice['contentPricing'];
  try {
    const { getWorkspace } = await import('../workspaces.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const ws = getWorkspace(workspaceId);
    const rawPlaybook = ws?.rewritePlaybook?.trim();
    if (rawPlaybook) {
      const patterns = rawPlaybook.split('\n').map((l: string) => l.trim()).filter(Boolean);
      rewritePlaybook = { patterns, lastUsedAt: null };
    }
    if (ws?.contentPricing) {
      contentPricing = {
        briefPrice: ws.contentPricing.briefPrice,
        fullPostPrice: ws.contentPricing.fullPostPrice,
        currency: ws.contentPricing.currency,
        briefLabel: ws.contentPricing.briefLabel,
        fullPostLabel: ws.contentPricing.fullPostLabel,
      };
    }
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleContentPipeline: workspace enrichment optional, degrading gracefully');
  }

  return {
    briefs: summary.briefs,
    posts: summary.posts,
    matrices: summary.matrices,
    requests: summary.requests,
    workOrders: summary.workOrders,
    coverageGaps,
    seoEdits: summary.seoEdits,
    subscriptions,
    schemaDeployment,
    cannibalizationWarnings,
    decayAlerts,
    suggestedBriefs,
    copyPipeline,
    rewritePlaybook,
    contentPricing,
  };
}

function assembleCopyPipeline(workspaceId: string): CopyPipelineSummary | undefined {
  // Section status counts + first-version counts
  type StatusRow = { status: string; cnt: number; first_version_cnt: number };
  const statusRows = copyStmts().sectionCounts.all(workspaceId) as StatusRow[];

  // If no rows at all, copy pipeline isn't in use for this workspace
  if (statusRows.length === 0) return undefined;

  let totalSections = 0;
  let approvedSections = 0;
  let draftSections = 0;
  let clientReviewSections = 0;
  let pendingSections = 0;
  let revisionSections = 0;
  let approvedFirstVersion = 0;

  for (const row of statusRows) {
    totalSections += row.cnt;
    switch (row.status) {
      case 'approved':
        approvedSections = row.cnt;
        approvedFirstVersion = row.first_version_cnt;
        break;
      case 'draft':
        draftSections = row.cnt;
        break;
      case 'client_review':
        clientReviewSections = row.cnt;
        break;
      case 'pending':
        pendingSections = row.cnt;
        break;
      case 'revision_requested':
        revisionSections = row.cnt;
        break;
    }
  }

  const approvalRate = totalSections > 0
    ? Math.round((approvedSections / totalSections) * 100)
    : 0;
  const firstTryApprovalRate = approvedSections > 0
    ? Math.round((approvedFirstVersion / approvedSections) * 100)
    : 0;

  // Active intelligence patterns count
  let activePatternsCount = 0;
  try {
    const countRow = copyStmts().activePatternCount.get(workspaceId) as { cnt: number } | undefined;
    activePatternsCount = countRow?.cnt ?? 0;
  } catch (err) {
    // copy_intelligence table may not exist in all environments
    log.debug({ err, workspaceId }, 'copy_intelligence table unavailable');
  }

  // Last batch job
  type BatchRow = { status: string; progress_json: string; created_at: string };
  const batchRow = copyStmts().lastBatchJob.get(workspaceId) as BatchRow | undefined;
  let lastBatchJob: CopyPipelineSummary['lastBatchJob'] = null;
  if (batchRow) {
    const progress = parseJsonSafe(batchRow.progress_json, z.object({
      total: z.number(),
      generated: z.number(),
      reviewed: z.number(),
      approved: z.number(),
    }), { total: 0, generated: 0, reviewed: 0, approved: 0 }, { workspaceId, field: 'progress_json', table: 'copy_batch_jobs' });
    const completionRate = progress.total > 0
      ? Math.round((progress.generated / progress.total) * 100)
      : 0;
    lastBatchJob = {
      status: batchRow.status,
      completionRate,
      createdAt: batchRow.created_at,
    };
  }

  // Per-entry completion: entries with all sections approved vs entries still in progress
  type EntryRow = { entry_id: string; total: number; approved: number };
  const entryRows = copyStmts().entryCounts.all(workspaceId) as EntryRow[];
  let entriesWithCompleteCopy = 0;
  let entriesWithPendingCopy = 0;
  for (const row of entryRows) {
    if (row.total > 0 && row.approved === row.total) {
      entriesWithCompleteCopy++;
    } else if (row.total > 0) {
      entriesWithPendingCopy++;
    }
  }

  return {
    totalSections,
    approvedSections,
    draftSections,
    clientReviewSections,
    pendingSections,
    revisionSections,
    approvalRate,
    firstTryApprovalRate,
    activePatternsCount,
    lastBatchJob,
    entriesWithCompleteCopy,
    entriesWithPendingCopy,
  };
}

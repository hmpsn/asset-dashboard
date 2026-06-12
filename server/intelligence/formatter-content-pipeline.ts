import type { ContentPipelineSlice, PromptVerbosity } from '../../shared/types/intelligence.js';

export function formatContentPipelineSection(
  pipeline: ContentPipelineSlice,
  verbosity: PromptVerbosity,
): string {
  const lines: string[] = ['## Content Pipeline'];

  lines.push(`Briefs: ${pipeline.briefs.total}, Posts: ${pipeline.posts.total}, Matrices: ${pipeline.matrices.total}`);

  if (verbosity !== 'compact') {
    if (pipeline.coverageGaps.length > 0) {
      lines.push(`Coverage gaps: ${pipeline.coverageGaps.slice(0, 5).join(', ')}`);
    }
    if (pipeline.decayAlerts && pipeline.decayAlerts.length > 0) {
      lines.push(`Decay alerts: ${pipeline.decayAlerts.length} pages declining`);
    }
    if (pipeline.subscriptions) {
      lines.push(`Subscriptions: ${pipeline.subscriptions.active} active, ${pipeline.subscriptions.totalPages} pages`);
    }
    if (pipeline.requests && (pipeline.requests.pending > 0 || pipeline.requests.inProgress > 0)) {
      lines.push(`Content requests: ${pipeline.requests.pending} pending, ${pipeline.requests.inProgress} in progress`);
    }
    if (pipeline.workOrders?.active > 0) {
      lines.push(`Work orders: ${pipeline.workOrders.active} active`);
    }
    if (pipeline.seoEdits && (pipeline.seoEdits.pending > 0 || pipeline.seoEdits.applied > 0)) {
      lines.push(`SEO edits: ${pipeline.seoEdits.pending} pending, ${pipeline.seoEdits.applied} applied`);
    }
    if (pipeline.contentPricing && (pipeline.contentPricing.briefPrice > 0 || pipeline.contentPricing.fullPostPrice > 0)) {
      const cp = pipeline.contentPricing;
      lines.push(
        `Content pricing: ${cp.briefLabel ?? 'Brief'} ${cp.currency} ${cp.briefPrice}, ` +
        `${cp.fullPostLabel ?? 'Full post'} ${cp.currency} ${cp.fullPostPrice}`
      );
    }
  }

  if (verbosity !== 'compact' && pipeline.suggestedBriefs != null && pipeline.suggestedBriefs > 0) {
    lines.push(`Suggested briefs: ${pipeline.suggestedBriefs} pending topics identified`);
  }

  if (verbosity === 'detailed') {
    const bs = pipeline.briefs.byStatus;
    lines.push(`Brief status: ${Object.entries(bs).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
    const ps = pipeline.posts.byStatus;
    lines.push(`Post status: ${Object.entries(ps).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
    lines.push(`Matrix: ${pipeline.matrices.cellsPublished}/${pipeline.matrices.cellsPlanned} cells published`);
    if (pipeline.schemaDeployment) {
      lines.push(`Schema: ${pipeline.schemaDeployment.deployed}/${pipeline.schemaDeployment.planned} deployed`);
    }

    if (pipeline.rewritePlaybook?.patterns && pipeline.rewritePlaybook.patterns.length > 0) {
      lines.push(`Rewrite playbook: ${pipeline.rewritePlaybook.patterns.length} learned patterns`);
      for (const pattern of pipeline.rewritePlaybook.patterns.slice(0, 5)) {
        lines.push(`  - ${pattern}`);
      }
    }
    if (pipeline.cannibalizationWarnings && pipeline.cannibalizationWarnings.length > 0) {
      lines.push('Keyword cannibalization:');
      for (const cw of pipeline.cannibalizationWarnings.slice(0, 5)) {
        lines.push(`  - "${cw.keyword}" [${cw.severity}]: ${cw.pages.join(', ')}`);
      }
    }
    if (pipeline.decayAlerts && pipeline.decayAlerts.length > 0) {
      lines.push('Decay alert details:');
      for (const da of pipeline.decayAlerts.slice(0, 5)) {
        lines.push(`  - ${da.pageUrl}: -${da.clickDrop}% clicks${da.isRepeatDecay ? ' (repeat decay)' : ''}`);
      }
    }
  }

  if (pipeline.copyPipeline) {
    const cp = pipeline.copyPipeline;
    lines.push(`Copy: ${cp.totalSections} sections (${cp.approvedSections} approved, ${cp.draftSections} draft, ${cp.clientReviewSections} in review)`);
    lines.push(`Copy approval rate: ${cp.approvalRate}%, first-try: ${cp.firstTryApprovalRate}%`);
    if (cp.entriesWithCompleteCopy > 0 || cp.entriesWithPendingCopy > 0) {
      lines.push(`Pages: ${cp.entriesWithCompleteCopy} complete, ${cp.entriesWithPendingCopy} pending`);
    }
    if (verbosity !== 'compact') {
      if (cp.activePatternsCount > 0) {
        lines.push(`Learned copy patterns: ${cp.activePatternsCount} active`);
      }
      if (cp.lastBatchJob) {
        lines.push(`Last batch: ${cp.lastBatchJob.status}, ${cp.lastBatchJob.completionRate}% complete`);
      }
    }
  }

  return lines.join('\n');
}

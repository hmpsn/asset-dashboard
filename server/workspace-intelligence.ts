// server/workspace-intelligence.ts
// Core intelligence assembler — query-time assembly of all subsystem data.
// Spec: docs/superpowers/specs/unified-workspace-intelligence.md §3, §12, §13

import { createLogger } from './logger.js';
import { isFeatureEnabled } from './feature-flags.js';
import { LRUCache, singleFlight } from './intelligence-cache.js';
import { invalidateSubCachePrefix } from './bridge-infrastructure.js';
import type {
  WorkspaceIntelligence,
  IntelligenceOptions,
  IntelligenceSlice,
  SeoContextSlice,
  InsightsSlice,
  LearningsSlice,
  PromptFormatOptions,
  PromptVerbosity,
} from '../shared/types/intelligence.js';
import type { AnalyticsInsight, InsightType, InsightSeverity } from '../shared/types/analytics.js';

const log = createLogger('workspace-intelligence');

// ── Cache (§13, §33) ───────────────────────────────────────────────────

const intelligenceCache = new LRUCache<WorkspaceIntelligence>(200);
const INTELLIGENCE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── Assembly ────────────────────────────────────────────────────────────

const ALL_SLICES: IntelligenceSlice[] = [
  'seoContext', 'insights', 'learnings', 'pageProfile',
  'contentPipeline', 'siteHealth', 'clientSignals', 'operational',
];

export async function buildWorkspaceIntelligence(
  workspaceId: string,
  opts?: IntelligenceOptions,
): Promise<WorkspaceIntelligence> {
  const cacheKey = buildCacheKey(workspaceId, opts);

  // Check cache
  const cached = intelligenceCache.get(cacheKey);
  if (cached && !cached.stale) {
    log.debug({ workspaceId, cache_hit: true, stale: false }, 'Intelligence cache hit');
    return cached.data;
  }
  if (cached?.stale) {
    log.debug({ workspaceId, cache_hit: true, stale: true }, 'Intelligence cache hit (stale)');
  }

  // Single-flight dedup (§13)
  return singleFlight(cacheKey, async () => {
    const start = Date.now();
    const requestedSlices = opts?.slices ?? ALL_SLICES;

    const result: WorkspaceIntelligence = {
      version: 1,
      workspaceId,
      assembledAt: new Date().toISOString(),
    };

    // Assemble each requested slice independently (§12)
    for (const slice of requestedSlices) {
      try {
        await assembleSlice(result, workspaceId, slice, opts);
      } catch (err) {
        log.warn({ workspaceId, slice, err }, 'Intelligence slice assembly failed — skipping');
        // result[slice] remains undefined — consumers check for presence
      }
    }

    // Cache the result
    intelligenceCache.set(cacheKey, result, INTELLIGENCE_CACHE_TTL);

    // Observability (§18)
    log.info({
      workspaceId,
      assembly_ms: Date.now() - start,
      slices_requested: requestedSlices,
      slices_returned: Object.keys(result).filter(k => !['version', 'workspaceId', 'assembledAt'].includes(k)),
    }, 'Intelligence assembled');

    return result;
  });
}

// ── Slice assemblers ────────────────────────────────────────────────────

async function assembleSlice(
  result: WorkspaceIntelligence,
  workspaceId: string,
  slice: IntelligenceSlice,
  opts?: IntelligenceOptions,
): Promise<void> {
  switch (slice) {
    case 'seoContext':
      result.seoContext = await assembleSeoContext(workspaceId, opts);
      break;
    case 'insights':
      result.insights = await assembleInsights(workspaceId, opts);
      break;
    case 'learnings':
      result.learnings = await assembleLearnings(workspaceId, opts);
      break;
    // Phase 1: remaining slices are stubbed — they return undefined
    case 'pageProfile':
    case 'contentPipeline':
    case 'siteHealth':
    case 'clientSignals':
    case 'operational':
      log.debug({ workspaceId, slice }, 'Slice not yet implemented — skipping');
      break;
  }
}

async function assembleSeoContext(
  workspaceId: string,
  opts?: IntelligenceOptions,
): Promise<SeoContextSlice> {
  const { buildSeoContext } = await import('./seo-context.js');
  // Pass _skipShadow to prevent circular recursion:
  // buildWorkspaceIntelligence → assembleSeoContext → buildSeoContext → shadow mode → buildWorkspaceIntelligence → ∞
  const ctx = buildSeoContext(workspaceId, opts?.pagePath, opts?.learningsDomain ?? 'all', { _skipShadow: true });

  return {
    strategy: ctx.strategy,
    brandVoice: ctx.brandVoiceBlock,
    businessContext: ctx.businessContext,
    personas: [], // TODO: parse from personasBlock or load directly in Phase 2
    knowledgeBase: ctx.knowledgeBlock,
  };
}

async function assembleInsights(
  workspaceId: string,
  opts?: IntelligenceOptions,
): Promise<InsightsSlice> {
  const { getInsights } = await import('./analytics-insights-store.js');
  const all: AnalyticsInsight[] = getInsights(workspaceId);

  // Cap at 100, sorted by impact score descending (§13)
  const sorted = [...all].sort((a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0));
  const capped = sorted.slice(0, 100);

  // Group by type
  const byType: Partial<Record<InsightType, AnalyticsInsight[]>> = {};
  for (const insight of capped) {
    const list = byType[insight.insightType] ?? [];
    list.push(insight);
    byType[insight.insightType] = list;
  }

  // Count by severity
  const bySeverity: Record<InsightSeverity, number> = {
    critical: 0, warning: 0, opportunity: 0, positive: 0,
  };
  for (const insight of capped) {
    bySeverity[insight.severity] = (bySeverity[insight.severity] ?? 0) + 1;
  }

  // Top 10 by impact
  const topByImpact = capped.slice(0, 10);

  // Page-specific filtering
  let forPage: AnalyticsInsight[] | undefined;
  if (opts?.pagePath) {
    forPage = capped.filter(i => i.pageId === opts.pagePath);
  }

  return { all: capped, byType, bySeverity, topByImpact, forPage };
}

async function assembleLearnings(
  workspaceId: string,
  opts?: IntelligenceOptions,
): Promise<LearningsSlice> {
  // Only assemble if feature flag is enabled
  if (!isFeatureEnabled('outcome-ai-injection')) {
    return {
      summary: null,
      confidence: null,
      topActionTypes: [],
      overallWinRate: 0,
      recentTrend: null,
      playbooks: [],
    };
  }

  const { getWorkspaceLearnings } = await import('./workspace-learnings.js');
  const { getPlaybooks } = await import('./outcome-playbooks.js');
  const summary = getWorkspaceLearnings(workspaceId, opts?.learningsDomain ?? 'all');
  const playbooks = getPlaybooks(workspaceId);

  return {
    summary,
    confidence: summary?.confidence ?? null,
    topActionTypes: summary?.overall.topActionTypes.slice(0, 5) ?? [],
    overallWinRate: summary?.overall.totalWinRate ?? 0,
    recentTrend: summary?.overall.recentTrend ?? null,
    playbooks,
  };
}

// ── Prompt formatter (§3 section 2c) ────────────────────────────────────

export function formatForPrompt(
  intelligence: WorkspaceIntelligence,
  opts?: PromptFormatOptions,
): string {
  const verbosity = opts?.verbosity ?? 'standard';
  const sections: string[] = [];

  sections.push('[Workspace Intelligence]');

  // Cold-start detection (§29)
  const hasData = intelligence.seoContext || intelligence.insights?.all.length || intelligence.learnings?.summary;
  if (!hasData) {
    sections.push('This workspace is newly onboarded. Limited data available.');
    if (intelligence.seoContext?.brandVoice) {
      sections.push(`Brand voice: ${intelligence.seoContext.brandVoice}`);
    }
    sections.push('Recommendation: Focus on establishing baseline data before making optimization decisions.');
    return sections.join('\n');
  }

  // SEO Context
  if (intelligence.seoContext) {
    sections.push(formatSeoContextSection(intelligence.seoContext, verbosity));
  }

  // Insights
  if (intelligence.insights && intelligence.insights.all.length > 0) {
    sections.push(formatInsightsSection(intelligence.insights, verbosity));
  }

  // Learnings
  if (intelligence.learnings) {
    sections.push(formatLearningsSection(intelligence.learnings, verbosity));
  }

  return sections.filter(Boolean).join('\n\n');
}

function formatSeoContextSection(ctx: SeoContextSlice, verbosity: PromptVerbosity): string {
  const lines: string[] = ['## SEO Context'];

  if (ctx.brandVoice) lines.push(`Brand voice: ${ctx.brandVoice}`);
  if (ctx.businessContext) lines.push(`Business: ${ctx.businessContext}`);

  if (verbosity === 'detailed') {
    if (ctx.knowledgeBase) lines.push(`Knowledge: ${ctx.knowledgeBase}`);
    if (ctx.strategy) lines.push(`Strategy: ${ctx.strategy.siteKeywords?.length ?? 0} site keywords`);
  }

  return lines.join('\n');
}

function formatInsightsSection(insights: InsightsSlice, verbosity: PromptVerbosity): string {
  const lines: string[] = ['## Active Insights'];
  const { bySeverity } = insights;

  lines.push(`Summary: ${bySeverity.critical} critical, ${bySeverity.warning} warning, ${bySeverity.opportunity} opportunity, ${bySeverity.positive} positive`);

  const limit = verbosity === 'compact' ? 3 : verbosity === 'standard' ? 5 : 10;
  const top = insights.topByImpact.length > 0 ? insights.topByImpact : insights.all;
  for (const insight of top.slice(0, limit)) {
    lines.push(`- [${insight.severity}] ${insight.insightType}: impact ${insight.impactScore ?? 'n/a'}${insight.pageId ? ` (${insight.pageId})` : ''}`);
  }

  return lines.join('\n');
}

function formatLearningsSection(learnings: LearningsSlice, verbosity: PromptVerbosity): string {
  if (!learnings.summary && learnings.topActionTypes.length === 0) return '';

  const lines: string[] = ['## Outcome Learnings'];

  if (learnings.recentTrend) lines.push(`Trend: ${learnings.recentTrend}`);
  if (learnings.confidence) lines.push(`Confidence: ${learnings.confidence}`);
  if (learnings.overallWinRate > 0) lines.push(`Overall win rate: ${Math.round(learnings.overallWinRate * 100)}%`);

  if (verbosity === 'detailed' || verbosity === 'standard') {
    if (learnings.topActionTypes.length > 0) {
      lines.push('Win rates by action type:');
      for (const { type, winRate, count } of learnings.topActionTypes) {
        lines.push(`  ${type}: ${Math.round(winRate * 100)}% (${count} actions)`);
      }
    }
  }

  return lines.join('\n');
}

// ── Cache management ────────────────────────────────────────────────────

function buildCacheKey(workspaceId: string, opts?: IntelligenceOptions): string {
  const slices = [...(opts?.slices ?? ALL_SLICES)].sort().join(',');
  const page = opts?.pagePath ?? '';
  const domain = opts?.learningsDomain ?? 'all';
  return `intelligence:${workspaceId}:${slices}:${page}:${domain}`;
}

/** Invalidate all cached intelligence for a workspace */
export function invalidateIntelligenceCache(workspaceId: string): void {
  // Invalidate in-memory LRU
  const deleted = intelligenceCache.deleteByPrefix(`intelligence:${workspaceId}:`);
  // Invalidate persistent sub-cache
  try {
    invalidateSubCachePrefix(workspaceId, '');
  } catch {
    // Table may not exist yet — non-critical
  }
  log.info({ workspaceId, entriesDeleted: deleted }, 'Intelligence cache invalidated (in-memory + persistent)');
}

/** Cache stats for health endpoint (§18) */
export function getIntelligenceCacheStats() {
  return intelligenceCache.stats();
}

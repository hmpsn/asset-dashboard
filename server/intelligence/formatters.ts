import type {
  WorkspaceIntelligence,
  PromptFormatOptions,
  PromptVerbosity,
  SeoContextSlice,
  InsightsSlice,
  LearningsSlice,
  ContentPipelineSlice,
  SiteHealthSlice,
  ClientSignalsSlice,
  OperationalSlice,
  PageProfileSlice,
} from '../../shared/types/intelligence.js';
import type { AudiencePersona } from '../../shared/types/workspace.js';
import { matchPagePath } from '../helpers.js';
import { formatPageElementsSection } from './page-elements-slice.js';

export function formatForPrompt(
  intelligence: WorkspaceIntelligence,
  opts?: PromptFormatOptions,
): string {
  const verbosity = opts?.verbosity ?? 'standard';
  const include = opts?.sections ? new Set(opts.sections) : null;
  const sections: string[] = [];

  sections.push('[Workspace Intelligence]');

  // Cold-start detection (§29)
  // Check for meaningful content, not just object existence — seoContext is always
  // assembled as an object, so truthy-check on it would always pass.
  const hasSeoContent = (!include || include.has('seoContext')) && intelligence.seoContext && (
    intelligence.seoContext.strategy ||
    intelligence.seoContext.brandVoice ||
    intelligence.seoContext.businessContext ||
    intelligence.seoContext.knowledgeBase ||
    (intelligence.seoContext.personas && intelligence.seoContext.personas.length > 0)
  );
  // For unfiltered calls: check meaningful content within each slice because
  // assemblers always return non-null objects (even when cold). `learnings.summary`
  // is null when the feature flag is off; `insights.all` is empty before any data.
  // For section-filtered calls: treat presence of the assembled object as sufficient —
  // the caller explicitly requested that section so render it rather than cold-starting.
  const hasData =
    hasSeoContent ||
    ((!include || include.has('insights')) && !!intelligence.insights?.all.length) ||
    (!include && !!intelligence.learnings?.summary) ||
    ((!include || include.has('pageProfile')) && !!intelligence.pageProfile) ||
    // Section-filtered: if the caller requested a slice and it exists, skip cold-start.
    // These slices are excluded from the unfiltered path because their assemblers always
    // return non-null objects even on cold workspaces, which would make cold-start unreachable.
    (include !== null && (
      (include.has('learnings') && intelligence.learnings != null) ||
      (include.has('clientSignals') && intelligence.clientSignals != null) ||
      (include.has('operational') && intelligence.operational != null) ||
      (include.has('contentPipeline') && intelligence.contentPipeline != null) ||
      (include.has('siteHealth') && intelligence.siteHealth != null) ||
      // pageElements is page-scoped and only assembled when pagePath is supplied;
      // a section-filtered request for it implies the caller already knows the
      // slice should exist, so a populated slice should bypass cold-start.
      (include.has('pageElements') && intelligence.pageElements != null)
    ));
  if (!hasData) {
    // Cold-start messaging is a workspace-level signal, not a page/section signal.
    // Only show it for unfiltered calls or when seoContext is explicitly requested —
    // seoContext is always assembled and is the authoritative indicator of workspace
    // maturity. Targeted callers like `sections: ['pageProfile']` (rewrite-chat,
    // seo-audit) should get empty string when their specific section has no data,
    // not a misleading "newly onboarded" message about the workspace.
    if (include !== null && !include.has('seoContext')) return '';
    sections.push('This workspace is newly onboarded. Limited data available.');
    // Voice authority: effectiveBrandVoiceBlock already honors voice profile → legacy fallback.
    // Pre-formatted with its own header; inject directly rather than wrapping the raw field.
    const bvBlock = intelligence.seoContext?.effectiveBrandVoiceBlock ?? '';
    if (bvBlock) {
      sections.push(bvBlock);
    }
    sections.push('Recommendation: Focus on establishing baseline data before making optimization decisions.');
    return sections.join('\n');
  }

  // SEO Context
  if (intelligence.seoContext && (!include || include.has('seoContext'))) {
    sections.push(formatSeoContextSection(intelligence.seoContext, verbosity));
  }

  // Insights
  if (intelligence.insights && intelligence.insights.all.length > 0 && (!include || include.has('insights'))) {
    sections.push(formatInsightsSection(intelligence.insights, verbosity));
  }

  // Learnings
  if (intelligence.learnings && (!include || include.has('learnings'))) {
    sections.push(formatLearningsSection(intelligence.learnings, verbosity, opts?.learningsDomain ?? 'all'));
  }

  // Page Profile
  if (intelligence.pageProfile && (!include || include.has('pageProfile'))) {
    sections.push(formatPageProfileSection(intelligence.pageProfile, verbosity));
  }

  // Page Elements
  if (intelligence.pageElements && (!include || include.has('pageElements'))) {
    sections.push(formatPageElementsSection(intelligence.pageElements));
  }

  // Content Pipeline
  if (intelligence.contentPipeline && (!include || include.has('contentPipeline'))) {
    sections.push(formatContentPipelineSection(intelligence.contentPipeline, verbosity));
  }

  // Site Health
  if (intelligence.siteHealth && (!include || include.has('siteHealth'))) {
    sections.push(formatSiteHealthSection(intelligence.siteHealth, verbosity));
  }

  // Client Signals
  if (intelligence.clientSignals && (!include || include.has('clientSignals'))) {
    sections.push(formatClientSignalsSection(intelligence.clientSignals, verbosity));
  }

  // Operational
  if (intelligence.operational && (!include || include.has('operational'))) {
    sections.push(formatOperationalSection(intelligence.operational, verbosity));
  }

  // Apply tokenBudget truncation if requested (§20 priority chain)
  const tokenBudget = opts?.tokenBudget;
  if (tokenBudget && tokenBudget > 0) {
    return applyTokenBudget(sections, intelligence, tokenBudget);
  }

  return sections.filter(Boolean).join('\n\n');
}

function applyTokenBudget(
  sections: string[],
  intelligence: WorkspaceIntelligence,
  budget: number,
): string {
  const estimateTokens = (text: string) => Math.ceil(text.length / 4);

  let current = sections.filter(Boolean);
  let output = current.join('\n\n');
  if (estimateTokens(output) <= budget) return output;

  // Step 1: Drop operational
  current = current.filter(s => !s.startsWith('## Operational'));
  output = current.join('\n\n');
  if (estimateTokens(output) <= budget) return output;

  // Step 2: Truncate insights to top 5
  current = current.map(s => {
    if (s.startsWith('## Active Insights')) {
      const lines = s.split('\n');
      const header = lines.filter(l => !l.startsWith('- ['));
      const items = lines.filter(l => l.startsWith('- ['));
      return [...header, ...items.slice(0, 5)].join('\n');
    }
    return s;
  });
  output = current.join('\n\n');
  if (estimateTokens(output) <= budget) return output;

  // Step 3: Drop clientSignals
  current = current.filter(s => !s.startsWith('## Client Signals'));
  output = current.join('\n\n');
  if (estimateTokens(output) <= budget) return output;

  // Step 4: Summarize learnings to one line
  current = current.map(s => {
    if (s.startsWith('## Outcome Learnings') && intelligence.learnings) {
      const rate = intelligence.learnings.overallWinRate;
      return `## Outcome Learnings\nWin rate: ${pct(rate)}${intelligence.learnings.recentTrend ? ` (${intelligence.learnings.recentTrend})` : ''}`;
    }
    return s;
  });
  output = current.join('\n\n');
  if (estimateTokens(output) <= budget) return output;

  // Step 4b: Drop pageProfile (dynamic header — startsWith covers all pagePath variants)
  current = current.filter(s => !s.startsWith('## Page Profile'));
  output = current.join('\n\n');
  if (estimateTokens(output) <= budget) return output;

  // Step 4c: Drop siteHealth
  current = current.filter(s => !s.startsWith('## Site Health'));
  output = current.join('\n\n');
  if (estimateTokens(output) <= budget) return output;

  // Step 4d: Drop contentPipeline
  current = current.filter(s => !s.startsWith('## Content Pipeline'));
  output = current.join('\n\n');
  if (estimateTokens(output) <= budget) return output;

  // Step 5: Drop everything except seoContext (never dropped)
  const seoOnly = current.filter(s =>
    s.startsWith('[Workspace Intelligence]') || s.startsWith('## SEO Context'),
  );
  return seoOnly.join('\n\n');
}

function pct(rate: number | null | undefined): string {
  if (rate == null || isNaN(rate)) return 'n/a';
  return `${Math.round(rate * 100)}%`;
}

function formatSeoContextSection(ctx: SeoContextSlice, verbosity: PromptVerbosity): string {
  const lines: string[] = ['## SEO Context'];

  if (ctx.businessContext) lines.push(`Business: ${ctx.businessContext}`);
  // Voice authority: `effectiveBrandVoiceBlock` is the single source of truth — it was
  // already computed by `buildSeoContext` with full voice authority (calibrated profile
  // → voice samples block; else legacy brandVoice + brand-docs block; else empty). An
  // empty string means "render nothing here" and is INTENTIONAL when the workspace is
  // calibrated with no samples — `buildSystemPrompt` Layer 2 handles DNA + guardrails
  // via the system message. Injecting raw `ctx.brandVoice` as a fallback would bypass
  // the authority rule and produce two contradictory voice sources (see the bug from
  // PR #167 where the `else if` fallback re-injected legacy voice on calibrated empty
  // profiles). `.trim()` strips the leading `\n\n` from buildSeoContext's output.
  const voiceBlock = (ctx.effectiveBrandVoiceBlock ?? '').trim();
  if (voiceBlock) {
    lines.push(voiceBlock);
  }

  // Personas — always include when present
  // Must match formatPersonasForPrompt (standalone helper) for content parity
  if (ctx.personas && ctx.personas.length > 0) {
    if (verbosity === 'compact') {
      // Compact: names + buying stage only
      lines.push(`Personas: ${ctx.personas.map(p => `${p.name}${p.buyingStage ? ` (${p.buyingStage})` : ''}`).join(', ')}`);
    } else {
      // Standard + detailed: full persona detail (pain points, goals, objections)
      // AI models need this context to write audience-relevant content
      lines.push('TARGET AUDIENCE PERSONAS:');
      for (const p of ctx.personas) {
        const parts = [`  **${p.name}**${p.buyingStage ? ` (${p.buyingStage} stage)` : ''}: ${p.description}`];
        if (p.painPoints?.length) parts.push(`    Pain points: ${p.painPoints.join('; ')}`);
        if (p.goals?.length) parts.push(`    Goals: ${p.goals.join('; ')}`);
        if (p.objections?.length) parts.push(`    Objections: ${p.objections.join('; ')}`);
        if (p.preferredContentFormat) parts.push(`    Prefers: ${p.preferredContentFormat}`);
        lines.push(parts.join('\n'));
      }
    }
  }

  // Knowledge base — emphatic header at all verbosity levels
  if (ctx.knowledgeBase) {
    if (verbosity === 'compact') {
      const summary = ctx.knowledgeBase.length > 80 ? ctx.knowledgeBase.slice(0, 80) + '...' : ctx.knowledgeBase;
      lines.push(`BUSINESS KNOWLEDGE BASE:\n${summary}`);
    } else {
      lines.push(`BUSINESS KNOWLEDGE BASE (use this to give informed, business-aware answers):\n${ctx.knowledgeBase}`);
    }
  }

  // Business profile — at standard+ verbosity
  if (ctx.businessProfile && verbosity !== 'compact') {
    const bp = ctx.businessProfile;
    lines.push(`Industry: ${bp.industry}${bp.targetAudience ? ` | Audience: ${bp.targetAudience}` : ''}`);
    if (bp.goals.length > 0 && verbosity === 'detailed') {
      lines.push(`Goals: ${bp.goals.join(', ')}`);
    }
    if (verbosity === 'detailed') {
      if (bp.phone) lines.push(`Phone: ${bp.phone}`);
      if (bp.email) lines.push(`Email: ${bp.email}`);
      if (bp.address) lines.push(`Address: ${bp.address}`);
      if (bp.openingHours) lines.push(`Hours: ${bp.openingHours}`);
      if (bp.socialProfiles?.length) lines.push(`Social: ${bp.socialProfiles.join(', ')}`);
    }
  }

  // Rank tracking — at standard+ verbosity
  if (ctx.rankTracking && verbosity !== 'compact') {
    const rt = ctx.rankTracking;
    lines.push(`Rank tracking: ${rt.trackedKeywords} keywords, avg position ${rt.avgPosition?.toFixed(1) ?? 'n/a'} (↑${rt.positionChanges.improved} ↓${rt.positionChanges.declined})`);
  }

  // Backlink profile — at standard+ verbosity (only present when enrichWithBacklinks opt-in was set)
  if (ctx.backlinkProfile && verbosity !== 'compact') {
    const bp = ctx.backlinkProfile;
    lines.push(`Backlinks: ${bp.totalBacklinks.toLocaleString()} total, ${bp.referringDomains.toLocaleString()} referring domains`);
  }

  // SERP features — aggregated from per-page data; at standard+ verbosity
  if (ctx.serpFeatures && verbosity !== 'compact') {
    const sf = ctx.serpFeatures;
    const parts: string[] = [];
    if (sf.featuredSnippets > 0) parts.push(`${sf.featuredSnippets} featured snippet opportunit${sf.featuredSnippets === 1 ? 'y' : 'ies'}`);
    if (sf.peopleAlsoAsk > 0) parts.push(`${sf.peopleAlsoAsk} People Also Ask opportunit${sf.peopleAlsoAsk === 1 ? 'y' : 'ies'}`);
    if (sf.videoCarousel > 0) parts.push(`${sf.videoCarousel} video carousel opportunit${sf.videoCarousel === 1 ? 'y' : 'ies'}`);
    if (sf.localPack) parts.push('local pack present');
    if (parts.length > 0) lines.push(`SERP features: ${parts.join(', ')}`);
  }

  // Site keywords — always include when present; compact shows fewer
  if (ctx.strategy?.siteKeywords?.length) {
    const kw = verbosity === 'compact'
      ? ctx.strategy.siteKeywords.slice(0, 3).join(', ')
      : ctx.strategy.siteKeywords.slice(0, 8).join(', ');
    lines.push(`Site target keywords: ${kw}`);
  }

  // Page-specific keyword targeting — when pagePath was provided, show the page's own keywords
  if (ctx.pageKeywords) {
    const pk = ctx.pageKeywords;
    lines.push(`THIS PAGE'S TARGET: "${pk.primaryKeyword}"`);
    if (pk.secondaryKeywords?.length) {
      lines.push(`  Secondary: ${pk.secondaryKeywords.join(', ')}`);
    }
    if (pk.searchIntent) {
      lines.push(`  Intent: ${pk.searchIntent}`);
    }
  }

  if (ctx.strategyHistory && verbosity === 'detailed') {
    lines.push(`Strategy: revised ${ctx.strategyHistory.revisionsCount}x, last ${ctx.strategyHistory.lastRevisedAt.slice(0, 10)}`);
  }

  // Return empty string rather than a bare header when no content was added
  if (lines.length === 1) return '';

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

function formatLearningsSection(learnings: LearningsSlice, verbosity: PromptVerbosity, domain: 'content' | 'strategy' | 'technical' | 'all' = 'all'): string {
  // Guard must be verbosity-aware: only pass if there's content that will actually render
  // at the requested verbosity. roiAttribution and weCalledIt are standard/detailed-only.
  const hasBaseContent = !!learnings.recentTrend || !!learnings.confidence || learnings.overallWinRate > 0;
  const hasStandardContent = learnings.topActionTypes.length > 0 || (learnings.weCalledIt?.length ?? 0) > 0 || (learnings.topWins?.length ?? 0) > 0;
  const hasDetailedContent = (learnings.roiAttribution?.length ?? 0) > 0 || !!learnings.summary?.content || !!learnings.summary?.strategy || !!learnings.summary?.technical;
  const willRender =
    hasBaseContent ||
    ((verbosity === 'standard' || verbosity === 'detailed') && hasStandardContent) ||
    (verbosity === 'detailed' && hasDetailedContent);
  if (!willRender) return '';

  const lines: string[] = [];
  const summary = learnings.summary;

  // Header with scored actions count (matches old formatLearningsForPrompt)
  const totalActions = summary?.totalScoredActions ?? 0;
  lines.push(`## Outcome Learnings${totalActions > 0 ? ` (${totalActions} tracked outcomes, ${learnings.confidence ?? 'unknown'} confidence)` : ''}`);

  if (learnings.recentTrend && learnings.recentTrend !== 'stable') lines.push(`Trend: ${learnings.recentTrend}`);

  // Overall win rate with strong wins (matches old: "62% (28% strong wins)")
  if (learnings.overallWinRate > 0) {
    const strongRate = summary?.overall?.strongWinRate;
    const strongSuffix = strongRate != null ? ` (${pct(strongRate)} strong wins)` : '';
    lines.push(`Overall win rate: ${pct(learnings.overallWinRate)}${strongSuffix}`);
  }

  if (verbosity === 'detailed' || verbosity === 'standard') {
    if (learnings.topActionTypes.length > 0) {
      lines.push('Win rates by action type:');
      for (const { type, winRate, count } of learnings.topActionTypes) {
        lines.push(`  ${type}: ${pct(winRate)} (${count} actions)`);
      }
    }

    // Domain-specific learnings from summary
    // Domain filtering: only render domains matching the requested learningsDomain
    if (summary && verbosity === 'detailed') {
      // Content learnings
      if ((domain === 'content' || domain === 'all') && summary.content) {
        const c = summary.content;
        const topFormats = Object.entries(c.winRateByFormat)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2);
        if (topFormats.length >= 2) {
          const [f1, r1] = topFormats[0];
          const [f2, r2] = topFormats[1];
          lines.push(`${f1.replace(/_/g, ' ')} outperforms ${f2.replace(/_/g, ' ')} (${pct(r1)} vs ${pct(r2)} win rate)`);
        }
        if (c.avgDaysToPage1 != null) lines.push(`Content reaches page 1 in ~${c.avgDaysToPage1} days on average`);
        if (c.refreshRecoveryRate > 0) lines.push(`Content refreshes recover traffic ${pct(c.refreshRecoveryRate)} of the time`);
        if (c.bestPerformingTopics.length > 0) lines.push(`Best performing topics: ${c.bestPerformingTopics.slice(0, 3).join(', ')}`);
      }

      // Strategy learnings
      if ((domain === 'strategy' || domain === 'all') && summary.strategy) {
        const s = summary.strategy;
        const topDifficulty = Object.entries(s.winRateByDifficultyRange).sort((a, b) => b[1] - a[1]).slice(0, 1);
        if (topDifficulty.length > 0) {
          const [range, rate] = topDifficulty[0];
          lines.push(`Keywords with difficulty ${range} have highest win rate (${pct(rate)})`);
        }
        if (s.keywordVolumeSweetSpot) lines.push(`Optimal keyword volume range: ${s.keywordVolumeSweetSpot.min}–${s.keywordVolumeSweetSpot.max}/month`);
        if (s.bestIntentTypes.length > 0) lines.push(`Best intent types: ${s.bestIntentTypes.join(', ')}`);
      }

      // Technical learnings
      if ((domain === 'technical' || domain === 'all') && summary.technical) {
        const t = summary.technical;
        const topFix = Object.entries(t.winRateByFixType).sort((a, b) => b[1] - a[1]).slice(0, 1);
        if (topFix.length > 0) {
          const [fixType, rate] = topFix[0];
          lines.push(`${fixType.replace(/_/g, ' ')} has highest technical win rate (${pct(rate)})`);
        }
        if (t.schemaTypesWithRichResults.length > 0) lines.push(`Schema types producing rich results: ${t.schemaTypesWithRichResults.join(', ')}`);
        if (t.avgHealthScoreImprovement > 0) lines.push(`Average health score improvement: +${t.avgHealthScoreImprovement}`);
        if (t.internalLinkEffectiveness > 0) lines.push(`Internal link additions improve rankings ${pct(t.internalLinkEffectiveness)} of the time`);
      }
    }

    // WeCalledIt proven predictions
    if (learnings.weCalledIt && learnings.weCalledIt.length > 0) {
      lines.push('Proven predictions:');
      for (const entry of learnings.weCalledIt.slice(0, verbosity === 'detailed' ? 5 : 3)) {
        lines.push(`  - ${entry.prediction} → ${entry.score}${entry.pageUrl ? ` (${entry.pageUrl})` : ''}`);
      }
    }

    // Top recent wins — standard and detailed
    if (learnings.topWins && learnings.topWins.length > 0) {
      const winLimit = verbosity === 'detailed' ? 5 : 3;
      lines.push('Recent wins:');
      for (const win of learnings.topWins.slice(0, winLimit)) {
        const page = win.pageUrl ?? 'site';
        const delta = win.delta;
        const sign = delta.direction === 'improved' ? '+' : delta.direction === 'declined' ? '-' : '';
        lines.push(`  - ${win.actionType.replace(/_/g, ' ')} on ${page} → ${sign}${Math.abs(delta.delta_percent).toFixed(0)}% ${delta.primary_metric}`);
      }
    }

    // ROI attribution — detailed only
    if (learnings.roiAttribution && learnings.roiAttribution.length > 0 && verbosity === 'detailed') {
      lines.push('ROI highlights:');
      for (const roi of learnings.roiAttribution.slice(0, 5)) {
        lines.push(`  - ${roi.actionType} on ${roi.pageUrl}: +${roi.clickGain ?? 0} clicks`);
      }
    }

    if (learnings.playbooks?.length > 0 && verbosity === 'detailed') {
      lines.push(`Playbooks: ${learnings.playbooks.slice(0, 3).map(p => p.name).join(', ')}`);
    }
    if (learnings.scoringConfig && verbosity === 'detailed') {
      const configEntries = Object.entries(learnings.scoringConfig);
      if (configEntries.length > 0) {
        lines.push('Scoring thresholds:');
        for (const [type, cfg] of configEntries.slice(0, 5)) {
          if (cfg?.thresholds) {
            lines.push(`  ${type}: win ≥ ${cfg.thresholds.win}%, strong win ≥ ${cfg.thresholds.strong_win}%`);
          }
        }
      }
    }
  }

  // Cap at 25 content lines to stay within token budget
  if (lines.length > 25) {
    return [...lines.slice(0, 25), '  (additional learnings truncated)'].join('\n');
  }

  return lines.join('\n');
}

function formatContentPipelineSection(pipeline: ContentPipelineSlice, verbosity: PromptVerbosity): string {
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

  // Suggested briefs count — standard and detailed
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

    // Rewrite playbook patterns — detailed only
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

  // Copy pipeline sub-section
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

function formatSiteHealthSection(health: SiteHealthSlice, verbosity: PromptVerbosity): string {
  const lines: string[] = ['## Site Health'];

  lines.push(`Audit score: ${health.auditScore ?? 'n/a'}${health.auditScoreDelta != null ? ` (${health.auditScoreDelta >= 0 ? '+' : ''}${health.auditScoreDelta})` : ''}`);
  if (health.anomalyCount != null && health.anomalyCount > 0) {
    lines.push(`Critical issues: ${health.anomalyCount} anomalies`);
  }

  if (verbosity !== 'compact') {
    if (health.performanceSummary?.score != null) {
      lines.push(`Performance: ${health.performanceSummary.score}/100`);
    }
    lines.push(`Links: ${health.deadLinks} dead, ${health.redirectChains} redirect chains, ${health.orphanPages} orphan pages`);
    if (health.anomalyTypes && health.anomalyTypes.length > 0) {
      lines.push(`Anomaly types: ${health.anomalyTypes.join(', ')}`);
    }
    if (health.aeoReadiness) {
      lines.push(
        `AEO readiness: ${health.aeoReadiness.pagesChecked} pages checked, ${pct(health.aeoReadiness.passingRate)} passing`
      );
    }
  }

  if (verbosity === 'detailed') {
    if (health.recentDiagnostics && health.recentDiagnostics.length > 0) {
      const diagLines = health.recentDiagnostics.map(d => {
        const pages = d.affectedPages.length > 0 ? ` on ${d.affectedPages.join(', ')}` : '';
        const causes = d.rootCauseTitles && d.rootCauseTitles.length > 0
          ? ` → ${d.rootCauseTitles.join('; ')}`
          : '';
        return `  ${d.anomalyType} [${d.status}]${pages}${causes}`;
      });
      lines.push(`Recent diagnostics:\n${diagLines.join('\n')}`);
    }
    if (health.schemaErrors > 0) lines.push(`Schema errors: ${health.schemaErrors}`);
    if (health.seoChangeVelocity != null) lines.push(`SEO change velocity: ${health.seoChangeVelocity} changes (30d)`);
    if (health.cwvPassRate.mobile != null) lines.push(`CWV pass rate: mobile ${pct(health.cwvPassRate.mobile)}, desktop ${health.cwvPassRate.desktop != null ? pct(health.cwvPassRate.desktop) : 'n/a'}`);
    if (health.schemaValidation) {
      lines.push(`Schema validation: ${health.schemaValidation.valid} valid, ${health.schemaValidation.warnings} warnings, ${health.schemaValidation.errors} errors`);
    }
    if (health.performanceSummary) {
      const perfParts: string[] = [];
      if (health.performanceSummary.avgLcp != null) perfParts.push(`LCP: ${health.performanceSummary.avgLcp.toFixed(1)}s`);
      if (health.performanceSummary.avgFid != null) perfParts.push(`FID: ${health.performanceSummary.avgFid}ms`);
      if (health.performanceSummary.avgCls != null) perfParts.push(`CLS: ${health.performanceSummary.avgCls.toFixed(2)}`);
      if (perfParts.length > 0) lines.push(`Core Web Vitals: ${perfParts.join(', ')}`);
    }
    if (health.redirectDetails && health.redirectDetails.length > 0) {
      lines.push('Redirect chain details:');
      for (const rd of health.redirectDetails.slice(0, 5)) {
        lines.push(`  - ${rd.url} → ${rd.target} (${rd.chainDepth} hops, status ${rd.status})`);
      }
    }
  }

  return lines.join('\n');
}

function formatClientSignalsSection(signals: ClientSignalsSlice, verbosity: PromptVerbosity): string {
  const lines: string[] = ['## Client Signals'];

  lines.push(`Churn risk: ${signals.churnRisk ?? 'unknown'}`);
  if (signals.roi) {
    lines.push(`ROI: $${signals.roi.organicValue} organic value, ${signals.roi.growth > 0 ? '+' : ''}${signals.roi.growth}% growth (${signals.roi.period})`);
  }
  if (signals.compositeHealthScore != null) {
    lines.push(`Health score: ${signals.compositeHealthScore}/100`);
  }
  if (signals.latestBriefing) {
    const b = signals.latestBriefing;
    lines.push(
      `Latest briefing: ${b.storyCount} stor${b.storyCount === 1 ? 'y' : 'ies'} (week of ${b.weekOf})${b.hasHero ? ' with hero' : ''}`,
    );
  }

  if (verbosity !== 'compact') {
    if (signals.engagement) {
      lines.push(`Engagement: ${signals.engagement.loginFrequency} login frequency, ${signals.engagement.chatSessionCount} chat sessions`);
    }
    if (signals.approvalPatterns.approvalRate > 0) {
      lines.push(`Approval rate: ${pct(signals.approvalPatterns.approvalRate)}`);
    }
    if (signals.businessPriorities.length > 0) {
      lines.push(`Business priorities: ${signals.businessPriorities.join('; ')}`);
    }
    if (signals.serviceRequests) {
      lines.push(`Service requests: ${signals.serviceRequests.pending} pending, ${signals.serviceRequests.total} total`);
    }
    if (signals.intentSignals && signals.intentSignals.newCount > 0) {
      lines.push(
        `Intent signals: ${signals.intentSignals.newCount} new of ${signals.intentSignals.totalCount} total` +
        (signals.intentSignals.recentTypes.length > 0
          ? ` (${signals.intentSignals.recentTypes.join(', ')})`
          : '')
      );
    }
  }

  if (verbosity === 'detailed') {
    if (signals.churnSignals && signals.churnSignals.length > 0) {
      lines.push('Churn signals:');
      for (const s of signals.churnSignals.slice(0, 5)) {
        lines.push(`  - [${s.severity}] ${s.title}: ${s.description}`);
      }
    }
    if (signals.feedbackItems && signals.feedbackItems.length > 0) {
      const openCount = signals.feedbackItems.filter(f => f.status === 'new').length;
      lines.push(`Feedback: ${signals.feedbackItems.length} items (${openCount} open)`);
    }
    if (signals.recentChatTopics.length > 0) {
      lines.push(`Recent topics: ${signals.recentChatTopics.join(', ')}`);
    }
    if (signals.keywordFeedback.approved.length > 0 || signals.keywordFeedback.rejected.length > 0) {
      lines.push(`Keyword feedback: ${pct(signals.keywordFeedback.patterns.approveRate)} approve rate`);
      if (signals.keywordFeedback.approved.length > 0) {
        lines.push(`  Approved: ${signals.keywordFeedback.approved.slice(0, 5).join(', ')}`);
      }
      if (signals.keywordFeedback.patterns.topRejectionReasons.length > 0) {
        lines.push(`  Top rejection reasons: ${signals.keywordFeedback.patterns.topRejectionReasons.join(', ')}`);
      }
    }
    if (signals.contentGapVotes.length > 0) {
      lines.push(`Content gap votes: ${signals.contentGapVotes.slice(0, 5).map(v => `${v.topic} (${v.votes})`).join(', ')}`);
    }
  }

  return lines.join('\n');
}

function formatOperationalSection(ops: OperationalSlice, verbosity: PromptVerbosity): string {
  const lines: string[] = ['## Operational'];

  const approvals = ops.approvalQueue?.pending ?? 0;
  const clientActions = ops.clientActionQueue?.pending ?? 0;
  const actions = ops.actionBacklog?.pendingMeasurement ?? 0;
  const recs = (ops.recommendationQueue?.fixNow ?? 0) + (ops.recommendationQueue?.fixSoon ?? 0) + (ops.recommendationQueue?.fixLater ?? 0);
  lines.push(`Pending: ${approvals} approvals, ${clientActions} client actions, ${actions} actions awaiting measurement, ${recs} recommendations`);

  if (verbosity !== 'compact') {
    if (ops.recommendationQueue) {
      lines.push(`Recommendations: ${ops.recommendationQueue.fixNow} fix now, ${ops.recommendationQueue.fixSoon} fix soon, ${ops.recommendationQueue.fixLater} fix later`);
    }
    if (ops.recentActivity.length > 0) {
      lines.push(`Recent: ${ops.recentActivity.slice(0, 3).map(a => a.description).join('; ')}`);
    }
    if (ops.timeSaved) {
      lines.push(`Time saved: ${ops.timeSaved.totalMinutes} minutes`);
    }
    if (ops.pendingJobs > 0) {
      lines.push(`Background jobs: ${ops.pendingJobs} pending`);
    }
    if (ops.workOrders) {
      lines.push(`Work orders: ${ops.workOrders.active} active, ${ops.workOrders.pending} pending`);
    }
    if (ops.clientActionQueue) {
      lines.push(`Client action queue: ${ops.clientActionQueue.pending} pending${ops.clientActionQueue.oldestAge !== null ? `, oldest ${ops.clientActionQueue.oldestAge}h` : ''}`);
    }
  }

  if (verbosity === 'detailed') {
    if (ops.detectedPlaybooks && ops.detectedPlaybooks.length > 0) {
      lines.push(`Detected playbooks: ${ops.detectedPlaybooks.slice(0, 3).join(', ')}`);
    }
    if (ops.timeSaved?.byFeature) {
      lines.push('Time saved by feature:');
      for (const [feature, minutes] of Object.entries(ops.timeSaved.byFeature).slice(0, 5)) {
        lines.push(`  ${feature}: ${minutes} min`);
      }
    }
    if (ops.annotations.length > 0) {
      lines.push('Timeline annotations:');
      for (const a of ops.annotations.slice(0, 5)) {
        lines.push(`  - ${a.date}: ${a.label}`);
      }
    }
    if (ops.insightAcceptanceRate) {
      lines.push(`Insight acceptance rate: ${pct(ops.insightAcceptanceRate.rate)} (${ops.insightAcceptanceRate.confirmed}/${ops.insightAcceptanceRate.totalShown})`);
    }
  }

  return lines.join('\n');
}

function formatPageProfileSection(profile: PageProfileSlice, verbosity: PromptVerbosity): string {
  const lines: string[] = [`## Page Profile: ${profile.pagePath}`];

  lines.push(`Keyword: ${profile.primaryKeyword ?? 'none'} | Health: ${profile.optimizationScore ?? 'n/a'}`);

  // Link health — all verbosity levels (concise)
  if (profile.linkHealth) {
    lines.push(`Links: ${profile.linkHealth.inbound} inbound, ${profile.linkHealth.outbound} outbound${profile.linkHealth.orphan ? ' (ORPHAN — no inbound links)' : ''}`);
  }

  if (verbosity !== 'compact') {
    if (profile.rankHistory.current != null) {
      lines.push(`Position: ${profile.rankHistory.current} (${profile.rankHistory.trend})`);
    }
    if (profile.actions.length > 0) {
      lines.push(`Actions: ${profile.actions.length} tracked`);
    }
  }

  if (verbosity === 'detailed') {
    if (profile.optimizationIssues?.length > 0) {
      lines.push('Optimization issues:');
      for (const issue of profile.optimizationIssues.slice(0, 5)) {
        lines.push(`  - ${issue}`);
      }
    }
    if (profile.recommendations.length > 0) {
      lines.push('Recommendations:');
      for (const rec of profile.recommendations.slice(0, 5)) {
        lines.push(`  - ${rec}`);
      }
    }
    if (profile.contentGaps.length > 0) {
      lines.push('Content gaps:');
      for (const gap of profile.contentGaps.slice(0, 3)) {
        lines.push(`  - ${gap}`);
      }
    }
    if (profile.primaryKeywordPresence) {
      const p = profile.primaryKeywordPresence;
      const missing = (['inTitle', 'inMeta', 'inContent', 'inSlug'] as const)
        .filter(k => !p[k])
        .map(k => ({ inTitle: 'title', inMeta: 'meta', inContent: 'content', inSlug: 'slug' }[k]));
      if (missing.length > 0) lines.push(`Keyword missing from: ${missing.join(', ')}`);
    }
    if (profile.competitorKeywords?.length) {
      lines.push(`Competitor keywords: ${profile.competitorKeywords.slice(0, 5).join(', ')}`);
    }
    if (profile.topicCluster) lines.push(`Topic cluster: ${profile.topicCluster}`);
    if (profile.estimatedDifficulty) lines.push(`Difficulty: ${profile.estimatedDifficulty}`);
    if (profile.auditIssues?.length > 0) {
      lines.push(`Structural audit issues: ${profile.auditIssues.length}`);
    }
    lines.push(`Schema: ${profile.schemaStatus} | Content: ${profile.contentStatus ?? 'none'} | CWV: ${profile.cwvStatus ?? 'n/a'}`);
    if (profile.seoEdits?.currentTitle) {
      lines.push(`Current title: ${profile.seoEdits.currentTitle}`);
    }
  }

  return lines.join('\n');
}

export function formatKnowledgeBaseForPrompt(knowledgeBase: string | null | undefined): string {
  if (!knowledgeBase?.trim()) return '';
  return `\n\nBUSINESS KNOWLEDGE BASE (use this to give informed, business-aware answers):\n${knowledgeBase}`;
}

export function formatKeywordsForPrompt(seo: SeoContextSlice | null | undefined): string {
  if (!seo?.strategy) return '';

  let keywordBlock = '';

  // Site-level keywords (matches seo-context.ts line 111-112)
  const siteKw = seo.strategy.siteKeywords?.slice(0, 8).join(', ');
  if (siteKw) keywordBlock += `Site target keywords: ${siteKw}`;

  // Business context (matches seo-context.ts line 115-118)
  const businessContext = seo.businessContext || seo.strategy.businessContext || '';
  if (businessContext) {
    keywordBlock += `\nGeneral business context: ${businessContext}`;
  }

  // Page-specific keywords from pageKeywords slice field (matches seo-context.ts line 121-133)
  const pageKw = seo.pageKeywords;
  if (pageKw) {
    keywordBlock += `\n\nTHIS PAGE'S TARGET (overrides general context):`;
    keywordBlock += `\nPrimary keyword: "${pageKw.primaryKeyword}"`;
    if (pageKw.secondaryKeywords?.length) {
      keywordBlock += `\nSecondary keywords: ${pageKw.secondaryKeywords.join(', ')}`;
    }
    if (pageKw.searchIntent) {
      keywordBlock += `\nSearch intent: ${pageKw.searchIntent}`;
    }
    keywordBlock += `\nIMPORTANT: If this page's keywords reference a specific location (city, state, region), ALWAYS use THAT location. Do NOT substitute the business headquarters or a different location from the general business context. The page-level keyword is the authoritative signal for what this page targets.`;
  }

  if (!keywordBlock) return '';
  return `\n\nKEYWORD STRATEGY (incorporate these naturally):\n${keywordBlock}`;
}

export function formatPersonasForPrompt(personas: AudiencePersona[] | null | undefined): string {
  if (!personas?.length) return '';

  // Matches buildPersonasContext() in seo-context.ts lines 322-331
  const personaStr = personas.map(p => {
    const parts = [`**${p.name}**${p.buyingStage ? ` (${p.buyingStage} stage)` : ''}: ${p.description}`];
    if (p.painPoints.length) parts.push(`  Pain points: ${p.painPoints.join('; ')}`);
    if (p.goals.length) parts.push(`  Goals: ${p.goals.join('; ')}`);
    if (p.objections.length) parts.push(`  Objections: ${p.objections.join('; ')}`);
    if (p.preferredContentFormat) parts.push(`  Prefers: ${p.preferredContentFormat}`);
    return parts.join('\n');
  }).join('\n\n');

  return `\n\nTARGET AUDIENCE PERSONAS (write to address these specific people — their pain points, goals, and objections):\n${personaStr}`;
}

export function formatPageMapForPrompt(seo: SeoContextSlice | null | undefined, pagePath?: string): string {
  if (!seo?.strategy?.pageMap?.length) return '';

  const pageMap = pagePath
    ? seo.strategy.pageMap.filter(p => matchPagePath(p.pagePath, pagePath))
    : seo.strategy.pageMap;

  if (!pageMap.length) return '';

  // Matches buildKeywordMapContext() in seo-context.ts lines 395-399
  const mapStr = pageMap.map(
    p => `${p.pagePath}: "${p.primaryKeyword}"${p.secondaryKeywords?.length ? ` (also: ${p.secondaryKeywords.slice(0, 3).join(', ')})` : ''}`
  ).join('\n');

  return `\n\nEXISTING KEYWORD MAP (avoid cannibalization, suggest internal links where relevant):\n${mapStr}`;
}

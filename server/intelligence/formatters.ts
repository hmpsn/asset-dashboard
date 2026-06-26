import type {
  WorkspaceIntelligence,
  PromptFormatOptions,
  PromptVerbosity,
  SeoContextSlice,
  InsightsSlice,
  LearningsSlice,
  ClientSignalsSlice,
  PageProfileSlice,
  LocalSeoSlice,
  EeatAssetsSlice,
} from '../../shared/types/intelligence.js';
import { matchPagePath } from '../utils/page-address.js';
import { formatContentPipelineSection } from './formatter-content-pipeline.js';
import { formatOperationalSection } from './formatter-operational.js';
import { pct } from './formatter-shared.js';
import { formatSiteHealthSection } from './formatter-site-health.js';
import { formatPageElementsSection } from './page-elements-slice.js';
import { compareKeywordOpportunityScoreDesc } from '../../shared/keyword-opportunity-projection.js';
export { formatPersonasForPrompt } from './persona-format.js';

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
      (include.has('localSeo') && intelligence.localSeo != null) ||
      (include.has('eeatAssets') && intelligence.eeatAssets != null) ||
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
    sections.push(formatSeoContextSection(intelligence.seoContext, verbosity, opts?.includeRankMovers ?? true));
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

  // Local SEO
  if (intelligence.localSeo && (!include || include.has('localSeo'))) {
    sections.push(formatLocalSeoSection(intelligence.localSeo, verbosity));
  }

  // E-E-A-T assets
  if (intelligence.eeatAssets && (!include || include.has('eeatAssets'))) {
    sections.push(formatEeatAssetsSection(intelligence.eeatAssets, verbosity));
  }

  // Apply tokenBudget truncation if requested (§20 priority chain)
  const tokenBudget = opts?.tokenBudget;
  if (tokenBudget && tokenBudget > 0) {
    // The §20 priority chain treats seoContext as the never-dropped anchor and
    // drops operational FIRST. That ordering is correct for the full prompt, but
    // for a slice-filtered call that does NOT request seoContext (e.g. the
    // admin-chat additional-slices block: operational/siteHealth/clientSignals/…),
    // there is no anchor, and dropping operational first silently removes the very
    // slice the question selected. Tell applyTokenBudget whether seoContext is in
    // play so it can protect requested slices when it is not.
    const seoContextIsAnchor = !include || include.has('seoContext');
    return applyTokenBudget(sections, intelligence, tokenBudget, seoContextIsAnchor);
  }

  return sections.filter(Boolean).join('\n\n');
}

function applyTokenBudget(
  sections: string[],
  intelligence: WorkspaceIntelligence,
  budget: number,
  seoContextIsAnchor: boolean = true,
): string {
  const estimateTokens = (text: string) => Math.ceil(text.length / 4);

  let current = sections.filter(Boolean);
  let output = current.join('\n\n');
  if (estimateTokens(output) <= budget) return output;

  // Slice-filtered call with no seoContext anchor: the standard "drop operational
  // first / collapse to seoContext only" chain would erase the requested slices.
  // Instead degrade in place — truncate every non-header section to its first few
  // lines, keeping ALL requested sections present (operational included) — then,
  // only if still over budget, drop trailing sections from the end (least-recently
  // requested in formatForPrompt's fixed emit order) while always keeping the first.
  if (!seoContextIsAnchor) {
    return applyFilteredTokenBudget(current, budget, estimateTokens);
  }

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

  // Step 4e: Drop eeatAssets
  current = current.filter(s => !s.startsWith('## E-E-A-T Assets'));
  output = current.join('\n\n');
  if (estimateTokens(output) <= budget) return output;

  // Step 5: Drop everything except seoContext (never dropped)
  const seoOnly = current.filter(s =>
    s.startsWith('[Workspace Intelligence]') || s.startsWith('## SEO Context'),
  );
  return seoOnly.join('\n\n');
}

/**
 * Token-budget truncation for slice-filtered calls that have NO seoContext anchor
 * (e.g. the admin-chat additional-slices block). Unlike the §20 priority chain,
 * this never drops operational first and never collapses to "seoContext only" —
 * the requested slices ARE the answer, so it keeps them all and degrades in place:
 *
 *   1. If under budget, return as-is.
 *   2. Otherwise truncate each section body to its first `keepLines` lines
 *      (header + most-salient lines first), keeping every requested section
 *      present so the slice the question selected never silently vanishes.
 *   3. Only if STILL over budget after maximal per-section truncation, drop whole
 *      sections from the END of formatForPrompt's fixed emit order, always
 *      retaining the first content section.
 */
function applyFilteredTokenBudget(
  sections: string[],
  budget: number,
  estimateTokens: (text: string) => number,
): string {
  const header = sections.filter(s => s.startsWith('[Workspace Intelligence]'));
  let content = sections.filter(s => !s.startsWith('[Workspace Intelligence]'));

  const render = (cs: string[]) => [...header, ...cs].join('\n\n');
  if (estimateTokens(render(content)) <= budget) return render(content);

  // Step 2: progressively truncate every section body, header line always kept.
  for (let keepLines = 8; keepLines >= 1; keepLines--) {
    content = content.map(s => {
      const lines = s.split('\n');
      if (lines.length <= keepLines + 1) return s;
      return [...lines.slice(0, keepLines + 1), '  (truncated)'].join('\n');
    });
    if (estimateTokens(render(content)) <= budget) return render(content);
  }

  // Step 3: still over budget — drop whole sections from the end, but always keep
  // at least the first content section so the block never collapses to nothing.
  while (content.length > 1 && estimateTokens(render(content)) > budget) {
    content = content.slice(0, -1);
  }
  return render(content);
}

function formatSeoContextSection(ctx: SeoContextSlice, verbosity: PromptVerbosity, includeRankMovers = true): string {
  const lines: string[] = ['## SEO Context'];

  if (ctx.businessContext) lines.push(`Business: ${ctx.businessContext}`);
  // Voice authority: `effectiveBrandVoiceBlock` is the single source of truth — it is
  // computed by the SEO context source with full voice authority (calibrated profile
  // → voice samples block; else legacy brandVoice + brand-docs block; else empty). An
  // empty string means "render nothing here" and is INTENTIONAL when the workspace is
  // calibrated with no samples — `buildSystemPrompt` Layer 2 handles DNA + guardrails
  // via the system message. Injecting raw `ctx.brandVoice` as a fallback would bypass
  // the authority rule and produce two contradictory voice sources (see the bug from
  // PR #167 where the `else if` fallback re-injected legacy voice on calibrated empty
  // profiles). `.trim()` strips the leading `\n\n` from the source output.
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
    if (includeRankMovers && rt.topKeywordMovers?.length) {
      const movers = rt.topKeywordMovers
        .slice(0, 5)
        .map((mover) => {
          const icon = mover.direction === 'improved' ? '↑' : '↓';
          const rankLabel = mover.position > 0 ? `#${Number.isInteger(mover.position) ? mover.position : mover.position.toFixed(1)}` : 'unranked';
          const valueLabel = typeof mover.valueScore === 'number' ? `, value ${mover.valueScore}` : '';
          return `${mover.direction} "${mover.query}" ${rankLabel} (${icon}${Math.abs(mover.change)}${valueLabel}, ${mover.impressions.toLocaleString()} impressions)`;
        })
        .join('; ');
      lines.push(`Top keyword movers: ${movers}`);
    }
  }

  // GSC discovered query summary — at standard+ verbosity
  if (ctx.discoveredQuerySummary && verbosity !== 'compact') {
    const dq = ctx.discoveredQuerySummary;
    if (dq.lostVisibilityCount > 0) {
      const examples = dq.topLostQueries
        .slice(0, 3)
        .map(query => `${query.query} (last rank: ${query.lastPosition != null ? query.lastPosition.toFixed(1) : 'unknown'})`)
        .join(', ');
      lines.push(
        `GSC discovery: ${dq.totalDiscovered} queries tracked, `
        + `${dq.lostVisibilityCount} lost visibility${examples ? ` — top losses: ${examples}` : ''}`,
      );
    } else {
      lines.push(`GSC discovery: ${dq.totalDiscovered} queries tracked, none lost visibility`);
    }
  }

  if (ctx.geoVolumeLabel && verbosity !== 'compact') {
    lines.push(`Keyword volumes are geo-targeted to ${ctx.geoVolumeLabel}, not national figures.`);
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
    if (sf.aiOverview > 0) parts.push(`${sf.aiOverview} AI Overview opportunit${sf.aiOverview === 1 ? 'y' : 'ies'}`);
    if (sf.localPack) parts.push('local pack present');
    if (parts.length > 0) lines.push(`SERP features: ${parts.join(', ')}`);
  }

  // AI visibility — aggregates-only LLM-citation summary (SEO Decision Engine P8); only
  // present when the `ai-visibility` flag is on AND a snapshot exists. At standard+ verbosity.
  if (ctx.aiVisibility && verbosity !== 'compact') {
    const av = ctx.aiVisibility;
    if (av.mentions != null || av.shareOfVoice != null) {
      const sov = av.shareOfVoice != null ? `${Math.round(av.shareOfVoice * 100)}% share of voice vs co-mentioned brands` : null;
      const top = av.topCompetitor ? ` (top: ${av.topCompetitor.name})` : '';
      const cited = av.mentions != null ? `cited ${av.mentions.toLocaleString()} time${av.mentions === 1 ? '' : 's'} in LLM answers` : null;
      const parts = [cited, sov ? `${sov}${top}` : null].filter(Boolean);
      if (parts.length > 0) lines.push(`AI visibility: ${parts.join('; ')}.`);
    }
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

  // Top Opportunity — the resolved #1 recommendation's OV breakdown (SI2/MW6).
  // CLIENT-SAFE: this formatter is shared (formatForPrompt is audience-agnostic and
  // reaches the client search-chat advisor), so it must NEVER print the dollar
  // emvPerWeek. Only the relative value (0–100) + component evidence appear here;
  // the admin advisor gets emvPerWeek via the admin-only recSummary (admin-chat-context).
  // Inject opportunity.components evidence DIRECTLY — no format helper (authority-layered
  // fields rule). Token budget: only the top-3 components by contribution, not all 7.
  if (ctx.topOpportunity && ctx.topOpportunity.components.length > 0) {
    const top = ctx.topOpportunity;
    lines.push(`#1 OPPORTUNITY (value ${Math.round(top.value)}/100):`);
    const topComponents = [...top.components]
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 3);
    for (const c of topComponents) {
      lines.push(`  - ${c.dimension}: ${c.evidence}`);
    }
  }

  // Quick wins — low-effort, high-impact fixes with grounded ROI (SI1); standard+ verbosity
  if (ctx.quickWins && ctx.quickWins.length > 0 && verbosity !== 'compact') {
    const limit = verbosity === 'detailed' ? 8 : 4;
    lines.push('Quick wins (low-effort, high-impact):');
    for (const qw of ctx.quickWins.slice(0, limit)) {
      const roi = qw.roiScore != null ? ` [ROI ${Math.round(qw.roiScore)}]` : '';
      lines.push(`  - ${qw.pagePath}: ${qw.action}${roi} (${qw.estimatedImpact} impact)`);
    }
  }

  // Content gaps — enriched with opportunityScore + trendDirection (SI2); standard+ verbosity.
  // contentGaps live on strategy (reassembled from the content_gaps table by the slice).
  if (ctx.strategy?.contentGaps && ctx.strategy.contentGaps.length > 0 && verbosity !== 'compact') {
    const limit = verbosity === 'detailed' ? 8 : 4;
    const gaps = [...ctx.strategy.contentGaps]
      .sort(compareKeywordOpportunityScoreDesc)
      .slice(0, limit);
    lines.push('Content gaps (opportunity-ranked):');
    for (const g of gaps) {
      const score = g.opportunityScore != null ? ` [opportunity ${Math.round(g.opportunityScore)}]` : '';
      const trend = g.trendDirection ? ` ${g.trendDirection}` : '';
      lines.push(`  - ${g.topic} → "${g.targetKeyword}" (${g.intent})${score}${trend}`);
    }
  }

  // Cannibalization issues — keyword overlap across pages (SI4); standard+ verbosity
  if (ctx.cannibalizationIssues && ctx.cannibalizationIssues.length > 0 && verbosity !== 'compact') {
    const limit = verbosity === 'detailed' ? 6 : 3;
    lines.push('Keyword cannibalization:');
    for (const issue of ctx.cannibalizationIssues.slice(0, limit)) {
      lines.push(`  - [${issue.severity}] "${issue.keyword}" across ${issue.pages.length} pages: ${issue.recommendation}`);
    }
  }

  // Keyword gaps — keywords competitors rank for that we don't (P5); standard+ verbosity
  if (ctx.keywordGaps && ctx.keywordGaps.length > 0 && verbosity !== 'compact') {
    const limit = verbosity === 'detailed' ? 8 : 4;
    lines.push('Keyword gaps (competitor ranks, we don\'t):');
    for (const gap of ctx.keywordGaps.slice(0, limit)) {
      lines.push(`  - "${gap.keyword}" (vol ${gap.volume}, KD ${gap.difficulty}) — ${gap.competitorDomain} #${gap.competitorPosition}`);
    }
  }

  // Topic clusters — topical authority coverage per cluster (P5); standard+ verbosity
  if (ctx.topicClusters && ctx.topicClusters.length > 0 && verbosity !== 'compact') {
    const limit = verbosity === 'detailed' ? 6 : 3;
    lines.push('Topic clusters (weakest coverage first):');
    for (const cluster of ctx.topicClusters.slice(0, limit)) {
      lines.push(`  - "${cluster.topic}": ${Math.round(cluster.coveragePercent)}% covered (${cluster.ownedCount}/${cluster.totalCount} keywords)`);
    }
  }

  // Competitor snapshots (Task 4.2c) — at standard+ verbosity
  if (ctx.competitorSnapshots && ctx.competitorSnapshots.length > 0 && verbosity !== 'compact') {
    if (verbosity === 'detailed') {
      lines.push('Competitor intelligence:');
      for (const snap of ctx.competitorSnapshots.slice(0, 5)) {
        const parts: string[] = [`${snap.competitorDomain} (${snap.snapshotDate})`];
        if (snap.keywordCount != null) parts.push(`${snap.keywordCount} keywords`);
        if (snap.organicTraffic != null) parts.push(`${snap.organicTraffic} organic traffic`);
        if (snap.topKeywords.length > 0) {
          const topKw = snap.topKeywords.slice(0, 3).map(k => `${k.keyword} (#${k.position})`).join(', ');
          parts.push(`top: ${topKw}`);
        }
        lines.push(`  - ${parts.join(' | ')}`);
      }
    } else {
      const summary = ctx.competitorSnapshots.slice(0, 3).map(s => s.competitorDomain).join(', ');
      lines.push(`Competitors tracked: ${ctx.competitorSnapshots.length} (${summary})`);
    }
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
        lines.push(`  - ${entry.prediction} → ${entry.outcome}${entry.pageUrl ? ` (${entry.pageUrl})` : ''}`);
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

function formatClientSignalsSection(signals: ClientSignalsSlice, verbosity: PromptVerbosity): string {
  const lines: string[] = ['## Client Signals'];

  lines.push(`Churn risk: ${signals.churnRisk ?? 'unknown'}`);
  if (signals.roi) {
    lines.push(`ROI: $${signals.roi.organicValue} organic value, ${signals.roi.growth > 0 ? '+' : ''}${signals.roi.growth}% growth (${signals.roi.period})`);
  }
  if (signals.compositeHealthScore != null) {
    lines.push(`Health score: ${signals.compositeHealthScore}/100`);
  }
  if (signals.compositeHealthBreakdown?.rows.length) {
    lines.push(
      `Health score breakdown: ${signals.compositeHealthBreakdown.rows
        .map(row => `${row.label} ${row.score}/100 (${row.weight}% weight)`)
        .join('; ')}`,
    );
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
    // Use the authority-resolved list (client store + admin store, deduped) so the
    // prompt reflects reconciled business intent, not just the client half.
    // effectiveBusinessPriorities is always a superset of businessPriorities, so no
    // fallback to the raw field is needed.
    const promptPriorities = signals.effectiveBusinessPriorities ?? [];
    if (promptPriorities.length > 0) {
      lines.push(`Business priorities: ${promptPriorities.join('; ')}`);
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

/**
 * Format the local SEO slice for AI prompts.
 *
 * The slice's `effectiveLocalSeoBlock` is an authority-layered field (pre-formatted
 * with stratified per-market sampling already applied). Per CLAUDE.md, callers
 * inject it directly. The minimal-verbosity branch returns a one-liner instead.
 */
function formatLocalSeoSection(slice: LocalSeoSlice, verbosity: PromptVerbosity): string {
  if (!slice.enabled) return '## Local SEO\nLocal SEO is disabled for this workspace.';
  if (verbosity === 'compact') {
    const activeMarkets = slice.markets.filter(m => m.status === 'active').length;
    return `## Local SEO\n${activeMarkets} active markets. ${slice.visibility.visible} visible, ${slice.visibility.notVisible} not visible, ${slice.visibility.notChecked} not checked.`;
  }
  return `## Local SEO\n${slice.effectiveLocalSeoBlock}`;
}

function formatEeatAssetsSection(slice: EeatAssetsSlice, verbosity: PromptVerbosity): string {
  const lines: string[] = ['## E-E-A-T Assets'];
  if (slice.availability === 'no_data') {
    lines.push('No trust-signal assets have been added yet.');
    return lines.join('\n');
  }
  lines.push(`Inventory: ${slice.assets.length} assets across ${slice.byType.length} categories.`);
  if (slice.byType.length > 0) {
    lines.push(`By type: ${slice.byType.map(entry => `${entry.type} (${entry.count})`).join(', ')}`);
  }
  if (verbosity !== 'compact') {
    lines.push(slice.effectiveTrustSignalsBlock);
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

  // Site-level keywords from the seoContext strategy slice.
  const siteKw = seo.strategy.siteKeywords?.slice(0, 8).join(', ');
  if (siteKw) keywordBlock += `Site target keywords: ${siteKw}`;

  // Business context from the resolved slice, with strategy fallback.
  const businessContext = seo.businessContext || seo.strategy.businessContext || '';
  if (businessContext) {
    keywordBlock += `\nGeneral business context: ${businessContext}`;
  }

  // Page-specific keywords from the pageKeywords slice field.
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

type PageMapPromptEntry = NonNullable<NonNullable<SeoContextSlice['strategy']>['pageMap']>[number] & {
  opportunityScore?: number;
  valueScore?: number;
};

function finiteMetric(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatMetricNumber(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString('en-US') : value.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

function formatPageMapMetrics(page: PageMapPromptEntry): string {
  const metrics: string[] = [];
  if (page.searchIntent) metrics.push(`intent: ${page.searchIntent}`);

  const volume = finiteMetric(page.volume) ?? finiteMetric(page.monthlyVolume);
  if (volume != null) metrics.push(`vol: ${formatMetricNumber(volume)}`);

  const difficulty = finiteMetric(page.difficulty) ?? finiteMetric(page.keywordDifficulty);
  if (difficulty != null) metrics.push(`KD: ${formatMetricNumber(difficulty)}`);

  const cpc = finiteMetric(page.cpc);
  if (cpc != null) metrics.push(`CPC: $${cpc.toFixed(2)}`);

  const valueScore = finiteMetric(page.valueScore) ?? finiteMetric(page.opportunityScore);
  if (valueScore != null) metrics.push(`value: ${formatMetricNumber(valueScore)}`);

  return metrics.length ? ` [${metrics.join('; ')}]` : '';
}

export function formatPageMapForPrompt(seo: SeoContextSlice | null | undefined, pagePath?: string): string {
  if (!seo?.strategy?.pageMap?.length) return '';

  const pageMap = pagePath
    ? seo.strategy.pageMap.filter(p => matchPagePath(p.pagePath, pagePath))
    : seo.strategy.pageMap;

  if (!pageMap.length) return '';

  // Preserves the legacy keyword-map prompt shape used before retirement.
  const mapStr = pageMap.map(
    p => `${p.pagePath}: "${p.primaryKeyword}"${p.secondaryKeywords?.length ? ` (also: ${p.secondaryKeywords.slice(0, 3).join(', ')})` : ''}${formatPageMapMetrics(p)}`
  ).join('\n');

  return `\n\nEXISTING KEYWORD MAP (avoid cannibalization, suggest internal links where relevant):\n${mapStr}`;
}

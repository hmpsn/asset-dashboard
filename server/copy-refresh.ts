/**
 * Copy Refresh Engine
 *
 * Bridges content decay detection with the copy pipeline:
 * - Matches decaying pages to blueprint entries
 * - Generates section-specific copy refresh suggestions via AI
 * - Batch-analyzes all decaying pages for a workspace
 */

import { listBlueprints } from './page-strategy.js';
import { getSectionsForEntry } from './copy-review.js';
import { loadDecayAnalysis } from './content-decay.js';
import { callOpenAI, parseAIJson } from './openai-helpers.js';
import { createLogger } from './logger.js';
import type { BlueprintEntry } from '../shared/types/page-strategy.js';
import type { CopySection } from '../shared/types/copy-pipeline.js';

const log = createLogger('copy-refresh');

// ── Types ──

export interface DecayContext {
  url: string;
  decayType: string;
  severity: string;
  metrics?: Record<string, number>;
}

export interface CopyRefreshSuggestion {
  sectionId: string;
  sectionType: string;
  currentCopy: string;
  suggestedAction: 'rewrite' | 'update' | 'keep';
  reason: string;
  priority: 'high' | 'medium' | 'low';
}

export interface DecayEntryMatch {
  blueprintId: string;
  entry: BlueprintEntry;
}

export interface PageRefreshResult {
  url: string;
  entry: BlueprintEntry;
  suggestions: CopyRefreshSuggestion[];
}

export interface BatchRefreshResult {
  pagesNeedingRefresh: PageRefreshResult[];
}

// ── URL normalization ──

/**
 * Normalize a URL or path for comparison: strip protocol, host, trailing slashes,
 * lowercase, and return just the pathname.
 */
function normalizePath(raw: string): string {
  let path = raw.trim().toLowerCase();

  // If it looks like a full URL, extract the pathname
  try {
    const url = new URL(path, 'https://placeholder.com');
    path = url.pathname;
  } catch {
    // Already a path segment — use as-is
  }

  // Strip trailing slash (but preserve root '/')
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  return path;
}

/**
 * Convert an entry name to a slug for URL matching.
 * "About Us" → "about-us", "Our Services — Web Design" → "our-services-web-design"
 */
function nameToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[—–]/g, '-')         // em/en dashes
    .replace(/[^a-z0-9\s-]/g, '')  // strip non-alphanumeric
    .replace(/\s+/g, '-')          // spaces to hyphens
    .replace(/-+/g, '-')           // collapse multiple hyphens
    .replace(/^-|-$/g, '');        // trim leading/trailing hyphens
}

// ── Match function ──

/**
 * Match a decaying URL to a blueprint entry by comparing normalized paths
 * and entry name slugs.
 */
export function matchDecayToEntry(
  workspaceId: string,
  decayUrl: string,
): DecayEntryMatch | null {
  const blueprints = listBlueprints(workspaceId);
  const normalizedDecay = normalizePath(decayUrl);
  // Extract the last path segment for slug matching
  const decaySegments = normalizedDecay.split('/').filter(Boolean);
  const decayLastSegment = decaySegments[decaySegments.length - 1] ?? '';

  for (const blueprint of blueprints) {
    const entries = blueprint.entries ?? [];
    for (const entry of entries) {
      // Strategy 1: direct path match against entry name slug
      const entrySlug = nameToSlug(entry.name);
      if (entrySlug && decayLastSegment === entrySlug) {
        return { blueprintId: blueprint.id, entry };
      }

      // Strategy 2: entry name slug appears anywhere in the decay path
      if (entrySlug && normalizedDecay.includes(`/${entrySlug}`)) {
        return { blueprintId: blueprint.id, entry };
      }

      // Strategy 3: primary keyword slug match
      if (entry.primaryKeyword) {
        const keywordSlug = nameToSlug(entry.primaryKeyword);
        if (keywordSlug && (decayLastSegment === keywordSlug || normalizedDecay.includes(`/${keywordSlug}`))) {
          return { blueprintId: blueprint.id, entry };
        }
      }
    }
  }

  return null;
}

// ── Refresh suggestion function ──

/**
 * Analyze copy sections for a blueprint entry and suggest which sections
 * need refreshing based on content decay signals.
 */
export async function suggestCopyRefresh(
  workspaceId: string,
  entryId: string,
  decayContext: DecayContext,
): Promise<CopyRefreshSuggestion[]> {
  const sections = getSectionsForEntry(entryId, workspaceId);

  if (sections.length === 0) {
    log.info({ workspaceId, entryId }, 'No copy sections found for entry — skipping refresh suggestions');
    return [];
  }

  // Only include sections that have generated copy
  const sectionsWithCopy = sections.filter(
    (s): s is CopySection & { generatedCopy: string } => s.generatedCopy !== null,
  );

  if (sectionsWithCopy.length === 0) {
    log.info({ workspaceId, entryId }, 'No sections with generated copy — skipping refresh suggestions');
    return [];
  }

  // Build section summary for the AI prompt
  const sectionSummary = sectionsWithCopy.map((s, i) => {
    // Truncate long copy to keep prompt size reasonable
    const copyPreview = s.generatedCopy.length > 500
      ? s.generatedCopy.slice(0, 500) + '...'
      : s.generatedCopy;
    return `Section ${i + 1} (id: ${s.id}, plan: ${s.sectionPlanItemId}):\nCopy: ${copyPreview}`;
  }).join('\n\n');

  const metricsStr = decayContext.metrics
    ? Object.entries(decayContext.metrics).map(([k, v]) => `${k}: ${v}`).join(', ')
    : 'none available';

  const prompt = `You are an SEO content strategist. A page is experiencing content decay and we need to determine which copy sections need refreshing.

Decay signals:
- URL: ${decayContext.url}
- Decay type: ${decayContext.decayType}
- Severity: ${decayContext.severity}
- Metrics: ${metricsStr}

Current copy sections:
${sectionSummary}

For each section, decide whether it needs a full rewrite, a partial update, or can be kept as-is.

Return a JSON object with a "suggestions" array. Each item must have:
- "sectionId": the section id
- "sectionPlanItemId": the plan item id
- "suggestedAction": "rewrite" | "update" | "keep"
- "reason": a 1-2 sentence explanation
- "priority": "high" | "medium" | "low"

Prioritize sections that are most likely contributing to the decline (outdated info, weak CTAs, poor keyword targeting).`;

  try {
    const result = await callOpenAI({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1500,
      temperature: 0.4,
      responseFormat: { type: 'json_object' },
      feature: 'copy-refresh',
      workspaceId,
    });

    const parsed = parseAIJson<{
      suggestions?: Array<{
        sectionId?: string;
        sectionPlanItemId?: string;
        suggestedAction?: string;
        reason?: string;
        priority?: string;
      }>;
    }>(result.text);

    if (!parsed.suggestions || !Array.isArray(parsed.suggestions)) {
      log.warn({ workspaceId, entryId }, 'AI returned no suggestions array');
      return [];
    }

    // Build a lookup for section data by id
    const sectionMap = new Map(sectionsWithCopy.map(s => [s.id, s]));

    const suggestions: CopyRefreshSuggestion[] = [];
    for (const raw of parsed.suggestions) {
      const sectionId = raw.sectionId ?? raw.sectionPlanItemId ?? '';
      // Resolve section — AI may return the copy section id or the plan item id
      const section = sectionMap.get(sectionId)
        ?? sectionsWithCopy.find(s => s.sectionPlanItemId === sectionId);

      if (!section) continue;

      const action = raw.suggestedAction;
      if (action !== 'rewrite' && action !== 'update' && action !== 'keep') continue;

      const priority = raw.priority;
      if (priority !== 'high' && priority !== 'medium' && priority !== 'low') continue;

      // Extract readable type from plan item ID (format: "sp_xxx_hero" → "hero")
      const extractedType = section.sectionPlanItemId.split('_').slice(2).join('_') || 'section';
      suggestions.push({
        sectionId: section.id,
        sectionType: extractedType,
        currentCopy: section.generatedCopy,
        suggestedAction: action,
        reason: raw.reason ?? 'No reason provided',
        priority,
      });
    }

    // Sort: high priority first, then rewrite > update > keep
    const actionOrder: Record<string, number> = { rewrite: 0, update: 1, keep: 2 };
    const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    suggestions.sort((a, b) => {
      const pDiff = (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
      if (pDiff !== 0) return pDiff;
      return (actionOrder[a.suggestedAction] ?? 2) - (actionOrder[b.suggestedAction] ?? 2);
    });

    log.info(
      { workspaceId, entryId, total: suggestions.length, rewrites: suggestions.filter(s => s.suggestedAction === 'rewrite').length },
      'Copy refresh suggestions generated',
    );

    return suggestions;
  } catch (err) {
    log.error({ err, workspaceId, entryId }, 'Failed to generate copy refresh suggestions');
    return [];
  }
}

// ── Batch analysis ──

/**
 * Analyze all decaying pages for a workspace, match them to blueprint entries,
 * and generate section-specific refresh suggestions for each match.
 */
export async function analyzeDecayForCopyRefresh(
  workspaceId: string,
): Promise<BatchRefreshResult> {
  const decay = loadDecayAnalysis(workspaceId);

  if (!decay || decay.decayingPages.length === 0) {
    log.info({ workspaceId }, 'No decay data available — nothing to refresh');
    return { pagesNeedingRefresh: [] };
  }

  const results: PageRefreshResult[] = [];

  for (const page of decay.decayingPages) {
    const match = matchDecayToEntry(workspaceId, page.page);
    if (!match) continue;

    const decayContext: DecayContext = {
      url: page.page,
      decayType: page.clickDeclinePct <= -50 ? 'severe_click_decline' : 'click_decline',
      severity: page.severity,
      metrics: {
        clickDeclinePct: page.clickDeclinePct,
        currentClicks: page.currentClicks,
        previousClicks: page.previousClicks,
        impressionChangePct: page.impressionChangePct,
        positionChange: page.positionChange,
        currentPosition: page.currentPosition,
      },
    };

    try {
      const suggestions = await suggestCopyRefresh(
        workspaceId,
        match.entry.id,
        decayContext,
      );

      // Only include pages that have actionable suggestions (not all "keep")
      const actionable = suggestions.filter(s => s.suggestedAction !== 'keep');
      if (actionable.length > 0) {
        results.push({
          url: page.page,
          entry: match.entry,
          suggestions,
        });
      }
    } catch (err) {
      log.error({ err, workspaceId, url: page.page }, 'Failed to analyze page for copy refresh');
    }
  }

  log.info(
    { workspaceId, totalDecaying: decay.decayingPages.length, matched: results.length },
    'Batch copy refresh analysis complete',
  );

  return { pagesNeedingRefresh: results };
}

import fs from 'fs';
import path from 'path';
import { getWorkspace, type KeywordStrategy } from './workspaces';
import { getPageKeyword, listPageKeywords } from './page-keywords.js';
import { getUploadRoot } from './data-dir.js';
import { isFeatureEnabled } from './feature-flags.js';
import { getWorkspaceLearnings, formatLearningsForPrompt } from './workspace-learnings.js';
import { createLogger } from './logger.js';
import { listBrandscripts } from './brandscript.js';
import { getVoiceProfile } from './voice-calibration.js';
import { listDeliverables } from './brand-identity.js';
import type { ContextEmphasis } from '../shared/types/brand-engine.js';

const log = createLogger('seo-context');

/**
 * Shared SEO context builder for all AI-powered endpoints.
 * Ensures every AI prompt gets consistent strategy + business context.
 */

export interface SeoContext {
  /** Keyword strategy block for AI prompts */
  keywordBlock: string;
  /** Brand voice block for AI prompts */
  brandVoiceBlock: string;
  /** Business context string (industry, location, services) */
  businessContext: string;
  /** Audience personas block for AI prompts */
  personasBlock: string;
  /** Knowledge base block for AI prompts */
  knowledgeBlock: string;
  /** All context blocks joined — drop this into any prompt for full business awareness */
  fullContext: string;
  /** Full strategy object (for direct access if needed) */
  strategy: KeywordStrategy | undefined;
}

// ── TTL cache for buildSeoContext (5-minute expiry) ──

const seoContextCache = new Map<string, { value: SeoContext; expiry: number }>();
const SEO_CONTEXT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Clear cached SEO context. Call when workspace settings change. */
export function clearSeoContextCache(workspaceId?: string): void {
  if (workspaceId) {
    // Clear all keys for this workspace (any pagePath variant)
    for (const key of seoContextCache.keys()) {
      if (key.startsWith(`${workspaceId}:`)) seoContextCache.delete(key);
    }
  } else {
    seoContextCache.clear();
  }
}

/**
 * Build SEO context from a workspace's keyword strategy.
 * Results are cached for 5 minutes per workspace+pagePath+learningsDomain combination.
 * @param workspaceId - workspace to look up
 * @param pagePath - optional page path to find page-specific keywords
 * @param learningsDomain - which learning domain to inject (default 'strategy'); pass 'content' from content generation callers
 */
export function buildSeoContext(
  workspaceId?: string,
  pagePath?: string,
  learningsDomain: 'content' | 'strategy' | 'technical' | 'all' = 'strategy',
  internalOpts?: { _skipShadow?: boolean },
): SeoContext {
  if (workspaceId) {
    const cacheKey = `${workspaceId}:${pagePath || ''}:${learningsDomain}`;
    const cached = seoContextCache.get(cacheKey);
    if (cached && Date.now() < cached.expiry) return cached.value;
  }
  const empty: SeoContext = { keywordBlock: '', brandVoiceBlock: '', businessContext: '', personasBlock: '', knowledgeBlock: '', fullContext: '', strategy: undefined };
  if (!workspaceId) return empty;

  const ws = getWorkspace(workspaceId);
  if (!ws) return empty;

  const strategy = ws.keywordStrategy;

  // --- Brand voice ---
  let brandVoiceBlock = '';
  const voiceParts: string[] = [];
  if (ws.brandVoice) voiceParts.push(ws.brandVoice);
  // Read any .txt/.md files from workspace brand-docs folder
  const brandDocsContent = readBrandDocs(ws.folder);
  if (brandDocsContent) voiceParts.push(brandDocsContent);
  if (voiceParts.length > 0) {
    brandVoiceBlock = `\n\nBRAND VOICE & STYLE (you MUST match this voice — do not deviate):\n${voiceParts.join('\n\n')}`;
  }

  // Build personas + knowledge base (always, even without strategy)
  const personasBlock = buildPersonasContext(workspaceId);
  const knowledgeBlock = buildKnowledgeBase(workspaceId);

  if (!strategy) {
    const brandscriptBlock = buildBrandscriptContext(workspaceId);
    const voiceProfileBlock = buildVoiceProfileContext(workspaceId);
    const identityBlock = buildIdentityContext(workspaceId);
    const effectiveBrandVoice = voiceProfileBlock || brandVoiceBlock;
    const baseParts = [effectiveBrandVoice, brandscriptBlock, identityBlock, personasBlock, knowledgeBlock].filter(Boolean);
    // Inject workspace learnings if feature is enabled
    if (isFeatureEnabled('outcome-ai-injection')) {
      const learnings = getWorkspaceLearnings(workspaceId);
      if (learnings) {
        const learningsBlock = formatLearningsForPrompt(learnings, learningsDomain);
        if (learningsBlock) baseParts.push(learningsBlock);
      }
    }
    const fullContext = baseParts.join('');
    const result: SeoContext = { keywordBlock: '', brandVoiceBlock, businessContext: '', personasBlock, knowledgeBlock, fullContext, strategy: undefined };
    seoContextCache.set(`${workspaceId}:${pagePath || ''}:${learningsDomain}`, { value: result, expiry: Date.now() + SEO_CONTEXT_TTL_MS });
    return result;
  }

  let keywordBlock = '';

  // Site-level keywords
  const siteKw = strategy.siteKeywords?.slice(0, 8).join(', ');
  if (siteKw) keywordBlock += `Site target keywords: ${siteKw}`;

  // Business context (general — placed BEFORE page-specific so page keywords take priority)
  const businessContext = strategy.businessContext || '';
  if (businessContext) {
    keywordBlock += `\nGeneral business context: ${businessContext}`;
  }

  // Page-specific keywords (if pagePath provided) — these OVERRIDE general context
  if (pagePath) {
    const pageKw = getPageKeyword(workspaceId, pagePath);
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
  }

  if (keywordBlock) {
    keywordBlock = `\n\nKEYWORD STRATEGY (incorporate these naturally):\n${keywordBlock}`;
  }

  const brandscriptBlock = buildBrandscriptContext(workspaceId);
  const voiceProfileBlock = buildVoiceProfileContext(workspaceId);
  const identityBlock = buildIdentityContext(workspaceId);
  const effectiveBrandVoice = voiceProfileBlock || brandVoiceBlock;
  const contextParts = [keywordBlock, effectiveBrandVoice, brandscriptBlock, identityBlock, personasBlock, knowledgeBlock].filter(Boolean);
  // Inject workspace learnings if feature is enabled
  if (isFeatureEnabled('outcome-ai-injection')) {
    const learnings = getWorkspaceLearnings(workspaceId);
    if (learnings) {
      const learningsBlock = formatLearningsForPrompt(learnings, learningsDomain);
      if (learningsBlock) contextParts.push(learningsBlock);
    }
  }
  const fullContext = contextParts.join('');
  const result: SeoContext = { keywordBlock, brandVoiceBlock, businessContext, personasBlock, knowledgeBlock, fullContext, strategy };

  // Cache result
  if (workspaceId) {
    seoContextCache.set(`${workspaceId}:${pagePath || ''}:${learningsDomain}`, { value: result, expiry: Date.now() + SEO_CONTEXT_TTL_MS });
  }

  // Shadow-mode intelligence delegation (§14, §16)
  // Fire-and-forget — don't await, don't block the return.
  // ALWAYS returns the original result — shadow mode is observation-only.
  if (isFeatureEnabled('intelligence-shadow-mode') && workspaceId && !internalOpts?._skipShadow) {
    void (async () => {
      try {
        const { buildWorkspaceIntelligence } = await import('./workspace-intelligence.js');
        const intel = await buildWorkspaceIntelligence(workspaceId, { slices: ['seoContext'], pagePath, learningsDomain });

        if (intel.seoContext) {
          // Shadow-mode comparison: compare buildSeoContext() output against the
          // intelligence assembler's seoContext slice. Both sides originate from the
          // same source data. The assembler maps:
          //   brandVoice  = getRawBrandVoice() (raw, no header)
          //   knowledgeBase = getRawKnowledge() (raw, no header)
          // So compare raw-to-raw (voiceParts.join vs intel.seoContext.brandVoice).
          const comparisonFields = [
            { name: 'strategy', match: JSON.stringify(result.strategy) === JSON.stringify(intel.seoContext.strategy) },
            // Both are raw brand voice (no "BRAND VOICE & STYLE" header)
            { name: 'brandVoice', match: getRawBrandVoice(workspaceId) === (intel.seoContext.brandVoice ?? '') },
            { name: 'businessContext', match: (result.businessContext ?? '') === (intel.seoContext.businessContext ?? '') },
            // Both are raw knowledge (no "BUSINESS KNOWLEDGE BASE" header)
            { name: 'knowledgeBase', match: getRawKnowledge(workspaceId) === (intel.seoContext.knowledgeBase ?? '') },
            // Personas: old path is prose string, new is structured array — compare presence as proxy
            { name: 'personas', match: (result.personasBlock ? 'present' : 'empty') === ((intel.seoContext.personas?.length ?? 0) > 0 ? 'present' : 'empty') },
          ];
          const mismatches = comparisonFields.filter(f => !f.match).map(f => f.name);
          if (mismatches.length > 0) {
            log.warn({ workspaceId, mismatches, totalFields: comparisonFields.length }, 'Intelligence shadow-mode mismatch detected');
          } else {
            log.debug({ workspaceId, totalFields: comparisonFields.length }, 'Intelligence shadow-mode: all 5 fields match');
          }
        }
      } catch (err) {
        log.warn({ workspaceId, err }, 'Intelligence shadow-mode comparison failed');
      }
    })();
  }

  return result;
}

/**
 * Read .txt and .md files from a workspace's brand-docs/ folder.
 * Returns concatenated content (truncated to ~4000 chars to fit in prompts).
 */
function readBrandDocs(workspaceFolder: string): string {
  const brandDir = path.join(getUploadRoot(), workspaceFolder, 'brand-docs');

  if (!fs.existsSync(brandDir)) return '';

  try {
    const files = fs.readdirSync(brandDir).filter(f => /\.(txt|md)$/i.test(f)).sort();
    if (files.length === 0) return '';

    let content = '';
    for (const file of files) {
      const text = fs.readFileSync(path.join(brandDir, file), 'utf-8').trim();
      if (text) {
        content += `--- ${file} ---\n${text}\n\n`;
      }
      if (content.length > 4000) break;
    }
    return content.slice(0, 4000);
  } catch {
    return '';
  }
}

/**
 * Get raw brand voice content for a workspace (inline + brand-docs/ files, no header).
 * Use this when you need the raw text — e.g. for intelligence slice storage that adds its own header.
 */
export function getRawBrandVoice(workspaceId: string): string {
  const ws = getWorkspace(workspaceId);
  if (!ws) return '';
  const voiceParts: string[] = [];
  if (ws.brandVoice) voiceParts.push(ws.brandVoice);
  const brandDocsContent = readBrandDocs(ws.folder);
  if (brandDocsContent) voiceParts.push(brandDocsContent);
  return voiceParts.join('\n\n');
}

/**
 * Get raw knowledge content for a workspace (inline + knowledge-docs/ files, no header).
 * Use this when you need the raw text — e.g. for schema generation prompts that add their own header.
 */
export function getRawKnowledge(workspaceId: string): string {
  const ws = getWorkspace(workspaceId);
  if (!ws) return '';

  const parts: string[] = [];
  if (ws.knowledgeBase?.trim()) parts.push(ws.knowledgeBase.trim());
  const docsContent = readKnowledgeDocs(ws.folder);
  if (docsContent) parts.push(docsContent);
  return parts.join('\n\n');
}

/**
 * Build a global knowledge base block for AI chatbot prompts.
 * Combines the workspace's knowledgeBase field + any .txt/.md files in knowledge-docs/.
 */
export function buildKnowledgeBase(workspaceId?: string): string {
  if (!workspaceId) return '';
  const raw = getRawKnowledge(workspaceId);
  if (!raw) return '';
  return `\n\nBUSINESS KNOWLEDGE BASE (use this to give informed, business-aware answers):\n${raw}`;
}

/**
 * Read .txt and .md files from a workspace's knowledge-docs/ folder.
 */
function readKnowledgeDocs(workspaceFolder: string): string {
  const docsDir = path.join(getUploadRoot(), workspaceFolder, 'knowledge-docs');
  if (!fs.existsSync(docsDir)) return '';

  try {
    const files = fs.readdirSync(docsDir).filter(f => /\.(txt|md)$/i.test(f)).sort();
    if (files.length === 0) return '';

    let content = '';
    for (const file of files) {
      const text = fs.readFileSync(path.join(docsDir, file), 'utf-8').trim();
      if (text) {
        content += `--- ${file} ---\n${text}\n\n`;
      }
      if (content.length > 6000) break;
    }
    return content.slice(0, 6000);
  } catch {
    return '';
  }
}

/**
 * Shared instruction block for AI chat prompts — teaches the model to emit
 * rich fenced code blocks that the frontend renders as interactive components.
 */
export const RICH_BLOCKS_PROMPT = `
RICH RESPONSE BLOCKS — You can embed interactive visualizations in your responses using special fenced code blocks. Use them when they make data clearer, but don't force them — plain markdown is fine for simple answers.

\`\`\`metric
(single or array) {"label":"Total Clicks","value":1234,"change":12.5,"changeLabel":"vs last period","format":"number"}
Formats: "number" (default), "percent", "currency". "change" is a % delta (positive = green, negative = red).
For multiple metrics side by side, use an array: [{"label":"Clicks","value":1234},{"label":"CTR","value":3.2,"format":"percent"}]
\`\`\`

\`\`\`chart
{"type":"bar","title":"Top Pages by Clicks","data":[{"label":"/homepage","value":450},{"label":"/about","value":320}]}
Horizontal bar chart. Keep to 3-8 items. Use "valueFormat":"percent" if showing percentages.
\`\`\`

\`\`\`datatable
{"title":"Keyword Performance","headers":["Keyword","Clicks","Impressions","CTR"],"rows":[["seo agency",120,3400,"3.5%"],["web design",85,2100,"4.0%"]],"footer":"Showing top 5 of 48 keywords"}
Table with copy-to-CSV and download buttons. Use for detailed comparisons. Keep rows ≤ 10.
\`\`\`

RULES FOR RICH BLOCKS:
- The JSON must be valid and on a single logical block (newlines are fine inside the fenced block)
- Use rich blocks for: metric summaries, top-N comparisons, detailed breakdowns
- Do NOT use rich blocks for: simple yes/no answers, short explanations, or when you only have 1-2 data points
- You can mix rich blocks with normal markdown in the same response
- Always provide text context around blocks explaining what the data means
`;

/**
 * Build an audience personas block for AI prompts.
 * Returns structured persona data including pain points, goals, and objections.
 */
export function buildPersonasContext(workspaceId?: string): string {
  if (!workspaceId) return '';
  const ws = getWorkspace(workspaceId);
  if (!ws?.personas?.length) return '';

  const personaStr = ws.personas.map(p => {
    const parts = [`**${p.name}**${p.buyingStage ? ` (${p.buyingStage} stage)` : ''}: ${p.description}`];
    if (p.painPoints.length) parts.push(`  Pain points: ${p.painPoints.join('; ')}`);
    if (p.goals.length) parts.push(`  Goals: ${p.goals.join('; ')}`);
    if (p.objections.length) parts.push(`  Objections: ${p.objections.join('; ')}`);
    if (p.preferredContentFormat) parts.push(`  Prefers: ${p.preferredContentFormat}`);
    return parts.join('\n');
  }).join('\n\n');

  return `\n\nTARGET AUDIENCE PERSONAS (write to address these specific people — their pain points, goals, and objections):\n${personaStr}`;
}

/**
 * Build a page-specific analysis context block for AI rewrite prompts.
 * Pulls persisted optimizationIssues + recommendations from the keyword strategy pageMap.
 * This ensures AI rewrites address the platform's own recommendations.
 */
export function buildPageAnalysisContext(workspaceId?: string, pagePath?: string): string {
  if (!workspaceId || !pagePath) return '';

  const entry = getPageKeyword(workspaceId, pagePath);
  if (!entry) return '';

  const parts: string[] = [];

  // Core analysis data (original)
  if (entry.optimizationIssues?.length) {
    parts.push(`ISSUES IDENTIFIED:\n${entry.optimizationIssues.map(i => `- ${i}`).join('\n')}`);
  }
  if (entry.recommendations?.length) {
    parts.push(`RECOMMENDATIONS:\n${entry.recommendations.map(r => `- ${r}`).join('\n')}`);
  }
  if (entry.contentGaps?.length) {
    parts.push(`CONTENT GAPS:\n${entry.contentGaps.map(g => `- ${g}`).join('\n')}`);
  }

  // Extended analysis data (enriches AI prompt quality)
  if (entry.optimizationScore) {
    parts.push(`OPTIMIZATION SCORE: ${entry.optimizationScore}/100`);
  }
  if (entry.primaryKeywordPresence) {
    const p = entry.primaryKeywordPresence;
    const missing = (['inTitle', 'inMeta', 'inContent', 'inSlug'] as const)
      .filter(k => !p[k])
      .map(k => ({ inTitle: 'title tag', inMeta: 'meta description', inContent: 'page content', inSlug: 'URL slug' }[k]));
    if (missing.length > 0) {
      parts.push(`PRIMARY KEYWORD MISSING FROM: ${missing.join(', ')}`);
    }
  }
  if (entry.competitorKeywords?.length) {
    parts.push(`COMPETITOR KEYWORDS TO CONSIDER: ${entry.competitorKeywords.join(', ')}`);
  }
  if (entry.topicCluster) {
    parts.push(`TOPIC CLUSTER: ${entry.topicCluster}`);
  }
  if (entry.estimatedDifficulty) {
    parts.push(`ESTIMATED DIFFICULTY: ${entry.estimatedDifficulty}`);
  }

  if (parts.length === 0) return '';

  return `\n\nPAGE ANALYSIS (address these issues in your rewrite — this is what our platform flagged for this page):\n${parts.join('\n')}`;
}

/**
 * Build a full keyword map string for prompts that need cross-page awareness
 * (e.g., internal links, content briefs to avoid cannibalization).
 */
export function buildKeywordMapContext(workspaceId?: string): string {
  if (!workspaceId) return '';
  const pageMap = listPageKeywords(workspaceId);
  if (!pageMap.length) return '';

  const mapStr = pageMap.map(
    p => `${p.pagePath}: "${p.primaryKeyword}"${p.secondaryKeywords?.length ? ` (also: ${p.secondaryKeywords.slice(0, 3).join(', ')})` : ''}`
  ).join('\n');

  return `\n\nEXISTING KEYWORD MAP (avoid cannibalization, suggest internal links where relevant):\n${mapStr}`;
}

/**
 * Build a brand narrative block from the workspace's active brandscript.
 * Uses the most recently created brandscript. Returns '' if none exists or no sections have content.
 */
export function buildBrandscriptContext(workspaceId: string, emphasis: ContextEmphasis = 'full'): string {
  const scripts = listBrandscripts(workspaceId);
  if (scripts.length === 0) return '';

  const bs = scripts[0]; // Use most recent
  const filledSections = bs.sections.filter(sec => sec.content?.trim());

  if (filledSections.length === 0) return '';

  if (emphasis === 'minimal') {
    const first = filledSections[0];
    return `\n\nBRAND NARRATIVE (${bs.frameworkType}): ${first.title} — ${first.content?.slice(0, 200)}...`;
  }

  const sections = (emphasis === 'summary' ? filledSections.slice(0, 3) : filledSections)
    .map(sec => `  ${sec.title}: ${sec.content}`)
    .join('\n');

  return `\n\nBRAND NARRATIVE (${bs.frameworkType} framework):\n${sections}`;
}

/**
 * Build a voice profile block for AI prompts from the workspace's calibrated voice profile.
 * Includes voice DNA, sample writing, and guardrails. Returns '' if no profile exists.
 *
 * Guards on `profile.status === 'calibrated'`: when calibrated, buildSystemPrompt's
 * Layer 2 already injects DNA + guardrails into the system message. Re-injecting them
 * here would duplicate instructions and waste tokens.
 * When calibrated: returns only voice samples (safe at any status).
 * When not calibrated: returns the full DNA + samples + guardrails block.
 */
export function buildVoiceProfileContext(workspaceId: string, emphasis: ContextEmphasis = 'full'): string {
  const profile = getVoiceProfile(workspaceId);
  if (!profile) return '';

  const isCalibrated = profile.status === 'calibrated';
  const parts: string[] = [];

  // Only inject DNA when not calibrated — Layer 2 handles it when calibrated
  if (!isCalibrated && profile.voiceDNA) {
    parts.push(`VOICE DNA:`);
    parts.push(`  Personality: ${profile.voiceDNA.personalityTraits.join('. ')}`);
    parts.push(`  Tone: formal↔casual ${profile.voiceDNA.toneSpectrum.formal_casual}/10, serious↔playful ${profile.voiceDNA.toneSpectrum.serious_playful}/10, technical↔accessible ${profile.voiceDNA.toneSpectrum.technical_accessible}/10`);
    parts.push(`  Sentence style: ${profile.voiceDNA.sentenceStyle}`);
    parts.push(`  Humor: ${profile.voiceDNA.humorStyle}`);
  }

  // Voice samples are safe to include at any status
  if (profile.samples.length > 0) {
    parts.push(`\nVOICE SAMPLES (write like these):`);
    for (const sample of profile.samples.slice(0, 5)) {
      parts.push(`  [${sample.contextTag || 'general'}] "${sample.content}"`);
    }
  }

  // Only inject guardrails when not calibrated — Layer 2 handles it when calibrated
  if (!isCalibrated && profile.guardrails) {
    parts.push(`\nGUARDRAILS:`);
    if (profile.guardrails.forbiddenWords.length) parts.push(`  Never use: ${profile.guardrails.forbiddenWords.join(', ')}`);
    if (profile.guardrails.requiredTerminology.length) parts.push(`  Required: ${profile.guardrails.requiredTerminology.map(t => `"${t.use}" not "${t.insteadOf}"`).join(', ')}`);
    if (profile.guardrails.toneBoundaries.length) parts.push(`  Boundaries: ${profile.guardrails.toneBoundaries.join('. ')}`);
  }

  if (parts.length === 0) return '';
  return `\n\nBRAND VOICE PROFILE (you MUST match this voice — do not deviate):\n${parts.join('\n')}`;
}

/**
 * Build a brand identity block for AI prompts from approved brand identity deliverables.
 * Only includes deliverables with status 'approved'. Returns '' if none exist.
 */
export function buildIdentityContext(workspaceId: string, emphasis: ContextEmphasis = 'full'): string {
  const deliverables = listDeliverables(workspaceId).filter(d => d.status === 'approved');
  if (deliverables.length === 0) return '';

  if (emphasis === 'minimal') {
    const mission = deliverables.find(d => d.deliverableType === 'mission');
    return mission ? `\n\nBRAND MISSION: ${mission.content.slice(0, 200)}` : '';
  }

  const selected = emphasis === 'summary'
    ? deliverables.filter(d => ['mission', 'messaging_pillars', 'tagline'].includes(d.deliverableType))
    : deliverables;

  const parts: string[] = [];
  for (const d of selected) {
    parts.push(`  ${d.deliverableType.replace(/_/g, ' ').toUpperCase()}: ${d.content.slice(0, 500)}`);
  }

  if (parts.length === 0) return '';
  return `\n\nBRAND IDENTITY (approved deliverables):\n${parts.join('\n')}`;
}

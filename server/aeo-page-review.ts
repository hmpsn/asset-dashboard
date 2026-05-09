/**
 * AEO Page Review — AI-powered per-page content change recommendations
 *
 * Takes a page's HTML + AEO audit issues + workspace knowledge base and generates
 * specific, actionable content change recommendations (copy rewrites, section
 * additions, structural changes, citation suggestions).
 *
 * Admin-first: recommendations are shown to the agency team, who decide what
 * to send to the client or action themselves.
 */

import { callAI } from './ai.js';
import { buildWorkspaceIntelligence, formatKeywordsForPrompt, formatKnowledgeBaseForPrompt, formatPersonasForPrompt } from './workspace-intelligence.js';
import type { SeoIssue } from './seo-audit.js';
import { createLogger } from './logger.js';
import { decodeEntities, stripHtmlToText, stripCodeFences } from './helpers.js';
import { z } from './middleware/validate.js';
import type { AeoEffort, AeoPageReview, AeoSiteReview } from '../shared/types/aeo.js';
import {
  AEO_CHANGE_TYPES,
  AEO_EFFORTS,
  countAeoQuickWins,
  estimateAeoChangesMinutes,
} from '../shared/types/aeo.js';

const log = createLogger('aeo-review');

// ─── Page Content Extraction ──────────────────────────────────────

function extractPageStructure(html: string): string {
  // Extract a structured overview of the page for the AI prompt
  const parts: string[] = [];

  // Title
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  if (title) parts.push(`PAGE TITLE: ${decodeEntities(title)}`);

  // H1
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '').trim();
  if (h1) parts.push(`H1: ${h1}`);

  // Extract all headings with hierarchy
  const headings: string[] = [];
  const headingRegex = /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = headingRegex.exec(html)) !== null) {
    const level = match[1].toUpperCase();
    const text = match[2].replace(/<[^>]+>/g, '').trim();
    if (text) headings.push(`${level}: ${text}`);
  }
  if (headings.length > 0) parts.push(`\nPAGE STRUCTURE (headings):\n${headings.join('\n')}`);

  // Extract visible body text (first ~4000 chars for prompt budget)
  const bodyText = stripHtmlToText(html, { stripHeader: true });
  parts.push(`\nPAGE CONTENT (first ~4000 chars):\n${bodyText.slice(0, 4000)}`);

  // Detect existing schema types
  const schemaTypes: string[] = [];
  const ldBlocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of ldBlocks) {
    const json = block.replace(/<\/?script[^>]*>/gi, '').trim();
    try {
      const parsed = JSON.parse(json);
      if (parsed['@type']) schemaTypes.push(parsed['@type']);
      if (parsed['@graph']) {
        for (const node of parsed['@graph']) {
          if (node['@type']) schemaTypes.push(node['@type']);
        }
      }
    } catch { /* skip malformed JSON-LD */ }
  }
  if (schemaTypes.length > 0) parts.push(`\nEXISTING SCHEMA TYPES: ${schemaTypes.join(', ')}`);

  // Detect intro paragraph (first substantive text after H1)
  const afterH1 = html.match(/<\/h1>([\s\S]{100,1000}?)(?:<h[2-6]|$)/i);
  if (afterH1) {
    const intro = afterH1[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    parts.push(`\nINTRO PARAGRAPH (after H1):\n"${intro.slice(0, 500)}"`);
  }

  // Count external links
  const extLinks = (html.match(/<a[^>]*href=["']https?:\/\/[^"']*["'][^>]*>/gi) || []).length;
  parts.push(`\nEXTERNAL LINKS COUNT: ${extLinks}`);

  return parts.join('\n');
}

function formatAuditIssues(issues: SeoIssue[]): string {
  const aeoIssues = issues.filter(i => i.check.startsWith('aeo-'));
  if (aeoIssues.length === 0) return 'No AEO issues detected on this page.';
  return aeoIssues.map(i => `- [${i.severity.toUpperCase()}] ${i.check}: ${i.message}\n  Recommendation: ${i.recommendation}`).join('\n');
}

const normalizeAeoEffort = (value: unknown): AeoEffort => {
  if (typeof value !== 'string') return 'moderate';
  const normalized = value.toLowerCase().trim();
  if (normalized.startsWith('quick')) return 'quick';
  if (normalized.startsWith('significant')) return 'significant';
  if (normalized.startsWith('moderate')) return 'moderate';
  return 'moderate';
};

const aeoPageChangeSchema = z.object({
  id: z.string().optional(),
  changeType: z.enum(AEO_CHANGE_TYPES).catch('copy_edit'),
  location: z.string().catch('Page content'),
  currentContent: z.string().optional(),
  suggestedChange: z.string().catch('Review this page section and update the copy for clearer answer-engine readability.'),
  rationale: z.string().catch('Improves answer-engine readability.'),
  effort: z.preprocess(normalizeAeoEffort, z.enum(AEO_EFFORTS)),
  priority: z.enum(['high', 'medium', 'low']).catch('medium'),
  aeoImpact: z.string().catch('Improves the page structure for AI answer extraction.'),
  verifiedSourceEvidence: z.string().optional(),
  requiresSourceResearch: z.boolean().optional(),
});

const aeoReviewSchema = z.object({
  overallScore: z.number().min(0).max(100).catch(0),
  summary: z.string().catch('AEO review completed.'),
  changes: z.array(aeoPageChangeSchema).catch([]),
  quickWinCount: z.number().int().min(0).optional(),
  estimatedTimeMinutes: z.number().int().min(0).optional(),
});

export function normalizeAeoReviewResponse(raw: unknown): Pick<AeoPageReview, 'overallScore' | 'summary' | 'changes' | 'quickWinCount' | 'estimatedTimeMinutes'> {
  const parsed = aeoReviewSchema.parse(raw);
  const changes = parsed.changes.map((change, i) => {
    const verifiedSourceEvidence = change.verifiedSourceEvidence?.trim();
    const requiresSourceResearch =
      change.changeType === 'add_citations' && !verifiedSourceEvidence
        ? true
        : change.requiresSourceResearch === true;
    return {
      ...change,
      id: change.id || `change-${i}`,
      verifiedSourceEvidence: verifiedSourceEvidence || undefined,
      requiresSourceResearch,
      suggestedChange: requiresSourceResearch
        ? `Research needed before client handoff: verify authoritative source evidence for this citation recommendation. ${change.suggestedChange}`
        : change.suggestedChange,
    };
  });

  return {
    overallScore: parsed.overallScore,
    summary: parsed.summary,
    changes,
    quickWinCount: parsed.quickWinCount ?? countAeoQuickWins(changes),
    estimatedTimeMinutes: parsed.estimatedTimeMinutes ?? estimateAeoChangesMinutes(changes),
  };
}

// ─── Single Page Review ───────────────────────────────────────────

export async function reviewPage(
  pageUrl: string,
  pageTitle: string,
  html: string,
  auditIssues: SeoIssue[],
  workspaceId: string,
): Promise<AeoPageReview> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error('OPENAI_API_KEY not configured');

  const pageStructure = extractPageStructure(html);
  const issueBlock = formatAuditIssues(auditIssues);
  const intel = await buildWorkspaceIntelligence(workspaceId, { slices: ['seoContext'] });
  const seo = intel.seoContext;
  const keywordBlock = formatKeywordsForPrompt(seo);
  // Voice authority: effectiveBrandVoiceBlock already honors voice profile → legacy fallback
  const brandVoiceBlock = seo?.effectiveBrandVoiceBlock ?? '';
  const businessContext = seo?.businessContext ?? '';
  const knowledgeBlock = formatKnowledgeBaseForPrompt(seo?.knowledgeBase);
  const personasBlock = formatPersonasForPrompt(seo?.personas ?? []);

  const prompt = `You are an AEO (Answer Engine Optimization) expert reviewing an existing page for an agency team. Your job is to produce specific, actionable content change recommendations that will make this page more likely to be cited by AI answer engines (ChatGPT, Perplexity, Google AI Overviews, etc.).

This is an ADMIN review — be direct, technical, and specific. The agency team will decide what to send to the client.

PAGE URL: ${pageUrl}
PAGE TITLE: ${pageTitle}

${pageStructure}

AEO AUDIT ISSUES DETECTED:
${issueBlock}

${businessContext ? `BUSINESS CONTEXT: ${businessContext}` : ''}${keywordBlock}${brandVoiceBlock}${knowledgeBlock}${personasBlock}

Generate a JSON review with specific, implementable changes. Each change should tell the agency team EXACTLY what to do — not generic advice.

{
  "overallScore": 0-100 (AEO readiness: 0=invisible to AI, 100=perfectly optimized for AI citation),
  "summary": "2-3 sentence admin-facing summary: what's the biggest AEO opportunity on this page and what's the single highest-impact change",
  "changes": [
    {
      "id": "unique-id",
      "changeType": "rewrite_intro|add_author|add_date|add_section|add_citations|add_schema|add_faq|add_comparison|add_definition|restructure_content|remove_dark_pattern|copy_edit",
      "location": "Specific location on page (e.g., 'Below the H1', 'Section: Our Process', 'Page footer')",
      "currentContent": "Exact excerpt of what's currently there (if applicable, max 200 chars)",
      "suggestedChange": "SPECIFIC replacement text, new section content, or detailed instruction. For copy rewrites, write the actual replacement copy. For structural changes, describe the exact HTML/content change needed.",
      "rationale": "Why this matters for AEO specifically — how does this change affect AI citation likelihood?",
      "effort": "quick|moderate|significant",
      "priority": "high|medium|low",
      "aeoImpact": "Specific AEO benefit (e.g., 'Makes the direct answer extractable as a cited snippet by LLMs')",
      "verifiedSourceEvidence": "Exact evidence already present in the page content, knowledge base, business context, or audit issue that supports this recommendation. Empty string if no source evidence was provided.",
      "requiresSourceResearch": false
    }
  ],
  "quickWinCount": number of changes with effort="quick",
  "estimatedTimeMinutes": total estimated implementation time for all changes
}

RULES:
- Generate 3-10 changes depending on how many issues the page has
- For "rewrite_intro" changes: write the ACTUAL replacement intro paragraph (2-3 sentences that directly answer the page's implied question, then 3-5 key bullets)
- For "add_author" changes: if the knowledge base has staff info, suggest the specific person and their credentials. If not, describe what the byline should contain
- For "add_citations" changes: only name a specific organization, journal, .gov resource, statistic, or claim when the page content, knowledge base, business context, or audit issue already contains supporting evidence. Put that exact evidence in verifiedSourceEvidence and set requiresSourceResearch=false.
- If source evidence is not present in the provided context, do not invent a source. Set requiresSourceResearch=true and write suggestedChange as a research task for the agency team to verify authoritative sources before client handoff.
- For "add_definition" changes: write the actual definition block content (term, definition, common misconceptions, related terms)
- For "add_comparison" changes: specify the exact table columns, row headers, and what data types to include
- For "copy_edit" changes: provide the current text AND the replacement text
- Every suggestedChange should be concrete enough that a copywriter could implement it without further research
- Exception: source/citation recommendations without verifiedSourceEvidence must explicitly say research is required before implementation
- Priority should reflect AEO impact: "high" = directly affects whether AI systems cite this page, "medium" = improves trust signals, "low" = nice-to-have polish
- overallScore: 0-30 = critical AEO gaps, 30-60 = has basics but missing key signals, 60-80 = good but could improve, 80-100 = well-optimized for AI citation
- Be specific about WHICH section headings, paragraphs, or elements need to change — reference them by name from the page structure

Return ONLY valid JSON, no markdown fences, no explanation.`;

  const aiResult = await callAI({
    model: 'gpt-5.4',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 5000,
    temperature: 0.4,
    responseFormat: { type: 'json_object' },
    feature: 'aeo-review',
    workspaceId,
  });

  const raw = aiResult.text || '{}';
  let parsed: Record<string, unknown>;
  try {
    const cleaned = stripCodeFences(raw);
    parsed = JSON.parse(cleaned);
  } catch (err) {
    log.error({ err, detail: raw.slice(0, 200) }, 'Failed to parse AI response');
    throw new Error('Failed to parse AEO review response');
  }

  const normalized = normalizeAeoReviewResponse(parsed);

  return {
    pageUrl,
    pageTitle,
    reviewedAt: new Date().toISOString(),
    ...normalized,
  };
}

// ─── Batch Site Review ────────────────────────────────────────────

export async function reviewSitePages(
  workspaceId: string,
  pages: { url: string; title: string; html: string; issues: SeoIssue[] }[],
  onProgress?: (completed: number, total: number, current: AeoPageReview) => void,
  isCancelled?: () => boolean,
): Promise<AeoSiteReview> {
  const results: AeoPageReview[] = [];

  for (let i = 0; i < pages.length; i++) {
    if (isCancelled?.()) break;

    const page = pages[i];
    try {
      const review = await reviewPage(page.url, page.title, page.html, page.issues, workspaceId);
      results.push(review);
      onProgress?.(i + 1, pages.length, review);
    } catch (err) {
      log.error({ err: err }, `Failed to review ${page.url}:`);
      // Push a minimal error result so we don't lose progress
      results.push({
        pageUrl: page.url,
        pageTitle: page.title,
        reviewedAt: new Date().toISOString(),
        overallScore: 0,
        summary: `Review failed: ${err instanceof Error ? err.message : String(err)}`,
        changes: [],
        quickWinCount: 0,
        estimatedTimeMinutes: 0,
      });
      onProgress?.(i + 1, pages.length, results[results.length - 1]);
    }

    // Rate limit: 1.5s between pages to avoid hitting TPM limits
    if (i < pages.length - 1 && !isCancelled?.()) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  const totalChanges = results.reduce((s, r) => s + r.changes.length, 0);
  const quickWins = results.reduce((s, r) => s + r.quickWinCount, 0);

  return {
    workspaceId,
    generatedAt: new Date().toISOString(),
    pages: results,
    sitewideSummary: `Reviewed ${results.length} pages. Found ${totalChanges} recommended changes (${quickWins} quick wins). Average AEO score: ${results.length > 0 ? Math.round(results.reduce((s, r) => s + r.overallScore, 0) / results.length) : 0}/100.`,
    totalChanges,
    quickWins,
  };
}

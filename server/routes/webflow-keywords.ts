/**
 * AI keyword analysis & content scoring routes — extracted from webflow.ts
 */
import { Router } from 'express';
import { callOpenAI } from '../openai-helpers.js';
import { getConfiguredProvider } from '../seo-data-provider.js';
import { clearSeoContextCache } from '../seo-context.js';
import { getWorkspace } from '../workspaces.js';
import { getPageKeyword, upsertPageKeyword } from '../page-keywords.js';
import { createLogger } from '../logger.js';
import { parseJsonFallback } from '../db/json-validation.js';
import { debouncedPageAnalysisInvalidate, invalidateSubCachePrefix } from '../bridge-infrastructure.js';
import { buildWorkspaceIntelligence, formatForPrompt, formatPageMapForPrompt, invalidateIntelligenceCache } from '../workspace-intelligence.js';

const log = createLogger('webflow-keywords');

import { requireWorkspaceAccessFromQuery } from '../auth.js';
const router = Router();

// --- AI Keyword Analysis ---
router.post('/api/webflow/keyword-analysis', async (req, res) => {
  const { pageTitle, seoTitle, metaDescription, pageContent, slug, siteContext, workspaceId } = req.body;
  if (!pageTitle) return res.status(400).json({ error: 'pageTitle required' });

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  const intel = workspaceId ? await buildWorkspaceIntelligence(workspaceId, { slices: ['seoContext'], pagePath: slug ? `/${slug}` : undefined }) : null;
  const fullContext = intel ? formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] }) : '';
  // No pagePath filter — show full cross-page keyword map for cannibalization avoidance
  const kwMapContext = intel ? formatPageMapForPrompt(intel.seoContext) : '';

  // Fetch real keyword data for accuracy
  let semrushBlock = '';
  const kwWs = workspaceId ? getWorkspace(workspaceId) : null;
  const kwProvider = getConfiguredProvider(kwWs?.seoDataProvider);
  if (kwProvider && workspaceId) {
    try {
      const seedKeyword = seoTitle || pageTitle;
      const words = seedKeyword.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w: string) => w.length > 2);
      if (words.length > 0) {
        const phrase = words.slice(0, 5).join(' ');
        const [metrics, related] = await Promise.all([
          kwProvider.getKeywordMetrics([phrase], workspaceId).catch(() => []),
          kwProvider.getRelatedKeywords(phrase, workspaceId, 10).catch(() => []),
        ]);
        if (metrics.length > 0) {
          const m = metrics[0];
          semrushBlock += `\n\nREAL KEYWORD DATA (from SEMRush — use these exact values for difficulty and volume, do NOT estimate):\n`;
          semrushBlock += `- "${m.keyword}": vol ${m.volume.toLocaleString()}/mo, KD ${m.difficulty}/100, CPC $${m.cpc.toFixed(2)}, competition ${m.competition.toFixed(2)}`;
        }
        if (related.length > 0) {
          semrushBlock += `\n\nRELATED KEYWORDS WITH REAL METRICS:\n`;
          semrushBlock += related.slice(0, 10).map(r =>
            `- "${r.keyword}" (vol: ${r.volume.toLocaleString()}/mo, KD: ${r.difficulty}/100, CPC: $${r.cpc.toFixed(2)})`
          ).join('\n');
        }
      }
    } catch (e) { log.error({ err: e }, 'SEMRush enrichment error'); }
  }

  try {
    const prompt = `You are an expert SEO strategist and keyword researcher. Analyze this web page and provide a comprehensive keyword analysis.

Page title: ${pageTitle}
SEO title: ${seoTitle || '(same as page title)'}
Meta description: ${metaDescription || '(none)'}
URL slug: /${slug || ''}
Site context: ${siteContext || 'N/A'}
Page content excerpt: ${pageContent ? pageContent.slice(0, 3000) : 'N/A'}${fullContext}${kwMapContext}${semrushBlock}

Provide your analysis as a JSON object with exactly these fields:
{
  "primaryKeyword": "the single best target keyword for this page",
  "primaryKeywordPresence": { "inTitle": true/false, "inMeta": true/false, "inContent": true/false, "inSlug": true/false },
  "secondaryKeywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "longTailKeywords": ["long tail phrase 1", "long tail phrase 2", "long tail phrase 3"],
  "searchIntent": "informational | transactional | navigational | commercial",
  "searchIntentConfidence": 0.0-1.0,
  "contentGaps": ["topic or angle the page should cover but doesn't"],
  "competitorKeywords": ["keywords competitors likely target for similar pages"],
  "optimizationScore": 0-100,
  "optimizationIssues": ["specific actionable issues with keyword optimization"],
  "recommendations": ["specific actionable recommendation 1", "recommendation 2", "recommendation 3"],
  "estimatedDifficulty": "low | medium | high",
  "keywordDifficulty": 0-100,
  "monthlyVolume": 0,
  "topicCluster": "the broader topic cluster this page belongs to"
}

IMPORTANT:
- If real keyword data from SEMRush is provided above, use those EXACT numbers for keywordDifficulty and monthlyVolume. Do NOT make up different values.
- estimatedDifficulty should be derived from keywordDifficulty: 0-30 = low, 31-60 = medium, 61-100 = high
- If no real data is available, set keywordDifficulty and monthlyVolume to 0 and estimate based on content analysis

Return ONLY valid JSON, no markdown, no explanation.`;

    const aiResult = await callOpenAI({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1000,
      temperature: 0.4,
      feature: 'keyword-analysis',
      workspaceId,
    });

    const cleaned = aiResult.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const analysis = parseJsonFallback(cleaned, null);
    if (analysis) {
      res.json(analysis);
    } else {
      res.json({ error: 'Failed to parse AI response', raw: aiResult.text.slice(0, 500) });
    }
  } catch (err) {
    log.error({ err: err }, 'Keyword analysis error');
    res.status(500).json({ error: 'Keyword analysis failed' });
  }
});

// --- Persist Page Analysis to Keyword Strategy ---
router.post('/api/webflow/keyword-analysis/persist', requireWorkspaceAccessFromQuery(), async (req, res) => {
  const { workspaceId, pagePath, analysis } = req.body as {
    workspaceId: string;
    pagePath: string;
    analysis: {
      primaryKeyword?: string;
      secondaryKeywords?: string[];
      searchIntent?: string;
      optimizationIssues?: string[];
      recommendations?: string[];
      contentGaps?: string[];
      optimizationScore?: number;
      primaryKeywordPresence?: { inTitle: boolean; inMeta: boolean; inContent: boolean; inSlug: boolean };
      longTailKeywords?: string[];
      competitorKeywords?: string[];
      estimatedDifficulty?: string;
      keywordDifficulty?: number;
      monthlyVolume?: number;
      topicCluster?: string;
      searchIntentConfidence?: number;
    };
  };

  if (!workspaceId || !pagePath || !analysis) {
    return res.status(400).json({ error: 'workspaceId, pagePath, and analysis are required' });
  }

  try {
    const ws = getWorkspace(workspaceId);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    const normalized = pagePath.startsWith('/') ? pagePath : `/${pagePath}`;
    const now = new Date().toISOString();

    // Merge with existing entry (preserves GSC/SEMRush enrichment and keyword assignments)
    const existing = getPageKeyword(workspaceId, normalized);
    upsertPageKeyword(workspaceId, {
      pagePath: normalized,
      pageTitle: existing?.pageTitle || '',
      primaryKeyword: analysis.primaryKeyword || existing?.primaryKeyword || '',
      secondaryKeywords: analysis.secondaryKeywords?.length ? analysis.secondaryKeywords : existing?.secondaryKeywords || [],
      searchIntent: analysis.searchIntent || existing?.searchIntent,
      optimizationIssues: analysis.optimizationIssues || [],
      recommendations: analysis.recommendations || [],
      contentGaps: analysis.contentGaps || [],
      optimizationScore: analysis.optimizationScore,
      analysisGeneratedAt: now,
      primaryKeywordPresence: analysis.primaryKeywordPresence,
      longTailKeywords: analysis.longTailKeywords || [],
      competitorKeywords: analysis.competitorKeywords || [],
      estimatedDifficulty: analysis.estimatedDifficulty,
      keywordDifficulty: analysis.keywordDifficulty,
      monthlyVolume: analysis.monthlyVolume,
      topicCluster: analysis.topicCluster,
      searchIntentConfidence: analysis.searchIntentConfidence,
      // Preserve enrichment fields from existing entry
      ...(existing?.currentPosition != null ? { currentPosition: existing.currentPosition } : {}),
      ...(existing?.impressions != null ? { impressions: existing.impressions } : {}),
      ...(existing?.clicks != null ? { clicks: existing.clicks } : {}),
      ...(existing?.gscKeywords ? { gscKeywords: existing.gscKeywords } : {}),
      ...(existing?.volume != null ? { volume: existing.volume } : {}),
      ...(existing?.difficulty != null ? { difficulty: existing.difficulty } : {}),
    });
    log.info({ workspaceId, pagePath: normalized }, 'Page analysis persisted');
    // Bridge #5: page analysis complete — clear caches
    debouncedPageAnalysisInvalidate(workspaceId, () => {
      clearSeoContextCache(workspaceId);
      invalidateIntelligenceCache(workspaceId);
      invalidateSubCachePrefix(workspaceId, 'slice:seoContext');
      invalidateSubCachePrefix(workspaceId, 'slice:pageProfile');
    });
    res.json({ success: true, pagePath: normalized, hasAnalysis: true });
  } catch (err) {
    log.error({ err }, 'Failed to persist page analysis');
    res.status(500).json({ error: 'Failed to persist page analysis' });
  }
});

// --- AI Content Score ---
router.post('/api/webflow/content-score', async (req, res) => {
  const { pageContent, pageTitle, seoTitle, metaDescription } = req.body;
  if (!pageContent && !pageTitle) return res.status(400).json({ error: 'pageContent or pageTitle required' });

  try {
    const text = (pageContent || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const sentences = text.split(/[.!?]+/).filter((s: string) => s.trim().length > 5);
    const words = text.split(/\s+/).filter((w: string) => w.length > 0);
    const syllables = words.reduce((sum: number, w: string) => {
      const s = w.toLowerCase().replace(/[^a-z]/g, '');
      const count = s.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').match(/[aeiouy]{1,2}/g);
      return sum + Math.max(1, count ? count.length : 1);
    }, 0);

    const avgWordsPerSentence = sentences.length > 0 ? words.length / sentences.length : 0;
    const avgSyllablesPerWord = words.length > 0 ? syllables / words.length : 0;
    const fleschKincaid = sentences.length > 0
      ? Math.max(0, Math.min(100, 206.835 - 1.015 * avgWordsPerSentence - 84.6 * avgSyllablesPerWord))
      : 0;

    const headings = (pageContent || '').match(/<h[1-6][^>]*>.*?<\/h[1-6]>/gi) || [];
    const h1Count = headings.filter((h: string) => h.startsWith('<h1')).length;
    const h2Count = headings.filter((h: string) => h.startsWith('<h2')).length;
    const headingTexts = headings.map((h: string) => h.replace(/<[^>]+>/g, '').trim());

    const stopWords = new Set(['the','a','an','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','shall','can','to','of','in','for','on','with','at','by','from','as','into','through','during','before','after','above','below','between','out','off','over','under','again','further','then','once','here','there','when','where','why','how','all','both','each','few','more','most','other','some','such','no','nor','not','only','own','same','so','than','too','very','and','but','or','if','this','that','these','those','it','its','i','we','you','they','them','their','my','your','our','his','her','what','which','who','whom']);
    const wordFreq: Record<string, number> = {};
    words.forEach((w: string) => {
      const lower = w.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (lower.length > 2 && !stopWords.has(lower)) {
        wordFreq[lower] = (wordFreq[lower] || 0) + 1;
      }
    });
    const topKeywords = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([word, count]) => ({ word, count, density: +(count / words.length * 100).toFixed(2) }));

    const titleLength = (seoTitle || pageTitle || '').length;
    const descLength = (metaDescription || '').length;

    res.json({
      wordCount: words.length,
      sentenceCount: sentences.length,
      avgWordsPerSentence: +avgWordsPerSentence.toFixed(1),
      readabilityScore: +fleschKincaid.toFixed(1),
      readabilityGrade: fleschKincaid >= 60 ? 'Easy' : fleschKincaid >= 30 ? 'Moderate' : 'Difficult',
      headings: { total: headings.length, h1: h1Count, h2: h2Count, texts: headingTexts },
      topKeywords,
      titleLength,
      descLength,
      titleOk: titleLength >= 30 && titleLength <= 60,
      descOk: descLength >= 120 && descLength <= 160,
    });
  } catch (err) {
    log.error({ err: err }, 'Content score error');
    res.status(500).json({ error: 'Content scoring failed' });
  }
});

export default router;

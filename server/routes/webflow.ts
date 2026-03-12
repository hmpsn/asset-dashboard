/**
 * webflow routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import fs from 'fs';
import path from 'path';
import { addActivity } from '../activity-log.js';
import { generateAltText } from '../alttext.js';
import { callOpenAI } from '../openai-helpers.js';
import { savePageWeight, getPageWeight } from '../performance-store.js';
import { getQueue, getMetadata } from '../processor.js';
import { isSemrushConfigured, getKeywordOverview, getRelatedKeywords } from '../semrush.js';
import { buildSeoContext, buildKeywordMapContext } from '../seo-context.js';
import {
  listSites,
  listAssets,
  updateAsset,
  deleteAsset,
  scanAssetUsage,
  listCollections,
  getCollectionSchema,
  listCollectionItems,
  updateCollectionItem,
  publishCollectionItems,
  listPages,
  filterPublishedPages,
  getPageDom,
  updatePageSeo,
  publishSite,
  uploadAsset,
  listAssetFolders,
  createAssetFolder,
  moveAssetToFolder,
  getSiteSubdomain,
  discoverSitemapUrls,
} from '../webflow.js';
import {
  listWorkspaces,
  getWorkspace,
  getTokenForSite,
  updatePageState,
} from '../workspaces.js';

// Processing queue
router.get('/api/queue', (_req, res) => {
  res.json(getQueue());
});

// Webflow sites
router.get('/api/webflow/sites', async (req, res) => {
  try {
    const tokenParam = req.query.token as string | undefined;
    const sites = await listSites(tokenParam || undefined);
    res.json(sites);
  } catch {
    res.json([]);
  }
});

// --- Asset Browser ---
router.get('/api/webflow/assets/:siteId', async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId);
    const assets = await listAssets(req.params.siteId, token || undefined);
    res.json(assets);
  } catch {
    res.status(500).json({ error: 'Failed to list assets' });
  }
});

router.patch('/api/webflow/assets/:assetId', async (req, res) => {
  const { altText, displayName, siteId } = req.body;
  const token = siteId ? getTokenForSite(siteId) : null;
  const result = await updateAsset(req.params.assetId, { altText, displayName }, token || undefined);
  res.json(result);
});

router.delete('/api/webflow/assets/:assetId', async (req, res) => {
  const siteId = req.query.siteId as string;
  const token = siteId ? getTokenForSite(siteId) : null;
  const result = await deleteAsset(req.params.assetId, token || undefined);
  res.json(result);
});

// Bulk update alt text
router.post('/api/webflow/assets/bulk-alt', async (req, res) => {
  const { updates, siteId } = req.body as { updates: Array<{ assetId: string; altText: string }>; siteId?: string };
  const token = siteId ? getTokenForSite(siteId) : null;
  const results = [];
  for (const u of updates) {
    const r = await updateAsset(u.assetId, { altText: u.altText }, token || undefined);
    results.push({ assetId: u.assetId, ...r });
  }
  res.json(results);
});

// Bulk delete assets
router.post('/api/webflow/assets/bulk-delete', async (req, res) => {
  const { assetIds, siteId } = req.body as { assetIds: string[]; siteId?: string };
  const token = siteId ? getTokenForSite(siteId) : null;
  const results = [];
  for (const id of assetIds) {
    const r = await deleteAsset(id, token || undefined);
    results.push({ assetId: id, ...r });
  }
  res.json(results);
});

// --- Asset Audit ---
router.get('/api/webflow/audit/:siteId', async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const [assets, usageMap] = await Promise.all([
      listAssets(req.params.siteId, token),
      scanAssetUsage(req.params.siteId, token),
    ]);

    const issues: Array<{
      assetId: string;
      fileName: string;
      url?: string;
      fileSize: number;
      issues: string[];
      usedIn: string[];
    }> = [];

    // Pre-compute duplicate detection: group by file size
    const sizeGroups = new Map<number, typeof assets>();
    for (const asset of assets) {
      if (asset.size > 0) {
        const group = sizeGroups.get(asset.size) || [];
        group.push(asset);
        sizeGroups.set(asset.size, group);
      }
    }
    const duplicateIds = new Set<string>();
    for (const group of sizeGroups.values()) {
      if (group.length < 2) continue;
      // Same size — check for similar names (strip extension + normalize)
      const normalize = (n: string) => (n || '').replace(/\.[^.]+$/, '').replace(/[-_\s]+/g, '').toLowerCase();
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = normalize(group[i].displayName || group[i].originalFileName || '');
          const b = normalize(group[j].displayName || group[j].originalFileName || '');
          if (a === b || group[i].size === group[j].size) {
            duplicateIds.add(group[i].id);
            duplicateIds.add(group[j].id);
          }
        }
      }
    }

    // Pre-compute alt text quality: collect all alt texts to find duplicates
    const altTextCounts = new Map<string, number>();
    for (const asset of assets) {
      const alt = (asset.altText || '').trim().toLowerCase();
      if (alt) altTextCounts.set(alt, (altTextCounts.get(alt) || 0) + 1);
    }

    for (const asset of assets) {
      const assetIssues: string[] = [];
      const name = asset.displayName || asset.originalFileName || '';
      const ext = name.split('.').pop()?.toLowerCase();
      const alt = (asset.altText || '').trim();

      // Check for missing alt text
      if (!alt) {
        assetIssues.push('missing-alt');
      } else {
        // Alt text quality checks
        const altLower = alt.toLowerCase();
        const nameBase = name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').toLowerCase();
        if (alt.length < 10) {
          assetIssues.push('low-quality-alt');
        } else if (altLower.startsWith('image of') || altLower.startsWith('an image of') || altLower.startsWith('photo of')) {
          assetIssues.push('low-quality-alt');
        } else if (altLower === nameBase || altLower.replace(/\s+/g, '') === nameBase.replace(/\s+/g, '')) {
          assetIssues.push('low-quality-alt');
        } else if ((altTextCounts.get(altLower) || 0) > 1) {
          assetIssues.push('duplicate-alt');
        }
      }

      // Check for oversized files (>500KB)
      if (asset.size > 500 * 1024) {
        assetIssues.push('oversized');
      }
      // Check for unoptimized formats
      if (ext === 'png' && asset.size > 100 * 1024) {
        assetIssues.push('unoptimized-png');
      }
      if (ext === 'bmp' || ext === 'tiff' || ext === 'tif') {
        assetIssues.push('legacy-format');
      }
      // Check for potential duplicates
      if (duplicateIds.has(asset.id)) {
        assetIssues.push('duplicate');
      }

      // Check usage — primary match by assetId, fallback by URL containing the asset ID
      const usedIn: string[] = [];
      if (usageMap.has(asset.id)) usedIn.push(...usageMap.get(asset.id)!);
      for (const [key, refs] of usageMap.entries()) {
        if (key.includes(asset.id)) {
          for (const r of refs) {
            if (!usedIn.includes(r)) usedIn.push(r);
          }
        }
      }

      if (usedIn.length === 0) {
        assetIssues.push('unused');
      }

      if (assetIssues.length > 0 || usedIn.length === 0) {
        issues.push({
          assetId: asset.id,
          fileName: name,
          url: asset.hostedUrl || asset.url,
          fileSize: asset.size || 0,
          issues: assetIssues,
          usedIn: [...new Set(usedIn)],
        });
      }
    }

    res.json({
      totalAssets: assets.length,
      issueCount: issues.length,
      missingAlt: issues.filter(i => i.issues.includes('missing-alt')).length,
      oversized: issues.filter(i => i.issues.includes('oversized')).length,
      unused: issues.filter(i => i.issues.includes('unused')).length,
      duplicates: issues.filter(i => i.issues.includes('duplicate')).length,
      lowQualityAlt: issues.filter(i => i.issues.includes('low-quality-alt')).length,
      duplicateAlt: issues.filter(i => i.issues.includes('duplicate-alt')).length,
      issues,
    });
  } catch (e) {
    console.error('Audit error:', e);
    res.status(500).json({ error: 'Audit failed' });
  }
});

// --- Page Weight Dashboard ---
router.get('/api/webflow/page-weight/:siteId', async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const [assets, usageMap] = await Promise.all([
      listAssets(req.params.siteId, token),
      scanAssetUsage(req.params.siteId, token),
    ]);

    // Build asset lookup by ID
    const assetById = new Map(assets.map(a => [a.id, a]));

    // Invert the usageMap: for each page, collect all asset IDs used
    const pageAssets = new Map<string, Set<string>>();
    for (const [assetId, refs] of usageMap.entries()) {
      for (const ref of refs) {
        if (!pageAssets.has(ref)) pageAssets.set(ref, new Set());
        pageAssets.get(ref)!.add(assetId);
      }
    }

    // Build per-page stats
    const pages: Array<{
      page: string;
      totalSize: number;
      assetCount: number;
      assets: Array<{ id: string; name: string; size: number; contentType: string }>;
    }> = [];

    for (const [page, assetIds] of pageAssets.entries()) {
      let totalSize = 0;
      const pageAssetList: Array<{ id: string; name: string; size: number; contentType: string }> = [];
      for (const id of assetIds) {
        const asset = assetById.get(id);
        if (asset) {
          totalSize += asset.size || 0;
          pageAssetList.push({
            id: asset.id,
            name: asset.displayName || asset.originalFileName || '',
            size: asset.size || 0,
            contentType: asset.contentType || '',
          });
        }
      }
      pageAssetList.sort((a, b) => b.size - a.size);
      pages.push({ page, totalSize, assetCount: pageAssetList.length, assets: pageAssetList });
    }

    pages.sort((a, b) => b.totalSize - a.totalSize);

    const result = {
      totalPages: pages.length,
      totalAssetSize: assets.reduce((sum, a) => sum + (a.size || 0), 0),
      pages,
    };
    savePageWeight(req.params.siteId, result);
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Page weight analysis failed' });
  }
});

// Load last saved page weight snapshot
router.get('/api/webflow/page-weight-snapshot/:siteId', (req, res) => {
  const snapshot = getPageWeight(req.params.siteId);
  res.json(snapshot);
});

// --- Page SEO Editing ---
router.get('/api/webflow/pages/:siteId', async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const allPages = await listPages(req.params.siteId, token);
    const published = filterPublishedPages(allPages);
    console.log(`Pages: ${allPages.length} total, ${published.length} published (filtered out ${allPages.length - published.length} drafts/collections/unpublished)`);
    res.json(published);
  } catch (err) {
    console.error('Pages list error:', err);
    res.status(500).json({ error: 'Failed to list pages' });
  }
});

router.put('/api/webflow/pages/:pageId/seo', async (req, res) => {
  try {
    const { siteId, seo, openGraph, title } = req.body;
    const token = siteId ? (getTokenForSite(siteId) || undefined) : undefined;
    const result = await updatePageSeo(req.params.pageId, { seo, openGraph, title }, token);
    // Log activity + track edit status
    if (siteId) {
      const seoWs = listWorkspaces().find(w => w.webflowSiteId === siteId);
      if (seoWs) {
        const changedFields = [seo?.title && 'title', seo?.description && 'description', openGraph && 'OG'].filter(Boolean) as string[];
        addActivity(seoWs.id, 'seo_updated', `Updated SEO ${changedFields.join(', ')} for a page`, undefined, { pageId: req.params.pageId });
        // Mark as live (saved to Webflow draft, ready for publish)
        updatePageState(seoWs.id, req.params.pageId, { status: 'live', source: 'editor', fields: changedFields, updatedBy: 'admin' });
      }
    }
    res.json(result);
  } catch (err) {
    console.error('Page SEO update error:', err);
    res.status(500).json({ error: 'Failed to update page SEO' });
  }
});

router.post('/api/webflow/publish/:siteId', async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const result = await publishSite(req.params.siteId, token);
    res.json(result);
  } catch (err) {
    console.error('Publish error:', err);
    res.status(500).json({ error: 'Failed to publish site' });
  }
});

// --- AI Keyword Analysis ---
router.post('/api/webflow/keyword-analysis', async (req, res) => {
  const { pageTitle, seoTitle, metaDescription, pageContent, slug, siteContext, workspaceId } = req.body;
  if (!pageTitle) return res.status(400).json({ error: 'pageTitle required' });

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  const { keywordBlock, brandVoiceBlock: bvBlock2 } = buildSeoContext(workspaceId, slug ? `/${slug}` : undefined);
  const kwMapContext = buildKeywordMapContext(workspaceId);

  // Fetch real SEMRush data for accuracy
  let semrushBlock = '';
  if (isSemrushConfigured() && workspaceId) {
    try {
      // Try to get metrics for the page's likely primary keyword from title
      const seedKeyword = seoTitle || pageTitle;
      const words = seedKeyword.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w: string) => w.length > 2);
      if (words.length > 0) {
        const phrase = words.slice(0, 5).join(' ');
        const [metrics, related] = await Promise.all([
          getKeywordOverview([phrase], workspaceId).catch(() => []),
          getRelatedKeywords(phrase, workspaceId, 10).catch(() => []),
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
    } catch (e) { console.error('[keyword-analysis] SEMRush enrichment error:', e); }
  }

  try {
    const prompt = `You are an expert SEO strategist and keyword researcher. Analyze this web page and provide a comprehensive keyword analysis.

Page title: ${pageTitle}
SEO title: ${seoTitle || '(same as page title)'}
Meta description: ${metaDescription || '(none)'}
URL slug: /${slug || ''}
Site context: ${siteContext || 'N/A'}
Page content excerpt: ${pageContent ? pageContent.slice(0, 3000) : 'N/A'}${keywordBlock}${bvBlock2}${kwMapContext}${semrushBlock}

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

    try {
      const analysis = JSON.parse(aiResult.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
      res.json(analysis);
    } catch {
      res.json({ error: 'Failed to parse AI response', raw: aiResult.text.slice(0, 500) });
    }
  } catch (err) {
    console.error('Keyword analysis error:', err);
    res.status(500).json({ error: 'Keyword analysis failed' });
  }
});

// --- AI Content Score ---
router.post('/api/webflow/content-score', async (req, res) => {
  const { pageContent, pageTitle, seoTitle, metaDescription } = req.body;
  if (!pageContent && !pageTitle) return res.status(400).json({ error: 'pageContent or pageTitle required' });

  try {
    // Compute readability metrics server-side (no AI needed)
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

    // Heading structure
    const headings = (pageContent || '').match(/<h[1-6][^>]*>.*?<\/h[1-6]>/gi) || [];
    const h1Count = headings.filter((h: string) => h.startsWith('<h1')).length;
    const h2Count = headings.filter((h: string) => h.startsWith('<h2')).length;
    const headingTexts = headings.map((h: string) => h.replace(/<[^>]+>/g, '').trim());

    // Word frequency (top keywords from content)
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

    // Title analysis
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
    console.error('Content score error:', err);
    res.status(500).json({ error: 'Content scoring failed' });
  }
});

// --- AI Alt Text Generation for existing assets ---
router.post('/api/webflow/generate-alt/:assetId', async (req, res) => {
  const { imageUrl, siteId, workspaceId: altWsId } = req.body;
  if (!imageUrl) return res.status(400).json({ error: 'imageUrl required' });

  try {
    // Build context from pages that use this image
    let context = '';
    if (siteId) {
      try {
        const tkn = getTokenForSite(siteId) || undefined;
        const pages = await listPages(siteId, tkn);
        const assetId = req.params.assetId;
        const contextParts: string[] = [];

        for (const page of pages.slice(0, 20)) {
          try {
            const dom = await getPageDom(page.id, tkn);
            if (dom.includes(assetId) || dom.includes(imageUrl)) {
              // Extract only nearby text: find the asset reference, grab surrounding text
              const plainText = dom.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
              const idx = plainText.indexOf(assetId) !== -1
                ? plainText.indexOf(assetId)
                : plainText.indexOf(imageUrl.split('/').pop() || '');
              const start = Math.max(0, idx - 100);
              const snippet = plainText.slice(start, start + 200).trim();
              contextParts.push(`Page "${page.title}": ${snippet}`);
              if (contextParts.length >= 2) break;
            }
          } catch { /* skip */ }
        }

        if (contextParts.length > 0) {
          context = contextParts.join('\n');
        } else {
          // Fallback: use site name as minimal context
          const sites = await listSites(tkn);
          const site = sites.find(s => s.id === siteId);
          if (site) context = `Website: ${site.displayName}`;
        }
      } catch {
        // Context fetch failed, proceed without it
      }
    }

    // Download the image to a temp file
    const response = await fetch(imageUrl);
    const buffer = Buffer.from(await response.arrayBuffer());
    const ext = path.extname(imageUrl).split('?')[0] || '.jpg';
    const tmpPath = `/tmp/alt_gen_${Date.now()}${ext}`;
    fs.writeFileSync(tmpPath, buffer);

    // Enrich context with keyword strategy from workspace
    const resolvedWsId = altWsId || (siteId ? listWorkspaces().find(w => w.webflowSiteId === siteId)?.id : undefined);
    if (resolvedWsId) {
      const { businessContext: altBizCtx } = buildSeoContext(resolvedWsId);
      const ws = getWorkspace(resolvedWsId);
      const brandVoice = ws?.brandVoice;
      const kwParts: string[] = [];
      if (altBizCtx) kwParts.push(`Business: ${altBizCtx}`);
      if (brandVoice) kwParts.push(`Brand voice: ${brandVoice}`);
      if (ws?.keywordStrategy?.siteKeywords?.length) {
        kwParts.push(`Site keywords: ${ws.keywordStrategy.siteKeywords.slice(0, 5).join(', ')}`);
      }
      if (kwParts.length > 0) {
        context = context ? `${context}\n${kwParts.join('. ')}` : kwParts.join('. ');
      }
    }

    const altText = await generateAltText(tmpPath, context || undefined);
    fs.unlinkSync(tmpPath);

    if (altText) {
      // Also update in Webflow
      const altToken = siteId ? (getTokenForSite(siteId) || undefined) : undefined;
      const writeResult = await updateAsset(req.params.assetId, { altText }, altToken);
      if (!writeResult.success) {
        console.error(`Alt text generated but Webflow write-back failed for ${req.params.assetId}:`, writeResult.error);
        res.json({ altText, updated: false, writeError: writeResult.error });
      } else {
        console.log(`Alt text generated and saved for ${req.params.assetId}: "${altText}"`);
        res.json({ altText, updated: true });
      }
    } else {
      console.warn(`Alt text generation returned null for ${req.params.assetId}`);
      res.json({ altText: null, updated: false });
    }
  } catch (e) {
    console.error('Generate alt error:', e);
    res.status(500).json({ error: 'Failed to generate alt text' });
  }
});

// --- Bulk AI Alt Text Generation (fetches context once) ---
router.post('/api/webflow/bulk-generate-alt', async (req, res) => {
  const { assets, siteId, workspaceId: bulkAltWsId } = req.body as {
    assets: Array<{ assetId: string; imageUrl: string }>;
    siteId?: string;
    workspaceId?: string;
  };
  if (!assets?.length) return res.status(400).json({ error: 'assets required' });

  const token = siteId ? (getTokenForSite(siteId) || undefined) : undefined;

  // Fetch site context ONCE for all images
  let siteContext = '';
  if (siteId) {
    try {
      const sites = await listSites(token);
      const site = sites.find(s => s.id === siteId);
      if (site) siteContext = `Website: ${site.displayName}`;
    } catch { /* proceed without context */ }
  }

  // Enrich with keyword strategy context
  const bulkWsId = bulkAltWsId || (siteId ? listWorkspaces().find(w => w.webflowSiteId === siteId)?.id : undefined);
  if (bulkWsId) {
    const { businessContext: bulkBizCtx } = buildSeoContext(bulkWsId);
    const bulkWs = getWorkspace(bulkWsId);
    const kwParts: string[] = [];
    if (bulkBizCtx) kwParts.push(`Business: ${bulkBizCtx}`);
    if (bulkWs?.brandVoice) kwParts.push(`Brand voice: ${bulkWs.brandVoice}`);
    if (bulkWs?.keywordStrategy?.siteKeywords?.length) {
      kwParts.push(`Site keywords: ${bulkWs.keywordStrategy.siteKeywords.slice(0, 5).join(', ')}`);
    }
    if (kwParts.length > 0) {
      siteContext = siteContext ? `${siteContext}. ${kwParts.join('. ')}` : kwParts.join('. ');
    }
  }

  // Build a mapping of assetId → page context by scanning pages once
  const assetContextMap = new Map<string, string>();
  if (siteId) {
    try {
      const pages = await listPages(siteId, token);
      for (const page of pages.slice(0, 15)) {
        try {
          const dom = await getPageDom(page.id, token);
          const plainText = dom.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          for (const asset of assets) {
            if (assetContextMap.has(asset.assetId)) continue; // already have context
            if (dom.includes(asset.assetId) || dom.includes(asset.imageUrl)) {
              const idx = plainText.indexOf(asset.assetId) !== -1
                ? plainText.indexOf(asset.assetId)
                : plainText.indexOf(asset.imageUrl.split('/').pop() || '');
              const start = Math.max(0, idx - 100);
              const snippet = plainText.slice(start, start + 200).trim();
              assetContextMap.set(asset.assetId, `Page "${page.title}": ${snippet}`);
            }
          }
        } catch { /* skip page */ }
      }
    } catch { /* proceed without page context */ }
  }

  // Stream NDJSON progress events as each image is processed
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data: Record<string, unknown>) => {
    res.write(JSON.stringify(data) + '\n');
  };

  send({ type: 'status', message: 'Processing images...', done: 0, total: assets.length });

  let done = 0;
  for (const asset of assets) {
    try {
      const response = await fetch(asset.imageUrl);
      if (!response.ok) {
        done++;
        send({ type: 'result', assetId: asset.assetId, altText: null, updated: false, error: `Download failed: ${response.status}`, done, total: assets.length });
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const ext = path.extname(asset.imageUrl).split('?')[0] || '.jpg';
      const tmpPath = `/tmp/bulk_alt_${Date.now()}${ext}`;
      fs.writeFileSync(tmpPath, buffer);

      const context = assetContextMap.get(asset.assetId) || siteContext || undefined;
      const altText = await generateAltText(tmpPath, context);
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }

      done++;
      if (altText) {
        const writeResult = await updateAsset(asset.assetId, { altText }, token);
        if (!writeResult.success) {
          console.error(`Bulk alt: generated but write-back failed for ${asset.assetId}:`, writeResult.error);
          send({ type: 'result', assetId: asset.assetId, altText, updated: false, error: writeResult.error, done, total: assets.length });
        } else {
          send({ type: 'result', assetId: asset.assetId, altText, updated: true, done, total: assets.length });
        }
      } else {
        send({ type: 'result', assetId: asset.assetId, altText: null, updated: false, error: 'Generation returned null', done, total: assets.length });
      }
    } catch (err) {
      done++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Bulk alt error for ${asset.assetId}:`, msg);
      send({ type: 'result', assetId: asset.assetId, altText: null, updated: false, error: msg, done, total: assets.length });
    }
  }

  send({ type: 'done', done, total: assets.length });
  res.end();
});

// --- Image Compression ---
router.post('/api/webflow/compress/:assetId', async (req, res) => {
  const { imageUrl, siteId, altText, fileName } = req.body;
  if (!imageUrl || !siteId) return res.status(400).json({ error: 'imageUrl and siteId required' });
  const compressToken = getTokenForSite(siteId) || undefined;

  try {
    const sharp = (await import('sharp')).default;

    // Download the original image
    const response = await fetch(imageUrl);
    const originalBuffer = Buffer.from(await response.arrayBuffer());
    const originalSize = originalBuffer.length;

    // Determine output format: convert PNG/BMP/TIFF to WebP, keep JPEG as JPEG but optimize
    const ext = (fileName || imageUrl).split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
    let compressed: Buffer;
    let newFileName: string;
    const baseName = (fileName || 'image').replace(/\.[^.]+$/, '');

    if (ext === 'svg') {
      // Use SVGO library to optimize SVG
      const svgo = await import('svgo');
      let compressedSvg: Buffer;
      try {
        const svgString = originalBuffer.toString('utf-8');
        const result = svgo.optimize(svgString, {
          multipass: true,
          plugins: [
            'preset-default',
          ],
        } as Parameters<typeof svgo.optimize>[1]);
        compressedSvg = Buffer.from(result.data, 'utf-8');
      } catch (svgoErr) {
        console.error('SVGO error:', svgoErr);
        return res.json({ skipped: true, reason: 'SVGO optimization failed: ' + (svgoErr instanceof Error ? svgoErr.message : String(svgoErr)) });
      }

      const svgNewSize = compressedSvg.length;
      const svgSavings = originalSize - svgNewSize;
      const svgSavingsPercent = Math.round((svgSavings / originalSize) * 100);

      if (svgSavingsPercent < 3) {
        return res.json({
          skipped: true,
          reason: `Already optimized (only ${svgSavingsPercent}% savings)`,
          originalSize,
          newSize: svgNewSize,
        });
      }

      const svgFileName = `${baseName}.svg`;
      const svgTmpPath = `/tmp/compressed_${Date.now()}_${svgFileName}`;
      fs.writeFileSync(svgTmpPath, compressedSvg);
      const svgUpload = await uploadAsset(siteId, svgTmpPath, svgFileName, altText, compressToken);
      fs.unlinkSync(svgTmpPath);

      if (!svgUpload.success) {
        return res.status(500).json({ error: svgUpload.error });
      }

      await deleteAsset(req.params.assetId, compressToken);

      return res.json({
        success: true,
        newAssetId: svgUpload.assetId,
        newHostedUrl: svgUpload.hostedUrl,
        originalSize,
        newSize: svgNewSize,
        savings: svgSavings,
        savingsPercent: svgSavingsPercent,
        newFileName: svgFileName,
      });
    }

    if (ext === 'jpg' || ext === 'jpeg') {
      compressed = await sharp(originalBuffer)
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer();
      newFileName = `${baseName}.jpg`;
    } else if (ext === 'png') {
      // Try WebP first, fall back to optimized PNG
      const webpBuffer = await sharp(originalBuffer)
        .webp({ quality: 80 })
        .toBuffer();
      const pngBuffer = await sharp(originalBuffer)
        .png({ compressionLevel: 9, palette: true })
        .toBuffer();
      if (webpBuffer.length < pngBuffer.length) {
        compressed = webpBuffer;
        newFileName = `${baseName}.webp`;
      } else {
        compressed = pngBuffer;
        newFileName = `${baseName}.png`;
      }
    } else {
      // Everything else: convert to WebP
      compressed = await sharp(originalBuffer)
        .webp({ quality: 80 })
        .toBuffer();
      newFileName = `${baseName}.webp`;
    }

    const newSize = compressed.length;
    const savings = originalSize - newSize;
    const savingsPercent = Math.round((savings / originalSize) * 100);

    // Skip if savings are negligible (<5%)
    if (savingsPercent < 5) {
      return res.json({
        skipped: true,
        reason: `Already optimized (only ${savingsPercent}% savings)`,
        originalSize,
        newSize,
      });
    }

    // Write compressed file to temp, upload to Webflow
    const tmpPath = `/tmp/compressed_${Date.now()}_${newFileName}`;
    fs.writeFileSync(tmpPath, compressed);

    const uploadResult = await uploadAsset(siteId, tmpPath, newFileName, altText, compressToken);
    fs.unlinkSync(tmpPath);

    if (!uploadResult.success) {
      return res.status(500).json({ error: uploadResult.error });
    }

    // Delete the old asset
    await deleteAsset(req.params.assetId, compressToken);

    res.json({
      success: true,
      newAssetId: uploadResult.assetId,
      newHostedUrl: uploadResult.hostedUrl,
      originalSize,
      newSize,
      savings,
      savingsPercent,
      newFileName,
    });
  } catch (e) {
    console.error('Compress error:', e);
    res.status(500).json({ error: 'Compression failed' });
  }
});

// --- Organize Assets into Folders ---

// Preview: builds a plan of which assets go into which folders
router.get('/api/webflow/organize-preview/:siteId', async (req, res) => {
  const { siteId } = req.params;
  const token = getTokenForSite(siteId) || undefined;
  if (!token) return res.status(400).json({ error: 'No token for site' });

  try {
    // 1. Fetch assets and existing folders
    const [assets, existingFolders] = await Promise.all([
      listAssets(siteId, token),
      listAssetFolders(siteId, token),
    ]);

    // 2. Scan usage: which assets appear on which pages
    const usage = await scanAssetUsage(siteId, token);

    // Build assetId → page titles mapping
    const assetPageMap = new Map<string, string[]>();
    for (const [assetId, refs] of usage.entries()) {
      const pageTitles = refs.filter(r => r.startsWith('page:')).map(r => r.slice(5));
      if (pageTitles.length > 0) assetPageMap.set(assetId, pageTitles);
    }

    // 2b. Detect OG/meta image assets from published HTML
    const ogAssetIds = new Set<string>();
    const allAssetIds = new Set(assets.map(a => a.id));
    try {
      const subdomain = await getSiteSubdomain(siteId, token);
      if (subdomain) {
        const baseUrl = `https://${subdomain}.webflow.io`;
        const pages = await listPages(siteId, token);
        const pageUrls = [
          baseUrl,
          ...pages.filter(p => p.slug && p.slug !== 'index' && !p.draft && !p.archived).map(p => `${baseUrl}/${p.slug}`),
        ];
        for (let i = 0; i < pageUrls.length; i += 10) {
          await Promise.allSettled(pageUrls.slice(i, i + 10).map(async (url) => {
            try {
              const r = await fetch(url, { redirect: 'follow' });
              if (!r.ok) return;
              const html = await r.text();
              const ogMatches = html.match(/<meta\s+(?:property|name)=["'](?:og:image|twitter:image)["']\s+content=["']([^"']+)["']/gi) || [];
              for (const tag of ogMatches) {
                const m = tag.match(/content=["']([^"']+)["']/i);
                if (!m) continue;
                for (const id of allAssetIds) { if (m[1].includes(id)) ogAssetIds.add(id); }
              }
            } catch { /* skip */ }
          }));
        }
      }
    } catch { /* proceed without OG detection */ }

    // 3. Build the organization plan
    const existingFolderNames = new Set(existingFolders.map(f => f.displayName));
    const plan: {
      foldersToCreate: string[];
      moves: Array<{ assetId: string; assetName: string; targetFolder: string; currentFolder?: string }>;
      summary: { totalAssets: number; assetsToMove: number; foldersToCreate: number; alreadyOrganized: number; unused: number; shared: number; ogImages: number };
    } = {
      foldersToCreate: [],
      moves: [],
      summary: { totalAssets: assets.length, assetsToMove: 0, foldersToCreate: 0, alreadyOrganized: 0, unused: 0, shared: 0, ogImages: 0 },
    };

    const foldersNeeded = new Set<string>();

    for (const asset of assets) {
      const pageTitles = assetPageMap.get(asset.id);

      if (asset.parentFolder) {
        plan.summary.alreadyOrganized++;
        continue;
      }

      let targetFolder: string;
      if (ogAssetIds.has(asset.id)) {
        targetFolder = '_Social / OG Images';
        plan.summary.ogImages++;
      } else if (!pageTitles || pageTitles.length === 0) {
        targetFolder = '_Unused Assets';
        plan.summary.unused++;
      } else if (pageTitles.length > 1) {
        targetFolder = '_Shared Assets';
        plan.summary.shared++;
      } else {
        targetFolder = pageTitles[0];
      }

      foldersNeeded.add(targetFolder);
      plan.moves.push({
        assetId: asset.id,
        assetName: asset.displayName || asset.originalFileName || asset.id,
        targetFolder,
        currentFolder: undefined,
      });
    }

    // Determine which folders need to be created
    for (const folder of foldersNeeded) {
      if (!existingFolderNames.has(folder)) {
        plan.foldersToCreate.push(folder);
      }
    }

    plan.summary.assetsToMove = plan.moves.length;
    plan.summary.foldersToCreate = plan.foldersToCreate.length;

    res.json(plan);
  } catch (err) {
    console.error('Organize preview error:', err);
    res.status(500).json({ error: 'Failed to build organization plan' });
  }
});

// Execute: creates folders and moves assets according to a plan
router.post('/api/webflow/organize-execute/:siteId', async (req, res) => {
  const { siteId } = req.params;
  const { moves, foldersToCreate } = req.body as {
    moves: Array<{ assetId: string; assetName: string; targetFolder: string }>;
    foldersToCreate: string[];
  };
  const token = getTokenForSite(siteId) || undefined;
  if (!token) return res.status(400).json({ error: 'No token for site' });
  if (!moves?.length) return res.status(400).json({ error: 'No moves to execute' });

  try {
    // 1. Get existing folders to avoid duplicates
    const existingFolders = await listAssetFolders(siteId, token);
    const folderNameToId = new Map(existingFolders.map(f => [f.displayName, f.id]));

    // 2. Create any new folders needed
    const createResults: Array<{ folder: string; success: boolean; error?: string }> = [];
    for (const folderName of (foldersToCreate || [])) {
      if (folderNameToId.has(folderName)) {
        createResults.push({ folder: folderName, success: true });
        continue;
      }
      const result = await createAssetFolder(siteId, folderName, undefined, token);
      if (result.success && result.folderId) {
        folderNameToId.set(folderName, result.folderId);
        createResults.push({ folder: folderName, success: true });
      } else {
        createResults.push({ folder: folderName, success: false, error: result.error });
      }
    }

    // 3. Move assets into their target folders
    const moveResults: Array<{ assetId: string; assetName: string; targetFolder: string; success: boolean; error?: string }> = [];
    for (const move of moves) {
      const folderId = folderNameToId.get(move.targetFolder);
      if (!folderId) {
        moveResults.push({ ...move, success: false, error: `Folder "${move.targetFolder}" not found` });
        continue;
      }
      const result = await moveAssetToFolder(move.assetId, folderId, token);
      moveResults.push({ ...move, success: result.success, error: result.error });
    }

    const successCount = moveResults.filter(r => r.success).length;
    const failCount = moveResults.filter(r => !r.success).length;

    res.json({
      success: true,
      foldersCreated: createResults,
      moveResults,
      summary: { moved: successCount, failed: failCount, total: moves.length },
    });
  } catch (err) {
    console.error('Organize execute error:', err);
    res.status(500).json({ error: 'Failed to execute organization plan' });
  }
});

// --- Rename Asset ---
router.patch('/api/webflow/rename/:assetId', async (req, res) => {
  const { displayName, siteId } = req.body;
  if (!displayName) return res.status(400).json({ error: 'displayName required' });

  try {
    const token = siteId ? getTokenForSite(siteId) : null;
    const result = await updateAsset(req.params.assetId, { displayName }, token || undefined);
    res.json(result);
  } catch (e) {
    console.error('Rename error:', e);
    res.status(500).json({ error: 'Failed to rename asset' });
  }
});

// --- CMS Collections ---
router.get('/api/webflow/collections/:siteId', async (req, res) => {
  try {
    const collections = await listCollections(req.params.siteId);
    res.json(collections);
  } catch {
    res.json([]);
  }
});

router.get('/api/webflow/collections/:collectionId/schema', async (req, res) => {
  try {
    const schema = await getCollectionSchema(req.params.collectionId);
    res.json(schema);
  } catch {
    res.json({ fields: [] });
  }
});

router.get('/api/webflow/collections/:collectionId/items', async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const offset = parseInt(req.query.offset as string) || 0;
  try {
    const result = await listCollectionItems(req.params.collectionId, limit, offset);
    res.json(result);
  } catch {
    res.json({ items: [], total: 0 });
  }
});

router.patch('/api/webflow/collections/:collectionId/items/:itemId', async (req, res) => {
  const result = await updateCollectionItem(req.params.collectionId, req.params.itemId, req.body.fieldData);
  // Track CMS item edit as live
  if (req.body.workspaceId) {
    updatePageState(req.body.workspaceId, req.params.itemId, { status: 'live', source: 'cms', updatedBy: 'admin' });
  }
  res.json(result);
});

// --- CMS SEO Editor: list all collections with SEO-relevant fields and items ---
router.get('/api/webflow/cms-seo/:siteId', async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const collections = await listCollections(req.params.siteId, token);
    const SEO_FIELD_PATTERNS = ['seo title', 'meta title', 'title tag', 'seo description', 'meta description', 'og title', 'og description', 'open graph'];

    // Fetch sitemap to filter out collection list pages that don't exist in it
    let sitemapPaths: Set<string> | null = null;
    try {
      const subdomain = await getSiteSubdomain(req.params.siteId, token);
      if (subdomain) {
        const baseUrl = `https://${subdomain}.webflow.io`;
        const sitemapUrls = await discoverSitemapUrls(baseUrl);
        if (sitemapUrls.length > 0) {
          sitemapPaths = new Set(sitemapUrls.map(u => {
            try { return new URL(u).pathname.replace(/\/$/, '').toLowerCase(); } catch { return ''; }
          }).filter(Boolean));
        }
      }
    } catch { /* sitemap fetch is best-effort — show all items if it fails */ }

    const results: Array<{
      collectionId: string;
      collectionName: string;
      collectionSlug: string;
      seoFields: Array<{ id: string; slug: string; displayName: string; type: string }>;
      items: Array<{ id: string; fieldData: Record<string, unknown> }>;
      total: number;
    }> = [];

    for (const coll of collections) {
      const schema = await getCollectionSchema(coll.id, token);
      // Identify SEO-relevant fields: name, slug, plus any field matching SEO patterns
      const seoFields = schema.fields.filter(f => {
        const name = f.displayName.toLowerCase();
        const slug = f.slug.toLowerCase();
        if (f.slug === 'name' || f.slug === 'slug') return true;
        if (f.type === 'PlainText' || f.type === 'RichText') {
          return SEO_FIELD_PATTERNS.some(p => name.includes(p) || slug.includes(p.replace(/\s/g, '-')));
        }
        return false;
      });

      // Only include collections that have published items (skip utility/empty collections)
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;
      const { items, total } = await listCollectionItems(coll.id, limit, offset, token);
      if (total === 0) continue;

      // Filter to only live (published, non-draft, non-archived) items
      const liveItems = items.filter(item => {
        const draft = item.isDraft as boolean | undefined;
        const archived = item.isArchived as boolean | undefined;
        return !draft && !archived;
      });
      if (liveItems.length === 0) continue;

      // Filter by sitemap: only include items whose full path exists in sitemap
      const collSlug = coll.slug;
      const sitemapFiltered = sitemapPaths
        ? liveItems.filter(item => {
            const fd = (item.fieldData || item) as Record<string, unknown>;
            const itemSlug = String(fd['slug'] || '').toLowerCase();
            if (!itemSlug) return false;
            // Check both /{collSlug}/{itemSlug} and /{itemSlug} patterns
            const fullPath = `/${collSlug}/${itemSlug}`;
            return sitemapPaths!.has(fullPath) || sitemapPaths!.has(`/${itemSlug}`);
          })
        : liveItems; // No sitemap available — show all items

      if (sitemapFiltered.length === 0) continue;

      // Extract only the relevant field data from each item
      const cleanItems = sitemapFiltered.map(item => {
        const fd = (item.fieldData || item) as Record<string, unknown>;
        const relevant: Record<string, unknown> = {};
        relevant['name'] = fd['name'] || '';
        relevant['slug'] = fd['slug'] || '';
        for (const sf of seoFields) {
          if (sf.slug !== 'name' && sf.slug !== 'slug') {
            relevant[sf.slug] = fd[sf.slug] || '';
          }
        }
        return { id: item.id as string || (item as Record<string, unknown>)._id as string, fieldData: relevant };
      });

      results.push({
        collectionId: coll.id,
        collectionName: coll.displayName,
        collectionSlug: coll.slug,
        seoFields,
        items: cleanItems,
        total: sitemapFiltered.length,
      });
    }

    res.json(results);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('CMS SEO list error:', msg);
    res.status(500).json({ error: msg });
  }
});

// --- CMS SEO: Publish collection items after editing ---
router.post('/api/webflow/collections/:collectionId/publish', async (req, res) => {
  try {
    const { itemIds } = req.body;
    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ error: 'itemIds array required' });
    }
    const result = await publishCollectionItems(req.params.collectionId, itemIds);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Persistent metadata (alt text, upload history)
router.get('/api/metadata', (_req, res) => {
  res.json(getMetadata());
});

export default router;

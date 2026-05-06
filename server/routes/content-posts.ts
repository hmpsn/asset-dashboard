/**
 * content-posts routes — extracted from server/index.ts
 */
import { Router } from 'express';

import { requireWorkspaceAccess } from '../auth.js';
const router = Router();

import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { getBrief } from '../content-brief.js';
import {
  listPosts,
  getPost,
  updatePostField,
  deletePost,
  createContentPostGenerationJob,
  notifyContentUpdated,
  runContentPostGenerationJob,
  regenerateSection,
  exportPostMarkdown,
  exportPostHTML,
  snapshotPostVersion,
  listPostVersions,
  getPostVersion,
  revertToVersion,
  getMostRecentPostVersion,
} from '../content-posts.js';
import { scoreVoiceMatch, countHtmlWords } from '../content-posts-ai.js';
import { renderPostHTML } from '../post-export-html.js';
import { assemblePostHtml, generateSlug } from '../html-to-richtext.js';
import {
  createCollectionItem,
  publishCollectionItems,
} from '../webflow.js';
import { getWorkspace, getTokenForSite } from '../workspaces.js';
import { WS_EVENTS } from '../ws-events.js';
import { createLogger } from '../logger.js';
import { recordAction, getActionByWorkspaceAndSource } from '../outcome-tracking.js';
import { captureBaselineFromGsc } from '../outcome-measurement.js';
import { parseAIJson } from '../openai-helpers.js';
import { callAI } from '../ai.js';
import { hasActiveJob } from '../jobs.js';
import { buildIntelPrompt } from '../workspace-intelligence.js';
import { validate, z } from '../middleware/validate.js';
import type { AIReviewResult, AiFixResult, IssueKey } from '../../shared/types/content.js';
import { ISSUE_KEYS, PROVENANCE_SENSITIVE_REVIEW_KEYS } from '../../shared/types/content.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import { getVoiceProfile, buildVoiceCalibrationContext } from '../voice-calibration.js';
import { sanitizeRichText, sanitizePlainText } from '../html-sanitize.js';

const log = createLogger('content-posts');

function markProvenanceItemsForHumanReview(
  review: Record<string, AIReviewResult>,
): Record<string, AIReviewResult> {
  const next = { ...review };
  for (const key of PROVENANCE_SENSITIVE_REVIEW_KEYS) {
    const existing = next[key];
    next[key] = {
      pass: false,
      reason: existing?.reason
        ? `${existing.reason} Human verification is required before this checklist item can be checked.`
        : 'Human verification is required before this checklist item can be checked.',
      humanReviewRequired: true,
    };
  }
  return next;
}

const generatePostSchema = z.object({
  briefId: z.string({ required_error: 'briefId required' }).trim().min(1, 'briefId required'),
}).strict();

// --- Content Post Generator (#194) ---

// List all generated posts for a workspace
router.get('/api/content-posts/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(listPosts(req.params.workspaceId));
});

// Get a single post
router.get('/api/content-posts/:workspaceId/:postId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const post = getPost(req.params.workspaceId, req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  res.json(post);
});

// Generate a full post from a brief (async — returns immediately with skeleton, generates in background)
router.post('/api/content-posts/:workspaceId/generate', requireWorkspaceAccess('workspaceId'), validate(generatePostSchema), async (req, res) => {
  const { briefId } = req.body;

  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  // No usage limit — posts are paid add-ons purchased via Stripe

  const brief = getBrief(req.params.workspaceId, briefId);
  if (!brief) return res.status(404).json({ error: 'Brief not found' });

  try {
    const activeJob = hasActiveJob(BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION, req.params.workspaceId);
    if (activeJob) return res.status(409).json({ error: 'Content post generation is already running for this workspace', jobId: activeJob.id });
    const started = createContentPostGenerationJob(req.params.workspaceId, brief);
    res.json({ ...started.post, jobId: started.jobId });
    runContentPostGenerationJob({
      workspaceId: req.params.workspaceId,
      brief,
      postId: started.postId,
      jobId: started.jobId,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to start generation' });
  }
});

// Regenerate a single section
router.post('/api/content-posts/:workspaceId/:postId/regenerate-section', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const { sectionIndex } = req.body;
  if (sectionIndex === undefined) return res.status(400).json({ error: 'sectionIndex required' });

  const post = getPost(req.params.workspaceId, req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const brief = getBrief(req.params.workspaceId, post.briefId);
  if (!brief) return res.status(404).json({ error: 'Source brief not found' });

  try {
    const updated = await regenerateSection(req.params.workspaceId, req.params.postId, sectionIndex, brief);
    if (!updated) return res.status(404).json({ error: 'Section not found' });
    addActivity(
      req.params.workspaceId,
      'content_updated',
      `Regenerated section ${sectionIndex + 1} for "${updated.title}"`,
      undefined,
      { postId: updated.id, sectionIndex, action: 'post_section_regenerated' },
    );
    notifyContentUpdated(req.params.workspaceId, {
      postId: updated.id,
      sectionIndex,
      action: 'post_section_regenerated',
    });
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.POST_UPDATED, { postId: updated.id });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Regeneration failed' });
  }
});

const updatePostSchema = z.object({
  title: z.string().max(500).optional(),
  metaDescription: z.string().max(500).optional(),
  introduction: z.string().optional(),
  sections: z.array(z.object({
    index: z.number(),
    heading: z.string(),
    content: z.string(),
    wordCount: z.number(),
    targetWordCount: z.number().optional(),
    keywords: z.array(z.string()).optional(),
    status: z.enum(['pending', 'generating', 'done', 'error']).optional(),
    error: z.string().optional(),
  })).optional(),
  conclusion: z.string().optional(),
  seoTitle: z.string().max(200).optional(),
  seoMetaDescription: z.string().max(500).optional(),
  status: z.enum(['generating', 'draft', 'review', 'approved', 'error']).optional(),
  voiceScore: z.number().min(0).max(100).optional(),
  voiceFeedback: z.string().optional(),
  webflowItemId: z.string().optional(),
  webflowCollectionId: z.string().optional(),
  publishedAt: z.string().optional(),
  publishedSlug: z.string().optional(),
  reviewChecklist: z.object({
    factual_accuracy: z.boolean(),
    brand_voice: z.boolean(),
    internal_links: z.boolean(),
    no_hallucinations: z.boolean(),
    meta_optimized: z.boolean(),
    word_count_target: z.boolean(),
  }).optional(),
}).strict();

// Update post fields (inline editing of title, sections, status, etc.)
// If status is changed to 'approved' and workspace has auto-publish configured,
// triggers publish-to-webflow in the background.
router.patch('/api/content-posts/:workspaceId/:postId', requireWorkspaceAccess('workspaceId'), validate(updatePostSchema), (req, res, next) => {
  const previous = getPost(req.params.workspaceId, req.params.postId);

  // Snapshot before content-changing edits (not status-only changes).
  //
  // Coalesce window: with auto-save firing every ~2s, a single editing session
  // would otherwise create dozens of `manual_edit` snapshots and `content_updated`
  // activity entries. Skip both if the newest snapshot is already a `manual_edit`
  // from <60 s ago — same pattern as the public `client-edit` route.
  const ADMIN_EDIT_COALESCE_WINDOW_MS = 60_000;
  const contentFields = ['title', 'metaDescription', 'introduction', 'sections', 'conclusion', 'seoTitle', 'seoMetaDescription'];
  const editedContentFields = contentFields.filter(f => f in req.body);
  const isContentEdit = editedContentFields.length > 0;
  let withinEditCoalesceWindow = false;
  if (previous && isContentEdit) {
    const recentVersion = getMostRecentPostVersion(req.params.workspaceId, req.params.postId);
    withinEditCoalesceWindow = !!recentVersion
      && recentVersion.trigger === 'manual_edit'
      && recentVersion.triggerDetail !== 'client_edit'
      && (Date.now() - new Date(recentVersion.createdAt).getTime()) < ADMIN_EDIT_COALESCE_WINDOW_MS;
    if (!withinEditCoalesceWindow) {
      snapshotPostVersion(previous, 'manual_edit', `field:${editedContentFields.join(',')}`);
    }
  }

  let updated;
  try {
    updated = updatePostField(req.params.workspaceId, req.params.postId, req.body);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'InvalidTransitionError') {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
  if (!updated) return res.status(404).json({ error: 'Post not found' });

  // Auto-publish on approval if workspace has publishTarget and post isn't already published
  if (req.body.status === 'approved' && previous?.status !== 'approved' && !updated.webflowItemId) {
    const ws = getWorkspace(req.params.workspaceId);
    if (ws?.publishTarget && ws.webflowSiteId) {
      const token = getTokenForSite(ws.webflowSiteId) || undefined;
      if (token) {
        // Fire-and-forget background publish
        const { collectionId, fieldMap } = ws.publishTarget;
        const bodyHtml = assemblePostHtml(updated);
        const slug = generateSlug(updated.title);
        const fieldData: Record<string, unknown> = {};
        if (fieldMap.title) fieldData[fieldMap.title] = updated.title;
        if (fieldMap.slug) fieldData[fieldMap.slug] = slug;
        if (fieldMap.body) fieldData[fieldMap.body] = bodyHtml;
        if (fieldMap.metaTitle) fieldData[fieldMap.metaTitle] = updated.seoTitle || updated.title;
        if (fieldMap.metaDescription) fieldData[fieldMap.metaDescription] = updated.seoMetaDescription || updated.metaDescription;
        if (fieldMap.publishDate) fieldData[fieldMap.publishDate] = new Date().toISOString();
        // background-generation-ok: legacy auto-publish follow-up; Phase 2 keeps this visible through jobs or a domain queue.
        createCollectionItem(collectionId, fieldData, false, token).then(async (result) => {
          if (result.success && result.itemId) {
            const publishResult = await publishCollectionItems(collectionId, [result.itemId], token);
            if (!publishResult.success) {
              updatePostField(req.params.workspaceId, req.params.postId, {
                webflowItemId: result.itemId,
                webflowCollectionId: collectionId,
              });
              log.warn(`Auto-publish failed for ${req.params.postId}: ${publishResult.error}`);
              return;
            }
            updatePostField(req.params.workspaceId, req.params.postId, {
              webflowItemId: result.itemId,
              webflowCollectionId: collectionId,
              publishedAt: new Date().toISOString(),
              publishedSlug: slug,
            });
            addActivity(req.params.workspaceId, 'content_published',
              `Auto-published "${updated.title}" to Webflow CMS on approval`,
              `Collection: ${ws.publishTarget!.collectionName} · Slug: ${slug}`,
              { postId: req.params.postId, itemId: result.itemId, collectionId, slug });
            // Record for outcome tracking — guard prevents duplicates if .then() fires more than once
            try {
              if (!getActionByWorkspaceAndSource(req.params.workspaceId, 'post', req.params.postId)) {
                const postAction = recordAction({ // recordAction-ok: workspaceId from validated route param
                  workspaceId: req.params.workspaceId,
                  actionType: 'content_published',
                  sourceType: 'post',
                  sourceId: req.params.postId,
                  pageUrl: slug ? `/${slug}` : null,
                  targetKeyword: updated.targetKeyword ?? null,
                  baselineSnapshot: {
                    captured_at: new Date().toISOString(),
                  },
                  attribution: 'platform_executed',
                });
                if (slug) {
                  void captureBaselineFromGsc(postAction.id, req.params.workspaceId, `/${slug}`);
                }
              }
            } catch (err) {
              log.warn({ err, postId: req.params.postId }, 'Failed to record outcome action for content publish');
            }
            broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.CONTENT_PUBLISHED, {
              postId: req.params.postId, itemId: result.itemId, slug, title: updated.title });
          } else {
            log.warn(`Auto-publish failed for ${req.params.postId}: ${result.error}`);
          }
        }).catch(err => {
          log.error({ err }, `Auto-publish error for ${req.params.postId}`);
        });
      }
    }
  }

  // Activity entry coalesced on the same 60s window as the snapshot above —
  // we only want one `content_updated` entry per editing session, not one per
  // 2s auto-save tick.
  if (isContentEdit && !withinEditCoalesceWindow) {
    addActivity(
      req.params.workspaceId,
      'content_updated',
      `Edited post "${updated.title}"`,
      `Fields: ${editedContentFields.join(', ')}`,
      { postId: req.params.postId, fields: editedContentFields },
    );
  }
  // Recompute totalWordCount server-side when content fields change (matches
  // the pattern in the client-edit route at public-content.ts).
  if (isContentEdit) {
    const introWords = countHtmlWords(updated.introduction || '');
    const conclusionWords = countHtmlWords(updated.conclusion || '');
    const sectionWords = updated.sections.reduce((sum: number, s: { wordCount?: number }) => sum + (s.wordCount || 0), 0);
    const newTotal = introWords + conclusionWords + sectionWords;
    if (newTotal !== updated.totalWordCount) {
      updatePostField(req.params.workspaceId, req.params.postId, { totalWordCount: newTotal });
      updated.totalWordCount = newTotal;
    }
  }
  const hasNonContentChange = Object.keys(req.body).some(f => !contentFields.includes(f));
  if (!isContentEdit || !withinEditCoalesceWindow || hasNonContentChange) {
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.POST_UPDATED, { postId: req.params.postId });
  }
  res.json(updated);
});

// Export post as markdown
router.get('/api/content-posts/:workspaceId/:postId/export/markdown', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const post = getPost(req.params.workspaceId, req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const md = exportPostMarkdown(post);
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${post.targetKeyword.replace(/[^a-z0-9]+/gi, '-')}.md"`);
  res.send(md);
});

// Export post as HTML
router.get('/api/content-posts/:workspaceId/:postId/export/html', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const post = getPost(req.params.workspaceId, req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const html = exportPostHTML(post);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// Export post as branded PDF-ready HTML (matching content brief export style)
router.get('/api/content-posts/:workspaceId/:postId/export/pdf', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const post = getPost(req.params.workspaceId, req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const html = renderPostHTML(post);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// AI auto-review checklist — runs AI against post content to pre-check objective items.
// Provenance-sensitive items are surfaced for human review only; the model does not
// have verified source evidence for factual accuracy or hallucination clearance.
router.post('/api/content-posts/:workspaceId/:postId/ai-review', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const post = getPost(req.params.workspaceId, req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const ws = getWorkspace(req.params.workspaceId);

  // Build full business context for brand voice checking
  const fullContext = await buildIntelPrompt(req.params.workspaceId, ['seoContext', 'learnings'], { verbosity: 'detailed' });

  // Build a text summary of the post content for AI analysis
  const allContent = [
    post.introduction || '',
    ...post.sections.map(s => s.content || ''),
    post.conclusion || '',
  ].join('\n').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  // Truncate to ~8000 chars to stay within token limits
  const contentSnippet = allContent.slice(0, 8000);

  const prompt = `You are a content quality reviewer. Analyze this blog post and evaluate each checklist item.
${fullContext}
Return a JSON object with these keys, each with a boolean "pass" and a brief "reason" string.
For "factual_accuracy" and "no_hallucinations", do NOT mark pass=true. You may identify claims
that need verification, but those items require human review against source material.

1. "factual_accuracy" — Identify suspicious claims, statistics, or unverifiable statements for human source checking. Always return pass=false.
2. "brand_voice" — Does the content match a professional ${ws?.name ? `brand voice for "${ws.name}"` : 'business brand voice'}? Is the tone consistent?
3. "internal_links" — Does the content include internal links (href attributes pointing to site pages)?
4. "no_hallucinations" — Identify possible made-up studies, fake quotes, invented statistics, or fabricated expert names for human source checking. Always return pass=false.
5. "meta_optimized" — Is the meta title "${post.seoTitle || post.title}" (${(post.seoTitle || post.title).length} chars) and meta description "${post.seoMetaDescription || post.metaDescription}" (${(post.seoMetaDescription || post.metaDescription).length} chars) well-optimized? Title should be 50-60 chars, description 150-160 chars, both should include the target keyword "${post.targetKeyword}".
6. "word_count_target" — The post is ${post.totalWordCount} words. The target was ${post.targetWordCount} words. Is it within 15% of the target?

Post content:
${contentSnippet}

Return ONLY valid JSON like:
{
  "factual_accuracy": { "pass": false, "reason": "Human source review required: ..." },
  "brand_voice": { "pass": true, "reason": "..." },
  "internal_links": { "pass": false, "reason": "..." },
  "no_hallucinations": { "pass": false, "reason": "Human source review required: ..." },
  "meta_optimized": { "pass": false, "reason": "..." },
  "word_count_target": { "pass": true, "reason": "..." }
}`;

  try {
    const result = await callAI({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1000,
      temperature: 0.3,
      responseFormat: { type: 'json_object' },
      feature: 'content-review',
      workspaceId: req.params.workspaceId,
    });

    const parsed = parseAIJson<Record<string, AIReviewResult>>(result.text);
    if (!parsed) {
      return res.status(500).json({ error: 'Failed to parse AI review response' });
    }

    log.info(`AI review completed for post ${post.id}`);
    res.json({ review: markProvenanceItemsForHumanReview(parsed) });
  } catch (err) {
    log.error({ err }, 'AI review failed');
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `AI review failed: ${msg}` });
  }
});

// AI fix — generates a targeted fix for a specific failed review item
router.post('/api/content-posts/:workspaceId/:postId/ai-fix',
  requireWorkspaceAccess('workspaceId'),
  validate(z.object({
    issueKey: z.enum([...ISSUE_KEYS] as [string, ...string[]]),
    reason: z.string().min(1).max(500),
  })),
  async (req, res) => {
    const { issueKey, reason } = req.body as { issueKey: IssueKey; reason: string };
    const post = getPost(req.params.workspaceId, req.params.postId);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    let field: AiFixResult['field'];
    let sectionIndex: number | undefined;
    let originalText: string;
    let userPrompt: string;

    switch (issueKey) {
      case 'internal_links': {
        const targetSection = post.sections.find(s => !s.content.includes('<a href'))
          ?? post.sections[0];
        if (!targetSection) return res.status(422).json({ error: 'No sections available' });
        const brief = getBrief(req.params.workspaceId, post.briefId);
        const suggestions = brief?.internalLinkSuggestions ?? [];
        field = 'section';
        sectionIndex = targetSection.index;
        originalText = targetSection.content;
        userPrompt = `Rewrite ONE sentence in this HTML section to include a relevant internal link using <a href="URL">anchor text</a>.
Available internal link suggestions: ${suggestions.length > 0 ? suggestions.join(', ') : 'Use a plausible internal link like /blog or /services'}.
Return the FULL SECTION HTML with exactly one new <a href="..."> tag added. Do not change any other content.

Issue reason: ${reason}

Section HTML:
${originalText}`;
        break;
      }
      case 'meta_optimized': {
        field = 'meta';
        originalText = JSON.stringify({
          seoTitle: post.seoTitle || post.title,
          seoMetaDescription: post.seoMetaDescription || post.metaDescription,
        });
        userPrompt = `Rewrite the SEO meta title and meta description for this blog post.
Target keyword: "${post.targetKeyword}"
Current title: "${post.seoTitle || post.title}"
Current description: "${post.seoMetaDescription || post.metaDescription}"
Requirements: Title 50-60 characters, description 150-160 characters, both include the target keyword.

Issue reason: ${reason}

Return ONLY valid JSON with no surrounding text:
{ "seoTitle": "...", "seoMetaDescription": "..." }`;
        break;
      }
      case 'word_count_target': {
        const doneSections = post.sections.filter(s => s.status === 'done');
        const candidates = doneSections.length > 0 ? doneSections : post.sections;
        if (candidates.length === 0) return res.status(422).json({ error: 'No sections available' });
        const targetSection = candidates.reduce((a, b) => a.wordCount < b.wordCount ? a : b);
        field = 'section';
        sectionIndex = targetSection.index;
        originalText = targetSection.content;
        userPrompt = `Expand this HTML section by approximately 20% to increase the post's overall word count.
Add meaningful, relevant content — not filler. Maintain the same HTML structure and tone.
Return the FULL EXPANDED SECTION HTML only.

Post word count: ${post.totalWordCount} (target: ${post.targetWordCount})
Issue reason: ${reason}

Section HTML:
${originalText}`;
        break;
      }
      case 'brand_voice': {
        field = 'introduction';
        originalText = post.introduction;
        const voiceProfile = getVoiceProfile(req.params.workspaceId);
        const voiceCtx = voiceProfile ? buildVoiceCalibrationContext(voiceProfile) : null;
        const voiceBlock = voiceCtx
          ? [voiceCtx.samplesText, voiceCtx.dnaText, voiceCtx.guardrailsText].filter(Boolean).join('\n')
          : '';
        userPrompt = `Rewrite this blog post introduction to better match the workspace's brand voice.
Keep the same topic, key points, and approximate length. Return the FULL INTRODUCTION HTML only.

Issue reason: ${reason}${voiceBlock ? `\n\nVoice guidelines:\n${voiceBlock}` : ''}

Introduction HTML:
${originalText}`;
        break;
      }
      case 'factual_accuracy':
      case 'no_hallucinations': {
        const targetSection = post.sections[0];
        if (!targetSection) return res.status(422).json({ error: 'No sections available' });
        field = 'section';
        sectionIndex = targetSection.index;
        originalText = targetSection.content;
        userPrompt = `Review this HTML section and rewrite any potentially inaccurate or unverifiable claims conservatively.
Replace suspicious statistics or quotes with general, verifiable statements. Do NOT add new statistics.
Return the FULL SECTION HTML with conservative rewrites applied.

Issue reason: ${reason}

Section HTML:
${originalText}`;
        break;
      }
      default:
        return res.status(400).json({ error: 'Unknown issue key' });
    }

    try {
      const aiResult = await callAI({
        messages: [{ role: 'user', content: userPrompt }],
        feature: 'content-fix',
        workspaceId: req.params.workspaceId,
        maxTokens: 2000,
        temperature: 0.3,
        ...(field === 'meta' ? { responseFormat: { type: 'json_object' as const } } : {}),
      });

      const rawSuggested = aiResult.text.trim();
      let suggestedText: string;

      if (field === 'meta') {
        let parsed: { seoTitle?: unknown; seoMetaDescription?: unknown } | null;
        try {
          parsed = parseAIJson<{ seoTitle?: unknown; seoMetaDescription?: unknown }>(rawSuggested);
        } catch { // catch-ok: SyntaxError from malformed AI JSON — expected failure path
          return res.status(500).json({ error: 'Failed to parse AI meta response' });
        }
        // Guard against AI returning literal `null` or a non-object (`'"a string"'`,
        // `'42'`) — JSON.parse accepts both but destructuring would throw a TypeError
        // that the outer catch turns into an opaque 500. Surface the real failure here.
        if (!parsed || typeof parsed !== 'object') {
          return res.status(500).json({ error: 'Failed to parse AI meta response' });
        }
        suggestedText = JSON.stringify({
          seoTitle: sanitizePlainText(typeof parsed.seoTitle === 'string' ? parsed.seoTitle : ''),
          seoMetaDescription: sanitizePlainText(typeof parsed.seoMetaDescription === 'string' ? parsed.seoMetaDescription : ''),
        });
      } else {
        suggestedText = sanitizeRichText(rawSuggested);
      }

      const targetSection = field === 'section' && sectionIndex !== undefined
        ? post.sections.find(s => s.index === sectionIndex)
        : undefined;
      const sectionLabel = targetSection ? `section "${targetSection.heading}"` : field;
      const explanation = `AI revised the ${sectionLabel} to address: ${sanitizePlainText(reason).slice(0, 100)}`;

      const result: AiFixResult = { field, sectionIndex, originalText, suggestedText, explanation };
      res.json(result);
    } catch (err) {
      log.error({ err }, 'AI fix failed');
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `AI fix failed: ${msg}` });
    }
  },
);

// --- Version History ---

// List versions for a post
router.get('/api/content-posts/:workspaceId/:postId/versions', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const versions = listPostVersions(req.params.workspaceId, req.params.postId);
  // Return lightweight list (omit full content to keep response small)
  res.json(versions.map(v => ({
    id: v.id,
    versionNumber: v.versionNumber,
    trigger: v.trigger,
    triggerDetail: v.triggerDetail,
    totalWordCount: v.totalWordCount,
    createdAt: v.createdAt,
  })));
});

// Get a specific version (full content)
router.get('/api/content-posts/:workspaceId/:postId/versions/:versionId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const version = getPostVersion(req.params.workspaceId, req.params.versionId);
  if (!version || version.postId !== req.params.postId) return res.status(404).json({ error: 'Version not found' });
  res.json(version);
});

// Revert to a specific version
router.post('/api/content-posts/:workspaceId/:postId/versions/:versionId/revert', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const reverted = revertToVersion(req.params.workspaceId, req.params.postId, req.params.versionId);
  if (!reverted) return res.status(404).json({ error: 'Post or version not found' });
  addActivity(
    req.params.workspaceId,
    'post_reverted',
    `Reverted "${reverted.title}" to a previous version`,
    undefined,
    { postId: reverted.id, versionId: req.params.versionId, action: 'post_reverted' },
  );
  notifyContentUpdated(req.params.workspaceId, {
    postId: reverted.id,
    versionId: req.params.versionId,
    action: 'post_reverted',
  });
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.POST_UPDATED, { postId: reverted.id });
  res.json(reverted);
});

// Score brand voice match
router.post('/api/content-posts/:workspaceId/:postId/score-voice', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const post = getPost(req.params.workspaceId, req.params.postId);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    const brief = getBrief(req.params.workspaceId, post.briefId);
    if (!brief) return res.status(404).json({ error: 'Brief not found' });

    const { voiceScore, voiceFeedback } = await scoreVoiceMatch(post, brief, req.params.workspaceId);
    if (voiceScore == null) {
      return res.status(500).json({ error: voiceFeedback || 'Voice scoring failed' });
    }
    const updated = updatePostField(req.params.workspaceId, req.params.postId, { voiceScore, voiceFeedback });

    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.POST_UPDATED, { postId: req.params.postId });
    res.json(updated);
  } catch (err) {
    log.error({ err }, `Voice scoring failed for post ${req.params.postId}`);
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg || 'Voice scoring failed' });
  }
});

// Delete a post
router.delete('/api/content-posts/:workspaceId/:postId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const existing = getPost(req.params.workspaceId, req.params.postId);
  if (!existing) return res.status(404).json({ error: 'Post not found' });
  deletePost(req.params.workspaceId, req.params.postId);
  addActivity(
    req.params.workspaceId,
    'content_updated',
    `Deleted post "${existing.title}"`,
    undefined,
    { postId: existing.id, action: 'post_deleted' },
  );
  notifyContentUpdated(req.params.workspaceId, { postId: existing.id, action: 'post_deleted', deleted: true });
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.POST_UPDATED, { postId: existing.id, deleted: true });
  res.json({ ok: true });
});

export default router;

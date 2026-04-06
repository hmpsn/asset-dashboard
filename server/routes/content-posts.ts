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
  savePost,
  updatePostField,
  deletePost,
  generatePost,
  regenerateSection,
  exportPostMarkdown,
  exportPostHTML,
  snapshotPostVersion,
  listPostVersions,
  getPostVersion,
  revertToVersion,
} from '../content-posts.js';
import { scoreVoiceMatch } from '../content-posts-ai.js';
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
import { callOpenAI, parseAIJson } from '../openai-helpers.js';
import { buildIntelPrompt } from '../workspace-intelligence.js';

const log = createLogger('content-posts');

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
router.post('/api/content-posts/:workspaceId/generate', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const { briefId } = req.body;
  if (!briefId) return res.status(400).json({ error: 'briefId required' });

  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  // No usage limit — posts are paid add-ons purchased via Stripe

  const brief = getBrief(req.params.workspaceId, briefId);
  if (!brief) return res.status(404).json({ error: 'Brief not found' });

  // Start generation in background — return skeleton immediately
  try {
    const postId = `post_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const skeleton = {
      id: postId,
      workspaceId: req.params.workspaceId,
      briefId: brief.id,
      targetKeyword: brief.targetKeyword,
      title: brief.suggestedTitle,
      metaDescription: brief.suggestedMetaDesc,
      introduction: '',
      sections: brief.outline.map((s, i) => ({
        index: i, heading: s.heading, content: '', wordCount: 0,
        targetWordCount: s.wordCount || 250, keywords: s.keywords || [],
        status: 'pending' as const,
      })),
      conclusion: '',
      totalWordCount: 0,
      targetWordCount: brief.wordCountTarget || 1800,
      status: 'generating' as const,
      unificationStatus: 'pending' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    savePost(req.params.workspaceId, skeleton);

    // Return skeleton to client immediately
    res.json(skeleton);

    // Generate in background — pass skeleton's postId so it updates the same post
    generatePost(req.params.workspaceId, brief, postId).then(() => {
      addActivity(req.params.workspaceId, 'post_generated', `Content generated for "${brief.targetKeyword}"`, `Title: ${brief.suggestedTitle}`);
    }).catch(err => {
      log.error({ err: err }, `Generation failed for ${req.params.workspaceId}:`);
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
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Regeneration failed' });
  }
});

// Update post fields (inline editing of title, sections, status, etc.)
// If status is changed to 'approved' and workspace has auto-publish configured,
// triggers publish-to-webflow in the background.
router.patch('/api/content-posts/:workspaceId/:postId', requireWorkspaceAccess('workspaceId'), (req, res, next) => {
  const previous = getPost(req.params.workspaceId, req.params.postId);

  // Snapshot before content-changing edits (not status-only changes)
  if (previous) {
    const contentFields = ['title', 'metaDescription', 'introduction', 'sections', 'conclusion', 'seoTitle', 'seoMetaDescription'];
    const isContentEdit = contentFields.some(f => f in req.body);
    if (isContentEdit) {
      const detail = contentFields.filter(f => f in req.body).join(',');
      snapshotPostVersion(previous, 'manual_edit', `field:${detail}`);
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

        createCollectionItem(collectionId, fieldData, false, token).then(async (result) => {
          if (result.success && result.itemId) {
            await publishCollectionItems(collectionId, [result.itemId], token);
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

// AI auto-review checklist — runs AI against post content to pre-check each item
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
Return a JSON object with these keys, each with a boolean "pass" and a brief "reason" string:

1. "factual_accuracy" — Does the content appear factually accurate? Flag any suspicious claims, made-up statistics, or unverifiable statements.
2. "brand_voice" — Does the content match a professional ${ws?.name ? `brand voice for "${ws.name}"` : 'business brand voice'}? Is the tone consistent?
3. "internal_links" — Does the content include internal links (href attributes pointing to site pages)?
4. "no_hallucinations" — Are there any signs of AI hallucination? Made-up studies, fake quotes, invented statistics, or fabricated expert names?
5. "meta_optimized" — Is the meta title "${post.seoTitle || post.title}" (${(post.seoTitle || post.title).length} chars) and meta description "${post.seoMetaDescription || post.metaDescription}" (${(post.seoMetaDescription || post.metaDescription).length} chars) well-optimized? Title should be 50-60 chars, description 150-160 chars, both should include the target keyword "${post.targetKeyword}".
6. "word_count_target" — The post is ${post.totalWordCount} words. The target was ${post.targetWordCount} words. Is it within 15% of the target?

Post content:
${contentSnippet}

Return ONLY valid JSON like:
{
  "factual_accuracy": { "pass": true, "reason": "..." },
  "brand_voice": { "pass": true, "reason": "..." },
  "internal_links": { "pass": false, "reason": "..." },
  "no_hallucinations": { "pass": true, "reason": "..." },
  "meta_optimized": { "pass": false, "reason": "..." },
  "word_count_target": { "pass": true, "reason": "..." }
}`;

  try {
    const result = await callOpenAI({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1000,
      temperature: 0.3,
      feature: 'content-review',
      workspaceId: req.params.workspaceId,
    });

    const parsed = parseAIJson<Record<string, { pass: boolean; reason: string }>>(result.text);
    if (!parsed) {
      return res.status(500).json({ error: 'Failed to parse AI review response' });
    }

    log.info(`AI review completed for post ${post.id}`);
    res.json({ review: parsed });
  } catch (err) {
    log.error({ err }, 'AI review failed');
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `AI review failed: ${msg}` });
  }
});

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
  addActivity(req.params.workspaceId, 'post_reverted', `Reverted "${reverted.title}" to a previous version`);
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

    broadcastToWorkspace(req.params.workspaceId, 'post-updated', { postId: req.params.postId });
    res.json(updated);
  } catch (err) {
    log.error({ err }, `Voice scoring failed for post ${req.params.postId}`);
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg || 'Voice scoring failed' });
  }
});

// Delete a post
router.delete('/api/content-posts/:workspaceId/:postId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  deletePost(req.params.workspaceId, req.params.postId);
  res.json({ ok: true });
});

export default router;

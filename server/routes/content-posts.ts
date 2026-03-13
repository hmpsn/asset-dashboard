/**
 * content-posts routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import { addActivity } from '../activity-log.js';
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
} from '../content-posts.js';
import { getWorkspace } from '../workspaces.js';
import { createLogger } from '../logger.js';

const log = createLogger('content-posts');

// --- Content Post Generator (#194) ---

// List all generated posts for a workspace
router.get('/api/content-posts/:workspaceId', (req, res) => {
  res.json(listPosts(req.params.workspaceId));
});

// Get a single post
router.get('/api/content-posts/:workspaceId/:postId', (req, res) => {
  const post = getPost(req.params.workspaceId, req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  res.json(post);
});

// Generate a full post from a brief (async — returns immediately with skeleton, generates in background)
router.post('/api/content-posts/:workspaceId/generate', async (req, res) => {
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
      log.error(`Generation failed for ${req.params.workspaceId}:`, err);
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to start generation' });
  }
});

// Regenerate a single section
router.post('/api/content-posts/:workspaceId/:postId/regenerate-section', async (req, res) => {
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
router.patch('/api/content-posts/:workspaceId/:postId', (req, res) => {
  const updated = updatePostField(req.params.workspaceId, req.params.postId, req.body);
  if (!updated) return res.status(404).json({ error: 'Post not found' });
  res.json(updated);
});

// Export post as markdown
router.get('/api/content-posts/:workspaceId/:postId/export/markdown', (req, res) => {
  const post = getPost(req.params.workspaceId, req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const md = exportPostMarkdown(post);
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${post.targetKeyword.replace(/[^a-z0-9]+/gi, '-')}.md"`);
  res.send(md);
});

// Export post as HTML
router.get('/api/content-posts/:workspaceId/:postId/export/html', (req, res) => {
  const post = getPost(req.params.workspaceId, req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const html = exportPostHTML(post);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// Delete a post
router.delete('/api/content-posts/:workspaceId/:postId', (req, res) => {
  deletePost(req.params.workspaceId, req.params.postId);
  res.json({ ok: true });
});

export default router;

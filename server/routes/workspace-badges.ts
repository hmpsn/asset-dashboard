/**
 * workspace-badges routes — lightweight endpoint for sidebar badge counts
 */
import { Router } from 'express';
import { getWorkspace } from '../workspaces.js';
import { listContentRequests } from '../content-requests.js';
import { listBriefs } from '../content-brief.js';
import { listPosts } from '../content-posts.js';

import { requireWorkspaceAccess } from '../auth.js';
const router = Router();

/**
 * GET /api/workspace-badges/:id
 *
 * Returns badge-count data so App.tsx doesn't need to fetch full content-requests,
 * content-briefs, and content-posts lists just to derive two numbers.
 */
router.get('/api/workspace-badges/:id', requireWorkspaceAccess(), (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  try {
    const contentRequests = listContentRequests(req.params.id);
    const briefs = listBriefs(req.params.id);
    const posts = listPosts(req.params.id);

    const pendingRequests = Array.isArray(contentRequests)
      ? contentRequests.filter((r: { status: string }) => r.status === 'requested').length
      : 0;
    const hasContent =
      (Array.isArray(contentRequests) && contentRequests.length > 0) ||
      (Array.isArray(briefs) && briefs.length > 0) ||
      (Array.isArray(posts) && posts.length > 0);

    res.json({ pendingRequests, hasContent });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to compute badges' });
  }
});

export default router;

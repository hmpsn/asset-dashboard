/**
 * content-posts routes — extracted from server/index.ts
 */
import { Router } from 'express';

import { requireWorkspaceAccess } from '../auth.js';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { getBrief } from '../content-brief.js';
import {
  listPosts,
  enrichPostsWithOutcomes,
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
import { countHtmlWords } from '../content-posts-ai.js';
import {
  aiFixPromptAndTarget,
  aiFixRequestSchema,
  startAiReviewJob,
  startAiFixJob,
  startVoiceScoreJob,
} from '../content-posts-ai-jobs.js';
import { invalidateContentPipelineIntelligence } from '../intelligence-freshness.js';
import { renderPostHTML } from '../post-export-html.js';
import { getWorkspace, getTokenForSite } from '../workspaces.js';
import { WS_EVENTS } from '../ws-events.js';
import { hasActiveJob, createJob } from '../jobs.js';
import { runContentPublishJob } from '../content-publish-job.js';
import { getInsights } from '../analytics-insights-store.js';
import { suggestPublishDates, suggestDraftSchedule } from '../content-calendar-intelligence.js';
import { validate, z } from '../middleware/validate.js';
import type { AiFixRequest, PostSection } from '../../shared/types/content.js';
import { CONTENT_GENERATION_STYLES } from '../../shared/types/content.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import { sanitizePlainText } from '../html-sanitize.js';

const router = Router();

const generatePostSchema = z.object({
  briefId: z.string({ required_error: 'briefId required' }).trim().min(1, 'briefId required'),
  generationStyle: z.enum(CONTENT_GENERATION_STYLES).optional(),
}).strict();

const postSectionUpdateSchema = z.object({
  index: z.number().int().min(0),
  heading: z.string(),
  content: z.string(),
  wordCount: z.number().int().min(0),
  targetWordCount: z.number().int().min(0).optional(),
  keywords: z.array(z.string()).optional(),
  status: z.enum(['pending', 'generating', 'done', 'error']).optional(),
}).strip();
// Top-level PATCH keys stay strict, but section objects strip unknown fields so
// legacy/frontend-only metadata cannot block editor saves or persist back to DB.

type PostSectionUpdate = z.infer<typeof postSectionUpdateSchema>;

function isCompletePostSection(section: PostSectionUpdate): section is PostSection {
  return section.targetWordCount !== undefined
    && section.keywords !== undefined
    && section.status !== undefined;
}

function mergeSectionUpdates(
  existingSections: PostSection[],
  sectionUpdates: PostSectionUpdate[],
): { sections: PostSection[] } | { error: string } {
  const existingByIndex = new Map(existingSections.map(section => [section.index, section]));
  const updatesByIndex = new Map<number, PostSectionUpdate>();
  for (const section of sectionUpdates) {
    if (updatesByIndex.has(section.index)) {
      return { error: `Duplicate section index ${section.index}` };
    }
    updatesByIndex.set(section.index, section);
  }

  const merged = existingSections.map((existing) => {
    const update = updatesByIndex.get(existing.index);
    if (!update) return existing;
    const status = update.status ?? existing.status;
    return {
      index: existing.index,
      heading: update.heading,
      content: update.content,
      wordCount: update.wordCount,
      targetWordCount: update.targetWordCount ?? existing.targetWordCount,
      keywords: update.keywords ?? existing.keywords,
      status,
      error: status === 'error' ? existing.error : undefined,
    };
  });

  for (const section of sectionUpdates) {
    if (existingByIndex.has(section.index)) continue;
    if (!isCompletePostSection(section)) {
      return { error: `Section ${section.index} is missing targetWordCount, keywords, or status` };
    }
    merged.push(section);
  }

  return { sections: merged };
}

function normalizeTrustedAdminSectionUpdates(sectionUpdates: PostSectionUpdate[]): PostSectionUpdate[] {
  return sectionUpdates.map(section => ({
    ...section,
    heading: sanitizePlainText(section.heading).trim(),
    keywords: section.keywords?.map(k => sanitizePlainText(k).trim()).filter(Boolean),
  }));
}

const regenerateSectionSchema = z.object({
  sectionIndex: z.number({ required_error: 'sectionIndex required' }).int().min(0),
}).strict();

// --- Content Post Generator (#194) ---

// List all generated posts for a workspace
router.get('/api/content-posts/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  // W5.1: badge published posts with their read-back outcome verdict (90-day
  // clicks/position delta). Read-side decoration; listPosts stays pure for the
  // many non-list consumers.
  res.json(enrichPostsWithOutcomes(req.params.workspaceId, listPosts(req.params.workspaceId)));
});

// W6.6 (Forward-planning calendar): propose publish dates for unscheduled drafts.
// Finally wires the previously-dead suggestPublishDates() — it derives page-level
// priorities from decay + ranking-opportunity insights, then spreads the workspace's
// unscheduled drafts (no plannedPublishAt, not published) across upcoming weekdays.
// Returns proposals only; the admin confirms each via the planned-date PATCH below.
//
// MUST be registered BEFORE the `/:postId` GET route — otherwise Express matches
// `suggest-dates` as a postId and returns 404 (literal-before-param ordering rule).
router.get('/api/content-posts/:workspaceId/suggest-dates', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const workspaceId = req.params.workspaceId;

  const drafts = listPosts(workspaceId).filter(p => !p.plannedPublishAt && !p.publishedAt && p.status !== 'generating');
  if (drafts.length === 0) {
    return res.json({ suggestions: [], unscheduledCount: 0 });
  }

  // Derive page priorities from analytics insights (the original consumer-less heuristic).
  const decayInsights = getInsights(workspaceId, 'content_decay').map(i => ({
    pageId: i.pageId ?? '',
    deltaPercent: (i.data as { deltaPercent: number }).deltaPercent,
    currentClicks: (i.data as { currentClicks: number }).currentClicks,
  })).filter(d => d.pageId);
  const quickWins = getInsights(workspaceId, 'ranking_opportunity').map(i => {
    const d = i.data as { pageUrl: string; query: string; estimatedTrafficGain: number };
    return { pageUrl: d.pageUrl, query: d.query, estimatedTrafficGain: d.estimatedTrafficGain };
  }).filter(q => q.pageUrl);

  const priorityPages = suggestPublishDates({ decayInsights, quickWins })
    .map(s => ({ pageUrl: s.pageUrl, priority: s.priority }));

  // Start from tomorrow so suggestions are unambiguously in the future.
  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() + 1);

  const schedule = suggestDraftSchedule({
    drafts: drafts.map(d => ({ id: d.id, targetKeyword: d.targetKeyword, pageHint: d.publishedSlug })),
    startDate,
    priorityPages,
  });

  const titleById = new Map(drafts.map(d => [d.id, d.title]));
  res.json({
    suggestions: schedule.map(s => ({ ...s, title: titleById.get(s.draftId) ?? '' })),
    unscheduledCount: drafts.length,
  });
});

// Get a single post
router.get('/api/content-posts/:workspaceId/:postId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const post = getPost(req.params.workspaceId, req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  res.json(post);
});

// Generate a full post from a brief (async — returns immediately with skeleton, generates in background)
router.post('/api/content-posts/:workspaceId/generate', requireWorkspaceAccess('workspaceId'), validate(generatePostSchema), async (req, res) => {
  const { briefId, generationStyle } = req.body;

  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  // No usage limit — posts are paid add-ons purchased via Stripe

  const brief = getBrief(req.params.workspaceId, briefId);
  if (!brief) return res.status(404).json({ error: 'Brief not found' });

  try {
    const activeJob = hasActiveJob(BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION, req.params.workspaceId);
    if (activeJob) return res.status(409).json({ error: 'Content post generation is already running for this workspace', jobId: activeJob.id });
    const started = createContentPostGenerationJob(req.params.workspaceId, brief, generationStyle);
    res.json({ ...started.post, jobId: started.jobId });
    runContentPostGenerationJob({
      workspaceId: req.params.workspaceId,
      brief: started.brief,
      postId: started.postId,
      jobId: started.jobId,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to start generation' });
  }
});

// Regenerate a single section
router.post('/api/content-posts/:workspaceId/:postId/regenerate-section', requireWorkspaceAccess('workspaceId'), validate(regenerateSectionSchema), async (req, res) => {
  const { sectionIndex } = req.body;

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
  sections: z.array(postSectionUpdateSchema).optional(),
  conclusion: z.string().optional(),
  seoTitle: z.string().max(200).optional(),
  seoMetaDescription: z.string().max(500).optional(),
  status: z.enum(['generating', 'draft', 'review', 'approved', 'error']).optional(),
  voiceScore: z.number().min(0).max(100).optional(),
  voiceFeedback: z.string().optional(),
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
  if (!previous) return res.status(404).json({ error: 'Post not found' });

  const updates = { ...req.body };
  if (typeof updates.title === 'string') updates.title = sanitizePlainText(updates.title).trim();
  if (typeof updates.metaDescription === 'string') updates.metaDescription = sanitizePlainText(updates.metaDescription).trim();
  if (typeof updates.seoTitle === 'string') updates.seoTitle = sanitizePlainText(updates.seoTitle).trim();
  if (typeof updates.seoMetaDescription === 'string') updates.seoMetaDescription = sanitizePlainText(updates.seoMetaDescription).trim();
  if (typeof updates.voiceFeedback === 'string') updates.voiceFeedback = sanitizePlainText(updates.voiceFeedback).trim();
  if (req.body.sections !== undefined) {
    const merged = mergeSectionUpdates(previous.sections, normalizeTrustedAdminSectionUpdates(req.body.sections));
    if ('error' in merged) return res.status(400).json({ error: merged.error });
    updates.sections = merged.sections;
  }

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
  if (isContentEdit) {
    const recentVersion = getMostRecentPostVersion(req.params.workspaceId, req.params.postId);
    withinEditCoalesceWindow = !!recentVersion
      && recentVersion.trigger === 'manual_edit'
      && recentVersion.triggerDetail !== 'client_edit'
      && (Date.now() - new Date(recentVersion.createdAt).getTime()) < ADMIN_EDIT_COALESCE_WINDOW_MS;
  }

  let updated;
  try {
    updated = updatePostField(req.params.workspaceId, req.params.postId, updates);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'InvalidTransitionError') {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
  if (!updated) return res.status(404).json({ error: 'Post not found' });
  if (isContentEdit && !withinEditCoalesceWindow) {
    snapshotPostVersion(previous, 'manual_edit', `field:${editedContentFields.join(',')}`);
  }

  // Auto-publish on approval — runs as a background CONTENT_PUBLISH job (C3, audit item #12).
  //
  // This used to be a silent fire-and-forget detached promise: failures only log.warn-ed and never
  // reached the operator, and it wrote a strict SUBSET of the field map (no summary, no featured
  // image). Now it dispatches a job that calls the SAME shared `publishPostToWebflow()` service the
  // manual route uses (single field map, single broadcast/activity/outcome/follow-on site), so
  // failures surface as job `error` + activity and the editor gets progress/failure UX via
  // useJobProgress + the CONTENT_PUBLISHED broadcast.
  //
  // The approve PATCH response is unchanged (`res.json(updated)` below, 200 + post) — publish was
  // already detached, so the response never carried publish results.
  if (req.body.status === 'approved' && previous.status !== 'approved' && !updated.webflowItemId) {
    const ws = getWorkspace(req.params.workspaceId);
    if (ws?.publishTarget && ws.webflowSiteId && getTokenForSite(ws.webflowSiteId)) {
      // Each approval gets its own job — no workspace-level hasActiveJob guard here,
      // because that would silently drop the second of two back-to-back approvals of
      // DIFFERENT posts (the guard cannot see postId). Same-post re-entry is already
      // safe: the job short-circuits on webflowItemId and the service re-reads the post.
      const publishJob = createJob(BACKGROUND_JOB_TYPES.CONTENT_PUBLISH, {
        workspaceId: req.params.workspaceId,
        message: 'Publishing to Webflow...',
      });
      const { workspaceId, postId } = req.params;
      setImmediate(() => {
        void runContentPublishJob({ jobId: publishJob.id, workspaceId, postId });
      });
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
  invalidateContentPipelineIntelligence(req.params.workspaceId);
  const hasNonContentChange = Object.keys(req.body).some(f => !contentFields.includes(f));
  if (!isContentEdit || !withinEditCoalesceWindow || hasNonContentChange) {
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.POST_UPDATED, { postId: req.params.postId });
  }
  res.json(updated);
});

// W6.6 (Forward-planning calendar): set or clear a post's planned/scheduled
// publish date. Admin-only — a separate, surgically-scoped route from the main
// PATCH handler above so the calendar's schedule-a-draft / suggest-dates flows have
// a single-purpose endpoint. `plannedPublishAt: null` clears the schedule.
// `.nullable()` lets the frontend clear by sending null; an absent key is rejected
// (strict) so the intent is always explicit.
const plannedPublishDateSchema = z.object({
  plannedPublishAt: z.string().datetime({ message: 'plannedPublishAt must be an ISO datetime' }).nullable(),
}).strict();

router.patch('/api/content-posts/:workspaceId/:postId/planned-date',
  requireWorkspaceAccess('workspaceId'),
  validate(plannedPublishDateSchema),
  (req, res) => {
    const post = getPost(req.params.workspaceId, req.params.postId);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const plannedPublishAt: string | undefined = req.body.plannedPublishAt ?? undefined;
    const updated = updatePostField(req.params.workspaceId, req.params.postId, { plannedPublishAt });
    if (!updated) return res.status(404).json({ error: 'Post not found' });

    addActivity(
      req.params.workspaceId,
      'content_updated',
      plannedPublishAt
        ? `Scheduled "${updated.title}" for ${plannedPublishAt.slice(0, 10)}`
        : `Cleared planned date for "${updated.title}"`,
      undefined,
      { postId: updated.id, action: 'post_planned_date_updated', plannedPublishAt: plannedPublishAt ?? null },
    );
    invalidateContentPipelineIntelligence(req.params.workspaceId);
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.POST_UPDATED, { postId: updated.id });
    res.json(updated);
  },
);

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
// W6.2: moved onto the background job platform (held HTTP open 30s+, no jobId, no dedupe).
// The CONTENT_POST_REVIEW job persists the verdicts to the post (aiReview) and returns
// { review, evidence } in job.result for the editor to read back. Provenance-sensitive
// items are surfaced for human review only inside the worker.
router.post('/api/content-posts/:workspaceId/:postId/ai-review', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const post = getPost(req.params.workspaceId, req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const activeJob = hasActiveJob(BACKGROUND_JOB_TYPES.CONTENT_POST_REVIEW, req.params.workspaceId);
  if (activeJob) return res.status(409).json({ error: 'An AI review is already running for this workspace', jobId: activeJob.id });
  const started = startAiReviewJob({ workspaceId: req.params.workspaceId, postId: req.params.postId });
  res.status(202).json(started);
});

// AI fix — generates a targeted fix for a specific failed review item.
// W6.2: moved onto the background job platform. The full-post rewrite path is
// 8000 tokens / ~90s — far too long to hold an HTTP connection. Upfront prompt-target
// validation (Section not found / Unknown issue key) runs synchronously so the route
// can still return the correct 4xx; the AI call runs in the CONTENT_POST_FIX job and
// the AiFixResult draft lands in job.result for review-before-apply.
router.post('/api/content-posts/:workspaceId/:postId/ai-fix',
  requireWorkspaceAccess('workspaceId'),
  validate(aiFixRequestSchema),
  (req, res) => {
    const body = req.body as AiFixRequest;
    const post = getPost(req.params.workspaceId, req.params.postId);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    // Validate the prompt target up front so target/issue-key errors return the
    // right HTTP status instead of failing silently inside the async job.
    const promptTarget = aiFixPromptAndTarget(req.params.workspaceId, post, body);
    if ('error' in promptTarget) {
      return res.status(promptTarget.error === 'Unknown issue key' ? 400 : 422).json({ error: promptTarget.error });
    }

    const activeJob = hasActiveJob(BACKGROUND_JOB_TYPES.CONTENT_POST_FIX, req.params.workspaceId);
    if (activeJob) return res.status(409).json({ error: 'An AI fix is already running for this workspace', jobId: activeJob.id });
    const started = startAiFixJob({ workspaceId: req.params.workspaceId, postId: req.params.postId, body });
    res.status(202).json(started);
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

// Score brand voice match (async — returns 202 { jobId })
// W6.2: moved onto the background job platform. The CONTENT_POST_VOICE_SCORE job
// persists voiceScore/voiceFeedback to the post and returns the updated post in
// job.result. Failures surface via the job error state.
router.post('/api/content-posts/:workspaceId/:postId/score-voice', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const post = getPost(req.params.workspaceId, req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const brief = getBrief(req.params.workspaceId, post.briefId);
  if (!brief) return res.status(404).json({ error: 'Brief not found' });
  const activeJob = hasActiveJob(BACKGROUND_JOB_TYPES.CONTENT_POST_VOICE_SCORE, req.params.workspaceId);
  if (activeJob) return res.status(409).json({ error: 'Voice scoring is already running for this workspace', jobId: activeJob.id });
  const started = startVoiceScoreJob({ workspaceId: req.params.workspaceId, postId: req.params.postId });
  res.status(202).json(started);
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

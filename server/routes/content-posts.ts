/**
 * content-posts routes — extracted from server/index.ts
 */
import { Router } from 'express';
import { isDeepStrictEqual } from 'node:util';

import { requireWorkspaceAccess } from '../auth.js';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { getBrief } from '../content-brief.js';
import {
  listPosts,
  enrichPostsWithOutcomes,
  getPost,
  updatePostField,
  updatePostFieldWithSnapshot,
  deletePostAtRevision,
  createContentPostGenerationJob,
  runContentPostGenerationJob,
  regenerateSection,
  ContentSectionRegenerationError,
  exportPostMarkdown,
  exportPostHTML,
  listPostVersions,
  getPostVersion,
  revertToVersion,
  getMostRecentPostVersion,
} from '../content-posts.js';
import { countHtmlWords } from '../content-posts-ai.js';
import {
  AiFixApplyError,
  applyAiFixJobResult,
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
import {
  ActiveJobResourceConflict,
  createResourceScopedJob,
  getJob,
  runResourceScopedJobWorker,
  updateJob,
} from '../jobs.js';
import {
  createContentPublishJob,
  runContentPublishJob,
} from '../content-publish-job.js';
import type { ContentPublishAuthority } from '../domains/content/publish-post-to-webflow.js';
import { getInsights } from '../analytics-insights-store.js';
import { suggestPublishDates, suggestDraftSchedule } from '../content-calendar-intelligence.js';
import { validate, z } from '../middleware/validate.js';
import type {
  AiFixRequest,
  ContentCalendarDateSuggestion,
  ContentCalendarDateSuggestionsResponse,
  PersistedContentBrief,
  PostSection,
} from '../../shared/types/content.js';
import { CONTENT_GENERATION_STYLES } from '../../shared/types/content.js';
import { BACKGROUND_JOB_TYPES, JOB_RESOURCE_TYPES } from '../../shared/types/background-jobs.js';
import { sanitizePlainText } from '../html-sanitize.js';
import { IncompleteContentPostError, isPostDeliverable } from '../domains/content/generation-integrity.js';
import { GenerationRevisionConflictError } from '../generation-provenance.js';
import { createLogger } from '../logger.js';
import { UnresolvedContentPublishReconciliationError } from '../content-publish-reconciliation.js';

const router = Router();
const log = createLogger('content-posts-routes');
const expectedRevisionSchema = z.number().int().nonnegative();

function runPostRoutePostCommitEffect(
  workspaceId: string,
  postId: string,
  effect: string,
  callback: () => void,
): void {
  try {
    callback();
  } catch (err) {
    log.warn({ err, workspaceId, postId, effect }, 'content post route post-commit effect failed');
  }
}

function persistCommittedSectionRegeneration(
  jobId: string,
  postId: string,
  sectionIndex: number,
  generationRevision: number,
): string | null {
  try {
    updateJob(jobId, {
      status: 'done',
      message: `Regenerated section ${sectionIndex + 1}`,
      result: { postId, sectionIndex, generationRevision },
    });
    if (getJob(jobId)?.status !== 'done') {
      throw new Error('Committed section regeneration completion was not persisted');
    }
    return null;
  } catch (err) {
    if (getJob(jobId)?.status === 'done') return null;
    const error = err instanceof Error ? err.message : String(err);
    try {
      updateJob(jobId, {
        status: 'error',
        message: 'Section regenerated, but completion tracking failed',
        error,
        result: {
          postId,
          sectionIndex,
          generationRevision,
          code: 'completion_tracking_failed',
          artifactCommitted: true,
        },
      });
    } catch (fallbackErr) {
      log.error({ err: fallbackErr, jobId, postId, sectionIndex }, 'Committed section regeneration could not be recorded');
    }
    return error;
  }
}

function conflictResponse(err: unknown): { error: string; code: string; jobId?: string } | null {
  if (err instanceof GenerationRevisionConflictError) {
    return { error: err.message, code: err.code };
  }
  if (err instanceof ActiveJobResourceConflict) {
    return { error: err.message, code: err.code, jobId: err.jobId };
  }
  if (err instanceof UnresolvedContentPublishReconciliationError) {
    return { error: err.message, code: err.code };
  }
  return null;
}

const generatePostSchema = z.object({
  briefId: z.string({ required_error: 'briefId required' }).trim().min(1, 'briefId required'),
  expectedBriefRevision: expectedRevisionSchema,
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
  expectedRevision: expectedRevisionSchema,
  expectedBriefRevision: expectedRevisionSchema,
}).strict();

const revisionCommandSchema = z.object({
  expectedRevision: expectedRevisionSchema,
}).strict();

const aiFixRouteSchema = z.object({
  expectedRevision: expectedRevisionSchema,
}).passthrough().superRefine((value, ctx) => {
  const { expectedRevision: _expectedRevision, ...body } = value;
  const parsed = aiFixRequestSchema.safeParse(body);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) ctx.addIssue(issue);
  }
});

const aiFixApplySchema = z.object({
  jobId: z.string().uuid(),
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

  const drafts = listPosts(workspaceId).filter(p => !p.plannedPublishAt && !p.publishedAt && p.status === 'draft');
  if (drafts.length === 0) {
    const response: ContentCalendarDateSuggestionsResponse = { suggestions: [], unscheduledCount: 0 };
    return res.json(response);
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

  const draftById = new Map(drafts.map(draft => [draft.id, draft]));
  const suggestions: ContentCalendarDateSuggestion[] = [];
  for (const scheduled of schedule) {
    const draft = draftById.get(scheduled.draftId);
    if (!draft || draft.generationRevision === undefined) {
      log.error({ workspaceId, postId: scheduled.draftId }, 'calendar proposal source authority is unavailable');
      return res.status(500).json({ error: 'Could not establish proposal source authority' });
    }
    suggestions.push({
      ...scheduled,
      title: draft.title,
      generationRevision: draft.generationRevision,
    });
  }
  const response: ContentCalendarDateSuggestionsResponse = {
    suggestions,
    unscheduledCount: drafts.length,
  };
  res.json(response);
});

// Get a single post
router.get('/api/content-posts/:workspaceId/:postId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const post = getPost(req.params.workspaceId, req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  res.json(post);
});

// Generate a full post from a brief (async — returns immediately with skeleton, generates in background)
router.post('/api/content-posts/:workspaceId/generate', requireWorkspaceAccess('workspaceId'), validate(generatePostSchema), async (req, res) => {
  const { briefId, generationStyle, expectedBriefRevision } = req.body;

  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  // No usage limit — posts are paid add-ons purchased via Stripe

  const brief = getBrief(req.params.workspaceId, briefId);
  if (!brief) return res.status(404).json({ error: 'Brief not found' });

  try {
    const started = createContentPostGenerationJob(
      req.params.workspaceId,
      brief,
      generationStyle,
      expectedBriefRevision,
    );
    res.json({ ...started.post, jobId: started.jobId });
    runContentPostGenerationJob({
      workspaceId: req.params.workspaceId,
      brief: started.brief,
      postId: started.postId,
      jobId: started.jobId,
      expectedRevision: started.expectedRevision,
    });
  } catch (err) {
    const conflict = conflictResponse(err);
    if (conflict) return res.status(409).json(conflict);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to start generation' });
  }
});

// Regenerate a single section
router.post('/api/content-posts/:workspaceId/:postId/regenerate-section', requireWorkspaceAccess('workspaceId'), validate(regenerateSectionSchema), async (req, res) => {
  const { sectionIndex, expectedRevision, expectedBriefRevision } = req.body;

  const post = getPost(req.params.workspaceId, req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const brief = getBrief(req.params.workspaceId, post.briefId);
  if (!brief) return res.status(404).json({ error: 'Source brief not found' });
  if (sectionIndex < 0 || sectionIndex >= post.sections.length) {
    return res.status(404).json({ error: 'Section not found' });
  }

  let jobId: string | undefined;
  try {
    const started = createResourceScopedJob<PersistedContentBrief>(BACKGROUND_JOB_TYPES.CONTENT_POST_FIX, {
      workspaceId: req.params.workspaceId,
      message: `Regenerating section ${sectionIndex + 1}...`,
      resources: [
        {
          resourceType: JOB_RESOURCE_TYPES.CONTENT_BRIEF,
          resourceId: brief.id,
        },
        {
          resourceType: JOB_RESOURCE_TYPES.CONTENT_POST,
          resourceId: req.params.postId,
        },
      ],
      accept: () => {
        const current = getPost(req.params.workspaceId, req.params.postId);
        if (!current || current.generationRevision !== expectedRevision) {
          throw new GenerationRevisionConflictError(
            'content_post',
            req.params.postId,
            expectedRevision,
          );
        }
        const currentBrief = getBrief(req.params.workspaceId, current.briefId);
        if (!currentBrief || currentBrief.generationRevision !== expectedBriefRevision) {
          throw new GenerationRevisionConflictError(
            'content_brief',
            current.briefId,
            expectedBriefRevision,
          );
        }
        return currentBrief;
      },
    });
    jobId = started.job.id;
    const outcome = await runResourceScopedJobWorker(started.job.id, async () => {
      updateJob(started.job.id, {
        status: 'running',
        message: `Regenerating section ${sectionIndex + 1}...`,
      });
      let result: Awaited<ReturnType<typeof regenerateSection>>;
      try {
        result = await regenerateSection(
          req.params.workspaceId,
          req.params.postId,
          sectionIndex,
          started.accepted,
          expectedRevision,
          expectedBriefRevision,
        );
        if (!result) throw new Error('Section not found');
      } catch (err) {
        updateJob(started.job.id, {
          status: 'error',
          message: `Section ${sectionIndex + 1} regeneration failed`,
          error: err instanceof Error ? err.message : String(err),
          result: { postId: req.params.postId, sectionIndex, status: 'error' },
        });
        throw err;
      }
      const completionTrackingError = persistCommittedSectionRegeneration(
        started.job.id,
        result.id,
        sectionIndex,
        result.generationRevision,
      );
      return { updated: result, completionTrackingError };
    });
    if (outcome.completionTrackingError) {
      return res.status(500).json({
        error: 'Section regenerated, but completion tracking failed',
        code: 'completion_tracking_failed',
        artifactCommitted: true,
        jobId: started.job.id,
        postId: outcome.updated.id,
        sectionIndex,
        generationRevision: outcome.updated.generationRevision,
      });
    }
    const updated = outcome.updated;
    runPostRoutePostCommitEffect(req.params.workspaceId, updated.id, 'activity', () => {
      addActivity(
        req.params.workspaceId,
        'content_updated',
        `Regenerated section ${sectionIndex + 1} for "${updated.title}"`,
        undefined,
        { postId: updated.id, sectionIndex, action: 'post_section_regenerated' },
      );
    });
    runPostRoutePostCommitEffect(req.params.workspaceId, updated.id, 'intelligence-cache', () => {
      invalidateContentPipelineIntelligence(req.params.workspaceId);
    });
    runPostRoutePostCommitEffect(req.params.workspaceId, updated.id, 'content-updated-broadcast', () => {
      broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.CONTENT_UPDATED, {
        domain: 'content-posts',
        postId: updated.id,
        sectionIndex,
        action: 'post_section_regenerated',
      });
    });
    runPostRoutePostCommitEffect(req.params.workspaceId, updated.id, 'post-updated-broadcast', () => {
      broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.POST_UPDATED, { postId: updated.id });
    });
    res.json(updated);
  } catch (err) {
    const conflict = conflictResponse(err);
    if (conflict) return res.status(409).json(conflict);
    if (err instanceof ContentSectionRegenerationError) {
      return res.status(502).json({ error: err.message, diagnostic: err.diagnostic });
    }
    res.status(500).json({ error: 'Regeneration failed', ...(jobId ? { jobId } : {}) });
  }
});

const updatePostSchema = z.object({
  expectedRevision: expectedRevisionSchema,
  title: z.string().max(500).optional(),
  metaDescription: z.string().max(500).optional(),
  introduction: z.string().optional(),
  sections: z.array(postSectionUpdateSchema).optional(),
  conclusion: z.string().optional(),
  seoTitle: z.string().max(200).optional(),
  seoMetaDescription: z.string().max(500).optional(),
  status: z.enum(['generating', 'needs_attention', 'draft', 'review', 'approved', 'error']).optional(),
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

  const { expectedRevision, ...requestedUpdates } = req.body;
  const updates: Parameters<typeof updatePostField>[2] = { ...requestedUpdates };
  if (typeof updates.title === 'string') updates.title = sanitizePlainText(updates.title).trim();
  if (typeof updates.metaDescription === 'string') updates.metaDescription = sanitizePlainText(updates.metaDescription).trim();
  if (typeof updates.seoTitle === 'string') updates.seoTitle = sanitizePlainText(updates.seoTitle).trim();
  if (typeof updates.seoMetaDescription === 'string') updates.seoMetaDescription = sanitizePlainText(updates.seoMetaDescription).trim();
  if (typeof updates.voiceFeedback === 'string') updates.voiceFeedback = sanitizePlainText(updates.voiceFeedback).trim();
  if (requestedUpdates.sections !== undefined) {
    const merged = mergeSectionUpdates(previous.sections, normalizeTrustedAdminSectionUpdates(requestedUpdates.sections));
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
  const editedContentFields = contentFields.filter((field) => {
    if (!(field in requestedUpdates)) return false;
    const key = field as keyof typeof updates;
    return !isDeepStrictEqual(previous[key], updates[key]);
  });
  const isContentEdit = editedContentFields.length > 0;
  let withinEditCoalesceWindow = false;
  if (isContentEdit) {
    const recentVersion = getMostRecentPostVersion(req.params.workspaceId, req.params.postId);
    withinEditCoalesceWindow = !!recentVersion
      && recentVersion.trigger === 'manual_edit'
      && recentVersion.triggerDetail !== 'client_edit'
      && (Date.now() - new Date(recentVersion.createdAt).getTime()) < ADMIN_EDIT_COALESCE_WINDOW_MS;
  }

  // Word count is part of this same human mutation. Computing it before the CAS
  // avoids a second revision bump and prevents a newer edit from being overwritten.
  if (isContentEdit) {
    const introduction = typeof updates.introduction === 'string'
      ? updates.introduction
      : previous.introduction;
    const conclusion = typeof updates.conclusion === 'string'
      ? updates.conclusion
      : previous.conclusion;
    const sections = Array.isArray(updates.sections) ? updates.sections : previous.sections;
    updates.totalWordCount = countHtmlWords(introduction || '')
      + countHtmlWords(conclusion || '')
      + sections.reduce((sum, section) => sum + section.wordCount, 0);
  }

  const applyUpdate = () => isContentEdit && !withinEditCoalesceWindow
    ? updatePostFieldWithSnapshot(
        req.params.workspaceId,
        req.params.postId,
        updates,
        expectedRevision,
        { trigger: 'manual_edit', triggerDetail: `field:${editedContentFields.join(',')}` },
      )
    : updatePostField(
        req.params.workspaceId,
        req.params.postId,
        updates,
        expectedRevision,
      );

  let updated;
  let publishJobId: string | undefined;
  let publishAuthority: ContentPublishAuthority | undefined;
  let publishDispatchError: unknown;
  try {
    const ws = requestedUpdates.status === 'approved'
      && previous.status !== 'approved'
      && !previous.webflowItemId
      ? getWorkspace(req.params.workspaceId)
      : undefined;
    const shouldAutoPublish = Boolean(
      ws?.publishTarget
      && ws.webflowSiteId
      && getTokenForSite(ws.webflowSiteId),
    );
    // The human lifecycle decision commits first. An in-flight AI/publish claim
    // must never prevent approval from becoming authoritative; its later CAS
    // loses to this revision. Auto-publish is a follow-on side effect.
    updated = applyUpdate();
    if (shouldAutoPublish && updated && updated.generationRevision !== expectedRevision) {
      try {
        const started = createContentPublishJob({
          workspaceId: req.params.workspaceId,
          postId: req.params.postId,
          expectedRevision: updated.generationRevision,
          message: 'Publishing to Webflow...',
        });
        publishJobId = started.job.id;
        publishAuthority = started.accepted.authority;
      } catch (err) {
        publishDispatchError = err;
      }
    }
  } catch (err: unknown) {
    const conflict = conflictResponse(err);
    if (conflict) return res.status(409).json(conflict);
    if (err instanceof Error && err.name === 'InvalidTransitionError') {
      return res.status(400).json({ error: err.message });
    }
    if (err instanceof IncompleteContentPostError) {
      return res.status(409).json({ error: err.message });
    }
    return next(err);
  }
  if (!updated) return res.status(404).json({ error: 'Post not found' });
  if (updated.generationRevision === expectedRevision) return res.json(updated);

  if (publishDispatchError) {
    const activeJobId = publishDispatchError instanceof ActiveJobResourceConflict
      ? publishDispatchError.jobId
      : undefined;
    runPostRoutePostCommitEffect(req.params.workspaceId, updated.id, 'auto-publish-deferred-activity', () => {
      addActivity(
        req.params.workspaceId,
        'content_publish_failed',
        `Auto-publish of "${updated.title}" was deferred`,
        activeJobId
          ? 'Another content operation was still running. The approval was saved; publish again after it finishes.'
          : publishDispatchError instanceof Error
            ? publishDispatchError.message
            : 'The publish job could not be started.',
        {
          postId: updated.id,
          source: 'auto-publish',
          code: publishDispatchError instanceof ActiveJobResourceConflict
            ? publishDispatchError.code
            : 'dispatch_failed',
          ...(activeJobId ? { activeJobId } : {}),
        },
      );
    });
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
  if (publishJobId && publishAuthority) {
    const { workspaceId, postId } = req.params;
    setImmediate(() => {
      void runContentPublishJob({
        jobId: publishJobId,
        workspaceId,
        postId,
        expectedRevision: updated.generationRevision,
        authority: publishAuthority,
      });
    });
  }

  // Activity entry coalesced on the same 60s window as the snapshot above —
  // we only want one `content_updated` entry per editing session, not one per
  // 2s auto-save tick.
  if (isContentEdit && !withinEditCoalesceWindow) {
    runPostRoutePostCommitEffect(req.params.workspaceId, updated.id, 'edit-activity', () => {
      addActivity(
        req.params.workspaceId,
        'content_updated',
        `Edited post "${updated.title}"`,
        `Fields: ${editedContentFields.join(', ')}`,
        { postId: req.params.postId, fields: editedContentFields },
      );
    });
  }
  runPostRoutePostCommitEffect(req.params.workspaceId, updated.id, 'intelligence-cache', () => {
    invalidateContentPipelineIntelligence(req.params.workspaceId);
  });
  const hasNonContentChange = Object.keys(requestedUpdates).some(f => !contentFields.includes(f));
  if (!isContentEdit || !withinEditCoalesceWindow || hasNonContentChange) {
    runPostRoutePostCommitEffect(req.params.workspaceId, updated.id, 'post-updated-broadcast', () => {
      broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.POST_UPDATED, { postId: req.params.postId });
    });
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
  expectedRevision: expectedRevisionSchema,
}).strict();

router.patch('/api/content-posts/:workspaceId/:postId/planned-date',
  requireWorkspaceAccess('workspaceId'),
  validate(plannedPublishDateSchema),
  (req, res) => {
    const post = getPost(req.params.workspaceId, req.params.postId);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const plannedPublishAt: string | undefined = req.body.plannedPublishAt ?? undefined;
    let updated;
    try {
      updated = updatePostField(
        req.params.workspaceId,
        req.params.postId,
        { plannedPublishAt },
        req.body.expectedRevision,
      );
    } catch (err) {
      const conflict = conflictResponse(err);
      if (conflict) return res.status(409).json(conflict);
      throw err;
    }
    if (!updated) return res.status(404).json({ error: 'Post not found' });
    if (updated.generationRevision === req.body.expectedRevision) return res.json(updated);

    runPostRoutePostCommitEffect(req.params.workspaceId, updated.id, 'planned-date-activity', () => {
      addActivity(
        req.params.workspaceId,
        'content_updated',
        plannedPublishAt
          ? `Scheduled "${updated.title}" for ${plannedPublishAt.slice(0, 10)}`
          : `Cleared planned date for "${updated.title}"`,
        undefined,
        { postId: updated.id, action: 'post_planned_date_updated', plannedPublishAt: plannedPublishAt ?? null },
      );
    });
    runPostRoutePostCommitEffect(req.params.workspaceId, updated.id, 'intelligence-cache', () => {
      invalidateContentPipelineIntelligence(req.params.workspaceId);
    });
    runPostRoutePostCommitEffect(req.params.workspaceId, updated.id, 'post-updated-broadcast', () => {
      broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.POST_UPDATED, { postId: updated.id });
    });
    res.json(updated);
  },
);

// Export post as markdown
router.get('/api/content-posts/:workspaceId/:postId/export/markdown', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const post = getPost(req.params.workspaceId, req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (!isPostDeliverable(post)) return res.status(409).json({ error: 'Post is incomplete and cannot be exported' });
  const md = exportPostMarkdown(post);
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${post.targetKeyword.replace(/[^a-z0-9]+/gi, '-')}.md"`);
  res.send(md);
});

// Export post as HTML
router.get('/api/content-posts/:workspaceId/:postId/export/html', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const post = getPost(req.params.workspaceId, req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (!isPostDeliverable(post)) return res.status(409).json({ error: 'Post is incomplete and cannot be exported' });
  const html = exportPostHTML(post);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// Export post as branded PDF-ready HTML (matching content brief export style)
router.get('/api/content-posts/:workspaceId/:postId/export/pdf', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const post = getPost(req.params.workspaceId, req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (!isPostDeliverable(post)) return res.status(409).json({ error: 'Post is incomplete and cannot be exported' });
  const html = renderPostHTML(post);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// AI auto-review checklist — runs AI against post content to pre-check objective items.
// W6.2: moved onto the background job platform (held HTTP open 30s+, no jobId, no dedupe).
// The CONTENT_POST_REVIEW job persists the verdicts to the post (aiReview) and returns
// { review, evidence } in job.result for the editor to read back. Provenance-sensitive
// items are surfaced for human review only inside the worker.
router.post('/api/content-posts/:workspaceId/:postId/ai-review', requireWorkspaceAccess('workspaceId'), validate(revisionCommandSchema), (req, res) => {
  const post = getPost(req.params.workspaceId, req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  try {
    const started = startAiReviewJob({
      workspaceId: req.params.workspaceId,
      postId: req.params.postId,
      expectedRevision: req.body.expectedRevision,
    });
    res.status(202).json(started);
  } catch (err) {
    const conflict = conflictResponse(err);
    if (conflict) return res.status(409).json(conflict);
    throw err;
  }
});

// AI fix — generates a targeted fix for a specific failed review item.
// W6.2: moved onto the background job platform. The full-post rewrite path is
// 8000 tokens / ~90s — far too long to hold an HTTP connection. Upfront prompt-target
// validation (Section not found / Unknown issue key) runs synchronously so the route
// can still return the correct 4xx; the AI call runs in the CONTENT_POST_FIX job and
// the AiFixResult draft lands in job.result for review-before-apply.
router.post('/api/content-posts/:workspaceId/:postId/ai-fix',
  requireWorkspaceAccess('workspaceId'),
  validate(aiFixRouteSchema),
  (req, res) => {
    const { expectedRevision, ...rawBody } = req.body;
    const body = rawBody as AiFixRequest;
    const post = getPost(req.params.workspaceId, req.params.postId);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    // Validate the prompt target up front so target/issue-key errors return the
    // right HTTP status instead of failing silently inside the async job.
    const promptTarget = aiFixPromptAndTarget(req.params.workspaceId, post, body);
    if ('error' in promptTarget) {
      return res.status(promptTarget.error === 'Unknown issue key' ? 400 : 422).json({ error: promptTarget.error });
    }

    try {
      const started = startAiFixJob({
        workspaceId: req.params.workspaceId,
        postId: req.params.postId,
        body,
        expectedRevision,
      });
      res.status(202).json(started);
    } catch (err) {
      const conflict = conflictResponse(err);
      if (conflict) return res.status(409).json(conflict);
      throw err;
    }
  },
);

// Explicit adoption boundary for a reviewed AI fix. The client sends only the
// durable job identity; the server reloads the stored suggestion, source revision,
// resource claim, and worker provenance before committing the repair atomically.
router.post('/api/content-posts/:workspaceId/:postId/ai-fix/apply',
  requireWorkspaceAccess('workspaceId'),
  validate(aiFixApplySchema),
  (req, res) => {
    try {
      const updated = applyAiFixJobResult(
        req.params.workspaceId,
        req.params.postId,
        req.body.jobId,
      );
      res.json(updated);
    } catch (err) {
      const conflict = conflictResponse(err);
      if (conflict) return res.status(409).json(conflict);
      if (err instanceof AiFixApplyError) {
        return res.status(err.statusCode).json({ error: err.message, code: err.code });
      }
      throw err;
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
router.post('/api/content-posts/:workspaceId/:postId/versions/:versionId/revert', requireWorkspaceAccess('workspaceId'), validate(revisionCommandSchema), (req, res) => {
  let reverted;
  try {
    reverted = revertToVersion(
      req.params.workspaceId,
      req.params.postId,
      req.params.versionId,
      req.body.expectedRevision,
    );
  } catch (err) {
    const conflict = conflictResponse(err);
    if (conflict) return res.status(409).json(conflict);
    throw err;
  }
  if (!reverted) return res.status(404).json({ error: 'Post or version not found' });
  runPostRoutePostCommitEffect(req.params.workspaceId, reverted.id, 'revert-activity', () => {
    addActivity(
      req.params.workspaceId,
      'post_reverted',
      `Reverted "${reverted.title}" to a previous version`,
      undefined,
      { postId: reverted.id, versionId: req.params.versionId, action: 'post_reverted' },
    );
  });
  runPostRoutePostCommitEffect(req.params.workspaceId, reverted.id, 'intelligence-cache', () => {
    invalidateContentPipelineIntelligence(req.params.workspaceId);
  });
  runPostRoutePostCommitEffect(req.params.workspaceId, reverted.id, 'content-updated-broadcast', () => {
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.CONTENT_UPDATED, {
      domain: 'content-posts',
      postId: reverted.id,
      versionId: req.params.versionId,
      action: 'post_reverted',
    });
  });
  runPostRoutePostCommitEffect(req.params.workspaceId, reverted.id, 'post-updated-broadcast', () => {
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.POST_UPDATED, { postId: reverted.id });
  });
  res.json(reverted);
});

// Score brand voice match (async — returns 202 { jobId })
// W6.2: moved onto the background job platform. The CONTENT_POST_VOICE_SCORE job
// persists voiceScore/voiceFeedback to the post and returns the updated post in
// job.result. Failures surface via the job error state.
router.post('/api/content-posts/:workspaceId/:postId/score-voice', requireWorkspaceAccess('workspaceId'), validate(revisionCommandSchema), (req, res) => {
  const post = getPost(req.params.workspaceId, req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const brief = getBrief(req.params.workspaceId, post.briefId);
  if (!brief) return res.status(404).json({ error: 'Brief not found' });
  try {
    const started = startVoiceScoreJob({
      workspaceId: req.params.workspaceId,
      postId: req.params.postId,
      expectedRevision: req.body.expectedRevision,
    });
    res.status(202).json(started);
  } catch (err) {
    const conflict = conflictResponse(err);
    if (conflict) return res.status(409).json(conflict);
    throw err;
  }
});

// Delete a post
router.delete('/api/content-posts/:workspaceId/:postId', requireWorkspaceAccess('workspaceId'), validate(revisionCommandSchema), (req, res) => {
  const existing = getPost(req.params.workspaceId, req.params.postId);
  if (!existing) return res.status(404).json({ error: 'Post not found' });
  try {
    if (!deletePostAtRevision(req.params.workspaceId, req.params.postId, req.body.expectedRevision)) {
      return res.status(404).json({ error: 'Post not found' });
    }
  } catch (err) {
    const conflict = conflictResponse(err);
    if (conflict) return res.status(409).json(conflict);
    throw err;
  }
  runPostRoutePostCommitEffect(req.params.workspaceId, existing.id, 'delete-activity', () => {
    addActivity(
      req.params.workspaceId,
      'content_updated',
      `Deleted post "${existing.title}"`,
      undefined,
      { postId: existing.id, action: 'post_deleted' },
    );
  });
  runPostRoutePostCommitEffect(req.params.workspaceId, existing.id, 'intelligence-cache', () => {
    invalidateContentPipelineIntelligence(req.params.workspaceId);
  });
  runPostRoutePostCommitEffect(req.params.workspaceId, existing.id, 'content-updated-broadcast', () => {
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.CONTENT_UPDATED, {
      domain: 'content-posts',
      postId: existing.id,
      action: 'post_deleted',
      deleted: true,
    });
  });
  runPostRoutePostCommitEffect(req.params.workspaceId, existing.id, 'post-updated-broadcast', () => {
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.POST_UPDATED, { postId: existing.id, deleted: true });
  });
  res.json({ ok: true });
});

export default router;

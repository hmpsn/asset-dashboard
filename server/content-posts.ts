/**
 * AI Content Generator — generates full SEO-optimized content from content briefs.
 * This is the main entry point that imports from sub-modules:
 *   - content-posts-db.ts   (database CRUD + version history)
 *   - content-posts-ai.ts   (AI prompt construction + generation logic)
 */
import { getWorkspace } from './workspaces.js';
import { getBrief, type ContentBrief } from './content-brief.js';
import type {
  ContentGenerationStyle,
  ContentPostGenerationDiagnostic,
  GeneratedPost,
  PersistedGeneratedPost,
} from '../shared/types/content.ts';
import type {
  GenerationExecutionProvenance,
  GenerationProvenance,
} from '../shared/types/ai-execution.js';
import type { ContentGenerationContextV2Result } from '../shared/types/intelligence.js';
import { randomUUID } from 'node:crypto';
import { createLogger } from './logger.js';
import { addActivity } from './activity-log.js';
import { broadcastToWorkspace } from './broadcast.js';
import {
  createResourceScopedJob,
  finalizeJobResourceClaims,
  getJob,
  registerAbort,
  unregisterAbort,
  updateJob,
} from './jobs.js';
import { WS_EVENTS } from './ws-events.js';
import { abortableDelay, isAbortSignalAborted, throwIfSignalAborted } from './abort-helpers.js';
import { BACKGROUND_JOB_TYPES, JOB_RESOURCE_TYPES } from '../shared/types/background-jobs.js';
import { sanitizePlainText, sanitizeRichText } from './html-sanitize.js';
import { invalidateContentPipelineIntelligence } from './intelligence-freshness.js';
import { resolveContentGenerationStyle } from './page-type-copy-contract.js';
import { isFeatureEnabled } from './feature-flags.js';
import { buildContentGenerationContextV2 } from './intelligence/generation-context-builders.js';
import { POST_STATUS_TRANSITIONS, validateTransition } from './state-machines.js';
import {
  createContentGenerationDiagnostic,
  hasUsefulGeneratedContent,
  isCompleteGeneratedPost,
  isPostDeliverable,
} from './domains/content/generation-integrity.js';
import {
  buildGenerationProvenance,
  canonicalGenerationFingerprint,
  GenerationRevisionConflictError,
  toGenerationExecutionProvenance,
  type AcceptedGenerationExecution,
} from './generation-provenance.js';

// Re-export everything from sub-modules for backward compatibility
export * from './content-posts-db.js';
export type { ContentBrief } from './content-brief.js';
export type { PostSection, GeneratedPost } from '../shared/types/content.ts';

// Import what we need from sub-modules for the orchestration functions below
import {
  assertBriefGenerationRevision,
  assertPostGenerationRevision,
  commitPostGeneration,
  createPost,
  getPost,
  replacePostWithSnapshot,
} from './content-posts-db.js';

import {
  buildVoiceContext,
  generateIntroduction,
  generateSection,
  generateConclusion,
  countHtmlWords,
  generateSeoMeta,
  unifyPost,
  type BoundedProviderDispatch,
} from './content-posts-ai.js';

const log = createLogger('content-posts');
const GENERATION_CANCELLED_MESSAGE = 'Generation cancelled by user';
const MAX_POST_PROVENANCE_EXECUTIONS = 500;

function runContentPostPostCommitEffect(
  workspaceId: string,
  postId: string | undefined,
  effect: string,
  callback: () => void,
): void {
  try {
    callback();
  } catch (err) {
    log.warn({ err, workspaceId, postId, effect }, 'content post post-commit effect failed');
  }
}

export interface ContentPostGenerationJobStart {
  jobId: string;
  postId: string;
  post: PersistedGeneratedPost;
  brief: ContentBrief;
  expectedRevision: number;
  expectedBriefRevision: number;
}

interface RunContentPostGenerationJobOptions {
  workspaceId: string;
  brief: ContentBrief;
  postId: string;
  jobId: string;
  expectedRevision?: number;
}

export interface ContentPostGenerationProgress {
  message: string;
  progress: number;
  total: number;
}

type ContentPostGenerationTerminalStatus = 'done' | 'error';

function jobHasPostGenerationTerminalResult(
  jobId: string,
  status: ContentPostGenerationTerminalStatus,
  postId: string,
): boolean {
  const job = getJob(jobId);
  if (job?.status !== status || !job.result || typeof job.result !== 'object') return false;
  return (job.result as { postId?: unknown }).postId === postId;
}

function recordPostGenerationCompletionTrackingFailure(
  workspaceId: string,
  brief: ContentBrief,
  jobId: string,
  artifact: GeneratedPost,
  total: number,
  error: unknown,
): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  log.error(
    {
      err: error,
      workspaceId,
      postId: artifact.id,
      briefId: brief.id,
      jobId,
      artifactStatus: artifact.status,
      generationRevision: artifact.generationRevision,
    },
    'Content post artifact committed but completion tracking failed',
  );

  try {
    updateJob(jobId, {
      status: 'error',
      error: errorMessage,
      result: {
        postId: artifact.id,
        briefId: brief.id,
        status: artifact.status,
        code: 'completion_tracking_failed',
        artifactCommitted: true,
        generationRevision: artifact.generationRevision,
      },
      message: 'Post committed, but completion tracking failed',
      progress: total,
      total,
    });
  } catch (trackingErr) {
    log.error(
      {
        err: trackingErr,
        workspaceId,
        postId: artifact.id,
        briefId: brief.id,
        jobId,
      },
      'Content post completion-tracking failure could not be recorded',
    );
  }
}

function persistPostGenerationTerminal(
  workspaceId: string,
  brief: ContentBrief,
  jobId: string,
  artifact: GeneratedPost,
  total: number,
  status: ContentPostGenerationTerminalStatus,
  update: Parameters<typeof updateJob>[1],
): boolean {
  try {
    updateJob(jobId, update);
    if (!jobHasPostGenerationTerminalResult(jobId, status, artifact.id)) {
      throw new Error(`Job ${jobId} did not persist the ${status} generation terminal`);
    }
    return true;
  } catch (err) {
    // updateJob persists before it broadcasts. A thrown observer is harmless if
    // the durable job already contains the intended terminal + artifact identity.
    if (jobHasPostGenerationTerminalResult(jobId, status, artifact.id)) {
      log.warn(
        { err, workspaceId, postId: artifact.id, briefId: brief.id, jobId, status },
        'Content post generation terminal committed but its observer failed',
      );
      return true;
    }
    recordPostGenerationCompletionTrackingFailure(
      workspaceId,
      brief,
      jobId,
      artifact,
      total,
      err,
    );
    return false;
  }
}

function collectIncompletePostDiagnostics(
  post: GeneratedPost,
  plannedSectionCount: number,
): NonNullable<GeneratedPost['generationDiagnostics']> {
  const diagnostics: NonNullable<GeneratedPost['generationDiagnostics']> = [];
  if (countHtmlWords(post.introduction) === 0) {
    diagnostics.push(createContentGenerationDiagnostic('introduction', 'invalid_output'));
  }
  for (let index = 0; index < plannedSectionCount; index += 1) {
    const section = post.sections[index];
    if (!section || section.index !== index || section.status !== 'done' || countHtmlWords(section.content) === 0) {
      diagnostics.push(createContentGenerationDiagnostic('section', 'invalid_output', index));
    }
  }
  if (post.sections.length !== plannedSectionCount) {
    diagnostics.push(createContentGenerationDiagnostic('generation', 'invalid_output'));
  }
  if (countHtmlWords(post.conclusion) === 0) {
    diagnostics.push(createContentGenerationDiagnostic('conclusion', 'invalid_output'));
  }
  return diagnostics;
}

export interface GeneratePostOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ContentPostGenerationProgress) => void;
  expectedRevision?: number;
  expectedBriefRevision?: number;
  executionChainId?: string;
  onRevision?: (revision: number) => void;
  /** Return a complete candidate without writing progress or artifacts. */
  persist?: boolean;
  /** Frozen context captured by a larger generation run. */
  generationContextV2?: ContentGenerationContextV2Result;
  /** Cheap source/authority CAS check around paid work. */
  assertAuthority?: () => void;
  /** Bounded parent workflows disable dispatcher-internal retries. */
  maxRetries?: number;
  /** Bounded parent workflows may disallow an unreserved provider fallback. */
  allowProviderFallback?: boolean;
  /** Durable reservation hook invoked before every provider dispatch. */
  beforeBoundedProviderDispatch?: (dispatch: BoundedProviderDispatch) => void | Promise<void>;
}

export function notifyContentUpdated(workspaceId: string, payload: Record<string, unknown>) {
  const postId = typeof payload.postId === 'string' ? payload.postId : undefined;
  runContentPostPostCommitEffect(workspaceId, postId, 'intelligence-cache', () => {
    invalidateContentPipelineIntelligence(workspaceId);
  });
  runContentPostPostCommitEffect(workspaceId, postId, 'content-updated-broadcast', () => {
    broadcastToWorkspace(workspaceId, WS_EVENTS.CONTENT_UPDATED, { domain: 'content-posts', ...payload });
  });
}

export function createPostSkeleton(
  workspaceId: string,
  brief: ContentBrief,
  postId = `post_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
): PersistedGeneratedPost {
  const now = new Date().toISOString();
  return {
    id: postId,
    workspaceId,
    briefId: brief.id,
    targetKeyword: brief.targetKeyword,
    title: sanitizePlainText(brief.suggestedTitle).trim(),
    metaDescription: sanitizePlainText(brief.suggestedMetaDesc).trim(),
    introduction: '',
    sections: brief.outline.map((s, i) => ({
      index: i,
      heading: s.heading,
      content: '',
      wordCount: 0,
      targetWordCount: s.wordCount || 250,
      keywords: s.keywords || [],
      status: 'pending' as const,
    })),
    conclusion: '',
    totalWordCount: 0,
    targetWordCount: brief.wordCountTarget || 1800,
    status: 'generating',
    unificationStatus: 'pending',
    generationStyle: resolveContentGenerationStyle(brief.generationStyle),
    generationRevision: 0,
    generationProvenance: null,
    createdAt: now,
    updatedAt: now,
  };
}

function contentPostGenerationTotalSteps(brief: ContentBrief): number {
  // One step per outline section, plus intro, conclusion, unification, and SEO metadata.
  return brief.outline.length + 4;
}

export function createContentPostGenerationJob(
  workspaceId: string,
  brief: ContentBrief,
  generationStyle?: ContentGenerationStyle,
  expectedBriefRevision?: number,
): ContentPostGenerationJobStart {
  const initialBrief = getBrief(workspaceId, brief.id);
  if (!initialBrief) throw new Error('Content brief not found');
  const pinnedBriefRevision = expectedBriefRevision ?? initialBrief.generationRevision;
  const requestedGenerationStyle = resolveContentGenerationStyle(
    generationStyle ?? brief.generationStyle,
  );
  const effectiveBrief = {
    ...initialBrief,
    generationStyle: resolveContentGenerationStyle(generationStyle ?? brief.generationStyle),
  };
  const skeleton = createPostSkeleton(workspaceId, effectiveBrief);
  const accepted = createResourceScopedJob<{
    post: PersistedGeneratedPost;
    brief: ContentBrief;
  }>(
    BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION,
    {
      message: `Generating post for "${brief.targetKeyword}"...`,
      workspaceId,
      total: contentPostGenerationTotalSteps(effectiveBrief),
      resources: [
        { resourceType: JOB_RESOURCE_TYPES.CONTENT_POST_FOR_BRIEF, resourceId: brief.id },
        { resourceType: JOB_RESOURCE_TYPES.CONTENT_POST, resourceId: skeleton.id },
      ],
      accept: () => {
        const currentBrief = getBrief(workspaceId, brief.id);
        if (!currentBrief || currentBrief.generationRevision !== pinnedBriefRevision) {
          throw new GenerationRevisionConflictError(
            'content_brief',
            brief.id,
            pinnedBriefRevision,
          );
        }
        const acceptedBrief = {
          ...currentBrief,
          generationStyle: requestedGenerationStyle,
        };
        return {
          post: createPost(
            workspaceId,
            createPostSkeleton(workspaceId, acceptedBrief, skeleton.id),
          ),
          brief: acceptedBrief,
        };
      },
    },
  );
  const started = {
    jobId: accepted.job.id,
    postId: accepted.accepted.post.id,
    post: accepted.accepted.post,
    brief: accepted.accepted.brief,
    expectedRevision: accepted.accepted.post.generationRevision,
    expectedBriefRevision: pinnedBriefRevision,
  };
  notifyContentUpdated(workspaceId, {
    postId: started.postId,
    briefId: brief.id,
    jobId: started.jobId,
    action: 'post_generation_started',
  });
  runContentPostPostCommitEffect(workspaceId, started.postId, 'post-updated-broadcast', () => {
    broadcastToWorkspace(workspaceId, WS_EVENTS.POST_UPDATED, {
      postId: started.postId,
      status: started.post.status,
      jobId: started.jobId,
    });
  });
  return started;
}

interface PersistedPostGenerationFailure {
  post: GeneratedPost;
  message: string;
  artifactPreserved: boolean;
}

function persistPostGenerationFailure(
  workspaceId: string,
  postId: string,
  error: unknown,
  expectedRevision?: number,
): PersistedPostGenerationFailure | undefined {
  const failed = getPost(workspaceId, postId);
  if (!failed) return undefined;

  const message = error instanceof Error ? error.message : 'Generation failed';
  const revision = expectedRevision ?? failed.generationRevision;
  assertPostGenerationRevision(workspaceId, postId, revision);
  if (isPostDeliverable(failed)) {
    return { post: failed, message, artifactPreserved: true };
  }
  failed.status = 'error';
  failed.unificationStatus = 'failed';
  failed.unificationNote = message;
  failed.generationDiagnostics = [
    ...(failed.generationDiagnostics ?? []),
    createContentGenerationDiagnostic('generation', 'provider_error'),
  ];
  failed.updatedAt = new Date().toISOString();
  failed.sections = failed.sections.map(section =>
    section.status === 'done' ? section : { ...section, status: 'error', error: message },
  );
  const saved = commitPostGeneration(
    workspaceId,
    failed,
    revision,
    failed.generationProvenance,
  );
  return { post: saved, message, artifactPreserved: false };
}

function emitPostGenerationFailedEffects(
  workspaceId: string,
  brief: ContentBrief,
  failure: PersistedPostGenerationFailure,
): void {
  const { post: failed, message, artifactPreserved } = failure;
  if (artifactPreserved) {
    runContentPostPostCommitEffect(workspaceId, failed.id, 'regeneration-failed-activity', () => {
      addActivity(
        workspaceId,
        'content_updated',
        `Content regeneration failed for "${brief.targetKeyword}"`,
        `${message}. The prior post was preserved.`,
        { postId: failed.id, briefId: brief.id, action: 'post_regeneration_failed', artifactPreserved: true },
      );
    });
    return;
  }
  runContentPostPostCommitEffect(workspaceId, failed.id, 'generation-failed-activity', () => {
    addActivity(
      workspaceId,
      'content_updated',
      `Content generation failed for "${brief.targetKeyword}"`,
      message,
      { postId: failed.id, briefId: brief.id, action: 'post_generation_failed' },
    );
  });
  notifyContentUpdated(workspaceId, {
    postId: failed.id,
    briefId: brief.id,
    action: 'post_generation_failed',
    status: failed.status,
  });
  runContentPostPostCommitEffect(workspaceId, failed.id, 'post-updated-broadcast', () => {
    broadcastToWorkspace(workspaceId, WS_EVENTS.POST_UPDATED, {
      postId: failed.id,
      status: failed.status,
    });
  });
}

export function markPostGenerationFailed(
  workspaceId: string,
  brief: ContentBrief,
  postId: string,
  error: unknown,
  expectedRevision?: number,
): GeneratedPost | undefined {
  const failure = persistPostGenerationFailure(
    workspaceId,
    postId,
    error,
    expectedRevision,
  );
  if (!failure) return undefined;
  emitPostGenerationFailedEffects(workspaceId, brief, failure);
  return failure.post;
}

export function markPostGenerationCancelled(
  workspaceId: string,
  brief: ContentBrief,
  postId: string,
  expectedRevision?: number,
): GeneratedPost | undefined {
  const cancelled = getPost(workspaceId, postId);
  if (!cancelled) return undefined;

  const message = GENERATION_CANCELLED_MESSAGE;
  const revision = expectedRevision ?? cancelled.generationRevision;
  assertPostGenerationRevision(workspaceId, postId, revision);
  if (isPostDeliverable(cancelled)) {
    runContentPostPostCommitEffect(workspaceId, cancelled.id, 'regeneration-cancelled-activity', () => {
      addActivity(
        workspaceId,
        'content_updated',
        `Content regeneration cancelled for "${brief.targetKeyword}"`,
        'The prior post was preserved.',
        { postId: cancelled.id, briefId: brief.id, action: 'post_regeneration_cancelled', artifactPreserved: true },
      );
    });
    return cancelled;
  }
  cancelled.status = 'error';
  cancelled.unificationStatus = 'skipped';
  cancelled.unificationNote = message;
  cancelled.generationDiagnostics = [
    ...(cancelled.generationDiagnostics ?? []),
    createContentGenerationDiagnostic('generation', 'cancelled'),
  ];
  cancelled.updatedAt = new Date().toISOString();
  cancelled.sections = cancelled.sections.map(section =>
    section.status === 'done' ? section : { ...section, status: 'error', error: message },
  );
  const saved = commitPostGeneration(
    workspaceId,
    cancelled,
    revision,
    cancelled.generationProvenance,
  );
  runContentPostPostCommitEffect(workspaceId, cancelled.id, 'generation-cancelled-activity', () => {
    addActivity(
      workspaceId,
      'content_updated',
      `Content generation cancelled for "${brief.targetKeyword}"`,
      message,
      { postId: cancelled.id, briefId: brief.id, action: 'post_generation_cancelled' },
    );
  });
  notifyContentUpdated(workspaceId, {
    postId: cancelled.id,
    briefId: brief.id,
    action: 'post_generation_cancelled',
    status: cancelled.status,
  });
  runContentPostPostCommitEffect(workspaceId, cancelled.id, 'post-updated-broadcast', () => {
    broadcastToWorkspace(workspaceId, WS_EVENTS.POST_UPDATED, {
      postId: cancelled.id,
      status: cancelled.status,
    });
  });
  return saved;
}

export function runContentPostGenerationJob({
  workspaceId,
  brief,
  postId,
  jobId,
  expectedRevision,
}: RunContentPostGenerationJobOptions): void {
  void (async () => {
    const abortController = registerAbort(jobId);
    const total = contentPostGenerationTotalSteps(brief);
    let latestRevision = expectedRevision ?? getPost(workspaceId, postId)?.generationRevision ?? 0;
    let artifactCommitted: GeneratedPost | undefined;
    try {
      updateJob(jobId, { status: 'running', message: 'Preparing content context...', progress: 0, total });
      const generated = await generatePost(workspaceId, brief, postId, {
        signal: abortController.signal,
        expectedRevision: latestRevision,
        expectedBriefRevision: brief.generationRevision,
        executionChainId: jobId,
        onRevision: revision => { latestRevision = revision; },
        onProgress: (progress) => {
          updateJob(jobId, {
            status: 'running',
            message: progress.message,
            progress: progress.progress,
            total: progress.total,
          });
        },
      });
      // generatePost returns only after its final CAS commit. From here onward,
      // terminal bookkeeping failures must never be classified as generation failures.
      artifactCommitted = generated;
      if (generated.status !== 'draft') {
        const diagnosticSummary = generated.generationDiagnostics?.map(diagnostic =>
          `${diagnostic.stage}${diagnostic.sectionIndex === undefined ? '' : ` ${diagnostic.sectionIndex + 1}`}: ${diagnostic.message}`,
        ).join('; ') || 'Required content stages did not complete.';
        const terminalPersisted = persistPostGenerationTerminal(
          workspaceId,
          brief,
          jobId,
          generated,
          total,
          'error',
          {
            status: 'error',
            error: diagnosticSummary,
            result: { postId: generated.id, briefId: brief.id, status: generated.status },
            message: generated.status === 'needs_attention'
              ? 'Post generation needs attention'
              : 'Post generation failed',
            progress: total,
            total,
          },
        );
        if (!terminalPersisted) return;
        runContentPostPostCommitEffect(workspaceId, generated.id, 'needs-attention-activity', () => {
          addActivity(
            workspaceId,
            'content_updated',
            `Content generation needs attention for "${brief.targetKeyword}"`,
            diagnosticSummary,
            { postId: generated.id, briefId: brief.id, action: 'post_generation_needs_attention' },
          );
        });
        notifyContentUpdated(workspaceId, {
          postId: generated.id,
          briefId: brief.id,
          jobId,
          action: 'post_generation_needs_attention',
          status: generated.status,
        });
        runContentPostPostCommitEffect(workspaceId, generated.id, 'post-updated-broadcast', () => {
          broadcastToWorkspace(workspaceId, WS_EVENTS.POST_UPDATED, {
            postId: generated.id,
            status: generated.status,
            jobId,
          });
        });
        return;
      }
      const terminalPersisted = persistPostGenerationTerminal(
        workspaceId,
        brief,
        jobId,
        generated,
        total,
        'done',
        {
          status: 'done',
          result: { postId: generated.id, briefId: brief.id, post: generated },
          message: `Post generated — ${generated.totalWordCount} words`,
          progress: total,
          total,
        },
      );
      if (!terminalPersisted) return;
      runContentPostPostCommitEffect(workspaceId, generated.id, 'generated-activity', () => {
        addActivity(
          workspaceId,
          'post_generated',
          `Content generated for "${brief.targetKeyword}"`,
          `Title: ${brief.suggestedTitle}`,
        );
      });
      notifyContentUpdated(workspaceId, {
        postId: generated.id,
        briefId: brief.id,
        jobId,
        action: 'post_generated',
      });
      runContentPostPostCommitEffect(workspaceId, generated.id, 'post-updated-broadcast', () => {
        broadcastToWorkspace(workspaceId, WS_EVENTS.POST_UPDATED, {
          postId: generated.id,
          status: generated.status,
          jobId,
        });
      });
    } catch (err) {
      if (artifactCommitted) {
        recordPostGenerationCompletionTrackingFailure(
          workspaceId,
          brief,
          jobId,
          artifactCommitted,
          total,
          err,
        );
        return;
      }
      if (err instanceof GenerationRevisionConflictError) {
        log.info({ workspaceId, postId, jobId, expectedRevision: err.expectedRevision }, 'Content post generation lost a revision race');
        updateJob(jobId, {
          status: 'error',
          error: err.message,
          result: {
            postId,
            briefId: brief.id,
            status: 'conflict',
            code: err.code,
            expectedRevision: err.expectedRevision,
          },
          message: 'Post changed while generation was running',
        });
        return;
      }
      if (abortController.signal.aborted) {
        log.info({ workspaceId, postId, jobId }, 'Content post generation job cancelled');
        let cancelled: GeneratedPost | undefined;
        try {
          cancelled = markPostGenerationCancelled(workspaceId, brief, postId, latestRevision);
        } catch (cancelErr) {
          if (!(cancelErr instanceof GenerationRevisionConflictError)) throw cancelErr;
          log.info({ workspaceId, postId, jobId }, 'Cancellation stamp lost to a newer post revision');
        }
        const current = getJob(jobId);
        if (current?.status !== 'cancelled') {
          updateJob(jobId, {
            status: 'cancelled',
            result: { postId, briefId: brief.id, status: cancelled?.status ?? 'error' },
            message: 'Post generation cancelled',
          });
        }
        return;
      }
      log.error({ err, workspaceId, postId, jobId }, 'Content post generation job failed');
      let failure: PersistedPostGenerationFailure | undefined;
      try {
        failure = persistPostGenerationFailure(workspaceId, postId, err, latestRevision);
      } catch (failureErr) {
        if (!(failureErr instanceof GenerationRevisionConflictError)) throw failureErr;
        log.info({ workspaceId, postId, jobId }, 'Failure stamp lost to a newer post revision');
      }
      if (!failure) {
        updateJob(jobId, {
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
          result: { postId, briefId: brief.id, status: 'error' },
          message: 'Post generation failed',
        });
        return;
      }
      const terminalPersisted = persistPostGenerationTerminal(
        workspaceId,
        brief,
        jobId,
        failure.post,
        total,
        'error',
        {
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
          result: { postId, briefId: brief.id, status: failure.post.status },
          message: 'Post generation failed',
        },
      );
      if (!terminalPersisted) return;
      emitPostGenerationFailedEffects(workspaceId, brief, failure);
    } finally {
      try {
        unregisterAbort(jobId);
      } finally {
        // This worker owns both the brief and post claims until every async
        // generation stage has drained. A terminal bookkeeping failure can
        // leave the durable job running, so release the now-safe claims here
        // even when both the intended terminal and its fallback write failed.
        // Successful terminal writes already released them; this is idempotent.
        finalizeJobResourceClaims(jobId);
      }
    }
  })().catch(err => {
    log.error(
      { err, workspaceId, postId, jobId },
      'content post generation worker rejected after launch',
    );
  });
}

/**
 * Generate a full blog post from a content brief.
 * Generates intro, each section, and conclusion sequentially.
 * Saves progress after each section so partial results are available.
 */
export async function generatePost(
  workspaceId: string,
  brief: ContentBrief,
  existingPostId?: string,
  options: GeneratePostOptions = {},
): Promise<GeneratedPost> {
  const postId = existingPostId || `post_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const shouldPersist = options.persist !== false;
  const totalSteps = contentPostGenerationTotalSteps(brief);
  const executionChainId = options.executionChainId ?? randomUUID();
  const acceptedExecutions: AcceptedGenerationExecution[] = [];
  const boundedDispatch = {
    maxRetries: options.maxRetries,
    allowProviderFallback: options.allowProviderFallback,
    beforeBoundedProviderDispatch: options.beforeBoundedProviderDispatch,
  };
  let completedSteps = 0;
  const reportProgress = (message: string, progress = completedSteps) => {
    options.onProgress?.({ message, progress, total: totalSteps });
  };

  const storedPost = getPost(workspaceId, postId);
  if (!shouldPersist && storedPost) {
    throw new GenerationRevisionConflictError(
      'content_post',
      postId,
      options.expectedRevision ?? 0,
    );
  }
  const existingPost = shouldPersist ? storedPost : undefined;
  const preservesPriorArtifact = Boolean(existingPost && ['draft', 'review', 'approved'].includes(existingPost.status));
  if (existingPost?.status === 'approved') {
    throw new Error('Approved posts cannot be replaced by automatic generation');
  }
  let post: PersistedGeneratedPost = preservesPriorArtifact
    ? {
        ...createPostSkeleton(workspaceId, brief, postId),
        createdAt: existingPost!.createdAt,
        generationRevision: existingPost!.generationRevision,
        generationProvenance: existingPost!.generationProvenance,
      }
    : existingPost ?? createPostSkeleton(workspaceId, brief, postId);
  if (!existingPost && shouldPersist) post = createPost(workspaceId, post);
  let expectedRevision = options.expectedRevision ?? post.generationRevision;
  if (post.generationRevision !== expectedRevision) {
    throw new GenerationRevisionConflictError('content_post', postId, expectedRevision);
  }
  const expectedBriefRevision = options.expectedBriefRevision ?? brief.generationRevision;
  const sourceBriefAuthority = !shouldPersist || expectedBriefRevision === undefined
    ? undefined
    : { briefId: brief.id, expectedRevision: expectedBriefRevision };
  options.onRevision?.(expectedRevision);

  const currentProvenance = (): GenerationProvenance | null => {
    const accepted = acceptedExecutions.at(-1);
    if (!accepted) return null;
    return buildGenerationProvenance({
      accepted,
      executions: acceptedExecutions,
      executionChainId,
      evidenceCapturedAt: brief.sourceEvidence?.capturedAt,
      authorityInputs: {
        briefId: brief.id,
        briefGenerationRevision: expectedBriefRevision ?? 0,
        generationStyle: resolveContentGenerationStyle(brief.generationStyle),
        plannedSectionCount: brief.outline.length,
      },
    });
  };
  const persistProgress = () => {
    if (!shouldPersist) {
      options.assertAuthority?.();
      return;
    }
    if (preservesPriorArtifact) {
      assertPostGenerationRevision(workspaceId, postId, expectedRevision);
      if (sourceBriefAuthority) {
        assertBriefGenerationRevision(
          workspaceId,
          sourceBriefAuthority.briefId,
          sourceBriefAuthority.expectedRevision,
        );
      }
      return;
    }
    post = commitPostGeneration(
      workspaceId,
      post,
      expectedRevision,
      currentProvenance(),
      sourceBriefAuthority,
    );
    expectedRevision = post.generationRevision;
    options.onRevision?.(expectedRevision);
  };
  const assertCurrentAuthority = () => {
    options.assertAuthority?.();
    if (!shouldPersist) return;
    assertPostGenerationRevision(workspaceId, postId, expectedRevision);
    if (sourceBriefAuthority) {
      assertBriefGenerationRevision(
        workspaceId,
        sourceBriefAuthority.briefId,
        sourceBriefAuthority.expectedRevision,
      );
    }
  };
  const requiredStageDiagnostics = [] as NonNullable<GeneratedPost['generationDiagnostics']>;
  post.generationStyle = resolveContentGenerationStyle(post.generationStyle ?? brief.generationStyle);

  throwIfSignalAborted(options.signal, GENERATION_CANCELLED_MESSAGE);
  reportProgress('Preparing content context...', 0);
  assertCurrentAuthority();
  const contextV2 = options.generationContextV2 ?? (isFeatureEnabled('content-generation-context-v2', workspaceId)
    ? await buildContentGenerationContextV2(workspaceId, {
        targetKeyword: brief.targetKeyword,
        sourceEvidence: brief.sourceEvidence,
        providerMetricsObservedAt: brief.keywordValidation?.validatedAt ?? null,
      })
    : null);
  const voiceCtx = contextV2?.projections.draft ?? await buildVoiceContext(workspaceId);
  const promptAuthority = contextV2?.authority;
  throwIfSignalAborted(options.signal, GENERATION_CANCELLED_MESSAGE);
  assertCurrentAuthority();

  // Resolve the site's live domain for internal link URLs
  const ws = getWorkspace(workspaceId);
  const siteDomain = ws?.liveDomain || undefined;

  // 1. Generate introduction
  reportProgress('Writing introduction...', completedSteps);
  let introductionExecution: AcceptedGenerationExecution | undefined;
  try {
    throwIfSignalAborted(options.signal, GENERATION_CANCELLED_MESSAGE);
    assertCurrentAuthority();
    const generatedIntroduction = await generateIntroduction(brief, voiceCtx, workspaceId, siteDomain, {
      ...boundedDispatch,
      signal: options.signal,
      executionChainId,
      promptAuthority,
      onExecution: execution => { introductionExecution = execution; },
    });
    assertCurrentAuthority();
    const introduction = sanitizeRichText(generatedIntroduction);
    if (countHtmlWords(introduction) === 0) {
      post.introduction = '';
      requiredStageDiagnostics.push(createContentGenerationDiagnostic('introduction', 'invalid_output'));
    } else {
      post.introduction = introduction;
      if (introductionExecution) acceptedExecutions.push(introductionExecution);
    }
    post.updatedAt = new Date().toISOString();
  } catch (err) {
    if (isAbortSignalAborted(options.signal) || err instanceof GenerationRevisionConflictError) throw err;
    post.introduction = '';
    requiredStageDiagnostics.push(createContentGenerationDiagnostic('introduction', 'provider_error'));
  }
  post.updatedAt = new Date().toISOString();
  persistProgress();
  completedSteps += 1;

  // 2. Generate each body section sequentially
  const completedSections: string[] = [];
  for (let i = 0; i < brief.outline.length; i++) {
    throwIfSignalAborted(options.signal, GENERATION_CANCELLED_MESSAGE);
    reportProgress(`Writing section ${i + 1} of ${brief.outline.length}...`, completedSteps);
    post.sections[i].status = 'generating';
    post.updatedAt = new Date().toISOString();
    persistProgress();

    // Pace API calls to avoid rate limits (Claude RPM caps)
    if (i > 0) await abortableDelay(2000, options.signal, GENERATION_CANCELLED_MESSAGE);

    let sectionExecution: AcceptedGenerationExecution | undefined;
    try {
      throwIfSignalAborted(options.signal, GENERATION_CANCELLED_MESSAGE);
      assertCurrentAuthority();
      const content = await generateSection(
        brief,
        brief.outline[i],
        i,
        completedSections,
        voiceCtx,
        workspaceId,
        siteDomain,
        {
          ...boundedDispatch,
          signal: options.signal,
          executionChainId,
          promptAuthority,
          onExecution: execution => { sectionExecution = execution; },
        },
      );
      assertCurrentAuthority();
      const safeContent = sanitizeRichText(content);
      const wordCount = countHtmlWords(safeContent);
      if (wordCount === 0) {
        post.sections[i].status = 'error';
        post.sections[i].content = '';
        post.sections[i].wordCount = 0;
        const diagnostic = createContentGenerationDiagnostic('section', 'invalid_output', i);
        post.sections[i].error = diagnostic.message;
        requiredStageDiagnostics.push(diagnostic);
        completedSections.push('');
      } else {
        post.sections[i].content = safeContent;
        post.sections[i].wordCount = wordCount;
        post.sections[i].status = 'done';
        completedSections.push(safeContent);
        if (sectionExecution) acceptedExecutions.push(sectionExecution);
      }
    } catch (err) {
      if (isAbortSignalAborted(options.signal) || err instanceof GenerationRevisionConflictError) throw err;
      post.sections[i].status = 'error';
      const diagnostic = createContentGenerationDiagnostic('section', 'provider_error', i);
      post.sections[i].error = diagnostic.message;
      post.sections[i].content = '';
      requiredStageDiagnostics.push(diagnostic);
      completedSections.push('');
    }

    post.updatedAt = new Date().toISOString();
    persistProgress();
    completedSteps += 1;
  }

  // 3. Generate conclusion
  throwIfSignalAborted(options.signal, GENERATION_CANCELLED_MESSAGE);
  reportProgress('Writing conclusion...', completedSteps);
  let conclusionExecution: AcceptedGenerationExecution | undefined;
  try {
    assertCurrentAuthority();
    const generatedConclusion = await generateConclusion(brief, voiceCtx, workspaceId, siteDomain, {
      ...boundedDispatch,
      signal: options.signal,
      executionChainId,
      promptAuthority,
      onExecution: execution => { conclusionExecution = execution; },
    });
    assertCurrentAuthority();
    const conclusion = sanitizeRichText(generatedConclusion);
    if (countHtmlWords(conclusion) === 0) {
      post.conclusion = '';
      requiredStageDiagnostics.push(createContentGenerationDiagnostic('conclusion', 'invalid_output'));
    } else {
      post.conclusion = conclusion;
      if (conclusionExecution) acceptedExecutions.push(conclusionExecution);
    }
  } catch (err) {
    if (isAbortSignalAborted(options.signal) || err instanceof GenerationRevisionConflictError) throw err;
    post.conclusion = '';
    requiredStageDiagnostics.push(createContentGenerationDiagnostic('conclusion', 'provider_error'));
  }
  completedSteps += 1;

  post.updatedAt = new Date().toISOString();
  persistProgress();

  if (requiredStageDiagnostics.length > 0 || !isCompleteGeneratedPost(post, brief.outline.length)) {
    post.totalWordCount = countHtmlWords(post.introduction)
      + post.sections.reduce((sum, section) => sum + countHtmlWords(section.content), 0)
      + countHtmlWords(post.conclusion);
    post.generationDiagnostics = requiredStageDiagnostics.length > 0
      ? requiredStageDiagnostics
      : collectIncompletePostDiagnostics(post, brief.outline.length);
    post.status = hasUsefulGeneratedContent(post) ? 'needs_attention' : 'error';
    post.unificationStatus = 'skipped';
    post.unificationNote = 'Required generation stages did not complete.';
    post.updatedAt = new Date().toISOString();
    if (preservesPriorArtifact) {
      throw new Error(requiredStageDiagnostics.map(diagnostic => diagnostic.message).join('; ') || post.unificationNote);
    }
    if (!shouldPersist) {
      post.generationRevision = 0;
      post.generationProvenance = currentProvenance();
      return post;
    }
    post = commitPostGeneration(
      workspaceId,
      post,
      expectedRevision,
      currentProvenance(),
      sourceBriefAuthority,
    );
    expectedRevision = post.generationRevision;
    options.onRevision?.(expectedRevision);
    return post;
  }

  // 4. Unification pass — review the full post for cohesion, smooth transitions, consistent voice, and word count correction
  throwIfSignalAborted(options.signal, GENERATION_CANCELLED_MESSAGE);
  reportProgress('Unifying draft...', completedSteps);
  post.unificationStatus = 'pending';
  persistProgress();

  let unificationExecution: AcceptedGenerationExecution | undefined;
  try {
    assertCurrentAuthority();
    const preUnifyWords = countHtmlWords(post.introduction) + post.sections.reduce((s, sec) => s + sec.wordCount, 0) + countHtmlWords(post.conclusion);
    const unified = await unifyPost(post, brief, voiceCtx, workspaceId, {
      ...boundedDispatch,
      signal: options.signal,
      executionChainId,
      promptAuthority,
      onExecution: execution => { unificationExecution = execution; },
    });
    assertCurrentAuthority();
    if (unified) {
      let invalidReplacement = unified.invalidReason !== undefined;
      let replacementCount = 0;
      let nextIntroduction = post.introduction;
      let nextConclusion = post.conclusion;
      const nextSections = post.sections.map(section => ({ ...section }));

      if (unified.introduction !== undefined) {
        const safeIntroduction = sanitizeRichText(unified.introduction);
        if (countHtmlWords(safeIntroduction) > 0) {
          nextIntroduction = safeIntroduction;
          replacementCount += 1;
        } else invalidReplacement = true;
      }
      if (unified.sections !== undefined) {
        if (unified.sections.length !== post.sections.length) {
          invalidReplacement = true;
        } else {
          for (let i = 0; i < unified.sections.length; i += 1) {
            const safeSection = sanitizeRichText(unified.sections[i]);
            const wordCount = countHtmlWords(safeSection);
            if (wordCount > 0) {
              nextSections[i].content = safeSection;
              nextSections[i].wordCount = wordCount;
              replacementCount += 1;
            } else invalidReplacement = true;
          }
        }
      }
      if (unified.conclusion !== undefined) {
        const safeConclusion = sanitizeRichText(unified.conclusion);
        if (countHtmlWords(safeConclusion) > 0) {
          nextConclusion = safeConclusion;
          replacementCount += 1;
        } else invalidReplacement = true;
      }

      if (!invalidReplacement) {
        post.introduction = nextIntroduction;
        post.sections = nextSections;
        post.conclusion = nextConclusion;
        if (replacementCount > 0 && unificationExecution) {
          acceptedExecutions.push(unificationExecution);
        }
      }
      const postUnifyWords = countHtmlWords(post.introduction) + post.sections.reduce((s, sec) => s + sec.wordCount, 0) + countHtmlWords(post.conclusion);
      post.unificationStatus = invalidReplacement ? 'failed' : replacementCount > 0 ? 'success' : 'skipped';
      post.unificationNote = invalidReplacement
        ? 'Unification returned unusable replacement content; the valid pre-unification draft was retained.'
        : replacementCount > 0
          ? `Unified: ${preUnifyWords} → ${postUnifyWords} words (target: ${post.targetWordCount})`
          : 'Unification returned no replacements; the original draft was retained.';
      log.info(`${post.unificationNote}`);
    } else {
      post.unificationStatus = 'skipped';
      post.unificationNote = 'Unification returned null — post too short or JSON parse failed';
      log.warn(`Unification skipped for ${postId}`);
    }
  } catch (err) {
    if (isAbortSignalAborted(options.signal) || err instanceof GenerationRevisionConflictError) throw err;
    post.unificationStatus = 'failed';
    post.unificationNote = `Unification error: ${err instanceof Error ? err.message : 'Unknown'}`;
    log.error({ err: err }, `Unification pass failed (non-critical):`);
    // Non-critical — the post is still usable without unification
  }
  post.updatedAt = new Date().toISOString();
  persistProgress();
  throwIfSignalAborted(options.signal, GENERATION_CANCELLED_MESSAGE);
  completedSteps += 1;

  // 5. Generate SEO title tag and meta description
  throwIfSignalAborted(options.signal, GENERATION_CANCELLED_MESSAGE);
  reportProgress('Generating SEO metadata...', completedSteps);
  let seoExecution: AcceptedGenerationExecution | undefined;
  try {
    assertCurrentAuthority();
    const seoMeta = await generateSeoMeta(post, brief, workspaceId, {
      ...boundedDispatch,
      signal: options.signal,
      executionChainId,
      promptAuthority,
      onExecution: execution => { seoExecution = execution; },
    });
    assertCurrentAuthority();
    if (seoMeta) {
      const seoTitle = sanitizePlainText(seoMeta.seoTitle).trim();
      const seoMetaDescription = sanitizePlainText(seoMeta.seoMetaDescription).trim();
      if (seoTitle.length > 0 && seoMetaDescription.length > 0) {
        post.seoTitle = seoTitle;
        post.seoMetaDescription = seoMetaDescription;
        if (seoExecution) acceptedExecutions.push(seoExecution);
        log.info(`SEO meta generated: "${seoTitle}" (${seoTitle.length} chars)`);
      }
    }
  } catch (err) {
    if (isAbortSignalAborted(options.signal) || err instanceof GenerationRevisionConflictError) throw err;
    log.warn({ err: err }, 'SEO meta generation failed (non-critical)');
  }
  throwIfSignalAborted(options.signal, GENERATION_CANCELLED_MESSAGE);
  completedSteps += 1;
  reportProgress('Finalizing post draft...', completedSteps);

  // Finalize
  post.totalWordCount = countHtmlWords(post.introduction)
    + post.sections.reduce((s, sec) => s + countHtmlWords(sec.content), 0)
    + countHtmlWords(post.conclusion);
  // Update per-section word counts (HTML-aware)
  for (const sec of post.sections) {
    sec.wordCount = countHtmlWords(sec.content);
  }
  if (!isCompleteGeneratedPost(post, brief.outline.length)) {
    post.generationDiagnostics = collectIncompletePostDiagnostics(post, brief.outline.length);
    post.status = hasUsefulGeneratedContent(post) ? 'needs_attention' : 'error';
    post.updatedAt = new Date().toISOString();
    if (preservesPriorArtifact) {
      throw new Error('Regeneration produced an incomplete artifact; the prior post was preserved.');
    }
    if (!shouldPersist) {
      post.generationRevision = 0;
      post.generationProvenance = currentProvenance();
      return post;
    }
    post = commitPostGeneration(
      workspaceId,
      post,
      expectedRevision,
      currentProvenance(),
      sourceBriefAuthority,
    );
    expectedRevision = post.generationRevision;
    options.onRevision?.(expectedRevision);
    return post;
  }
  post.status = 'draft';
  post.generationDiagnostics = undefined;
  post.updatedAt = new Date().toISOString();
  const provenance = currentProvenance();
  if (!shouldPersist) {
    post.generationRevision = 0;
    post.generationProvenance = provenance;
    return post;
  }
  post = preservesPriorArtifact
    ? replacePostWithSnapshot(
        workspaceId,
        post,
        expectedRevision,
        'bulk_regenerate',
        'full_post',
        provenance,
        sourceBriefAuthority,
      )
    : commitPostGeneration(
        workspaceId,
        post,
        expectedRevision,
        provenance,
        sourceBriefAuthority,
      );
  expectedRevision = post.generationRevision;
  options.onRevision?.(expectedRevision);

  return post;
}

function topLevelGenerationExecution(
  provenance: GenerationProvenance,
): GenerationExecutionProvenance {
  return {
    runId: provenance.runId,
    ...(provenance.executionChainId
      ? { executionChainId: provenance.executionChainId }
      : {}),
    operation: provenance.operation,
    provider: provenance.provider,
    model: provenance.model,
    inputFingerprint: provenance.inputFingerprint,
    startedAt: provenance.startedAt,
    completedAt: provenance.completedAt,
  };
}

function buildSectionRepairProvenance(
  previous: GenerationProvenance | null,
  repair: AcceptedGenerationExecution,
  evidenceCapturedAt: string | undefined,
  authorityInputs: unknown,
): GenerationProvenance {
  const accepted = toGenerationExecutionProvenance(repair);
  const priorContributors = previous
    ? previous.executions ?? [topLevelGenerationExecution(previous)]
    : [];
  const retainedContributors = priorContributors
    .filter(execution => execution.runId !== accepted.runId)
    .slice(-(MAX_POST_PROVENANCE_EXECUTIONS - 1));
  const executions = [...retainedContributors, accepted];
  return {
    ...accepted,
    inputFingerprint: canonicalGenerationFingerprint({
      executions: executions.map(execution => ({
        operation: execution.operation,
        inputFingerprint: execution.inputFingerprint,
      })),
      authorityInputs,
    }),
    executions,
    ...(evidenceCapturedAt ? { evidenceCapturedAt } : {}),
  };
}

/**
 * Regenerate a single section of an existing post.
 */
export async function regenerateSection(
  workspaceId: string,
  postId: string,
  sectionIndex: number,
  brief: ContentBrief,
  expectedRevision: number,
  expectedBriefRevision: number,
): Promise<PersistedGeneratedPost | null> {
  const previousPost = getPost(workspaceId, postId);
  if (!previousPost || sectionIndex < 0 || sectionIndex >= previousPost.sections.length) return null;
  const sourceRevision = expectedRevision;
  const sourceBriefAuthority = {
    briefId: previousPost.briefId,
    expectedRevision: expectedBriefRevision,
  };
  if (
    brief.id !== sourceBriefAuthority.briefId
    || brief.generationRevision !== sourceBriefAuthority.expectedRevision
  ) {
    throw new GenerationRevisionConflictError(
      'content_brief',
      sourceBriefAuthority.briefId,
      sourceBriefAuthority.expectedRevision,
    );
  }
  assertPostGenerationRevision(workspaceId, postId, sourceRevision);
  assertBriefGenerationRevision(
    workspaceId,
    sourceBriefAuthority.briefId,
    sourceBriefAuthority.expectedRevision,
  );

  let safeContent: string;
  let sectionExecution: AcceptedGenerationExecution | undefined;
  const executionChainId = previousPost.generationProvenance
    ? previousPost.generationProvenance.executionChainId
    : randomUUID();
  try {
    const contextV2 = isFeatureEnabled('content-generation-context-v2', workspaceId)
      ? await buildContentGenerationContextV2(workspaceId, {
          targetKeyword: brief.targetKeyword,
          sourceEvidence: brief.sourceEvidence,
          providerMetricsObservedAt: brief.keywordValidation?.validatedAt ?? null,
        })
      : null;
    const voiceCtx = contextV2?.projections.draft ?? await buildVoiceContext(workspaceId);
    assertPostGenerationRevision(workspaceId, postId, sourceRevision);
    assertBriefGenerationRevision(
      workspaceId,
      sourceBriefAuthority.briefId,
      sourceBriefAuthority.expectedRevision,
    );
    const previousSections = previousPost.sections
      .filter((section, index) => index < sectionIndex && section.status === 'done')
      .map(section => section.content);
    const content = await generateSection(
      brief, brief.outline[sectionIndex], sectionIndex, previousSections, voiceCtx, workspaceId,
      undefined,
      {
        executionChainId,
        promptAuthority: contextV2?.authority,
        onExecution: execution => { sectionExecution = execution; },
      },
    );
    safeContent = sanitizeRichText(content);
    if (countHtmlWords(safeContent) === 0) {
      throw new ContentSectionRegenerationError('invalid_output', sectionIndex);
    }
    if (!sectionExecution) {
      throw new ContentSectionRegenerationError('provider_error', sectionIndex);
    }
  } catch (err) {
    if (err instanceof ContentSectionRegenerationError || err instanceof GenerationRevisionConflictError) throw err;
    log.error({ err, workspaceId, postId, sectionIndex }, 'Content section regeneration failed before commit');
    throw new ContentSectionRegenerationError('provider_error', sectionIndex);
  }

  const post: GeneratedPost = {
    ...previousPost,
    sections: previousPost.sections.map(section => ({ ...section })),
  };
  post.sections[sectionIndex].content = safeContent;
  post.sections[sectionIndex].wordCount = countHtmlWords(safeContent);
  post.sections[sectionIndex].status = 'done';
  post.sections[sectionIndex].error = undefined;
  post.totalWordCount = countHtmlWords(post.introduction)
    + post.sections.reduce((s, sec) => s + sec.wordCount, 0)
    + countHtmlWords(post.conclusion);
  if (previousPost.status === 'needs_attention') {
    if (isCompleteGeneratedPost(post, brief.outline.length)) {
      post.status = validateTransition('post', POST_STATUS_TRANSITIONS, previousPost.status, 'draft');
      post.generationDiagnostics = undefined;
    } else {
      post.generationDiagnostics = collectIncompletePostDiagnostics(post, brief.outline.length);
    }
  }
  post.updatedAt = new Date().toISOString();
  const provenance = buildSectionRepairProvenance(
    previousPost.generationProvenance,
    sectionExecution,
    brief.sourceEvidence?.capturedAt ?? previousPost.generationProvenance?.evidenceCapturedAt,
    {
      sourcePostRevision: sourceRevision,
      sourceGenerationFingerprint: previousPost.generationProvenance?.inputFingerprint ?? null,
      briefId: sourceBriefAuthority.briefId,
      briefGenerationRevision: sourceBriefAuthority.expectedRevision,
      sectionIndex,
    },
  );
  return replacePostWithSnapshot(
    workspaceId,
    post,
    sourceRevision,
    'regenerate_section',
    `section:${sectionIndex}`,
    provenance,
    sourceBriefAuthority,
  );
}

export class ContentSectionRegenerationError extends Error {
  readonly diagnostic: ContentPostGenerationDiagnostic;

  constructor(code: 'provider_error' | 'invalid_output', sectionIndex: number) {
    const diagnostic = createContentGenerationDiagnostic('section', code, sectionIndex);
    super(diagnostic.message);
    this.name = 'ContentSectionRegenerationError';
    this.diagnostic = diagnostic;
  }
}

/**
 * Export a post as a single markdown string.
 */
export function exportPostMarkdown(post: GeneratedPost): string {
  const parts: string[] = [];
  parts.push(`# ${post.title}\n`);
  if (post.introduction) parts.push(post.introduction + '\n');
  for (const section of post.sections) {
    if (section.content) parts.push(section.content + '\n');
  }
  if (post.conclusion) parts.push(post.conclusion + '\n');
  return parts.join('\n');
}

/**
 * Export a post as HTML — content is already HTML so no conversion needed.
 */
export function exportPostHTML(post: GeneratedPost): string {
  const metaDesc = post.seoMetaDescription || post.metaDescription;
  const titleTag = post.seoTitle || post.title;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${metaDesc.replace(/"/g, '&quot;')}">
  <title>${titleTag.replace(/</g, '&lt;')}</title>
  <style>
    body { font-family: Georgia, 'Times New Roman', serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; line-height: 1.7; color: #1a1a1a; }
    h1 { font-size: 2.2rem; margin-bottom: 0.5rem; }
    h2 { font-size: 1.5rem; margin-top: 2rem; color: #2d3748; }
    h3 { font-size: 1.2rem; margin-top: 1.5rem; color: #4a5568; }
    p { margin-bottom: 1rem; }
    ul, ol { padding-left: 1.5rem; margin-bottom: 1rem; }
    li { margin-bottom: 0.3rem; }
    strong { color: #1a202c; }
    a { color: #2b6cb0; text-decoration: underline; }
    .meta { color: #718096; font-size: 0.9rem; margin-bottom: 2rem; }
  </style>
</head>
<body>
  <h1>${post.title}</h1>
  <div class="meta">${post.totalWordCount} words · ${post.targetKeyword}</div>
  ${post.introduction}
  ${post.sections.map(s => s.content).join('\n')}
  ${post.conclusion}
</body>
</html>`;
}

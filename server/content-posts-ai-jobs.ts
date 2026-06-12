/**
 * content-posts-ai-jobs — W6.2
 *
 * Background-job workers + prompt assembly for the three synchronous post AI
 * operations migrated off the HTTP request path:
 *
 *   - ai-review   → CONTENT_POST_REVIEW       (persists aiReview to the post + returns { review, evidence })
 *   - ai-fix      → CONTENT_POST_FIX          (returns an AiFixResult draft; user applies it explicitly)
 *   - score-voice → CONTENT_POST_VOICE_SCORE  (persists voiceScore/voiceFeedback to the post + returns the post)
 *
 * Each previously held the HTTP connection open for 30–120s (ai-fix's full-post
 * rewrite is 8000 tokens / 90s) with no jobId and no dedupe — navigating away
 * orphaned the result. The routes now create a job, return 202 { jobId }, and these
 * workers do the AI call + persistence, surfacing failures via the job error state.
 *
 * The prompt-assembly helpers (aiFixPromptAndTarget, markProvenanceItemsForHumanReview,
 * extractNumericClaims, buildReviewEvidence) moved here from routes/content-posts.ts so
 * the worker owns the heavy AI bodies (background-generation.md §Worker Module Contract).
 */
import { z } from 'zod';

import { addActivity } from './activity-log.js';
import { broadcastToWorkspace } from './broadcast.js';
import { callAI } from './ai.js';
import { callCreativeAI, scoreVoiceMatch } from './content-posts-ai.js';
import { getBrief } from './content-brief.js';
import { buildClaimEvidenceLedger } from './content-review-evidence-ledger.js';
import { getPost, updatePostField } from './content-posts-db.js';
import { notifyContentUpdated } from './content-posts.js';
import { sanitizeRichText, sanitizePlainText } from './html-sanitize.js';
import { createJob, updateJob } from './jobs.js';
import { createLogger } from './logger.js';
import { parseAIJson } from './openai-helpers.js';
import { buildSystemPrompt } from './prompt-assembly.js';
import { getVoiceProfile, buildVoiceCalibrationContext } from './voice-calibration.js';
import { invalidateContentPipelineIntelligence } from './intelligence-freshness.js';
import { buildIntelPrompt } from './workspace-intelligence.js';
import { getWorkspace } from './workspaces.js';
import { WS_EVENTS } from './ws-events.js';
import { BACKGROUND_JOB_TYPES } from '../shared/types/background-jobs.js';
import {
  AI_FEEDBACK_TARGETS,
  ISSUE_KEYS,
  PROVENANCE_SENSITIVE_REVIEW_KEYS,
} from '../shared/types/content.js';
import type {
  AIReviewMap,
  AiFixRequest,
  AiFixResult,
  ContentReviewEvidence,
  IssueKey,
  StoredAIReview,
} from '../shared/types/content.js';

const log = createLogger('content-posts-ai-jobs');

// Model used for AI review — also recorded on the persisted StoredAIReview blob.
const AI_REVIEW_MODEL = 'gpt-5.4-mini';

// ── Response schemas (moved from routes/content-posts.ts) ───────────────────

const aiReviewResultSchema = z.object({
  pass: z.boolean(),
  reason: z.string(),
  claimsToVerify: z.array(z.string()).optional(),
}).strip();

const aiReviewResponseSchema = z.object({
  factual_accuracy: aiReviewResultSchema,
  brand_voice: aiReviewResultSchema,
  internal_links: aiReviewResultSchema,
  no_hallucinations: aiReviewResultSchema,
  meta_optimized: aiReviewResultSchema,
  word_count_target: aiReviewResultSchema,
}).strip();

const aiMetaFixResponseSchema = z.object({
  seoTitle: z.string().trim().min(1),
  seoMetaDescription: z.string().trim().min(1),
}).strip();

const aiPostFeedbackResponseSchema = z.object({
  introduction: z.string().trim().min(1),
  sections: z.array(z.object({
    index: z.number().int().nonnegative(),
    content: z.string().trim().min(1),
  })).min(1),
  conclusion: z.string().trim().min(1),
}).strip();

// ── ai-fix request schema (shared by route validate() + /api/jobs dispatcher) ──

const aiFixChecklistSchema = z.object({
  mode: z.literal('checklist').optional(),
  issueKey: z.enum([...ISSUE_KEYS] as [IssueKey, ...IssueKey[]]),
  reason: z.string().min(1).max(500),
}).strict();

const aiFixFeedbackSchema = z.object({
  mode: z.literal('feedback'),
  target: z.enum(AI_FEEDBACK_TARGETS),
  feedback: z.string().trim().min(1).max(2000),
  sectionIndex: z.number().int().min(0).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.target === 'section' && value.sectionIndex === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'sectionIndex required when target=section',
      path: ['sectionIndex'],
    });
  }
});

export const aiFixRequestSchema = z.union([aiFixChecklistSchema, aiFixFeedbackSchema]);

// ── Review prompt helpers (moved from routes/content-posts.ts) ──────────────

function markProvenanceItemsForHumanReview(
  review: AIReviewMap,
  claimsToVerify: string[] = [],
  evidence?: ContentReviewEvidence,
): AIReviewMap {
  const next = { ...review };
  for (const key of PROVENANCE_SENSITIVE_REVIEW_KEYS) {
    const existing = next[key];
    const normalizedClaims = existing?.claimsToVerify?.length ? existing.claimsToVerify : claimsToVerify;
    next[key] = {
      pass: false,
      reason: existing?.reason
        ? `${existing.reason} Human verification is required before this checklist item can be checked.`
        : 'Human verification is required before this checklist item can be checked.',
      humanReviewRequired: true,
      claimsToVerify: normalizedClaims,
      claimEvidence: buildClaimEvidenceLedger(normalizedClaims, evidence),
    };
  }
  return next;
}

function extractNumericClaims(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const claimPattern = /(?:[$€£]\s?\d|\b\d+(?:[.,]\d+)?\s?%|\b\d+(?:[.,]\d+)?\s?(?:percent|x|times|k|m|million|billion|hours?|days?|weeks?|months?|years?)\b|\b(?:19|20)\d{2}\b)/i;
  const sentences = normalized.match(/[^.!?]+[.!?]?/g) ?? [];
  const claims: string[] = [];
  const seen = new Set<string>();
  for (const rawSentence of sentences) {
    const sentence = rawSentence.trim();
    if (sentence.length < 8 || sentence.length > 260) continue;
    if (!claimPattern.test(sentence)) continue;
    const key = sentence.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    claims.push(sentence);
    if (claims.length >= 8) break;
  }
  return claims;
}

function buildReviewEvidence(workspaceId: string, briefId: string): ContentReviewEvidence | undefined {
  const brief = getBrief(workspaceId, briefId);
  const referenceUrls = brief?.referenceUrls?.filter(Boolean).slice(0, 8) ?? [];
  const peopleAlsoAsk = brief?.realPeopleAlsoAsk?.filter(Boolean).slice(0, 8) ?? [];
  const topResults = brief?.realTopResults?.filter(r => r.title && r.url).slice(0, 8) ?? [];
  if (!referenceUrls.length && !peopleAlsoAsk.length && !topResults.length) return undefined;
  return {
    referenceUrls,
    peopleAlsoAsk,
    topResults,
    note: 'SERP evidence used for grounding support. Reviewers should verify important claims against the original sources before approving factual checklist items.',
  };
}

// ── AI Review worker ────────────────────────────────────────────────────────

export interface AiReviewJobParams {
  workspaceId: string;
  postId: string;
}

export interface AiReviewJobResult {
  review: AIReviewMap;
  evidence?: ContentReviewEvidence;
}

/**
 * Executes the AI review against a post and persists the verdicts. Throws on
 * not-found or AI/schema failure so the worker marks the job 'error'.
 */
export async function runAiReview(params: AiReviewJobParams): Promise<AiReviewJobResult> {
  const { workspaceId, postId } = params;
  const post = getPost(workspaceId, postId);
  if (!post) throw new Error('Post not found');

  const ws = getWorkspace(workspaceId);

  const fullContext = await buildIntelPrompt(workspaceId, ['seoContext', 'learnings'], { verbosity: 'detailed' });

  const allContent = [
    post.introduction || '',
    ...post.sections.map(s => s.content || ''),
    post.conclusion || '',
  ].join('\n').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  const contentSnippet = allContent.slice(0, 8000);
  const claimsToVerify = extractNumericClaims(allContent);

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

  const systemPrompt = buildSystemPrompt(
    workspaceId,
    'You are a strict content QA reviewer. Return only valid JSON matching the requested checklist schema.',
  );
  const result = await callAI({
    model: AI_REVIEW_MODEL,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 1000,
    temperature: 0.3,
    researchMode: true,
    responseFormat: { type: 'json_object' },
    feature: 'content-review',
    workspaceId,
  });

  const parsed = parseAIJson<unknown>(result.text);
  const reviewResult = aiReviewResponseSchema.safeParse(parsed);
  if (!reviewResult.success) {
    log.warn({ issues: reviewResult.error.issues }, 'AI review response failed schema validation');
    throw new Error('Failed to parse AI review response');
  }

  const evidence = buildReviewEvidence(workspaceId, post.briefId);
  const review = markProvenanceItemsForHumanReview(reviewResult.data, claimsToVerify, evidence);

  const aiReview: StoredAIReview = {
    review,
    evidence,
    reviewedAt: new Date().toISOString(),
    model: AI_REVIEW_MODEL,
  };
  updatePostField(workspaceId, post.id, { aiReview });
  addActivity(
    workspaceId,
    'post_ai_review',
    `AI review completed for "${post.targetKeyword}"`,
    post.title,
    { postId: post.id, action: 'ai_review_completed' },
  );
  notifyContentUpdated(workspaceId, { postId: post.id, action: 'ai_review_completed' });
  log.info(`AI review completed for post ${post.id}`);

  return { review, evidence };
}

// ── AI Fix worker ───────────────────────────────────────────────────────────

export interface AiFixJobParams {
  workspaceId: string;
  postId: string;
  body: AiFixRequest;
}

/**
 * AI fix prompt + target resolution. Returns an error sentinel for caller-side
 * validation (Section/Unknown issue key) so the route can choose the right HTTP
 * status before a job is created.
 */
export function aiFixPromptAndTarget(
  workspaceId: string,
  post: NonNullable<ReturnType<typeof getPost>>,
  body: AiFixRequest,
): { field: AiFixResult['field']; sectionIndex?: number; originalText: string; userPrompt: string; researchMode: boolean } | { error: string } {
  if (body.mode === 'feedback') {
    const feedback = body.feedback;
    const voiceProfile = getVoiceProfile(workspaceId);
    const voiceCtx = voiceProfile ? buildVoiceCalibrationContext(voiceProfile) : null;
    const voiceBlock = voiceCtx
      ? [voiceCtx.samplesText, voiceCtx.dnaText, voiceCtx.guardrailsText].filter(Boolean).join('\n')
      : '';

    if (body.target === 'section') {
      const targetSection = post.sections.find(s => s.index === body.sectionIndex);
      if (!targetSection) return { error: 'Section not found' };
      return {
        field: 'section',
        sectionIndex: targetSection.index,
        originalText: targetSection.content,
        userPrompt: `Revise this HTML section based on admin feedback.
Return the FULL SECTION HTML only.

Target keyword: "${post.targetKeyword}"
Section heading: "${targetSection.heading}"
Admin feedback:
${feedback}
${voiceBlock ? `\nVoice guidelines:\n${voiceBlock}` : ''}

Section HTML:
${targetSection.content}`,
        researchMode: false,
      };
    }

    if (body.target === 'meta') {
      const originalMeta = {
        seoTitle: post.seoTitle || post.title,
        seoMetaDescription: post.seoMetaDescription || post.metaDescription,
      };
      return {
        field: 'meta',
        originalText: JSON.stringify(originalMeta),
        userPrompt: `Rewrite the SEO title and meta description for this post based on admin feedback.
Target keyword: "${post.targetKeyword}"
Current title: "${originalMeta.seoTitle}"
Current description: "${originalMeta.seoMetaDescription}"

Admin feedback:
${feedback}

Hard constraints:
- Title should be 50-60 characters
- Description should be 150-160 characters
- Include target keyword naturally

Return ONLY valid JSON:
{ "seoTitle": "...", "seoMetaDescription": "..." }`,
        researchMode: false,
      };
    }

    return {
      field: 'post',
      originalText: JSON.stringify({
        introduction: post.introduction,
        sections: post.sections.map(section => ({ index: section.index, content: section.content })),
        conclusion: post.conclusion,
      }),
      userPrompt: `Revise this entire draft post based on admin feedback.
Keep the same overall structure and section order. Improve clarity, flow, tone, and specificity.
Return ONLY valid JSON in this exact shape:
{
  "introduction": "<p>...</p>",
  "sections": [{"index": 0, "content": "<p>...</p>"}],
  "conclusion": "<p>...</p>"
}

Target keyword: "${post.targetKeyword}"
Current total words: ${post.totalWordCount}
Target words: ${post.targetWordCount}
Admin feedback:
${feedback}
${voiceBlock ? `\nVoice guidelines:\n${voiceBlock}` : ''}

Current introduction HTML:
${post.introduction}

Current sections:
${post.sections.map(section => `Index ${section.index} (${section.heading}):\n${section.content}`).join('\n\n')}

Current conclusion HTML:
${post.conclusion}`,
      researchMode: false,
    };
  }

  const { issueKey, reason } = body;
  switch (issueKey) {
    case 'internal_links': {
      const targetSection = post.sections.find(s => !s.content.includes('<a href'))
        ?? post.sections[0];
      if (!targetSection) return { error: 'No sections available' };
      const brief = getBrief(workspaceId, post.briefId);
      const suggestions = brief?.internalLinkSuggestions ?? [];
      return {
        field: 'section',
        sectionIndex: targetSection.index,
        originalText: targetSection.content,
        userPrompt: `Rewrite ONE sentence in this HTML section to include a relevant internal link using <a href="URL">anchor text</a>.
Available internal link suggestions: ${suggestions.length > 0 ? suggestions.join(', ') : 'Use a plausible internal link like /blog or /services'}.
Return the FULL SECTION HTML with exactly one new <a href="..."> tag added. Do not change any other content.

Issue reason: ${reason}

Section HTML:
${targetSection.content}`,
        researchMode: false,
      };
    }
    case 'meta_optimized': {
      return {
        field: 'meta',
        originalText: JSON.stringify({
          seoTitle: post.seoTitle || post.title,
          seoMetaDescription: post.seoMetaDescription || post.metaDescription,
        }),
        userPrompt: `Rewrite the SEO meta title and meta description for this blog post.
Target keyword: "${post.targetKeyword}"
Current title: "${post.seoTitle || post.title}"
Current description: "${post.seoMetaDescription || post.metaDescription}"
Requirements: Title 50-60 characters, description 150-160 characters, both include the target keyword.

Issue reason: ${reason}

Return ONLY valid JSON with no surrounding text:
{ "seoTitle": "...", "seoMetaDescription": "..." }`,
        researchMode: false,
      };
    }
    case 'word_count_target': {
      const doneSections = post.sections.filter(s => s.status === 'done');
      const candidates = doneSections.length > 0 ? doneSections : post.sections;
      if (candidates.length === 0) return { error: 'No sections available' };
      const targetSection = candidates.reduce((a, b) => a.wordCount < b.wordCount ? a : b);
      return {
        field: 'section',
        sectionIndex: targetSection.index,
        originalText: targetSection.content,
        userPrompt: `Expand this HTML section by approximately 20% to increase the post's overall word count.
Add meaningful, relevant content — not filler. Maintain the same HTML structure and tone.
Return the FULL EXPANDED SECTION HTML only.

Post word count: ${post.totalWordCount} (target: ${post.targetWordCount})
Issue reason: ${reason}

Section HTML:
${targetSection.content}`,
        researchMode: false,
      };
    }
    case 'brand_voice': {
      const voiceProfile = getVoiceProfile(workspaceId);
      const voiceCtx = voiceProfile ? buildVoiceCalibrationContext(voiceProfile) : null;
      const voiceBlock = voiceCtx
        ? [voiceCtx.samplesText, voiceCtx.dnaText, voiceCtx.guardrailsText].filter(Boolean).join('\n')
        : '';
      return {
        field: 'introduction',
        originalText: post.introduction,
        userPrompt: `Rewrite this blog post introduction to better match the workspace's brand voice.
Keep the same topic, key points, and approximate length. Return the FULL INTRODUCTION HTML only.

Issue reason: ${reason}${voiceBlock ? `\n\nVoice guidelines:\n${voiceBlock}` : ''}

Introduction HTML:
${post.introduction}`,
        researchMode: false,
      };
    }
    case 'factual_accuracy':
    case 'no_hallucinations': {
      const targetSection = post.sections[0];
      if (!targetSection) return { error: 'No sections available' };
      return {
        field: 'section',
        sectionIndex: targetSection.index,
        originalText: targetSection.content,
        userPrompt: `Review this HTML section and rewrite any potentially inaccurate or unverifiable claims conservatively.
Replace suspicious statistics or quotes with general, verifiable statements. Do NOT add new statistics.
Return the FULL SECTION HTML with conservative rewrites applied.

Issue reason: ${reason}

Section HTML:
${targetSection.content}`,
        researchMode: true,
      };
    }
    default:
      return { error: 'Unknown issue key' };
  }
}

/**
 * Executes the AI fix and returns the draft AiFixResult. Does NOT persist — the
 * user applies the suggestion explicitly via the post PATCH path (review-before-save).
 * Throws on AI/schema failure so the worker marks the job 'error'.
 */
export async function runAiFix(params: AiFixJobParams): Promise<AiFixResult> {
  const { workspaceId, postId, body } = params;
  const post = getPost(workspaceId, postId);
  if (!post) throw new Error('Post not found');

  const promptTarget = aiFixPromptAndTarget(workspaceId, post, body);
  if ('error' in promptTarget) {
    throw new Error(promptTarget.error);
  }

  const { field, sectionIndex, originalText, userPrompt, researchMode } = promptTarget;
  const requestReason = body.mode === 'feedback' ? body.feedback : body.reason;

  const systemPrompt = buildSystemPrompt(
    workspaceId,
    'You are an SEO content editor. Follow the requested field constraints exactly and return only the requested output format.',
  );
  const rawSuggested = field === 'meta'
    ? (await callAI({
      operation: 'content-post-feedback-fix-structured',
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      workspaceId,
      maxTokens: 2000,
      temperature: 0.3,
      researchMode,
    })).text.trim()
    : (await callCreativeAI({
      operation: field === 'post'
        ? 'content-post-feedback-fix-structured'
        : 'content-post-feedback-fix',
      systemPrompt,
      userPrompt,
      workspaceId,
      maxTokens: field === 'post' ? 8000 : 2000,
      temperature: 0.3,
      researchMode,
      ...(field === 'post' ? { json: true } : {}),
    })).trim();
  let suggestedText: string;

  if (field === 'meta') {
    let parsed: unknown;
    try {
      parsed = parseAIJson<unknown>(rawSuggested);
    } catch { // catch-ok: SyntaxError from malformed AI JSON — expected failure path
      throw new Error('Failed to parse AI meta response');
    }
    const parsedResult = aiMetaFixResponseSchema.safeParse(parsed);
    if (!parsedResult.success) {
      log.warn({ issues: parsedResult.error.issues }, 'AI meta fix response failed schema validation');
      throw new Error('Failed to parse AI meta response');
    }
    const sanitizedMeta = {
      seoTitle: sanitizePlainText(parsedResult.data.seoTitle),
      seoMetaDescription: sanitizePlainText(parsedResult.data.seoMetaDescription),
    };
    const sanitizedResult = aiMetaFixResponseSchema.safeParse(sanitizedMeta);
    if (!sanitizedResult.success) {
      log.warn({ issues: sanitizedResult.error.issues }, 'AI meta fix response sanitized to invalid fields');
      throw new Error('Failed to parse AI meta response');
    }
    suggestedText = JSON.stringify(sanitizedResult.data);
  } else if (field === 'post') {
    let parsed: unknown;
    try {
      parsed = parseAIJson<unknown>(rawSuggested);
    } catch { // catch-ok: SyntaxError from malformed AI JSON — expected failure path
      throw new Error('Failed to parse AI post response');
    }
    const parsedResult = aiPostFeedbackResponseSchema.safeParse(parsed);
    if (!parsedResult.success) {
      log.warn({ issues: parsedResult.error.issues }, 'AI post feedback response failed schema validation');
      throw new Error('Failed to parse AI post response');
    }
    const receivedIndices = parsedResult.data.sections.map(section => section.index);
    const uniqueReceivedIndices = new Set(receivedIndices);
    const sameShape = parsedResult.data.sections.length === post.sections.length
      && uniqueReceivedIndices.size === post.sections.length
      && post.sections.every(section => uniqueReceivedIndices.has(section.index));
    if (!sameShape) {
      throw new Error('Failed to parse AI post response');
    }
    const sanitizedPost = {
      introduction: sanitizeRichText(parsedResult.data.introduction),
      sections: parsedResult.data.sections
        .map(section => ({ index: section.index, content: sanitizeRichText(section.content) }))
        .sort((a, b) => a.index - b.index),
      conclusion: sanitizeRichText(parsedResult.data.conclusion),
    };
    const reparsed = aiPostFeedbackResponseSchema.safeParse(sanitizedPost);
    if (!reparsed.success) {
      log.warn({ issues: reparsed.error.issues }, 'AI post feedback response sanitized to invalid fields');
      throw new Error('Failed to parse AI post response');
    }
    suggestedText = JSON.stringify(reparsed.data);
  } else {
    suggestedText = sanitizeRichText(rawSuggested);
  }

  const targetSection = field === 'section' && sectionIndex !== undefined
    ? post.sections.find(s => s.index === sectionIndex)
    : undefined;
  const sectionLabel = targetSection ? `section "${targetSection.heading}"` : field;
  const explanation = `AI revised the ${sectionLabel} to address: ${sanitizePlainText(requestReason).slice(0, 120)}`;

  return { field, sectionIndex, originalText, suggestedText, explanation };
}

// ── Voice scoring worker ────────────────────────────────────────────────────

export interface VoiceScoreJobParams {
  workspaceId: string;
  postId: string;
}

/**
 * Scores the post's brand voice and persists voiceScore/voiceFeedback. Returns
 * the updated post. Throws on not-found or a null score so the job is marked error.
 */
export async function runVoiceScore(params: VoiceScoreJobParams) {
  const { workspaceId, postId } = params;
  const post = getPost(workspaceId, postId);
  if (!post) throw new Error('Post not found');
  const brief = getBrief(workspaceId, post.briefId);
  if (!brief) throw new Error('Brief not found');

  const { voiceScore, voiceFeedback } = await scoreVoiceMatch(post, brief, workspaceId);
  if (voiceScore == null) {
    throw new Error(voiceFeedback || 'Voice scoring failed');
  }
  const updated = updatePostField(workspaceId, postId, { voiceScore, voiceFeedback });
  invalidateContentPipelineIntelligence(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.POST_UPDATED, { postId });
  return updated;
}

// ── Job runners ─────────────────────────────────────────────────────────────

export function startAiReviewJob(params: AiReviewJobParams): { jobId: string } {
  const job = createJob(BACKGROUND_JOB_TYPES.CONTENT_POST_REVIEW, {
    workspaceId: params.workspaceId,
    total: 1,
    message: 'Running AI content review...',
  });
  setTimeout(() => {
    void (async () => {
      try {
        updateJob(job.id, { status: 'running', progress: 0, total: 1, message: 'Running AI content review...' });
        const result = await runAiReview(params);
        updateJob(job.id, {
          status: 'done',
          progress: 1,
          total: 1,
          result,
          message: 'AI review complete',
        });
      } catch (err) {
        updateJob(job.id, {
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
          message: 'AI review failed',
        });
      }
    })();
  }, 100);
  return { jobId: job.id };
}

export function startAiFixJob(params: AiFixJobParams): { jobId: string } {
  const job = createJob(BACKGROUND_JOB_TYPES.CONTENT_POST_FIX, {
    workspaceId: params.workspaceId,
    total: 1,
    message: 'Generating AI fix...',
  });
  setTimeout(() => {
    void (async () => {
      try {
        updateJob(job.id, { status: 'running', progress: 0, total: 1, message: 'Generating AI fix...' });
        const result = await runAiFix(params);
        updateJob(job.id, {
          status: 'done',
          progress: 1,
          total: 1,
          result,
          message: 'AI fix ready for review',
        });
      } catch (err) {
        updateJob(job.id, {
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
          message: 'AI fix failed',
        });
      }
    })();
  }, 100);
  return { jobId: job.id };
}

export function startVoiceScoreJob(params: VoiceScoreJobParams): { jobId: string } {
  const job = createJob(BACKGROUND_JOB_TYPES.CONTENT_POST_VOICE_SCORE, {
    workspaceId: params.workspaceId,
    total: 1,
    message: 'Scoring brand voice...',
  });
  setTimeout(() => {
    void (async () => {
      try {
        updateJob(job.id, { status: 'running', progress: 0, total: 1, message: 'Scoring brand voice...' });
        const updated = await runVoiceScore(params);
        updateJob(job.id, {
          status: 'done',
          progress: 1,
          total: 1,
          result: { post: updated, postId: params.postId },
          message: 'Brand voice scored',
        });
      } catch (err) {
        updateJob(job.id, {
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
          message: 'Voice scoring failed',
        });
      }
    })();
  }, 100);
  return { jobId: job.id };
}

// Re-export for tests + route validation convenience.
export { AI_FEEDBACK_TARGETS };

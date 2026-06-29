import { z } from 'zod';

import { callAI } from './ai.js';
import { parseStructuredAIOutput } from './ai-structured-output.js';
import { buildSystemPrompt } from './prompt-assembly.js';
import { getWorkspace } from './workspaces.js';
import type { GbpReviewResponseReviewContext } from '../shared/types/google-business-profile.js';

const MAX_REPLY_CHARS = 1500;

const responseSchema = z.object({
  reply: z.string().trim().min(20).max(MAX_REPLY_CHARS).superRefine((value, ctx) => {
    if (/^#{1,6}\s|\*\*|__|^\s*[-*]\s/m.test(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Reply must be plain text, not Markdown.',
      });
    }
  }),
}).strict();

function ratingLabel(review: GbpReviewResponseReviewContext): string {
  return typeof review.ratingValue === 'number' ? `${review.ratingValue} stars` : review.rating;
}

export async function generateGbpReviewResponseDraft(input: {
  workspaceId: string;
  review: GbpReviewResponseReviewContext;
}): Promise<string> {
  const workspace = getWorkspace(input.workspaceId);
  const businessName = workspace?.name ?? 'the business';
  const reviewText = input.review.commentText?.trim() || input.review.commentExcerpt || 'No review text was provided.';

  const systemPrompt = buildSystemPrompt(input.workspaceId, [
    'You draft public Google Business Profile review replies for a business owner.',
    'Return strict JSON only: {"reply":"..."}',
    'The reply is inserted directly into Google, so use plain text only. No Markdown, bullets, links, HTML, or emojis.',
    'Be warm, specific, and concise. Do not mention AI, internal tools, private customer details, refunds, discounts, or legal/medical claims.',
    'For negative or mixed reviews, acknowledge the concern without admitting fault and invite the reviewer to contact the business offline.',
    `Keep reply under ${MAX_REPLY_CHARS} characters.`,
  ].join('\n'));

  const userPrompt = [
    `Business: ${businessName}`,
    `Location: ${input.review.locationTitle ?? 'Mapped GBP location'}`,
    `Rating: ${ratingLabel(input.review)}`,
    `Reviewer: ${input.review.reviewerDisplayName ?? (input.review.reviewerIsAnonymous ? 'Anonymous reviewer' : 'Reviewer')}`,
    `Review text: ${reviewText}`,
    '',
    'Draft one public response for this exact review.',
  ].join('\n');

  const result = await callAI({
    operation: 'gbp-review-response-draft',
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    workspaceId: input.workspaceId,
  });

  return parseStructuredAIOutput(result.text, responseSchema, 'gbp-review-response-draft').reply;
}

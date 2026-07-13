import type {
  ContentPostGenerationDiagnostic,
  ContentPostGenerationDiagnosticCode,
  ContentPostGenerationStage,
  GeneratedPost,
} from '../../../shared/types/content.js';
import { hasVisibleHtmlContent, isDeliverableContentPost } from '../../../shared/content-post-integrity.js';

const DIAGNOSTIC_MESSAGES: Record<ContentPostGenerationDiagnosticCode, string> = {
  provider_error: 'The AI provider could not complete this stage.',
  invalid_output: 'The AI provider returned no usable visible content for this stage.',
  cancelled: 'Generation was cancelled before this stage completed.',
};

export function createContentGenerationDiagnostic(
  stage: ContentPostGenerationStage,
  code: ContentPostGenerationDiagnosticCode,
  sectionIndex?: number,
): ContentPostGenerationDiagnostic {
  return {
    stage,
    code,
    message: DIAGNOSTIC_MESSAGES[code],
    ...(sectionIndex === undefined ? {} : { sectionIndex }),
    occurredAt: new Date().toISOString(),
  };
}

export function hasUsefulGeneratedContent(post: GeneratedPost): boolean {
  return hasVisibleHtmlContent(post.introduction)
    || hasVisibleHtmlContent(post.conclusion)
    || post.sections.some(section => section.status === 'done' && hasVisibleHtmlContent(section.content));
}

export function isCompleteGeneratedPost(post: GeneratedPost, plannedSectionCount: number): boolean {
  if (!hasVisibleHtmlContent(post.introduction) || !hasVisibleHtmlContent(post.conclusion)) return false;
  if (post.sections.length !== plannedSectionCount) return false;
  return post.sections.every((section, index) =>
    section.index === index
    && section.status === 'done'
    && hasVisibleHtmlContent(section.content),
  );
}

export function isPostDeliverable(post: GeneratedPost): boolean {
  return isDeliverableContentPost(post);
}

export class IncompleteContentPostError extends Error {
  constructor(message = 'This post is incomplete and cannot be reviewed, exported, or published.') {
    super(message);
    this.name = 'IncompleteContentPostError';
  }
}

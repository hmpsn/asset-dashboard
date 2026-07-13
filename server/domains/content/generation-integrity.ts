import type {
  ContentPostGenerationDiagnostic,
  ContentPostGenerationStage,
  GeneratedPost,
} from '../../../shared/types/content.js';
import { sanitizePlainText } from '../../html-sanitize.js';

const DIAGNOSTIC_MESSAGE_LIMIT = 500;

export function createContentGenerationDiagnostic(
  stage: ContentPostGenerationStage,
  error: unknown,
  sectionIndex?: number,
): ContentPostGenerationDiagnostic {
  const rawMessage = error instanceof Error ? error.message : String(error || 'Generation failed');
  const message = sanitizePlainText(rawMessage).replace(/\s+/g, ' ').trim().slice(0, DIAGNOSTIC_MESSAGE_LIMIT)
    || 'Generation failed';
  return {
    stage,
    code: 'provider_error',
    message,
    ...(sectionIndex === undefined ? {} : { sectionIndex }),
    occurredAt: new Date().toISOString(),
  };
}

export function hasUsefulGeneratedContent(post: GeneratedPost): boolean {
  return Boolean(
    post.introduction.trim()
    || post.conclusion.trim()
    || post.sections.some(section => section.status === 'done' && section.content.trim()),
  );
}

export function isCompleteGeneratedPost(post: GeneratedPost, plannedSectionCount: number): boolean {
  if (!post.introduction.trim() || !post.conclusion.trim()) return false;
  if (post.sections.length !== plannedSectionCount) return false;
  return post.sections.every((section, index) =>
    section.index === index
    && section.status === 'done'
    && Boolean(section.content.trim()),
  );
}

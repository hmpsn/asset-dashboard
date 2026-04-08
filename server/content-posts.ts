/**
 * AI Content Generator — generates full SEO-optimized content from content briefs.
 * This is the main entry point that imports from sub-modules:
 *   - content-posts-db.ts   (database CRUD + version history)
 *   - content-posts-ai.ts   (AI prompt construction + generation logic)
 */
import { getWorkspace } from './workspaces.js';
import type { ContentBrief } from './content-brief.js';
import type { GeneratedPost } from '../shared/types/content.ts';
import { createLogger } from './logger.js';

// Re-export everything from sub-modules for backward compatibility
export * from './content-posts-db.js';
export type { ContentBrief } from './content-brief.js';
export type { PostSection, GeneratedPost } from '../shared/types/content.ts';

// Import what we need from sub-modules for the orchestration functions below
import {
  savePost,
  getPost,
  snapshotPostVersion,
} from './content-posts-db.js';

import {
  buildVoiceContext,
  generateIntroduction,
  generateSection,
  generateConclusion,
  countWords,
  stripHtml,
  generateSeoMeta,
  unifyPost,
} from './content-posts-ai.js';

const log = createLogger('content-posts');
/**
 * Generate a full blog post from a content brief.
 * Generates intro, each section, and conclusion sequentially.
 * Saves progress after each section so partial results are available.
 */
export async function generatePost(
  workspaceId: string,
  brief: ContentBrief,
  existingPostId?: string,
): Promise<GeneratedPost> {
  const postId = existingPostId || `post_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const voiceCtx = await buildVoiceContext(workspaceId);

  // Resolve the site's live domain for internal link URLs
  const ws = getWorkspace(workspaceId);
  const siteDomain = ws?.liveDomain || undefined;

  // Initialize post with pending sections
  const post: GeneratedPost = {
    id: postId,
    workspaceId,
    briefId: brief.id,
    targetKeyword: brief.targetKeyword,
    title: brief.suggestedTitle,
    metaDescription: brief.suggestedMetaDesc,
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Save initial skeleton
  savePost(workspaceId, post);

  // 1. Generate introduction
  try {
    post.introduction = await generateIntroduction(brief, voiceCtx, workspaceId, siteDomain);
    post.updatedAt = new Date().toISOString();
    savePost(workspaceId, post);
  } catch (err) {
    post.introduction = `*[Introduction generation failed: ${err instanceof Error ? err.message : 'Unknown error'}]*`;
  }

  // 2. Generate each body section sequentially
  const completedSections: string[] = [];
  for (let i = 0; i < brief.outline.length; i++) {
    post.sections[i].status = 'generating';
    savePost(workspaceId, post);

    // Pace API calls to avoid rate limits (Claude RPM caps)
    if (i > 0) await new Promise(r => setTimeout(r, 2000));

    try {
      const content = await generateSection(
        brief, brief.outline[i], i, completedSections, voiceCtx, workspaceId, siteDomain,
      );
      post.sections[i].content = content;
      post.sections[i].wordCount = countWords(content);
      post.sections[i].status = 'done';
      completedSections.push(content);
    } catch (err) {
      post.sections[i].status = 'error';
      post.sections[i].error = err instanceof Error ? err.message : 'Generation failed';
      post.sections[i].content = `*[Section generation failed: ${post.sections[i].error}]*`;
      completedSections.push('');
    }

    post.updatedAt = new Date().toISOString();
    savePost(workspaceId, post);
  }

  // 3. Generate conclusion
  try {
    post.conclusion = await generateConclusion(brief, voiceCtx, workspaceId, siteDomain);
  } catch (err) {
    post.conclusion = `*[Conclusion generation failed: ${err instanceof Error ? err.message : 'Unknown error'}]*`;
  }

  post.updatedAt = new Date().toISOString();
  savePost(workspaceId, post);

  // 4. Unification pass — review the full post for cohesion, smooth transitions, consistent voice, and word count correction
  post.unificationStatus = 'pending';
  savePost(workspaceId, post);

  try {
    const preUnifyWords = countWords(post.introduction) + post.sections.reduce((s, sec) => s + sec.wordCount, 0) + countWords(post.conclusion);
    const unified = await unifyPost(post, brief, voiceCtx, workspaceId);
    if (unified) {
      if (unified.introduction) post.introduction = unified.introduction;
      for (let i = 0; i < post.sections.length; i++) {
        if (unified.sections?.[i]) {
          post.sections[i].content = unified.sections[i];
          post.sections[i].wordCount = countWords(unified.sections[i]);
        }
      }
      if (unified.conclusion) post.conclusion = unified.conclusion;
      const postUnifyWords = countWords(post.introduction) + post.sections.reduce((s, sec) => s + sec.wordCount, 0) + countWords(post.conclusion);
      post.unificationStatus = 'success';
      post.unificationNote = `Unified: ${preUnifyWords} → ${postUnifyWords} words (target: ${post.targetWordCount})`;
      log.info(`${post.unificationNote}`);
      post.updatedAt = new Date().toISOString();
      savePost(workspaceId, post);
    } else {
      post.unificationStatus = 'skipped';
      post.unificationNote = 'Unification returned null — post too short or JSON parse failed';
      log.warn(`Unification skipped for ${postId}`);
    }
  } catch (err) {
    post.unificationStatus = 'failed';
    post.unificationNote = `Unification error: ${err instanceof Error ? err.message : 'Unknown'}`;
    log.error({ err: err }, `Unification pass failed (non-critical):`);
    // Non-critical — the post is still usable without unification
  }

  // 5. Generate SEO title tag and meta description
  try {
    const seoMeta = await generateSeoMeta(post, brief, workspaceId);
    if (seoMeta) {
      post.seoTitle = seoMeta.seoTitle;
      post.seoMetaDescription = seoMeta.seoMetaDescription;
      log.info(`SEO meta generated: "${seoMeta.seoTitle}" (${seoMeta.seoTitle.length} chars)`);
    }
  } catch (err) {
    log.warn({ err: err }, 'SEO meta generation failed (non-critical)');
  }

  // Finalize
  post.totalWordCount = countWords(stripHtml(post.introduction))
    + post.sections.reduce((s, sec) => s + countWords(stripHtml(sec.content)), 0)
    + countWords(stripHtml(post.conclusion));
  // Update per-section word counts to use stripped HTML
  for (const sec of post.sections) {
    sec.wordCount = countWords(stripHtml(sec.content));
  }
  post.status = 'draft';
  post.updatedAt = new Date().toISOString();
  savePost(workspaceId, post);

  return post;
}

/**
 * Regenerate a single section of an existing post.
 */
export async function regenerateSection(
  workspaceId: string,
  postId: string,
  sectionIndex: number,
  brief: ContentBrief,
): Promise<GeneratedPost | null> {
  const post = getPost(workspaceId, postId);
  if (!post || sectionIndex < 0 || sectionIndex >= post.sections.length) return null;

  const voiceCtx = await buildVoiceContext(workspaceId);
  const previousSections = post.sections
    .filter((s, i) => i < sectionIndex && s.status === 'done')
    .map(s => s.content);

  // Snapshot current state before regenerating
  snapshotPostVersion(post, 'regenerate_section', `section:${sectionIndex}`);

  post.sections[sectionIndex].status = 'generating';
  savePost(workspaceId, post);

  try {
    const content = await generateSection(
      brief, brief.outline[sectionIndex], sectionIndex, previousSections, voiceCtx, workspaceId,
    );
    post.sections[sectionIndex].content = content;
    post.sections[sectionIndex].wordCount = countWords(content);
    post.sections[sectionIndex].status = 'done';
    post.sections[sectionIndex].error = undefined;
  } catch (err) {
    post.sections[sectionIndex].status = 'error';
    post.sections[sectionIndex].error = err instanceof Error ? err.message : 'Regeneration failed';
  }

  post.totalWordCount = countWords(post.introduction)
    + post.sections.reduce((s, sec) => s + sec.wordCount, 0)
    + countWords(post.conclusion);
  post.updatedAt = new Date().toISOString();
  savePost(workspaceId, post);

  return post;
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

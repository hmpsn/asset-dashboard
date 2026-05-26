/**
 * PostPreview — Full post preview panel rendering complete HTML output.
 * Extracted from PostEditor.tsx preview mode.
 */
import { SectionCard } from '../ui';
import { previewRichTextClass } from './richTextStyles';

interface PostSection {
  index: number;
  heading: string;
  content: string;
  wordCount: number;
  targetWordCount: number;
  keywords: string[];
  status: 'pending' | 'generating' | 'done' | 'error';
  error?: string;
}

interface GeneratedPost {
  title: string;
  introduction: string;
  sections: PostSection[];
  conclusion: string;
  totalWordCount: number;
}

export interface PostPreviewProps {
  post: GeneratedPost;
}

export function PostPreview({ post }: PostPreviewProps) {
  return (
    <SectionCard noPadding>
      <div className={`p-6 ${previewRichTextClass}`}>
        <h1 className="text-xl font-bold text-[var(--brand-text-bright)] mb-4">{post.title}</h1>
        {post.totalWordCount > 0 ? (
          <div className="flex items-center gap-3 mb-4 t-caption text-[var(--brand-text-muted)]">
            <span>{post.totalWordCount.toLocaleString()} words</span>
            <span>·</span>
            <span>~{Math.max(1, Math.ceil(post.totalWordCount / 200))} min read</span>
          </div>
        ) : null}
        <div dangerouslySetInnerHTML={{ __html: post.introduction }} />
        {post.sections.map(s => (
          <div key={s.index} className="mb-4" dangerouslySetInnerHTML={{ __html: s.content }} />
        ))}
        <div dangerouslySetInnerHTML={{ __html: post.conclusion }} />
      </div>
    </SectionCard>
  );
}

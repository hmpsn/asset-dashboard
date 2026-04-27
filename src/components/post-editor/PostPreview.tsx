/**
 * PostPreview — Full post preview panel rendering complete HTML output.
 * Extracted from PostEditor.tsx preview mode.
 */
import { SectionCard } from '../ui';

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
}

export interface PostPreviewProps {
  post: GeneratedPost;
}

export function PostPreview({ post }: PostPreviewProps) {
  return (
    <SectionCard noPadding>
      <div className="p-6 prose prose-invert prose-sm max-w-none [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-zinc-100 [&_h2]:mt-6 [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-zinc-200 [&_h3]:mt-4 [&_h3]:mb-1 [&_p]:text-xs [&_p]:text-zinc-300 [&_p]:leading-relaxed [&_p]:mb-3 [&_ul]:text-xs [&_ul]:text-zinc-300 [&_ul]:pl-4 [&_ul]:mb-3 [&_ol]:text-xs [&_ol]:text-zinc-300 [&_ol]:pl-4 [&_ol]:mb-3 [&_li]:mb-1 [&_strong]:text-zinc-100 [&_a]:text-teal-400 [&_a]:underline">
        <h1 className="text-xl font-bold text-zinc-100 mb-4">{post.title}</h1>
        <div dangerouslySetInnerHTML={{ __html: post.introduction }} />
        {post.sections.map(s => (
          <div key={s.index} className="mb-4" dangerouslySetInnerHTML={{ __html: s.content }} />
        ))}
        <div dangerouslySetInnerHTML={{ __html: post.conclusion }} />
      </div>
    </SectionCard>
  );
}

export interface ContentPostIntegrityShape {
  status: string;
  introduction: string;
  conclusion: string;
  sections: Array<{ status: string; content: string }>;
}

export function isDeliverableContentPost(post: ContentPostIntegrityShape): boolean {
  return ['draft', 'review', 'approved'].includes(post.status)
    && Boolean(post.introduction.trim())
    && Boolean(post.conclusion.trim())
    && post.sections.length > 0
    && post.sections.every(section => section.status === 'done' && Boolean(section.content.trim()));
}

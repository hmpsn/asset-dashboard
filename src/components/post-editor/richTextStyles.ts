const sharedListAndInlineClass = [
  '[&_strong]:text-[var(--brand-text-bright)]',
  '[&_ul]:pl-5 [&_ul]:list-disc',
  '[&_ol]:pl-5 [&_ol]:list-decimal',
  '[&_li::marker]:text-[var(--brand-text)]',
].join(' ');

export const adminRichTextClass = [
  'text-sm text-[var(--brand-text)] leading-relaxed',
  '[&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-[var(--brand-text-bright)] [&_h2]:mb-2',
  '[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-[var(--brand-text-bright)] [&_h3]:mt-3 [&_h3]:mb-1',
  '[&_p]:mb-2',
  '[&_ul]:mb-2 [&_ol]:mb-2 [&_li]:mb-1',
  '[&_a]:text-teal-400 [&_a]:underline',
  sharedListAndInlineClass,
].join(' ');

export const clientRichTextClass = [
  't-body text-[var(--brand-text)] leading-7 max-w-none',
  '[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-[var(--brand-text-bright)]',
  '[&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-[var(--brand-text-bright)]',
  '[&_p]:mb-3 [&_p:last-child]:mb-0',
  '[&_a]:text-accent-brand [&_a]:underline [&_a]:underline-offset-2',
  '[&_ul]:my-3 [&_ol]:my-3 [&_li]:mb-1.5',
  sharedListAndInlineClass,
].join(' ');

export const previewRichTextClass = [
  'prose prose-invert prose-sm max-w-none',
  '[&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-[var(--brand-text-bright)] [&_h2]:mt-6 [&_h2]:mb-2',
  '[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-[var(--brand-text-bright)] [&_h3]:mt-4 [&_h3]:mb-1',
  '[&_p]:text-xs [&_p]:text-[var(--brand-text)] [&_p]:leading-relaxed [&_p]:mb-3',
  '[&_ul]:text-xs [&_ul]:text-[var(--brand-text)] [&_ul]:mb-3',
  '[&_ol]:text-xs [&_ol]:text-[var(--brand-text)] [&_ol]:mb-3',
  '[&_li]:mb-1',
  '[&_a]:text-teal-400 [&_a]:underline',
  sharedListAndInlineClass,
].join(' ');

export const diffRichTextClass = [
  'text-sm text-[var(--brand-text)] leading-relaxed',
  '[&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-[var(--brand-text-bright)] [&_h2]:mb-2',
  '[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-[var(--brand-text-bright)] [&_h3]:mt-3 [&_h3]:mb-1',
  '[&_p]:mb-2',
  '[&_ul]:mb-2 [&_ol]:mb-2 [&_li]:mb-1',
  '[&_a]:text-teal-400 [&_a]:underline',
  sharedListAndInlineClass,
].join(' ');

export const prosemirrorSharedClass = [
  '[&_.ProseMirror_p]:mb-2',
  '[&_.ProseMirror_strong]:text-[var(--brand-text-bright)]',
  '[&_.ProseMirror_ul]:pl-5 [&_.ProseMirror_ul]:mb-2 [&_.ProseMirror_ul]:list-disc',
  '[&_.ProseMirror_ol]:pl-5 [&_.ProseMirror_ol]:mb-2 [&_.ProseMirror_ol]:list-decimal',
  '[&_.ProseMirror_li]:mb-1 [&_.ProseMirror_li::marker]:text-[var(--brand-text)]',
  '[&_.ProseMirror_a]:text-teal-400 [&_.ProseMirror_a]:underline',
].join(' ');

export const prosemirrorClientClass = [
  '[&_.ProseMirror]:text-sm [&_.ProseMirror]:leading-7',
  '[&_.ProseMirror_h2]:text-lg [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:text-[var(--brand-text-bright)] [&_.ProseMirror_h2]:mt-5 [&_.ProseMirror_h2]:mb-2',
  '[&_.ProseMirror_h3]:text-base [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_h3]:text-[var(--brand-text-bright)] [&_.ProseMirror_h3]:mt-4 [&_.ProseMirror_h3]:mb-1.5',
].join(' ');

export const prosemirrorAdminClass = [
  '[&_.ProseMirror]:text-sm [&_.ProseMirror]:leading-6',
  '[&_.ProseMirror_h2]:text-base [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:text-[var(--brand-text-bright)] [&_.ProseMirror_h2]:mt-4 [&_.ProseMirror_h2]:mb-2',
  '[&_.ProseMirror_h3]:text-sm [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_h3]:text-[var(--brand-text-bright)] [&_.ProseMirror_h3]:mt-3 [&_.ProseMirror_h3]:mb-1',
].join(' ');

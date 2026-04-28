import { useState, useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';

export interface RichTextEditorProps {
  initialValue: string;
  onChange: (html: string) => void;
  className?: string;
}

export function RichTextEditor({ initialValue, onChange, className }: RichTextEditorProps) {
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const linkInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
    ],
    content: initialValue,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  useEffect(() => {
    if (showLinkInput) {
      setTimeout(() => linkInputRef.current?.focus(), 0);
    }
  }, [showLinkInput]);

  const applyLink = () => {
    if (!editor) return;
    if (linkUrl) {
      editor.chain().focus().setLink({ href: linkUrl }).run();
    } else {
      editor.chain().focus().unsetLink().run();
    }
    setShowLinkInput(false);
    setLinkUrl('');
  };

  return (
    <div className={`relative ${className ?? ''}`}>
      {editor && (
        <BubbleMenu
          editor={editor}
          className="flex items-center gap-0.5 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-lg shadow-xl p-1 z-[var(--z-modal-backdrop)]"
        >
          {showLinkInput ? (
            <div className="flex items-center gap-1 px-1">
              <input
                ref={linkInputRef}
                type="url"
                value={linkUrl}
                onChange={e => setLinkUrl(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
                  if (e.key === 'Escape') { setShowLinkInput(false); setLinkUrl(''); }
                }}
                placeholder="https://..."
                className="w-44 bg-transparent text-[var(--brand-text)] text-xs px-1 py-0.5 focus:outline-none border-b border-teal-500/50"
              />
              <button
                onMouseDown={e => { e.preventDefault(); applyLink(); }}
                className="t-caption-sm text-teal-300 hover:text-teal-200 px-1 py-0.5"
              >
                OK
              </button>
              <button
                onMouseDown={e => { e.preventDefault(); setShowLinkInput(false); setLinkUrl(''); }}
                className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] px-1 py-0.5"
              >
                ✕
              </button>
            </div>
          ) : (
            <>
              <button
                onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}
                className={`px-2 py-1 rounded text-xs font-bold transition-colors ${editor.isActive('bold') ? 'bg-teal-500/20 text-teal-300' : 'text-[var(--brand-text)] hover:bg-[var(--surface-3)]'}`}
              >
                B
              </button>
              <button
                onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}
                className={`px-2 py-1 rounded text-xs italic transition-colors ${editor.isActive('italic') ? 'bg-teal-500/20 text-teal-300' : 'text-[var(--brand-text)] hover:bg-[var(--surface-3)]'}`}
              >
                I
              </button>
              <button
                onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleHeading({ level: 2 }).run(); }}
                className={`px-2 py-1 rounded text-xs font-semibold transition-colors ${editor.isActive('heading', { level: 2 }) ? 'bg-teal-500/20 text-teal-300' : 'text-[var(--brand-text)] hover:bg-[var(--surface-3)]'}`}
              >
                H2
              </button>
              <button
                onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleHeading({ level: 3 }).run(); }}
                className={`px-2 py-1 rounded text-xs font-semibold transition-colors ${editor.isActive('heading', { level: 3 }) ? 'bg-teal-500/20 text-teal-300' : 'text-[var(--brand-text)] hover:bg-[var(--surface-3)]'}`}
              >
                H3
              </button>
              <button
                onMouseDown={e => {
                  e.preventDefault();
                  const href = editor.getAttributes('link').href as string | undefined;
                  if (href) setLinkUrl(href);
                  setShowLinkInput(true);
                }}
                className={`px-2 py-1 rounded text-xs transition-colors ${editor.isActive('link') ? 'bg-teal-500/20 text-teal-300' : 'text-[var(--brand-text)] hover:bg-[var(--surface-3)]'}`}
                title="Link (Cmd+K)"
              >
                🔗
              </button>
            </>
          )}
        </BubbleMenu>
      )}
      <EditorContent
        editor={editor}
        className={[
          '[&_.ProseMirror]:min-h-[120px] [&_.ProseMirror]:px-3 [&_.ProseMirror]:py-2',
          '[&_.ProseMirror]:bg-[var(--surface-1)] [&_.ProseMirror]:border [&_.ProseMirror]:border-[var(--brand-border)]',
          '[&_.ProseMirror]:rounded-[var(--radius-lg)] [&_.ProseMirror]:text-xs [&_.ProseMirror]:text-[var(--brand-text)]',
          '[&_.ProseMirror]:focus:border-teal-500/50 [&_.ProseMirror]:focus:outline-none',
          '[&_.ProseMirror_p]:mb-2 [&_.ProseMirror_strong]:text-[var(--brand-text-bright)]',
          '[&_.ProseMirror_h2]:text-sm [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:text-[var(--brand-text-bright)] [&_.ProseMirror_h2]:mt-4 [&_.ProseMirror_h2]:mb-2',
          '[&_.ProseMirror_h3]:text-xs [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_h3]:text-[var(--brand-text-bright)] [&_.ProseMirror_h3]:mt-3 [&_.ProseMirror_h3]:mb-1',
          '[&_.ProseMirror_ul]:pl-4 [&_.ProseMirror_ul]:mb-2 [&_.ProseMirror_ol]:pl-4 [&_.ProseMirror_ol]:mb-2',
          '[&_.ProseMirror_li]:mb-1 [&_.ProseMirror_a]:text-teal-400 [&_.ProseMirror_a]:underline',
        ].join(' ')}
      />
    </div>
  );
}

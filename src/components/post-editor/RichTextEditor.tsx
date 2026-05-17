import { useState, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { Link as LinkIcon, Bold, Italic, Heading2, Heading3 } from 'lucide-react';
import { Button, FormInput, IconButton } from '../ui';

export interface RichTextEditorProps {
  initialValue: string;
  onChange: (html: string) => void;
  className?: string;
  variant?: 'admin' | 'client';
  minHeight?: string;
}

export function RichTextEditor({ initialValue, onChange, className, variant = 'admin', minHeight }: RichTextEditorProps) {
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

  // Sync external content into the editor only when:
  //   (a) the editor isn't currently focused (user isn't typing), AND
  //   (b) the incoming initialValue actually changed since the last sync.
  // The focus guard prevents a race where an in-flight auto-save resolves,
  // the parent re-renders with the saved HTML, and setContent() clobbers
  // the user's keystrokes that arrived during the save round-trip.
  // Tracking the last-synced value via a ref (instead of comparing against
  // editor.getHTML()) sidesteps subtle HTML normalization differences
  // between TipTap output and the server's sanitizer.
  const lastSyncedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editor) return;
    if (editor.isFocused) return;
    if (lastSyncedRef.current === initialValue) return;
    lastSyncedRef.current = initialValue;
    editor.commands.setContent(initialValue, { emitUpdate: false });
  }, [editor, initialValue]);

  // useEditor() handles editor.destroy() on unmount automatically — no manual cleanup needed.

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

  const toolbar = editor && (
    <>
      {showLinkInput ? (
        <div className="flex items-center gap-1 px-1">
          <FormInput
            ref={linkInputRef}
            type="url"
            value={linkUrl}
            onChange={setLinkUrl}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
              if (e.key === 'Escape') { setShowLinkInput(false); setLinkUrl(''); }
            }}
            placeholder="https://..."
            className="w-44 bg-transparent text-[var(--brand-text)] text-xs px-1 py-0.5 focus:outline-none border-b border-teal-500/50"
          />
          <Button
            onMouseDown={e => { e.preventDefault(); applyLink(); }}
            variant="ghost"
            size="sm"
            className="t-caption-sm text-teal-300 hover:text-teal-200 !px-1 !py-0.5"
          >
            OK
          </Button>
          <Button
            onMouseDown={e => { e.preventDefault(); setShowLinkInput(false); setLinkUrl(''); }}
            variant="ghost"
            size="sm"
            className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] !px-1 !py-0.5"
          >
            x
          </Button>
        </div>
      ) : (
        <>
          <Button
            aria-label="Bold"
            aria-pressed={editor.isActive('bold')}
            onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}
            variant="ghost"
            size="sm"
            className={`!px-2 !py-1 text-xs font-bold ${editor.isActive('bold') ? 'bg-teal-500/20 text-teal-300' : 'text-[var(--brand-text)] hover:bg-[var(--surface-3)]'}`}
            title="Bold"
          >
            {variant === 'client' ? <Bold className="w-3.5 h-3.5" /> : 'B'}
          </Button>
          <Button
            aria-label="Italic"
            aria-pressed={editor.isActive('italic')}
            onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}
            variant="ghost"
            size="sm"
            className={`!px-2 !py-1 text-xs italic ${editor.isActive('italic') ? 'bg-teal-500/20 text-teal-300' : 'text-[var(--brand-text)] hover:bg-[var(--surface-3)]'}`}
            title="Italic"
          >
            {variant === 'client' ? <Italic className="w-3.5 h-3.5" /> : 'I'}
          </Button>
          <Button
            aria-label="Heading 2"
            aria-pressed={editor.isActive('heading', { level: 2 })}
            onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleHeading({ level: 2 }).run(); }}
            variant="ghost"
            size="sm"
            className={`!px-2 !py-1 text-xs font-semibold ${editor.isActive('heading', { level: 2 }) ? 'bg-teal-500/20 text-teal-300' : 'text-[var(--brand-text)] hover:bg-[var(--surface-3)]'}`}
            title="Heading 2"
          >
            {variant === 'client' ? <Heading2 className="w-3.5 h-3.5" /> : 'H2'}
          </Button>
          <Button
            aria-label="Heading 3"
            aria-pressed={editor.isActive('heading', { level: 3 })}
            onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleHeading({ level: 3 }).run(); }}
            variant="ghost"
            size="sm"
            className={`!px-2 !py-1 text-xs font-semibold ${editor.isActive('heading', { level: 3 }) ? 'bg-teal-500/20 text-teal-300' : 'text-[var(--brand-text)] hover:bg-[var(--surface-3)]'}`}
            title="Heading 3"
          >
            {variant === 'client' ? <Heading3 className="w-3.5 h-3.5" /> : 'H3'}
          </Button>
          <IconButton
            icon={LinkIcon}
            aria-label="Insert link"
            label="Insert link"
            onMouseDown={e => {
              e.preventDefault();
              const href = editor.getAttributes('link').href as string | undefined;
              if (href) setLinkUrl(href);
              setShowLinkInput(true);
            }}
            size="sm"
            variant="ghost"
            className={`${editor.isActive('link') ? 'bg-teal-500/20 text-teal-300' : 'text-[var(--brand-text)] hover:bg-[var(--surface-3)]'}`}
            title="Link"
          />
        </>
      )}
    </>
  );

  return (
    <div className={`relative ${className ?? ''}`}>
      {editor && variant === 'client' && (
        <div className="sticky top-0 z-[var(--z-sticky)] mb-2 flex items-center gap-0.5 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] shadow-sm p-1">
          {toolbar}
        </div>
      )}
      {editor && variant !== 'client' && (
        <BubbleMenu
          editor={editor}
          className="flex items-center gap-0.5 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] shadow-xl p-1 z-[var(--z-modal-backdrop)]"
        >
          {toolbar}
        </BubbleMenu>
      )}
      <EditorContent
        editor={editor}
        style={minHeight ? ({ '--editor-min-height': minHeight } as CSSProperties) : undefined}
        className={[
          minHeight ? '[&_.ProseMirror]:min-h-[var(--editor-min-height)]' : '[&_.ProseMirror]:min-h-[120px]',
          variant === 'client' ? '[&_.ProseMirror]:px-4 [&_.ProseMirror]:py-3' : '[&_.ProseMirror]:px-3 [&_.ProseMirror]:py-2',
          '[&_.ProseMirror]:bg-[var(--surface-1)] [&_.ProseMirror]:border [&_.ProseMirror]:border-[var(--brand-border)]',
          '[&_.ProseMirror]:rounded-[var(--radius-lg)] [&_.ProseMirror]:text-[var(--brand-text)]',
          variant === 'client' ? '[&_.ProseMirror]:text-sm [&_.ProseMirror]:leading-7' : '[&_.ProseMirror]:text-xs',
          '[&_.ProseMirror]:focus:border-teal-500/50 [&_.ProseMirror]:focus:outline-none',
          '[&_.ProseMirror_p]:mb-2 [&_.ProseMirror_strong]:text-[var(--brand-text-bright)]',
          variant === 'client'
            ? '[&_.ProseMirror_h2]:text-lg [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:text-[var(--brand-text-bright)] [&_.ProseMirror_h2]:mt-5 [&_.ProseMirror_h2]:mb-2 [&_.ProseMirror_h3]:text-base [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_h3]:text-[var(--brand-text-bright)] [&_.ProseMirror_h3]:mt-4 [&_.ProseMirror_h3]:mb-1.5'
            : '[&_.ProseMirror_h2]:text-sm [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:text-[var(--brand-text-bright)] [&_.ProseMirror_h2]:mt-4 [&_.ProseMirror_h2]:mb-2 [&_.ProseMirror_h3]:text-xs [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_h3]:text-[var(--brand-text-bright)] [&_.ProseMirror_h3]:mt-3 [&_.ProseMirror_h3]:mb-1',
          '[&_.ProseMirror_ul]:pl-4 [&_.ProseMirror_ul]:mb-2 [&_.ProseMirror_ol]:pl-4 [&_.ProseMirror_ol]:mb-2',
          '[&_.ProseMirror_li]:mb-1 [&_.ProseMirror_a]:text-teal-400 [&_.ProseMirror_a]:underline',
        ].join(' ')}
      />
    </div>
  );
}

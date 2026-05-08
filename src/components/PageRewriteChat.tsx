import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Send, Loader2, ArrowLeft,
  Copy, Check, FileText, Sparkles, Maximize2,
} from 'lucide-react';
import { Document, Packer } from 'docx';
import { post, get } from '../api/client';
import { RenderMarkdown } from './client/helpers';
import { queryKeys } from '../lib/queryKeys';
import { extractRewriteOnly, parseRewriteSectionTarget } from '../lib/rewriteResponse';
import { useToast } from './Toast';
import { Icon, IconButton } from './ui';
import {
  QUICK_PROMPTS,
  createRewriteSessionId,
  getIndentLevel,
  isUrlQuery,
  type ChatMessage,
  type PageData,
  type SitemapPage,
} from './page-rewrite-chat/pageRewriteChatModel';
import {
  buildDocHtml,
  serializeDocToDocx,
  serializeDocToMarkdown,
} from './page-rewrite-chat/pageRewriteChatDocument';
import {
  applyRewriteToSection,
  clearFormattingSelection,
  execFormatCommand,
  wrapSelectionHeading,
} from './page-rewrite-chat/pageRewriteChatActions';
import { PageRewriteDocumentPane } from './page-rewrite-chat/PageRewriteDocumentPane';

interface Props {
  workspaceId: string;
  initialPageUrl?: string;
  focusMode?: boolean;
  onFocusModeToggle?: () => void;
  onBack: () => void;
}

export function PageRewriteChat({ workspaceId, initialPageUrl, focusMode, onFocusModeToggle, onBack }: Props) {
  const { toast } = useToast();

  // Page state
  const [pageUrl, setPageUrl] = useState(initialPageUrl || '');
  const [pageData, setPageData] = useState<PageData | null>(null);
  const [loadingPage, setLoadingPage] = useState(false);
  const [pageError, setPageError] = useState('');

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId] = useState(() => createRewriteSessionId());

  // Content pane state
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  // Refs
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Sitemap combobox
  const { data: sitemapPages = [] } = useQuery<SitemapPage[]>({
    queryKey: queryKeys.admin.rewritePages(workspaceId),
    queryFn: () => get<SitemapPage[]>(`/api/rewrite-chat/${workspaceId}/pages`),
    staleTime: 5 * 60 * 1000,
  });
  const [comboOpen, setComboOpen] = useState(false);
  const [comboQuery, setComboQuery] = useState('');
  const [comboIdx, setComboIdx] = useState(0);
  const comboRef = useRef<HTMLDivElement>(null);
  const comboInputRef = useRef<HTMLInputElement>(null);

  // Editable AI message content (keyed by message array index)
  const [msgEdits, setMsgEdits] = useState<Record<number, string>>({});

  const docBodyRef = useRef<HTMLDivElement | null>(null);
  const docPanelRef = useRef<HTMLDivElement>(null);

  // Floating formatting toolbar
  const [toolbarPos, setToolbarPos] = useState<{ top: number; left: number } | null>(null);

  // Export popover
  const [exportOpen, setExportOpen] = useState(false);
  const exportBtnRef = useRef<HTMLButtonElement>(null);
  const exportPopoverRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-load page if initial URL provided
  useEffect(() => {
    if (initialPageUrl) loadPage(initialPageUrl);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!comboOpen) return;
    const handler = (e: MouseEvent) => {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setComboOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [comboOpen]);

  // Show floating toolbar when text is selected inside the document panel
  useEffect(() => {
    const handleSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) { setToolbarPos(null); return; }
      if (!docBodyRef.current) return;
      try {
        const range = sel.getRangeAt(0);
        if (!docBodyRef.current.contains(range.commonAncestorContainer)) { setToolbarPos(null); return; }
        const selRect = range.getBoundingClientRect();
        const panelRect = docPanelRef.current?.getBoundingClientRect();
        if (!panelRect) return;
        const left = Math.min(Math.max(selRect.left - panelRect.left, 0), panelRect.width - 148);
        setToolbarPos({ top: selRect.top - panelRect.top - 38, left });
      } catch { setToolbarPos(null); }
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, []);

  // Close export popover on outside click
  useEffect(() => {
    if (!exportOpen) return;
    const handler = (e: MouseEvent) => {
      if (exportPopoverRef.current && !exportPopoverRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [exportOpen]);

  useEffect(() => {
    if (!exportOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'Escape') setExportOpen(false);
    };
    // keydown-ok: includes input/textarea/select/contenteditable guard before handling Escape.
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [exportOpen]);

  const loadPage = useCallback(async (url: string) => {
    if (!url.trim()) return;
    setLoadingPage(true);
    setPageError('');
    // Clear the pageKey guard so the ref callback re-initializes even for the same page
    if (docBodyRef.current) docBodyRef.current.dataset.pageKey = '';
    try {
      const data = await post<PageData>(`/api/rewrite-chat/${workspaceId}/load-page`, { url: url.trim() });
      setPageData(data);
      setPageUrl(url.trim());
    } catch (err) {
      setPageData(null);
      setPageError(err instanceof Error ? err.message : 'Failed to load page');
    } finally {
      setLoadingPage(false);
    }
  }, [workspaceId]);

  const sendMessage = async (text?: string) => {
    const question = (text || input).trim();
    if (!question || sending) return;

    const userMsg: ChatMessage = { role: 'user', content: question, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const resp = await post<{ answer: string }>(`/api/rewrite-chat/${workspaceId}`, {
        question,
        sessionId,
        pageUrl: pageData ? pageUrl : undefined,
        pageContent: pageData?.bodyText,
        pageTitle: pageData?.title,
        pageIssues: pageData?.issues,
      });

      const sectionTarget = parseRewriteSectionTarget(resp.answer);
      const assistantMsg: ChatMessage = { role: 'assistant', content: resp.answer, timestamp: Date.now(), sectionTarget };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      const errMsg: ChatMessage = {
        role: 'assistant',
        content: `**Error:** ${err instanceof Error ? err.message : 'Failed to get response'}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const copyToClipboard = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const comboQueryIsUrl = isUrlQuery(comboQuery);

  const filteredPages = comboQueryIsUrl
    ? []
    : sitemapPages.filter(p =>
        !comboQuery ||
        p.slug.toLowerCase().includes(comboQuery.toLowerCase()) ||
        p.title.toLowerCase().includes(comboQuery.toLowerCase())
      );

  const handleComboKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (filteredPages.length > 0) setComboIdx(i => Math.min(i + 1, filteredPages.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setComboIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (comboQueryIsUrl) { loadPage(comboQuery.trim()); setComboOpen(false); }
      else if (filteredPages[comboIdx]) { selectPage(filteredPages[comboIdx]); }
    } else if (e.key === 'Escape') { e.stopPropagation(); setComboOpen(false); }
  };

  const selectPage = (page: SitemapPage) => {
    setComboQuery('');
    setComboOpen(false);
    setComboIdx(0);
    if (page.url) loadPage(page.url);
  };

  const openCombo = () => {
    setComboOpen(true);
    setComboQuery('');
    setComboIdx(0);
    setTimeout(() => comboInputRef.current?.focus(), 0);
  };

  const applyToSection = (content: string, sectionTarget: string) => {
    const { foundSection } = applyRewriteToSection(docBodyRef.current, content, sectionTarget);
    if (!foundSection) {
      toast('Section not found — content inserted at end', 'info');
    }
  };

  const handleExport = (mode: 'copy' | 'download' | 'docx') => {
    const slug = (pageData?.slug || 'page').replace(/\//g, '-').replace(/^-/, '');
    if (mode === 'docx') {
      const doc = new Document({
        styles: {
          default: {
            document: { run: { font: 'Calibri', size: 24, color: '1a1a1a' } },
          },
          paragraphStyles: [
            {
              id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
              run: { font: 'Calibri', size: 56, bold: true, color: '111111' },
              paragraph: { spacing: { before: 480, after: 160 }, outlineLevel: 0 },
            },
            {
              id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
              run: { font: 'Calibri', size: 40, bold: true, color: '111111' },
              paragraph: { spacing: { before: 400, after: 120 }, outlineLevel: 1 },
            },
            {
              id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
              run: { font: 'Calibri', size: 32, bold: true, color: '222222' },
              paragraph: { spacing: { before: 320, after: 80 }, outlineLevel: 2 },
            },
            {
              id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true,
              run: { font: 'Calibri', size: 26, bold: true, italics: true, color: '444444' },
              paragraph: { spacing: { before: 240, after: 60 }, outlineLevel: 3 },
            },
          ],
        },
        sections: [{
          properties: {
            page: {
              size: { width: 12240, height: 15840 },
              margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
            },
          },
          children: serializeDocToDocx(docBodyRef.current, pageData),
        }],
      });
      Packer.toBlob(doc).then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${slug}-brief.docx`;
        a.click();
        URL.revokeObjectURL(url);
        setExportOpen(false);
      }).catch(err => {
        console.error('DOCX export failed:', err);
        setExportOpen(false);
        alert('Export failed. Please try again.');
      });
      return;
    }
    const md = serializeDocToMarkdown(docBodyRef.current, pageData);
    if (mode === 'copy') {
      navigator.clipboard.writeText(md);
    } else {
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slug}-brief.md`;
      a.click();
      URL.revokeObjectURL(url);
    }
    setExportOpen(false);
  };

  const handleFormatBold = () => execFormatCommand('bold', docBodyRef.current);
  const handleFormatItalic = () => execFormatCommand('italic', docBodyRef.current);
  const handleHeading2 = () => wrapSelectionHeading('h2', docBodyRef.current);
  const handleHeading3 = () => wrapSelectionHeading('h3', docBodyRef.current);

  const docBodyRefCallback = (el: HTMLDivElement | null) => {
    docBodyRef.current = el;
    if (!el || !pageData) return;
    // Use slug, then title, then URL as fallback — never '' (empty string matches cleared state)
    const pageKey = pageData.slug || pageData.title || pageData.url || '__loaded__';
    if (el.dataset.pageKey === pageKey) return;
    el.dataset.pageKey = pageKey;
    el.innerHTML = buildDocHtml(pageData);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--brand-border)] bg-[var(--surface-2)]/80 backdrop-blur-sm flex-shrink-0">
        <button
          onClick={onBack}
          className="p-1.5 rounded-[var(--radius-lg)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] hover:bg-[var(--surface-3)] transition-colors"
          title="Back"
        >
          <Icon as={ArrowLeft} size="md" />
        </button>
        <div className="flex items-center gap-2">
          <Icon as={Sparkles} size="md" className="text-accent-brand" />
          <h1 className="text-sm font-semibold text-[var(--brand-text-bright)]">AI Page Rewriter</h1>
        </div>

        {/* Sitemap combobox */}
        <div className="flex-1 ml-4 relative" ref={comboRef}>

          {/* Collapsed: page loaded */}
          {pageData && !comboOpen && (
            <div className="flex items-center gap-2 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] px-3 py-1.5">
              <Icon as={FileText} size="sm" className="text-[var(--brand-text-muted)] flex-shrink-0" />
              <span className="text-xs text-[var(--brand-text-bright)] flex-1 truncate">{pageData.slug ? `/${pageData.slug}` : pageUrl}</span>
              <button onClick={openCombo} className={"text-[10px] text-accent-brand hover:text-accent-brand font-medium flex-shrink-0" // arbitrary-text-ok
              }>Change</button>
            </div>
          )}

          {/* Closed: no page */}
          {!pageData && !comboOpen && (
            <button
              onClick={openCombo}
              className="w-full flex items-center gap-2 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] px-3 py-1.5 text-xs text-[var(--brand-text-muted)] hover:border-teal-500/50 hover:text-[var(--brand-text-bright)] transition-colors"
            >
              <Icon as={FileText} size="sm" />
              Search pages or paste a URL…
            </button>
          )}

          {/* Open */}
          {comboOpen && (
            <div className="flex flex-col bg-[var(--surface-3)] border border-teal-500/50 rounded-[var(--radius-lg)] overflow-hidden shadow-xl">
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--brand-border)]">
                <Icon as={FileText} size="sm" className="text-[var(--brand-text-muted)] flex-shrink-0" />
                <input
                  ref={comboInputRef}
                  role="combobox"
                  aria-expanded={filteredPages.length > 0}
                  aria-activedescendant={filteredPages[comboIdx] ? `combo-opt-${comboIdx}` : undefined}
                  aria-label="Search pages or paste a URL"
                  autoFocus
                  value={comboQuery}
                  onChange={e => { setComboQuery(e.target.value); setComboIdx(0); }}
                  onKeyDown={handleComboKeyDown}
                  placeholder="Search pages or paste a URL…"
                  className="flex-1 bg-transparent text-xs text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none"
                />
                {loadingPage && <Loader2 className="w-3 h-3 animate-spin text-accent-brand flex-shrink-0" />}
              </div>

              {comboQueryIsUrl && (
                <div className="px-3 py-2">
                  <button
                    onClick={() => { loadPage(comboQuery.trim()); setComboOpen(false); }}
                    className="text-xs text-accent-brand hover:text-accent-brand"
                  >
                    Load {comboQuery.length > 60 ? `${comboQuery.slice(0, 60)}…` : comboQuery}
                  </button>
                </div>
              )}

              {!comboQueryIsUrl && filteredPages.length > 0 && (
                <div className="max-h-[240px] overflow-y-auto">
                  {filteredPages.map((page, i) => (
                    <button
                      key={page.slug}
                      id={`combo-opt-${i}`}
                      role="option"
                      aria-selected={i === comboIdx}
                      onClick={() => selectPage(page)}
                      onMouseEnter={() => setComboIdx(i)}
                      className={`w-full flex items-center gap-2 py-1.5 text-xs text-left transition-colors border-l-2 ${
                        i === comboIdx
                          ? 'bg-teal-500/10 text-[var(--brand-text-bright)] border-teal-500'
                          : 'text-[var(--brand-text)] hover:bg-[var(--surface-1)]/50 hover:text-[var(--brand-text-bright)] border-transparent'
                      }`}
                      style={{ paddingLeft: `${12 + getIndentLevel(page.slug) * 12}px` }}
                    >
                      <FileText className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{page.slug || '/'}</span>
                    </button>
                  ))}
                </div>
              )}

              {!comboQueryIsUrl && filteredPages.length === 0 && (
                <div className="px-3 py-2 t-caption-sm text-[var(--brand-text-muted)]">
                  {sitemapPages.length > 0 ? `No pages match "${comboQuery}"` : 'No sitemap — paste a full URL above'}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Focus mode toggle */}
        {onFocusModeToggle && (
          <button
            onClick={onFocusModeToggle}
            title={focusMode ? 'Exit focus mode (Esc)' : 'Enter focus mode'}
            className={`p-1.5 rounded-[var(--radius-lg)] transition-colors flex-shrink-0 ${
              focusMode
                ? 'text-accent-brand bg-teal-500/10 hover:bg-teal-500/20'
                : 'text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] hover:bg-[var(--surface-3)]'
            }`}
          >
            <Icon as={Maximize2} size="md" className={`transition-transform ${focusMode ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {/* Main two-pane layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* ═══ LEFT PANE: Chat ═══ */}
        <div className="flex flex-col w-1/2 border-r border-[var(--brand-border)]">
          {/* Chat messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
                <div className="w-12 h-12 rounded-[var(--radius-xl)] bg-teal-500/10 flex items-center justify-center">
                  <Sparkles className="w-6 h-6 text-accent-brand" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-[var(--brand-text-bright)] mb-1">AI Page Rewriter</h2>
                  <p className="text-xs text-[var(--brand-text-muted)] max-w-sm">
                    {pageData
                      ? `"${pageData.title}" is loaded. Ask me to rewrite sections, optimize headings, add FAQ blocks, or improve AEO.`
                      : 'Load a page above, then ask me to rewrite sections, optimize for AEO, or suggest improvements.'}
                  </p>
                </div>

                {/* Quick prompts */}
                {pageData && (
                  <div className="grid grid-cols-2 gap-2 max-w-md mt-2">
                    {QUICK_PROMPTS.map((prompt, i) => (
                      <button
                        key={i}
                        onClick={() => sendMessage(prompt)}
                        className="text-left px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-3)]/50 border border-[var(--brand-border)]/50 hover:border-teal-500/30 hover:bg-[var(--surface-3)] t-caption-sm text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] transition-colors"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-[var(--radius-xl)] px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-teal-600/20 border border-teal-500/20 text-[var(--brand-text-bright)]'
                    : 'bg-[var(--surface-3)]/80 border border-[var(--brand-border)]/50 text-[var(--brand-text-bright)]'
                }`}>
                  {msg.role === 'assistant' ? (
                    msg.sectionTarget ? (
                      // Rewrite message: editable contenteditable block + Apply button
                      <>
                        <div
                          contentEditable
                          suppressContentEditableWarning
                          className="text-xs leading-relaxed focus:outline-none border border-transparent focus:border-[var(--brand-border-hover)] rounded p-1 -m-1 transition-colors"
                          onInput={e => setMsgEdits(prev => ({ ...prev, [i]: (e.currentTarget as HTMLDivElement).innerText }))}
                          ref={(el) => {
                            // Initialize content once; do NOT use dangerouslySetInnerHTML (React would overwrite on re-render)
                            if (el && !el.dataset.initialized) {
                              el.dataset.initialized = 'true';
                              el.innerText = extractRewriteOnly(msg.content);
                            }
                          }}
                        />
                        <div className="flex items-center gap-1 mt-2 pt-2 border-t border-[var(--brand-border)]/30">
                          <button
                            onClick={() => applyToSection(msgEdits[i] ?? extractRewriteOnly(msg.content), msg.sectionTarget!)}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-teal-500/10 text-accent-brand border border-teal-500/30 hover:bg-teal-500/20 transition-colors" // arbitrary-text-ok
                          >
                            <Icon as={Check} size="sm" />
                            Apply to {msg.sectionTarget}
                          </button>
                          <button
                            onClick={() => copyToClipboard(msgEdits[i] ?? extractRewriteOnly(msg.content), i)}
                            className={"flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] hover:bg-[var(--surface-1)]/50 transition-colors" // arbitrary-text-ok
                            }
                          >
                            {copiedIdx === i ? <Icon as={Check} size="sm" className="text-accent-brand" /> : <Icon as={Copy} size="sm" />}
                            {copiedIdx === i ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                      </>
                    ) : (
                      // Regular assistant message: rendered markdown + copy button
                      <>
                        <div className="text-xs leading-relaxed">
                          <RenderMarkdown text={msg.content} />
                        </div>
                        <div className="flex items-center gap-1 mt-2 pt-2 border-t border-[var(--brand-border)]/30">
                          <button
                            onClick={() => copyToClipboard(msg.content, i)}
                            className={"flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] hover:bg-[var(--surface-1)]/50 transition-colors" // arbitrary-text-ok
                            }
                          >
                            {copiedIdx === i ? <Icon as={Check} size="sm" className="text-accent-brand" /> : <Icon as={Copy} size="sm" />}
                            {copiedIdx === i ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                      </>
                    )
                  ) : (
                    <p className="text-xs leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex justify-start">
                <div className="bg-[var(--surface-3)]/80 border border-[var(--brand-border)]/50 rounded-[var(--radius-lg)] px-4 py-3 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-brand" />
                  <span className="text-xs text-[var(--brand-text)]">Analyzing and writing...</span>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Input area */}
          <div className="flex-shrink-0 border-t border-[var(--brand-border)] px-4 py-3 bg-[var(--surface-2)]/50">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={pageData ? 'Ask me to rewrite a section, optimize headings, add FAQs...' : 'Load a page first, or ask a general rewriting question...'}
                className="flex-1 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] px-3 py-2 text-xs text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500 resize-none min-h-[40px] max-h-[120px]"
                rows={2}
              />
              <IconButton
                icon={Send}
                size="md"
                variant="solid"
                label="Send message"
                onClick={() => sendMessage()}
                disabled={sending || !input.trim()}
                className="flex-shrink-0 bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-40"
              />
            </div>
          </div>
        </div>

        <PageRewriteDocumentPane
          pageData={pageData}
          pageUrl={pageUrl}
          loadingPage={loadingPage}
          pageError={pageError}
          docPanelRef={docPanelRef}
          docBodyRefCallback={docBodyRefCallback}
          toolbarPos={toolbarPos}
          exportOpen={exportOpen}
          onToggleExport={() => setExportOpen(o => !o)}
          onExport={handleExport}
          exportPopoverRef={exportPopoverRef}
          exportBtnRef={exportBtnRef}
          onBold={handleFormatBold}
          onItalic={handleFormatItalic}
          onHeading2={handleHeading2}
          onHeading3={handleHeading3}
          onClearFormatting={clearFormattingSelection}
        />
      </div>
    </div>
  );
}

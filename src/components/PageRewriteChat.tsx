import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Document, Packer } from 'docx';
import { post, get } from '../api/client';
import { queryKeys } from '../lib/queryKeys';
import { parseRewriteSectionTarget } from '../lib/rewriteResponse';
import { useToast } from './Toast';
import {
  createRewriteSessionId,
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
import { PageRewriteHeaderBar } from './page-rewrite-chat/PageRewriteHeaderBar';
import { PageRewriteChatPane } from './page-rewrite-chat/PageRewriteChatPane';
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
      <PageRewriteHeaderBar
        pageData={pageData}
        pageUrl={pageUrl}
        loadingPage={loadingPage}
        focusMode={focusMode}
        onFocusModeToggle={onFocusModeToggle}
        onBack={onBack}
        comboOpen={comboOpen}
        comboQuery={comboQuery}
        comboIdx={comboIdx}
        comboQueryIsUrl={comboQueryIsUrl}
        filteredPages={filteredPages}
        sitemapPages={sitemapPages}
        comboRef={comboRef}
        comboInputRef={comboInputRef}
        onOpenCombo={openCombo}
        onComboQueryChange={setComboQuery}
        onComboKeyDown={handleComboKeyDown}
        onSelectPage={selectPage}
        onLoadTypedUrl={() => { loadPage(comboQuery.trim()); setComboOpen(false); }}
        onSetComboIdx={setComboIdx}
      />

      {/* Main two-pane layout */}
      <div className="flex flex-1 overflow-hidden">
        <PageRewriteChatPane
          pageData={pageData}
          messages={messages}
          sending={sending}
          copiedIdx={copiedIdx}
          msgEdits={msgEdits}
          input={input}
          chatEndRef={chatEndRef}
          inputRef={inputRef}
          onSendMessage={sendMessage}
          onCopyToClipboard={copyToClipboard}
          onApplyToSection={applyToSection}
          onMessageEdit={(idx, text) => setMsgEdits(prev => ({ ...prev, [idx]: text }))}
          onInputChange={setInput}
          onInputKeyDown={handleKeyDown}
        />

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

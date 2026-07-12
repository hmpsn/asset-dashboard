import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, post } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';
import { parseRewriteSectionTarget } from '../../lib/rewriteResponse';
import {
  createRewriteSessionId,
  isUrlQuery,
  type ChatMessage,
  type PageData,
  type SitemapPage,
} from './pageRewriteChatModel';
import {
  buildDocHtml,
  buildPrintableDocHtml,
  serializeDocToMarkdown,
  snapshotPageRewriteDocBody,
} from './pageRewriteChatDocument';
import {
  applyRewriteToSection,
  clearFormattingSelection,
  execFormatCommand,
  wrapSelectionHeading,
} from './pageRewriteChatActions';

type ToastFn = (message: string, type?: 'success' | 'error' | 'info') => void;
type ExportMode = 'copy' | 'download' | 'docx' | 'pdf';

interface UsePageRewriteChatShellParams {
  workspaceId: string;
  initialPageUrl?: string;
  toast: ToastFn;
}

export function usePageRewriteChatShell({ workspaceId, initialPageUrl, toast }: UsePageRewriteChatShellParams) {
  const [pageUrl, setPageUrl] = useState(initialPageUrl || '');
  const [pageData, setPageData] = useState<PageData | null>(null);
  const [loadingPage, setLoadingPage] = useState(false);
  const [pageError, setPageError] = useState('');

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [sessionId] = useState(() => createRewriteSessionId());

  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [msgEdits, setMsgEdits] = useState<Record<number, string>>({});

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const docBodyRef = useRef<HTMLDivElement | null>(null);
  const docPanelRef = useRef<HTMLDivElement>(null);

  const [comboOpen, setComboOpen] = useState(false);
  const [comboQuery, setComboQuery] = useState('');
  const [comboIdx, setComboIdx] = useState(0);
  const comboRef = useRef<HTMLDivElement>(null);
  const comboInputRef = useRef<HTMLInputElement>(null);

  const [toolbarPos, setToolbarPos] = useState<{ top: number; left: number } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const exportBtnRef = useRef<HTMLButtonElement>(null);
  const exportPopoverRef = useRef<HTMLDivElement>(null);

  const { data: sitemapPages = [] } = useQuery<SitemapPage[]>({
    queryKey: queryKeys.admin.rewritePages(workspaceId),
    queryFn: () => get<SitemapPage[]>(`/api/rewrite-chat/${workspaceId}/pages`),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadPage = useCallback(async (url: string) => {
    if (!url.trim()) return;
    setLoadingPage(true);
    setPageError('');
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

  useEffect(() => {
    if (initialPageUrl) void loadPage(initialPageUrl);
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

  const sendMessage = useCallback(async (text?: string) => {
    const question = (text || input).trim();
    if (!question || sendingRef.current) return;

    sendingRef.current = true;

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
      sendingRef.current = false;
      setSending(false);
      inputRef.current?.focus();
    }
  }, [input, pageData, pageUrl, sessionId, workspaceId]);

  const handleInputKeyDown = useCallback((e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }, [sendMessage]);

  const copyToClipboard = useCallback((text: string, idx: number) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    }).catch(() => {
      toast('Could not copy to clipboard', 'error');
    });
  }, [toast]);

  const comboQueryIsUrl = isUrlQuery(comboQuery);
  const filteredPages = comboQueryIsUrl
    ? []
    : sitemapPages.filter(p =>
        !comboQuery ||
        p.slug.toLowerCase().includes(comboQuery.toLowerCase()) ||
        p.title.toLowerCase().includes(comboQuery.toLowerCase())
      );

  const selectPage = useCallback((page: SitemapPage) => {
    setComboQuery('');
    setComboOpen(false);
    setComboIdx(0);
    if (page.url) void loadPage(page.url);
  }, [loadPage]);

  const openCombo = useCallback(() => {
    setComboOpen(true);
    setComboQuery('');
    setComboIdx(0);
    setTimeout(() => comboInputRef.current?.focus(), 0);
  }, []);

  const handleComboKeyDown = useCallback((e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filteredPages.length > 0) setComboIdx(i => Math.min(i + 1, filteredPages.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setComboIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (comboQueryIsUrl) { void loadPage(comboQuery.trim()); setComboOpen(false); }
      else if (filteredPages[comboIdx]) { selectPage(filteredPages[comboIdx]); }
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setComboOpen(false);
    }
  }, [comboIdx, comboQuery, comboQueryIsUrl, filteredPages, loadPage, selectPage]);

  const applyToSection = useCallback((content: string, sectionTarget: string) => {
    const { foundSection } = applyRewriteToSection(docBodyRef.current, content, sectionTarget);
    if (!foundSection) {
      toast('Section not found — content inserted at end', 'info');
    }
  }, [toast]);

  const handleExport = useCallback((mode: ExportMode) => {
    const slug = (pageData?.slug || 'page').replace(/\//g, '-').replace(/^-/, '');
    if (mode === 'pdf') {
      try {
        const printRoot = document.getElementById('page-rewrite-print-root') ?? document.createElement('div');
        printRoot.id = 'page-rewrite-print-root';
        printRoot.className = 'page-rewrite-print-root';
        printRoot.innerHTML = buildPrintableDocHtml(docBodyRef.current, pageData);
        if (!printRoot.parentElement) document.body.appendChild(printRoot);

        const cleanup = () => {
          document.body.classList.remove('page-rewrite-printing');
          printRoot.innerHTML = '';
          window.removeEventListener('afterprint', cleanup);
        };

        document.body.classList.add('page-rewrite-printing');
        window.addEventListener('afterprint', cleanup, { once: true });
        setExportOpen(false);
        window.print();
        window.setTimeout(cleanup, 60_000);
      } catch (err) {
        console.error('PDF export failed:', err);
        setExportOpen(false);
        toast('PDF export failed. Please try again.', 'error');
      }
      return;
    }
    if (mode === 'docx') {
      const docSnapshot = snapshotPageRewriteDocBody(docBodyRef.current);
      void import('./pageRewriteDocxExport').then(({ downloadPageRewriteDocx }) => downloadPageRewriteDocx({
        docBody: docSnapshot,
        pageData,
        fileName: `${slug}-brief.docx`,
        profile: 'legacy',
      })).then(() => {
        setExportOpen(false);
      }).catch(err => {
        console.error('DOCX export failed:', err);
        setExportOpen(false);
        toast('DOCX export failed. Please try again.', 'error');
      });
      return;
    }
    const md = serializeDocToMarkdown(docBodyRef.current, pageData);
    if (mode === 'copy') {
      void navigator.clipboard.writeText(md).catch(() => {
        toast('Could not copy Markdown', 'error');
      });
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
  }, [pageData, toast]);

  const handleFormatBold = useCallback(() => execFormatCommand('bold', docBodyRef.current), []);
  const handleFormatItalic = useCallback(() => execFormatCommand('italic', docBodyRef.current), []);
  const handleHeading2 = useCallback(() => wrapSelectionHeading('h2', docBodyRef.current), []);
  const handleHeading3 = useCallback(() => wrapSelectionHeading('h3', docBodyRef.current), []);
  const toggleExportOpen = useCallback(() => setExportOpen(prev => !prev), []);
  const loadTypedUrl = useCallback(() => {
    void loadPage(comboQuery.trim());
    setComboOpen(false);
  }, [comboQuery, loadPage]);

  const docBodyRefCallback = useCallback((el: HTMLDivElement | null) => {
    docBodyRef.current = el;
    if (!el || !pageData) return;
    const pageKey = pageData.slug || pageData.title || pageData.url || '__loaded__';
    if (el.dataset.pageKey === pageKey) return;
    el.dataset.pageKey = pageKey;
    el.innerHTML = buildDocHtml(pageData);
  }, [pageData]);

  return {
    pageUrl,
    pageData,
    loadingPage,
    pageError,
    messages,
    input,
    sending,
    copiedIdx,
    msgEdits,
    comboOpen,
    comboQuery,
    comboIdx,
    comboQueryIsUrl,
    filteredPages,
    sitemapPages,
    toolbarPos,
    exportOpen,
    chatEndRef,
    inputRef,
    comboRef,
    comboInputRef,
    docPanelRef,
    exportBtnRef,
    exportPopoverRef,
    sendMessage,
    setInput,
    setComboQuery,
    setComboIdx,
    setMsgEdits,
    setComboOpen,
    openCombo,
    selectPage,
    handleComboKeyDown,
    applyToSection,
    copyToClipboard,
    handleInputKeyDown,
    docBodyRefCallback,
    handleExport,
    toggleExportOpen,
    handleFormatBold,
    handleFormatItalic,
    handleHeading2,
    handleHeading3,
    clearFormattingSelection,
    loadTypedUrl,
  };
}

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send, Loader2, ArrowLeft, ExternalLink, AlertTriangle,
  Copy, Check, FileText, Sparkles, Maximize2,
} from 'lucide-react';
import { post, get } from '../api/client';
import { Badge } from './ui';
import { RenderMarkdown } from './client/helpers';

interface SeoIssue {
  check: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

interface PageSection {
  level: number;
  heading: string;
  body: string;
}

interface PageData {
  title: string;
  sections: PageSection[];
  bodyText: string;
  html: string;
  issues: SeoIssue[];
  slug: string;
}

interface SitemapPage {
  slug: string;
  title: string;
  url: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** Heading name parsed from **Rewriting: X** prefix; present on AI rewrite messages only */
  sectionTarget?: string;
}

interface Props {
  workspaceId: string;
  initialPageUrl?: string;
  focusMode?: boolean;
  onFocusModeToggle?: () => void;
  onBack: () => void;
}

const QUICK_PROMPTS = [
  'Rewrite the intro paragraph to lead with a direct answer',
  'Suggest an FAQ section with schema-ready Q&A pairs',
  'Optimize all headings for search intent and AEO',
  'Add citation-ready data points and statistics',
  'Rewrite this page in our brand voice with AEO best practices',
  'Identify sections that need better keyword integration',
];

export function PageRewriteChat({ workspaceId, initialPageUrl, focusMode, onFocusModeToggle, onBack }: Props) {
  // Page state
  const [pageUrl, setPageUrl] = useState(initialPageUrl || '');
  const [pageData, setPageData] = useState<PageData | null>(null);
  const [loadingPage, setLoadingPage] = useState(false);
  const [pageError, setPageError] = useState('');

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId] = useState(() => `rewrite-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  // Content pane state
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  // Refs
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Sitemap combobox
  const [sitemapPages, setSitemapPages] = useState<SitemapPage[]>([]);
  const [comboOpen, setComboOpen] = useState(false);
  const [comboQuery, setComboQuery] = useState('');
  const [comboIdx, setComboIdx] = useState(0);
  const comboRef = useRef<HTMLDivElement>(null);
  const comboInputRef = useRef<HTMLInputElement>(null);

  // Editable AI message content (keyed by message array index)
  const [msgEdits, setMsgEdits] = useState<Record<number, string>>({});

  const docBodyRef = useRef<HTMLDivElement>(null);
  const docPanelRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-load page if initial URL provided
  useEffect(() => {
    if (initialPageUrl) loadPage(initialPageUrl);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch sitemap pages for the combobox
  useEffect(() => {
    get<SitemapPage[]>(`/api/rewrite-chat/${workspaceId}/pages`)
      .then(setSitemapPages)
      .catch(() => {}); // Silent fail — URL paste still works
  }, [workspaceId]);

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

  const loadPage = useCallback(async (url: string) => {
    if (!url.trim()) return;
    setLoadingPage(true);
    setPageError('');
    try {
      const data = await post<PageData>(`/api/rewrite-chat/${workspaceId}/load-page`, { url: url.trim() });
      setPageData(data);
      setPageUrl(url.trim());
    } catch (err) {
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

      const sectionMatch = resp.answer.match(/^\*\*Rewriting:\s*([^*]+)\*\*/i);
      const sectionTarget = sectionMatch ? sectionMatch[1].trim() : undefined;
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

  const toSectionSlug = (text: string) =>
    text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const getIndentLevel = (slug: string) => {
    const segs = slug.replace(/^\/|\/$/g, '').split('/');
    return Math.max(0, segs.length - 1);
  };

  const filteredPages = comboQuery.startsWith('https://')
    ? []
    : sitemapPages.filter(p =>
        !comboQuery ||
        p.slug.toLowerCase().includes(comboQuery.toLowerCase()) ||
        p.title.toLowerCase().includes(comboQuery.toLowerCase())
      );

  const stripRewritingPrefix = (content: string): string =>
    content.replace(/^\*\*Rewriting:\s*[^*]+\*\*\s*\n?/, '');

  const handleComboKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (filteredPages.length > 0) setComboIdx(i => Math.min(i + 1, filteredPages.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setComboIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (comboQuery.startsWith('https://')) { loadPage(comboQuery); setComboOpen(false); }
      else if (filteredPages[comboIdx]) { selectPage(filteredPages[comboIdx]); }
    } else if (e.key === 'Escape') { setComboOpen(false); }
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

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-sm flex-shrink-0">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          title="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-teal-400" />
          <h1 className="text-sm font-semibold text-zinc-200">AI Page Rewriter</h1>
        </div>

        {/* Sitemap combobox */}
        <div className="flex-1 ml-4 relative" ref={comboRef}>

          {/* Collapsed: page loaded */}
          {pageData && !comboOpen && (
            <div className="flex items-center gap-2 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5">
              <FileText className="w-3 h-3 text-zinc-500 flex-shrink-0" />
              <span className="text-xs text-zinc-300 flex-1 truncate">{pageData.slug ? `/${pageData.slug}` : pageUrl}</span>
              <button onClick={openCombo} className="text-[10px] text-teal-400 hover:text-teal-300 font-medium flex-shrink-0">Change</button>
            </div>
          )}

          {/* Closed: no page */}
          {!pageData && !comboOpen && (
            <button
              onClick={openCombo}
              className="w-full flex items-center gap-2 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-500 hover:border-teal-500/50 hover:text-zinc-300 transition-colors"
            >
              <FileText className="w-3 h-3" />
              Search pages or paste a URL…
            </button>
          )}

          {/* Open */}
          {comboOpen && (
            <div className="flex flex-col bg-zinc-800 border border-teal-500/50 rounded-lg overflow-hidden shadow-xl">
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-700">
                <FileText className="w-3 h-3 text-zinc-500 flex-shrink-0" />
                <input
                  ref={comboInputRef}
                  autoFocus
                  value={comboQuery}
                  onChange={e => { setComboQuery(e.target.value); setComboIdx(0); }}
                  onKeyDown={handleComboKeyDown}
                  placeholder="Search pages or paste a URL…"
                  className="flex-1 bg-transparent text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none"
                />
                {loadingPage && <Loader2 className="w-3 h-3 animate-spin text-teal-400 flex-shrink-0" />}
              </div>

              {comboQuery.startsWith('https://') && (
                <div className="px-3 py-2">
                  <button
                    onClick={() => { loadPage(comboQuery); setComboOpen(false); }}
                    className="text-xs text-teal-400 hover:text-teal-300"
                  >
                    Load {comboQuery.length > 60 ? `${comboQuery.slice(0, 60)}…` : comboQuery}
                  </button>
                </div>
              )}

              {!comboQuery.startsWith('https://') && filteredPages.length > 0 && (
                <div className="max-h-[240px] overflow-y-auto">
                  {filteredPages.map((page, i) => (
                    <button
                      key={page.slug}
                      onClick={() => selectPage(page)}
                      onMouseEnter={() => setComboIdx(i)}
                      className={`w-full flex items-center gap-2 py-1.5 text-xs text-left transition-colors border-l-2 ${
                        i === comboIdx
                          ? 'bg-teal-500/10 text-zinc-100 border-teal-500'
                          : 'text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-200 border-transparent'
                      }`}
                      style={{ paddingLeft: `${12 + getIndentLevel(page.slug) * 12}px` }}
                    >
                      <FileText className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{page.slug || '/'}</span>
                    </button>
                  ))}
                </div>
              )}

              {!comboQuery.startsWith('https://') && filteredPages.length === 0 && (
                <div className="px-3 py-2 text-[11px] text-zinc-500">
                  {sitemapPages.length > 0 ? `No pages match "${comboQuery}"` : 'No sitemap — paste a full URL above'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main two-pane layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* ═══ LEFT PANE: Chat ═══ */}
        <div className="flex flex-col w-1/2 border-r border-zinc-800">
          {/* Chat messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-teal-500/10 flex items-center justify-center">
                  <Sparkles className="w-6 h-6 text-teal-400" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-zinc-200 mb-1">AI Page Rewriter</h2>
                  <p className="text-xs text-zinc-500 max-w-sm">
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
                        className="text-left px-3 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700/50 hover:border-teal-500/30 hover:bg-zinc-800 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
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
                <div className={`max-w-[85%] rounded-xl px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-teal-600/20 border border-teal-500/20 text-zinc-200'
                    : 'bg-zinc-800/80 border border-zinc-700/50 text-zinc-300'
                }`}>
                  {msg.role === 'assistant' ? (
                    <div className="text-xs leading-relaxed">
                      <RenderMarkdown text={msg.content} />
                    </div>
                  ) : (
                    <p className="text-xs leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  )}

                  {msg.role === 'assistant' && (
                    <div className="flex items-center gap-1 mt-2 pt-2 border-t border-zinc-700/30">
                      <button
                        onClick={() => copyToClipboard(msg.content, i)}
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/50 transition-colors"
                      >
                        {copiedIdx === i ? <Check className="w-3 h-3 text-teal-400" /> : <Copy className="w-3 h-3" />}
                        {copiedIdx === i ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex justify-start">
                <div className="bg-zinc-800/80 border border-zinc-700/50 rounded-xl px-4 py-3 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-400" />
                  <span className="text-xs text-zinc-400">Analyzing and writing...</span>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Input area */}
          <div className="flex-shrink-0 border-t border-zinc-800 px-4 py-3 bg-zinc-900/50">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={pageData ? 'Ask me to rewrite a section, optimize headings, add FAQs...' : 'Load a page first, or ask a general rewriting question...'}
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 resize-none min-h-[40px] max-h-[120px]"
                rows={2}
              />
              <button
                onClick={() => sendMessage()}
                disabled={sending || !input.trim()}
                className="p-2 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-40 text-white transition-colors flex-shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* ═══ RIGHT PANE: Page Content ═══ */}
        <div className="flex flex-col w-1/2 overflow-y-auto bg-zinc-950/50" ref={docPanelRef}>
          {!pageData && !loadingPage && !pageError && (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-3 px-8">
              <FileText className="w-8 h-8 text-zinc-600" />
              <div>
                <h3 className="text-sm font-medium text-zinc-400">No page loaded</h3>
                <p className="text-xs text-zinc-600 mt-1">
                  Enter a URL above and click "Load Page" to see the page content here alongside the chat.
                </p>
              </div>
            </div>
          )}

          {loadingPage && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-teal-400" />
              <span className="text-xs text-zinc-400">Loading page content...</span>
            </div>
          )}

          {pageError && (
            <div className="flex flex-col items-center justify-center h-full gap-3 px-8">
              <AlertTriangle className="w-6 h-6 text-amber-400/80" />
              <p className="text-xs text-zinc-400 text-center">{pageError}</p>
            </div>
          )}

          {pageData && !loadingPage && (
            <div className="px-5 py-4 space-y-4" ref={docBodyRef}>
              {/* Page title & link */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-zinc-200 flex-1">{pageData.title}</h2>
                  <a
                    href={pageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 rounded text-zinc-500 hover:text-teal-400 transition-colors"
                    title="Open page"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
                <p className="text-[11px] text-zinc-500 truncate">{pageUrl}</p>
              </div>

              {/* Audit issues */}
              {pageData.issues.length > 0 && (
                <div className="bg-zinc-900 border border-zinc-800 overflow-hidden" style={{ borderRadius: '10px 24px 10px 24px' }}>
                  <div className="w-full flex items-center gap-2 px-4 py-2.5 text-left">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400/80 flex-shrink-0" />
                    <span className="text-xs font-medium text-zinc-200 flex-1">
                      Audit Issues ({pageData.issues.length})
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Badge label={`${pageData.issues.filter(i => i.severity === 'error').length} errors`} color="red" />
                    </div>
                  </div>
                  <div className="px-4 pb-3 space-y-1.5">
                    {pageData.issues.slice(0, 15).map((issue, i) => (
                      <div key={i} className="flex items-start gap-2 text-[11px]">
                        <span className={`font-medium uppercase w-12 flex-shrink-0 ${
                          issue.severity === 'error' ? 'text-red-400/80' : issue.severity === 'warning' ? 'text-amber-400/80' : 'text-blue-400'
                        }`}>
                          {issue.severity}
                        </span>
                        <span className="text-zinc-400">{issue.message}</span>
                      </div>
                    ))}
                    {pageData.issues.length > 15 && (
                      <p className="text-[10px] text-zinc-600">+ {pageData.issues.length - 15} more issues</p>
                    )}
                  </div>
                </div>
              )}

              {/* Page sections */}
              {pageData.sections && pageData.sections.length > 0 && (
                <div className="bg-zinc-900 border border-zinc-800 p-4 space-y-2" style={{ borderRadius: '10px 24px 10px 24px' }}>
                  <h3 className="text-xs font-semibold text-zinc-300">Heading Structure</h3>
                  <div className="space-y-1">
                    {pageData.sections.map((section, i) => (
                      <div
                        key={i}
                        id={`section-${toSectionSlug(section.heading)}`}
                        className="text-[11px] text-zinc-400 pl-2 border-l-2 border-zinc-700"
                        style={{ paddingLeft: `${8 + (section.level - 1) * 8}px` }}
                      >
                        {section.heading}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Page body text */}
              <div className="bg-zinc-900 border border-zinc-800 p-4 space-y-2" style={{ borderRadius: '10px 24px 10px 24px' }}>
                <h3 className="text-xs font-semibold text-zinc-300">Page Content</h3>
                <div className="text-[11px] text-zinc-400 leading-relaxed whitespace-pre-wrap max-h-[60vh] overflow-y-auto pr-2">
                  {pageData.bodyText.slice(0, 5000)}
                  {pageData.bodyText.length > 5000 && (
                    <span className="text-zinc-600">... [truncated]</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send, Loader2, ArrowLeft, ExternalLink, AlertTriangle,
  Copy, Check, FileText, Sparkles, ChevronDown, ChevronUp,
} from 'lucide-react';
import { post } from '../api/client';
import { Badge } from './ui';
import { RenderMarkdown } from './client/helpers';

interface SeoIssue {
  check: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

interface PageData {
  title: string;
  headings: string[];
  bodyText: string;
  html: string;
  issues: SeoIssue[];
  slug: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface Props {
  workspaceId: string;
  initialPageUrl?: string;
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

export function PageRewriteChat({ workspaceId, initialPageUrl, onBack }: Props) {
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
  const [showIssues, setShowIssues] = useState(true);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  // Refs
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-load page if initial URL provided
  useEffect(() => {
    if (initialPageUrl) loadPage(initialPageUrl);
  }, [initialPageUrl, loadPage]);

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

      const assistantMsg: ChatMessage = { role: 'assistant', content: resp.answer, timestamp: Date.now() };
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

  const sevColor = (sev: string) => {
    if (sev === 'error') return 'text-red-400';
    if (sev === 'warning') return 'text-amber-400';
    return 'text-blue-400';
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

        {/* URL input */}
        <div className="flex-1 flex items-center gap-2 ml-4">
          <input
            type="url"
            value={pageUrl}
            onChange={e => setPageUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') loadPage(pageUrl); }}
            placeholder="Enter page URL to rewrite..."
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500"
          />
          <button
            onClick={() => loadPage(pageUrl)}
            disabled={loadingPage || !pageUrl.trim()}
            className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-40 text-white text-xs font-medium flex items-center gap-1.5 transition-colors"
          >
            {loadingPage ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
            Load Page
          </button>
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
        <div className="flex flex-col w-1/2 overflow-y-auto bg-zinc-950/50">
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
              <AlertTriangle className="w-6 h-6 text-amber-400" />
              <p className="text-xs text-zinc-400 text-center">{pageError}</p>
            </div>
          )}

          {pageData && !loadingPage && (
            <div className="px-5 py-4 space-y-4">
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
                <div className="rounded-xl bg-zinc-900 border border-zinc-800 overflow-hidden">
                  <button
                    onClick={() => setShowIssues(!showIssues)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-zinc-800/50 transition-colors"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                    <span className="text-xs font-medium text-zinc-200 flex-1">
                      Audit Issues ({pageData.issues.length})
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Badge label={`${pageData.issues.filter(i => i.severity === 'error').length} errors`} color="red" />
                      {showIssues ? <ChevronUp className="w-3 h-3 text-zinc-500" /> : <ChevronDown className="w-3 h-3 text-zinc-500" />}
                    </div>
                  </button>
                  {showIssues && (
                    <div className="px-4 pb-3 space-y-1.5">
                      {pageData.issues.slice(0, 15).map((issue, i) => (
                        <div key={i} className="flex items-start gap-2 text-[11px]">
                          <span className={`font-medium uppercase w-12 flex-shrink-0 ${sevColor(issue.severity)}`}>
                            {issue.severity}
                          </span>
                          <span className="text-zinc-400">{issue.message}</span>
                        </div>
                      ))}
                      {pageData.issues.length > 15 && (
                        <p className="text-[10px] text-zinc-600">+ {pageData.issues.length - 15} more issues</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Page headings */}
              {pageData.headings.length > 0 && (
                <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 space-y-2">
                  <h3 className="text-xs font-semibold text-zinc-300">Heading Structure</h3>
                  <div className="space-y-1">
                    {pageData.headings.map((h, i) => (
                      <div key={i} className="text-[11px] text-zinc-400 pl-2 border-l-2 border-zinc-700">
                        {h}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Page body text */}
              <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 space-y-2">
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

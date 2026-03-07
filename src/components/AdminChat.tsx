import { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, X, Send, Loader2, MessageSquare, Bot } from 'lucide-react';

interface ChatMessage { role: 'user' | 'assistant'; content: string; }

const ADMIN_QUICK_QUESTIONS = [
  'Give me a full status report on this site',
  'What are the highest-ROI actions I should take this week?',
  'Which pages need the most attention and why?',
  'Compare this period to last — what changed?',
  'What should I tell the client about their progress?',
];

function RenderMarkdown({ text }: { text: string }) {
  const html = text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="bg-zinc-800 px-1 py-0.5 rounded text-teal-300 text-[11px]">$1</code>')
    .replace(/^### (.*$)/gm, '<h4 class="text-xs font-semibold text-zinc-200 mt-3 mb-1">$1</h4>')
    .replace(/^## (.*$)/gm, '<h3 class="text-sm font-semibold text-zinc-200 mt-3 mb-1">$1</h3>')
    .replace(/^- (.*$)/gm, '<li class="ml-3 text-xs text-zinc-300 leading-relaxed">• $1</li>')
    .replace(/^\d+\. (.*$)/gm, '<li class="ml-3 text-xs text-zinc-300 leading-relaxed">$1</li>')
    .replace(/\n{2,}/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');
  return <div className="prose-sm text-xs text-zinc-300 leading-relaxed [&_strong]:text-zinc-100 [&_em]:text-zinc-400" dangerouslySetInnerHTML={{ __html: html }} />;
}

interface AdminChatProps {
  workspaceId: string;
  workspaceName: string;
  ga4PropertyId?: string;
  gscPropertyUrl?: string;
}

export function AdminChat({ workspaceId, workspaceName, ga4PropertyId, gscPropertyUrl }: AdminChatProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [context, setContext] = useState<Record<string, unknown> | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (endRef.current) endRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Reset state when workspace changes
  useEffect(() => {
    setMessages([]);
    setContext(null);
    setInput('');
  }, [workspaceId]);

  // Fetch context when chat opens
  const fetchContext = useCallback(async () => {
    if (context || contextLoading) return;
    setContextLoading(true);
    try {
      const days = 28;
      const qs = `?days=${days}`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const f = async (key: string, url: string): Promise<{ key: string; data: any }> => {
        try { return { key, data: await fetch(url).then(r => r.json()) }; } catch { return { key, data: null }; }
      };

      const fetches = [];

      // GA4 data
      if (ga4PropertyId) {
        fetches.push(f('ga4Overview', `/api/public/analytics-overview/${workspaceId}${qs}`));
        fetches.push(f('comparison', `/api/public/analytics-comparison/${workspaceId}${qs}`));
        fetches.push(f('ga4Pages', `/api/public/analytics-top-pages/${workspaceId}${qs}`));
        fetches.push(f('ga4Sources', `/api/public/analytics-sources/${workspaceId}${qs}`));
        fetches.push(f('organic', `/api/public/analytics-organic/${workspaceId}${qs}`));
        fetches.push(f('newVsReturning', `/api/public/analytics-new-vs-returning/${workspaceId}${qs}`));
        fetches.push(f('conversions', `/api/public/analytics-conversions/${workspaceId}${qs}`));
        fetches.push(f('landingPages', `/api/public/analytics-landing-pages/${workspaceId}${qs}`));
      }

      // GSC data
      if (gscPropertyUrl) {
        fetches.push(f('search', `/api/public/search-overview/${workspaceId}${qs}`));
      }

      // Site audit
      fetches.push(f('siteHealth', `/api/public/audit/${workspaceId}`));

      const results = await Promise.all(fetches);
      const ctx: Record<string, unknown> = { days };

      for (const { key, data: val } of results) {
        if (val && typeof val === 'object' && !val.error) {
          if (key === 'ga4Overview') {
            ctx.ga4 = { overview: val };
          } else if (key === 'ga4Pages' && Array.isArray(val)) {
            if (ctx.ga4 && typeof ctx.ga4 === 'object') (ctx.ga4 as Record<string, unknown>).topPages = val.slice(0, 10);
          } else if (key === 'ga4Sources' && Array.isArray(val)) {
            if (ctx.ga4 && typeof ctx.ga4 === 'object') (ctx.ga4 as Record<string, unknown>).sources = val.slice(0, 8);
          } else if (key === 'search') {
            ctx.search = {
              dateRange: val.dateRange, totalClicks: val.totalClicks,
              totalImpressions: val.totalImpressions, avgCtr: val.avgCtr,
              avgPosition: val.avgPosition,
              topQueries: Array.isArray(val.topQueries) ? val.topQueries.slice(0, 15) : [],
              topPages: Array.isArray(val.topPages) ? val.topPages.slice(0, 10) : [],
            };
          } else if (key === 'siteHealth') {
            if (val.siteScore !== undefined) {
              ctx.siteHealth = { score: val.siteScore, totalPages: val.totalPages, errors: val.errors, warnings: val.warnings };
            }
          } else {
            ctx[key] = Array.isArray(val) ? val.slice(0, 10) : val;
          }
        }
      }

      setContext(ctx);
    } catch {
      // Proceed with empty context
      setContext({ days: 28 });
    } finally {
      setContextLoading(false);
    }
  }, [workspaceId, ga4PropertyId, gscPropertyUrl, context, contextLoading]);

  const handleOpen = () => {
    setOpen(true);
    fetchContext();
  };

  const askAi = async (question: string) => {
    if (!question.trim()) return;
    setMessages(prev => [...prev, { role: 'user', content: question.trim() }]);
    setInput('');
    setLoading(true);
    try {
      const res = await fetch('/api/admin-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, question: question.trim(), context: context || { days: 28 } }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.error ? `Error: ${data.error}` : data.answer }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {!open && (
        <button onClick={handleOpen}
          className="fixed bottom-6 right-6 flex items-center gap-2 px-4 py-3 rounded-full bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white text-sm font-medium shadow-lg shadow-purple-900/30 transition-all z-50">
          <Bot className="w-4 h-4" /> Admin Insights
        </button>
      )}
      {open && (
        <div className="fixed bottom-6 right-6 w-[420px] bg-zinc-900 rounded-2xl border border-zinc-800 shadow-2xl shadow-black/40 overflow-hidden z-50 flex flex-col max-h-[550px]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 flex-shrink-0 bg-gradient-to-r from-purple-500/5 to-purple-400/5">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-medium text-zinc-200">Admin Insights</span>
              <span className="text-[11px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">{workspaceName}</span>
            </div>
            <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-300"><X className="w-4 h-4" /></button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {contextLoading && (
              <div className="flex items-center justify-center py-8 gap-2 text-xs text-zinc-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading workspace data...
              </div>
            )}
            {!contextLoading && messages.length === 0 && (
              <div className="p-4 space-y-3">
                <p className="text-xs text-zinc-500">Internal analyst for <strong className="text-zinc-400">{workspaceName}</strong>. Full data access.</p>
                <div className="grid grid-cols-1 gap-2">
                  {ADMIN_QUICK_QUESTIONS.map((q, i) => (
                    <button key={i} onClick={() => askAi(q)} className="text-left px-3 py-2.5 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-zinc-300 transition-colors">
                      <MessageSquare className="w-3 h-3 text-purple-400 mb-1" />{q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.length > 0 && (
              <div className="p-4 space-y-4">
                {messages.map((msg, i) => (
                  <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                    {msg.role === 'assistant' && <div className="w-6 h-6 rounded-lg bg-purple-500/10 flex items-center justify-center flex-shrink-0 mt-0.5"><Sparkles className="w-3 h-3 text-purple-400" /></div>}
                    <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 ${msg.role === 'user' ? 'bg-purple-600/20 border border-purple-500/20 text-xs text-zinc-200' : 'bg-zinc-800/50 border border-zinc-800'}`}>
                      {msg.role === 'assistant' ? <RenderMarkdown text={msg.content} /> : msg.content}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex gap-3"><div className="w-6 h-6 rounded-lg bg-purple-500/10 flex items-center justify-center"><Loader2 className="w-3 h-3 text-purple-400 animate-spin" /></div>
                    <div className="bg-zinc-800/50 border border-zinc-800 rounded-xl px-3.5 py-2.5"><div className="flex gap-1"><div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" /><div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '150ms' }} /><div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '300ms' }} /></div></div>
                  </div>
                )}
                <div ref={endRef} />
              </div>
            )}
          </div>

          <div className="px-4 py-3 border-t border-zinc-800 flex gap-2 flex-shrink-0">
            <input type="text" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && askAi(input)}
              placeholder="Ask about this workspace..." className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-purple-500" disabled={loading || contextLoading} />
            <button onClick={() => askAi(input)} disabled={loading || contextLoading || !input.trim()} className="px-3 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg transition-colors"><Send className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}
    </>
  );
}

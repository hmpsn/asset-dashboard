import { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, X, Send, Loader2, MessageSquare, Bot, Plus } from 'lucide-react';
import { RenderMarkdown } from './client/helpers';
import { getSafe, getOptional } from '../api/client';
import { chat, anomalies as anomaliesApi } from '../api/misc';
import { ga4, gsc } from '../api/analytics';
import { audit } from '../api/seo';

interface ChatMessage { role: 'user' | 'assistant'; content: string; }

const ADMIN_QUICK_QUESTIONS = [
  'Give me a full status report on this site',
  'What are the highest-ROI actions I should take this week?',
  'Which pages need the most attention and why?',
  'Compare this period to last — what changed?',
  'What should I tell the client about their progress?',
];

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
  const [sessionId, setSessionId] = useState<string>(() => `as-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [sessions, setSessions] = useState<Array<{ id: string; title: string; messageCount: number; updatedAt: string }>>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (endRef.current) endRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Reset state when workspace changes
  useEffect(() => {
    setMessages([]);
    setContext(null);
    setInput('');
    setSessionId(`as-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    setShowHistory(false);
  }, [workspaceId]);

  // Fetch context when chat opens
  const fetchContext = useCallback(async () => {
    if (context || contextLoading) return;
    setContextLoading(true);
    try {
      const days = 28;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wrap = async (key: string, promise: Promise<any>): Promise<{ key: string; data: any }> => {
        try { return { key, data: await promise }; } catch { return { key, data: null }; }
      };

      const fetches = [];

      // GA4 data
      if (ga4PropertyId) {
        fetches.push(wrap('ga4Overview', ga4.overview(workspaceId, days)));
        fetches.push(wrap('comparison', ga4.comparison(workspaceId, days)));
        fetches.push(wrap('ga4Pages', ga4.topPages(workspaceId, days)));
        fetches.push(wrap('ga4Sources', ga4.sources(workspaceId, days)));
        fetches.push(wrap('organic', ga4.organic(workspaceId, days)));
        fetches.push(wrap('newVsReturning', ga4.newVsReturning(workspaceId, days)));
        fetches.push(wrap('conversions', ga4.conversions(workspaceId, days)));
        fetches.push(wrap('landingPages', ga4.landingPages(workspaceId, days)));
      }

      // GSC data
      if (gscPropertyUrl) {
        fetches.push(wrap('search', gsc.overview(workspaceId, days)));
      }

      // Site audit
      fetches.push(wrap('siteHealth', audit.publicAudit(workspaceId)));

      // Anomalies
      fetches.push(wrap('detectedAnomalies', anomaliesApi.list(workspaceId)));

      const results = await Promise.all(fetches);
      const ctx: Record<string, unknown> = { days };

      for (const { key, data: val } of results) {
        if (val && typeof val === 'object' && !(val as Record<string, unknown>).error) {
          if (key === 'ga4Overview') {
            ctx.ga4 = { overview: val };
          } else if (key === 'ga4Pages' && Array.isArray(val)) {
            if (ctx.ga4 && typeof ctx.ga4 === 'object') (ctx.ga4 as Record<string, unknown>).topPages = val.slice(0, 10);
          } else if (key === 'ga4Sources' && Array.isArray(val)) {
            if (ctx.ga4 && typeof ctx.ga4 === 'object') (ctx.ga4 as Record<string, unknown>).sources = val.slice(0, 8);
          } else if (key === 'search') {
            const sv = val as Record<string, unknown>;
            ctx.search = {
              dateRange: sv.dateRange, totalClicks: sv.totalClicks,
              totalImpressions: sv.totalImpressions, avgCtr: sv.avgCtr,
              avgPosition: sv.avgPosition,
              topQueries: Array.isArray(sv.topQueries) ? (sv.topQueries as unknown[]).slice(0, 15) : [],
              topPages: Array.isArray(sv.topPages) ? (sv.topPages as unknown[]).slice(0, 10) : [],
            };
          } else if (key === 'siteHealth') {
            const sv = val as Record<string, unknown>;
            if (sv.siteScore !== undefined) {
              ctx.siteHealth = { score: sv.siteScore, totalPages: sv.totalPages, errors: sv.errors, warnings: sv.warnings };
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
      const data = await chat.adminAsk({ workspaceId, question: question.trim(), context: context || { days: 28 }, sessionId });
      setMessages(prev => [...prev, { role: 'assistant', content: data.error ? `Error: ${data.error}` : (data.answer ?? '') }]);
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
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button onClick={() => { setSessionId(`as-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`); setMessages([]); setShowHistory(false); }}
                  title="New conversation" className="text-zinc-500 hover:text-zinc-300 p-1"><Plus className="w-3.5 h-3.5" /></button>
              )}
              <button onClick={() => { setShowHistory(!showHistory); if (!showHistory) { chat.sessions(workspaceId, 'admin').then(d => { if (Array.isArray(d)) setSessions(d as typeof sessions); }).catch(() => {}); } }}
                title="Chat history" className={`p-1 ${showHistory ? 'text-purple-400' : 'text-zinc-500 hover:text-zinc-300'}`}><MessageSquare className="w-3.5 h-3.5" /></button>
              <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-300 p-1"><X className="w-4 h-4" /></button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {showHistory ? (
              <div className="p-3 space-y-1">
                <p className="text-[11px] text-zinc-500 mb-2">Previous conversations</p>
                {sessions.length === 0 && <p className="text-[11px] text-zinc-600 italic">No past conversations yet.</p>}
                {sessions.map(s => (
                  <button key={s.id} onClick={() => {
                    setSessionId(s.id); setShowHistory(false);
                    chat.session(workspaceId, s.id).then(d => {
                      if (d?.messages) setMessages(d.messages.map((m: { role: string; content: string }) => ({ role: m.role as 'user' | 'assistant', content: m.content })));
                    }).catch(() => {});
                  }} className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${s.id === sessionId ? 'bg-purple-500/10 border-purple-500/30 text-purple-300' : 'bg-zinc-800/50 border-zinc-800 text-zinc-300 hover:bg-zinc-800'}`}>
                    <div className="text-[11px] font-medium truncate">{s.title}</div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">{s.messageCount} messages · {new Date(s.updatedAt).toLocaleDateString()}</div>
                  </button>
                ))}
              </div>
            ) : (<>
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
            </>)}
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

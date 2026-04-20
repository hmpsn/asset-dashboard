import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles, Send, MessageSquare, X, Lock, Loader2, Plus,
} from 'lucide-react';
import { getOptional, getSafe } from '../../api/client';
import { clientPath } from '../../routes';
import { STUDIO_NAME } from '../../constants';
import { RenderMarkdown } from './helpers';
import { ServiceInterestCTA } from './ServiceInterestCTA';
import { useChat, type ChatDeps } from '../../hooks/useChat';
import { type WorkspaceInfo, QUICK_QUESTIONS, LEARN_SEO_QUESTIONS } from './types';

export interface ClientChatWidgetApi {
  openChat: () => void;
  askAi: (q: string) => Promise<void>;
  proactiveInsight: string | null;
  proactiveInsightLoading: boolean;
}

export interface ClientChatWidgetProps {
  chatDeps: ChatDeps;
  betaMode: boolean;
  workspaceId: string;
  ws: WorkspaceInfo | null;
  /** Called whenever the API surface (openChat, askAi, proactiveInsight) changes. */
  onApiChange?: (api: ClientChatWidgetApi) => void;
  /** Called when the expanded state changes — used by FeedbackWidget. */
  onExpandedChange?: (expanded: boolean) => void;
}

export function ClientChatWidget({
  chatDeps,
  betaMode,
  workspaceId,
  ws,
  onApiChange,
  onExpandedChange,
}: ClientChatWidgetProps) {
  const clientNavigate = useNavigate();

  const {
    chatOpen, setChatOpen,
    chatExpanded, setChatExpanded,
    chatMessages, setChatMessages,
    chatInput, setChatInput,
    chatLoading,
    chatEndRef,
    chatSessionId, setChatSessionId,
    chatSessions, setChatSessions,
    showChatHistory, setShowChatHistory,
    chatUsage,
    roiValue,
    lastIntent, clearIntent,
    proactiveInsight, proactiveInsightLoading,
    askAi,
  } = useChat(chatDeps);

  // Bubble up the API surface whenever key values change
  const onApiChangeRef = useRef(onApiChange);
  onApiChangeRef.current = onApiChange;

  useEffect(() => {
    onApiChangeRef.current?.({
      openChat: () => setChatOpen(true),
      askAi,
      proactiveInsight,
      proactiveInsightLoading,
    });
  }, [askAi, proactiveInsight, proactiveInsightLoading, setChatOpen]);

  // Bubble up expanded state for FeedbackWidget
  const onExpandedChangeRef = useRef(onExpandedChange);
  onExpandedChangeRef.current = onExpandedChange;

  useEffect(() => {
    onExpandedChangeRef.current?.(chatExpanded);
  }, [chatExpanded]);

  const { overview, audit, ga4Overview } = chatDeps;
  if (!overview && !audit && !ga4Overview) return null;

  return (
    <>
      {!chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          className="fixed bottom-6 right-6 flex items-center gap-2 px-4 py-3 rounded-full bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-sm font-medium shadow-lg shadow-teal-900/30 transition-all z-50"
        >
          <Sparkles className="w-4 h-4" /> Insights Engine
        </button>
      )}
      {chatOpen && (
        <div className={`fixed bg-zinc-900 border-zinc-800 shadow-2xl shadow-black/40 overflow-hidden z-50 flex flex-col transition-all duration-200 ${chatExpanded ? 'inset-y-0 right-0 w-full sm:w-[480px] border-l rounded-none' : 'bottom-6 right-6 w-96 max-h-[500px] rounded-2xl border'}`}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-teal-400" />
              <span className="text-sm font-medium text-zinc-200">Insights Engine</span>
              {!betaMode && chatUsage && chatUsage.tier === 'free' ? (
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${chatUsage.remaining > 0 ? 'text-zinc-400 bg-zinc-800' : 'text-amber-400/80 bg-amber-500/8 border border-amber-500/20'}`}>
                  {chatUsage.remaining}/{chatUsage.limit} left
                </span>
              ) : (
                <span className="text-[11px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">by {STUDIO_NAME}</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {chatMessages.length > 0 && (
                <button
                  onClick={() => {
                    setChatSessionId(`cs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
                    setChatMessages([]);
                    clearIntent();
                    setShowChatHistory(false);
                  }}
                  title="New conversation"
                  className="text-zinc-500 hover:text-zinc-300 p-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => {
                  setShowChatHistory(!showChatHistory);
                  if (!showChatHistory && ws) {
                    getSafe<Array<{ id: string; title: string; messageCount: number; updatedAt: string }>>(
                      `/api/public/chat-sessions/${ws.id}?channel=client`,
                      [],
                    ).then(d => {
                      if (Array.isArray(d)) setChatSessions(d);
                    }).catch((err) => { console.error('ClientChatWidget operation failed:', err); });
                  }
                }}
                title="Chat history"
                className={`p-1 ${showChatHistory ? 'text-teal-400' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setChatExpanded(!chatExpanded)}
                title={chatExpanded ? 'Minimize' : 'Maximize'}
                className="text-zinc-500 hover:text-zinc-300 p-1"
              >
                {chatExpanded ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                )}
              </button>
              <button
                onClick={() => { setChatOpen(false); setChatExpanded(false); }}
                className="text-zinc-500 hover:text-zinc-300 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {showChatHistory ? (
              <div className="p-3 space-y-1">
                <p className="text-[11px] text-zinc-500 mb-2">Previous conversations</p>
                {chatSessions.length === 0 && (
                  <p className="text-[11px] text-zinc-600 italic">No past conversations yet.</p>
                )}
                {chatSessions.map(s => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setChatSessionId(s.id);
                      setShowChatHistory(false);
                      if (ws) {
                        getOptional<{ messages?: Array<{ role: string; content: string }> }>(
                          `/api/public/chat-sessions/${ws.id}/${s.id}`,
                        ).then(d => {
                          if (d?.messages) {
                            setChatMessages(d.messages.map((m: { role: string; content: string }) => ({
                              role: m.role as 'user' | 'assistant',
                              content: m.content,
                            })));
                          }
                        }).catch((err) => { console.error('ClientChatWidget operation failed:', err); });
                      }
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${s.id === chatSessionId ? 'bg-teal-500/10 border-teal-500/30 text-teal-300' : 'bg-zinc-800/50 border-zinc-800 text-zinc-300 hover:bg-zinc-800'}`}
                  >
                    <div className="text-[11px] font-medium truncate">{s.title}</div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">
                      {s.messageCount} messages · {new Date(s.updatedAt).toLocaleDateString()}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <>
                {chatMessages.length === 0 && (
                  <div className="p-4 space-y-3">
                    <p className="text-xs text-zinc-500">Ask anything about your site performance:</p>
                    <div className="grid grid-cols-1 gap-2">
                      {QUICK_QUESTIONS.map((q, i) => (
                        <button
                          key={i}
                          onClick={() => askAi(q)}
                          className="text-left px-3.5 py-3 min-h-[44px] rounded-lg bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-zinc-300 transition-colors"
                        >
                          <MessageSquare className="w-3 h-3 text-teal-400 mb-1" />{q}
                        </button>
                      ))}
                    </div>
                    <div className="pt-3 border-t border-zinc-800/50">
                      <p className="text-[10px] text-zinc-600 uppercase tracking-wider font-medium mb-2">New to SEO? Ask the AI</p>
                      {LEARN_SEO_QUESTIONS.slice(0, 3).map((q, i) => (
                        <button
                          key={`learn-${i}`}
                          onClick={() => askAi(q)}
                          className="w-full text-left px-3.5 py-2.5 min-h-[44px] rounded-lg hover:bg-emerald-500/5 border border-transparent hover:border-emerald-500/15 transition-colors text-[11px] text-emerald-400/70 hover:text-emerald-400"
                        >
                          💡 {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {chatMessages.length > 0 && (
                  <div className="p-4 space-y-4">
                    {chatMessages.map((msg, i) => (
                      <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                        {msg.role === 'assistant' && (
                          <div className="w-6 h-6 rounded-lg bg-teal-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <Sparkles className="w-3 h-3 text-teal-400" />
                          </div>
                        )}
                        <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 ${msg.role === 'user' ? 'bg-teal-600/20 border border-teal-500/20 text-xs text-zinc-200' : 'bg-zinc-800/50 border border-zinc-800'}`}>
                          {msg.role === 'assistant' ? <RenderMarkdown text={msg.content} /> : msg.content}
                        </div>
                      </div>
                    ))}
                    {chatLoading && (
                      <div className="flex gap-3">
                        <div className="w-6 h-6 rounded-lg bg-teal-500/10 flex items-center justify-center">
                          <Loader2 className="w-3 h-3 text-teal-400 animate-spin" />
                        </div>
                        <div className="bg-zinc-800/50 border border-zinc-800 rounded-xl px-3.5 py-2.5">
                          <div className="flex gap-1">
                            <div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" />
                            <div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                            <div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                          </div>
                        </div>
                      </div>
                    )}
                    {/* CTA — shown after last assistant message when intent is detected */}
                    {!chatLoading && lastIntent && chatMessages.length > 0 && chatMessages[chatMessages.length - 1].role === 'assistant' && (
                      <ServiceInterestCTA
                        type={lastIntent}
                        workspaceId={workspaceId}
                        bookingUrl={ws?.bookingUrl}
                        onAction={(type) => {
                          clearIntent();
                          if (type === 'content_interest') clientNavigate(clientPath(workspaceId, 'strategy', chatDeps.betaMode));
                        }}
                      />
                    )}
                    {/* Show quick questions as follow-ups after proactive greeting */}
                    {chatMessages.length === 1 && chatMessages[0].role === 'assistant' && !chatLoading && (
                      <div className="space-y-1.5 pt-1">
                        <p className="text-[10px] text-zinc-600 uppercase tracking-wider font-medium">Ask a follow-up</p>
                        {QUICK_QUESTIONS.slice(0, 3).map((q, i) => (
                          <button
                            key={i}
                            onClick={() => askAi(q)}
                            className="w-full text-left px-3.5 py-2.5 min-h-[44px] rounded-lg bg-zinc-800/30 hover:bg-zinc-800/60 border border-zinc-800/50 text-[11px] text-zinc-400 hover:text-zinc-300 transition-colors"
                          >
                            {q}
                          </button>
                        ))}
                        <p className="text-[10px] text-zinc-600 uppercase tracking-wider font-medium mt-3">New to SEO?</p>
                        {LEARN_SEO_QUESTIONS.slice(0, 2).map((q, i) => (
                          <button
                            key={`learn-${i}`}
                            onClick={() => askAi(q)}
                            className="w-full text-left px-3.5 py-2.5 min-h-[44px] rounded-lg hover:bg-emerald-500/5 border border-transparent hover:border-emerald-500/15 transition-colors text-[11px] text-emerald-400/70 hover:text-emerald-400"
                          >
                            💡 {q}
                          </button>
                        ))}
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer: free-tier lock OR input */}
          {!betaMode && chatUsage && chatUsage.tier === 'free' && !chatUsage.allowed ? (
            <div className="px-4 py-3 border-t border-zinc-800 flex-shrink-0">
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <Lock className="w-3.5 h-3.5 text-amber-400/80 flex-shrink-0" />
                <p className="text-[11px] text-amber-300/80 flex-1">
                  {roiValue && roiValue > 0
                    ? <>Your organic traffic is worth <span className="font-semibold text-emerald-400">${Math.round(roiValue).toLocaleString()}/mo</span> — unlock unlimited insights with Growth.</>
                    : <>You've used all {chatUsage.limit} free conversations this month. Upgrade to Growth for unlimited access.</>}
                </p>
              </div>
            </div>
          ) : (
            <div className="px-4 py-3 border-t border-zinc-800 flex gap-2 flex-shrink-0">
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && askAi(chatInput)}
                placeholder="Ask about your site data..."
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500"
                disabled={chatLoading}
              />
              <button
                onClick={() => askAi(chatInput)}
                disabled={chatLoading || !chatInput.trim()}
                className="px-3 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-lg transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

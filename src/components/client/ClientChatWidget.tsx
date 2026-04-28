import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles, Send, MessageSquare, X, Lock, Loader2, Plus,
} from 'lucide-react';
import { Icon, cn, Button } from '../ui';
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
}

export interface ClientChatWidgetProps {
  chatDeps: ChatDeps;
  betaMode: boolean;
  workspaceId: string;
  ws: WorkspaceInfo | null;
  /** Called whenever the API surface (openChat, askAi) changes. */
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
    askAi,
  } = useChat(chatDeps);

  // Bubble up the API surface whenever key values change
  const onApiChangeRef = useRef(onApiChange);
  onApiChangeRef.current = onApiChange;

  useEffect(() => {
    onApiChangeRef.current?.({
      openChat: () => setChatOpen(true),
      askAi,
    });
  }, [askAi, setChatOpen]);

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
        <Button
          onClick={() => setChatOpen(true)}
          icon={Sparkles}
          size="lg"
          className="fixed bottom-6 right-6 rounded-full shadow-lg shadow-teal-900/30 z-50"
        >
          Insights Engine
        </Button>
      )}
      {chatOpen && (
        <div className={cn('fixed bg-[var(--surface-2)] border-[var(--brand-border)] shadow-2xl shadow-black/40 overflow-hidden z-50 flex flex-col transition-all duration-200', chatExpanded ? 'inset-y-0 right-0 w-full sm:w-[480px] border-l rounded-none' : 'bottom-6 right-6 w-96 max-h-[500px] rounded-[var(--radius-xl)] border')}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--brand-border)] flex-shrink-0">
            <div className="flex items-center gap-2">
              <Icon as={Sparkles} size="md" className="text-teal-400" />
              <span className="t-body font-medium text-[var(--brand-text-bright)]">Insights Engine</span>
              {!betaMode && chatUsage && chatUsage.tier === 'free' ? (
                <span className={cn('t-caption-sm px-1.5 py-0.5 rounded font-medium', chatUsage.remaining > 0 ? 'text-[var(--brand-text)] bg-[var(--surface-3)]' : 'text-amber-400/80 bg-amber-500/8 border border-amber-500/20')}>
                  {chatUsage.remaining}/{chatUsage.limit} left
                </span>
              ) : (
                <span className="t-caption-sm text-[var(--brand-text-muted)] bg-[var(--surface-3)] px-1.5 py-0.5 rounded">by {STUDIO_NAME}</span>
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
                  className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] p-1"
                >
                  <Icon as={Plus} size="md" />
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
                className={cn('p-1', showChatHistory ? 'text-teal-400' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]')}
              >
                <Icon as={MessageSquare} size="md" />
              </button>
              <button
                onClick={() => setChatExpanded(!chatExpanded)}
                title={chatExpanded ? 'Minimize' : 'Maximize'}
                className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] p-1"
              >
                {chatExpanded ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                )}
              </button>
              <button
                onClick={() => { setChatOpen(false); setChatExpanded(false); }}
                className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] p-1"
              >
                <Icon as={X} size="md" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {showChatHistory ? (
              <div className="p-3 space-y-1">
                <p className="t-caption-sm text-[var(--brand-text-muted)] mb-2">Previous conversations</p>
                {chatSessions.length === 0 && (
                  <p className="t-caption-sm text-[var(--brand-text-muted)] italic">No past conversations yet.</p>
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
                    className={cn('w-full text-left px-3 py-2 rounded-[var(--radius-lg)] border transition-colors', s.id === chatSessionId ? 'bg-teal-500/10 border-teal-500/30 text-teal-300' : 'bg-[var(--surface-3)]/50 border-[var(--brand-border)] text-[var(--brand-text)] hover:bg-[var(--surface-3)]')}
                  >
                    <div className="t-caption-sm font-medium truncate">{s.title}</div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
                      {s.messageCount} messages · {new Date(s.updatedAt).toLocaleDateString()}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <>
                {chatMessages.length === 0 && (
                  <div className="p-4 space-y-3">
                    <p className="t-caption-sm text-[var(--brand-text-muted)]">Ask anything about your site performance:</p>
                    <div className="grid grid-cols-1 gap-2">
                      {QUICK_QUESTIONS.map((q, i) => (
                        <button
                          key={i}
                          onClick={() => askAi(q)}
                          className="text-left px-3.5 py-3 min-h-[44px] rounded-[var(--radius-lg)] bg-[var(--surface-3)]/50 hover:bg-[var(--surface-3)] border border-[var(--brand-border)] t-caption-sm text-[var(--brand-text)] transition-colors"
                        >
                          <Icon as={MessageSquare} size="sm" className="text-teal-400 mb-1" />{q}
                        </button>
                      ))}
                    </div>
                    <div className="pt-3 border-t border-[var(--brand-border)]/50">
                      <p className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)] mb-2">New to SEO? Ask the AI</p>
                      {LEARN_SEO_QUESTIONS.slice(0, 3).map((q, i) => (
                        <button
                          key={`learn-${i}`}
                          onClick={() => askAi(q)}
                          className="w-full text-left px-3.5 py-2.5 min-h-[44px] rounded-[var(--radius-lg)] hover:bg-emerald-500/5 border border-transparent hover:border-emerald-500/15 transition-colors t-caption-sm text-emerald-400/70 hover:text-emerald-400"
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
                      <div key={i} className={cn('flex gap-3', msg.role === 'user' ? 'justify-end' : '')}>
                        {msg.role === 'assistant' && (
                          <div className="w-6 h-6 rounded-[var(--radius-lg)] bg-teal-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <Icon as={Sparkles} size="sm" className="text-teal-400" />
                          </div>
                        )}
                        <div className={cn('max-w-[85%] rounded-[var(--radius-xl)] px-3.5 py-2.5', msg.role === 'user' ? 'bg-teal-600/20 border border-teal-500/20 t-caption text-[var(--brand-text-bright)]' : 'bg-[var(--surface-3)]/50 border border-[var(--brand-border)]')}>
                          {msg.role === 'assistant' ? <RenderMarkdown text={msg.content} /> : msg.content}
                        </div>
                      </div>
                    ))}
                    {chatLoading && (
                      <div className="flex gap-3">
                        <div className="w-6 h-6 rounded-[var(--radius-lg)] bg-teal-500/10 flex items-center justify-center">
                          <Icon as={Loader2} size="sm" className="text-teal-400 animate-spin" />
                        </div>
                        <div className="bg-[var(--surface-3)]/50 border border-[var(--brand-border)] rounded-[var(--radius-xl)] px-3.5 py-2.5">
                          <div className="flex gap-1">
                            <div className="w-1.5 h-1.5 rounded-full bg-[var(--brand-text-muted)] animate-bounce" />
                            <div className="w-1.5 h-1.5 rounded-full bg-[var(--brand-text-muted)] animate-bounce" style={{ animationDelay: '150ms' }} />
                            <div className="w-1.5 h-1.5 rounded-full bg-[var(--brand-text-muted)] animate-bounce" style={{ animationDelay: '300ms' }} />
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
                          if (type === 'content_interest') clientNavigate(clientPath(workspaceId, 'strategy', betaMode));
                        }}
                      />
                    )}
                    {/* Show quick questions as follow-ups after proactive greeting */}
                    {chatMessages.length === 1 && chatMessages[0].role === 'assistant' && !chatLoading && (
                      <div className="space-y-1.5 pt-1">
                        <p className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)]">Ask a follow-up</p>
                        {QUICK_QUESTIONS.slice(0, 3).map((q, i) => (
                          <button
                            key={i}
                            onClick={() => askAi(q)}
                            className="w-full text-left px-3.5 py-2.5 min-h-[44px] rounded-[var(--radius-lg)] bg-[var(--surface-3)]/30 hover:bg-[var(--surface-3)]/60 border border-[var(--brand-border)]/50 t-caption-sm text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] transition-colors"
                          >
                            {q}
                          </button>
                        ))}
                        <p className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)] mt-3">New to SEO?</p>
                        {LEARN_SEO_QUESTIONS.slice(0, 2).map((q, i) => (
                          <button
                            key={`learn-${i}`}
                            onClick={() => askAi(q)}
                            className="w-full text-left px-3.5 py-2.5 min-h-[44px] rounded-[var(--radius-lg)] hover:bg-emerald-500/5 border border-transparent hover:border-emerald-500/15 transition-colors t-caption-sm text-emerald-400/70 hover:text-emerald-400"
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
            <div className="px-4 py-3 border-t border-[var(--brand-border)] flex-shrink-0">
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-[var(--radius-lg)] bg-amber-500/5 border border-amber-500/20">
                <Icon as={Lock} size="sm" className="text-amber-400/80 flex-shrink-0" />
                <p className="t-caption-sm text-amber-300/80 flex-1">
                  {roiValue && roiValue > 0
                    ? <>Your organic traffic is worth <span className="font-semibold text-emerald-400">${Math.round(roiValue).toLocaleString()}/mo</span> — unlock unlimited insights with Growth.</>
                    : <>You've used all {chatUsage.limit} free conversations this month. Upgrade to Growth for unlimited access.</>}
                </p>
              </div>
            </div>
          ) : (
            <div className="px-4 py-3 border-t border-[var(--brand-border)] flex gap-2 flex-shrink-0">
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && askAi(chatInput)}
                placeholder="Ask about your site data..."
                className="flex-1 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] px-3 py-2 t-caption text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500"
                disabled={chatLoading}
              />
              <button
                onClick={() => askAi(chatInput)}
                disabled={chatLoading || !chatInput.trim()}
                className="px-3 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-[var(--radius-lg)] transition-colors"
              >
                <Icon as={Send} size="sm" />
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

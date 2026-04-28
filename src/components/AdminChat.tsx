import { useState, useEffect, useRef, useCallback } from 'react';
import { X, MessageSquare, Bot, Plus, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { ChatPanel } from './ChatPanel';
import type { ChatMessage } from './ChatPanel';
import { chat } from '../api/misc';
import { useSmartPlaceholder } from '../hooks/useSmartPlaceholder';
import { Icon, cn } from './ui';

const ADMIN_QUICK_QUESTIONS = [
  'Give me a full status report on this site',
  'What are the highest-ROI actions I should take this week?',
  'Which pages need the most attention and why?',
  'Compare this period to last — what changed?',
  'What should I tell the client about their progress?',
  'Are there any pages losing traffic that need refreshing?',
  'What content is in the pipeline right now?',
];

// ── Size constraints ──
const MIN_W = 360;
const MAX_W = 720;
const MIN_H = 380;
const MAX_H = 800;
const DEFAULT_W = 420;
const DEFAULT_H = 550;

interface AdminChatProps {
  workspaceId: string;
  workspaceName: string;
}

export function AdminChat({ workspaceId, workspaceName }: AdminChatProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [chatMode, setChatMode] = useState<string>('analyst');
  const [sessionId, setSessionId] = useState<string>(() => `as-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [sessions, setSessions] = useState<Array<{ id: string; title: string; messageCount: number; updatedAt: string }>>([]);
  const [showHistory, setShowHistory] = useState(false);

  // ── Layout state ──
  const [docked, setDocked] = useState(false);
  const [width, setWidth] = useState(DEFAULT_W);
  const [height, setHeight] = useState(DEFAULT_H);

  // ── Resize state ──
  const resizing = useRef<{ edge: 'left' | 'top' | 'corner'; startX: number; startY: number; startW: number; startH: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Reset state when workspace changes
  useEffect(() => {
    setMessages([]);
    setInput('');
    setChatMode('analyst');
    setSessionId(`as-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    setShowHistory(false);
  }, [workspaceId]);

  // ── Resize handlers ──
  const onPointerDown = useCallback((edge: 'left' | 'top' | 'corner') => (e: React.PointerEvent) => {
    e.preventDefault();
    resizing.current = { edge, startX: e.clientX, startY: e.clientY, startW: width, startH: height };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [width, height]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!resizing.current) return;
    const { edge, startX, startY, startW, startH } = resizing.current;
    // Panel grows leftward / upward, so delta is inverted
    const dx = startX - e.clientX;
    const dy = startY - e.clientY;
    if (edge === 'left' || edge === 'corner') {
      setWidth(Math.min(MAX_W, Math.max(MIN_W, startW + dx)));
    }
    if ((edge === 'top' || edge === 'corner') && !docked) {
      setHeight(Math.min(MAX_H, Math.max(MIN_H, startH + dy)));
    }
  }, [docked]);

  const onPointerUp = useCallback(() => { resizing.current = null; }, []);

  // ── Chat logic ──
  const askAi = async (question: string) => {
    if (!question.trim()) return;
    setMessages(prev => [...prev, { role: 'user', content: question.trim() }]);
    setInput('');
    setLoading(true);
    try {
      const data = await chat.adminAsk({ workspaceId, question: question.trim(), sessionId });
      if (data.mode) setChatMode(data.mode);
      setMessages(prev => [...prev, { role: 'assistant', content: data.error ? `Error: ${data.error}` : (data.answer ?? '') }]);
    } catch (err) {
      console.error('AdminChat operation failed:', err);
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong.' }]);
    } finally {
      setLoading(false);
    }
  };

  const newSession = () => {
    setSessionId(`as-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    setMessages([]);
    setChatMode('analyst');
    setShowHistory(false);
  };

  const toggleHistory = () => {
    setShowHistory(v => {
      if (!v) chat.sessions(workspaceId, 'admin').then(d => { if (Array.isArray(d)) setSessions(d as typeof sessions); }).catch((err) => { console.error('AdminChat operation failed:', err); });
      return !v;
    });
  };

  const loadSession = (id: string) => {
    setSessionId(id);
    setShowHistory(false);
    chat.session(workspaceId, id).then(d => {
      if (d?.messages) setMessages(d.messages.map((m: { role: string; content: string }) => ({ role: m.role as 'user' | 'assistant', content: m.content })));
    }).catch((err) => { console.error('AdminChat operation failed:', err); });
  };

  const { placeholder: smartPlaceholder, suggestions } = useSmartPlaceholder({
    workspaceId,
    isAdminContext: true,
  });

  const placeholder = chatMode === 'content_reviewer'
    ? 'Paste content or ask a follow-up...'
    : chatMode === 'page_reviewer'
      ? 'Ask about this page...'
      : smartPlaceholder;

  // ── Container classes ──
  const containerCls = cn(
    'shadow-2xl shadow-black/40 z-[var(--z-modal)] flex flex-col',
    docked
      ? 'fixed top-0 right-0 h-screen border-l border-[var(--brand-border)] bg-[var(--surface-2)]'
      : 'fixed bottom-6 right-6 bg-[var(--surface-2)] rounded-[var(--radius-xl)] border border-[var(--brand-border)] overflow-hidden'
  );

  return (
    <>
      {/* ── Floating trigger button ── */}
      {!open && (
        <button onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 flex items-center gap-2 px-4 py-3 rounded-full bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white t-body font-medium shadow-lg shadow-purple-900/30 transition-all z-[var(--z-modal)]">
          <Icon as={Bot} size="md" /> Admin Insights
        </button>
      )}

      {/* ── Chat panel ── */}
      {open && (
        <div
          ref={panelRef}
          className={containerCls}
          style={{ width, ...(!docked ? { maxHeight: height } : {}) }}
        >
          {/* ── Resize handles ── */}
          {/* Left edge */}
          <div
            className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-purple-500/20 transition-colors z-[var(--z-sticky)]"
            onPointerDown={onPointerDown('left')}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
          {/* Top edge (floating only) */}
          {!docked && (
            <div
              className="absolute top-0 left-0 right-0 h-1.5 cursor-row-resize hover:bg-purple-500/20 transition-colors z-[var(--z-sticky)]"
              onPointerDown={onPointerDown('top')}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
          )}
          {/* Top-left corner (floating only) */}
          {!docked && (
            <div
              className="absolute top-0 left-0 w-3 h-3 cursor-nwse-resize hover:bg-purple-500/30 rounded-tl-2xl transition-colors z-[var(--z-dropdown)]"
              onPointerDown={onPointerDown('corner')}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
          )}

          {/* ── Header ── */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--brand-border)] flex-shrink-0 bg-gradient-to-r from-purple-500/5 to-purple-400/5">
            <div className="flex items-center gap-2 min-w-0">
              <Icon as={Bot} size="md" className="text-purple-400 flex-shrink-0" />
              <span className="t-body font-medium text-[var(--brand-text-bright)] truncate">Admin Insights</span>
              <span className="t-caption text-[var(--brand-text-muted)] bg-[var(--surface-3)] px-1.5 py-0.5 rounded truncate max-w-[120px]">{workspaceName}</span>
            </div>
            <div className="flex items-center gap-0.5 flex-shrink-0">
              {messages.length > 0 && (
                <button onClick={newSession} title="New conversation" className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] p-1">
                  <Icon as={Plus} size="md" />
                </button>
              )}
              <button onClick={toggleHistory} title="Chat history"
                className={cn('p-1', showHistory ? 'text-purple-400' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]')}>
                <Icon as={MessageSquare} size="md" />
              </button>
              <button onClick={() => setDocked(d => !d)} title={docked ? 'Float panel' : 'Dock to side'}
                className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] p-1">
                {docked ? <Icon as={PanelRightClose} size="md" /> : <Icon as={PanelRightOpen} size="md" />}
              </button>
              <button onClick={() => setOpen(false)} className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] p-1">
                <Icon as={X} size="md" />
              </button>
            </div>
          </div>

          {/* ── Body ── */}
          {showHistory ? (
            <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-1">
              <p className="t-caption text-[var(--brand-text-muted)] mb-2">Previous conversations</p>
              {sessions.length === 0 && <p className="t-caption text-[var(--brand-text-muted)] italic">No past conversations yet.</p>}
              {sessions.map(s => (
                <button key={s.id} onClick={() => loadSession(s.id)}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded-[var(--radius-lg)] border transition-colors',
                    s.id === sessionId
                      ? 'bg-purple-500/10 border-purple-500/30 text-purple-300'
                      : 'bg-[var(--surface-3)]/50 border-[var(--brand-border)] text-[var(--brand-text-bright)] hover:bg-[var(--surface-3)]'
                  )}>
                  <div className="t-caption font-medium truncate">{s.title}</div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">{s.messageCount} messages · {new Date(s.updatedAt).toLocaleDateString()}</div>
                </button>
              ))}
            </div>
          ) : (
            <ChatPanel
              messages={messages}
              loading={loading}
              input={input}
              onInputChange={setInput}
              onSend={askAi}
              quickQuestions={ADMIN_QUICK_QUESTIONS}
              placeholder={placeholder}
              accent="purple"
              suggestionChips={chatMode === 'analyst' ? suggestions : undefined}
              onChipClick={(chip) => {
                setInput(chip);
                askAi(chip);
              }}
              emptyExtra={
                <p className="t-caption-sm text-[var(--brand-text-muted)] mt-2">
                  Internal analyst for <strong className="text-[var(--brand-text)]">{workspaceName}</strong>. Full data access — paste a URL to analyze a page, or paste content for a review.
                </p>
              }
            />
          )}
        </div>
      )}
    </>
  );
}

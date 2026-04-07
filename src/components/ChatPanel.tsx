import { useEffect, useRef } from 'react';
import { Sparkles, Send, Loader2, MessageSquare } from 'lucide-react';
import { RenderMarkdown } from './client/helpers';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  loading: boolean;
  input: string;
  onInputChange: (val: string) => void;
  onSend: (msg: string) => void;
  quickQuestions?: string[];
  placeholder?: string;
  accent?: 'teal' | 'purple';
  disabled?: boolean;
  /** Extra content rendered above the input (e.g. usage limits) */
  inputPrefix?: React.ReactNode;
  /** Extra content rendered in the empty state below quick questions */
  emptyExtra?: React.ReactNode;
  /** Suggestion chips shown above the input. Admin context only — never render in client-facing views. */
  suggestionChips?: string[];
  /** Called when user clicks a suggestion chip — prefills and submits */
  onChipClick?: (chip: string) => void;
}

const ACCENT = {
  teal: {
    icon: 'bg-teal-500/10',
    iconText: 'text-teal-400',
    userBubble: 'bg-teal-600/20 border border-teal-500/20',
    btn: 'bg-teal-600 hover:bg-teal-500',
    focusBorder: 'focus:border-teal-500',
  },
  purple: {
    icon: 'bg-purple-500/10',
    iconText: 'text-purple-400',
    userBubble: 'bg-purple-600/20 border border-purple-500/20',
    btn: 'bg-purple-600 hover:bg-purple-500',
    focusBorder: 'focus:border-purple-500',
  },
};

export function ChatPanel({
  messages,
  loading,
  input,
  onInputChange,
  onSend,
  quickQuestions,
  placeholder = 'Ask a question...',
  accent = 'teal',
  disabled = false,
  inputPrefix,
  emptyExtra,
  suggestionChips,
  onChipClick,
}: ChatPanelProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const a = ACCENT[accent];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) onSend(input);
  };

  return (
    <>
      {/* Scrollable area: quick questions + messages */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Quick questions (empty state) */}
        {messages.length === 0 && quickQuestions && quickQuestions.length > 0 && (
          <div className="p-4 space-y-3">
            <p className="text-xs text-zinc-500">Ask anything about your data:</p>
            <div className="grid grid-cols-1 gap-2">
              {quickQuestions.map((q, i) => (
                <button
                  key={i}
                  onClick={() => onSend(q)}
                  className="text-left px-3 py-2.5 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-zinc-300 transition-colors"
                >
                  <MessageSquare className={`w-3 h-3 ${a.iconText} mb-1`} />
                  {q}
                </button>
              ))}
            </div>
            {emptyExtra}
          </div>
        )}

        {/* Messages */}
        {messages.length > 0 && (
          <div className="p-4 space-y-4">
            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                {msg.role === 'assistant' && (
                  <div className={`w-6 h-6 rounded-lg ${a.icon} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                    <Sparkles className={`w-3 h-3 ${a.iconText}`} />
                  </div>
                )}
                <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 ${
                  msg.role === 'user'
                    ? `${a.userBubble} text-xs text-zinc-200`
                    : 'bg-zinc-800/50 border border-zinc-800'
                }`}>
                  {msg.role === 'assistant' ? <RenderMarkdown text={msg.content} /> : msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex gap-3">
                <div className={`w-6 h-6 rounded-lg ${a.icon} flex items-center justify-center`}>
                  <Loader2 className={`w-3 h-3 ${a.iconText} animate-spin`} />
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
            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* Input prefix (e.g. usage limit banner) */}
      {inputPrefix}

      {/* Suggestion chips — admin context only, never in client view */}
      {suggestionChips && suggestionChips.length > 0 && (
        <div className="px-3 pb-2 flex flex-wrap gap-1.5">
          {suggestionChips.map((chip, i) => (
            <button
              key={i}
              onClick={() => onChipClick?.(chip)}
              className="text-[10px] px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20 hover:bg-purple-500/20 transition-colors"
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {/* Input bar — pinned at bottom */}
      <div className="px-4 py-3 border-t border-zinc-800 flex gap-2 flex-shrink-0">
        <input
          type="text"
          value={input}
          onChange={e => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={`flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none ${a.focusBorder}`}
          disabled={disabled || loading}
        />
        <button
          onClick={() => onSend(input)}
          disabled={disabled || loading || !input.trim()}
          className={`px-3 py-2 ${a.btn} disabled:opacity-50 rounded-lg transition-colors`}
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </>
  );
}

import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, History, ChevronDown, ChevronUp } from 'lucide-react';

export interface SteeringChatProps {
  content: string;
  onRefine: (direction: string) => Promise<string>;
  versions: { content: string; steeringNotes?: string }[];
  onSelectVersion: (index: number) => void;
}

interface Exchange {
  direction: string;
  result: string;
}

export function SteeringChat({ content, onRefine, versions, onSelectVersion }: SteeringChatProps) {
  const [direction, setDirection] = useState('');
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState('');
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const exchangesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest exchange
  useEffect(() => {
    if (exchanges.length > 0) {
      exchangesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [exchanges]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = direction.trim();
    if (!trimmed || refining) return;

    setError('');
    setRefining(true);

    try {
      const result = await onRefine(trimmed);
      setExchanges(prev => [...prev, { direction: trimmed, result }]);
      setDirection('');
      inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refinement failed. Please try again.');
    } finally {
      setRefining(false);
    }
  };

  const recentExchanges = exchanges.slice(-3);
  const activeVersionIndex = versions.length - 1;

  return (
    <div className="flex flex-col gap-4">
      {/* Current content display */}
      <div>
        <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">
          Current Content
        </p>
        <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
          {content || <span className="text-zinc-600 italic">No content yet.</span>}
        </div>
      </div>

      {/* Recent exchanges */}
      {recentExchanges.length > 0 && (
        <div>
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">
            Recent Refinements
          </p>
          <div className="flex flex-col gap-2">
            {recentExchanges.map((ex, i) => (
              <div key={i} className="rounded-lg border border-zinc-800 overflow-hidden text-sm">
                <div className="bg-zinc-800/50 px-3 py-2 text-zinc-400 flex items-start gap-2">
                  <Send size={12} className="mt-0.5 shrink-0 text-teal-500" />
                  <span className="italic">{ex.direction}</span>
                </div>
                <div className="bg-zinc-900/40 px-3 py-2 text-zinc-300 leading-relaxed whitespace-pre-wrap max-h-28 overflow-y-auto">
                  {ex.result}
                </div>
              </div>
            ))}
            <div ref={exchangesEndRef} />
          </div>
        </div>
      )}

      {/* Steering input */}
      <div>
        <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">
          Steer the Content
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <div className="flex gap-2">
            <label htmlFor="steering-direction" className="sr-only">
              Refinement direction
            </label>
            <input
              ref={inputRef}
              id="steering-direction"
              type="text"
              value={direction}
              onChange={e => setDirection(e.target.value)}
              disabled={refining}
              placeholder='e.g. "Make it more conversational"'
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <button
              type="submit"
              disabled={refining || !direction.trim()}
              className="bg-gradient-to-r from-teal-600 to-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shrink-0"
            >
              {refining ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Refining…</span>
                </>
              ) : (
                <>
                  <Send size={14} />
                  <span>Refine</span>
                </>
              )}
            </button>
          </div>
          {error && (
            <p className="text-xs text-red-400 mt-1">{error}</p>
          )}
        </form>
      </div>

      {/* Version history */}
      {versions.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setHistoryOpen(prev => !prev)}
            className="flex items-center gap-2 text-xs font-medium text-zinc-400 uppercase tracking-wide hover:text-zinc-200 transition-colors w-full text-left"
            aria-expanded={historyOpen}
            aria-controls="version-history-list"
          >
            <History size={13} />
            <span>Version History ({versions.length})</span>
            {historyOpen ? <ChevronUp size={13} className="ml-auto" /> : <ChevronDown size={13} className="ml-auto" />}
          </button>

          {historyOpen && (
            <ul
              id="version-history-list"
              role="listbox"
              aria-label="Version history"
              className="mt-2 flex flex-col gap-1"
            >
              {versions.map((v, idx) => {
                const isActive = idx === activeVersionIndex;
                return (
                  <li key={idx} role="option" aria-selected={isActive}>
                    <button
                      type="button"
                      onClick={() => onSelectVersion(idx)}
                      title={v.steeringNotes ?? undefined}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-start gap-3 ${
                        isActive
                          ? 'bg-teal-600/20 border border-teal-600/40 text-teal-300'
                          : 'bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100'
                      }`}
                    >
                      <span className={`shrink-0 text-xs font-mono font-semibold mt-0.5 ${isActive ? 'text-teal-400' : 'text-zinc-500'}`}>
                        v{idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate leading-snug">
                          {v.content.slice(0, 80)}{v.content.length > 80 ? '…' : ''}
                        </p>
                        {v.steeringNotes && (
                          <p className="text-xs text-zinc-500 mt-0.5 truncate">{v.steeringNotes}</p>
                        )}
                      </div>
                      {isActive && (
                        <span className="shrink-0 text-xs text-teal-400 font-medium self-center">active</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

import { useState, useRef, useEffect } from 'react';
import { Send, History, ChevronDown, ChevronUp } from 'lucide-react';
import { Icon, Button, cn, FormInput } from '../ui';

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
  const [selectedVersionIndex, setSelectedVersionIndex] = useState<number>(() => versions.length - 1);

  const inputRef = useRef<HTMLInputElement>(null);
  const exchangesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest exchange
  useEffect(() => {
    if (exchanges.length > 0) {
      exchangesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [exchanges]);

  // Reset to latest version when a new version is added
  useEffect(() => {
    setSelectedVersionIndex(versions.length - 1);
  }, [versions.length]);

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

  return (
    <div className="flex flex-col gap-4">
      {/* Current content display */}
      <div>
        <p className="t-caption font-medium text-[var(--brand-text)] uppercase tracking-wide mb-2">
          Current Content
        </p>
        <div className="bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-md)] p-4 text-sm text-[var(--brand-text)] leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
          {content || <span className="text-[var(--brand-text-muted)] italic">No content yet.</span>}
        </div>
      </div>

      {/* Recent exchanges */}
      {recentExchanges.length > 0 && (
        <div>
          <p className="t-caption font-medium text-[var(--brand-text)] uppercase tracking-wide mb-2">
            Recent Refinements
          </p>
          <div className="flex flex-col gap-2">
            {recentExchanges.map((ex, i) => (
              <div key={i} className="rounded-[var(--radius-md)] border border-[var(--brand-border)] overflow-hidden text-sm">
                <div className="bg-[var(--surface-3)]/50 px-3 py-2 text-[var(--brand-text)] flex items-start gap-2">
                  <Icon as={Send} size="sm" className="mt-0.5 shrink-0 text-teal-500" />
                  <span className="italic">{ex.direction}</span>
                </div>
                <div className="bg-[var(--surface-2)]/40 px-3 py-2 text-[var(--brand-text)] leading-relaxed whitespace-pre-wrap max-h-28 overflow-y-auto">
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
        <p className="t-caption font-medium text-[var(--brand-text)] uppercase tracking-wide mb-2">
          Steer the Content
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <div className="flex gap-2">
            <label htmlFor="steering-direction" className="sr-only">
              Refinement direction
            </label>
            <FormInput
              ref={inputRef}
              id="steering-direction"
              type="text"
              value={direction}
              onChange={setDirection}
              disabled={refining}
              placeholder='e.g. "Make it more conversational"'
              className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-teal-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <Button
              type="submit"
              variant="primary"
              size="md"
              icon={refining ? undefined : Send}
              loading={refining}
              disabled={refining || !direction.trim()}
            >
              {refining ? 'Refining…' : 'Refine'}
            </Button>
          </div>
          {error && (
            <p className="t-caption text-red-400 mt-1">{error}</p>
          )}
        </form>
      </div>

      {/* Version history */}
      {versions.length > 0 && (
        <div>
          <Button
            type="button"
            onClick={() => setHistoryOpen(prev => !prev)}
            variant="ghost"
            size="sm"
            className="flex items-center gap-2 t-caption font-medium text-[var(--brand-text)] uppercase tracking-wide hover:text-[var(--brand-text-bright)] transition-colors w-full text-left px-0 py-0 h-auto justify-start"
            aria-expanded={historyOpen}
            aria-controls="version-history-list"
          >
            <Icon as={History} size="sm" />
            <span>Version History ({versions.length})</span>
            {historyOpen ? <Icon as={ChevronUp} size="sm" className="ml-auto" /> : <Icon as={ChevronDown} size="sm" className="ml-auto" />}
          </Button>

          {historyOpen && (
            <ul
              id="version-history-list"
              role="listbox"
              aria-label="Version history"
              className="mt-2 flex flex-col gap-1"
            >
              {versions.map((v, idx) => {
                const isActive = idx === selectedVersionIndex;
                return (
                  <li key={idx} role="option" aria-selected={isActive}>
                    <Button
                      type="button"
                      onClick={() => { onSelectVersion(idx); setSelectedVersionIndex(idx); }}
                      title={v.steeringNotes}
                      variant="ghost"
                      size="sm"
                      className={cn(
                        'w-full text-left px-3 py-2 rounded-[var(--radius-md)] text-sm transition-colors flex items-start gap-3',
                        isActive
                          ? 'bg-teal-600/20 border border-teal-600/40 text-teal-300'
                          : 'bg-[var(--surface-3)] border border-[var(--brand-border)] text-[var(--brand-text)] hover:bg-[var(--brand-border-hover)] hover:text-[var(--brand-text-bright)]'
                      )}
                    >
                      <span className={cn('shrink-0 t-mono text-xs font-semibold mt-0.5', isActive ? 'text-teal-400' : 'text-[var(--brand-text-muted)]')}>
                        v{idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate leading-snug">
                          {v.content.slice(0, 80)}{v.content.length > 80 ? '…' : ''}
                        </p>
                        {v.steeringNotes && (
                          <p className="t-caption text-[var(--brand-text-muted)] mt-0.5 truncate">{v.steeringNotes}</p>
                        )}
                      </div>
                      {isActive && (
                        <span className="shrink-0 t-caption text-teal-400 font-medium self-center">active</span>
                      )}
                    </Button>
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

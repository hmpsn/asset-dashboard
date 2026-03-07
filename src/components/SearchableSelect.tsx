import { useState, useRef, useEffect } from 'react';
import { Search, X, ChevronDown } from 'lucide-react';

interface Option {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  className?: string;
  size?: 'sm' | 'md';
}

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Search...',
  emptyLabel = 'All',
  className = '',
  size = 'sm',
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = search
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const selectedLabel = value
    ? options.find(o => o.value === value)?.label || value
    : emptyLabel;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const isSm = size === 'sm';

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 w-full bg-zinc-800/60 border border-zinc-700/50 rounded-lg text-left text-zinc-300 hover:border-zinc-600 transition-colors focus:outline-none focus:border-teal-500 ${
          isSm ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs'
        }`}
      >
        <span className="flex-1 truncate">{selectedLabel}</span>
        <ChevronDown className={`shrink-0 text-zinc-500 ${isSm ? 'w-3 h-3' : 'w-3.5 h-3.5'}`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[200px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl overflow-hidden">
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-zinc-800">
            <Search className="w-3 h-3 text-zinc-500 shrink-0" />
            <input
              ref={inputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={placeholder}
              className="flex-1 bg-transparent text-[11px] text-zinc-200 placeholder:text-zinc-500 focus:outline-none"
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-zinc-500 hover:text-zinc-300">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="max-h-[200px] overflow-y-auto">
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); setSearch(''); }}
              className={`w-full text-left px-2.5 py-1.5 text-[11px] hover:bg-zinc-800 transition-colors ${
                !value ? 'text-teal-400 bg-teal-500/5' : 'text-zinc-400'
              }`}
            >
              {emptyLabel}
            </button>
            {filtered.map(o => (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false); setSearch(''); }}
                className={`w-full text-left px-2.5 py-1.5 text-[11px] hover:bg-zinc-800 transition-colors truncate ${
                  o.value === value ? 'text-teal-400 bg-teal-500/5' : 'text-zinc-300'
                }`}
              >
                {o.label}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-2.5 py-3 text-[11px] text-zinc-500 text-center">No matches</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

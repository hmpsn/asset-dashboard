import { useState, useRef, useEffect } from 'react';
import { Button, ClickableRow, FormInput, Icon, IconButton } from './ui';
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
      <Button
        onClick={() => setOpen(!open)}
        icon={ChevronDown}
        iconPosition="right"
        variant="secondary"
        size="sm"
        className={`flex items-center gap-1.5 w-full bg-[var(--surface-3)] border border-[var(--brand-border-hover)] rounded-[var(--radius-lg)] text-left text-[var(--brand-text)] hover:border-[var(--brand-border-hover)] transition-colors focus:outline-none focus:border-teal-500 ${
          isSm ? 'px-2 py-1 t-caption-sm' : 'px-2.5 py-1.5 t-caption'
        }`}
      >
        <span className="flex-1 truncate">{selectedLabel}</span>
      </Button>

      {open && (
        <div className="absolute z-[var(--z-modal)] mt-1 w-full min-w-[200px] bg-[var(--surface-2)] border border-[var(--brand-border-hover)] rounded-[var(--radius-lg)] shadow-xl overflow-hidden">
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[var(--brand-border)]">
            <Icon as={Search} size="sm" className="text-[var(--brand-text-muted)] shrink-0" />
            <FormInput
              ref={inputRef}
              value={search}
              onChange={setSearch}
              placeholder={placeholder}
              className="flex-1 bg-transparent t-caption-sm text-[var(--brand-text-bright)] placeholder:text-[var(--brand-text-muted)] focus:outline-none"
            />
            {search && (
              <IconButton onClick={() => setSearch('')} icon={X} label="Clear search" variant="ghost" size="sm" className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]" />
            )}
          </div>
          <div className="max-h-[200px] overflow-y-auto">
            <ClickableRow
              onClick={() => { onChange(''); setOpen(false); setSearch(''); }}
              className={`w-full text-left px-2.5 py-1.5 t-caption-sm hover:bg-[var(--surface-3)] transition-colors ${
                !value ? 'text-teal-400 bg-teal-500/5' : 'text-[var(--brand-text-muted)]'
              }`}
            >
              {emptyLabel}
            </ClickableRow>
            {filtered.map(o => (
              <ClickableRow
                key={o.value}
                onClick={() => { onChange(o.value); setOpen(false); setSearch(''); }}
                className={`w-full text-left px-2.5 py-1.5 t-caption-sm hover:bg-[var(--surface-3)] transition-colors truncate ${
                  o.value === value ? 'text-teal-400 bg-teal-500/5' : 'text-[var(--brand-text)]'
                }`}
              >
                {o.label}
              </ClickableRow>
            ))}
            {filtered.length === 0 && (
              <div className="px-2.5 py-3 t-caption-sm text-[var(--brand-text-muted)] text-center">No matches</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

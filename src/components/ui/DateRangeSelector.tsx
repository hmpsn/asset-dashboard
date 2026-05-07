interface DateRangeSelectorProps {
  options: { label: string; value: number }[];
  selected: number;
  onChange: (value: number) => void;
  className?: string;
}

export function DateRangeSelector({ options, selected, onChange, className }: DateRangeSelectorProps) {
  return (
    <div className={`flex items-center gap-1 bg-[var(--surface-2)] rounded-[var(--radius-lg)] border border-[var(--brand-border)] p-0.5 ${className ?? ''}`}>
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 rounded-md t-caption font-medium transition-colors ${
            selected === opt.value
              ? 'bg-[var(--surface-3)] text-[var(--brand-text-bright)]'
              : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

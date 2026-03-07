interface DateRangeSelectorProps {
  options: { label: string; value: number }[];
  selected: number;
  onChange: (value: number) => void;
  className?: string;
}

export function DateRangeSelector({ options, selected, onChange, className }: DateRangeSelectorProps) {
  return (
    <div className={`flex items-center gap-1 bg-zinc-900 rounded-lg border border-zinc-800 p-0.5 ${className ?? ''}`}>
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            selected === opt.value
              ? 'bg-zinc-700 text-zinc-200'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}


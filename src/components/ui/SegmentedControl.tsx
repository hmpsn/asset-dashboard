import React from 'react';
import { cn } from '../../lib/utils';

export type SegmentedControlSize = 'sm' | 'md';

export interface SegmentedControlOption {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  options: SegmentedControlOption[];
  value: string;
  onChange: (id: string) => void;
  size?: SegmentedControlSize;
  className?: string;
  /** Optional a11y group label. */
  label?: string;
}

const SIZE: Record<SegmentedControlSize, string> = {
  sm: 'px-2 py-1 text-[11px]',
  md: 'px-3 py-1.5 text-xs',
};

export const SegmentedControl = React.forwardRef<HTMLDivElement, SegmentedControlProps>(
  function SegmentedControl({ options, value, onChange, size = 'md', className, label }, ref) {
    const onKey = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const len = options.length;
      let next = idx;
      for (let i = 0; i < len; i++) {
        next = (next + dir + len) % len;
        if (!options[next].disabled) break;
      }
      onChange(options[next].id);
    };

    return (
      <div
        ref={ref}
        role="radiogroup"
        aria-label={label}
        className={cn(
          'inline-flex bg-zinc-900 border border-zinc-800 rounded-md p-0.5',
          className,
        )}
      >
        {options.map((opt, idx) => {
          const active = opt.id === value;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={opt.disabled}
              onClick={() => onChange(opt.id)}
              onKeyDown={(e) => onKey(e, idx)}
              className={cn(
                'rounded-sm transition-colors font-medium',
                SIZE[size],
                active ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200',
                opt.disabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  },
);

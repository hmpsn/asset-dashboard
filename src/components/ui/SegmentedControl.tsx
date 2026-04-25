import React, { useRef } from 'react';
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
    const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

    const activeIdx = options.findIndex((o) => o.id === value);
    const hasActive = activeIdx !== -1;

    const focusFirstEnabled = (start: number, dir: 1 | -1) => {
      const len = options.length;
      let probe = start;
      for (let i = 0; i < len; i++) {
        if (!options[probe].disabled) {
          onChange(options[probe].id);
          buttonRefs.current[probe]?.focus();
          return;
        }
        probe = (probe + dir + len) % len;
      }
    };

    const onKey = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
      const len = options.length;
      if (len === 0) return;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        let next = idx;
        let found = false;
        for (let i = 0; i < len; i++) {
          next = (next + dir + len) % len;
          if (!options[next].disabled) {
            found = true;
            break;
          }
        }
        if (!found) return;
        onChange(options[next].id);
        buttonRefs.current[next]?.focus();
        return;
      }

      if (e.key === 'Home') {
        e.preventDefault();
        focusFirstEnabled(0, 1);
        return;
      }

      if (e.key === 'End') {
        e.preventDefault();
        focusFirstEnabled(len - 1, -1);
        return;
      }
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
          // WAI-ARIA radiogroup must always have one tab stop. If no option matches
          // the current value, fall back to the first non-disabled option so the
          // widget remains keyboard-reachable.
          const fallbackTabStop = !hasActive && idx === options.findIndex((o) => !o.disabled);
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active || fallbackTabStop ? 0 : -1}
              disabled={opt.disabled}
              ref={(el) => {
                buttonRefs.current[idx] = el;
              }}
              onClick={() => onChange(opt.id)}
              onKeyDown={(e) => onKey(e, idx)}
              className={cn(
                'rounded-sm transition-colors font-medium',
                SIZE[size],
                active ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200',
                opt.disabled && 'opacity-50 cursor-not-allowed pointer-events-none',
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

SegmentedControl.displayName = 'SegmentedControl';

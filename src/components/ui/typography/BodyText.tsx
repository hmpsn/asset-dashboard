import React from 'react';
import { cn } from '../../../lib/utils';

export type BodyTextTone = 'default' | 'muted' | 'dim';

export interface BodyTextProps
  extends React.HTMLAttributes<HTMLParagraphElement> {
  tone?: BodyTextTone;
}

// Tone controls color via Tailwind arbitrary-value utilities so callers can
// still override with className (e.g. className="text-red-400"). Earlier
// revision used inline style={} which defeated className overrides.
const TONE_CLASS: Record<BodyTextTone, string> = {
  default: 'text-[var(--brand-text)]',
  muted: 'text-[var(--brand-text-muted)]',
  dim: 'text-[var(--brand-text-dim)]',
};

export const BodyText = React.forwardRef<HTMLParagraphElement, BodyTextProps>(
  ({ tone = 'default', className, children, ...rest }, ref) => {
    return (
      <p
        ref={ref}
        className={cn('t-body', TONE_CLASS[tone], className)}
        {...rest}
      >
        {children}
      </p>
    );
  }
);

BodyText.displayName = 'BodyText';

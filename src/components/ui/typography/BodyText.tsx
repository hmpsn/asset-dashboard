import React from 'react';

export type BodyTextTone = 'default' | 'muted' | 'dim';

export interface BodyTextProps {
  tone?: BodyTextTone;
  className?: string;
  children?: React.ReactNode;
}

const TONE_STYLE: Record<BodyTextTone, React.CSSProperties> = {
  default: { color: 'var(--brand-text)' },
  muted: { color: 'var(--brand-text-muted)' },
  dim: { color: 'var(--brand-text-dim)' },
};

export const BodyText = React.forwardRef<HTMLParagraphElement, BodyTextProps>(
  ({ tone = 'default', className, children }, ref) => {
    const combinedClass = ['t-body', className].filter(Boolean).join(' ');
    return (
      <p ref={ref} className={combinedClass} style={TONE_STYLE[tone]}>
        {children}
      </p>
    );
  }
);

BodyText.displayName = 'BodyText';

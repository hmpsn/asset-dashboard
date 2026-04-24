import React from 'react';
import { cn } from '../../../lib/utils';

export type HeadingLevel = 1 | 2 | 3;
export type HeadingTag = 'h1' | 'h2' | 'h3' | 'div';

export interface HeadingProps
  extends React.HTMLAttributes<HTMLElement> {
  level: HeadingLevel;
  as?: HeadingTag;
}

const LEVEL_CLASS: Record<HeadingLevel, string> = {
  1: 't-h1',
  2: 't-h2',
  3: 't-page',
};

const LEVEL_DEFAULT_TAG: Record<HeadingLevel, HeadingTag> = {
  1: 'h1',
  2: 'h2',
  3: 'h3',
};

export const Heading = React.forwardRef<HTMLElement, HeadingProps>(
  ({ level, as, className, children, ...rest }, ref) => {
    const tag = as ?? LEVEL_DEFAULT_TAG[level];
    const Tag = tag as React.ElementType;
    // When caller opts out of semantic heading (as="div"), preserve heading
    // semantics for assistive tech with role + aria-level.
    const ariaProps = tag === 'div'
      ? { role: 'heading' as const, 'aria-level': level }
      : undefined;
    return (
      <Tag
        ref={ref}
        className={cn(LEVEL_CLASS[level], className)}
        {...ariaProps}
        {...rest}
      >
        {children}
      </Tag>
    );
  }
);

Heading.displayName = 'Heading';

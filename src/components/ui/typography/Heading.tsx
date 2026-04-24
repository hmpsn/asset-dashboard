import React from 'react';

export type HeadingLevel = 1 | 2 | 3;
export type HeadingTag = 'h1' | 'h2' | 'h3' | 'div';

export interface HeadingProps {
  level: HeadingLevel;
  as?: HeadingTag;
  className?: string;
  children?: React.ReactNode;
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
  ({ level, as, className, children }, ref) => {
    const tag = as ?? LEVEL_DEFAULT_TAG[level];
    const typeClass = LEVEL_CLASS[level];
    const combinedClass = [typeClass, className].filter(Boolean).join(' ');
    return React.createElement(tag, { ref, className: combinedClass }, children);
  }
);

Heading.displayName = 'Heading';

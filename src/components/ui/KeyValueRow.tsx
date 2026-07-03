// @ds-rebuilt
import type { CSSProperties, ReactElement, ReactNode } from 'react';

/**
 * One label→value row: muted label, bright right-aligned value, optional
 * hairline divider on top. The app's `.kd-row` / `.sg-kv`. Rendered as a
 * semantic <div> pair; use <DefinitionList> for a full <dl>.
 */
export interface KeyValueRowProps {
  label: ReactNode;
  value: ReactNode;
  valueColor?: string;
  divider?: boolean;
  /** Render the value in the mono font family (var(--font-mono)). */
  mono?: boolean;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

export function KeyValueRow(_props: KeyValueRowProps): ReactElement {
  throw new Error('F3 stub — KeyValueRow not yet implemented (Lane B)');
}

export interface DefinitionItem {
  label: ReactNode;
  value: ReactNode;
  valueColor?: string;
  mono?: boolean;
}

/** Hairline-divided semantic <dl> of label→value rows. */
export interface DefinitionListProps {
  items: DefinitionItem[];
  className?: string;
  id?: string;
  style?: CSSProperties;
}

export function DefinitionList(_props: DefinitionListProps): ReactElement {
  throw new Error('F3 stub — DefinitionList not yet implemented (Lane B)');
}

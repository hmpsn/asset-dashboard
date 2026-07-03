// @ds-rebuilt
import type { CSSProperties, ReactElement } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * Small entity marker — a colored initials/image avatar, or (tone="zinc" +
 * icon) the calm surface-3 section icon-tile. Content precedence: src → icon →
 * initials. Default 6px-rounded; `shape="circle"` for round.
 */
export interface AvatarProps {
  initials?: string;
  /** Lucide icon (D5) shown when no `src` is provided. */
  icon?: LucideIcon;
  src?: string;
  /**
   * Identity tone, or 'zinc' for the calm icon-tile surface. Kit 'mint' → 'teal'
   * (D6 — teal is the canonical action word); kit 'purple' dropped (Four Laws).
   */
  tone?: 'teal' | 'blue' | 'amber' | 'emerald' | 'zinc';
  /** Explicit background (overrides tone). */
  color?: string;
  iconColor?: string;
  size?: 'sm' | 'md' | 'lg' | number;
  shape?: 'rounded' | 'circle';
  label?: string;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

export function Avatar(_props: AvatarProps): ReactElement {
  throw new Error('F3 stub — Avatar not yet implemented (Lane A)');
}

// @ds-rebuilt
import type { CSSProperties, ReactElement, ReactNode } from 'react';

/**
 * Right-anchored (or left) slide-over panel + scrim. The canonical detail
 * drawer — one width-parameterized replacement for the app's five bespoke
 * drawers. Sticky header (eyebrow/title/subtitle + optional action + close),
 * scrolling body, optional sticky footer. Portal + focus-trap + scroll-lock via
 * ui/overlay/overlayUtils.ts; reduced-motion honored.
 */
export interface DrawerProps {
  open?: boolean;
  onClose?: () => void;
  title?: string;
  subtitle?: string;
  eyebrow?: string;
  /** Panel width — number (px) or CSS string. Default 440. */
  width?: number | string;
  side?: 'right' | 'left';
  footer?: ReactNode;
  headerAction?: ReactNode;
  /** Close when the backdrop/scrim is clicked. Default true. */
  closeOnBackdrop?: boolean;
  children?: ReactNode;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

export function Drawer(_props: DrawerProps): ReactElement {
  throw new Error('F3 stub — Drawer not yet implemented (Lane A)');
}

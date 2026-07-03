// @ds-rebuilt
import type { CSSProperties, ReactElement } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * Pressable filter/toggle chip for toolbars. Active = teal tint + teal border
 * (the action color); inactive = calm surface. Optional leading icon and
 * trailing count. Set `onRemove` for the removable variant (accessible × with a
 * ≥44px hit target). For read-only status/category tags use `Badge`.
 */
export interface FilterChipProps {
  label: string;
  active?: boolean;
  count?: number;
  icon?: LucideIcon;
  onClick?: () => void;
  /** Render a remove (×) affordance; fires this on activate. */
  onRemove?: () => void;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

export function FilterChip(_props: FilterChipProps): ReactElement {
  throw new Error('F3 stub — FilterChip not yet implemented (Lane C)');
}

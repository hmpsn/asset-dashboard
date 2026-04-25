import type { CopySectionStatus } from '../../shared/types/copy-pipeline';

/** Badge color values matching the Badge component's color prop union. */
export type BadgeColor = 'teal' | 'blue' | 'emerald' | 'amber' | 'red' | 'orange' | 'zinc';

export interface CopyStatusBadgeConfig {
  label: string;
  color: BadgeColor;
}

/** Canonical copy status badge configuration — single source of truth. */
export const COPY_STATUS_BADGE: Record<CopySectionStatus | 'none', CopyStatusBadgeConfig> = {
  pending: { label: 'Pending', color: 'zinc' },
  draft: { label: 'Draft', color: 'blue' },
  client_review: { label: 'In Review', color: 'teal' },
  approved: { label: 'Approved', color: 'emerald' },
  revision_requested: { label: 'Revision', color: 'orange' },
  none: { label: 'No Copy', color: 'zinc' },
};

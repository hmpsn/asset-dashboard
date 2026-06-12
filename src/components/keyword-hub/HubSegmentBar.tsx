/**
 * HubSegmentBar — the seven primary segment pills for the Keyword Hub.
 *
 * Segments (in order): All · Striking Distance · In Strategy · Tracked · Needs Review · Retired · Local.
 * - Active pill uses teal styling (Four Laws: teal for actions/active state).
 * - Counts shown as <Badge>; shows <Skeleton> while loading; "—" when undefined.
 * - Local segment shows a MapPin icon when active.
 * - Striking Distance shows a TrendingUp icon when active (easy-wins indicator).
 * - No violet/indigo/rose/pink; no green-* success colors — emerald only.
 *
 * Owned by P1-T2. Must NOT touch KeywordHub.tsx or useKeywordHubState.ts.
 */
import { MapPin, TrendingUp } from 'lucide-react'; // trend-icon-ok — TrendingUp is a segment-pill nav icon for the Striking Distance filter, not a directional metric trend badge
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import type { HubSegment } from '../../hooks/admin/useKeywordHubState';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HubSegmentMeta {
  id: HubSegment;
  label: string;
  /** Undefined means the count is unknown (not zero). Render "—" not "0". */
  count: number | undefined;
  icon?: LucideIcon;
}

interface HubSegmentBarProps {
  segments: HubSegmentMeta[];
  active: HubSegment;
  onChange: (s: HubSegment) => void;
  /** When true, count badges are replaced with Skeleton placeholders. */
  isLoading?: boolean;
}

// ---------------------------------------------------------------------------
// Static segment definitions (canonical order per plan P1-T2 contract)
// ---------------------------------------------------------------------------

/** The seven primary Hub segments in display order. */
export const HUB_SEGMENT_METAS: HubSegmentMeta[] = [
  { id: 'all', label: 'All', count: undefined },
  { id: 'striking_distance', label: 'Striking Distance', count: undefined, icon: TrendingUp },
  { id: 'in_strategy', label: 'In Strategy', count: undefined },
  { id: 'tracked', label: 'Tracked', count: undefined },
  { id: 'needs_review', label: 'Needs Review', count: undefined },
  { id: 'retired', label: 'Retired', count: undefined },
  { id: 'local', label: 'Local', count: undefined, icon: MapPin },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HubSegmentBar({
  segments,
  active,
  onChange,
  isLoading = false,
}: HubSegmentBarProps) {
  return (
    <nav
      aria-label="Keyword segments"
      className="flex flex-wrap gap-1.5"
    >
      {segments.map((seg) => {
        const isActive = seg.id === active;
        const IconComponent = seg.icon;
        const showIcon = isActive && IconComponent != null;

        return (
          <Button
            key={seg.id}
            variant="ghost"
            size="sm"
            // Render the segment's icon (e.g. MapPin on Local) only when active.
            icon={showIcon ? IconComponent : undefined}
            onClick={() => onChange(seg.id)}
            aria-pressed={isActive}
            aria-label={`${seg.label} segment${typeof seg.count === 'number' ? `, ${seg.count} keywords` : ''}`}
            className={cn(
              'gap-1.5 rounded-[var(--radius-pill)] px-3 py-1.5',
              't-caption font-medium whitespace-nowrap',
              isActive
                ? 'bg-teal-600 text-white hover:bg-teal-600'
                : 'bg-[var(--surface-2)] text-[var(--brand-text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--brand-text)]',
            )}
          >
            <span>{seg.label}</span>
            {isLoading ? (
              <Skeleton className="w-6 h-3.5 rounded-[var(--radius-pill)]" />
            ) : seg.count !== undefined ? (
              <Badge
                label={String(seg.count)}
                tone={isActive ? 'teal' : 'zinc'}
                variant={isActive ? 'solid' : 'soft'}
                size="sm"
                shape="pill"
              />
            ) : (
              <span
                aria-hidden="true"
                className={cn(
                  't-caption-sm',
                  isActive ? 'text-white/70' : 'text-[var(--brand-text-muted)]',
                )}
              >
                —
              </span>
            )}
          </Button>
        );
      })}
    </nav>
  );
}

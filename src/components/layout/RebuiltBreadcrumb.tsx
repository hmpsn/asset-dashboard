// @ds-rebuilt
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { featureFlags } from '../../api/misc';
import { adminPath, type Page } from '../../routes';
import { resolveNavLabelById } from '../../lib/navRegistry';
import { queryKeys } from '../../lib/queryKeys';
import { FEATURE_FLAGS, type FeatureFlagKey } from '../../../shared/types/feature-flags';
import type { Workspace } from '../WorkspaceSelector';
import { Badge, Button, Icon } from '../ui';

// nav-registry-ok — fallback for redirect-only/legacy-folded Pages, mirrors Breadcrumbs.tsx:14
const LEGACY_TAB_LABELS: Record<string, string> = {
  brief: 'Meeting Brief',
  'seo-briefs': 'Content Briefs',
  content: 'Content',
  calendar: 'Calendar',
  subscriptions: 'Subscriptions',
  'content-pipeline': 'Content Pipeline',
  'workspace-settings': 'Workspace Settings',
};

const SUB_TAB_LABELS: Record<string, string> = {
  briefs: 'Briefs',
  posts: 'Posts',
  calendar: 'Calendar',
  publish: 'Publish',
  subscriptions: 'Subscriptions',
  tracked: 'Tracked',
  striking_distance: 'Striking Distance',
  context: 'Context',
  'business-footprint': 'Business Footprint',
  locations: 'Locations',
  reviews: 'Reviews',
  setup: 'Setup',
  guide: 'Guide',
};

interface BreadcrumbItem {
  label: string;
  current?: boolean;
  onClick?: () => void;
}

export interface RebuiltBreadcrumbProps {
  workspaces: Workspace[];
  selected: Workspace | null;
  tab: Page;
  pendingContentRequests: number;
}

function fallbackTabLabel(tab: Page, isFlagEnabled: (flag: FeatureFlagKey) => boolean): string {
  const resolved = resolveNavLabelById(tab, isFlagEnabled);
  if (resolved !== tab) return resolved;
  return LEGACY_TAB_LABELS[tab] || tab;
}

export function RebuiltBreadcrumb({
  workspaces,
  selected,
  tab,
  pendingContentRequests,
}: RebuiltBreadcrumbProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: flagValues } = useQuery({
    queryKey: queryKeys.shared.featureFlags(),
    queryFn: featureFlags.list,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const isFlagEnabled = (flag: FeatureFlagKey) => flagValues?.[flag] ?? FEATURE_FLAGS[flag];
  const workspaceLabel = selected ? (selected.webflowSiteName || selected.name) : null;
  const workspaceTitle = workspaces.length === 1 ? '1 workspace' : `${workspaces.length} workspaces`;
  const subTab = searchParams.get('tab');
  const subTabLabel = subTab ? SUB_TAB_LABELS[subTab] : undefined;

  const items = useMemo<BreadcrumbItem[]>(() => {
    const next: BreadcrumbItem[] = [
      { label: 'Command Center', onClick: () => navigate('/') },
    ];
    if (selected && workspaceLabel) {
      next.push({
        label: workspaceLabel,
        onClick: () => navigate(adminPath(selected.id)),
      });
    }
    if (tab !== 'home') {
      next.push({ label: fallbackTabLabel(tab, isFlagEnabled), current: !subTabLabel });
    }
    if (subTabLabel) {
      next.push({ label: subTabLabel, current: true });
    }
    if (next.length > 0) next[next.length - 1].current = true;
    return next;
  }, [isFlagEnabled, navigate, selected, subTabLabel, tab, workspaceLabel]);

  return (
    <nav
      aria-label="Breadcrumb"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        minWidth: 0,
        width: '100%',
        color: 'var(--brand-text-dim)',
        fontFamily: 'var(--font-sans)',
        fontSize: '12.5px',
      }}
    >
      {items.map((item, index) => (
        <div
          key={`${item.label}-${index}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minWidth: index === items.length - 1 ? 0 : undefined,
          }}
        >
          {index > 0 && (
            <Icon
              name="arrowRight"
              size="xs"
              data-testid="rebuilt-breadcrumb-separator"
              style={{ color: 'var(--brand-text-dim)', flexShrink: 0 }}
            />
          )}
          {item.onClick && !item.current ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={item.onClick}
              title={item.label === workspaceLabel ? workspaceTitle : undefined}
              style={{
                padding: 0,
                minHeight: 24,
                color: 'var(--brand-text-dim)',
                fontWeight: 500,
                background: 'transparent',
              }}
            >
              {item.label}
            </Button>
          ) : (
            <span
              title={item.label === workspaceLabel ? workspaceTitle : undefined}
              style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: item.current ? 'var(--brand-text-bright)' : 'var(--brand-text-dim)',
                fontWeight: item.current ? 600 : 500,
              }}
            >
              {item.label}
            </span>
          )}
        </div>
      ))}
      {selected && pendingContentRequests > 0 && (
        <Button
          variant="ghost"
          size="sm"
          icon={MessageSquare}
          onClick={() => navigate(adminPath(selected.id, 'requests'))}
          title="Client Requests"
          style={{
            marginLeft: 'auto',
            color: tab === 'requests' ? 'var(--teal)' : 'var(--brand-text-muted)',
            background: tab === 'requests' ? 'color-mix(in srgb, var(--teal) 10%, transparent)' : 'transparent',
          }}
        >
          <Badge tone="amber" label={String(pendingContentRequests)} shape="pill" ariaLabel={`${pendingContentRequests} pending requests`} />
        </Button>
      )}
    </nav>
  );
}

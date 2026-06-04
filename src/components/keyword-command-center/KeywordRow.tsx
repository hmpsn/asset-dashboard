import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import type { KeywordCommandCenterRow } from '../../../shared/types/keyword-command-center';
import { LocalSeoVisibilityBadge } from '../local-seo/LocalSeoVisibilityPanel';
import { Badge, Button, StatusBadge, cn } from '../ui';
import type { CustomColumn } from '../shared/RankTable';
import { VariantSubRow } from './VariantSubRow';
import { compactNumber } from './kccDisplayHelpers';

// ════════════════════════════════════════════════════════════════════════════
// KCC row rendering migrated onto the canonical KeywordTable primitive (Wave 4
// P0-T3). Behavior-preserving: every cell below is the byte-for-byte visual the
// bespoke CSS-grid KeywordRow rendered, re-expressed as KeywordTable custom-column
// + renderKeywordMeta + renderVariant callbacks. No new affordances, no redesign.
// ════════════════════════════════════════════════════════════════════════════

function LocalSeoStateBadge({ row }: { row: KeywordCommandCenterRow }) {
  if (!row.localSeoState) return <span className="t-caption-sm text-[var(--brand-text-muted)]">-</span>;
  if (row.localSeo) return <LocalSeoVisibilityBadge visibility={row.localSeo} subtle />;
  return (
    <StatusBadge
      domain="keyword-command-center"
      status={row.localSeoState.lifecycle}
      variant="soft"
      shape="pill"
      fallback="neutral"
    />
  );
}

/** Keyword-cell meta: protected/lost-visibility/local badges + the source sub-label. */
export function renderKccKeywordMeta(row: KeywordCommandCenterRow): ReactNode {
  const primarySource = row.sourceLabels[0];
  return (
    <>
      <div className="flex items-center gap-2 min-w-0 flex-wrap">
        {row.isProtected && <Badge label="Protected" tone="amber" variant="soft" shape="pill" />}
        {row.isLostVisibility && (
          <Badge
            label="Lost Visibility"
            tone="amber"
            variant="outline"
            shape="pill"
            ariaLabel="Lost visibility: this query has not appeared in GSC snapshots for 14 or more days."
          />
        )}
        <LocalSeoVisibilityBadge visibility={row.localSeo} subtle />
      </div>
      <p className="t-caption-sm text-[var(--brand-text-muted)] truncate">
        {primarySource ? `${primarySource.label}${primarySource.detail ? ` · ${primarySource.detail}` : ''}` : 'Keyword universe'}
      </p>
    </>
  );
}

/**
 * The KCC bespoke non-metric columns (Status / Local / Demand / Rank-KD / Assignment /
 * Next), in the same order + same visual as the legacy CSS-grid row. Returned as
 * KeywordTable CustomColumn descriptors so the canonical primitive owns layout.
 * `geoLabel` (optional) appends the market label to the Demand header, exactly as the
 * legacy header did.
 */
export function kccCustomColumns(geoLabel?: string): CustomColumn<KeywordCommandCenterRow>[] {
  return [
  {
    key: 'status',
    header: 'Status',
    align: 'left',
    render: (row) => (
      <StatusBadge
        domain="keyword-command-center"
        status={row.lifecycleStatus}
        variant="outline"
        shape="pill"
        fallback="neutral"
      />
    ),
  },
  {
    key: 'local',
    header: 'Local',
    align: 'left',
    render: (row) => (
      <div className="min-w-0">
        <LocalSeoStateBadge row={row} />
      </div>
    ),
  },
  {
    key: 'demand',
    header: (
      <span>
        Demand
        {geoLabel && (
          <span className="ml-1 normal-case t-caption-sm text-[var(--brand-text-muted)]">- {geoLabel}</span>
        )}
      </span>
    ),
    align: 'left',
    render: (row) => (
      <p className="t-caption text-blue-400 tabular-nums">{compactNumber(row.metrics.volume ?? row.metrics.impressions)}</p>
    ),
  },
  {
    key: 'rank-kd',
    header: 'Rank/KD',
    align: 'left',
    render: (row) => (
      <p className="t-caption text-[var(--brand-text)] tabular-nums">
        {row.metrics.currentPosition ? `#${row.metrics.currentPosition.toFixed(1)}` : row.metrics.difficulty != null ? `${row.metrics.difficulty}/100` : '-'}
      </p>
    ),
  },
  {
    key: 'assignment',
    header: 'Assignment',
    align: 'left',
    render: (row) => (
      <p className={cn(
        't-caption truncate',
        row.lifecycleStatus === 'in_strategy' && !row.assignment?.pageTitle && !row.assignment?.pagePath
          ? 'text-amber-400/90'
          : 'text-[var(--brand-text-muted)]',
      )}>
        {row.assignment?.pageTitle || row.assignment?.pagePath || row.explanation?.nextAction?.label || 'Not yet mapped to a page'}
      </p>
    ),
  },
  {
    key: 'next',
    header: 'Next',
    align: 'right',
    render: (row) => (
      <div className="flex items-center justify-end gap-1 flex-wrap">
        {(row.variantCount ?? 0) > 0 && <Badge label={`${row.variantCount} variants`} tone="blue" variant="soft" />}
        {row.nextActions.slice(0, 2).map(action => (
          <Badge key={action.type} label={action.label} tone={action.tone === 'red' ? 'red' : action.tone === 'amber' ? 'amber' : action.tone === 'blue' ? 'blue' : 'teal'} variant="soft" />
        ))}
      </div>
    ),
  },
  ];
}

/**
 * Per-row expanded content: the variant-expand toggle + (when expanded) the variant
 * sub-rows. Driven by the KCC's expandedVariants set, passed in by the host.
 */
export function renderKccExpanded(
  row: KeywordCommandCenterRow,
  variantsExpanded: boolean,
  onToggleVariants: () => void,
): ReactNode {
  if ((row.variantCount ?? 0) === 0) return null;
  return (
    <div>
      <div className="px-4 py-2 border-b border-[var(--brand-border)] bg-[var(--surface-3)]/10 flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          icon={variantsExpanded ? ChevronDown : ChevronRight}
          onClick={onToggleVariants}
          className="text-[var(--brand-text-muted)] hover:bg-teal-500/10 hover:text-teal-300"
          aria-label={`${variantsExpanded ? 'Collapse' : 'Expand'} ${row.variantCount} variants for ${row.keyword}`}
          title={`${variantsExpanded ? 'Collapse' : 'Expand'} GSC variants`}
        >
          {variantsExpanded ? 'Hide variants' : 'Show variants'}
        </Button>
      </div>
      {variantsExpanded && (row.variants ?? []).map(variant => (
        <VariantSubRow key={variant.query} variant={variant} />
      ))}
    </div>
  );
}

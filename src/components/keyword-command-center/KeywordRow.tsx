import { ChevronDown, ChevronRight } from 'lucide-react';

import type { KeywordCommandCenterRow } from '../../../shared/types/keyword-command-center';
import { LocalSeoVisibilityBadge } from '../local-seo/LocalSeoVisibilityPanel';
import { Badge, Button, Checkbox, ClickableRow, cn } from '../ui';
import { KEYWORD_ROW_CONTENT_GRID, KEYWORD_ROW_GRID, VariantSubRow } from './VariantSubRow';
import {
  STATUS_TONE,
  compactNumber,
  localLifecycleTone,
} from './kccDisplayHelpers';

function LocalSeoStateBadge({ row }: { row: KeywordCommandCenterRow }) {
  if (!row.localSeoState) return <span className="t-caption-sm text-[var(--brand-text-muted)]">-</span>;
  if (row.localSeo) return <LocalSeoVisibilityBadge visibility={row.localSeo} subtle />;
  return (
    <Badge
      label={row.localSeoState.lifecycleLabel}
      tone={localLifecycleTone(row.localSeoState.lifecycle)}
      variant="soft"
      shape="pill"
    />
  );
}

interface KeywordRowProps {
  row: KeywordCommandCenterRow;
  active: boolean;
  selected: boolean;
  onSelect: () => void;
  onToggleSelected: (selected: boolean) => void;
  variantsExpanded: boolean;
  onToggleVariants: () => void;
}

export function KeywordRow({
  row,
  active,
  selected,
  onSelect,
  onToggleSelected,
  variantsExpanded,
  onToggleVariants,
}: KeywordRowProps) {
  const primarySource = row.sourceLabels[0];

  return (
    <div>
      <div
        className={cn(
          `grid ${KEYWORD_ROW_GRID} gap-3 items-center px-4 py-3 border-b border-[var(--brand-border)] last:border-b-0`,
          'hover:bg-teal-500/5',
          active && 'bg-[var(--surface-3)]/60',
          selected && 'bg-teal-500/5',
        )}
      >
        <div>
          <Checkbox
            checked={selected}
            onChange={onToggleSelected}
            label={`Select ${row.keyword}`}
            srOnlyLabel
          />
        </div>
        <ClickableRow
          active={false}
          onClick={onSelect}
          className={`col-span-7 grid ${KEYWORD_ROW_CONTENT_GRID} gap-3 items-center p-0 bg-transparent hover:bg-transparent focus-visible:outline-offset-4`}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <p className="t-caption font-semibold text-[var(--brand-text-bright)] truncate">{row.keyword}</p>
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
          </div>
          <Badge label={row.statusLabel} tone={STATUS_TONE[row.lifecycleStatus]} variant="outline" shape="pill" />
          <div className="min-w-0">
            <LocalSeoStateBadge row={row} />
          </div>
          <p className="t-caption text-blue-400 tabular-nums">{compactNumber(row.metrics.volume ?? row.metrics.impressions)}</p>
          <p className="t-caption text-[var(--brand-text)] tabular-nums">
            {row.metrics.currentPosition ? `#${row.metrics.currentPosition.toFixed(1)}` : row.metrics.difficulty != null ? `${row.metrics.difficulty}/100` : '-'}
          </p>
          <p className={cn(
            't-caption truncate',
            row.lifecycleStatus === 'in_strategy' && !row.assignment?.pageTitle && !row.assignment?.pagePath
              ? 'text-amber-400/90'
              : 'text-[var(--brand-text-muted)]',
          )}>
            {row.assignment?.pageTitle || row.assignment?.pagePath || row.explanation?.nextAction?.label || 'Not yet mapped to a page'}
          </p>
          <div className="flex items-center justify-end gap-1 flex-wrap">
            {(row.variantCount ?? 0) > 0 && <Badge label={`${row.variantCount} variants`} tone="blue" variant="soft" />}
            {row.nextActions.slice(0, 2).map(action => (
              <Badge key={action.type} label={action.label} tone={action.tone === 'red' ? 'red' : action.tone === 'amber' ? 'amber' : action.tone === 'blue' ? 'blue' : 'teal'} variant="soft" />
            ))}
          </div>
        </ClickableRow>
      </div>
      {(row.variantCount ?? 0) > 0 && (
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
      )}
      {variantsExpanded && (row.variants ?? []).map(variant => (
        <VariantSubRow key={variant.query} variant={variant} />
      ))}
    </div>
  );
}

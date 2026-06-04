import type { ReactNode } from 'react';
import { Fragment } from 'react';
import { ChevronUp, ChevronDown, TrendingUp } from 'lucide-react'; // trend-icon-ok — sort-direction chevrons + decorative section icon, not metric trend indicators
import type { LucideIcon } from 'lucide-react';

import { SectionCard, Icon, EmptyState, Checkbox, Button } from '../ui';
import { CHART_SERIES_ORDER } from '../ui/constants';
import { TableSkeleton } from '../ui/LoadingState';
import { positionColor as sharedPositionColor } from '../ui/constants';
import { kdColor as sharedKdColor } from '../page-intelligence/pageIntelligenceDisplay';
import { fmtNum } from '../../utils/formatNumbers';

// ════════════════════════════════════════════════════════════════════════════
// positionColor — re-export the canonical T1 authority.
//
// Historically this module hosted its own `positionColor` (DEF A in the Wave 2
// audit): bare-tailwind `text-emerald-400/80` with `font-semibold` baked into ≤3
// and no undefined guard. As part of folding RankTable into the canonical
// KeywordTable, the export now delegates to the single ui/constants authority
// (accent tokens, emerald ≤10, undefined/0 → muted). This is a deliberate,
// reviewed class-string change (`emerald-400/80` → `text-accent-success`); there
// are no snapshot tests pinning the old class strings on this surface.
// ════════════════════════════════════════════════════════════════════════════
export function positionColor(pos?: number | null): string {
  return sharedPositionColor(pos);
}

// ── Rank History Chart (kept as a sibling — NOT folded into KeywordTable) ──
interface RankHistoryChartProps {
  rankHistory: { date: string; positions: Record<string, number> }[];
  maxKeywords?: number;
  height?: string;
}

const CHART_COLORS = [...CHART_SERIES_ORDER];

export function RankHistoryChart({ rankHistory, maxKeywords = 5, height = 'h-28' }: RankHistoryChartProps) {
  if (rankHistory.length < 2) return null;
  const allKws = Object.keys(rankHistory[rankHistory.length - 1]?.positions || {}).slice(0, maxKeywords);
  if (allKws.length === 0) return null;
  const maxPos = Math.max(...rankHistory.flatMap(s => allKws.map(k => s.positions[k] || 0)), 20);
  const W = 400, H = 120, PAD = 8;

  return (
    <div className="mb-3">
      <svg viewBox={`0 0 ${W} ${H}`} className={`w-full ${height}`} preserveAspectRatio="none">
        {allKws.map((kw, ki) => {
          const pts = rankHistory.map((s, i) => {
            const x = PAD + (i / Math.max(rankHistory.length - 1, 1)) * (W - PAD * 2);
            const pos = s.positions[kw];
            if (pos === undefined) return null;
            const y = PAD + ((pos - 1) / Math.max(maxPos - 1, 1)) * (H - PAD * 2);
            return `${x},${y}`;
          }).filter(Boolean);
          if (pts.length < 2) return null;
          return <path key={kw} d={`M${pts.join(' L')}`} fill="none" stroke={CHART_COLORS[ki % CHART_COLORS.length]} strokeWidth="2" opacity="0.8" />;
        })}
      </svg>
      <div className="flex flex-wrap gap-3 mt-1">
        {allKws.map((kw, ki) => (
          <span key={kw} className="flex items-center gap-1.5 t-caption-sm text-[var(--brand-text-muted)]">
            <span className="w-3 h-0.5 rounded inline-block" style={{ backgroundColor: CHART_COLORS[ki % CHART_COLORS.length] }} />
            <span className="truncate max-w-[120px]">{kw}</span>
          </span>
        ))}
      </div>
      <div className="flex items-center justify-between t-caption-sm text-[var(--brand-text-muted)] mt-1">
        <span>Position 1 (top)</span>
        <span>Position {maxPos} (bottom)</span>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// KeywordTable — canonical keyword/rank table primitive (Wave 2, Task T3).
//
// Subsumes shared/RankTable into a single generic-row table that the Phase-4
// bypass surfaces (RankTracker grid, KCC KeywordRow/VariantSubRow, SearchTab /
// SearchDetail raw tables, LowHangingFruit, KeywordGaps, RankingsSnapshot,
// PageKeywordMapContent leaf) can migrate onto later. It closes the 9 absorption
// gaps from the audit:
//   1. generic/superset row type           → KeywordTableRow
//   2. renderActions slot                   → renderActions
//   3. variant sub-row slot                 → renderVariant (KEYWORD_ROW_GRID generalized)
//   4. selection checkbox column            → selection
//   5. column-level flag-gated local-seo    → showLocalSeo + 'localSeo' column
//   6. sort headers                         → sort
//   7. per-row expand slot                  → isRowExpanded + renderExpanded
//   8. EmptyState + skeleton (no null)      → emptyState / loading
//   9. density / compact variant            → density
// Consumes the shared T1 positionColor + T2 fmtNum/kdColor authorities. The
// change-sign conflict (RankChange: change>0=good vs RankTracker: change<0=good)
// is resolved with the explicit `changeSign` prop.
// ════════════════════════════════════════════════════════════════════════════

/** Sign convention for the change indicator. */
export type ChangeSign = 'higherIsBetter' | 'lowerIsBetter';

/** Built-in data columns (rendered between the keyword cell and the action slot). */
export type KeywordColumnKey =
  | 'position'
  | 'change'
  | 'clicks'
  | 'impressions'
  | 'volume'
  | 'difficulty';

/**
 * Generic/superset keyword row reconciling the three divergent shapes the audit
 * enumerated: `RankEntry`+previousPosition (RankingsSnapshot), `latestRanks`+ctr
 * (RankTable/RankTrackingSection), and `LatestRank`+pinned/source/pagePath
 * (RankTracker). All metric fields are optional so any surface can map onto it.
 */
export interface KeywordTableRow {
  query: string;
  position?: number;
  previousPosition?: number;
  change?: number;
  clicks?: number;
  impressions?: number;
  ctr?: number;
  volume?: number;
  /** Keyword difficulty (0–100). */
  difficulty?: number;
  pinned?: boolean;
  source?: string;
  pagePath?: string;
  pageTitle?: string;
  /** Pre-resolved local-seo label for the (flag-gated) local column. */
  localSeoLabel?: string;
  /** Variant sub-rows (e.g. aggregated GSC query variants). Shape is opaque to the table. */
  variants?: unknown[];
}

interface SelectionConfig<T> {
  selected: Set<string>;
  onToggle: (id: string) => void;
  /** Stable per-row id used for selection membership + onToggle. */
  rowId: (row: T) => string;
}

interface SortConfig {
  key: string;
  direction: 'asc' | 'desc';
  onSort: (key: string) => void;
}

interface EmptyStateConfig {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}

interface ColumnMeta {
  key: KeywordColumnKey;
  label: string;
  /** Sort key emitted to onSort; defaults to the column key. */
  sortKey?: string;
}

const COLUMN_META: Record<KeywordColumnKey, ColumnMeta> = {
  position: { key: 'position', label: 'Position' },
  change: { key: 'change', label: 'Change' },
  clicks: { key: 'clicks', label: 'Clicks' },
  impressions: { key: 'impressions', label: 'Impressions' },
  volume: { key: 'volume', label: 'Volume' },
  difficulty: { key: 'difficulty', label: 'KD' },
};

const DEFAULT_COLUMNS: KeywordColumnKey[] = ['position', 'change', 'clicks'];

interface KeywordTableProps<T extends KeywordTableRow> {
  rows: T[];
  /** Data columns to render, in order. Defaults to position/change/clicks. */
  columns?: KeywordColumnKey[];
  limit?: number;
  /** Sign convention for the change indicator. Default matches legacy RankChange. */
  changeSign?: ChangeSign;
  /** Column-level, flag-gated local-seo column (opt-in). */
  showLocalSeo?: boolean;
  /** Density of body rows. */
  density?: 'comfortable' | 'compact';
  /** Loading → skeleton instead of the table. */
  loading?: boolean;
  /** EmptyState shown when rows are empty (fixes RankTable's legacy null-return). */
  emptyState?: EmptyStateConfig;
  /** Optional selection checkbox column. */
  selection?: SelectionConfig<T>;
  /** Optional sortable headers. */
  sort?: SortConfig;
  /** Render extra action content after the data columns (pin/remove/open-page, badges). */
  renderActions?: (row: T) => ReactNode;
  /** Render content INSIDE the keyword cell, after the query (source/lifecycle badges, page title). */
  renderKeywordMeta?: (row: T) => ReactNode;
  /** Per-row expand predicate. When it returns true, renderExpanded output is shown below the row. */
  isRowExpanded?: (row: T) => boolean;
  /** Per-row expanded detail (sparkline / GSC grid). */
  renderExpanded?: (row: T) => ReactNode;
  /** Variant sub-row renderer (KCC pattern). One sub-row per entry in row.variants. */
  renderVariant?: (variant: unknown, row: T) => ReactNode;
  className?: string;
}

const TH_BASE = 'py-2 px-3 text-[var(--brand-text-muted)] font-medium';
const DENSITY_CELL: Record<'comfortable' | 'compact', string> = {
  comfortable: 'py-1.5 px-3',
  compact: 'py-1 px-2',
};

function SortHeader({
  label,
  columnKey,
  sort,
  className,
}: {
  label: string;
  columnKey: string;
  sort?: SortConfig;
  className: string;
}) {
  if (!sort) {
    return <th className={className}>{label}</th>;
  }
  const active = sort.key === columnKey;
  const directionIcon = active
    ? sort.direction === 'asc'
      ? ChevronUp
      : ChevronDown
    : undefined;
  return (
    <th className={className}>
      <Button
        variant="ghost"
        size="sm"
        icon={directionIcon}
        iconPosition="right"
        onClick={() => sort.onSort(columnKey)}
        className="px-1 py-0.5 font-medium text-[var(--brand-text-muted)]"
      >
        {label}
      </Button>
    </th>
  );
}

export function KeywordTable<T extends KeywordTableRow>({
  rows,
  columns = DEFAULT_COLUMNS,
  limit,
  changeSign = 'higherIsBetter',
  showLocalSeo = false,
  density = 'comfortable',
  loading = false,
  emptyState,
  selection,
  sort,
  renderActions,
  renderKeywordMeta,
  isRowExpanded,
  renderExpanded,
  renderVariant,
  className,
}: KeywordTableProps<T>) {
  const cell = DENSITY_CELL[density];

  if (loading) {
    return (
      <div className={`overflow-hidden rounded-[var(--radius-sm)] border border-[var(--brand-border)] ${className ?? ''}`}>
        <TableSkeleton rows={5} columns={columns.length + 1} />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={emptyState?.icon ?? TrendingUp}
        title={emptyState?.title ?? 'No keywords yet'}
        description={emptyState?.description}
        action={emptyState?.action}
        className={className}
      />
    );
  }

  const visible = typeof limit === 'number' ? rows.slice(0, limit) : rows;
  // Total column count for full-width expanded/variant rows.
  const totalCols =
    1 /* keyword */ +
    columns.length +
    (showLocalSeo ? 1 : 0) +
    (selection ? 1 : 0) +
    (renderActions ? 1 : 0);

  return (
    <div className={`overflow-hidden rounded-[var(--radius-sm)] border border-[var(--brand-border)] ${className ?? ''}`}>
      <table className="w-full t-caption">
        <thead>
          <tr className="bg-[var(--surface-1)]/50">
            {selection && <th className="w-8" />}
            <SortHeader label="Keyword" columnKey="keyword" sort={sort} className={`text-left ${TH_BASE}`} />
            {columns.map((c) => {
              const meta = COLUMN_META[c];
              return (
                <SortHeader
                  key={c}
                  label={meta.label}
                  columnKey={meta.sortKey ?? meta.key}
                  sort={sort}
                  className={`text-right ${TH_BASE}`}
                />
              );
            })}
            {showLocalSeo && <th className={`text-right ${TH_BASE}`}>Local</th>}
            {renderActions && <th className="w-10" />}
          </tr>
        </thead>
        <tbody>
          {visible.map((r, i) => {
            const rowId = selection?.rowId(r) ?? r.query;
            const variants = renderVariant ? (r.variants ?? []) : [];
            const expanded = isRowExpanded?.(r) && renderExpanded;
            return (
              <Fragment key={rowId ?? i}>
                <tr className="border-t border-[var(--brand-border)]/50">
                  {selection && (
                    <td className={cell}>
                      <Checkbox
                        checked={selection.selected.has(rowId)}
                        onChange={() => selection.onToggle(rowId)}
                        label={r.query}
                        srOnlyLabel
                      />
                    </td>
                  )}
                  {renderKeywordMeta ? (
                    <td className={`${cell} text-[var(--brand-text-bright)] max-w-[200px]`}>
                      <span className="truncate block">{r.query}</span>
                      {renderKeywordMeta(r)}
                    </td>
                  ) : (
                    // Byte-identical to the legacy RankTable keyword cell: query inline
                    // with `truncate` on the <td>, no wrapping span (preserves SearchTab
                    // /RankTrackingSection DOM exactly).
                    <td className={`${cell} text-[var(--brand-text-bright)] truncate max-w-[200px]`}>
                      {r.query}
                    </td>
                  )}
                  {columns.map((c) => (
                    <DataCell key={c} column={c} row={r} cell={cell} changeSign={changeSign} />
                  ))}
                  {showLocalSeo && (
                    <td className={`${cell} text-right text-[var(--brand-text-muted)]`}>
                      {r.localSeoLabel ?? '—'}
                    </td>
                  )}
                  {renderActions && <td className={`${cell} text-right`}>{renderActions(r)}</td>}
                </tr>
                {variants.map((v, vi) => (
                  <tr key={`${rowId}-variant-${vi}`} className="bg-[var(--surface-3)]/15">
                    <td colSpan={totalCols} className="p-0">
                      {renderVariant!(v, r)}
                    </td>
                  </tr>
                ))}
                {expanded && (
                  <tr className="bg-[var(--surface-1)]/30">
                    <td colSpan={totalCols} className="p-0">
                      {renderExpanded!(r)}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DataCell<T extends KeywordTableRow>({
  column,
  row,
  cell,
  changeSign,
}: {
  column: KeywordColumnKey;
  row: T;
  cell: string;
  changeSign: ChangeSign;
}) {
  switch (column) {
    case 'position':
      return (
        <td className={`${cell} text-right`}>
          {row.position != null ? (
            <span className={sharedPositionColor(row.position)}>#{Math.round(row.position)}</span>
          ) : (
            <span className="text-[var(--brand-text-muted)]">—</span>
          )}
        </td>
      );
    case 'change':
      return (
        <td className={`${cell} text-right`}>
          <ChangeIndicator change={row.change} changeSign={changeSign} />
        </td>
      );
    case 'clicks':
      return <td className={`${cell} text-right text-blue-400`}>{row.clicks ?? 0}</td>;
    case 'impressions':
      return (
        <td className={`${cell} text-right text-[var(--brand-text-muted)]`}>
          {(row.impressions ?? 0).toLocaleString()}
        </td>
      );
    case 'volume':
      return (
        <td className={`${cell} text-right text-[var(--brand-text)] tabular-nums`}>
          {row.volume != null ? `${fmtNum(row.volume)}/mo` : '—'}
        </td>
      );
    case 'difficulty':
      return (
        <td className={`${cell} text-right`}>
          {row.difficulty != null ? (
            <span className={sharedKdColor(row.difficulty)}>KD {Math.round(row.difficulty)}</span>
          ) : (
            <span className="text-[var(--brand-text-muted)]">—</span>
          )}
        </td>
      );
  }
}

/**
 * Sign-aware change indicator. Resolves the audit's change-sign conflict:
 *  - higherIsBetter (RankChange legacy): change>0 is good (↑ emerald), <0 bad (↓ red).
 *  - lowerIsBetter (RankTracker): a negative change means the rank moved toward #1
 *    (improvement) → good; magnitude is always shown as a positive number.
 */
function ChangeIndicator({ change, changeSign }: { change?: number; changeSign: ChangeSign }) {
  if (change === undefined || change === 0) {
    return <span className="text-[var(--brand-text-muted)]">—</span>;
  }
  const isGood = changeSign === 'higherIsBetter' ? change > 0 : change < 0;
  return (
    <span className={isGood ? 'text-emerald-400/80' : 'text-red-400/80'}>
      {isGood ? '↑' : '↓'}{Math.abs(change)}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Legacy exports — thin wrappers over KeywordTable, kept byte-identical so every
// current consumer (client/SearchTab → RankTrackingSection) renders unchanged.
// ════════════════════════════════════════════════════════════════════════════

export interface RankRow {
  query: string;
  position: number;
  change?: number;
  clicks?: number;
  impressions?: number;
}

interface RankTableProps {
  ranks: RankRow[];
  limit?: number;
  showClicks?: boolean;
  showImpressions?: boolean;
  /** Render extra columns after the standard ones */
  renderActions?: (rank: RankRow) => React.ReactNode;
}

export function RankTable({
  ranks,
  limit = 10,
  showClicks = true,
  showImpressions = false,
  renderActions,
}: RankTableProps) {
  // Byte-identical to the legacy RankTable: null on empty (the legacy contract
  // for this specific export — KeywordTable itself fixes the null-return for new
  // consumers via emptyState), position/change/clicks(blue)/impressions columns.
  if (ranks.length === 0) return null;

  const columns: KeywordColumnKey[] = ['position', 'change'];
  if (showClicks) columns.push('clicks');
  if (showImpressions) columns.push('impressions');

  return (
    <KeywordTable<RankRow>
      rows={ranks}
      columns={columns}
      limit={limit}
      changeSign="higherIsBetter"
      renderActions={renderActions}
    />
  );
}

// ── Rank Change Indicator (legacy export — change>0 = good) ──
export function RankChange({ change }: { change?: number }) {
  return <ChangeIndicator change={change} changeSign="higherIsBetter" />;
}

// ── Rank Tracking Section (chart + table combined) ──
interface RankTrackingSectionProps {
  rankHistory: { date: string; positions: Record<string, number> }[];
  latestRanks: RankRow[];
  limit?: number;
  showClicks?: boolean;
  title?: string;
}

export function RankTrackingSection({
  rankHistory,
  latestRanks,
  limit = 10,
  showClicks = true,
  title = 'Keyword Rank Tracking',
}: RankTrackingSectionProps) {
  if (rankHistory.length < 2 && latestRanks.length === 0) return null;

  return (
    <SectionCard
      title={title}
      titleIcon={<Icon as={TrendingUp} size="md" className="text-teal-400" />}
      action={<span className="t-caption-sm text-[var(--brand-text-muted)]">{rankHistory.length} snapshots</span>}
    >
      <RankHistoryChart rankHistory={rankHistory} />
      <RankTable ranks={latestRanks} limit={limit} showClicks={showClicks} />
    </SectionCard>
  );
}

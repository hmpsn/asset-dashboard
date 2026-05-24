import { ChevronRight } from 'lucide-react';

import type { KeywordCommandCenterRow } from '../../../shared/types/keyword-command-center';
import { compactNumber } from './kccDisplayHelpers';

export const KEYWORD_ROW_GRID = 'grid-cols-[40px_minmax(220px,1.5fr)_120px_150px_100px_100px_minmax(180px,1fr)_130px]';
export const KEYWORD_ROW_CONTENT_GRID = 'grid-cols-[minmax(220px,1.5fr)_120px_150px_100px_100px_minmax(180px,1fr)_130px]';

type VariantRow = NonNullable<KeywordCommandCenterRow['variants']>[number];

export function VariantSubRow({ variant }: { variant: VariantRow }) {
  return (
    <div className={`grid ${KEYWORD_ROW_GRID} gap-3 items-center px-4 py-2 border-b border-[var(--brand-border)] bg-[var(--surface-3)]/15`}>
      <div />
      <div className="min-w-0 pl-6 flex items-center gap-2">
        <ChevronRight className="h-3 w-3 text-[var(--brand-text-muted)] flex-shrink-0" aria-hidden="true" />
        <p className="t-caption-sm text-[var(--brand-text-muted)] truncate">{variant.query}</p>
      </div>
      <span className="t-caption-sm text-[var(--brand-text-muted)]">Variant</span>
      <span className="t-caption-sm text-[var(--brand-text-muted)]">-</span>
      <span className="t-caption-sm text-blue-400 tabular-nums">{compactNumber(variant.impressions)}</span>
      <span className="t-caption-sm text-[var(--brand-text)] tabular-nums">#{variant.position.toFixed(1)}</span>
      <span className="t-caption-sm text-[var(--brand-text-muted)] truncate">Search Console variant</span>
      <span className="t-caption-sm text-blue-400 tabular-nums text-right">{compactNumber(variant.clicks)} clicks</span>
    </div>
  );
}

// @ds-rebuilt
import type { ReactElement } from 'react';
import { Image, Minimize2, Sparkles, Wand2 } from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  ClickableRow,
  EmptyState,
  Icon,
  Tooltip,
  cn,
} from '../ui';
import { formatBytes } from '../../utils/formatNumbers';
import type { BrowseAsset } from './types';

interface AssetGridProps {
  assets: BrowseAsset[];
  selected: Set<string>;
  quotaLocked: boolean;
  quotaReason: string;
  actionBusy: (assetId: string, action: 'alt' | 'compress' | 'rename') => boolean;
  onToggleSelect: (assetId: string) => void;
  onOpenAsset: (assetId: string) => void;
  onGenerateAlt: (asset: BrowseAsset) => void;
  onCompress: (asset: BrowseAsset) => void;
  onSmartRename: (asset: BrowseAsset) => void;
  onClearFilters: () => void;
}

function assetName(asset: BrowseAsset): string {
  return asset.displayName || asset.originalFileName || asset.id;
}

function assetUrl(asset: BrowseAsset): string | undefined {
  return asset.hostedUrl || asset.url;
}

function dimensionText(asset: BrowseAsset): string | null {
  if (!asset.width || !asset.height) return null;
  return `${asset.width} x ${asset.height}`;
}

function QuotaTooltip({
  locked,
  reason,
  children,
}: {
  locked: boolean;
  reason: string;
  children: ReactElement;
}) {
  if (!locked) return children;
  return (
    <Tooltip content={reason} placement="top" contentClassName="max-w-sm">
      <span className="inline-flex flex-1" tabIndex={0}>
        {children}
      </span>
    </Tooltip>
  );
}

function ImageEmptyIcon({ className }: { className?: string }) {
  return <Icon as={Image} className={className} />;
}

export function AssetGrid({
  assets,
  selected,
  quotaLocked,
  quotaReason,
  actionBusy,
  onToggleSelect,
  onOpenAsset,
  onGenerateAlt,
  onCompress,
  onSmartRename,
  onClearFilters,
}: AssetGridProps) {
  if (assets.length === 0) {
    return (
      <EmptyState
        icon={ImageEmptyIcon}
        title="No assets match this view"
        description="Clear the filters or search to return to the full asset library."
        action={(
          <Button size="sm" variant="primary" onClick={onClearFilters}>
            Clear filters
          </Button>
        )}
      />
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(216px,1fr))] gap-[14px]" aria-label="Asset grid">
      {assets.map((asset) => {
        const url = assetUrl(asset);
        const name = assetName(asset);
        const dims = dimensionText(asset);
        const isSvg = asset.contentType.includes('svg');
        const isOversized = asset.size > 500 * 1024 && !isSvg;
        const isMissingAlt = !asset.altText?.trim();
        const canCompress = Boolean(url) && !isSvg && !asset.richTextOnly;
        const selectedAsset = selected.has(asset.id);

        return (
          <article
            key={asset.id}
            className={cn(
              'overflow-hidden rounded-[var(--radius-lg)] border bg-[var(--surface-2)] transition-colors',
              selectedAsset ? 'border-[var(--teal)]' : 'border-[var(--brand-border)] hover:border-[var(--brand-border-hover)]',
            )}
          >
            <div data-testid="asset-preview" className="relative h-[132px] bg-[var(--surface-1)]">
              <ClickableRow
                aria-label={`Open ${name}`}
                className="flex h-full w-full items-center justify-center bg-transparent p-0 hover:bg-transparent"
                onClick={() => onOpenAsset(asset.id)}
              >
                {url ? (
                  <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <Icon as={Image} size="2xl" className="text-[var(--brand-text-dim)]" />
                )}
              </ClickableRow>
              <div className="absolute left-2 top-2 rounded-[var(--radius-md)] bg-[var(--surface-2)]/90 px-2 py-1">
                <Checkbox
                  checked={selectedAsset}
                  onChange={() => onToggleSelect(asset.id)}
                  label={`Select ${name}`}
                  srOnlyLabel
                />
              </div>
              <div className="absolute right-2 top-2 flex flex-col items-end gap-1">
                {isOversized && <Badge label="Oversized" tone="amber" variant="solid" size="sm" />}
                {isMissingAlt && <Badge label="No alt" tone="red" variant="solid" size="sm" />}
                {asset.unused && <Badge label="Unused" tone="zinc" variant="soft" size="sm" />}
                {asset.source === 'cms' && <Badge label="CMS" tone="blue" variant="soft" size="sm" />}
              </div>
            </div>

            <div className="flex flex-col gap-2 px-3 pb-3 pt-2.5">
              <div className="min-w-0">
                <ClickableRow
                  className="block max-w-full bg-transparent p-0 t-ui font-semibold text-[var(--brand-text-bright)] hover:bg-transparent"
                  onClick={() => onOpenAsset(asset.id)}
                >
                  <span className="block truncate">{name}</span>
                </ClickableRow>
                <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 t-micro text-[var(--brand-text-muted)]">
                  <span>{formatBytes(asset.size || 0)}</span>
                  {dims && <span>{dims}</span>}
                  <span>{asset.contentType}</span>
                  {asset.cmsUsages && asset.cmsUsages.length > 0 && (
                    <span>{asset.cmsUsages.length} CMS {asset.cmsUsages.length === 1 ? 'ref' : 'refs'}</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  aria-label={asset.richTextOnly ? 'Compression unavailable for RichText-only CMS image' : 'Compress image'}
                  size="sm"
                  variant="secondary"
                  className="flex-1 justify-center"
                  disabled={actionBusy(asset.id, 'compress') || !canCompress}
                  onClick={() => onCompress(asset)}
                >
                  <Icon as={Minimize2} size="sm" aria-hidden="true" />
                  Compress
                </Button>
                {isMissingAlt ? (
                  <QuotaTooltip locked={quotaLocked} reason={quotaReason}>
                    <Button
                      aria-label="Generate alt text"
                      size="sm"
                      variant="primary"
                      className="flex-1 justify-center"
                      disabled={quotaLocked || actionBusy(asset.id, 'alt') || !url}
                      onClick={() => onGenerateAlt(asset)}
                    >
                      <Icon as={Sparkles} size="sm" aria-hidden="true" />
                      Alt text
                    </Button>
                  </QuotaTooltip>
                ) : (
                  <QuotaTooltip locked={quotaLocked} reason={quotaReason}>
                    <Button
                      aria-label="Draft smart name"
                      size="sm"
                      variant="secondary"
                      className="flex-1 justify-center"
                      disabled={quotaLocked || actionBusy(asset.id, 'rename') || !url}
                      onClick={() => onSmartRename(asset)}
                    >
                      <Icon as={Wand2} size="sm" aria-hidden="true" />
                      Rename
                    </Button>
                  </QuotaTooltip>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

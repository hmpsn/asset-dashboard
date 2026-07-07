// @ds-rebuilt
import type { ReactElement } from 'react';
import { ExternalLink, Image, Minimize2, Sparkles, Wand2 } from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  ClickableRow,
  EmptyState,
  Icon,
  IconButton,
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
      <span className="inline-flex" tabIndex={0}>
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
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" aria-label="Asset grid">
      {assets.map((asset) => {
        const url = assetUrl(asset);
        const name = assetName(asset);
        const dims = dimensionText(asset);
        const isSvg = asset.contentType.includes('svg');
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
            <div className="relative aspect-[4/3] bg-[var(--surface-1)]">
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
              <div className="absolute right-2 top-2 flex gap-1">
                {asset.unused && <Badge label="Unused" tone="red" variant="soft" size="sm" />}
                {asset.source === 'cms' && <Badge label="CMS" tone="blue" variant="soft" size="sm" />}
              </div>
            </div>

            <div className="flex flex-col gap-3 p-3">
              <div className="min-w-0">
                <ClickableRow
                  className="block max-w-full bg-transparent p-0 t-ui font-semibold text-[var(--brand-text-bright)] hover:bg-transparent"
                  onClick={() => onOpenAsset(asset.id)}
                >
                  <span className="block truncate">{name}</span>
                </ClickableRow>
                <div className="mt-1 flex flex-wrap items-center gap-2 t-caption-sm text-[var(--brand-text-muted)]">
                  <span>{formatBytes(asset.size || 0)}</span>
                  {dims && <span>{dims}</span>}
                  <span>{asset.contentType}</span>
                </div>
              </div>

              <div className="min-h-[38px] t-caption-sm text-[var(--brand-text-muted)]">
                {asset.altText?.trim() || <span className="text-[var(--amber)]">Missing alt text</span>}
              </div>

              {asset.cmsUsages && asset.cmsUsages.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {asset.cmsUsages.slice(0, 2).map((usage) => (
                    <Badge
                      key={`${usage.collectionId}:${usage.fieldSlug}:${usage.itemId}`}
                      label={usage.fieldDisplayName}
                      tone={usage.fieldType === 'RichText' ? 'amber' : 'blue'}
                      variant="soft"
                      size="sm"
                    />
                  ))}
                  {asset.cmsUsages.length > 2 && <Badge label={`+${asset.cmsUsages.length - 2}`} tone="zinc" variant="soft" size="sm" />}
                </div>
              )}

              <div className="flex items-center gap-1.5">
                <QuotaTooltip locked={quotaLocked} reason={quotaReason}>
                  <IconButton
                    icon={Sparkles}
                    label="Generate alt text"
                    size="md"
                    variant="solid"
                    disabled={quotaLocked || actionBusy(asset.id, 'alt') || !url}
                    onClick={() => onGenerateAlt(asset)}
                  />
                </QuotaTooltip>
                <IconButton
                  icon={Minimize2}
                  label={asset.richTextOnly ? 'Compression unavailable for RichText-only CMS image' : 'Compress image'}
                  size="md"
                  variant="solid"
                  disabled={actionBusy(asset.id, 'compress') || !canCompress}
                  onClick={() => onCompress(asset)}
                />
                <QuotaTooltip locked={quotaLocked} reason={quotaReason}>
                  <IconButton
                    icon={Wand2}
                    label="Draft smart name"
                    size="md"
                    variant="solid"
                    disabled={quotaLocked || actionBusy(asset.id, 'rename') || !url}
                    onClick={() => onSmartRename(asset)}
                  />
                </QuotaTooltip>
                {url && (
                  <IconButton
                    icon={ExternalLink}
                    label="Open asset in new tab"
                    size="md"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                  />
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

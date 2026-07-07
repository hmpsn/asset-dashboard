// @ds-rebuilt
import type { ReactElement } from 'react';
import { ExternalLink, Image, Minimize2, Sparkles, Wand2 } from 'lucide-react';
import {
  Badge,
  Checkbox,
  DataTable,
  Icon,
  IconButton,
  Tooltip,
  type DataColumn,
} from '../ui';
import { formatBytes } from '../../utils/formatNumbers';
import type { BrowseAsset } from './types';

interface AssetTableProps {
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
}

function assetName(asset: BrowseAsset): string {
  return asset.displayName || asset.originalFileName || asset.id;
}

function assetUrl(asset: BrowseAsset): string | undefined {
  return asset.hostedUrl || asset.url;
}

function quotaWrap(locked: boolean, reason: string, child: ReactElement) {
  if (!locked) return child;
  return (
    <Tooltip content={reason} placement="top" contentClassName="max-w-sm">
      <span className="inline-flex" tabIndex={0}>
        {child}
      </span>
    </Tooltip>
  );
}

export function AssetTable({
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
}: AssetTableProps) {
  const rows = assets.map((asset) => ({
    id: asset.id,
    name: assetName(asset),
    altText: asset.altText,
    size: asset.size || 0,
    dimensions: asset.width && asset.height ? `${asset.width} x ${asset.height}` : null,
    usage: asset.unused ? 'Unused' : 'Used',
    source: asset.source,
    asset,
  }));

  const columns: DataColumn[] = [
    {
      key: 'select',
      label: '',
      width: '42px',
      render: (_value, row) => {
        const asset = row.asset as BrowseAsset;
        return (
          <span onClick={(event) => event.stopPropagation()}>
            <Checkbox
              checked={selected.has(asset.id)}
              onChange={() => onToggleSelect(asset.id)}
              label={`Select ${assetName(asset)}`}
              srOnlyLabel
            />
          </span>
        );
      },
    },
    {
      key: 'name',
      label: 'Asset',
      width: 'minmax(260px, 1.5fr)',
      sortable: true,
      render: (_value, row) => {
        const asset = row.asset as BrowseAsset;
        const url = assetUrl(asset);
        return (
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 flex-none items-center justify-center overflow-hidden rounded-[var(--radius-md)] bg-[var(--surface-1)]">
              {url ? (
                <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <Icon as={Image} size="md" className="text-[var(--brand-text-dim)]" />
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate t-ui font-semibold text-[var(--brand-text-bright)]">{assetName(asset)}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {asset.source === 'cms' && <Badge label="CMS" tone="blue" variant="soft" size="sm" />}
                {asset.unused && <Badge label="Unused" tone="red" variant="soft" size="sm" />}
                <Badge label={asset.contentType || 'unknown'} tone="zinc" variant="soft" size="sm" />
              </div>
            </div>
          </div>
        );
      },
    },
    {
      key: 'altText',
      label: 'Alt text',
      width: 'minmax(220px, 1fr)',
      render: (_value, row) => {
        const asset = row.asset as BrowseAsset;
        return (
          <span className="line-clamp-2 t-caption text-[var(--brand-text-muted)]">
            {asset.altText?.trim() || <span className="text-[var(--amber)]">Missing</span>}
          </span>
        );
      },
    },
    {
      key: 'size',
      label: 'Size',
      width: '96px',
      align: 'right',
      sortable: true,
      render: (value) => formatBytes(Number(value) || 0),
    },
    {
      key: 'dimensions',
      label: 'W x H',
      width: '96px',
      align: 'right',
      render: (value) => (value ? String(value) : '—'),
    },
    {
      key: 'actions',
      label: '',
      width: '160px',
      align: 'right',
      render: (_value, row) => {
        const asset = row.asset as BrowseAsset;
        const url = assetUrl(asset);
        const isSvg = asset.contentType.includes('svg');
        const canCompress = Boolean(url) && !isSvg && !asset.richTextOnly;
        return (
          <div className="flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
            {quotaWrap(
              quotaLocked,
              quotaReason,
              <IconButton
                icon={Sparkles}
                label="Generate alt text"
                size="sm"
                variant="solid"
                disabled={quotaLocked || actionBusy(asset.id, 'alt') || !url}
                onClick={() => onGenerateAlt(asset)}
              />,
            )}
            <IconButton
              icon={Minimize2}
              label="Compress image"
              size="sm"
              variant="solid"
              disabled={actionBusy(asset.id, 'compress') || !canCompress}
              onClick={() => onCompress(asset)}
            />
            {quotaWrap(
              quotaLocked,
              quotaReason,
              <IconButton
                icon={Wand2}
                label="Draft smart name"
                size="sm"
                variant="solid"
                disabled={quotaLocked || actionBusy(asset.id, 'rename') || !url}
                onClick={() => onSmartRename(asset)}
              />,
            )}
            {url && (
              <IconButton
                icon={ExternalLink}
                label="Open asset in new tab"
                size="sm"
                variant="ghost"
                onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
              />
            )}
          </div>
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowKey={(row) => String(row.id)}
      onRowClick={(row) => onOpenAsset(String(row.id))}
      empty="No assets match this view"
      style={{ minWidth: '980px' }}
    />
  );
}

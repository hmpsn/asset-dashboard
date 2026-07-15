// @ds-rebuilt
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Copy, ExternalLink, Loader2, Minimize2, Sparkles, Trash2, Wand2 } from 'lucide-react';
import {
  Badge,
  Button,
  DefinitionList,
  Drawer,
  FormInput,
  FormTextarea,
  Icon,
  InlineBanner,
  Toolbar,
  ToolbarSpacer,
  Tooltip,
} from '../ui';
import { formatBytes } from '../../utils/formatNumbers';
import { formatDate } from '../../utils/formatDates';
import type { BrowseAsset } from './types';

interface AssetDrawerProps {
  asset: BrowseAsset | null;
  open: boolean;
  quotaLocked: boolean;
  quotaReason: string;
  altDraft: string;
  renameDraft: string;
  savingAlt: boolean;
  generatingAlt: boolean;
  compressing: boolean;
  renaming: boolean;
  deleting: boolean;
  onAltDraftChange: (value: string) => void;
  onRenameDraftChange: (value: string) => void;
  onSaveAlt: (asset: BrowseAsset) => void;
  onGenerateAlt: (asset: BrowseAsset) => void;
  onCompress: (asset: BrowseAsset) => void;
  onSmartRename: (asset: BrowseAsset) => void;
  onSaveRename: (asset: BrowseAsset) => void;
  onRequestDelete: (asset: BrowseAsset) => void;
  onClose: () => void;
}

function assetName(asset: BrowseAsset): string {
  return asset.displayName || asset.originalFileName || asset.id;
}

function assetUrl(asset: BrowseAsset): string | undefined {
  return asset.hostedUrl || asset.url;
}

function dimensionLabel(asset: BrowseAsset): string {
  if (asset.width && asset.height) return `${asset.width} x ${asset.height}`;
  return 'Pending';
}

function AiAction({
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

export function AssetDrawer({
  asset,
  open,
  quotaLocked,
  quotaReason,
  altDraft,
  renameDraft,
  savingAlt,
  generatingAlt,
  compressing,
  renaming,
  deleting,
  onAltDraftChange,
  onRenameDraftChange,
  onSaveAlt,
  onGenerateAlt,
  onCompress,
  onSmartRename,
  onSaveRename,
  onRequestDelete,
  onClose,
}: AssetDrawerProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!asset) {
    return <Drawer open={open} onClose={onClose} title="Asset" />;
  }

  const url = assetUrl(asset);
  const isSvg = asset.contentType.includes('svg');
  const canCompress = Boolean(url) && !isSvg && !asset.richTextOnly;
  const canGenerateAlt = Boolean(url);
  const name = assetName(asset);

  const copyUrl = () => {
    if (!url) return;
    void navigator.clipboard.writeText(url);
    setCopied(true);
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={name}
      subtitle={asset.altText || 'No alt text yet'}
      eyebrow="Asset detail"
      width={560}
      footer={(
        <Toolbar label="Asset detail actions" className="w-full border-none bg-transparent p-0">
          {url && (
            <Button size="sm" variant="secondary" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>
              <Icon as={ExternalLink} size="sm" />
              Open
            </Button>
          )}
          {url && (
            <Button size="sm" variant="secondary" onClick={copyUrl}>
              <Icon as={Copy} size="sm" />
              {copied ? 'Copied' : 'Copy URL'}
            </Button>
          )}
          <ToolbarSpacer />
          <Button
            size="sm"
            variant="danger"
            loading={deleting}
            disabled={deleting}
            onClick={() => onRequestDelete(asset)}
          >
            <Icon as={Trash2} size="sm" />
            Delete
          </Button>
        </Toolbar>
      )}
    >
      <div className="flex flex-col gap-5">
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)]">
          <div className="flex min-h-[260px] items-center justify-center p-4">
            {url ? (
              <img src={url} alt="" className="max-h-[320px] max-w-full object-contain" loading="lazy" />
            ) : (
              <div className="t-caption text-[var(--brand-text-muted)]">No preview URL</div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {asset.unused && <Badge label="Unused" tone="red" variant="soft" size="sm" />}
          {asset.source === 'cms' && <Badge label="CMS" tone="blue" variant="soft" size="sm" />}
          {asset.richTextOnly && <Badge label="RichText only" tone="amber" variant="soft" size="sm" />}
          {asset.contentType && <Badge label={asset.contentType} tone="zinc" variant="soft" size="sm" />}
        </div>

        <DefinitionList
          items={[
            { label: 'Size', value: formatBytes(asset.size || 0) },
            { label: 'Dimensions', value: dimensionLabel(asset) },
            { label: 'Created', value: asset.createdOn ? formatDate(asset.createdOn) : '—' },
            { label: 'Asset ID', value: asset.id, mono: true },
          ]}
        />

        {asset.cmsUsages && asset.cmsUsages.length > 0 && (
          <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-4">
            <div className="mb-2 t-label text-[var(--brand-text-muted)]">CMS usage</div>
            <div className="flex flex-wrap gap-2">
              {asset.cmsUsages.map((usage) => (
                <Badge
                  key={`${usage.collectionId}:${usage.fieldSlug}:${usage.itemId}`}
                  label={`${usage.collectionName} / ${usage.fieldDisplayName}`}
                  tone={usage.fieldType === 'RichText' ? 'amber' : 'blue'}
                  variant="soft"
                  size="sm"
                />
              ))}
            </div>
          </div>
        )}

        <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-4">
          <div className="mb-2 t-label text-[var(--brand-text-muted)]">Alt text</div>
          <FormTextarea value={altDraft} onChange={onAltDraftChange} rows={4} placeholder="Describe the image for accessibility and SEO" />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" loading={savingAlt} disabled={savingAlt} onClick={() => onSaveAlt(asset)}>
              Save alt text
            </Button>
            <AiAction locked={quotaLocked} reason={quotaReason}>
              <Button
                size="sm"
                variant="secondary"
                loading={generatingAlt}
                disabled={quotaLocked || generatingAlt || !canGenerateAlt}
                onClick={() => onGenerateAlt(asset)}
              >
                {generatingAlt ? <Icon as={Loader2} size="sm" className="animate-spin" /> : <Icon as={Sparkles} size="sm" />}
                Generate with AI
              </Button>
            </AiAction>
          </div>
        </div>

        <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-4">
          <div className="mb-2 t-label text-[var(--brand-text-muted)]">File name</div>
          <FormInput value={renameDraft} onChange={onRenameDraftChange} placeholder="Asset display name" />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" loading={renaming} disabled={renaming || !renameDraft.trim()} onClick={() => onSaveRename(asset)}>
              Save name
            </Button>
            <AiAction locked={quotaLocked} reason={quotaReason}>
              <Button
                size="sm"
                variant="secondary"
                loading={renaming}
                disabled={quotaLocked || renaming || !canGenerateAlt}
                onClick={() => onSmartRename(asset)}
              >
                <Icon as={Wand2} size="sm" />
                Draft smart name
              </Button>
            </AiAction>
          </div>
        </div>

        <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-4">
          <div className="mb-2 t-label text-[var(--brand-text-muted)]">Optimization</div>
          {asset.richTextOnly ? (
            <InlineBanner tone="warning" title="Compression unavailable">
              RichText-only CMS images do not have a backing Webflow asset ID that can be replaced safely.
            </InlineBanner>
          ) : isSvg ? (
            <InlineBanner tone="info" title="SVG compression skipped">
              SVG assets are excluded from bitmap compression.
            </InlineBanner>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              loading={compressing}
              disabled={compressing || !canCompress}
              onClick={() => onCompress(asset)}
            >
              <Icon as={Minimize2} size="sm" />
              Compress image
            </Button>
          )}
        </div>
      </div>
    </Drawer>
  );
}

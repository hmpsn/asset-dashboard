/**
 * AssetCard — Individual asset row rendering with inline editing.
 * Extracted from AssetBrowser.tsx asset grid row.
 */
import {
  FileText, ExternalLink, Check, X, Loader2, Minimize2, Sparkles, Wand2, Database,
} from 'lucide-react';
import { Icon, cn } from '../ui';
import type { CmsImageUsage } from '../../../shared/types/cms-images';

interface Asset {
  id: string;
  displayName?: string;
  originalFileName?: string;
  size: number;
  contentType: string;
  url?: string;
  hostedUrl?: string;
  altText?: string;
  createdOn?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface AssetCardProps {
  asset: Asset;
  selected: boolean;
  editingAlt: boolean;
  altDraft: string;
  generatingAlt: boolean;
  compressing: boolean;
  renamingId: boolean;
  renameDraft: string;
  renameLoading: boolean;
  unusedFlag: boolean;
  cmsUsages?: CmsImageUsage[];
  compressDisabled?: boolean;
  onToggleSelect: (id: string) => void;
  onEditAlt: (assetId: string, currentAlt: string) => void;
  onCancelEditAlt: () => void;
  onSaveAlt: (assetId: string) => void;
  onAltDraftChange: (value: string) => void;
  onGenerateAlt: (asset: Asset) => void;
  onCompress: (asset: Asset) => void;
  onSmartRename: (asset: Asset) => void;
  onSaveRename: (assetId: string) => void;
  onCancelRename: () => void;
  onRenameDraftChange: (value: string) => void;
}

export function AssetCard({
  asset, selected, editingAlt, altDraft, generatingAlt, compressing,
  renamingId, renameDraft, renameLoading, unusedFlag, cmsUsages, compressDisabled,
  onToggleSelect, onEditAlt, onCancelEditAlt, onSaveAlt, onAltDraftChange,
  onGenerateAlt, onCompress, onSmartRename, onSaveRename, onCancelRename, onRenameDraftChange,
}: AssetCardProps) {
  // Summarize CMS usages: "Blog Posts → Body" or "2 collections" if multiple
  const cmsLabel = cmsUsages && cmsUsages.length > 0
    ? cmsUsages.length === 1
      ? `${cmsUsages[0].collectionName} → ${cmsUsages[0].fieldDisplayName}`
      : `${new Set(cmsUsages.map(u => u.collectionId)).size} CMS collections`
    : null;
  return (
    <div
      className={cn(
        'grid grid-cols-[32px_48px_1fr_200px_80px_100px] gap-3 px-3 py-2 rounded-[var(--radius-md)] items-center text-sm transition-colors',
        selected ? 'bg-[var(--surface-3)]/80' : 'hover:bg-[var(--surface-2)]/50',
      )}
    >
      <div>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(asset.id)}
          className="rounded"
        />
      </div>

      {/* Thumbnail */}
      <div className="w-10 h-10 rounded bg-[var(--surface-3)] overflow-hidden flex items-center justify-center">
        {asset.contentType?.includes('svg') ? (
          <Icon as={FileText} size="md" className="text-[var(--brand-text-muted)]" />
        ) : (
          <img
            src={asset.hostedUrl || asset.url}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
          />
        )}
      </div>

      {/* Name */}
      <div className="truncate text-[var(--brand-text)] flex items-center gap-1 min-w-0">
        {renamingId ? (
          <div className="flex items-center gap-1 w-full">
            <input
              type="text"
              value={renameDraft}
              onChange={e => onRenameDraftChange(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && onSaveRename(asset.id)}
              className="flex-1 min-w-0 px-2 py-1 bg-[var(--surface-3)] border border-teal-600 rounded text-xs focus:outline-none"
              autoFocus
            />
            <button onClick={() => onSaveRename(asset.id)} className="text-emerald-400/80 hover:text-emerald-300 shrink-0">
              <Icon as={Check} size="md" />
            </button>
            <button onClick={onCancelRename} className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] shrink-0">
              <Icon as={X} size="md" />
            </button>
          </div>
        ) : (
          <>
            <span className="truncate" title={asset.displayName || asset.originalFileName}>
              {asset.displayName || asset.originalFileName}
            </span>
            {(!asset.altText || asset.altText.trim() === '') && (
              <span className="shrink-0 px-1 py-0.5 rounded t-caption-sm font-semibold bg-amber-900/40 text-amber-400/80 leading-none">No Alt</span>
            )}
            {asset.size > 500 * 1024 && (
              <span className="shrink-0 px-1 py-0.5 rounded t-caption-sm font-semibold bg-orange-900/40 text-orange-400 leading-none">Oversized</span>
            )}
            {unusedFlag && (
              <span className="shrink-0 px-1 py-0.5 rounded t-caption-sm font-semibold bg-red-900/40 text-red-400/80 leading-none">Unused</span>
            )}
            {cmsLabel && (
              <span
                className="shrink-0 flex items-center gap-0.5 px-1 py-0.5 rounded t-caption-sm font-semibold bg-blue-900/40 text-blue-400 leading-none"
                title={`Used in CMS: ${cmsUsages!.map(u => `${u.collectionName} → ${u.fieldDisplayName} (${u.fieldType})`).join(', ')}`}
              >
                <Icon as={Database} size="sm" />
                {cmsLabel}
              </span>
            )}
            <button
              onClick={() => onSmartRename(asset)}
              disabled={renameLoading}
              className="shrink-0 p-0.5 rounded text-[var(--brand-text-muted)] hover:text-teal-400 transition-colors"
              title="Smart rename"
            >
              <Icon as={renameLoading ? Loader2 : Wand2} size="sm" className={renameLoading ? 'animate-spin' : ''} />
            </button>
          </>
        )}
      </div>

      {/* Alt text */}
      <div className="truncate">
        {editingAlt ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={altDraft}
              onChange={e => onAltDraftChange(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && onSaveAlt(asset.id)}
              className="flex-1 px-2 py-1 bg-[var(--surface-3)] border border-[var(--brand-border-hover)] rounded text-xs focus:outline-none"
              autoFocus
            />
            <button onClick={() => onSaveAlt(asset.id)} className="text-emerald-400/80 hover:text-emerald-300">
              <Icon as={Check} size="md" />
            </button>
            <button onClick={onCancelEditAlt} className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]">
              <Icon as={X} size="md" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => onEditAlt(asset.id, asset.altText || '')}
            className={cn(
              'truncate text-left text-xs w-full',
              asset.altText ? 'text-[var(--brand-text)]' : 'text-amber-500/70 italic',
            )}
            title={asset.altText || 'Click to add alt text'}
          >
            {asset.altText || 'No alt text'}
          </button>
        )}
      </div>

      {/* Size */}
      <div className={cn('text-right text-xs', asset.size > 500 * 1024 ? 'text-orange-400' : 'text-[var(--brand-text-muted)]')}>
        {asset.size > 0 ? formatSize(asset.size) : '—'}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 justify-end">
        <button
          onClick={() => onGenerateAlt(asset)}
          disabled={generatingAlt}
          className="p-1.5 rounded text-[var(--brand-text-muted)] hover:text-teal-400 hover:bg-[var(--surface-3)] transition-colors"
          title="Generate alt text with AI"
        >
          <Icon as={generatingAlt ? Loader2 : Sparkles} size="md" className={generatingAlt ? 'animate-spin' : ''} />
        </button>
        {asset.size > 0 && (
          <button
            onClick={() => !compressDisabled && onCompress(asset)}
            disabled={compressing || compressDisabled}
            className={cn(
              'p-1.5 rounded transition-colors',
              compressDisabled ? 'text-[var(--brand-text-dim)] cursor-not-allowed' : 'text-[var(--brand-text-muted)] hover:text-blue-400 hover:bg-[var(--surface-3)]',
            )}
            title={compressDisabled ? 'Compress unavailable for inline RichText images' : 'Compress image'}
          >
            <Icon as={compressing ? Loader2 : Minimize2} size="md" className={compressing ? 'animate-spin' : ''} />
          </button>
        )}
        <a
          href={asset.hostedUrl || asset.url}
          target="_blank"
          rel="noopener"
          className="p-1.5 rounded text-[var(--brand-text-muted)] hover:text-blue-400 hover:bg-[var(--surface-3)] transition-colors"
          title="Open in new tab"
        >
          <Icon as={ExternalLink} size="md" />
        </a>
      </div>
    </div>
  );
}

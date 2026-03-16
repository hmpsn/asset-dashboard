/**
 * AssetCard — Individual asset row rendering with inline editing.
 * Extracted from AssetBrowser.tsx asset grid row.
 */
import {
  FileText, ExternalLink, Check, X, Loader2, Minimize2, Sparkles, Wand2,
} from 'lucide-react';

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
  renamingId, renameDraft, renameLoading, unusedFlag,
  onToggleSelect, onEditAlt, onCancelEditAlt, onSaveAlt, onAltDraftChange,
  onGenerateAlt, onCompress, onSmartRename, onSaveRename, onCancelRename, onRenameDraftChange,
}: AssetCardProps) {
  return (
    <div
      className={`grid grid-cols-[32px_48px_1fr_200px_80px_100px] gap-3 px-3 py-2 rounded-lg items-center text-sm transition-colors ${
        selected ? 'bg-zinc-800/80' : 'hover:bg-zinc-900/50'
      }`}
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
      <div className="w-10 h-10 rounded bg-zinc-800 overflow-hidden flex items-center justify-center">
        {asset.contentType?.includes('svg') ? (
          <FileText className="w-4 h-4 text-zinc-500" />
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
      <div className="truncate text-zinc-300 flex items-center gap-1 min-w-0">
        {renamingId ? (
          <div className="flex items-center gap-1 w-full">
            <input
              type="text"
              value={renameDraft}
              onChange={e => onRenameDraftChange(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && onSaveRename(asset.id)}
              className="flex-1 min-w-0 px-2 py-1 bg-zinc-800 border border-cyan-600 rounded text-xs focus:outline-none"
              autoFocus
            />
            <button onClick={() => onSaveRename(asset.id)} className="text-green-400 hover:text-green-300 shrink-0">
              <Check className="w-3.5 h-3.5" />
            </button>
            <button onClick={onCancelRename} className="text-zinc-500 hover:text-zinc-300 shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <>
            <span className="truncate" title={asset.displayName || asset.originalFileName}>
              {asset.displayName || asset.originalFileName}
            </span>
            {(!asset.altText || asset.altText.trim() === '') && (
              <span className="shrink-0 px-1 py-0.5 rounded text-[11px] font-semibold bg-amber-900/40 text-amber-400 leading-none">No Alt</span>
            )}
            {asset.size > 500 * 1024 && (
              <span className="shrink-0 px-1 py-0.5 rounded text-[11px] font-semibold bg-orange-900/40 text-orange-400 leading-none">Oversized</span>
            )}
            {unusedFlag && (
              <span className="shrink-0 px-1 py-0.5 rounded text-[11px] font-semibold bg-red-900/40 text-red-400 leading-none">Unused</span>
            )}
            <button
              onClick={() => onSmartRename(asset)}
              disabled={renameLoading}
              className="shrink-0 p-0.5 rounded text-zinc-500 hover:text-cyan-400 transition-colors"
              title="Smart rename"
            >
              {renameLoading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Wand2 className="w-3 h-3" />
              )}
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
              className="flex-1 px-2 py-1 bg-zinc-800 border border-zinc-600 rounded text-xs focus:outline-none"
              autoFocus
            />
            <button onClick={() => onSaveAlt(asset.id)} className="text-green-400 hover:text-green-300">
              <Check className="w-3.5 h-3.5" />
            </button>
            <button onClick={onCancelEditAlt} className="text-zinc-500 hover:text-zinc-300">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => onEditAlt(asset.id, asset.altText || '')}
            className={`truncate text-left text-xs w-full ${
              asset.altText ? 'text-zinc-400' : 'text-amber-500/70 italic'
            }`}
            title={asset.altText || 'Click to add alt text'}
          >
            {asset.altText || 'No alt text'}
          </button>
        )}
      </div>

      {/* Size */}
      <div className={`text-right text-xs ${asset.size > 500 * 1024 ? 'text-orange-400' : 'text-zinc-500'}`}>
        {asset.size > 0 ? formatSize(asset.size) : '—'}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 justify-end">
        <button
          onClick={() => onGenerateAlt(asset)}
          disabled={generatingAlt}
          className="p-1.5 rounded text-zinc-500 hover:text-teal-400 hover:bg-zinc-800 transition-colors"
          title="Generate alt text with AI"
        >
          {generatingAlt ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
        </button>
        {asset.size > 0 && (
          <button
            onClick={() => onCompress(asset)}
            disabled={compressing}
            className="p-1.5 rounded text-zinc-500 hover:text-blue-400 hover:bg-zinc-800 transition-colors"
            title="Compress image"
          >
            {compressing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Minimize2 className="w-3.5 h-3.5" />
            )}
          </button>
        )}
        <a
          href={asset.hostedUrl || asset.url}
          target="_blank"
          rel="noopener"
          className="p-1.5 rounded text-zinc-500 hover:text-blue-400 hover:bg-zinc-800 transition-colors"
          title="Open in new tab"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}

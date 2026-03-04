import { useState, useEffect, useRef } from 'react';
import {
  Search, Image, AlertTriangle, Trash2, Sparkles, Check, X,
  FileText, ExternalLink, ChevronDown, Loader2, Minimize2, Wand2,
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

interface Props {
  siteId: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type SortField = 'fileName' | 'fileSize' | 'createdOn';
type FilterType = 'all' | 'missing-alt' | 'oversized' | 'images' | 'svg' | 'unused';

function AssetBrowser({ siteId }: Props) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [sort, setSort] = useState<SortField>('createdOn');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingAlt, setEditingAlt] = useState<string | null>(null);
  const [altDraft, setAltDraft] = useState('');
  const [generatingAlt, setGeneratingAlt] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [lastGenerated, setLastGenerated] = useState<string | null>(null);
  const [compressing, setCompressing] = useState<Set<string>>(new Set());
  const [compressResult, setCompressResult] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameLoading, setRenameLoading] = useState<Set<string>>(new Set());
  const [bulkRenameProgress, setBulkRenameProgress] = useState<{ done: number; total: number } | null>(null);
  const [unusedIds, setUnusedIds] = useState<Set<string> | null>(null);
  const unusedLoadingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/webflow/assets/${siteId}`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setAssets(Array.isArray(data) ? data : []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [siteId]);

  // Lazy-load unused data when filter is selected
  useEffect(() => {
    if (filter !== 'unused' || unusedIds || unusedLoadingRef.current) return;
    unusedLoadingRef.current = true;
    fetch(`/api/webflow/audit/${siteId}`)
      .then(r => r.json())
      .then(data => {
        const ids = new Set<string>(
          (data.issues || []).filter((i: { issues: string[] }) => i.issues.includes('unused')).map((i: { assetId: string }) => i.assetId)
        );
        setUnusedIds(ids);
      })
      .catch(() => {})
      .finally(() => { unusedLoadingRef.current = false; });
  }, [filter, unusedIds, siteId]);

  const filtered = assets
    .filter(a => {
      if (search) {
        const q = search.toLowerCase();
        const name = a.displayName || a.originalFileName || '';
        if (!name.toLowerCase().includes(q) && !(a.altText || '').toLowerCase().includes(q)) return false;
      }
      if (filter === 'missing-alt') return !a.altText || a.altText.trim() === '';
      if (filter === 'oversized') return a.size > 500 * 1024;
      if (filter === 'images') return a.contentType?.startsWith('image/') && !a.contentType?.includes('svg');
      if (filter === 'svg') return a.contentType?.includes('svg');
      if (filter === 'unused') return unusedIds ? unusedIds.has(a.id) : false;
      return true;
    })
    .sort((a, b) => {
      if (sort === 'fileSize') return b.size - a.size;
      if (sort === 'fileName') return (a.displayName || '').localeCompare(b.displayName || '');
      return (b.createdOn || '').localeCompare(a.createdOn || '');
    });

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(a => a.id)));
    }
  };

  const handleSaveAlt = async (assetId: string) => {
    await fetch(`/api/webflow/assets/${assetId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ altText: altDraft }),
    });
    setAssets(prev => prev.map(a => a.id === assetId ? { ...a, altText: altDraft } : a));
    setEditingAlt(null);
  };

  const handleGenerateAlt = async (asset: Asset) => {
    const url = asset.hostedUrl || asset.url;
    if (!url) return;

    setGeneratingAlt(prev => new Set(prev).add(asset.id));
    try {
      const res = await fetch(`/api/webflow/generate-alt/${asset.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: url, siteId }),
      });
      const data = await res.json();
      if (data.altText) {
        setAssets(prev => prev.map(a => a.id === asset.id ? { ...a, altText: data.altText } : a));
        setLastGenerated(data.altText);
        setTimeout(() => setLastGenerated(null), 3000);
      }
    } catch { /* ignore */ }
    setGeneratingAlt(prev => { const n = new Set(prev); n.delete(asset.id); return n; });
  };

  const handleBulkGenerateAlt = async () => {
    const toGenerate = filtered.filter(a => selected.has(a.id) && (!a.altText || a.altText.trim() === ''));
    setBulkProgress({ done: 0, total: toGenerate.length });
    for (let i = 0; i < toGenerate.length; i++) {
      await handleGenerateAlt(toGenerate[i]);
      setBulkProgress({ done: i + 1, total: toGenerate.length });
    }
    setBulkProgress(null);
  };

  const handleCompress = async (asset: Asset) => {
    const url = asset.hostedUrl || asset.url;
    if (!url) return;
    setCompressing(prev => new Set(prev).add(asset.id));
    try {
      const res = await fetch(`/api/webflow/compress/${asset.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: url,
          siteId,
          altText: asset.altText,
          fileName: asset.displayName || asset.originalFileName,
        }),
      });
      const data = await res.json();
      if (data.success) {
        // Replace the asset in our list
        setAssets(prev => prev.map(a => a.id === asset.id ? {
          ...a,
          id: data.newAssetId,
          size: data.newSize,
          hostedUrl: data.newHostedUrl,
          displayName: data.newFileName,
        } : a));
        setCompressResult(`Saved ${data.savingsPercent}% (${formatSize(data.savings)})`);
        setTimeout(() => setCompressResult(null), 4000);
      } else if (data.skipped) {
        setCompressResult(data.reason || 'Already optimized');
        setTimeout(() => setCompressResult(null), 3000);
      }
    } catch { /* ignore */ }
    setCompressing(prev => { const n = new Set(prev); n.delete(asset.id); return n; });
  };

  const handleSmartRename = async (asset: Asset) => {
    setRenameLoading(prev => new Set(prev).add(asset.id));
    try {
      const res = await fetch('/api/smart-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalName: asset.displayName || asset.originalFileName || '',
          altText: asset.altText,
          contentType: asset.contentType,
        }),
      });
      const data = await res.json();
      if (data.fullName) {
        setRenamingId(asset.id);
        setRenameDraft(data.fullName);
      }
    } catch { /* ignore */ }
    setRenameLoading(prev => { const n = new Set(prev); n.delete(asset.id); return n; });
  };

  const handleSaveRename = async (assetId: string) => {
    if (!renameDraft.trim()) return;
    try {
      await fetch(`/api/webflow/rename/${assetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: renameDraft.trim() }),
      });
      setAssets(prev => prev.map(a => a.id === assetId ? { ...a, displayName: renameDraft.trim() } : a));
    } catch { /* ignore */ }
    setRenamingId(null);
    setRenameDraft('');
  };

  const handleBulkRename = async () => {
    const toRename = filtered.filter(a => selected.has(a.id));
    setBulkRenameProgress({ done: 0, total: toRename.length });
    for (let i = 0; i < toRename.length; i++) {
      const asset = toRename[i];
      setRenameLoading(prev => new Set(prev).add(asset.id));
      try {
        const res = await fetch('/api/smart-name', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            originalName: asset.displayName || asset.originalFileName || '',
            altText: asset.altText,
            contentType: asset.contentType,
          }),
        });
        const data = await res.json();
        if (data.fullName) {
          await fetch(`/api/webflow/rename/${asset.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ displayName: data.fullName }),
          });
          setAssets(prev => prev.map(a => a.id === asset.id ? { ...a, displayName: data.fullName } : a));
        }
      } catch { /* ignore */ }
      setRenameLoading(prev => { const n = new Set(prev); n.delete(asset.id); return n; });
      setBulkRenameProgress({ done: i + 1, total: toRename.length });
    }
    setBulkRenameProgress(null);
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} assets permanently from Webflow?`)) return;
    setDeleting(true);
    await fetch('/api/webflow/assets/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetIds: [...selected] }),
    });
    setAssets(prev => prev.filter(a => !selected.has(a.id)));
    setSelected(new Set());
    setDeleting(false);
  };

  const missingAltCount = assets.filter(a => !a.altText || a.altText.trim() === '').length;
  const oversizedCount = assets.filter(a => a.size > 500 * 1024).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-zinc-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading assets...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="flex items-center gap-4 text-sm">
        <span className="text-zinc-400">{assets.length} assets</span>
        {missingAltCount > 0 && (
          <span className="text-amber-400 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> {missingAltCount} missing alt
          </span>
        )}
        {oversizedCount > 0 && (
          <span className="text-orange-400 flex items-center gap-1">
            <Image className="w-3.5 h-3.5" /> {oversizedCount} oversized
          </span>
        )}
      </div>

      {/* Progress banner */}
      {bulkProgress && (
        <div className="flex items-center gap-3 px-4 py-3 bg-teal-950/50 border border-teal-800/50 rounded-lg">
          <Loader2 className="w-4 h-4 animate-spin text-teal-400" />
          <div className="flex-1">
            <div className="text-sm text-teal-200">
              Generating alt text... {bulkProgress.done}/{bulkProgress.total}
            </div>
            <div className="mt-1.5 h-1.5 bg-teal-950 rounded-full overflow-hidden">
              <div
                className="h-full bg-teal-500 rounded-full transition-all duration-300"
                style={{ width: `${(bulkProgress.done / bulkProgress.total) * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Success toast */}
      {lastGenerated && !bulkProgress && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-950/50 border border-emerald-800/50 rounded-lg text-sm text-emerald-300 animate-in fade-in">
          <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="truncate">{lastGenerated}</span>
        </div>
      )}

      {/* Compress result toast */}
      {compressResult && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-blue-950/50 border border-blue-800/50 rounded-lg text-sm text-blue-300 animate-in fade-in">
          <Minimize2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span>{compressResult}</span>
        </div>
      )}

      {/* Bulk rename progress */}
      {bulkRenameProgress && (
        <div className="flex items-center gap-3 px-4 py-3 bg-cyan-950/50 border border-cyan-800/50 rounded-lg">
          <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
          <div className="flex-1">
            <div className="text-sm text-cyan-200">
              Renaming assets... {bulkRenameProgress.done}/{bulkRenameProgress.total}
            </div>
            <div className="mt-1.5 h-1.5 bg-cyan-950 rounded-full overflow-hidden">
              <div
                className="h-full bg-cyan-500 rounded-full transition-all duration-300"
                style={{ width: `${(bulkRenameProgress.done / bulkRenameProgress.total) * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 sticky top-0 z-10 bg-zinc-950/95 backdrop-blur-sm py-2 -mx-1 px-1">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or alt text..."
            className="w-full pl-10 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-600"
          />
        </div>

        <div className="relative">
          <select
            value={filter}
            onChange={e => setFilter(e.target.value as FilterType)}
            className="appearance-none pl-3 pr-8 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm focus:outline-none cursor-pointer"
          >
            <option value="all">All</option>
            <option value="missing-alt">Missing Alt</option>
            <option value="oversized">Oversized</option>
            <option value="images">Images</option>
            <option value="svg">SVG</option>
            <option value="unused">Unused</option>
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
        </div>

        <div className="relative">
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortField)}
            className="appearance-none pl-3 pr-8 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm focus:outline-none cursor-pointer"
          >
            <option value="createdOn">Newest</option>
            <option value="fileName">Name</option>
            <option value="fileSize">Size</option>
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
        </div>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-zinc-900 border border-zinc-700 rounded-lg text-sm sticky top-0 z-20 shadow-lg shadow-black/30">
          <span className="text-zinc-300 font-medium">{selected.size} selected</span>
          <button
            onClick={handleBulkGenerateAlt}
            disabled={!!bulkProgress}
            className="flex items-center gap-1.5 px-3 py-1 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs font-medium transition-colors"
          >
            {bulkProgress ? (
              <><Loader2 className="w-3 h-3 animate-spin" /> {bulkProgress.done}/{bulkProgress.total}</>
            ) : (
              <><Sparkles className="w-3 h-3" /> Generate Alt Text</>
            )}
          </button>
          <button
            onClick={handleBulkRename}
            disabled={!!bulkRenameProgress}
            className="flex items-center gap-1.5 px-3 py-1 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs font-medium transition-colors"
          >
            {bulkRenameProgress ? (
              <><Loader2 className="w-3 h-3 animate-spin" /> {bulkRenameProgress.done}/{bulkRenameProgress.total}</>
            ) : (
              <><Wand2 className="w-3 h-3" /> Smart Rename</>
            )}
          </button>
          <button
            onClick={handleBulkDelete}
            disabled={deleting}
            className="flex items-center gap-1.5 px-3 py-1 bg-red-900/50 hover:bg-red-800 text-red-300 rounded text-xs font-medium transition-colors"
          >
            <Trash2 className="w-3 h-3" /> {deleting ? 'Deleting...' : 'Delete'}
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-zinc-500 hover:text-zinc-300 text-xs"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Asset grid */}
      <div className="space-y-1">
        {/* Header */}
        <div className="grid grid-cols-[32px_48px_1fr_200px_80px_100px] gap-3 px-3 py-2 text-xs text-zinc-500 font-medium">
          <div>
            <input
              type="checkbox"
              checked={selected.size === filtered.length && filtered.length > 0}
              onChange={selectAll}
              className="rounded"
            />
          </div>
          <div></div>
          <div>Filename</div>
          <div>Alt Text</div>
          <div className="text-right">Size</div>
          <div></div>
        </div>

        {/* Rows */}
        {filtered.map(asset => (
          <div
            key={asset.id}
            className={`grid grid-cols-[32px_48px_1fr_200px_80px_100px] gap-3 px-3 py-2 rounded-lg items-center text-sm transition-colors ${
              selected.has(asset.id) ? 'bg-zinc-800/80' : 'hover:bg-zinc-900/50'
            }`}
          >
            <div>
              <input
                type="checkbox"
                checked={selected.has(asset.id)}
                onChange={() => toggleSelect(asset.id)}
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
              {renamingId === asset.id ? (
                <div className="flex items-center gap-1 w-full">
                  <input
                    type="text"
                    value={renameDraft}
                    onChange={e => setRenameDraft(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSaveRename(asset.id)}
                    className="flex-1 min-w-0 px-2 py-1 bg-zinc-800 border border-cyan-600 rounded text-xs focus:outline-none"
                    autoFocus
                  />
                  <button onClick={() => handleSaveRename(asset.id)} className="text-green-400 hover:text-green-300 shrink-0">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => { setRenamingId(null); setRenameDraft(''); }} className="text-zinc-500 hover:text-zinc-300 shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <span className="truncate" title={asset.displayName || asset.originalFileName}>
                    {asset.displayName || asset.originalFileName}
                  </span>
                  <button
                    onClick={() => handleSmartRename(asset)}
                    disabled={renameLoading.has(asset.id)}
                    className="shrink-0 p-0.5 rounded text-zinc-600 hover:text-cyan-400 transition-colors"
                    title="Smart rename"
                  >
                    {renameLoading.has(asset.id) ? (
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
              {editingAlt === asset.id ? (
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={altDraft}
                    onChange={e => setAltDraft(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSaveAlt(asset.id)}
                    className="flex-1 px-2 py-1 bg-zinc-800 border border-zinc-600 rounded text-xs focus:outline-none"
                    autoFocus
                  />
                  <button onClick={() => handleSaveAlt(asset.id)} className="text-green-400 hover:text-green-300">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setEditingAlt(null)} className="text-zinc-500 hover:text-zinc-300">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setEditingAlt(asset.id); setAltDraft(asset.altText || ''); }}
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
                onClick={() => handleGenerateAlt(asset)}
                disabled={generatingAlt.has(asset.id)}
                className="p-1.5 rounded text-zinc-500 hover:text-teal-400 hover:bg-zinc-800 transition-colors"
                title="Generate alt text with AI"
              >
                {generatingAlt.has(asset.id) ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
              </button>
              {asset.size > 0 && (
                <button
                  onClick={() => handleCompress(asset)}
                  disabled={compressing.has(asset.id)}
                  className="p-1.5 rounded text-zinc-500 hover:text-blue-400 hover:bg-zinc-800 transition-colors"
                  title="Compress image"
                >
                  {compressing.has(asset.id) ? (
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
        ))}

        {filtered.length === 0 && (
          <div className="text-center py-10 text-zinc-600 text-sm">
            {search ? 'No assets match your search' : 'No assets found'}
          </div>
        )}
      </div>
    </div>
  );
}

export { AssetBrowser };

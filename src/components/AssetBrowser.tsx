import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Search, Image, AlertTriangle, Trash2, Sparkles, Check, X,
  FileText, ExternalLink, ChevronDown, Loader2, Minimize2, Wand2, FolderOpen,
} from 'lucide-react';
import { useBackgroundTasks } from '../hooks/useBackgroundTasks';

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
  const { startJob, jobs } = useBackgroundTasks();
  const bulkCompressJobId = useRef<string | null>(null);
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
  const [bulkCompressProgress, setBulkCompressProgress] = useState<{ done: number; total: number; saved: number } | null>(null);
  const [unusedIds, setUnusedIds] = useState<Set<string> | null>(null);
  const [altError, setAltError] = useState<string | null>(null);
  const unusedLoadingRef = useRef(false);

  // Organize state
  const [organizePreview, setOrganizePreview] = useState<{
    foldersToCreate: string[];
    moves: Array<{ assetId: string; assetName: string; targetFolder: string }>;
    summary: { totalAssets: number; assetsToMove: number; foldersToCreate: number; alreadyOrganized: number; unused: number; shared: number; ogImages: number };
  } | null>(null);
  const [organizeLoading, setOrganizeLoading] = useState(false);
  const [organizeExecuting, setOrganizeExecuting] = useState(false);
  const [organizeResult, setOrganizeResult] = useState<{ moved: number; failed: number; total: number } | null>(null);

  const loadAssets = useCallback(() => {
    fetch(`/api/webflow/assets/${siteId}`)
      .then(r => r.json())
      .then(data => setAssets(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [siteId]);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  // Load unused asset IDs in background after assets load
  useEffect(() => {
    if (assets.length === 0 || unusedIds || unusedLoadingRef.current) return;
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
  }, [assets.length, unusedIds, siteId]);

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
    setAltError(null);
    try {
      const res = await fetch(`/api/webflow/assets/${assetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ altText: altDraft, siteId }),
      });
      const data = await res.json();
      if (!data.success) {
        setAltError(`Failed to save alt text: ${data.error || 'Unknown error'}`);
        return;
      }
      setAssets(prev => prev.map(a => a.id === assetId ? { ...a, altText: altDraft } : a));
      setEditingAlt(null);
    } catch {
      setAltError('Network error saving alt text');
    }
  };

  const handleGenerateAlt = async (asset: Asset) => {
    const url = asset.hostedUrl || asset.url;
    if (!url) return;

    setAltError(null);
    setGeneratingAlt(prev => new Set(prev).add(asset.id));
    try {
      const res = await fetch(`/api/webflow/generate-alt/${asset.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: url, siteId }),
      });
      const data = await res.json();
      if (data.error) {
        setAltError(`Alt text generation failed: ${data.error}`);
      } else if (data.altText) {
        setAssets(prev => prev.map(a => a.id === asset.id ? { ...a, altText: data.altText } : a));
        if (data.writeError) {
          setAltError(`Alt text generated but failed to save to Webflow: ${data.writeError}`);
        } else {
          setLastGenerated(data.altText);
          setTimeout(() => setLastGenerated(null), 3000);
        }
      }
    } catch {
      setAltError('Network error generating alt text');
    }
    setGeneratingAlt(prev => { const n = new Set(prev); n.delete(asset.id); return n; });
  };

  const handleBulkGenerateAlt = async () => {
    const toGenerate = filtered.filter(a => selected.has(a.id) && (!a.altText || a.altText.trim() === ''));
    if (!toGenerate.length) return;
    setBulkProgress({ done: 0, total: toGenerate.length });
    setAltError(null);

    try {
      const res = await fetch('/api/webflow/bulk-generate-alt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId,
          assets: toGenerate.map(a => ({
            assetId: a.id,
            imageUrl: a.hostedUrl || a.url,
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }));
        setAltError(`Bulk alt text failed: ${data.error || res.statusText}`);
        setBulkProgress(null);
        return;
      }

      // Stream NDJSON: read line-by-line as server processes each image
      const reader = res.body?.getReader();
      if (!reader) { setAltError('Streaming not supported'); setBulkProgress(null); return; }

      const decoder = new TextDecoder();
      let buffer = '';
      let successCount = 0;
      let failCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // keep incomplete last line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === 'result') {
              // Update progress bar
              setBulkProgress({ done: event.done, total: event.total });
              // Apply alt text immediately as each image completes
              if (event.altText) {
                setAssets(prev => prev.map(a =>
                  a.id === event.assetId ? { ...a, altText: event.altText } : a
                ));
                if (event.updated) successCount++;
                else failCount++;
              } else {
                failCount++;
              }
            } else if (event.type === 'status') {
              setBulkProgress({ done: event.done, total: event.total });
            }
          } catch { /* skip malformed line */ }
        }
      }

      if (failCount > 0) {
        setAltError(`${successCount} saved to Webflow, ${failCount} failed`);
      }
    } catch {
      setAltError('Network error during bulk alt text generation');
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
          imageUrl: asset.hostedUrl || asset.url,
          siteId,
          assetId: asset.id,
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
    setAltError(null);
    try {
      const res = await fetch(`/api/webflow/rename/${assetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: renameDraft.trim(), siteId }),
      });
      const data = await res.json();
      if (!data.success) {
        setAltError(`Rename failed: ${data.error || 'Unknown error'}`);
        return;
      }
      setAssets(prev => prev.map(a => a.id === assetId ? { ...a, displayName: renameDraft.trim() } : a));
    } catch {
      setAltError('Network error renaming asset');
    }
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
            imageUrl: asset.hostedUrl || asset.url,
            siteId,
            assetId: asset.id,
          }),
        });
        const data = await res.json();
        if (data.fullName) {
          await fetch(`/api/webflow/rename/${asset.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ displayName: data.fullName, siteId }),
          });
          setAssets(prev => prev.map(a => a.id === asset.id ? { ...a, displayName: data.fullName } : a));
        }
      } catch { /* ignore */ }
      setRenameLoading(prev => { const n = new Set(prev); n.delete(asset.id); return n; });
      setBulkRenameProgress({ done: i + 1, total: toRename.length });
    }
    setBulkRenameProgress(null);
  };

  const handleBulkCompress = async () => {
    const toCompress = filtered.filter(a => selected.has(a.id) && a.size > 50 * 1024 && !a.contentType.includes('svg'));
    if (!toCompress.length) return;
    setBulkCompressProgress({ done: 0, total: toCompress.length, saved: 0 });
    setAltError(null);
    const jobId = await startJob('bulk-compress', {
      siteId,
      assets: toCompress.map(a => ({
        assetId: a.id,
        imageUrl: a.hostedUrl || a.url,
        altText: a.altText,
        fileName: a.displayName || a.originalFileName,
      })),
    });
    if (jobId) {
      bulkCompressJobId.current = jobId;
    } else {
      setAltError('Failed to start bulk compress job');
      setBulkCompressProgress(null);
    }
  };

  // Watch for bulk compress job progress/completion
  useEffect(() => {
    if (!bulkCompressJobId.current) return;
    const job = jobs.find(j => j.id === bulkCompressJobId.current);
    if (!job) return;
    if (job.status === 'running' && job.progress != null && job.total) {
      setBulkCompressProgress({ done: job.progress, total: job.total, saved: 0 });
    } else if (job.status === 'done') {
      const result = job.result as { totalSaved?: number } | undefined;
      const saved = result?.totalSaved || 0;
      if (saved > 0) {
        setCompressResult(`Bulk compressed: saved ${formatSize(saved)} total`);
        setTimeout(() => setCompressResult(null), 5000);
      }
      setBulkCompressProgress(null);
      bulkCompressJobId.current = null;
      // Refresh asset list to pick up new asset IDs/sizes
      loadAssets();
    } else if (job.status === 'error') {
      setAltError(job.error || 'Bulk compress failed');
      setBulkCompressProgress(null);
      bulkCompressJobId.current = null;
    }
  }, [jobs, loadAssets]);

  const handleOrganizePreview = async () => {
    setOrganizeLoading(true);
    setOrganizePreview(null);
    setOrganizeResult(null);
    try {
      const res = await fetch(`/api/webflow/organize-preview/${siteId}`);
      const data = await res.json();
      if (data.error) {
        setAltError(`Organize failed: ${data.error}`);
      } else {
        setOrganizePreview(data);
      }
    } catch {
      setAltError('Failed to load organization preview');
    }
    setOrganizeLoading(false);
  };

  const handleOrganizeExecute = async () => {
    if (!organizePreview) return;
    setOrganizeExecuting(true);
    try {
      const res = await fetch(`/api/webflow/organize-execute/${siteId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          moves: organizePreview.moves,
          foldersToCreate: organizePreview.foldersToCreate,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setAltError(`Organize failed: ${data.error}`);
      } else {
        setOrganizeResult(data.summary);
      }
    } catch {
      setAltError('Failed to execute organization');
    }
    setOrganizeExecuting(false);
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} assets permanently from Webflow?`)) return;
    setDeleting(true);
    await fetch('/api/webflow/assets/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetIds: [...selected], siteId }),
    });
    setAssets(prev => prev.filter(a => !selected.has(a.id)));
    setSelected(new Set());
    setDeleting(false);
  };

  const missingAltCount = assets.filter(a => !a.altText || a.altText.trim() === '').length;
  const oversizedCount = assets.filter(a => a.size > 500 * 1024).length;
  const unusedCount = unusedIds ? assets.filter(a => unusedIds.has(a.id)).length : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-zinc-500">
        <Loader2 className="w-5 h-5 animate-spin text-teal-400 mr-2" />
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
        {unusedCount > 0 && (
          <span className="text-red-400 flex items-center gap-1">
            <Trash2 className="w-3.5 h-3.5" /> {unusedCount} unused
          </span>
        )}
        <button
          onClick={handleOrganizePreview}
          disabled={organizeLoading}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-teal-600/20 hover:bg-teal-600/30 border border-teal-500/30 text-teal-300 disabled:opacity-50 rounded-lg text-xs font-medium transition-colors"
        >
          {organizeLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <FolderOpen className="w-3 h-3" />}
          Organize into Folders
        </button>
      </div>

      {/* Alt text error banner */}
      {altError && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-red-950/50 border border-red-800/50 rounded-lg text-sm text-red-300">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
          <span className="flex-1">{altError}</span>
          <button onClick={() => setAltError(null)} className="text-red-400 hover:text-red-300"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

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

      {/* Bulk compress progress */}
      {bulkCompressProgress && (
        <div className="flex items-center gap-3 px-4 py-3 bg-orange-950/50 border border-orange-800/50 rounded-lg">
          <Loader2 className="w-4 h-4 animate-spin text-orange-400" />
          <div className="flex-1">
            <div className="text-sm text-orange-200">
              Compressing assets... {bulkCompressProgress.done}/{bulkCompressProgress.total}
              {bulkCompressProgress.saved > 0 && <span className="text-orange-400 ml-2">({formatSize(bulkCompressProgress.saved)} saved)</span>}
            </div>
            <div className="mt-1.5 h-1.5 bg-orange-950 rounded-full overflow-hidden">
              <div
                className="h-full bg-orange-500 rounded-full transition-all duration-300"
                style={{ width: `${(bulkCompressProgress.done / bulkCompressProgress.total) * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Organize into Folders modal */}
      {organizePreview && !organizeResult && (
        <div className="p-4 bg-teal-950/40 border border-teal-800/50 rounded-lg space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-teal-200 flex items-center gap-2">
              <FolderOpen className="w-4 h-4" /> Organization Plan
            </h3>
            <button onClick={() => setOrganizePreview(null)} className="text-zinc-500 hover:text-zinc-300">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-zinc-900/60 rounded-lg p-2">
              <div className="text-lg font-bold text-teal-300">{organizePreview.summary.assetsToMove}</div>
              <div className="text-[11px] text-zinc-500">Assets to move</div>
            </div>
            <div className="bg-zinc-900/60 rounded-lg p-2">
              <div className="text-lg font-bold text-cyan-300">{organizePreview.summary.foldersToCreate}</div>
              <div className="text-[11px] text-zinc-500">New folders</div>
            </div>
            <div className="bg-zinc-900/60 rounded-lg p-2">
              <div className="text-lg font-bold text-zinc-400">{organizePreview.summary.alreadyOrganized}</div>
              <div className="text-[11px] text-zinc-500">Already organized</div>
            </div>
          </div>

          {/* Folder breakdown */}
          <div className="max-h-48 overflow-y-auto space-y-1 text-xs">
            {(() => {
              const byFolder = new Map<string, string[]>();
              for (const m of organizePreview.moves) {
                const list = byFolder.get(m.targetFolder) || [];
                list.push(m.assetName);
                byFolder.set(m.targetFolder, list);
              }
              return [...byFolder.entries()].sort((a, b) => b[1].length - a[1].length).map(([folder, assetNames]) => (
                <details key={folder} className="group">
                  <summary className="cursor-pointer flex items-center gap-2 px-2 py-1.5 bg-zinc-900/40 rounded hover:bg-zinc-900/60 transition-colors">
                    <FolderOpen className="w-3 h-3 text-teal-400 shrink-0" />
                    <span className="text-zinc-200 font-medium truncate">{folder}</span>
                    <span className="ml-auto text-zinc-500 shrink-0">{assetNames.length} assets</span>
                  </summary>
                  <div className="ml-7 mt-1 space-y-0.5 text-zinc-500">
                    {assetNames.slice(0, 10).map((name, i) => (
                      <div key={i} className="truncate">{name}</div>
                    ))}
                    {assetNames.length > 10 && <div className="text-zinc-500">...and {assetNames.length - 10} more</div>}
                  </div>
                </details>
              ));
            })()}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleOrganizeExecute}
              disabled={organizeExecuting}
              className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-lg text-xs font-semibold transition-colors"
            >
              {organizeExecuting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Organizing...</> : <><FolderOpen className="w-3.5 h-3.5" /> Apply Organization</>}
            </button>
            <button
              onClick={() => setOrganizePreview(null)}
              className="px-4 py-2 text-zinc-400 hover:text-zinc-200 text-xs transition-colors"
            >
              Cancel
            </button>
            {(organizePreview.summary.unused > 0 || organizePreview.summary.ogImages > 0) && (
              <span className="ml-auto text-[11px] text-zinc-500">
                {organizePreview.summary.ogImages > 0 && <>{organizePreview.summary.ogImages} OG images → _Social / OG Images</>}
                {organizePreview.summary.ogImages > 0 && organizePreview.summary.unused > 0 && ' · '}
                {organizePreview.summary.unused > 0 && <>{organizePreview.summary.unused} unused → _Unused Assets</>}
                {(organizePreview.summary.unused > 0 || organizePreview.summary.ogImages > 0) && organizePreview.summary.shared > 0 && ' · '}
                {organizePreview.summary.shared > 0 && <>{organizePreview.summary.shared} shared → _Shared Assets</>}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Organize result */}
      {organizeResult && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-teal-950/50 border border-teal-800/50 rounded-lg text-sm text-teal-300">
          <FolderOpen className="w-4 h-4 text-teal-400 shrink-0" />
          <span>Organized: {organizeResult.moved} moved{organizeResult.failed > 0 ? `, ${organizeResult.failed} failed` : ''} of {organizeResult.total} assets</span>
          <button onClick={() => { setOrganizeResult(null); setOrganizePreview(null); }} className="ml-auto text-teal-400 hover:text-teal-300">
            <X className="w-3.5 h-3.5" />
          </button>
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
            onClick={handleBulkCompress}
            disabled={!!bulkCompressProgress}
            className="flex items-center gap-1.5 px-3 py-1 bg-orange-700 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs font-medium transition-colors"
          >
            {bulkCompressProgress ? (
              <><Loader2 className="w-3 h-3 animate-spin" /> {bulkCompressProgress.done}/{bulkCompressProgress.total}</>
            ) : (
              <><Minimize2 className="w-3 h-3" /> Compress</>
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
                  {(!asset.altText || asset.altText.trim() === '') && (
                    <span className="shrink-0 px-1 py-0.5 rounded text-[11px] font-semibold bg-amber-900/40 text-amber-400 leading-none">No Alt</span>
                  )}
                  {asset.size > 500 * 1024 && (
                    <span className="shrink-0 px-1 py-0.5 rounded text-[11px] font-semibold bg-orange-900/40 text-orange-400 leading-none">Oversized</span>
                  )}
                  {unusedIds?.has(asset.id) && (
                    <span className="shrink-0 px-1 py-0.5 rounded text-[11px] font-semibold bg-red-900/40 text-red-400 leading-none">Unused</span>
                  )}
                  <button
                    onClick={() => handleSmartRename(asset)}
                    disabled={renameLoading.has(asset.id)}
                    className="shrink-0 p-0.5 rounded text-zinc-500 hover:text-cyan-400 transition-colors"
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
          <div className="text-center py-10 text-zinc-500 text-sm">
            {search ? 'No assets match your search' : 'No assets found'}
          </div>
        )}
      </div>
    </div>
  );
}

export { AssetBrowser };

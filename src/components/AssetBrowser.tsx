import { useState, useEffect, useRef, useMemo } from 'react';
import { get, post, patch } from '../api/client';
import { useQueryClient } from '@tanstack/react-query';
import { useWebflowAssets, useAssetAudit, useCmsImages } from '../hooks/admin';
import type { CmsImageUsage } from '../../shared/types/cms-images';
import {
  Image, AlertTriangle, Trash2, Sparkles, X,
  Loader2, Minimize2, FolderOpen, Search, Database,
} from 'lucide-react';
import { EmptyState } from './ui';
import { useBackgroundTasks } from '../hooks/useBackgroundTasks';
import { OrganizePreview } from './assets/OrganizePreview';
import { AssetFilters } from './assets/AssetFilters';
import { AssetCard } from './assets/AssetCard';
import { BulkActions } from './assets/BulkActions';
import { CmsFieldSelector, buildDefaultSelectedFields } from './assets/CmsFieldSelector';

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
type FilterType = 'all' | 'missing-alt' | 'oversized' | 'images' | 'svg' | 'unused' | 'used' | 'cms-images' | 'cms-missing-alt';

function AssetBrowser({ siteId }: Props) {
  const queryClient = useQueryClient();
  const { startJob, jobs } = useBackgroundTasks();
  const bulkCompressJobId = useRef<string | null>(null);
  const { data: assets = [], isLoading: loading } = useWebflowAssets(siteId);
  const { data: unusedIds = null } = useAssetAudit(siteId, assets.length > 0);
  const { data: cmsImageData } = useCmsImages(siteId, assets.length > 0);

  // Build a quick-lookup map: assetId → CmsImageUsage[]
  const cmsUsageMap = useMemo(() => {
    const map = new Map<string, CmsImageUsage[]>();
    if (cmsImageData) {
      for (const a of cmsImageData.assets) {
        map.set(a.assetId, a.usages);
      }
    }
    return map;
  }, [cmsImageData]);

  // CMS field selector state — which fields are included in filter + bulk ops
  const [selectedCmsFields, setSelectedCmsFields] = useState<Set<string>>(new Set());

  // Initialize selectedCmsFields with smart defaults when CMS data first loads
  useEffect(() => {
    if (cmsImageData?.collections && cmsImageData.collections.length > 0) {
      setSelectedCmsFields(prev => {
        // Only initialize if currently empty (first load)
        if (prev.size === 0) return buildDefaultSelectedFields(cmsImageData.collections);
        return prev;
      });
    }
  }, [cmsImageData]);

  const updateAssets = (updater: (prev: Asset[]) => Asset[]) =>
    queryClient.setQueryData<Asset[]>(['admin-webflow-assets', siteId], old => updater(old ?? []));
  const refreshAssets = () => queryClient.invalidateQueries({ queryKey: ['admin-webflow-assets', siteId] });
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
  const [altError, setAltError] = useState<string | null>(null);

  // Organize state
  const [organizePreview, setOrganizePreview] = useState<{
    foldersToCreate: string[];
    moves: Array<{ assetId: string; assetName: string; targetFolder: string }>;
    summary: { totalAssets: number; assetsToMove: number; foldersToCreate: number; alreadyOrganized: number; unused: number; shared: number; ogImages: number };
  } | null>(null);
  const [organizeLoading, setOrganizeLoading] = useState(false);
  const [organizeExecuting, setOrganizeExecuting] = useState(false);
  const [organizeResult, setOrganizeResult] = useState<{ moved: number; failed: number; total: number } | null>(null);


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
      if (filter === 'used') return unusedIds ? !unusedIds.has(a.id) : true;
      if (filter === 'cms-images' || filter === 'cms-missing-alt') {
        const usages = cmsUsageMap.get(a.id);
        if (!usages?.length) return false;
        // Check if asset is used in any selected field
        const inSelectedField = usages.some(u => selectedCmsFields.has(`${u.collectionId}:${u.fieldSlug}`));
        if (!inSelectedField) return false;
        if (filter === 'cms-missing-alt') return !a.altText || a.altText.trim() === '';
        return true;
      }
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
      const data = await patch<{ success?: boolean; error?: string }>(`/api/webflow/assets/${assetId}`, { altText: altDraft, siteId });
      if (!data.success) {
        setAltError(`Failed to save alt text: ${data.error || 'Unknown error'}`);
        return;
      }
      updateAssets(prev => prev.map(a => a.id === assetId ? { ...a, altText: altDraft } : a));
      setEditingAlt(null);
    } catch (err) {
      console.error('AssetBrowser operation failed:', err);
      setAltError('Network error saving alt text');
    }
  };

  const handleGenerateAlt = async (asset: Asset) => {
    const url = asset.hostedUrl || asset.url;
    if (!url) return;

    setAltError(null);
    setGeneratingAlt(prev => new Set(prev).add(asset.id));
    try {
      const data = await post<{ error?: string; altText?: string; writeError?: string }>(`/api/webflow/generate-alt/${asset.id}`, { imageUrl: url, siteId });
      if (data.error) {
        setAltError(`Alt text generation failed: ${data.error}`);
      } else if (data.altText) {
        updateAssets(prev => prev.map(a => a.id === asset.id ? { ...a, altText: data.altText } : a));
        if (data.writeError) {
          setAltError(`Alt text generated but failed to save to Webflow: ${data.writeError}`);
        } else {
          setLastGenerated(data.altText);
          setTimeout(() => setLastGenerated(null), 3000);
        }
      }
    } catch (err) {
      console.error('AssetBrowser operation failed:', err);
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
                updateAssets(prev => prev.map(a =>
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
          } catch (err) { console.error('AssetBrowser operation failed:', err); }
        }
      }

      if (failCount > 0) {
        setAltError(`${successCount} saved to Webflow, ${failCount} failed`);
      }
    } catch (err) {
      console.error('AssetBrowser operation failed:', err);
      setAltError('Network error during bulk alt text generation');
    }
    setBulkProgress(null);
  };

  const handleCompress = async (asset: Asset) => {
    const url = asset.hostedUrl || asset.url;
    if (!url) return;
    setCompressing(prev => new Set(prev).add(asset.id));
    try {
      const data = await post<{ success?: boolean; skipped?: boolean; reason?: string; newAssetId?: string; newSize?: number; newHostedUrl?: string; newFileName?: string; savingsPercent?: number; savings?: number; cmsUpdates?: { succeeded: number; failed: number } }>(`/api/webflow/compress/${asset.id}`, {
        imageUrl: url,
        siteId,
        altText: asset.altText,
        fileName: asset.displayName || asset.originalFileName,
        cmsUsages: (cmsUsageMap.get(asset.id) ?? []).filter(u =>
          selectedCmsFields.has(`${u.collectionId}:${u.fieldSlug}`)
        ),
      });
      if (data.success) {
        // Replace the asset in our list
        updateAssets(prev => prev.map(a => a.id === asset.id ? {
          ...a,
          id: data.newAssetId || a.id,
          size: data.newSize ?? a.size,
          hostedUrl: data.newHostedUrl,
          displayName: data.newFileName,
        } : a));
        const cmsNote = data.cmsUpdates?.succeeded ? ` · ${data.cmsUpdates.succeeded} CMS ref${data.cmsUpdates.succeeded !== 1 ? 's' : ''} updated` : '';
        setCompressResult(`Saved ${data.savingsPercent}% (${formatSize(data.savings)})${cmsNote}`);
        setTimeout(() => setCompressResult(null), 4000);
      } else if (data.skipped) {
        setCompressResult(data.reason || 'Already optimized');
        setTimeout(() => setCompressResult(null), 3000);
      }
    } catch (err) { console.error('AssetBrowser operation failed:', err); }
    setCompressing(prev => { const n = new Set(prev); n.delete(asset.id); return n; });
  };

  const handleSmartRename = async (asset: Asset) => {
    setRenameLoading(prev => new Set(prev).add(asset.id));
    try {
      const data = await post<{ fullName?: string }>('/api/smart-name', {
        originalName: asset.displayName || asset.originalFileName || '',
        altText: asset.altText,
        contentType: asset.contentType,
        imageUrl: asset.hostedUrl || asset.url,
        siteId,
        assetId: asset.id,
      });
      if (data.fullName) {
        setRenamingId(asset.id);
        setRenameDraft(data.fullName);
      }
    } catch (err) { console.error('AssetBrowser operation failed:', err); }
    setRenameLoading(prev => { const n = new Set(prev); n.delete(asset.id); return n; });
  };

  const handleSaveRename = async (assetId: string) => {
    if (!renameDraft.trim()) return;
    setAltError(null);
    try {
      const data = await patch<{ success?: boolean; error?: string }>(`/api/webflow/rename/${assetId}`, { displayName: renameDraft.trim(), siteId });
      if (!data.success) {
        setAltError(`Rename failed: ${data.error || 'Unknown error'}`);
        return;
      }
      updateAssets(prev => prev.map(a => a.id === assetId ? { ...a, displayName: renameDraft.trim() } : a));
    } catch (err) {
      console.error('AssetBrowser operation failed:', err);
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
        const data = await post<{ fullName?: string }>('/api/smart-name', {
          originalName: asset.displayName || asset.originalFileName || '',
          altText: asset.altText,
          contentType: asset.contentType,
          imageUrl: asset.hostedUrl || asset.url,
          siteId,
          assetId: asset.id,
        });
        if (data.fullName) {
          await patch(`/api/webflow/rename/${asset.id}`, { displayName: data.fullName, siteId });
          updateAssets(prev => prev.map(a => a.id === asset.id ? { ...a, displayName: data.fullName } : a));
        }
      } catch (err) { console.error('AssetBrowser operation failed:', err); }
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
        cmsUsages: (cmsUsageMap.get(a.id) ?? []).filter(u =>
          selectedCmsFields.has(`${u.collectionId}:${u.fieldSlug}`)
        ),
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
      refreshAssets();
    } else if (job.status === 'error') {
      setAltError(job.error || 'Bulk compress failed');
      setBulkCompressProgress(null);
      bulkCompressJobId.current = null;
    }
  }, [jobs]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOrganizePreview = async () => {
    setOrganizeLoading(true);
    setOrganizePreview(null);
    setOrganizeResult(null);
    try {
      const data = await get<{ error?: string; foldersToCreate?: string[]; moves?: Array<{ assetId: string; assetName: string; targetFolder: string }>; summary?: { totalAssets: number; assetsToMove: number; foldersToCreate: number; alreadyOrganized: number; unused: number; shared: number; ogImages: number } }>(`/api/webflow/organize-preview/${siteId}`);
      if (data.error) {
        setAltError(`Organize failed: ${data.error}`);
      } else {
        setOrganizePreview(data);
      }
    } catch (err) {
      console.error('AssetBrowser operation failed:', err);
      setAltError('Failed to load organization preview');
    }
    setOrganizeLoading(false);
  };

  const handleOrganizeExecute = async () => {
    if (!organizePreview) return;
    setOrganizeExecuting(true);
    try {
      const data = await post<{ error?: string; summary?: { moved: number; failed: number; total: number } }>(`/api/webflow/organize-execute/${siteId}`, {
        moves: organizePreview.moves,
        foldersToCreate: organizePreview.foldersToCreate,
      });
      if (data.error) {
        setAltError(`Organize failed: ${data.error}`);
      } else {
        setOrganizeResult(data.summary);
      }
    } catch (err) {
      console.error('AssetBrowser operation failed:', err);
      setAltError('Failed to execute organization');
    }
    setOrganizeExecuting(false);
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} assets permanently from Webflow?`)) return;
    setDeleting(true);
    await post('/api/webflow/assets/bulk-delete', { assetIds: [...selected], siteId });
    updateAssets(prev => prev.filter(a => !selected.has(a.id)));
    setSelected(new Set());
    setDeleting(false);
  };

  const missingAltCount = assets.filter(a => !a.altText || a.altText.trim() === '').length;
  const oversizedCount = assets.filter(a => a.size > 500 * 1024).length;
  const unusedCount = unusedIds ? assets.filter(a => unusedIds.has(a.id)).length : 0;
  const cmsImageCount = cmsImageData?.stats.totalCmsImages ?? 0;
  const cmsMissingAltCount = cmsImageData?.stats.missingAlt ?? 0;

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
        {cmsImageCount > 0 && (
          <button
            onClick={() => setFilter('cms-images')}
            className={`flex items-center gap-1 transition-colors ${filter === 'cms-images' || filter === 'cms-missing-alt' ? 'text-blue-300' : 'text-blue-500 hover:text-blue-300'}`}
          >
            <Database className="w-3.5 h-3.5" />
            {cmsImageCount} CMS{cmsMissingAltCount > 0 ? `, ${cmsMissingAltCount} missing alt` : ''}
          </button>
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
        <OrganizePreview
          organizePreview={organizePreview}
          organizeExecuting={organizeExecuting}
          onExecute={handleOrganizeExecute}
          onCancel={() => setOrganizePreview(null)}
        />
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
      <AssetFilters
        search={search} filter={filter} sort={sort}
        hasCmsData={cmsImageCount > 0}
        onSearchChange={setSearch} onFilterChange={setFilter} onSortChange={setSort}
      />

      {/* CMS field selector — shown when a CMS filter is active */}
      {(filter === 'cms-images' || filter === 'cms-missing-alt') && cmsImageData?.collections && (
        <CmsFieldSelector
          collections={cmsImageData.collections}
          selectedFields={selectedCmsFields}
          onChange={setSelectedCmsFields}
        />
      )}

      {/* Bulk actions */}
      {selected.size > 0 && (
        <BulkActions
          selectedCount={selected.size} bulkProgress={bulkProgress}
          bulkRenameProgress={bulkRenameProgress} bulkCompressProgress={bulkCompressProgress}
          deleting={deleting}
          onBulkGenerateAlt={handleBulkGenerateAlt} onBulkRename={handleBulkRename}
          onBulkCompress={handleBulkCompress} onBulkDelete={handleBulkDelete}
          onClearSelection={() => setSelected(new Set())}
        />
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
          <AssetCard
            key={asset.id} asset={asset} selected={selected.has(asset.id)}
            editingAlt={editingAlt === asset.id} altDraft={altDraft}
            generatingAlt={generatingAlt.has(asset.id)} compressing={compressing.has(asset.id)}
            renamingId={renamingId === asset.id} renameDraft={renameDraft}
            renameLoading={renameLoading.has(asset.id)} unusedFlag={!!unusedIds?.has(asset.id)}
            cmsUsages={cmsUsageMap.get(asset.id)}
            onToggleSelect={toggleSelect}
            onEditAlt={(id, currentAlt) => { setEditingAlt(id); setAltDraft(currentAlt); }}
            onCancelEditAlt={() => setEditingAlt(null)}
            onSaveAlt={handleSaveAlt} onAltDraftChange={setAltDraft}
            onGenerateAlt={handleGenerateAlt} onCompress={handleCompress}
            onSmartRename={handleSmartRename} onSaveRename={handleSaveRename}
            onCancelRename={() => { setRenamingId(null); setRenameDraft(''); }}
            onRenameDraftChange={setRenameDraft}
          />
        ))}

        {filtered.length === 0 && (
          <EmptyState icon={search ? Search : Image} title={search ? 'No assets match your search' : 'No assets found'} className="py-10" />
        )}
      </div>
    </div>
  );
}

export { AssetBrowser };

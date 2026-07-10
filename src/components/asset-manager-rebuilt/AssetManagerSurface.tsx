// @ds-rebuilt
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, FolderOpen, Grid3X3, Image, List, Minimize2, RefreshCw, Sparkles, Upload, Wand2 } from 'lucide-react';
import { ApiError, del, get, patch, post } from '../../api/client';
import { bulkGenerateAltText, type BulkAltTextNdjsonEvent } from '../../api/seo';
import { workspaces } from '../../api/workspaces';
import { useWebflowAssets, useAssetAudit, useCmsImages } from '../../hooks/admin/useAdminAssets';
import { useQueue } from '../../hooks/admin/useQueue';
import { useBackgroundTasks } from '../../hooks/useBackgroundTasks';
import { UNBOUNDED_TOGGLE_SET_OPTIONS, useToggleSet } from '../../hooks/useToggleSet';
import { queryKeys } from '../../lib/queryKeys';
import { useToast } from '../Toast';
import { buildDefaultSelectedFields, CmsFieldSelector } from '../assets/CmsFieldSelector';
import type { CmsImageScanResult } from '../../../shared/types/cms-images';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FilterChip,
  FormSelect,
  Icon,
  InlineBanner,
  Drawer,
  MetricTile,
  PageHeader,
  SearchField,
  Skeleton,
  Toolbar,
  ToolbarSpacer,
  Tooltip,
} from '../ui';
import { formatBytes } from '../../utils/formatNumbers';
import { AssetDrawer } from './AssetDrawer';
import { AssetGrid } from './AssetGrid';
import { AssetTable } from './AssetTable';
import { AuditLens } from './AuditLens';
import { OrganizeDrawer } from './OrganizeDrawer';
import { UploadLens } from './UploadLens';
import { mutationErrorMessage } from './assetManagerMutationFeedback';
import {
  BROWSE_FILTERS,
  CMS_FILTERS,
  type Asset,
  type AssetSort,
  type AssetStats,
  type BrowseAsset,
  type BrowseFilter,
  type BulkCompressProgress,
  type BulkProgress,
  type BulkResult,
  type OrganizePlan,
} from './types';
import { useAssetManagerSurfaceState } from './useAssetManagerSurfaceState';

interface AssetManagerSurfaceProps {
  workspaceId: string;
}

const HEADER_WRAP_CLASS = 'flex-col items-start gap-3 sm:flex-row sm:items-center [&_p]:whitespace-normal [&_p]:overflow-visible [&_p]:text-clip';
const ASSETS_SUBTITLE = 'Browse, compress, rename, and add alt text to Webflow assets at the source.';

interface WorkspaceData {
  id: string;
  name: string;
  folder: string;
  webflowSiteId?: string;
  webflowSiteName?: string;
}

interface RenameResponse {
  fullName?: string;
}

interface PatchResponse {
  success?: boolean;
  error?: string;
}

interface CompressResponse {
  success?: boolean;
  skipped?: boolean;
  reason?: string;
  newAssetId?: string;
  newSize?: number;
  newHostedUrl?: string;
  newFileName?: string;
  savingsPercent?: number;
  savings?: number;
  cmsUpdates?: { succeeded: number; failed: number };
}

const SORT_OPTIONS = [
  { value: 'createdOn', label: 'Newest' },
  { value: 'fileName', label: 'Name' },
  { value: 'fileSize', label: 'Size' },
];

const VIEW_OPTIONS = [
  { value: 'grid', label: 'Grid' },
  { value: 'table', label: 'Table' },
];

function isQuotaError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 429;
}

function assetName(asset: Asset): string {
  return asset.displayName || asset.originalFileName || asset.id;
}

function assetUrl(asset: Asset): string | undefined {
  return asset.hostedUrl || asset.url;
}

function formatUpdatedAt(value: number): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function assetMatchesFilter(asset: BrowseAsset, filter: BrowseFilter, unusedIds: Set<string> | null): boolean {
  if (filter === 'missing-alt') return !asset.altText || asset.altText.trim() === '';
  if (filter === 'oversized') return asset.size > 500 * 1024;
  if (filter === 'images') return asset.contentType.startsWith('image/') && !asset.contentType.includes('svg');
  if (filter === 'svg') return asset.contentType.includes('svg');
  if (filter === 'unused') return unusedIds ? unusedIds.has(asset.id) : false;
  if (filter === 'used') return unusedIds ? !unusedIds.has(asset.id) : true;
  return true;
}

function computeStats(assets: Asset[], unusedIds: Set<string> | null, cmsImages: number, cmsMissingAlt: number): AssetStats {
  const totalWeight = assets.reduce((sum, asset) => sum + (asset.size || 0), 0);
  const oversized = assets.filter((asset) => asset.size > 500 * 1024);
  return {
    total: assets.length,
    missingAlt: assets.filter((asset) => !asset.altText || asset.altText.trim() === '').length,
    oversized: oversized.length,
    unused: unusedIds ? assets.filter((asset) => unusedIds.has(asset.id)).length : 0,
    cmsImages,
    cmsMissingAlt,
    totalWeight,
    estimatedSavings: oversized
      .filter((asset) => !asset.contentType.includes('svg'))
      .reduce((sum, asset) => sum + Math.round((asset.size || 0) * 0.55), 0),
  };
}

function LockedIcon({ className }: { className?: string }) {
  return <Icon as={Image} className={className} />;
}

export function AssetManagerSurface({ workspaceId }: AssetManagerSurfaceProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const state = useAssetManagerSurfaceState();
  const { jobs, startJob } = useBackgroundTasks();
  const [selectedIds, toggleSelected, setSelectedIds] = useToggleSet<string>([], UNBOUNDED_TOGGLE_SET_OPTIONS);
  const [altDraft, setAltDraft] = useState('');
  const [renameDraft, setRenameDraft] = useState('');
  const [busyAltIds, setBusyAltIds] = useState<Set<string>>(new Set());
  const [busyCompressIds, setBusyCompressIds] = useState<Set<string>>(new Set());
  const [busyRenameIds, setBusyRenameIds] = useState<Set<string>>(new Set());
  const [savingAltId, setSavingAltId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [bulkAltProgress, setBulkAltProgress] = useState<BulkProgress | null>(null);
  const [bulkRenameProgress, setBulkRenameProgress] = useState<BulkProgress | null>(null);
  const [bulkCompressProgress, setBulkCompressProgress] = useState<BulkCompressProgress | null>(null);
  const [bulkCompressJobId, setBulkCompressJobId] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [quotaLocked, setQuotaLocked] = useState(false);
  const [quotaDismissed, setQuotaDismissed] = useState(false);
  const [quotaPartial, setQuotaPartial] = useState<{ done: number; total: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BrowseAsset | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [organizePreview, setOrganizePreview] = useState<OrganizePlan | null>(null);
  const [organizeLoading, setOrganizeLoading] = useState(false);
  const [organizeExecuting, setOrganizeExecuting] = useState(false);
  const [organizeResult, setOrganizeResult] = useState<BulkResult | null>(null);
  const [selectedCmsFields, setSelectedCmsFields] = useState<Set<string>>(new Set());

  const workspaceQuery = useQuery({
    queryKey: queryKeys.admin.workspaceDetail(workspaceId),
    queryFn: () => workspaces.getById(workspaceId) as Promise<WorkspaceData>,
    enabled: !!workspaceId,
  });
  const workspace = workspaceQuery.data;
  const siteId = workspace?.webflowSiteId ?? '';
  const workspaceFolder = workspace?.folder ?? workspaceId;
  const assetsQuery = useWebflowAssets(siteId, workspaceId);
  const assets = assetsQuery.data ?? [];
  const unusedQuery = useAssetAudit(siteId, workspaceId, assets.length > 0);
  const cmsQuery = useCmsImages(siteId, workspaceId, assets.length > 0);
  const queueQuery = useQueue();
  const queue = (queueQuery.data ?? []).filter((item) => item.workspace === workspaceFolder);
  const lastUpdated = formatUpdatedAt(assetsQuery.dataUpdatedAt);

  useEffect(() => {
    if (!cmsQuery.data?.collections?.length) return;
    setSelectedCmsFields((prev) => prev.size === 0 ? buildDefaultSelectedFields(cmsQuery.data.collections) : prev);
  }, [cmsQuery.data?.collections]);

  const cmsUsageMap = useMemo(() => {
    const map = new Map<string, BrowseAsset['cmsUsages']>();
    for (const asset of cmsQuery.data?.assets ?? []) {
      map.set(asset.assetId, asset.usages);
    }
    return map;
  }, [cmsQuery.data?.assets]);

  const richTextOnlyIds = useMemo(() => {
    const ids = new Set<string>();
    for (const asset of cmsQuery.data?.assets ?? []) {
      if (asset.isRichTextOnly) ids.add(asset.assetId);
    }
    return ids;
  }, [cmsQuery.data?.assets]);

  const webflowAssets = useMemo<BrowseAsset[]>(() => assets.map((asset) => ({
    ...asset,
    source: 'webflow',
    unused: !!unusedQuery.data?.has(asset.id),
    cmsUsages: cmsUsageMap.get(asset.id),
    richTextOnly: richTextOnlyIds.has(asset.id),
  })), [assets, cmsUsageMap, richTextOnlyIds, unusedQuery.data]);

  const cmsAssets = useMemo<BrowseAsset[]>(() => (cmsQuery.data?.assets ?? []).map((asset) => ({
    id: asset.assetId,
    displayName: asset.displayName,
    originalFileName: asset.displayName,
    size: asset.size,
    contentType: asset.contentType,
    hostedUrl: asset.hostedUrl || undefined,
    altText: asset.altText || undefined,
    source: 'cms',
    unused: false,
    cmsUsages: asset.usages,
    richTextOnly: asset.isRichTextOnly,
  })), [cmsQuery.data?.assets]);

  const isCmsFilter = [...state.browseFilters].some((filter) => CMS_FILTERS.has(filter));
  const sourceAssets = isCmsFilter ? cmsAssets : webflowAssets;
  const filteredAssets = useMemo(() => {
    const query = state.search.toLowerCase();
    const sorted = sourceAssets.filter((asset) => {
      if (query) {
        const haystack = `${assetName(asset)} ${asset.altText ?? ''}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (isCmsFilter) {
        const usages = asset.cmsUsages ?? [];
        const inSelectedField = usages.some((usage) => selectedCmsFields.has(`${usage.collectionId}:${usage.fieldSlug}`));
        if (!inSelectedField) return false;
        if (state.browseFilters.has('cms-missing-alt') && !state.browseFilters.has('cms-images')) {
          return !asset.altText || asset.altText.trim() === '';
        }
        return true;
      }
      if (state.browseFilters.size === 0) return true;
      return [...state.browseFilters].some((filter) => assetMatchesFilter(asset, filter, unusedQuery.data ?? null));
    });

    return sorted.sort((a, b) => {
      if (state.assetSort === 'fileSize') return (b.size || 0) - (a.size || 0);
      if (state.assetSort === 'fileName') return assetName(a).localeCompare(assetName(b));
      return (b.createdOn || '').localeCompare(a.createdOn || '');
    });
  }, [isCmsFilter, selectedCmsFields, sourceAssets, state.assetSort, state.browseFilters, state.search, unusedQuery.data]);

  const selectedAsset = filteredAssets.find((asset) => asset.id === state.selectedAssetId)
    ?? webflowAssets.find((asset) => asset.id === state.selectedAssetId)
    ?? cmsAssets.find((asset) => asset.id === state.selectedAssetId)
    ?? null;
  const assetDetailOpen = selectedAsset !== null;

  useEffect(() => {
    if (!selectedAsset) return;
    setAltDraft(selectedAsset.altText ?? '');
    setRenameDraft(assetName(selectedAsset));
  }, [selectedAsset]);

  const stats = computeStats(
    assets,
    unusedQuery.data ?? null,
    cmsQuery.data?.stats.totalCmsImages ?? 0,
    cmsQuery.data?.stats.missingAlt ?? 0,
  );

  const filterCounts = useMemo(() => ({
    'missing-alt': stats.missingAlt,
    oversized: stats.oversized,
    images: webflowAssets.filter((asset) => asset.contentType.startsWith('image/') && !asset.contentType.includes('svg')).length,
    svg: webflowAssets.filter((asset) => asset.contentType.includes('svg')).length,
    unused: stats.unused,
    used: unusedQuery.data ? webflowAssets.filter((asset) => !unusedQuery.data?.has(asset.id)).length : webflowAssets.length,
    'cms-images': stats.cmsImages,
    'cms-missing-alt': stats.cmsMissingAlt,
  } satisfies Record<BrowseFilter, number>), [stats, unusedQuery.data, webflowAssets]);

  const selectedAssets = filteredAssets.filter((asset) => selectedIds.has(asset.id));
  const quotaReason = 'Monthly AI generation limit reached. AI alt text and smart rename actions are disabled for this session.';

  const markQuotaHit = useCallback((partial?: { done: number; total: number }) => {
    setQuotaLocked(true);
    setQuotaDismissed(false);
    if (partial) {
      setQuotaPartial(partial);
      setBulkResult({
        tone: 'warning',
        title: 'Quota reached during bulk run',
        message: `${partial.done} of ${partial.total} completed before the quota was hit.`,
      });
    }
  }, []);

  const updateAssets = useCallback((updater: (prev: Asset[]) => Asset[]) => {
    queryClient.setQueryData<Asset[]>(queryKeys.admin.webflowAssets(siteId, workspaceId), (old) => updater(old ?? []));
  }, [queryClient, siteId, workspaceId]);

  const updateCmsAssets = useCallback((assetId: string, patchData: Partial<{ altText: string }>) => {
    queryClient.setQueryData<CmsImageScanResult>(queryKeys.admin.cmsImages(siteId, workspaceId), (old) => {
      if (!old) return old;
      return {
        ...old,
        assets: old.assets.map((asset) => asset.assetId === assetId ? { ...asset, ...patchData } : asset),
        stats: {
          ...old.stats,
          missingAlt: old.assets.filter((asset) =>
            asset.assetId === assetId ? !(patchData.altText ?? asset.altText)?.trim() : !asset.altText?.trim()
          ).length,
        },
      };
    });
  }, [cmsQuery.data, queryClient, siteId, workspaceId]);

  const refreshAssets = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.webflowAssets(siteId, workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.assetAudit(siteId, workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.cmsImages(siteId, workspaceId) });
  }, [queryClient, siteId, workspaceId]);

  useEffect(() => {
    if (!bulkCompressJobId) return;
    const job = jobs.find((item) => item.id === bulkCompressJobId);
    if (!job) return;
    if (job.status === 'running' && job.progress != null && job.total) {
      setBulkCompressProgress({ done: job.progress, total: job.total, saved: 0 });
    } else if (job.status === 'done') {
      const result = job.result as { totalSaved?: number } | undefined;
      const saved = result?.totalSaved ?? 0;
      setBulkCompressProgress(null);
      setBulkCompressJobId(null);
      setBulkResult({
        tone: 'success',
        title: 'Bulk compression finished',
        message: saved > 0 ? `Saved ${formatBytes(saved)} total.` : 'Compression job completed.',
      });
      refreshAssets();
    } else if (job.status === 'error') {
      setBulkCompressProgress(null);
      setBulkCompressJobId(null);
      setBulkResult({
        tone: 'error',
        title: 'Bulk compression failed',
        message: job.error || 'The background job did not finish.',
      });
    }
  }, [bulkCompressJobId, jobs, refreshAssets]);

  const handleSaveAlt = async (asset: BrowseAsset) => {
    setSavingAltId(asset.id);
    try {
      const data = await patch<PatchResponse>(`/api/webflow/assets/${asset.id}`, { altText: altDraft, siteId, workspaceId });
      if (!data.success) throw new Error(data.error || 'Webflow did not save the alt text');
      updateAssets((prev) => prev.map((item) => item.id === asset.id ? { ...item, altText: altDraft } : item));
      updateCmsAssets(asset.id, { altText: altDraft });
      toast('Alt text saved', 'success');
    } catch (error) {
      toast(mutationErrorMessage(error, 'Alt text save failed'), 'error');
    } finally {
      setSavingAltId(null);
    }
  };

  const handleGenerateAlt = async (asset: BrowseAsset): Promise<'saved' | 'failed' | 'quota'> => {
    const url = assetUrl(asset);
    if (!url || quotaLocked) return 'failed';
    setBusyAltIds((prev) => new Set(prev).add(asset.id));
    try {
      const data = await post<{ error?: string; altText?: string; writeError?: string }>(
        `/api/webflow/${workspaceId}/generate-alt/${asset.id}`,
        { imageUrl: url, siteId },
      );
      if (data.error) throw new Error(data.error);
      if (data.altText) {
        updateAssets((prev) => prev.map((item) => item.id === asset.id ? { ...item, altText: data.altText } : item));
        updateCmsAssets(asset.id, { altText: data.altText });
        setAltDraft(data.altText);
        toast(data.writeError ? 'Alt text generated, but Webflow save failed' : 'Alt text generated', data.writeError ? 'info' : 'success');
        return data.writeError ? 'failed' : 'saved';
      }
      return 'failed';
    } catch (error) {
      if (isQuotaError(error)) {
        markQuotaHit();
        return 'quota';
      }
      toast(mutationErrorMessage(error, 'Alt text generation failed'), 'error');
      return 'failed';
    } finally {
      setBusyAltIds((prev) => {
        const next = new Set(prev);
        next.delete(asset.id);
        return next;
      });
    }
  };

  const handleCompress = async (asset: BrowseAsset) => {
    const url = assetUrl(asset);
    if (!url) return;
    setBusyCompressIds((prev) => new Set(prev).add(asset.id));
    try {
      const data = await post<CompressResponse>(`/api/webflow/${workspaceId}/compress/${asset.id}`, {
        imageUrl: url,
        siteId,
        altText: asset.altText,
        fileName: assetName(asset),
        cmsUsages: (asset.cmsUsages ?? []).filter((usage) => selectedCmsFields.has(`${usage.collectionId}:${usage.fieldSlug}`)),
      });
      if (data.success) {
        updateAssets((prev) => prev.map((item) => item.id === asset.id ? {
          ...item,
          id: data.newAssetId || item.id,
          size: data.newSize ?? item.size,
          hostedUrl: data.newHostedUrl,
          displayName: data.newFileName,
        } : item));
        const cmsNote = data.cmsUpdates?.succeeded ? ` · ${data.cmsUpdates.succeeded} CMS refs updated` : '';
        setBulkResult({
          tone: 'success',
          title: 'Compression complete',
          message: `Saved ${data.savingsPercent ?? 0}% (${formatBytes(data.savings ?? 0)})${cmsNote}.`,
        });
      } else if (data.skipped) {
        setBulkResult({ tone: 'info', title: 'Compression skipped', message: data.reason || 'Already optimized.' });
      }
    } catch (error) {
      toast(mutationErrorMessage(error, 'Image compression failed'), 'error');
    } finally {
      setBusyCompressIds((prev) => {
        const next = new Set(prev);
        next.delete(asset.id);
        return next;
      });
    }
  };

  const handleSmartRename = async (asset: BrowseAsset) => {
    const url = assetUrl(asset);
    if (quotaLocked) return;
    setBusyRenameIds((prev) => new Set(prev).add(asset.id));
    try {
      const data = await post<RenameResponse>('/api/smart-name', {
        originalName: assetName(asset),
        altText: asset.altText,
        contentType: asset.contentType,
        imageUrl: url,
        siteId,
        workspaceId,
        assetId: asset.id,
      });
      if (data.fullName) {
        state.openAsset(asset.id);
        setRenameDraft(data.fullName);
        toast('Smart name drafted for review', 'info');
      }
    } catch (error) {
      if (isQuotaError(error)) markQuotaHit();
      toast(mutationErrorMessage(error, 'Smart rename failed'), 'error');
    } finally {
      setBusyRenameIds((prev) => {
        const next = new Set(prev);
        next.delete(asset.id);
        return next;
      });
    }
  };

  const handleSaveRename = async (asset: BrowseAsset) => {
    if (!renameDraft.trim()) return;
    setBusyRenameIds((prev) => new Set(prev).add(asset.id));
    try {
      const data = await patch<PatchResponse>(`/api/webflow/rename/${asset.id}`, { displayName: renameDraft.trim(), siteId, workspaceId });
      if (!data.success) throw new Error(data.error || 'Webflow did not save the rename');
      updateAssets((prev) => prev.map((item) => item.id === asset.id ? { ...item, displayName: renameDraft.trim() } : item));
      toast('Asset name saved', 'success');
    } catch (error) {
      toast(mutationErrorMessage(error, 'Asset rename failed'), 'error');
    } finally {
      setBusyRenameIds((prev) => {
        const next = new Set(prev);
        next.delete(asset.id);
        return next;
      });
    }
  };

  const handleBulkGenerateAlt = async () => {
    const toGenerate = selectedAssets.filter((asset) => (!asset.altText || asset.altText.trim() === '') && assetUrl(asset));
    if (toGenerate.length === 0) return;
    setBulkAltProgress({ done: 0, total: toGenerate.length });
    let successCount = 0;
    let failCount = 0;
    let quotaDone: number | null = null;
    try {
      await bulkGenerateAltText(
        workspaceId,
        { siteId, assets: toGenerate.map((asset) => ({ assetId: asset.id, imageUrl: assetUrl(asset) || '' })) },
        (assetId, altText) => {
          updateAssets((prev) => prev.map((asset) => asset.id === assetId ? { ...asset, altText } : asset));
          updateCmsAssets(assetId, { altText });
        },
        (event: BulkAltTextNdjsonEvent) => {
          if (event.type === 'result') {
            setBulkAltProgress({ done: event.done ?? 0, total: event.total ?? toGenerate.length });
            if (event.altText && event.updated) successCount += 1;
            else failCount += 1;
          } else if (event.type === 'status') {
            setBulkAltProgress({ done: event.done ?? 0, total: event.total ?? toGenerate.length });
            if (typeof event.message === 'string' && event.message.toLowerCase().includes('limit reached')) {
              quotaDone = event.done ?? 0;
            }
          }
        },
      );
      if (quotaDone != null) {
        markQuotaHit({ done: quotaDone, total: toGenerate.length });
      } else {
        setBulkResult({
          tone: failCount > 0 ? 'warning' : 'success',
          title: 'Bulk alt text complete',
          message: `${successCount} saved${failCount > 0 ? `, ${failCount} failed` : ''}.`,
        });
      }
    } catch (error) {
      if (isQuotaError(error)) {
        markQuotaHit({ done: 0, total: toGenerate.length });
      } else {
        setBulkResult({ tone: 'error', title: 'Bulk alt text failed', message: mutationErrorMessage(error, 'Bulk alt text failed') });
      }
    } finally {
      setBulkAltProgress(null);
    }
  };

  const handleBulkRename = async () => {
    if (selectedAssets.length === 0 || quotaLocked) return;
    setBulkRenameProgress({ done: 0, total: selectedAssets.length });
    let renamed = 0;
    for (let index = 0; index < selectedAssets.length; index++) {
      const asset = selectedAssets[index];
      setBusyRenameIds((prev) => new Set(prev).add(asset.id));
      try {
        const data = await post<RenameResponse>('/api/smart-name', {
          originalName: assetName(asset),
          altText: asset.altText,
          contentType: asset.contentType,
          imageUrl: assetUrl(asset),
          siteId,
          workspaceId,
          assetId: asset.id,
        });
        if (data.fullName) {
          const save = await patch<PatchResponse>(`/api/webflow/rename/${asset.id}`, { displayName: data.fullName, siteId, workspaceId });
          if (save.success) {
            renamed += 1;
            updateAssets((prev) => prev.map((item) => item.id === asset.id ? { ...item, displayName: data.fullName } : item));
          }
        }
      } catch (error) {
        if (isQuotaError(error)) {
          markQuotaHit({ done: index, total: selectedAssets.length });
          break;
        }
      } finally {
        setBusyRenameIds((prev) => {
          const next = new Set(prev);
          next.delete(asset.id);
          return next;
        });
        setBulkRenameProgress({ done: index + 1, total: selectedAssets.length });
      }
    }
    setBulkRenameProgress(null);
    setBulkResult({
      tone: renamed === selectedAssets.length ? 'success' : 'warning',
      title: 'Bulk smart rename complete',
      message: `${renamed} of ${selectedAssets.length} assets renamed.`,
    });
  };

  const handleBulkCompress = async () => {
    const toCompress = selectedAssets.filter((asset) => asset.size > 50 * 1024 && !asset.contentType.includes('svg') && !asset.richTextOnly);
    if (toCompress.length === 0) return;
    setBulkCompressProgress({ done: 0, total: toCompress.length, saved: 0 });
    const jobId = await startJob('bulk-compress', {
      siteId,
      workspaceId,
      assets: toCompress.map((asset) => ({
        assetId: asset.id,
        imageUrl: assetUrl(asset),
        altText: asset.altText,
        fileName: assetName(asset),
        cmsUsages: (asset.cmsUsages ?? []).filter((usage) => selectedCmsFields.has(`${usage.collectionId}:${usage.fieldSlug}`)),
      })),
    });
    if (jobId) {
      setBulkCompressJobId(jobId);
    } else {
      setBulkCompressProgress(null);
      setBulkResult({ tone: 'error', title: 'Bulk compression did not start', message: 'The background job platform did not return a job id.' });
    }
  };

  const handleDeleteAsset = async (asset: BrowseAsset) => {
    setDeletingId(asset.id);
    try {
      await del(`/api/webflow/assets/${asset.id}?siteId=${encodeURIComponent(siteId)}&workspaceId=${encodeURIComponent(workspaceId)}`);
      updateAssets((prev) => prev.filter((item) => item.id !== asset.id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(asset.id);
        return next;
      });
      if (state.selectedAssetId === asset.id) state.closeAsset();
      toast('Asset deleted', 'success');
    } catch (error) {
      toast(mutationErrorMessage(error, 'Asset delete failed'), 'error');
    } finally {
      setDeletingId(null);
      setConfirmDelete(null);
    }
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    setDeletingId('bulk');
    try {
      const result = await post<Array<{ assetId: string; success?: boolean; error?: string }>>('/api/webflow/assets/bulk-delete', {
        assetIds: ids,
        siteId,
        workspaceId,
      });
      const failed = result.filter((item) => item.error || item.success === false).length;
      const deletedIds = new Set(result.filter((item) => !item.error && item.success !== false).map((item) => item.assetId));
      updateAssets((prev) => prev.filter((asset) => !deletedIds.has(asset.id)));
      setSelectedIds(new Set<string>());
      setBulkResult({
        tone: failed > 0 ? 'warning' : 'success',
        title: 'Bulk delete complete',
        message: `${deletedIds.size} deleted${failed > 0 ? `, ${failed} failed` : ''}.`,
      });
    } catch (error) {
      setBulkResult({ tone: 'error', title: 'Bulk delete failed', message: mutationErrorMessage(error, 'Bulk delete failed') });
    } finally {
      setDeletingId(null);
      setConfirmBulkDelete(false);
    }
  };

  const handleOrganizePreview = async () => {
    setOrganizeOpen(true);
    setOrganizeLoading(true);
    setOrganizeResult(null);
    try {
      const data = await get<OrganizePlan & { error?: string }>(`/api/webflow/organize-preview/${siteId}?workspaceId=${encodeURIComponent(workspaceId)}`);
      if (data.error) throw new Error(data.error);
      setOrganizePreview(data);
    } catch (error) {
      setOrganizeResult({ tone: 'error', title: 'Organize preview failed', message: mutationErrorMessage(error, 'Organize preview failed') });
    } finally {
      setOrganizeLoading(false);
    }
  };

  const handleOrganizeExecute = async () => {
    if (!organizePreview) return;
    setOrganizeExecuting(true);
    try {
      const data = await post<{ error?: string; summary?: { moved: number; failed: number; total: number } }>(`/api/webflow/organize-execute/${siteId}`, {
        moves: organizePreview.moves,
        foldersToCreate: organizePreview.foldersToCreate,
        workspaceId,
      });
      if (data.error) throw new Error(data.error);
      setOrganizeResult({
        tone: data.summary?.failed ? 'warning' : 'success',
        title: 'Organization applied',
        message: data.summary ? `${data.summary.moved} moved${data.summary.failed ? `, ${data.summary.failed} failed` : ''} of ${data.summary.total}.` : 'Folder plan applied.',
      });
      refreshAssets();
    } catch (error) {
      setOrganizeResult({ tone: 'error', title: 'Organization failed', message: mutationErrorMessage(error, 'Organization failed') });
    } finally {
      setOrganizeExecuting(false);
    }
  };

  const selectAllShown = () => {
    if (selectedAssets.length === filteredAssets.length && filteredAssets.length > 0) {
      setSelectedIds(new Set<string>());
    } else {
      setSelectedIds(new Set(filteredAssets.map((asset) => asset.id)));
    }
  };

  const actionBusy = (assetId: string, action: 'alt' | 'compress' | 'rename') => {
    if (action === 'alt') return busyAltIds.has(assetId);
    if (action === 'compress') return busyCompressIds.has(assetId);
    return busyRenameIds.has(assetId);
  };

  if (workspaceQuery.isLoading) {
    return (
      <div className="flex min-h-full flex-col gap-5" aria-label="Loading asset manager">
        <Skeleton className="h-[72px] w-full" />
        <Skeleton className="h-[48px] w-full" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-[92px] w-full" />)}
        </div>
      </div>
    );
  }

  if (workspaceQuery.isError || !workspace) {
    return (
      <div className="flex min-h-full flex-col gap-5">
        <PageHeader title="Assets" subtitle={ASSETS_SUBTITLE} className={HEADER_WRAP_CLASS} />
        <ErrorState
          type="data"
          title="Workspace did not load"
          message="Retry the workspace read before managing media."
          action={{ label: 'Retry', onClick: () => workspaceQuery.refetch() }}
        />
      </div>
    );
  }

  if (!siteId) {
    return (
      <div className="flex min-h-full flex-col gap-5">
        <PageHeader title="Assets" subtitle={ASSETS_SUBTITLE} className={HEADER_WRAP_CLASS} />
        <EmptyState
          icon={LockedIcon}
          title="Link a Webflow site"
          description="Asset Manager needs a connected Webflow site before it can list, audit, or upload media."
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col gap-5">
      <PageHeader
        title="Assets"
        subtitle={ASSETS_SUBTITLE}
        className={HEADER_WRAP_CLASS}
        actions={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            {lastUpdated && <span className="t-caption-sm text-[var(--brand-text-muted)]">Data as of {lastUpdated}</span>}
            <Button size="sm" variant="secondary" onClick={refreshAssets} disabled={assetsQuery.isFetching}>
              <Icon as={RefreshCw} size="sm" className={assetsQuery.isFetching ? 'animate-spin' : undefined} />
              Refresh
            </Button>
          </div>
        )}
      />

      <Toolbar label="Asset Manager controls">
        <SearchField
          value={state.searchInput}
          onChange={state.setSearchInput}
          placeholder="Search filename or alt text..."
          className="w-full min-w-0 sm:w-auto sm:min-w-[260px]"
        />
        <ToolbarSpacer />
        <FormSelect
          value={state.assetSort}
          onChange={(value) => state.setAssetSort(value as AssetSort)}
          options={SORT_OPTIONS}
          className="w-[140px]"
          aria-label="Sort assets"
        />
        <FormSelect
          value={state.view}
          onChange={(value) => state.setView(value as typeof state.view)}
          options={VIEW_OPTIONS}
          className="w-[120px]"
          aria-label="Asset view"
        />
        <Button size="sm" variant="secondary" onClick={() => void handleOrganizePreview()}>
          <Icon as={FolderOpen} size="sm" />
          Organize
        </Button>
        <Button size="sm" variant="secondary" onClick={() => state.setLens('audit')}>
          <Icon as={Sparkles} size="sm" />
          Repair results
        </Button>
        <Button size="sm" variant="primary" onClick={() => state.setLens('upload')}>
          <Icon as={Upload} size="sm" />
          Upload
        </Button>
      </Toolbar>

      {quotaLocked && !quotaDismissed && (
        <InlineBanner tone="warning" title="AI quota reached" onDismiss={() => setQuotaDismissed(true)}>
          {quotaPartial
            ? `${quotaPartial.done} of ${quotaPartial.total} completed before the quota was hit. AI alt text and smart rename actions are disabled for this session.`
            : quotaReason}
        </InlineBanner>
      )}

      {assetsQuery.isError && assets.length > 0 && (
        <InlineBanner tone="warning" title="Asset list may be stale">
          The latest Webflow asset refresh failed, so the last loaded asset list is still shown.
        </InlineBanner>
      )}

      {bulkResult && (
        <InlineBanner tone={bulkResult.tone} title={bulkResult.title} onDismiss={() => setBulkResult(null)}>
          {bulkResult.message}
        </InlineBanner>
      )}

      {state.lens === 'audit' && (
        <section aria-labelledby="asset-repair-results-title" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 id="asset-repair-results-title" className="t-page text-[var(--brand-text-bright)]">Repair results</h3>
              <p className="mt-1 t-caption text-[var(--brand-text-muted)]">Review and resolve media issues without leaving the asset library.</p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => state.setLens('browse')}>
              Close repair results
            </Button>
          </div>
          <AuditLens
            siteId={siteId}
            workspaceId={workspaceId}
            search={state.search}
            searchInput={state.searchInput}
            onSearchChange={state.setSearchInput}
            activeFilter={state.auditFilter}
            onFilterChange={state.setAuditFilter}
            sort={state.auditSort}
            onSortChange={state.setAuditSort}
            quotaLocked={quotaLocked}
            quotaReason={quotaReason}
            onQuotaHit={markQuotaHit}
          />
        </section>
      )}

      <>
          <div className="flex flex-wrap gap-2" aria-label="Browse asset filters">
            <FilterChip
              label="All"
              active={state.browseFilters.size === 0}
              count={stats.total}
              onClick={state.showAllBrowseAssets}
            />
            {BROWSE_FILTERS.map((filter) => (
              <FilterChip
                key={filter.id}
                label={filter.label}
                active={state.browseFilters.has(filter.id)}
                count={filterCounts[filter.id]}
                onClick={() => state.toggleBrowseFilter(filter.id)}
              />
            ))}
            {state.browseFilters.size > 0 && (
              <FilterChip label="Clear" active onClick={state.clearBrowseFilters} />
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
            {assetsQuery.isLoading ? (
              Array.from({ length: 7 }).map((_, index) => <Skeleton key={index} className="h-[92px] w-full" />)
            ) : (
              <>
                <MetricTile label="Assets" value={stats.total} accent="var(--blue)" icon={Image} />
                <MetricTile label="Total media weight" value={formatBytes(stats.totalWeight)} accent="var(--blue)" icon={Database} />
                <MetricTile label="Missing alt" value={stats.missingAlt} accent="var(--amber)" icon={Sparkles} />
                <MetricTile label="Oversized" value={stats.oversized} accent="var(--blue)" icon={Minimize2} />
                <MetricTile label="Unused" value={stats.unused} accent="var(--red)" icon={FolderOpen} />
                <MetricTile label="CMS images" value={stats.cmsImages} accent="var(--blue)" icon={Database} sub={`${stats.cmsMissingAlt} missing alt`} />
                <MetricTile label="Potential savings" value={formatBytes(stats.estimatedSavings)} accent="var(--blue)" icon={Minimize2} sub="estimate" />
              </>
            )}
          </div>

          <InlineBanner tone="info" title="Fixes the source, not the symptom.">
            <p className="t-body">
              Compressing writes optimized assets back to Webflow and updates selected CMS references, so PageSpeed and Site Audit media findings clear from the source.
            </p>
          </InlineBanner>

          {isCmsFilter && cmsQuery.data?.collections && (
            <CmsFieldSelector
              collections={cmsQuery.data.collections}
              selectedFields={selectedCmsFields}
              onChange={setSelectedCmsFields}
            />
          )}

          {selectedIds.size > 0 && (
            <div className="sticky top-0 z-[var(--z-dropdown)] bg-[var(--surface-1)] pb-1">
              <InlineBanner tone="info" title={`${selectedIds.size} selected`} onDismiss={() => setSelectedIds(new Set<string>())}>
                <Toolbar label="Bulk asset actions" className="mt-2 border-none bg-transparent p-0">
                  <Button size="sm" variant="secondary" onClick={selectAllShown}>
                    <Icon as={state.view === 'grid' ? Grid3X3 : List} size="sm" />
                    {selectedAssets.length === filteredAssets.length ? 'Clear shown' : 'Select all shown'}
                  </Button>
                  <Tooltip content={quotaLocked ? quotaReason : 'Generate alt text for selected assets with missing alt text'} placement="top" contentClassName="max-w-sm">
                    <span className="inline-flex" tabIndex={0}>
                      <Button size="sm" variant="secondary" disabled={quotaLocked || !!bulkAltProgress} onClick={() => void handleBulkGenerateAlt()}>
                        <Icon as={Sparkles} size="sm" />
                        {bulkAltProgress ? `${bulkAltProgress.done}/${bulkAltProgress.total}` : 'Generate alt'}
                      </Button>
                    </span>
                  </Tooltip>
                  <Tooltip content={quotaLocked ? quotaReason : 'Draft and apply smart names for selected assets'} placement="top" contentClassName="max-w-sm">
                    <span className="inline-flex" tabIndex={0}>
                      <Button size="sm" variant="secondary" disabled={quotaLocked || !!bulkRenameProgress} onClick={() => void handleBulkRename()}>
                        <Icon as={Wand2} size="sm" />
                        {bulkRenameProgress ? `${bulkRenameProgress.done}/${bulkRenameProgress.total}` : 'Smart rename'}
                      </Button>
                    </span>
                  </Tooltip>
                  <Button size="sm" variant="secondary" disabled={!!bulkCompressProgress} onClick={() => void handleBulkCompress()}>
                    <Icon as={Minimize2} size="sm" />
                    {bulkCompressProgress ? `${bulkCompressProgress.done}/${bulkCompressProgress.total}` : 'Compress'}
                  </Button>
                  <ToolbarSpacer />
                  <Button size="sm" variant="danger" disabled={deletingId === 'bulk'} onClick={() => setConfirmBulkDelete(true)}>
                    Delete
                  </Button>
                </Toolbar>
              </InlineBanner>
            </div>
          )}

          {assetsQuery.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-[280px] w-full" />)}
            </div>
          ) : state.view === 'table' ? (
            <AssetTable
              assets={filteredAssets}
              selected={selectedIds}
              quotaLocked={quotaLocked}
              quotaReason={quotaReason}
              actionBusy={actionBusy}
              onToggleSelect={toggleSelected}
              onOpenAsset={state.openAsset}
              onGenerateAlt={(asset) => { void handleGenerateAlt(asset); }}
              onCompress={(asset) => { void handleCompress(asset); }}
              onSmartRename={(asset) => { void handleSmartRename(asset); }}
            />
          ) : (
            <AssetGrid
              assets={filteredAssets}
              selected={selectedIds}
              quotaLocked={quotaLocked}
              quotaReason={quotaReason}
              actionBusy={actionBusy}
              onToggleSelect={toggleSelected}
              onOpenAsset={state.openAsset}
              onGenerateAlt={(asset) => { void handleGenerateAlt(asset); }}
              onCompress={(asset) => { void handleCompress(asset); }}
              onSmartRename={(asset) => { void handleSmartRename(asset); }}
              onClearFilters={state.clearAll}
            />
          )}

          <InlineBanner tone="success" title="From media fix to proof">
            <p className="t-body">
              A compression pass that improves Core Web Vitals or page speed can graduate into Insights Engine once the measured lift lands.
            </p>
          </InlineBanner>
      </>

      <Drawer
        open={state.lens === 'upload' && !assetDetailOpen}
        onClose={() => state.setLens('browse')}
        title="Upload assets"
        subtitle="Add images to the existing Webflow asset workflow."
        eyebrow="Asset library"
        width={760}
      >
        <UploadLens workspaceFolder={workspaceFolder} queue={queue} queueLoading={queueQuery.isLoading} />
      </Drawer>

      <AssetDrawer
        asset={selectedAsset}
        open={assetDetailOpen}
        quotaLocked={quotaLocked}
        quotaReason={quotaReason}
        altDraft={altDraft}
        renameDraft={renameDraft}
        savingAlt={savingAltId === selectedAsset?.id}
        generatingAlt={selectedAsset ? busyAltIds.has(selectedAsset.id) : false}
        compressing={selectedAsset ? busyCompressIds.has(selectedAsset.id) : false}
        renaming={selectedAsset ? busyRenameIds.has(selectedAsset.id) : false}
        deleting={deletingId === selectedAsset?.id}
        onAltDraftChange={setAltDraft}
        onRenameDraftChange={setRenameDraft}
        onSaveAlt={(asset) => { void handleSaveAlt(asset); }}
        onGenerateAlt={(asset) => { void handleGenerateAlt(asset); }}
        onCompress={(asset) => { void handleCompress(asset); }}
        onSmartRename={(asset) => { void handleSmartRename(asset); }}
        onSaveRename={(asset) => { void handleSaveRename(asset); }}
        onRequestDelete={setConfirmDelete}
        onClose={state.closeAsset}
      />

      <OrganizeDrawer
        open={organizeOpen}
        loading={organizeLoading}
        executing={organizeExecuting}
        plan={organizePreview}
        result={organizeResult}
        onPreview={() => void handleOrganizePreview()}
        onExecute={() => void handleOrganizeExecute()}
        onClose={() => setOrganizeOpen(false)}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete asset?"
        message={confirmDelete ? `Delete ${assetName(confirmDelete)} permanently from Webflow?` : ''}
        confirmLabel="Delete"
        variant="destructive"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => { if (confirmDelete) void handleDeleteAsset(confirmDelete); }}
      />
      <ConfirmDialog
        open={confirmBulkDelete}
        title="Delete selected assets?"
        message={`Delete ${selectedIds.size} selected assets permanently from Webflow?`}
        confirmLabel="Delete selected"
        variant="destructive"
        onCancel={() => setConfirmBulkDelete(false)}
        onConfirm={() => void handleBulkDelete()}
      />
    </div>
  );
}

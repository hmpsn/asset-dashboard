import { useState, useEffect } from 'react';
import {
  AlertTriangle, Image, Trash2, Sparkles, Loader2,
  CheckCircle, XCircle, FileWarning, Eye, Search,
  Minimize2, RefreshCw, ChevronDown, Download, X, Copy, CopyCheck, MessageSquareWarning,
} from 'lucide-react';
import { get, post, del } from '../api/client';
import { Icon, cn } from './ui';

interface AuditIssue {
  assetId: string;
  fileName: string;
  url?: string;
  fileSize?: number;
  issues: string[];
  usedIn: string[];
}

interface AuditResult {
  totalAssets: number;
  issueCount: number;
  missingAlt: number;
  oversized: number;
  unused: number;
  duplicates: number;
  lowQualityAlt: number;
  duplicateAlt: number;
  issues: AuditIssue[];
}

interface Props {
  siteId: string;
  workspaceId: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ISSUE_LABELS: Record<string, { label: string; color: string; bg: string; icon: typeof AlertTriangle }> = {
  'missing-alt': { label: 'Missing Alt Text', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30', icon: AlertTriangle },
  'low-quality-alt': { label: 'Low Quality Alt', color: 'text-yellow-500', bg: 'bg-yellow-500/10 border-yellow-500/30', icon: MessageSquareWarning },
  'duplicate-alt': { label: 'Duplicate Alt', color: 'text-yellow-600', bg: 'bg-yellow-600/10 border-yellow-600/30', icon: CopyCheck },
  'oversized': { label: 'Oversized (>500KB)', color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/30', icon: Image },
  'unoptimized-png': { label: 'Unoptimized PNG', color: 'text-orange-300', bg: 'bg-orange-400/10 border-orange-400/30', icon: FileWarning },
  'legacy-format': { label: 'Legacy Format', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30', icon: XCircle },
  'duplicate': { label: 'Possible Duplicate', color: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/30', icon: CopyCheck },
  'unused': { label: 'Unused', color: 'text-[var(--brand-text)]', bg: 'bg-[var(--surface-2)] border-[var(--brand-border)]', icon: Eye },
};

type SortField = 'name' | 'size' | 'issues';

function AssetAudit({ siteId, workspaceId }: Props) {
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [generatingAlt, setGeneratingAlt] = useState<Set<string>>(new Set());
  const [compressing, setCompressing] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [deletingUnused, setDeletingUnused] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [bulkAltProgress, setBulkAltProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkCompressProgress, setBulkCompressProgress] = useState<{ done: number; total: number; saved: number } | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortField>('issues');
  const [lightboxIssue, setLightboxIssue] = useState<AuditIssue | null>(null);

  const runAudit = () => {
    setLoading(true);
    setHasRun(true);
    get<AuditResult>(`/api/webflow/audit/${siteId}?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then(data => setAudit(data))
      .catch((err) => { console.error('AssetAudit operation failed:', err); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setAudit(null);
    setHasRun(false);
  }, [siteId]);

  const handleGenerateAlt = async (issue: AuditIssue) => {
    if (!issue.url) return;
    setGeneratingAlt(prev => new Set(prev).add(issue.assetId));
    try {
      const data = await post<{ altText?: string }>(`/api/webflow/${workspaceId}/generate-alt/${issue.assetId}`, { imageUrl: issue.url, siteId });
      if (data.altText && audit) {
        setAudit({
          ...audit,
          missingAlt: audit.missingAlt - 1,
          issues: audit.issues.map(i =>
            i.assetId === issue.assetId
              ? { ...i, issues: i.issues.filter(x => x !== 'missing-alt') }
              : i
          ),
        });
      }
    } catch (err) { console.error('AssetAudit operation failed:', err); }
    setGeneratingAlt(prev => { const n = new Set(prev); n.delete(issue.assetId); return n; });
  };

  const handleBulkGenerateAlt = async () => {
    if (!audit) return;
    const missing = filteredIssues.filter(i => i.issues.includes('missing-alt') && i.url);
    setBulkAltProgress({ done: 0, total: missing.length });
    for (let idx = 0; idx < missing.length; idx++) {
      await handleGenerateAlt(missing[idx]);
      setBulkAltProgress({ done: idx + 1, total: missing.length });
    }
    setBulkAltProgress(null);
  };

  const handleBulkCompress = async () => {
    if (!audit) return;
    const compressible = filteredIssues.filter(i => (i.issues.includes('oversized') || i.issues.includes('unoptimized-png')) && i.url);
    setBulkCompressProgress({ done: 0, total: compressible.length, saved: 0 });
    let totalSaved = 0;
    for (let idx = 0; idx < compressible.length; idx++) {
      const issue = compressible[idx];
      try {
        const data = await post<{ success?: boolean; savings?: number }>(`/api/webflow/${workspaceId}/compress/${issue.assetId}`, { imageUrl: issue.url, siteId, fileName: issue.fileName });
        if (data.success) totalSaved += (data.savings || 0);
      } catch (err) { console.error('AssetAudit operation failed:', err); }
      setBulkCompressProgress({ done: idx + 1, total: compressible.length, saved: totalSaved });
    }
    setBulkCompressProgress(null);
    runAudit(); // Re-scan to get updated state
  };

  const handleExportCSV = () => {
    if (!audit) return;
    const rows = [['Asset ID', 'Filename', 'File Size', 'Issues', 'Used On', 'URL']];
    for (const issue of audit.issues) {
      rows.push([
        issue.assetId,
        issue.fileName,
        issue.fileSize ? formatSize(issue.fileSize) : '',
        issue.issues.join('; '),
        issue.usedIn.join('; '),
        issue.url || '',
      ]);
    }
    const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `asset-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCompress = async (issue: AuditIssue) => {
    if (!issue.url) return;
    setCompressing(prev => new Set(prev).add(issue.assetId));
    try {
      const data = await post<{ success?: boolean; newAssetId?: string; newSize?: number }>(`/api/webflow/${workspaceId}/compress/${issue.assetId}`, { imageUrl: issue.url, siteId, fileName: issue.fileName });
      if (data.success && audit && data.newAssetId) {
        const newAssetId = data.newAssetId;
        const newSize = data.newSize ?? issue.fileSize;
        setAudit({
          ...audit,
          oversized: Math.max(0, audit.oversized - 1),
          issues: audit.issues.map(i =>
            i.assetId === issue.assetId
              ? { ...i, assetId: newAssetId, issues: i.issues.filter(x => x !== 'oversized' && x !== 'unoptimized-png'), fileSize: newSize }
              : i
          ),
        });
      }
    } catch (err) { console.error('AssetAudit operation failed:', err); }
    setCompressing(prev => { const n = new Set(prev); n.delete(issue.assetId); return n; });
  };

  const handleDeleteAsset = async (issue: AuditIssue) => {
    setDeletingIds(prev => new Set(prev).add(issue.assetId));
    try {
      await del(`/api/webflow/assets/${issue.assetId}?siteId=${encodeURIComponent(siteId)}&workspaceId=${encodeURIComponent(workspaceId)}`);
      if (audit) {
        const wasUnused = issue.issues.includes('unused');
        setAudit({
          ...audit,
          totalAssets: audit.totalAssets - 1,
          issueCount: audit.issueCount - 1,
          unused: wasUnused ? audit.unused - 1 : audit.unused,
          issues: audit.issues.filter(i => i.assetId !== issue.assetId),
        });
      }
    } catch (err) { console.error('AssetAudit operation failed:', err); }
    setDeletingIds(prev => { const n = new Set(prev); n.delete(issue.assetId); return n; });
  };

  const handleDeleteUnused = async () => {
    if (!audit) return;
    const unused = audit.issues.filter(i => i.issues.includes('unused'));
    if (!confirm(`Delete ${unused.length} unused assets permanently from Webflow?`)) return;
    setDeletingUnused(true);
    for (const issue of unused) {
      try {
        await del(`/api/webflow/assets/${issue.assetId}?siteId=${encodeURIComponent(siteId)}&workspaceId=${encodeURIComponent(workspaceId)}`);
      } catch (err) { console.error('AssetAudit operation failed:', err); }
    }
    setAudit({
      ...audit,
      totalAssets: audit.totalAssets - unused.length,
      unused: 0,
      issueCount: audit.issueCount - unused.length,
      issues: audit.issues.filter(i => !i.issues.includes('unused')),
    });
    setDeletingUnused(false);
  };

  const filteredIssues = (audit?.issues || [])
    .filter(i => activeFilter ? i.issues.includes(activeFilter) : true)
    .filter(i => {
      if (!search) return true;
      const q = search.toLowerCase();
      return i.fileName.toLowerCase().includes(q) || i.usedIn.some(u => u.toLowerCase().includes(q));
    })
    .sort((a, b) => {
      if (sort === 'size') return (b.fileSize || 0) - (a.fileSize || 0);
      if (sort === 'name') return a.fileName.localeCompare(b.fileName);
      return b.issues.length - a.issues.length;
    });

  // Compute extra stats
  const unoptimizedPngCount = audit?.issues.filter(i => i.issues.includes('unoptimized-png')).length || 0;

  if (!hasRun) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="w-16 h-16 rounded-[var(--radius-xl)] bg-[var(--surface-2)] flex items-center justify-center">
          <Icon as={AlertTriangle} size="2xl" className="text-[var(--brand-text-muted)]" />
        </div>
        <p className="text-[var(--brand-text)] t-body">Scan your Webflow site for asset issues</p>
        <p className="t-caption text-[var(--brand-text-muted)]">Checks for missing alt text, oversized files, unused assets, and more</p>
        <button
          onClick={runAudit}
          className="px-5 py-2.5 bg-teal-600 hover:bg-teal-500 rounded-[var(--radius-lg)] t-body font-medium transition-colors"
        >
          Run Asset Audit
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-[var(--brand-text-muted)]">
        <Loader2 className="w-6 h-6 animate-spin text-teal-400" />
        <p className="t-body">Scanning published pages, CMS collections, CSS, and assets...</p>
        <p className="t-caption text-[var(--brand-text-muted)]">This may take 30–60 seconds for large sites</p>
      </div>
    );
  }

  if (!audit) return null;

  const score = Math.max(0, Math.round(100 - (audit.issueCount / Math.max(audit.totalAssets, 1)) * 100));
  const scoreColor = score >= 80 ? 'text-emerald-400' : score >= 50 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="space-y-8">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        <button
          onClick={() => setActiveFilter(null)}
          className={cn('bg-[var(--surface-2)] p-5 border text-left transition-colors', activeFilter === null ? 'border-[var(--brand-border-hover)]' : 'border-[var(--brand-border)] hover:border-[var(--brand-border-hover)]')}
          style={{ borderRadius: 'var(--radius-signature)' }}
        >
          <div className={cn('text-3xl font-bold', scoreColor)}>{score}</div>
          <div className="t-caption text-[var(--brand-text-muted)] mt-1">Health Score</div>
          <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">{audit.totalAssets} total · {audit.issueCount} with issues</div>
        </button>

        <button
          onClick={() => setActiveFilter(activeFilter === 'missing-alt' ? null : 'missing-alt')}
          className={cn('bg-[var(--surface-2)] p-5 border text-left transition-colors', activeFilter === 'missing-alt' ? 'border-amber-500/50' : 'border-[var(--brand-border)] hover:border-[var(--brand-border-hover)]')}
          style={{ borderRadius: 'var(--radius-signature)' }}
        >
          <div className="text-3xl font-bold text-amber-400">{audit.missingAlt}</div>
          <div className="t-caption text-[var(--brand-text-muted)] mt-1">Missing Alt Text</div>
          {((audit.lowQualityAlt || 0) + (audit.duplicateAlt || 0)) > 0 && (
            <div className="t-caption-sm text-yellow-500 mt-0.5">+{(audit.lowQualityAlt || 0) + (audit.duplicateAlt || 0)} low quality</div>
          )}
        </button>

        <button
          onClick={() => setActiveFilter(activeFilter === 'oversized' ? null : 'oversized')}
          className={cn('bg-[var(--surface-2)] p-5 border text-left transition-colors', activeFilter === 'oversized' ? 'border-orange-500/50' : 'border-[var(--brand-border)] hover:border-[var(--brand-border-hover)]')}
          style={{ borderRadius: 'var(--radius-signature)' }}
        >
          <div className="text-3xl font-bold text-orange-400">{audit.oversized}</div>
          <div className="t-caption text-[var(--brand-text-muted)] mt-1">Oversized</div>
          {unoptimizedPngCount > 0 && (
            <div className="t-caption-sm text-orange-300 mt-0.5">+{unoptimizedPngCount} unoptimized PNG</div>
          )}
        </button>

        <button
          onClick={() => setActiveFilter(activeFilter === 'unused' ? null : 'unused')}
          className={cn('bg-[var(--surface-2)] p-5 border text-left transition-colors',
            activeFilter === 'unused'
              ? 'border-zinc-500/50' // raw-zinc-ok
              : 'border-[var(--brand-border)] hover:border-[var(--brand-border-hover)]'
          )}
          style={{ borderRadius: 'var(--radius-signature)' }}
        >
          <div className="text-3xl font-bold text-[var(--brand-text)]">{audit.unused}</div>
          <div className="t-caption text-[var(--brand-text-muted)] mt-1">Unused</div>
          {(audit.duplicates || 0) > 0 && (
            <div className="t-caption-sm text-cyan-400 mt-0.5">{audit.duplicates} possible duplicates</div>
          )}
        </button>
      </div>

      {/* Secondary filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {[['low-quality-alt', `Low Quality Alt (${audit.lowQualityAlt || 0})`, 'text-yellow-500 border-yellow-500/30'],
          ['duplicate-alt', `Duplicate Alt (${audit.duplicateAlt || 0})`, 'text-yellow-600 border-yellow-600/30'],
          ['duplicate', `Duplicates (${audit.duplicates || 0})`, 'text-cyan-400 border-cyan-500/30'],
          ['unoptimized-png', `Unoptimized PNG (${unoptimizedPngCount})`, 'text-orange-300 border-orange-400/30'],
          ['legacy-format', `Legacy Format`, 'text-red-400 border-red-500/30'],
        ].map(([key, label, colors]) => (
          <button
            key={key}
            onClick={() => setActiveFilter(activeFilter === key ? null : key)}
            className={cn('t-caption-sm px-2.5 py-1 rounded-[var(--radius-pill)] border transition-colors', activeFilter === key ? `${colors} bg-[var(--surface-2)]` : 'text-[var(--brand-text-muted)] border-[var(--brand-border)] hover:border-[var(--brand-border-hover)]')}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Bulk progress bars */}
      {bulkAltProgress && (
        <div className="flex items-center gap-3 px-4 py-3 bg-teal-950/50 border border-teal-800/50 rounded-[var(--radius-lg)]">
          <Loader2 className="w-4 h-4 animate-spin text-teal-400" />
          <div className="flex-1">
            <div className="t-body text-teal-200">
              Generating alt text... {bulkAltProgress.done}/{bulkAltProgress.total}
            </div>
            <div className="mt-1.5 h-1.5 bg-teal-950 rounded-[var(--radius-pill)] overflow-hidden">
              <div
                className="h-full bg-teal-500 rounded-[var(--radius-pill)] transition-all duration-300"
                style={{ width: `${(bulkAltProgress.done / bulkAltProgress.total) * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}
      {bulkCompressProgress && (
        <div className="flex items-center gap-3 px-4 py-3 bg-blue-950/50 border border-blue-800/50 rounded-[var(--radius-lg)]">
          <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
          <div className="flex-1">
            <div className="t-body text-blue-200">
              Compressing... {bulkCompressProgress.done}/{bulkCompressProgress.total}
              {bulkCompressProgress.saved > 0 && (
                <span className="text-emerald-400 ml-2">({formatSize(bulkCompressProgress.saved)} saved)</span>
              )}
            </div>
            <div className="mt-1.5 h-1.5 bg-blue-950 rounded-[var(--radius-pill)] overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-[var(--radius-pill)] transition-all duration-300"
                style={{ width: `${(bulkCompressProgress.done / bulkCompressProgress.total) * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Sticky toolbar */}
      <div className="sticky top-0 z-[var(--z-sticky)] bg-[var(--surface-1)]/95 backdrop-blur-sm py-2 space-y-3">
        {/* Search + sort */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--brand-text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search issues by name or page..."
              className="w-full pl-10 pr-4 py-2 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] t-body focus:outline-none focus:border-[var(--brand-border-hover)]"
            />
          </div>
          <div className="relative">
            <select
              value={sort}
              onChange={e => setSort(e.target.value as SortField)}
              className="appearance-none pl-3 pr-8 py-2 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] t-body focus:outline-none cursor-pointer"
            >
              <option value="issues">Most Issues</option>
              <option value="size">Largest</option>
              <option value="name">Name</option>
            </select>
            <Icon as={ChevronDown} size="md" className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)] pointer-events-none" />
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-2">
          {activeFilter === 'missing-alt' && audit.missingAlt > 0 && (
            <button
              onClick={handleBulkGenerateAlt}
              disabled={!!bulkAltProgress}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-[var(--radius-lg)] t-caption font-medium transition-colors"
            >
              <Icon as={Sparkles} size="md" />
              {bulkAltProgress
                ? `${bulkAltProgress.done}/${bulkAltProgress.total}`
                : `Generate All (${filteredIssues.filter(i => i.issues.includes('missing-alt')).length})`}
            </button>
          )}
          {(activeFilter === 'oversized' || activeFilter === 'unoptimized-png') && (
            <button
              onClick={handleBulkCompress}
              disabled={!!bulkCompressProgress}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 rounded-[var(--radius-lg)] t-caption font-medium transition-colors"
            >
              <Icon as={Minimize2} size="md" />
              {bulkCompressProgress
                ? `${bulkCompressProgress.done}/${bulkCompressProgress.total}`
                : `Compress All (${filteredIssues.filter(i => i.issues.includes('oversized') || i.issues.includes('unoptimized-png')).length})`}
            </button>
          )}
          {activeFilter === 'unused' && audit.unused > 0 && (
            <button
              onClick={handleDeleteUnused}
              disabled={deletingUnused}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-900/50 hover:bg-red-800 text-red-300 rounded-[var(--radius-lg)] t-caption font-medium transition-colors"
            >
              <Icon as={Trash2} size="md" />
              {deletingUnused ? 'Deleting...' : `Delete All Unused (${audit.unused})`}
            </button>
          )}
          {!activeFilter && (
            <>
              {audit.missingAlt > 0 && (
                <button
                  onClick={handleBulkGenerateAlt}
                  disabled={!!bulkAltProgress}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-[var(--radius-lg)] t-caption font-medium transition-colors"
                >
                  <Icon as={Sparkles} size="md" /> Generate All Alt Text ({audit.missingAlt})
                </button>
              )}
              {(audit.oversized > 0 || unoptimizedPngCount > 0) && (
                <button
                  onClick={handleBulkCompress}
                  disabled={!!bulkCompressProgress}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 rounded-[var(--radius-lg)] t-caption font-medium transition-colors"
                >
                  <Icon as={Minimize2} size="md" /> Compress All ({audit.oversized + unoptimizedPngCount})
                </button>
              )}
              {audit.unused > 0 && (
                <button
                  onClick={handleDeleteUnused}
                  disabled={deletingUnused}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-900/50 hover:bg-red-800 text-red-300 rounded-[var(--radius-lg)] t-caption font-medium transition-colors"
                >
                  <Icon as={Trash2} size="md" /> Remove Unused ({audit.unused})
                </button>
              )}
            </>
          )}
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--surface-2)] hover:bg-[var(--surface-3)] rounded-[var(--radius-lg)] t-caption font-medium transition-colors"
            title="Export audit as CSV"
          >
            <Icon as={Download} size="md" /> Export
          </button>
          <button
            onClick={runAudit}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--surface-2)] hover:bg-[var(--surface-3)] rounded-[var(--radius-lg)] t-caption font-medium transition-colors ml-auto"
          >
            <Icon as={RefreshCw} size="md" /> Re-scan
          </button>
        </div>
      </div>

      {/* Showing count */}
      <div className="t-caption text-[var(--brand-text-muted)] px-1">
        Showing {filteredIssues.length} of {audit.issues.length} issues
        {activeFilter && (
          <button onClick={() => setActiveFilter(null)} className="ml-2 text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] underline">
            Clear filter
          </button>
        )}
      </div>

      {/* Issue list */}
      <div className="space-y-2">
        {filteredIssues.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-[var(--brand-text-muted)] gap-2">
            <Icon as={CheckCircle} size="2xl" className="text-emerald-400" />
            <p className="t-body">{activeFilter ? 'No issues in this category' : 'All clear! No issues found.'}</p>
          </div>
        ) : (
          filteredIssues.map(issue => (
            <div key={issue.assetId} className="flex items-center gap-3 px-4 py-3 bg-[var(--surface-2)] hover:bg-[var(--surface-3)]/50 border border-[var(--brand-border)] transition-colors group" style={{ borderRadius: 'var(--radius-signature)' }}>
              {/* Thumbnail — click for lightbox */}
              <button
                className="w-10 h-10 rounded-[var(--radius-sm)] bg-[var(--surface-3)] overflow-hidden flex-shrink-0 flex items-center justify-center cursor-pointer hover:ring-2 hover:ring-zinc-600 transition-all"
                onClick={() => issue.url && setLightboxIssue(issue)}
              >
                {issue.url ? (
                  <img src={issue.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                ) : (
                  <Icon as={Image} size="md" className="text-[var(--brand-text-muted)]" />
                )}
              </button>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="t-body font-medium text-[var(--brand-text-bright)] truncate">{issue.fileName}</div>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  {issue.issues.map(issueType => {
                    const info = ISSUE_LABELS[issueType];
                    if (!info) return null;
                    const IssueIcon = info.icon;
                    return (
                      <span key={issueType} className={cn('inline-flex items-center gap-1 t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-sm)] border', info.bg, info.color)}>
                        <Icon as={IssueIcon} size="sm" /> {info.label}
                      </span>
                    );
                  })}
                  {issue.fileSize && issue.fileSize > 0 && (
                    <span className="t-caption-sm text-[var(--brand-text-muted)]">{formatSize(issue.fileSize)}</span>
                  )}
                </div>
              </div>

              {/* Usage */}
              <div className="t-caption text-[var(--brand-text-muted)] w-36 truncate text-right" title={issue.usedIn.join(', ')}>
                {issue.usedIn.length > 0 ? (
                  <span>{issue.usedIn.length} page{issue.usedIn.length !== 1 ? 's' : ''}</span>
                ) : (
                  <span className="italic">Not used</span>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                {issue.issues.includes('missing-alt') && issue.url && (
                  <button
                    onClick={() => handleGenerateAlt(issue)}
                    disabled={generatingAlt.has(issue.assetId)}
                    className="p-1.5 rounded-[var(--radius-sm)] text-[var(--brand-text-muted)] hover:text-teal-400 hover:bg-[var(--surface-3)] transition-colors"
                    title="Generate alt text"
                  >
                    {generatingAlt.has(issue.assetId) ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Icon as={Sparkles} size="md" />
                    )}
                  </button>
                )}
                {(issue.issues.includes('oversized') || issue.issues.includes('unoptimized-png')) && issue.url && (
                  <button
                    onClick={() => handleCompress(issue)}
                    disabled={compressing.has(issue.assetId)}
                    className="p-1.5 rounded-[var(--radius-sm)] text-[var(--brand-text-muted)] hover:text-blue-400 hover:bg-[var(--surface-3)] transition-colors"
                    title="Compress image"
                  >
                    {compressing.has(issue.assetId) ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Icon as={Minimize2} size="md" />
                    )}
                  </button>
                )}
                {issue.issues.includes('unused') && (
                  <button
                    onClick={() => handleDeleteAsset(issue)}
                    disabled={deletingIds.has(issue.assetId)}
                    className="p-1.5 rounded-[var(--radius-sm)] text-[var(--brand-text-muted)] hover:text-red-400 hover:bg-[var(--surface-3)] transition-colors"
                    title="Delete unused asset"
                  >
                    {deletingIds.has(issue.assetId) ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Icon as={Trash2} size="md" />
                    )}
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      {/* Lightbox modal */}
      {lightboxIssue && lightboxIssue.url && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/80 backdrop-blur-sm" // fixed-inset-ok — image lightbox
            onClick={() => setLightboxIssue(null)}>
          <div className="relative max-w-4xl max-h-[90vh] w-full mx-4" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setLightboxIssue(null)}
              className="absolute -top-10 right-0 p-1.5 text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] transition-colors"
            >
              <Icon as={X} size="lg" />
            </button>
            <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden" style={{ borderRadius: 'var(--radius-signature)' }}>
              <div className="flex items-center justify-center bg-[var(--surface-1)] p-6 min-h-[300px] max-h-[60vh]">
                <img
                  src={lightboxIssue.url}
                  alt={lightboxIssue.fileName}
                  className="max-w-full max-h-[55vh] object-contain"
                />
              </div>
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="t-body font-medium text-[var(--brand-text-bright)] truncate">{lightboxIssue.fileName}</div>
                  {lightboxIssue.fileSize && lightboxIssue.fileSize > 0 && (
                    <span className="t-caption text-[var(--brand-text-muted)] flex-shrink-0 ml-3">{formatSize(lightboxIssue.fileSize)}</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {lightboxIssue.issues.map(issueType => {
                    const info = ISSUE_LABELS[issueType];
                    if (!info) return null;
                    const IssueIcon = info.icon;
                    return (
                      <span key={issueType} className={cn('inline-flex items-center gap-1 t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-sm)] border', info.bg, info.color)}>
                        <Icon as={IssueIcon} size="sm" /> {info.label}
                      </span>
                    );
                  })}
                </div>
                {lightboxIssue.usedIn.length > 0 && (
                  <div className="t-caption text-[var(--brand-text-muted)]">
                    <span>Used on:</span>{' '}
                    {lightboxIssue.usedIn.join(', ')}
                  </div>
                )}
                <div className="flex items-center gap-2 pt-1">
                  {lightboxIssue.issues.includes('missing-alt') && lightboxIssue.url && (
                    <button
                      onClick={() => handleGenerateAlt(lightboxIssue)}
                      disabled={generatingAlt.has(lightboxIssue.assetId)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-[var(--radius-sm)] t-caption font-medium transition-colors"
                    >
                      {generatingAlt.has(lightboxIssue.assetId) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Icon as={Sparkles} size="sm" />}
                      Generate Alt Text
                    </button>
                  )}
                  {(lightboxIssue.issues.includes('oversized') || lightboxIssue.issues.includes('unoptimized-png')) && lightboxIssue.url && (
                    <button
                      onClick={() => handleCompress(lightboxIssue)}
                      disabled={compressing.has(lightboxIssue.assetId)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 rounded-[var(--radius-sm)] t-caption font-medium transition-colors"
                    >
                      {compressing.has(lightboxIssue.assetId) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Icon as={Minimize2} size="sm" />}
                      Compress
                    </button>
                  )}
                  {lightboxIssue.issues.includes('unused') && (
                    <button
                      onClick={() => { handleDeleteAsset(lightboxIssue); setLightboxIssue(null); }}
                      disabled={deletingIds.has(lightboxIssue.assetId)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-900/50 hover:bg-red-800 text-red-300 rounded-[var(--radius-sm)] t-caption font-medium transition-colors"
                    >
                      <Icon as={Trash2} size="sm" /> Delete
                    </button>
                  )}
                  <button
                    onClick={() => { navigator.clipboard.writeText(lightboxIssue.url || ''); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--surface-3)] hover:bg-[var(--surface-3)] rounded-[var(--radius-sm)] t-caption font-medium transition-colors ml-auto"
                  >
                    <Icon as={Copy} size="sm" /> Copy URL
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { AssetAudit };

// @ds-rebuilt
import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Image,
  Loader2,
  Minimize2,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { ApiError, del, get, post } from '../../api/client';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  Drawer,
  EmptyState,
  FilterChip,
  Icon,
  IconButton,
  InlineBanner,
  Meter,
  MetricTile,
  SearchField,
  Toolbar,
  ToolbarSpacer,
  Tooltip,
  FormSelect,
  scoreColor,
  type DataColumn,
} from '../ui';
import { useToast } from '../Toast';
import { formatBytes } from '../../utils/formatNumbers';
import { mutationErrorMessage } from './assetManagerMutationFeedback';
import {
  AUDIT_ISSUE_FILTERS,
  type AuditIssue,
  type AuditIssueFilter,
  type AuditResult,
  type AuditSort,
  type BulkProgress,
  type BulkResult,
} from './types';

interface AuditLensProps {
  siteId: string;
  workspaceId: string;
  search: string;
  searchInput: string;
  onSearchChange: (value: string) => void;
  activeFilter: AuditIssueFilter | null;
  onFilterChange: (filter: AuditIssueFilter | null) => void;
  sort: AuditSort;
  onSortChange: (sort: AuditSort) => void;
  quotaLocked: boolean;
  quotaReason: string;
  onQuotaHit: (partial?: { done: number; total: number }) => void;
}

function AuditEmptyIcon({ className }: { className?: string }) {
  return <Icon as={AlertTriangle} className={className} />;
}

function issueLabel(issue: string): string {
  return AUDIT_ISSUE_FILTERS.find((item) => item.id === issue)?.label ?? issue;
}

function isQuotaError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 429;
}

function healthTone(score: number): string {
  return scoreColor(score);
}

export function AuditLens({
  siteId,
  workspaceId,
  search,
  searchInput,
  onSearchChange,
  activeFilter,
  onFilterChange,
  sort,
  onSortChange,
  quotaLocked,
  quotaReason,
  onQuotaHit,
}: AuditLensProps) {
  const { toast } = useToast();
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [bulkAltProgress, setBulkAltProgress] = useState<BulkProgress | null>(null);
  const [bulkCompressProgress, setBulkCompressProgress] = useState<{ done: number; total: number; saved: number } | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [selectedIssue, setSelectedIssue] = useState<AuditIssue | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AuditIssue | null>(null);
  const [confirmDeleteUnused, setConfirmDeleteUnused] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);

  const runAudit = async () => {
    setLoading(true);
    setHasRun(true);
    setResult(null);
    try {
      const data = await get<AuditResult>(`/api/webflow/audit/${siteId}?workspaceId=${encodeURIComponent(workspaceId)}`);
      setAudit(data);
      toast('Asset audit complete', 'success');
    } catch (error) {
      toast(mutationErrorMessage(error, 'Asset audit failed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const issueCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const issue of audit?.issues ?? []) {
      for (const issueType of issue.issues) {
        counts.set(issueType, (counts.get(issueType) ?? 0) + 1);
      }
    }
    return counts;
  }, [audit?.issues]);

  const filteredIssues = useMemo(() => {
    const query = search.toLowerCase();
    return [...(audit?.issues ?? [])]
      .filter((issue) => (activeFilter ? issue.issues.includes(activeFilter) : true))
      .filter((issue) => {
        if (!query) return true;
        return issue.fileName.toLowerCase().includes(query)
          || issue.usedIn.some((pageName) => pageName.toLowerCase().includes(query));
      })
      .sort((a, b) => {
        if (sort === 'size') return (b.fileSize || 0) - (a.fileSize || 0);
        if (sort === 'name') return a.fileName.localeCompare(b.fileName);
        return b.issues.length - a.issues.length;
      });
  }, [activeFilter, audit?.issues, search, sort]);

  const setBusy = (assetId: string, busy: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(assetId);
      else next.delete(assetId);
      return next;
    });
  };

  const removeIssueType = (assetId: string, issueTypes: string[]) => {
    setAudit((prev) => {
      if (!prev) return prev;
      const nextIssues = prev.issues
        .map((issue) => issue.assetId === assetId
          ? { ...issue, issues: issue.issues.filter((item) => !issueTypes.includes(item)) }
          : issue)
        .filter((issue) => issue.issues.length > 0);
      return {
        ...prev,
        issueCount: nextIssues.length,
        missingAlt: nextIssues.filter((issue) => issue.issues.includes('missing-alt')).length,
        oversized: nextIssues.filter((issue) => issue.issues.includes('oversized')).length,
        unused: nextIssues.filter((issue) => issue.issues.includes('unused')).length,
        duplicates: nextIssues.filter((issue) => issue.issues.includes('duplicate')).length,
        lowQualityAlt: nextIssues.filter((issue) => issue.issues.includes('low-quality-alt')).length,
        duplicateAlt: nextIssues.filter((issue) => issue.issues.includes('duplicate-alt')).length,
        issues: nextIssues,
      };
    });
  };

  const handleGenerateAlt = async (issue: AuditIssue): Promise<'saved' | 'failed' | 'quota'> => {
    if (!issue.url || quotaLocked) return 'failed';
    setBusy(issue.assetId, true);
    try {
      const data = await post<{ altText?: string }>(`/api/webflow/${workspaceId}/generate-alt/${issue.assetId}`, {
        imageUrl: issue.url,
        siteId,
      });
      if (data.altText) {
        removeIssueType(issue.assetId, ['missing-alt']);
        return 'saved';
      }
      return 'failed';
    } catch (error) {
      if (isQuotaError(error)) {
        onQuotaHit();
        return 'quota';
      }
      toast(mutationErrorMessage(error, 'Alt text generation failed'), 'error');
      return 'failed';
    } finally {
      setBusy(issue.assetId, false);
    }
  };

  const handleCompress = async (issue: AuditIssue): Promise<number> => {
    if (!issue.url) return 0;
    setBusy(issue.assetId, true);
    try {
      const data = await post<{ success?: boolean; savings?: number; newAssetId?: string; newSize?: number }>(
        `/api/webflow/${workspaceId}/compress/${issue.assetId}`,
        { imageUrl: issue.url, siteId, fileName: issue.fileName },
      );
      if (data.success) {
        removeIssueType(issue.assetId, ['oversized', 'unoptimized-png']);
        return data.savings ?? 0;
      }
      return 0;
    } catch (error) {
      toast(mutationErrorMessage(error, 'Image compression failed'), 'error');
      return 0;
    } finally {
      setBusy(issue.assetId, false);
    }
  };

  const handleDeleteAsset = async (issue: AuditIssue) => {
    setBusy(issue.assetId, true);
    try {
      await del(`/api/webflow/assets/${issue.assetId}?siteId=${encodeURIComponent(siteId)}&workspaceId=${encodeURIComponent(workspaceId)}`);
      setAudit((prev) => {
        if (!prev) return prev;
        const nextIssues = prev.issues.filter((item) => item.assetId !== issue.assetId);
        return {
          ...prev,
          totalAssets: Math.max(0, prev.totalAssets - 1),
          issueCount: nextIssues.length,
          unused: nextIssues.filter((item) => item.issues.includes('unused')).length,
          issues: nextIssues,
        };
      });
      setSelectedIssue(null);
      toast('Asset deleted', 'success');
    } catch (error) {
      toast(mutationErrorMessage(error, 'Asset delete failed'), 'error');
    } finally {
      setBusy(issue.assetId, false);
      setConfirmDelete(null);
    }
  };

  const handleBulkGenerateAlt = async () => {
    const missing = filteredIssues.filter((issue) => issue.issues.includes('missing-alt') && issue.url);
    if (missing.length === 0) return;
    setBulkAltProgress({ done: 0, total: missing.length });
    let saved = 0;
    for (let index = 0; index < missing.length; index++) {
      if (quotaLocked) {
        onQuotaHit({ done: index, total: missing.length });
        break;
      }
      const resultCode = await handleGenerateAlt(missing[index]);
      if (resultCode === 'saved') saved += 1;
      const done = index + 1;
      setBulkAltProgress({ done, total: missing.length });
      if (resultCode === 'quota') {
        onQuotaHit({ done: index, total: missing.length });
        break;
      }
    }
    setBulkAltProgress(null);
    const failed = missing.length - saved;
    setResult({
      tone: failed > 0 ? 'warning' : 'success',
      title: 'Bulk alt text finished',
      message: `${saved} saved${failed > 0 ? `, ${failed} not updated` : ''}.`,
    });
  };

  const handleBulkCompress = async () => {
    const compressible = filteredIssues.filter((issue) =>
      (issue.issues.includes('oversized') || issue.issues.includes('unoptimized-png')) && issue.url
    );
    if (compressible.length === 0) return;
    setBulkCompressProgress({ done: 0, total: compressible.length, saved: 0 });
    let totalSaved = 0;
    for (let index = 0; index < compressible.length; index++) {
      totalSaved += await handleCompress(compressible[index]);
      setBulkCompressProgress({ done: index + 1, total: compressible.length, saved: totalSaved });
    }
    setBulkCompressProgress(null);
    setResult({
      tone: 'success',
      title: 'Bulk compression finished',
      message: `Estimated ${formatBytes(totalSaved)} saved. Re-scan for the latest issue list.`,
    });
  };

  const handleDeleteUnused = async () => {
    if (!audit) return;
    const unused = audit.issues.filter((issue) => issue.issues.includes('unused'));
    let deleted = 0;
    for (const issue of unused) {
      try {
        await del(`/api/webflow/assets/${issue.assetId}?siteId=${encodeURIComponent(siteId)}&workspaceId=${encodeURIComponent(workspaceId)}`);
        deleted += 1;
      } catch (error) {
        toast(mutationErrorMessage(error, 'One unused asset delete failed'), 'error');
      }
    }
    setAudit((prev) => prev ? {
      ...prev,
      totalAssets: Math.max(0, prev.totalAssets - deleted),
      issueCount: prev.issues.filter((issue) => !issue.issues.includes('unused')).length,
      unused: 0,
      issues: prev.issues.filter((issue) => !issue.issues.includes('unused')),
    } : prev);
    setConfirmDeleteUnused(false);
    setResult({
      tone: deleted === unused.length ? 'success' : 'warning',
      title: 'Unused delete finished',
      message: `${deleted} of ${unused.length} unused assets deleted.`,
    });
  };

  const handleExportCSV = () => {
    if (!audit) return;
    const rows = [['Asset ID', 'Filename', 'File Size', 'Issues', 'Used On', 'URL']];
    for (const issue of audit.issues) {
      rows.push([
        issue.assetId,
        issue.fileName,
        issue.fileSize ? formatBytes(issue.fileSize) : '',
        issue.issues.join('; '),
        issue.usedIn.join('; '),
        issue.url || '',
      ]);
    }
    const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `asset-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const columns: DataColumn[] = [
    {
      key: 'fileName',
      label: 'Asset',
      width: 'minmax(280px, 1.4fr)',
      sortable: true,
      render: (_value, row) => {
        const issue = row.issue as AuditIssue;
        return (
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 flex-none items-center justify-center overflow-hidden rounded-[var(--radius-md)] bg-[var(--surface-1)]">
              {issue.url ? <img src={issue.url} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Icon as={Image} size="md" className="text-[var(--brand-text-dim)]" />}
            </div>
            <div className="min-w-0">
              <div className="truncate t-ui font-semibold text-[var(--brand-text-bright)]">{issue.fileName}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {issue.issues.map((item) => (
                  <Badge key={item} label={issueLabel(item)} tone={item === 'unused' ? 'red' : item.includes('alt') ? 'amber' : 'blue'} variant="soft" size="sm" />
                ))}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      key: 'usedIn',
      label: 'Used on',
      width: 'minmax(190px, 1fr)',
      render: (_value, row) => {
        const issue = row.issue as AuditIssue;
        return issue.usedIn.length > 0
          ? <span className="truncate t-caption text-[var(--brand-text-muted)]">{issue.usedIn.join(', ')}</span>
          : <span className="t-caption text-[var(--brand-text-muted)]">Not used</span>;
      },
    },
    {
      key: 'fileSize',
      label: 'Size',
      width: '96px',
      align: 'right',
      sortable: true,
      render: (value) => value ? formatBytes(Number(value)) : '—',
    },
    {
      key: 'actions',
      label: '',
      width: '136px',
      align: 'right',
      render: (_value, row) => {
        const issue = row.issue as AuditIssue;
        const busy = busyIds.has(issue.assetId);
        return (
          <div className="flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
            <Tooltip content={quotaLocked ? quotaReason : 'Generate missing alt text'} placement="top">
              <span className="inline-flex" tabIndex={0}>
                <IconButton
                  icon={busy ? Loader2 : Sparkles}
                  label="Generate alt text"
                  size="sm"
                  variant="solid"
                  disabled={quotaLocked || busy || !issue.url || !issue.issues.includes('missing-alt')}
                  onClick={() => void handleGenerateAlt(issue)}
                />
              </span>
            </Tooltip>
            <IconButton
              icon={Minimize2}
              label="Compress image"
              size="sm"
              variant="solid"
              disabled={busy || !issue.url || !(issue.issues.includes('oversized') || issue.issues.includes('unoptimized-png'))}
              onClick={() => void handleCompress(issue)}
            />
            {issue.issues.includes('unused') && (
              <IconButton
                icon={Trash2}
                label="Delete unused asset"
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() => setConfirmDelete(issue)}
              />
            )}
          </div>
        );
      },
    },
  ];

  if (!hasRun && !loading) {
    return (
      <EmptyState
        icon={AuditEmptyIcon}
        title="Run an asset audit"
        description="Scan published pages, CMS fields, CSS, and the Webflow asset library for missing alt text, oversized files, duplicates, legacy formats, and unused assets."
        action={(
          <Button size="md" variant="primary" onClick={() => void runAudit()}>
            <Icon as={RefreshCw} size="sm" />
            Run Asset Audit
          </Button>
        )}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 text-[var(--brand-text-muted)]">
        <Icon as={Loader2} size="lg" className="animate-spin text-[var(--teal)]" />
        <p className="t-body">Scanning published pages, CMS collections, CSS, and assets...</p>
        <p className="t-caption">Large sites can take 30-60 seconds.</p>
      </div>
    );
  }

  if (!audit) return null;

  const serverScore = typeof audit.healthScore === 'number' ? audit.healthScore : null;
  const rows = filteredIssues.map((issue) => ({
    id: issue.assetId,
    fileName: issue.fileName,
    fileSize: issue.fileSize ?? 0,
    usedIn: issue.usedIn.join(', '),
    issue,
  }));

  return (
    <div className="flex flex-col gap-4">
      {result && (
        <InlineBanner tone={result.tone} title={result.title} onDismiss={() => setResult(null)}>
          {result.message}
        </InlineBanner>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {serverScore != null ? (
          <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-[15px] py-[13px]">
            <Meter value={serverScore} color={healthTone(serverScore)} label="Health score" showValue />
            <div className="mt-2 t-caption-sm text-[var(--brand-text-muted)]">{audit.totalAssets} total assets · {audit.issueCount} with issues</div>
          </div>
        ) : (
          <MetricTile label="Health score" value="—" sub="Awaiting server score" accent="var(--brand-text-bright)" />
        )}
        <MetricTile label="Missing alt" value={audit.missingAlt} accent="var(--amber)" />
        <MetricTile label="Oversized" value={audit.oversized} accent="var(--blue)" />
        <MetricTile label="Unused" value={audit.unused} accent="var(--red)" />
      </div>

      {serverScore == null && (
        <InlineBanner tone="info" title="Server score unavailable">
          This rebuild does not derive a health score in the browser. The meter appears when the audit endpoint provides an authoritative score.
        </InlineBanner>
      )}

      <div className="flex flex-wrap gap-2" aria-label="Audit issue filters">
        <FilterChip label="All issues" active={!activeFilter} count={audit.issues.length} onClick={() => onFilterChange(null)} />
        {AUDIT_ISSUE_FILTERS.map((filter) => (
          <FilterChip
            key={filter.id}
            label={filter.label}
            active={activeFilter === filter.id}
            count={issueCounts.get(filter.id) ?? 0}
            onClick={() => onFilterChange(activeFilter === filter.id ? null : filter.id)}
          />
        ))}
      </div>

      {bulkAltProgress && (
        <InlineBanner tone="info" title="Generating alt text">
          {bulkAltProgress.done} of {bulkAltProgress.total} processed.
        </InlineBanner>
      )}
      {bulkCompressProgress && (
        <InlineBanner tone="info" title="Compressing images">
          {bulkCompressProgress.done} of {bulkCompressProgress.total} processed · {formatBytes(bulkCompressProgress.saved)} saved.
        </InlineBanner>
      )}

      <Toolbar label="Audit controls">
        <SearchField value={searchInput} onChange={onSearchChange} placeholder="Search issues by asset or page..." className="min-w-[260px]" />
        <FormSelect
          value={sort}
          onChange={(value) => onSortChange(value as AuditSort)}
          options={[
            { value: 'issues', label: 'Most issues' },
            { value: 'size', label: 'Largest' },
            { value: 'name', label: 'Name' },
          ]}
          className="w-[160px]"
          aria-label="Sort audit issues"
        />
        <ToolbarSpacer />
        <Button size="sm" variant="secondary" onClick={handleExportCSV}>
          <Icon as={Download} size="sm" />
          Export CSV
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void runAudit()}>
          <Icon as={RefreshCw} size="sm" />
          Re-scan
        </Button>
      </Toolbar>

      <Toolbar label="Audit bulk actions">
        <Button
          size="sm"
          variant="secondary"
          disabled={quotaLocked || !!bulkAltProgress}
          onClick={() => void handleBulkGenerateAlt()}
        >
          <Icon as={Sparkles} size="sm" />
          Generate all alt ({filteredIssues.filter((issue) => issue.issues.includes('missing-alt')).length})
        </Button>
        <Button size="sm" variant="secondary" disabled={!!bulkCompressProgress} onClick={() => void handleBulkCompress()}>
          <Icon as={Minimize2} size="sm" />
          Compress all ({filteredIssues.filter((issue) => issue.issues.includes('oversized') || issue.issues.includes('unoptimized-png')).length})
        </Button>
        <Button size="sm" variant="danger" disabled={audit.unused === 0} onClick={() => setConfirmDeleteUnused(true)}>
          <Icon as={Trash2} size="sm" />
          Delete all unused ({audit.unused})
        </Button>
      </Toolbar>

      <div className="t-caption text-[var(--brand-text-muted)]">
        Showing {filteredIssues.length} of {audit.issues.length} issue rows
      </div>

      {filteredIssues.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={activeFilter || search ? 'No matching issues' : 'All clear'}
          description={activeFilter || search ? 'Clear the audit filter or search to see all issue rows.' : 'The audit did not find any asset issues.'}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(row) => String(row.id)}
          onRowClick={(row) => setSelectedIssue(row.issue as AuditIssue)}
          style={{ minWidth: '980px' }}
        />
      )}

      <Drawer
        open={!!selectedIssue}
        onClose={() => setSelectedIssue(null)}
        title={selectedIssue?.fileName}
        subtitle={selectedIssue?.usedIn.length ? `Used on ${selectedIssue.usedIn.join(', ')}` : 'Not used on scanned pages'}
        eyebrow="Audit issue"
        width={560}
      >
        {selectedIssue && (
          <div className="flex flex-col gap-4">
            <div className="flex min-h-[260px] items-center justify-center overflow-hidden rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-4">
              {selectedIssue.url ? <img src={selectedIssue.url} alt="" className="max-h-[320px] max-w-full object-contain" /> : <Icon as={Image} size="2xl" className="text-[var(--brand-text-dim)]" />}
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedIssue.issues.map((issue) => (
                <Badge key={issue} label={issueLabel(issue)} tone={issue === 'unused' ? 'red' : issue.includes('alt') ? 'amber' : 'blue'} variant="soft" size="sm" />
              ))}
            </div>
            {selectedIssue.fileSize != null && (
              <div className="t-caption text-[var(--brand-text-muted)]">File size: {formatBytes(selectedIssue.fileSize)}</div>
            )}
            {selectedIssue.usedIn.length > 0 && (
              <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-4">
                <div className="mb-2 t-label text-[var(--brand-text-muted)]">Used on pages</div>
                <div className="flex flex-col gap-1">
                  {selectedIssue.usedIn.map((pageName) => (
                    <span key={pageName} className="t-caption text-[var(--brand-text)]">{pageName}</span>
                  ))}
                </div>
              </div>
            )}
            <Toolbar label="Audit issue actions" className="border-none bg-transparent p-0">
              {selectedIssue.issues.includes('missing-alt') && (
                <Button size="sm" variant="primary" disabled={quotaLocked || busyIds.has(selectedIssue.assetId)} onClick={() => void handleGenerateAlt(selectedIssue)}>
                  <Icon as={Sparkles} size="sm" />
                  Generate alt
                </Button>
              )}
              {(selectedIssue.issues.includes('oversized') || selectedIssue.issues.includes('unoptimized-png')) && (
                <Button size="sm" variant="secondary" disabled={busyIds.has(selectedIssue.assetId)} onClick={() => void handleCompress(selectedIssue)}>
                  <Icon as={Minimize2} size="sm" />
                  Compress
                </Button>
              )}
              {selectedIssue.issues.includes('unused') && (
                <Button size="sm" variant="danger" disabled={busyIds.has(selectedIssue.assetId)} onClick={() => setConfirmDelete(selectedIssue)}>
                  <Icon as={Trash2} size="sm" />
                  Delete
                </Button>
              )}
            </Toolbar>
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete asset?"
        message={confirmDelete ? `Delete ${confirmDelete.fileName} permanently from Webflow?` : ''}
        confirmLabel="Delete"
        variant="destructive"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => { if (confirmDelete) void handleDeleteAsset(confirmDelete); }}
      />
      <ConfirmDialog
        open={confirmDeleteUnused}
        title="Delete all unused assets?"
        message={`Delete ${audit.unused} unused assets permanently from Webflow?`}
        confirmLabel="Delete unused"
        variant="destructive"
        onCancel={() => setConfirmDeleteUnused(false)}
        onConfirm={() => void handleDeleteUnused()}
      />
    </div>
  );
}

import { useState } from 'react';
import {
  Download,
  FileText,
  FileSpreadsheet,
  Layout,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { useExportCopy } from '../../hooks/admin/useCopyPipeline';
import { SectionCard, Badge, EmptyState, Icon, Button, cn, FormSelect } from '../ui';
import { ErrorBoundary } from '../ErrorBoundary';
import type { ExportFormat, ExportScope } from '../../../shared/types/copy-pipeline';
import type { BlueprintEntry } from '../../../shared/types/page-strategy';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  workspaceId: string;
  blueprintId: string;
  entries: BlueprintEntry[];
}

// ─── Format option config ─────────────────────────────────────────────────────

interface FormatOption {
  value: ExportFormat;
  label: string;
  description: string;
  icon: typeof FileText;
  disabled?: boolean;
  disabledReason?: string;
}

const FORMAT_OPTIONS: FormatOption[] = [
  {
    value: 'csv',
    label: 'CSV',
    description: 'Spreadsheet-compatible comma-separated file',
    icon: FileSpreadsheet,
  },
  {
    value: 'copy_deck',
    label: 'Copy Deck',
    description: 'Formatted document for review and handoff',
    icon: FileText,
  },
  {
    value: 'webflow_cms',
    label: 'Webflow CMS',
    description: 'Push directly to Webflow CMS collections',
    icon: Layout,
    disabled: true,
    disabledReason: 'Requires Webflow connection',
  },
];

// ─── Scope option config ──────────────────────────────────────────────────────

interface ScopeOption {
  value: ExportScope;
  label: string;
  description: string;
}

const SCOPE_OPTIONS: ScopeOption[] = [
  {
    value: 'all',
    label: 'All approved',
    description: 'Every entry with at least one approved section',
  },
  {
    value: 'selected',
    label: 'Selected entries',
    description: 'Choose specific entries to export',
  },
  {
    value: 'single',
    label: 'Single entry',
    description: 'Export one entry at a time',
  },
];

// ─── Helper: trigger browser download from content string ─────────────────────

function triggerDownload(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

// ─── Inner Panel ──────────────────────────────────────────────────────────────

function CopyExportPanelInner({ workspaceId, blueprintId, entries }: Props) {
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('csv');
  const [selectedScope, setSelectedScope] = useState<ExportScope>('all');
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());
  const [singleEntryId, setSingleEntryId] = useState<string>('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const exportMutation = useExportCopy(workspaceId, blueprintId);

  // Only entries that have been approved are exportable
  // NOTE: BlueprintEntry doesn't carry copy status; the server filters for
  // approved sections. We still filter to the full entries list for scope
  // selection, letting the server determine what's truly exportable.
  const exportableEntries = entries;

  // ── Entry multi-select toggle ─────────────────────────────────────────────

  function toggleEntryId(id: string) {
    setSelectedEntryIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  // ── Derived: can the Export button be pressed? ─────────────────────────────

  const canExport =
    !exportMutation.isPending &&
    (selectedScope === 'all' ||
      (selectedScope === 'selected' && selectedEntryIds.size > 0) ||
      (selectedScope === 'single' && !!singleEntryId));

  // ── Export handler ─────────────────────────────────────────────────────────

  async function handleExport() {
    setSuccessMessage(null);

    const request =
      selectedScope === 'all'
        ? { format: selectedFormat, scope: 'all' as const }
        : selectedScope === 'selected'
        ? { format: selectedFormat, scope: 'selected' as const, entryIds: Array.from(selectedEntryIds) }
        : { format: selectedFormat, scope: 'single' as const, entryId: singleEntryId };

    try {
      const result = await exportMutation.mutateAsync(request);

      if (result.success) {
        if (result.content && result.filename) {
          triggerDownload(result.content, result.filename);
          setSuccessMessage(`Downloaded "${result.filename}"`);
        } else if (result.url) {
          window.open(result.url, '_blank', 'noopener,noreferrer');
          setSuccessMessage('Export opened in a new tab.');
        } else {
          setSuccessMessage('Export completed successfully.');
        }
      }
    } catch {
      // Error is surfaced via exportMutation.isError — no action needed
    }
  }

  // ── Empty state ─────────────────────────────────────────────────────────────

  if (exportableEntries.length === 0) {
    return (
      <EmptyState
        icon={Download}
        title="No entries to export"
        description="Add blueprint entries with approved copy sections before exporting."
      />
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Format selector */}
      <SectionCard
        title="Export Format"
        titleIcon={<Icon as={Download} size="md" className="text-[var(--brand-text-muted)]" />}
      >
        <div className="space-y-2" role="radiogroup" aria-label="Export format">
          {FORMAT_OPTIONS.map(option => {
            const OptionIcon = option.icon;
            const isSelected = selectedFormat === option.value;
            const isDisabled = option.disabled;

            return (
              <Button
                key={option.value}
                role="radio"
                aria-checked={isSelected}
                aria-disabled={isDisabled}
                disabled={isDisabled}
                onClick={() => !isDisabled && setSelectedFormat(option.value)}
                variant="ghost"
                size="md"
                className={cn(
                  'w-full justify-start gap-3 px-4 py-3 rounded-[var(--radius-xl)] border text-left transition-colors',
                  isDisabled
                    ? 'border-[var(--brand-border)] bg-[var(--surface-2)] opacity-40 cursor-not-allowed'
                    : isSelected
                    ? 'border-teal-500 bg-teal-500/10 cursor-pointer'
                    : 'border-[var(--brand-border)] bg-[var(--surface-3)]/70 hover:border-[var(--brand-border-hover)] cursor-pointer'
                )}
              >
                <Icon
                  as={OptionIcon}
                  size="md"
                  className={cn(
                    'shrink-0',
                    isDisabled ? 'text-[var(--brand-text-muted)]' : isSelected ? 'text-teal-400' : 'text-[var(--brand-text-muted)]'
                  )}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm font-medium ${
                        isDisabled ? 'text-[var(--brand-text-muted)]' : isSelected ? 'text-teal-300' : 'text-[var(--brand-text)]'
                      }`}
                    >
                      {option.label}
                    </span>
                    {isDisabled && option.disabledReason && (
                      <Badge label={option.disabledReason} tone="zinc" />
                    )}
                  </div>
                  <p
                    className={`t-caption mt-0.5 ${
                      isDisabled ? 'text-[var(--brand-text-muted)]' : 'text-[var(--brand-text-muted)]'
                    }`}
                  >
                    {option.description}
                  </p>
                </div>
                {isSelected && !isDisabled && (
                  <Icon as={CheckCircle2} size="md" className="text-teal-400 shrink-0" />
                )}
              </Button>
            );
          })}
        </div>
      </SectionCard>

      {/* Scope selector */}
      <SectionCard
        title="Export Scope"
        titleIcon={<Icon as={FileText} size="md" className="text-[var(--brand-text-muted)]" />}
      >
        <div className="space-y-2" role="radiogroup" aria-label="Export scope">
          {SCOPE_OPTIONS.map(option => {
            const isSelected = selectedScope === option.value;

            return (
              <Button
                key={option.value}
                role="radio"
                aria-checked={isSelected}
                onClick={() => setSelectedScope(option.value)}
                variant="ghost"
                size="md"
                className={cn(
                  'w-full justify-start gap-3 px-4 py-3 rounded-[var(--radius-xl)] border text-left transition-colors cursor-pointer',
                  isSelected
                    ? 'border-teal-500 bg-teal-500/10'
                    : 'border-[var(--brand-border)] bg-[var(--surface-3)]/70 hover:border-[var(--brand-border-hover)]'
                )}
              >
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm font-medium ${
                      isSelected ? 'text-teal-300' : 'text-[var(--brand-text)]'
                    }`}
                  >
                    {option.label}
                  </p>
                  <p className="t-caption text-[var(--brand-text-muted)] mt-0.5">{option.description}</p>
                </div>
                {isSelected && <Icon as={CheckCircle2} size="md" className="text-teal-400 shrink-0" />}
              </Button>
            );
          })}
        </div>

        {/* Selected entries picker */}
        {selectedScope === 'selected' && (
          <div className="mt-4 space-y-2">
            <p className="t-caption text-[var(--brand-text-muted)] font-medium uppercase tracking-wide">
              Choose entries
            </p>
            <div
              className="space-y-1.5 max-h-64 overflow-y-auto pr-1"
              role="group"
              aria-label="Select entries to export"
            >
              {exportableEntries.map(entry => {
                const checked = selectedEntryIds.has(entry.id);
                return (
                  <Button
                    key={entry.id}
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() => toggleEntryId(entry.id)}
                    variant="ghost"
                    size="md"
                    className={cn(
                      'w-full justify-start gap-3 px-3 py-2.5 rounded-[var(--radius-md)] border text-left transition-colors cursor-pointer',
                      checked
                        ? 'border-teal-500/50 bg-teal-500/8'
                        : 'border-[var(--brand-border)] bg-[var(--surface-3)]/50 hover:border-[var(--brand-border-hover)]'
                    )}
                  >
                    <div
                      className={cn(
                        'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                        checked
                          ? 'bg-teal-600 border-teal-600'
                          : 'border-[var(--brand-border-hover)] bg-transparent'
                      )}
                    >
                      {checked && (
                        <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="currentColor">
                          <path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className={`text-sm font-medium truncate ${checked ? 'text-teal-300' : 'text-[var(--brand-text)]'}`}>
                        {entry.name}
                      </p>
                      <p className="t-caption text-[var(--brand-text-muted)] truncate">{entry.primaryKeyword}</p>
                    </div>
                  </Button>
                );
              })}
            </div>
            {selectedEntryIds.size > 0 && (
              <p className="t-caption text-[var(--brand-text-muted)]">
                {selectedEntryIds.size} entr{selectedEntryIds.size === 1 ? 'y' : 'ies'} selected
              </p>
            )}
          </div>
        )}

        {/* Single entry picker */}
        {selectedScope === 'single' && (
          <div className="mt-4 space-y-2">
            <label
              htmlFor="single-entry-select"
              className="t-caption text-[var(--brand-text-muted)] font-medium uppercase tracking-wide"
            >
              Choose entry
            </label>
            <FormSelect
              id="single-entry-select"
              value={singleEntryId}
              onChange={setSingleEntryId}
              options={[
                { value: '', label: 'Select an entry…' },
                ...exportableEntries.map(entry => ({
                  value: entry.id,
                  label: `${entry.name} — ${entry.primaryKeyword}`,
                })),
              ]}
              className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text-bright)] focus:outline-none focus:border-teal-500 appearance-none cursor-pointer"
              aria-label="Select entry to export"
            />
          </div>
        )}
      </SectionCard>

      {/* Export button + result */}
      <div className="space-y-3">
        {/* Error message */}
        {exportMutation.isError && (
          <div
            className="flex items-start gap-2.5 bg-red-900/20 border border-red-900/40 rounded-[var(--radius-xl)] px-4 py-3"
            role="alert"
          >
            <Icon as={AlertCircle} size="md" className="text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-300">Export failed</p>
              <p className="t-caption text-red-400/80 mt-0.5">
                {exportMutation.error instanceof Error
                  ? exportMutation.error.message
                  : 'An unexpected error occurred. Please try again.'}
              </p>
            </div>
          </div>
        )}

        {/* Partial export error from result */}
        {exportMutation.data && !exportMutation.data.success && (
          <div
            className="flex items-start gap-2.5 bg-red-900/20 border border-red-900/40 rounded-[var(--radius-xl)] px-4 py-3"
            role="alert"
          >
            <Icon as={AlertCircle} size="md" className="text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-300">Export failed</p>
              <p className="t-caption text-red-400/80 mt-0.5">
                {exportMutation.data.error ?? 'An unexpected error occurred.'}
              </p>
            </div>
          </div>
        )}

        {/* Success message */}
        {successMessage && exportMutation.isSuccess && exportMutation.data?.success && (
          <div
            className="flex items-start gap-2.5 bg-emerald-900/20 border border-emerald-900/40 rounded-[var(--radius-xl)] px-4 py-3"
            role="status"
            aria-live="polite"
          >
            <Icon as={CheckCircle2} size="md" className="text-emerald-400 mt-0.5 shrink-0" />
            <p className="text-sm text-emerald-300">{successMessage}</p>
          </div>
        )}

        <Button
          onClick={handleExport}
          disabled={!canExport}
          variant="primary"
          size="md"
          icon={Download}
          loading={exportMutation.isPending}
          className="w-full justify-center"
          aria-label="Export copy"
        >
          {exportMutation.isPending ? 'Exporting…' : 'Export Copy'}
        </Button>
      </div>
    </div>
  );
}

// ─── Public export (wrapped in error boundary) ────────────────────────────────

export function CopyExportPanel(props: Props) {
  return (
    <ErrorBoundary label="Copy Export">
      <CopyExportPanelInner {...props} />
    </ErrorBoundary>
  );
}
